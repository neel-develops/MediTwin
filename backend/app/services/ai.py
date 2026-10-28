"""MediTwin AI — resource-allocation intelligence.

Decision support only. It optimizes *resource fit* (bed type, features, devices, scarcity,
ward load) and never makes clinical judgments: priority is entered by staff, and every
allocation it proposes must be approved by a person before it is saved.

* ``build_plan``   – plans beds for the whole waiting queue at once (priority tiers, most
                     constrained patient first, scarcity-aware scoring) and explains each pick.
* ``unlock``       – for patients with no bed, finds the concrete actions that would create one
                     (finish cleaning, release a reservation, return a device, allow a compatible type).
* ``forecast``     – projects ward occupancy for the next hours from stays, cleaning and demand
                     (simulated planning assumptions, clearly labelled).
* ``briefing``     – the short, prioritized situation report shown on the dashboard.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import timedelta

from sqlalchemy.orm import Session

from ..constants import BED_TYPES, PRIORITIES, PRIORITY_RANK, TYPICAL_STAY_HOURS
from ..errors import ApiError
from ..models import Bed, Patient
from .common import iso, minutes_since, now
from .rules import Ctx, Evaluation, evaluate_bed, recommendation_view

PRIORITY_LABEL = {"URGENT": "Urgent", "HIGH": "High", "ROUTINE": "Routine"}


# ================================================================== planner
def _available_beds(ctx: Ctx) -> list[Bed]:
    active = ctx.active_ward_ids
    return [b for b in ctx.beds if b.ward_id in active and b.status == "AVAILABLE" and b.id not in ctx.active_by_bed]


def _candidates(ctx: Ctx, p: Patient, beds: list[Bed]) -> list[tuple[Bed, Evaluation]]:
    out = []
    for b in beds:
        ev = evaluate_bed(ctx, b, p)
        if ev.eligible:
            out.append((b, ev))
    out.sort(key=lambda x: (-x[1].score, x[0].bed_code))
    return out


def _valid_options(ctx: Ctx, p: Patient, cands, taken_beds: set[int], taken_devs: set[int], want: int = 3):  # noqa: ANN001
    """Best still-valid options, re-checking device availability against devices already planned."""
    opts = []
    remaining = 0
    for b, ev0 in cands:
        if b.id in taken_beds:
            continue
        remaining += 1
        if len(opts) >= want:
            continue
        ev = evaluate_bed(ctx, b, p, taken_devs) if (p.required_equipment_types and taken_devs) else ev0
        if ev.eligible:
            opts.append((b, ev))
    opts.sort(key=lambda x: (-x[1].score, x[0].bed_code))
    return opts, remaining


def _greedy_baseline(ctx: Ctx, waiting: list[Patient], beds: list[Bed], cands) -> tuple[int, int | None]:  # noqa: ANN001
    """Manual first-come-first-served: each patient, in arrival order, gets the first free bed
    on the list that fits. Returns (placed, average score)."""
    taken_beds: set[int] = set()
    taken_devs: set[int] = set()
    scores: list[int] = []
    for p in sorted(waiting, key=lambda x: (x.created_at, x.id)):
        for b, ev0 in sorted(cands[p.id], key=lambda x: x[0].bed_code):
            if b.id in taken_beds:
                continue
            ev = evaluate_bed(ctx, b, p, taken_devs) if (p.required_equipment_types and taken_devs) else ev0
            if ev.eligible:
                taken_beds.add(b.id)
                taken_devs.update(d["id"] for d in ev.devices)
                scores.append(ev.score)
                break
    return len(scores), (round(sum(scores) / len(scores)) if scores else None)


def build_plan(s: Session) -> dict:
    ctx = Ctx(s)
    waiting = [p for p in ctx.patients if p.status == "WAITING"]
    beds = _available_beds(ctx)
    cands = {p.id: _candidates(ctx, p, beds) for p in waiting}
    solo_best = {p.id: (cands[p.id][0][0].bed_code if cands[p.id] else None) for p in waiting}

    taken_beds: set[int] = set()
    taken_devs: set[int] = set()
    assigned: list[dict] = []
    unplaced: list[Patient] = []
    bed_winner: dict[str, str] = {}
    step = 0
    for tier in PRIORITIES:
        pool = [p for p in waiting if p.priority == tier]
        while pool:
            choice = None
            for p in pool:
                opts, remaining = _valid_options(ctx, p, cands[p.id], taken_beds, taken_devs)
                regret = (opts[0][1].score - opts[1][1].score) if len(opts) > 1 else 100
                key = (0 if opts else 1, remaining, -regret, p.created_at, p.id)
                if choice is None or key < choice[0]:
                    choice = (key, p, opts, remaining)
            _, p, opts, remaining = choice
            pool.remove(p)
            if not opts:
                unplaced.append(p)
                continue
            b, ev = opts[0]
            step += 1
            taken_beds.add(b.id)
            taken_devs.update(d["id"] for d in ev.devices)
            bed_winner[b.bed_code] = p.patient_code
            assigned.append({"step": step, "patient": p, "bed": b, "ev": ev, "remaining": remaining, "alternatives": max(0, remaining - 1)})

    items = []
    for a in assigned:
        p, b, ev = a["patient"], a["bed"], a["ev"]
        reasons: list[str] = []
        top = sorted(ev.factors, key=lambda f: -(f["points"] / f["max"] if f["max"] else 0))
        for f in top[:3]:
            if f["points"] >= f["max"] * 0.75:
                reasons.append(f"{f['label']}: {f['note']}")
        if p.priority == "URGENT":
            reasons.insert(0, "Urgent priority (set by staff) — planned first")
        if a["remaining"] <= 3:
            reasons.append(f"Most constrained: only {a['remaining']} suitable bed{'s' if a['remaining'] != 1 else ''} — placed early so it isn't lost")
        best = solo_best.get(p.id)
        if best and best != b.bed_code:
            who = bed_winner.get(best)
            if who and who != p.patient_code:
                reasons.append(f"Its individually best bed {best} went to {who}, who had fewer options")
        if ev.devices:
            reasons.append("Reserves " + ", ".join(d["equipment_code"] for d in ev.devices))
        items.append({
            "step": a["step"], "patient_id": p.id, "patient_code": p.patient_code, "display_name": p.display_name,
            "priority": p.priority, "care_category": p.care_category, "required_bed_type": p.required_bed_type,
            "required_equipment_types": p.required_equipment_types or [], "required_bed_features": p.required_bed_features or [],
            "waiting_minutes": minutes_since(p.created_at), "alternatives": a["alternatives"], "reasons": reasons[:5],
            **recommendation_view(ctx, b, ev, 1),
        })

    unplaced_out = [{"patient_id": p.id, "patient_code": p.patient_code, "display_name": p.display_name, "priority": p.priority,
                     "required_bed_type": p.required_bed_type, "required_equipment_types": p.required_equipment_types or [],
                     "required_bed_features": p.required_bed_features or [], "waiting_minutes": minutes_since(p.created_at),
                     "blockers": _blockers(ctx, p), "unlock": _unlock(ctx, p, taken_beds)} for p in unplaced]

    baseline, baseline_score = _greedy_baseline(ctx, waiting, beds, cands)
    urgent_total = sum(1 for p in waiting if p.priority == "URGENT")
    scores = [i["score"] for i in items]
    return {
        "generated_at": iso(now()),
        "waiting": len(waiting), "placed": len(items), "unplaced": len(unplaced_out),
        "urgent_total": urgent_total, "urgent_placed": sum(1 for i in items if i["priority"] == "URGENT"),
        "avg_score": round(sum(scores) / len(scores)) if scores else None,
        "baseline_placed": baseline, "baseline_avg_score": baseline_score, "available_beds": len(beds),
        "items": items, "unplaced_patients": unplaced_out,
        "method": "Priority tiers (staff-set) → most-constrained patient first → highest resource match score, "
                  "re-checking device availability after every pick. Baseline: manual first-come-first-served, where each "
                  "patient in arrival order gets the first free bed on the list that fits.",
    }


def apply_plan(db, items: list[dict], confirmed_by: str = "Demo staff") -> dict:  # noqa: ANN001
    """Confirm approved plan rows. Each row is its own transaction with a full recheck."""
    from .patients import allocate

    if not isinstance(items, list) or not items:
        raise ApiError(422, "VALIDATION", "Select at least one planned allocation to approve.")
    results = []
    for it in items[:200]:
        try:
            with db.write() as s:
                r = allocate(s, {"patient_id": it.get("patient_id"), "bed_id": it.get("bed_id"), "confirmed_by": confirmed_by}, source="AI_PLAN")
            results.append({"patient_id": it.get("patient_id"), "bed_id": it.get("bed_id"), "ok": True,
                            "patient_code": r["patient_code"], "bed_code": r["bed_code"]})
        except ApiError as e:
            results.append({"patient_id": it.get("patient_id"), "bed_id": it.get("bed_id"), "ok": False, "code": e.code, "message": e.message})
    ok = sum(1 for r in results if r["ok"])
    return {"confirmed": ok, "failed": len(results) - ok, "results": results}


# ================================================================== unlocks
def _blockers(ctx: Ctx, p: Patient) -> list[str]:
    active = ctx.active_ward_ids
    compat = ctx.compatible_types(p.required_bed_type)
    typed = [b for b in ctx.beds if b.ward_id in active and b.bed_type in compat]
    out = []
    if not typed:
        out.append(f"No {p.required_bed_type} beds exist in active wards")
        return out
    free = [b for b in typed if b.status == "AVAILABLE"]
    if not free:
        out.append(f"All {len(typed)} {'/'.join(compat)} beds are occupied, reserved, cleaning or in maintenance")
        return out
    for f in p.required_bed_features or []:
        if not any(f in (b.features or []) for b in free):
            out.append(f"No free {p.required_bed_type} bed has {f}")
    for d in p.required_equipment_types or []:
        if not any(e.tracking_mode == "INDIVIDUAL" and e.equipment_type == d and e.status == "AVAILABLE" and e.assigned_bed_id is None
                   for e in ctx.equipment):
            out.append(f"No {d} available anywhere")
    if not out:
        out.append("Every suitable bed is planned for a higher-priority or more constrained patient")
    return out


def _unlock(ctx: Ctx, p: Patient, taken_beds: set[int]) -> list[dict]:
    """Concrete one-click actions that would create a suitable bed for this patient."""
    active = ctx.active_ward_ids
    out: list[dict] = []
    order = {"CLEANING": 0, "RESERVED": 1, "MAINTENANCE": 2}
    held = sorted((b for b in ctx.beds if b.ward_id in active and b.status in order and b.id not in taken_beds),
                  key=lambda b: (order[b.status], b.updated_at))
    for b in held:
        if evaluate_bed(ctx, b, p, assume_available=True).eligible:
            verb = {"CLEANING": "Finish cleaning", "RESERVED": "Release reservation on", "MAINTENANCE": "Return from maintenance"}[b.status]
            out.append({"kind": "BED_STATUS", "label": f"{verb} {b.bed_code}",
                        "detail": f"{ctx.ward_by_id[b.ward_id].name} · {b.status.lower()} for {minutes_since(b.updated_at)} min — fits {p.patient_code}",
                        "bed_id": b.id, "bed_code": b.bed_code, "to_status": "AVAILABLE"})
            if len(out) >= 2:
                break
    # A compatible bed type would help?
    if not out:
        for t in BED_TYPES:
            if t in ctx.compatible_types(p.required_bed_type):
                continue
            compat = ctx.compatible_types(p.required_bed_type) + [t]
            if any(b.ward_id in active and b.id not in taken_beds and evaluate_bed(ctx, b, p, compat_override=compat).eligible
                   for b in ctx.beds if b.bed_type == t):
                out.append({"kind": "COMPAT", "label": f"Allow {t} beds for {p.required_bed_type} patients",
                            "detail": f"Free {t} beds meet every other requirement of {p.patient_code} (Setup → allocation rules)",
                            "bed_type": p.required_bed_type, "add_type": t})
                break
    # A device stuck in maintenance?
    for d in p.required_equipment_types or []:
        free = [e for e in ctx.equipment if e.tracking_mode == "INDIVIDUAL" and e.equipment_type == d and e.status == "AVAILABLE"]
        if free:
            continue
        maint = [e for e in ctx.equipment if e.tracking_mode == "INDIVIDUAL" and e.equipment_type == d and e.status in ("MAINTENANCE", "RESERVED")]
        if maint:
            e = maint[0]
            out.append({"kind": "EQUIPMENT_STATUS", "label": f"Return {e.equipment_code} to service",
                        "detail": f"{d} {e.status.lower()} — the only way to supply a {d}", "equipment_id": e.id,
                        "equipment_code": e.equipment_code, "to_status": "AVAILABLE"})
    if not out:
        out.append({"kind": "INFO", "label": "Consider a transfer or wait for a discharge",
                    "detail": f"No configured {p.required_bed_type} capacity can be freed right now"})
    return out


def unlock_for_patient(s: Session, pid) -> dict:
    from .common import get_or_404

    ctx = Ctx(s)
    p = get_or_404(s, Patient, pid, "Patient")
    return {"patient_id": p.id, "blockers": _blockers(ctx, p), "unlock": _unlock(ctx, p, set())}


# ================================================================== forecast
def _hour_factor(hour: int) -> float:
    """Arrivals peak late morning to evening (demo curve)."""
    return 0.55 + 0.9 * math.exp(-((hour - 14) ** 2) / 30)


def forecast(s: Session, hours: int = 24, demand: float = 1.0) -> dict:
    ctx = Ctx(s)
    hours = max(6, min(int(hours), 72))
    demand = max(0.0, min(float(demand), 3.0))
    ref = now()
    turnaround = ctx.settings.get("cleaning_turnaround_minutes", 45) / 60
    wards = [w for w in ctx.wards if w.is_active]
    cap = {w.id: sum(1 for b in ctx.beds if b.ward_id == w.id) for w in wards}
    occ0 = {w.id: sum(1 for b in ctx.beds if b.ward_id == w.id and b.status == "OCCUPIED") for w in wards}
    discharges = defaultdict(lambda: defaultdict(float))  # ward -> hour -> beds freeing
    returns = defaultdict(lambda: defaultdict(float))     # ward -> hour -> cleaning beds becoming available
    for a in ctx.allocations:
        if a.status != "ACTIVE" or a.bed_id is None:
            continue
        bed = ctx.bed_by_id.get(a.bed_id)
        if not bed or bed.ward_id not in cap:
            continue
        stay = TYPICAL_STAY_HOURS.get(bed.bed_type, 72)
        elapsed = (ref - (a.admitted_at or a.assigned_at)).total_seconds() / 3600
        left = stay - elapsed
        if left <= 0:
            left = 2 + (a.id * 7) % 10  # overdue stays: assume discharge later today (deterministic spread)
        h = int(left)
        if h < hours:
            discharges[bed.ward_id][h] += 1
            rh = int(left + turnaround)
            if rh < hours:
                returns[bed.ward_id][rh] += 1
    avail0 = {w.id: sum(1 for b in ctx.beds if b.ward_id == w.id and b.status == "AVAILABLE") for w in wards}
    for b in ctx.beds:
        if b.status == "CLEANING" and b.ward_id in cap:
            left = max(0.0, turnaround - minutes_since(b.updated_at) / 60)
            returns[b.ward_id][int(left)] += 1
    # Demand: waiting queue now + expected arrivals ≈ steady-state turnover × demand factor.
    queue = defaultdict(float)
    for p in ctx.patients:
        if p.status != "WAITING":
            continue
        target = next((w for w in wards if any(b.ward_id == w.id and b.bed_type in ctx.compatible_types(p.required_bed_type) for b in ctx.beds)), None)
        if target:
            queue[target.id] += 1
    rate = {}
    for w in wards:
        types = [b.bed_type for b in ctx.beds if b.ward_id == w.id]
        stay = sum(TYPICAL_STAY_HOURS.get(t, 72) for t in types) / len(types) if types else 72
        # Normal demand replaces today's turnover (keeps occupancy level); the factor scales it up or down.
        rate[w.id] = max(occ0[w.id], cap[w.id] * 0.35) / stay

    series = []
    state = {w.id: {"occ": float(occ0[w.id]), "free": float(avail0[w.id]), "unmet": 0.0, "backlog": queue[w.id]} for w in wards}
    ward_series = {w.id: [] for w in wards}
    for h in range(hours + 1):
        t = ref + timedelta(hours=h)
        tot_occ = tot_free = tot_unmet = 0.0
        for w in wards:
            st = state[w.id]
            if h > 0:
                d = discharges[w.id].get(h - 1, 0)
                st["occ"] = max(0.0, st["occ"] - d)
                st["free"] += returns[w.id].get(h - 1, 0)
                st["backlog"] += rate[w.id] * demand * _hour_factor(t.hour)
            take = min(st["free"], st["backlog"])
            st["occ"] += take
            st["free"] -= take
            st["backlog"] -= take
            pct = round(min(100.0, st["occ"] / cap[w.id] * 100), 1) if cap[w.id] else 0
            ward_series[w.id].append(pct)
            tot_occ += st["occ"]
            tot_free += st["free"]
            tot_unmet += st["backlog"]
        total_cap = sum(cap.values()) or 1
        series.append({"hour": h, "time": iso(t), "label": f"+{h}h", "occupied": round(tot_occ, 1),
                       "available": round(max(0.0, tot_free), 1), "waiting": round(tot_unmet, 1),
                       "occupancy_pct": round(tot_occ / total_cap * 100, 1),
                       **{f"w{w.id}": ward_series[w.id][-1] for w in wards}})
    ward_out = []
    for w in wards:
        pts = ward_series[w.id]
        peak = max(pts) if pts else 0
        ph = pts.index(peak) if pts else 0
        now_pct = pts[0] if pts else 0
        risk = "critical" if peak >= 98 else "high" if peak >= 90 else "elevated" if peak >= 80 else "normal"
        ward_out.append({"ward_id": w.id, "name": w.name, "key": f"w{w.id}", "capacity": cap[w.id], "now_pct": now_pct,
                         "peak_pct": peak, "peak_hour": ph, "peak_time": series[ph]["time"],
                         "peak_label": "now" if ph == 0 else f"in {ph} h", "risk": risk,
                         "discharges_expected": round(sum(discharges[w.id].values()))})
    return {
        "simulated": True, "hours": hours, "demand_factor": demand, "series": series, "wards": ward_out,
        "assumptions": [
            "Typical stay by bed type: " + ", ".join(f"{k} {v} h" for k, v in TYPICAL_STAY_HOURS.items()),
            f"Released beds return after {round(turnaround * 60)} min cleaning",
            "Arrivals follow a daily curve peaking mid-afternoon, scaled by the demand factor",
            "Planning projection on fictional data — not a prediction about real patients",
        ],
    }


# ================================================================== briefing
def briefing(s: Session) -> dict:
    ctx = Ctx(s)
    active = ctx.active_ward_ids
    beds = [b for b in ctx.beds if b.ward_id in active]
    total = len(beds) or 1
    free = sum(1 for b in beds if b.status == "AVAILABLE")
    occ = sum(1 for b in beds if b.status == "OCCUPIED")
    cleaning = [b for b in beds if b.status == "CLEANING"]
    waiting = [p for p in ctx.patients if p.status == "WAITING"]
    plan = build_plan(s)
    fc = forecast(s, 24)
    hot = sorted(fc["wards"], key=lambda w: -w["peak_pct"])
    insights: list[dict] = []

    if waiting:
        sev = "critical" if plan["urgent_placed"] < plan["urgent_total"] else "action"
        detail = f"{plan['placed']} of {len(waiting)} waiting patients can be placed now"
        if plan["placed"] > plan["baseline_placed"]:
            detail += f" — {plan['placed'] - plan['baseline_placed']} more than first-come-first-served"
        if plan["unplaced"]:
            detail += f". {plan['unplaced']} need{'s' if plan['unplaced'] == 1 else ''} an unlock action"
        insights.append({"id": "queue", "severity": sev, "title": f"AI allocation plan ready for {len(waiting)} waiting patient{'s' if len(waiting) != 1 else ''}",
                         "detail": detail + ".", "action": {"kind": "OPEN_PLAN", "label": "Review plan"}})
    for w in hot[:2]:
        if w["risk"] in ("critical", "high"):
            insights.append({"id": f"fc-{w['ward_id']}", "severity": "warning" if w["risk"] == "high" else "critical",
                             "title": f"{w['name']} projected to reach {round(w['peak_pct'])}% {w['peak_label']}",
                             "detail": f"Now {round(w['now_pct'])}% occupied, {w['discharges_expected']} discharge{'' if w['discharges_expected'] == 1 else 's'} expected in 24 h.",
                             "action": {"kind": "OPEN_FORECAST", "label": "See forecast"}})
    for t in ("Ventilator", "Monitor", "Infusion Pump"):
        need = sum(1 for p in waiting if t in (p.required_equipment_types or []))
        have = sum(1 for e in ctx.equipment if e.tracking_mode == "INDIVIDUAL" and e.equipment_type == t and e.status == "AVAILABLE")
        if need and have < need + 2:
            insights.append({"id": f"eq-{t}", "severity": "warning", "title": f"{t}s are a bottleneck",
                             "detail": f"{have} available for {need} waiting patient{'s' if need != 1 else ''} who need one.",
                             "action": {"kind": "OPEN_EQUIPMENT", "label": "View equipment", "type": t}})
    if cleaning:
        long = [b for b in cleaning if minutes_since(b.updated_at) > ctx.settings.get("cleaning_turnaround_minutes", 45)]
        if long:
            insights.append({"id": "cleaning", "severity": "action", "title": f"{len(long)} bed{'s' if len(long) != 1 else ''} past cleaning turnaround",
                             "detail": "Marking them ready returns capacity immediately: " + ", ".join(b.bed_code for b in long[:5]) + ("…" if len(long) > 5 else ""),
                             "action": {"kind": "MARK_CLEANED", "label": "Mark all ready", "bed_ids": [b.id for b in long]}})
    stale = [b for b in beds if b.status == "RESERVED" and minutes_since(b.updated_at) > 240]
    if stale:
        insights.append({"id": "stale-res", "severity": "info", "title": f"{len(stale)} reservation{'s' if len(stale) != 1 else ''} older than 4 h",
                         "detail": "Review whether they are still needed: " + ", ".join(b.bed_code for b in stale[:5]) + ("…" if len(stale) > 5 else ""),
                         "action": {"kind": "OPEN_BEDS", "label": "Review", "status": "RESERVED"}})

    pressure = hot[0] if hot else None
    pct_free = round(free / total * 100)
    if pressure and pressure["peak_pct"] >= 90:
        headline = f"{free} beds free ({pct_free}%). {pressure['name']} is the pressure point — projected {round(pressure['peak_pct'])}% {pressure['peak_label']}."
    else:
        headline = f"{free} beds free ({pct_free}%), {occ} occupied. Capacity looks stable for the next 24 hours."
    if waiting:
        headline += f" {len(waiting)} patient{'s' if len(waiting) != 1 else ''} waiting, {plan['placed']} placeable now."
    order = {"critical": 0, "warning": 1, "action": 2, "info": 3}
    insights.sort(key=lambda i: order.get(i["severity"], 9))
    return {"generated_at": iso(now()), "headline": headline, "insights": insights[:5],
            "plan": {k: plan[k] for k in ("waiting", "placed", "unplaced", "urgent_total", "urgent_placed", "avg_score", "baseline_placed")},
            "forecast_peak": pressure}
