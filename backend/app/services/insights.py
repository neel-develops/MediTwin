"""Dashboard summary, alerts, activity, global search, settings and reports."""
from __future__ import annotations

from collections import defaultdict
from types import SimpleNamespace

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..constants import BED_TYPES, DEVICE_TYPES, EQUIPMENT_STATUSES, PATIENT_STATUSES
from ..models import ActivityEvent, Allocation
from .common import clean, get_settings, iso, log, minutes_since, now, require_int, save_settings, subset_of
from .inventory import check_integrity, ward_view
from .rules import Ctx, bed_counts, integrity_problems, recommend_for


def device_totals(ctx: Ctx) -> dict:
    devices = [e for e in ctx.equipment if e.tracking_mode == "INDIVIDUAL"]
    by_type = {t: {"total": 0, **{st: 0 for st in EQUIPMENT_STATUSES}} for t in DEVICE_TYPES}
    totals = {"total": len(devices), **{st: 0 for st in EQUIPMENT_STATUSES}}
    for d in devices:
        if d.equipment_type in by_type:
            by_type[d.equipment_type]["total"] += 1
            by_type[d.equipment_type][d.status] += 1
        totals[d.status] += 1
    return {"devices": totals, "by_type": by_type}


def summary(s: Session) -> dict:
    ctx = Ctx(s)
    active = [w for w in ctx.wards if w.is_active]
    ids = {w.id for w in active}
    beds = [b for b in ctx.beds if b.ward_id in ids]
    dev = device_totals(ctx)
    stock = [{"id": e.id, "equipment_code": e.equipment_code, "equipment_type": e.equipment_type, "quantity_total": e.quantity_total,
              "quantity_available": e.quantity_available, "ward_id": e.ward_id} for e in ctx.equipment if e.tracking_mode == "QUANTITY"]
    patients = {st: sum(1 for p in ctx.patients if p.status == st) for st in PATIENT_STATUSES}
    by_type = []
    for t in BED_TYPES:
        tb = [b for b in beds if b.bed_type == t]
        if tb:
            by_type.append({"bed_type": t, **bed_counts(tb)})
    waiting = [p for p in ctx.patients if p.status == "WAITING"]
    placeable = sum(1 for p in waiting if recommend_for(ctx, p, 0)["eligible_count"] > 0)
    day_ago = now().timestamp() - 86400
    admissions_24h = sum(1 for a in ctx.allocations if a.assigned_at.timestamp() >= day_ago)
    releases_24h = sum(1 for a in ctx.allocations if a.released_at and a.released_at.timestamp() >= day_ago and a.status == "RELEASED")
    return {
        "hospital_name": ctx.settings.get("hospital_name", "Hospital"),
        "beds": bed_counts(beds),
        "beds_by_type": by_type,
        "wards": [ward_view(ctx, w) for w in active],
        "equipment": {**dev, "stock": stock},
        "patients": patients,
        "queue": {
            "waiting": len(waiting),
            "urgent": sum(1 for p in waiting if p.priority == "URGENT"),
            "placeable_now": placeable,
            "longest_wait_minutes": max((minutes_since(p.created_at) for p in waiting), default=0),
            "awaiting_arrival": patients["ALLOCATED"],
        },
        "flow_24h": {"allocations": admissions_24h, "releases": releases_24h},
        "generated_at": iso(now()),
    }


def alerts(s: Session) -> list[dict]:
    ctx = Ctx(s)
    st = ctx.settings
    out: list[dict] = []
    for w in ctx.wards:
        if not w.is_active:
            continue
        v = ward_view(ctx, w)
        if not v["bed_count"]:
            continue
        avail_pct = round(v["counts"]["AVAILABLE"] / v["bed_count"] * 100)
        if v["counts"]["AVAILABLE"] == 0:
            out.append({"id": f"noavail-{w.id}", "severity": "critical", "kind": "LOW_AVAILABILITY", "title": f"No available beds in {w.name}",
                        "detail": f"0 of {v['bed_count']} beds available", "ward_id": w.id})
        elif avail_pct <= st["low_available_pct"]:
            out.append({"id": f"lowavail-{w.id}", "severity": "warning", "kind": "LOW_AVAILABILITY", "title": f"Low availability in {w.name}",
                        "detail": f"{v['counts']['AVAILABLE']} of {v['bed_count']} beds available ({avail_pct}% ≤ {st['low_available_pct']}% threshold)", "ward_id": w.id})
        if v["occupancy_pct"] >= st["high_occupancy_pct"]:
            out.append({"id": f"highocc-{w.id}", "severity": "warning", "kind": "HIGH_OCCUPANCY", "title": f"High occupancy in {w.name}",
                        "detail": f"{v['occupancy_pct']}% occupied (threshold {st['high_occupancy_pct']}%)", "ward_id": w.id})
    for t in DEVICE_TYPES:
        avail = sum(1 for e in ctx.equipment if e.tracking_mode == "INDIVIDUAL" and e.equipment_type == t and e.status == "AVAILABLE")
        mn = (st.get("equipment_min_available") or {}).get(t, 0)
        if avail < mn:
            out.append({"id": f"short-{t}", "severity": "critical" if avail == 0 else "warning", "kind": "EQUIPMENT_SHORTAGE",
                        "title": f"Equipment shortage: {t}", "detail": f"{avail} available (minimum {mn})", "equipment_type": t})
    for e in ctx.equipment:
        if e.tracking_mode == "QUANTITY" and (e.quantity_total or 0) > 0 and e.quantity_available == 0:
            out.append({"id": f"stock-{e.id}", "severity": "warning", "kind": "EQUIPMENT_SHORTAGE", "title": f"{e.equipment_type} stock exhausted",
                        "detail": f"0 of {e.quantity_total} available", "equipment_type": e.equipment_type})
    maint = [b for b in ctx.beds if b.status == "MAINTENANCE" and b.ward_id in ctx.active_ward_ids]
    if maint:
        per: dict[str, int] = defaultdict(int)
        for b in maint:
            per[ctx.ward_by_id[b.ward_id].name] += 1
        out.append({"id": "maint-beds", "severity": "info", "kind": "MAINTENANCE", "title": f"{len(maint)} bed{'s' if len(maint) > 1 else ''} under maintenance",
                    "detail": " · ".join(f"{n}: {c}" for n, c in per.items())})
    maint_dev = [e for e in ctx.equipment if e.tracking_mode == "INDIVIDUAL" and e.status == "MAINTENANCE"]
    if maint_dev:
        out.append({"id": "maint-dev", "severity": "info", "kind": "MAINTENANCE", "title": f"{len(maint_dev)} device{'s' if len(maint_dev) > 1 else ''} under maintenance",
                    "detail": ", ".join(e.equipment_code for e in maint_dev[:6]) + ("…" if len(maint_dev) > 6 else "")})
    turnaround = st.get("cleaning_turnaround_minutes", 45)
    overdue = [b for b in ctx.beds if b.status == "CLEANING" and b.ward_id in ctx.active_ward_ids and minutes_since(b.updated_at) > turnaround * 2]
    if overdue:
        out.append({"id": "cleaning-overdue", "severity": "info", "kind": "CLEANING_BACKLOG",
                    "title": f"{len(overdue)} bed{'s' if len(overdue) > 1 else ''} in cleaning longer than {turnaround * 2} min",
                    "detail": ", ".join(b.bed_code for b in overdue[:6]) + ("…" if len(overdue) > 6 else "")})
    for p in ctx.patients:
        if p.status != "WAITING":
            continue
        if not recommend_for(ctx, p, 0)["eligible_count"]:
            need = f"Needs {p.required_bed_type} bed"
            if p.required_equipment_types:
                need += " + " + ", ".join(p.required_equipment_types)
            if p.required_bed_features:
                need += " + " + ", ".join(p.required_bed_features)
            out.append({"id": f"nobed-{p.id}", "severity": "warning", "kind": "NO_SUITABLE_BED", "title": f"No suitable bed for {p.patient_code}",
                        "detail": need, "patient_id": p.id})
    for prob in integrity_problems(ctx):
        out.append({"id": f"conflict-{prob}", "severity": "critical", "kind": "ALLOCATION_CONFLICT", "title": "Allocation conflict", "detail": prob})
    order = {"critical": 0, "warning": 1, "info": 2}
    return sorted(out, key=lambda a: order[a["severity"]])


def activity(s: Session, limit: int = 30, resource_type: str | None = None) -> list[dict]:
    stmt = select(ActivityEvent)
    if resource_type:
        stmt = stmt.where(ActivityEvent.resource_type == resource_type)
    rows = s.scalars(stmt.order_by(ActivityEvent.created_at.desc(), ActivityEvent.id.desc()).limit(max(1, min(int(limit), 500)))).all()
    return [{"id": r.id, "actor_label": r.actor_label, "action": r.action, "resource_type": r.resource_type, "resource_id": r.resource_id,
             "resource_code": r.resource_code, "message": r.message, "details": r.details, "created_at": iso(r.created_at)} for r in rows]


def search(s: Session, q: str) -> dict:
    ctx = Ctx(s)
    t = clean(q).lower()
    if not t:
        return {"wards": [], "beds": [], "equipment": [], "patients": []}
    return {
        "wards": [{"id": w.id, "name": w.name, "bed_code_prefix": w.bed_code_prefix} for w in ctx.wards if t in w.name.lower() or w.bed_code_prefix.lower() == t][:5],
        "beds": [{"id": b.id, "bed_code": b.bed_code, "status": b.status, "ward_id": b.ward_id, "ward_name": ctx.ward_by_id[b.ward_id].name}
                 for b in ctx.beds if t in b.bed_code.lower()][:8],
        "equipment": [{"id": e.id, "equipment_code": e.equipment_code, "equipment_type": e.equipment_type, "status": e.status}
                      for e in ctx.equipment if t in e.equipment_code.lower()][:5],
        "patients": [{"id": p.id, "patient_code": p.patient_code, "display_name": p.display_name, "status": p.status}
                     for p in ctx.patients if t in p.patient_code.lower() or t in p.display_name.lower()][:5],
    }


# ------------------------------------------------------------------ settings
def update_settings(s: Session, patch: dict) -> dict:
    ctx = Ctx(s)
    st = get_settings(s)
    if patch.get("low_available_pct") is not None:
        st["low_available_pct"] = require_int(patch["low_available_pct"], "Low availability threshold", 0, 100)
    if patch.get("high_occupancy_pct") is not None:
        st["high_occupancy_pct"] = require_int(patch["high_occupancy_pct"], "High occupancy threshold", 1, 100)
    if patch.get("group_size") is not None:
        st["group_size"] = require_int(patch["group_size"], "Visual group size", 4, 30)
    if patch.get("cleaning_turnaround_minutes") is not None:
        st["cleaning_turnaround_minutes"] = require_int(patch["cleaning_turnaround_minutes"], "Cleaning turnaround", 5, 600)
    if patch.get("release_to_cleaning") is not None:
        st["release_to_cleaning"] = bool(patch["release_to_cleaning"])
    if patch.get("hospital_name") is not None:
        name = clean(patch["hospital_name"])[:60]
        if name:
            st["hospital_name"] = name
    if isinstance(patch.get("equipment_min_available"), dict):
        for t in DEVICE_TYPES:
            if patch["equipment_min_available"].get(t) is not None:
                st["equipment_min_available"][t] = require_int(patch["equipment_min_available"][t], f"{t} minimum", 0, 1000)
    if isinstance(patch.get("bed_type_compat"), dict):
        for t in BED_TYPES:
            if patch["bed_type_compat"].get(t) is None:
                continue
            lst = subset_of(patch["bed_type_compat"][t], BED_TYPES, f"Compatible types for {t}")
            if t not in lst:
                lst.insert(0, t)
            st["bed_type_compat"][t] = lst
    save_settings(s, st)
    log(s, "SETTINGS_UPDATED", "settings", 0, "settings", "Thresholds and allocation rules updated")
    check_integrity(ctx)
    return st


# ------------------------------------------------------------------ reports
def reports(s: Session) -> dict:
    ctx = Ctx(s)
    wards = [ward_view(ctx, w) for w in ctx.wards if w.is_active]
    dev = device_totals(ctx)
    util = []
    for t, c in dev["by_type"].items():
        usable = c["total"] - c["MAINTENANCE"]
        util.append({"type": t, **c, "utilization_pct": round(c["IN_USE"] / usable * 100) if usable else 0})
    allocs = sorted(ctx.allocations, key=lambda a: a.assigned_at, reverse=True)
    # Hourly allocation counts over the last 24 h (from stored allocations).
    ref = now()
    hourly = [0] * 24
    for a in allocs:
        h = int((ref - a.assigned_at).total_seconds() // 3600)
        if 0 <= h < 24:
            hourly[23 - h] += 1
    sources = defaultdict(int)
    for a in allocs:
        sources[a.source] += 1
    scores = [a.match_score for a in allocs if a.match_score]
    from .patients import allocation_view

    return {
        "wards": wards, "equipment_utilization": util,
        "allocation_history": [allocation_view(ctx, a) for a in allocs[:40]],
        "allocations_hourly": [{"hours_ago": 23 - i, "count": c} for i, c in enumerate(hourly)],
        "allocation_sources": dict(sources),
        "avg_match_score": round(sum(scores) / len(scores)) if scores else None,
    }


def simulate_surge(s: Session, count: int = 20, seed: int = 7) -> dict:
    """What-if: N extra arrivals placed greedily on top of today's state. Read-only, never writes."""
    import random

    n = require_int(count, "Simulated arrivals", 1, 300)
    with s.no_autoflush:
        return _simulate(s, n, seed, random)


def _simulate(s: Session, n: int, seed, random) -> dict:  # noqa: ANN001
    ctx = Ctx(s)
    rnd = random.Random(int(seed) if str(seed).lstrip("-").isdigit() else 7)
    mix = [("General", 0.55), ("ICU", 0.15), ("Pediatric", 0.15), ("Maternity", 0.1), ("Isolation", 0.05)]
    care = {"General": "General Medicine", "ICU": "Critical Care", "Pediatric": "Paediatrics", "Maternity": "Maternity", "Isolation": "Infectious Disease"}
    by_type = {t: {"type": t, "requested": 0, "placed": 0} for t in BED_TYPES}
    reasons: dict[str, int] = defaultdict(int)
    placed = 0
    fake_alloc_id = -1
    for i in range(n):
        r = rnd.random()
        typ = "General"
        for t, w in mix:
            if r < w:
                typ = t
                break
            r -= w
        devs = (["Monitor", "Ventilator"] if rnd.random() < 0.5 else ["Monitor"]) if typ == "ICU" else (["Monitor"] if rnd.random() < 0.2 else [])
        feats = ["Oxygen Outlet"] if typ == "ICU" or rnd.random() < 0.25 else []
        sim = SimpleNamespace(id=-1 - i, patient_code=f"SIM-{i + 1}", required_bed_type=typ, required_equipment_types=devs,
                              required_bed_features=feats, care_category=care[typ])
        by_type[typ]["requested"] += 1
        rec = recommend_for(ctx, sim, 1)
        if rec["recommendations"]:
            best = rec["recommendations"][0]
            bed = ctx.bed_by_id[best["bed_id"]]
            bed.status = "OCCUPIED"  # in-memory only: the session is never committed
            ctx.active_by_bed[bed.id] = Allocation(id=fake_alloc_id, bed_id=bed.id, patient_id=sim.id, status="ACTIVE")
            fake_alloc_id -= 1
            for d in best["devices"]:
                e = ctx.equipment_by_id[d["id"]]
                e.status, e.assigned_bed_id = "IN_USE", bed.id
            ctx._ward_occ = None
            by_type[typ]["placed"] += 1
            placed += 1
        else:
            reason = next((x for x in rec["rejected_summary"] if not x["reason"].startswith("Not available")), None)
            reasons[reason["reason"] if reason else f"No available {typ} beds"] += 1
    wards_after = []
    for w in ctx.wards:
        if not w.is_active:
            continue
        beds = [b for b in ctx.beds if b.ward_id == w.id]
        c = bed_counts(beds)
        wards_after.append({"name": w.name, "bed_count": len(beds), "available": c["AVAILABLE"],
                            "occupancy_pct": round(c["OCCUPIED"] / len(beds) * 100) if beds else 0})
    s.rollback()  # discard every in-memory change
    s.expunge_all()
    return {"simulated": True, "arrivals": n, "placed": placed, "unplaced": n - placed,
            "by_type": [v for v in by_type.values() if v["requested"]],
            "unplaced_reasons": sorted(({"reason": k, "count": v} for k, v in reasons.items()), key=lambda x: -x["count"]),
            "wards_after": wards_after}


def allocation_count(s: Session) -> int:
    return len(s.scalars(select(Allocation.id)).all())
