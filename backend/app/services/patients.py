"""Patients, the patient-flow board and the allocation lifecycle (allocate → admit → release)."""
from __future__ import annotations

import re

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..constants import (ACTIVE_PATIENT, BED_FEATURES, BED_TYPES, CARE_CATEGORIES, DEVICE_TYPES, FLOW_STAGES,
                         PATIENT_STATUSES, PRIORITIES, PRIORITY_RANK)
from ..errors import ApiError, validation
from ..models import Allocation, Bed, Patient
from .common import (clean, get_or_404, iso, log, minutes_since, now, require_int, require_one_of, require_text,
                     subset_of)
from .inventory import check_integrity, equipment_view
from .rules import Ctx, evaluate_bed, patient_stage, recommend_for


# ------------------------------------------------------------------ views
def allocation_view(ctx: Ctx, a: Allocation) -> dict:
    bed = ctx.bed_by_id.get(a.bed_id) if a.bed_id else None
    p = ctx.patient_by_id.get(a.patient_id)
    ward = ctx.ward_by_id.get(bed.ward_id) if bed else None
    return {
        "id": a.id, "patient_id": a.patient_id, "patient_code": p.patient_code if p else None, "patient_name": p.display_name if p else None,
        "bed_id": a.bed_id, "bed_code": bed.bed_code if bed else (a.bed_code or "(removed)"), "ward_name": ward.name if ward else "",
        "status": a.status, "assigned_at": iso(a.assigned_at), "admitted_at": iso(a.admitted_at), "released_at": iso(a.released_at),
        "confirmed_by": a.confirmed_by, "equipment_ids": a.equipment_ids or [], "outcome": a.outcome, "source": a.source,
        "match_score": a.match_score,
    }


def patient_view(ctx: Ctx, p: Patient) -> dict:
    a = ctx.active_by_patient.get(p.id)
    bed = ctx.bed_by_id.get(a.bed_id) if a and a.bed_id else None
    return {
        "id": p.id, "patient_code": p.patient_code, "display_name": p.display_name, "care_category": p.care_category,
        "required_bed_type": p.required_bed_type, "required_equipment_types": p.required_equipment_types or [],
        "required_bed_features": p.required_bed_features or [], "priority": p.priority, "status": p.status,
        "stage": patient_stage(p), "match_started_at": iso(p.match_started_at), "notes": p.notes or "", "is_demo": p.is_demo,
        "allocation_id": a.id if a else None, "bed_id": bed.id if bed else None, "bed_code": bed.bed_code if bed else None,
        "bed_ward_id": bed.ward_id if bed else None,
        "created_at": iso(p.created_at), "updated_at": iso(p.updated_at),
        "waiting_minutes": minutes_since(p.created_at) if p.status == "WAITING" else None,
    }


# ------------------------------------------------------------------ patients
def list_patients(s: Session, search=None, status=None) -> list[dict]:
    ctx = Ctx(s)
    q = clean(search).lower()
    rows = [p for p in ctx.patients if (not status or p.status == status)
            and (not q or q in p.patient_code.lower() or q in p.display_name.lower())]
    rows.sort(key=lambda p: (0 if p.status == "WAITING" else 1, -p.id))
    return [patient_view(ctx, p) for p in rows]


def get_patient(s: Session, pid) -> dict:
    ctx = Ctx(s)
    p = get_or_404(s, Patient, pid, "Patient")
    a = ctx.active_by_patient.get(p.id)
    bed = ctx.bed_by_id.get(a.bed_id) if a and a.bed_id else None
    ward = ctx.ward_by_id.get(bed.ward_id) if bed else None
    devices = [equipment_view(ctx, e) for e in ctx.equipment if a and e.id in (a.equipment_ids or [])]
    history = [allocation_view(ctx, x) for x in ctx.allocations if x.patient_id == p.id]
    stage = patient_stage(p)
    fit = recommend_for(ctx, p, 0)["eligible_count"] if stage in ("WAITING", "MATCHING") else None
    from .inventory import bed_view

    return {**patient_view(ctx, p), "fit_count": fit, "allocation": allocation_view(ctx, a) if a else None,
            "bed": bed_view(ctx, bed) if bed else None, "ward_name": ward.name if ward else None, "devices": devices,
            "history": sorted(history, key=lambda h: h["assigned_at"] or "", reverse=True)}


def _code_ok(code: str, label: str) -> None:
    if not re.fullmatch(r"[A-Z0-9-]{2,16}", code):
        raise validation(f"{label} must be 2–16 letters, digits or dashes.", "patient_code")


def create_patient(s: Session, data: dict) -> dict:
    ctx = Ctx(s)
    name = require_text(data.get("display_name"), "Display name", 60)
    codes = {p.patient_code for p in ctx.patients}
    code = clean(data.get("patient_code")).upper()
    if code:
        _code_ok(code, "Patient code")
        if code in codes:
            raise ApiError(409, "DUPLICATE", f"Patient code {code} already exists.")
    else:
        n = 6001 + len(ctx.patients)
        while f"P-{n}" in codes:
            n += 1
        code = f"P-{n}"
    ts = now()
    p = Patient(
        patient_code=code, display_name=name,
        care_category=require_one_of(data.get("care_category") or "General Medicine", CARE_CATEGORIES, "Care category"),
        required_bed_type=require_one_of(data.get("required_bed_type") or "General", BED_TYPES, "Required bed type"),
        required_equipment_types=subset_of(data.get("required_equipment_types"), DEVICE_TYPES, "Required equipment"),
        required_bed_features=subset_of(data.get("required_bed_features"), BED_FEATURES, "Special requirements"),
        priority=require_one_of(data.get("priority") or "ROUTINE", PRIORITIES, "Priority"), match_started_at=None,
        notes=clean(data.get("notes"))[:300], status="WAITING", is_demo=True, created_at=ts, updated_at=ts)
    s.add(p)
    s.flush()
    ctx.patients.append(p)
    log(s, "PATIENT_REGISTERED", "patient", p.id, p.patient_code, f"{p.patient_code} registered (needs {p.required_bed_type} bed)")
    check_integrity(ctx)
    return patient_view(ctx, p)


def update_patient(s: Session, pid, patch: dict) -> dict:
    ctx = Ctx(s)
    p = get_or_404(s, Patient, pid, "Patient")
    if patch.get("display_name") is not None:
        p.display_name = require_text(patch["display_name"], "Display name", 60)
    if patch.get("care_category") is not None:
        p.care_category = require_one_of(patch["care_category"], CARE_CATEGORIES, "Care category")
    if patch.get("notes") is not None:
        p.notes = clean(patch["notes"])[:300]
    if patch.get("priority") is not None:
        p.priority = require_one_of(patch["priority"], PRIORITIES, "Priority")
    req_keys = ("required_bed_type", "required_equipment_types", "required_bed_features")
    if any(patch.get(k) is not None for k in req_keys):
        if p.status != "WAITING":
            raise ApiError(409, "PATIENT_NOT_WAITING", f"Requirements can only be changed while {p.patient_code} is waiting for a bed.")
        if patch.get("required_bed_type") is not None:
            p.required_bed_type = require_one_of(patch["required_bed_type"], BED_TYPES, "Required bed type")
        if patch.get("required_equipment_types") is not None:
            p.required_equipment_types = subset_of(patch["required_equipment_types"], DEVICE_TYPES, "Required equipment")
        if patch.get("required_bed_features") is not None:
            p.required_bed_features = subset_of(patch["required_bed_features"], BED_FEATURES, "Special requirements")
    if patch.get("status") is not None and patch["status"] != p.status:
        require_one_of(patch["status"], PATIENT_STATUSES, "Status")
        if p.status in ACTIVE_PATIENT or patch["status"] in ACTIVE_PATIENT:
            raise ApiError(409, "INVALID_TRANSITION", "Use allocation, admission and release to change a patient with a bed.")
        p.status = patch["status"]
        p.match_started_at = None
    p.updated_at = now()
    log(s, "PATIENT_UPDATED", "patient", p.id, p.patient_code, f"{p.patient_code} updated")
    check_integrity(ctx)
    return patient_view(ctx, p)


# ------------------------------------------------------------------ flow board
def patient_flow(s: Session, search=None, care_category=None, bed_type=None, priority=None, ward_id=None, stage=None,
                 page: int = 1, page_size: int = 24, per_column: int = 6) -> dict:
    ctx = Ctx(s)
    ref = now()
    q = clean(search).lower()
    fit_cache: dict[int, int] = {}

    def fit_of(p: Patient) -> int:
        if p.id not in fit_cache:
            fit_cache[p.id] = recommend_for(ctx, p, 0)["eligible_count"]
        return fit_cache[p.id]

    rows = []
    for p in ctx.patients:
        a = ctx.active_by_patient.get(p.id)
        bed = ctx.bed_by_id.get(a.bed_id) if a and a.bed_id else None
        st = patient_stage(p)
        since = {"WAITING": p.created_at, "MATCHING": p.match_started_at, "ALLOCATED": a.assigned_at if a else None,
                 "ADMITTED": (a.admitted_at or a.assigned_at) if a else None}.get(st, p.updated_at) or p.updated_at
        rows.append({"p": p, "a": a, "bed": bed, "stage": st, "since": since})
    board = [r for r in rows if r["stage"] != "CLOSED"]
    totals = {st: 0 for st in FLOW_STAGES}
    longest = {st: 0 for st in FLOW_STAGES}
    for r in board:
        totals[r["stage"]] += 1
        longest[r["stage"]] = max(longest[r["stage"]], minutes_since(r["since"], ref))
    searching = [r for r in board if r["stage"] in ("WAITING", "MATCHING")]
    today = ref.date()
    stats = {
        "longest_minutes": longest,
        "no_fit": {st: sum(1 for r in searching if r["stage"] == st and fit_of(r["p"]) == 0) for st in ("WAITING", "MATCHING")},
        "urgent_waiting": sum(1 for r in searching if r["p"].priority == "URGENT"),
        "released_today": sum(1 for r in rows if r["stage"] == "CLOSED" and r["p"].updated_at.date() == today),
        "total_patients": len(ctx.patients),
    }

    def keep(r) -> bool:  # noqa: ANN001
        p, bed = r["p"], r["bed"]
        if q and q not in p.patient_code.lower() and q not in p.display_name.lower() and not (bed and q in bed.bed_code.lower()):
            return False
        if care_category and p.care_category != care_category:
            return False
        if bed_type and p.required_bed_type != bed_type:
            return False
        if priority and p.priority != priority:
            return False
        if ward_id not in (None, "") and not (bed and bed.ward_id == int(ward_id)):
            return False
        return True

    filtered = [r for r in board if keep(r)]
    fcounts = {st: sum(1 for r in filtered if r["stage"] == st) for st in FLOW_STAGES}

    def sort_rows(lst, st):  # noqa: ANN001
        if st in ("WAITING", "MATCHING"):
            return sorted(lst, key=lambda r: (PRIORITY_RANK[r["p"].priority], r["since"], r["p"].id))
        return sorted(lst, key=lambda r: (r["since"], r["p"].id))

    def card(r) -> dict:  # noqa: ANN001
        p, bed, a = r["p"], r["bed"], r["a"]
        ward = ctx.ward_by_id.get(bed.ward_id) if bed else None
        return {
            "id": p.id, "patient_code": p.patient_code, "display_name": p.display_name, "care_category": p.care_category,
            "priority": p.priority, "required_bed_type": p.required_bed_type, "required_equipment_types": p.required_equipment_types or [],
            "required_bed_features": p.required_bed_features or [], "status": p.status, "stage": r["stage"], "since": iso(r["since"]),
            "minutes": minutes_since(r["since"], ref), "is_demo": p.is_demo, "bed_id": bed.id if bed else None,
            "bed_code": bed.bed_code if bed else None, "ward_id": ward.id if ward else None, "ward_name": ward.name if ward else None,
            "allocation_id": a.id if a else None, "allocation_source": a.source if a else None,
            "fit_count": fit_of(p) if r["stage"] in ("WAITING", "MATCHING") else None,
        }

    out: dict = {"totals": totals, "filtered_counts": fcounts, "stats": stats}
    if stage:
        require_one_of(stage, FLOW_STAGES, "Stage")
        size = require_int(page_size, "Page size", 1, 200)
        lst = sort_rows([r for r in filtered if r["stage"] == stage], stage)
        pages = max(1, -(-len(lst) // size))
        pg = min(max(1, int(page or 1)), pages)
        out.update({"stage": stage, "page": pg, "pages": pages, "total": len(lst), "items": [card(r) for r in lst[(pg - 1) * size: pg * size]]})
    else:
        out["columns"] = {st: [card(r) for r in sort_rows([r for r in filtered if r["stage"] == st], st)[:per_column]] for st in FLOW_STAGES}
    return out


# ------------------------------------------------------------------ allocation
def recommendations(s: Session, pid, limit: int = 12, soft: bool = False) -> dict:
    ctx = Ctx(s)
    p = get_or_404(s, Patient, pid, "Patient")
    if p.status != "WAITING" and soft:
        # Polling clients (e.g. a panel open while the patient gets allocated) get a calm answer, not a 409.
        return {"patient_id": p.id, "patient_code": p.patient_code, "not_waiting": True, "status": p.status,
                "eligible_count": 0, "recommendations": [], "rejected_summary": []}
    if p.status != "WAITING":
        raise ApiError(409, "PATIENT_NOT_WAITING", f"{p.patient_code} is {p.status.lower()}, not waiting for a bed.")
    return {"patient_id": p.id, "patient_code": p.patient_code, **recommend_for(ctx, p, limit)}


def set_matching(s: Session, pid, on: bool) -> dict:
    ctx = Ctx(s)
    p = get_or_404(s, Patient, pid, "Patient")
    if p.status != "WAITING":
        raise ApiError(409, "PATIENT_NOT_WAITING", f"{p.patient_code} is {p.status.lower()}, not waiting for a bed.")
    if on and not p.match_started_at:
        p.match_started_at = p.updated_at = now()
        log(s, "MATCHING_STARTED", "patient", p.id, p.patient_code, f"Bed search started for {p.patient_code}")
    elif not on and p.match_started_at:
        p.match_started_at = None
        p.updated_at = now()
        log(s, "MATCHING_STOPPED", "patient", p.id, p.patient_code, f"Bed search paused for {p.patient_code}")
    return patient_view(ctx, p)


def bed_candidates(s: Session, bed_id) -> list[dict]:
    ctx = Ctx(s)
    bed = get_or_404(s, Bed, bed_id, "Bed")
    out = []
    for p in ctx.patients:
        if p.status != "WAITING":
            continue
        ev = evaluate_bed(ctx, bed, p)
        out.append({"patient_id": p.id, "patient_code": p.patient_code, "display_name": p.display_name, "priority": p.priority,
                    "required_bed_type": p.required_bed_type, "eligible": ev.eligible, "matches": ev.matches,
                    "unmet": [u["text"] for u in ev.unmet], "devices": ev.devices, "score": ev.score})
    out.sort(key=lambda x: (not x["eligible"], PRIORITY_RANK.get(x["priority"], 9), -x["score"], x["patient_code"]))
    return out


def allocate(s: Session, data: dict, source: str = "MANUAL") -> dict:
    """Confirm an allocation. Runs inside a BEGIN IMMEDIATE transaction and rechecks every rule."""
    ctx = Ctx(s)
    p = get_or_404(s, Patient, data.get("patient_id"), "Patient")
    bed = get_or_404(s, Bed, data.get("bed_id"), "Bed")
    if p.status != "WAITING" or p.id in ctx.active_by_patient:
        raise ApiError(409, "PATIENT_NOT_WAITING", f"{p.patient_code} is no longer waiting for a bed (status: {p.status.lower()}). Refresh and review.")
    ev = evaluate_bed(ctx, bed, p)
    status_issue = next((u for u in ev.unmet if u["key"] in ("status", "ward")), None)
    if status_issue:
        raise ApiError(409, "BED_UNAVAILABLE", f"{bed.bed_code} can't be allocated: {status_issue['text'].lower()}. Refresh and choose another bed.")
    mismatch = [u for u in ev.unmet if u["key"].startswith(("type:", "feature:"))]
    if mismatch:
        raise ApiError(422, "REQUIREMENT_MISMATCH",
                       f"{bed.bed_code} does not meet {p.patient_code}'s requirements: {'; '.join(u['text'] for u in mismatch)}.", {"unmet": mismatch})
    missing = [u for u in ev.unmet if u["key"].startswith("device:")]
    if missing:
        raise ApiError(409, "EQUIPMENT_UNAVAILABLE", "; ".join(u["text"] for u in missing) + ".", {"unmet": missing})

    ts = now()
    alloc = Allocation(patient_id=p.id, bed_id=bed.id, bed_code=bed.bed_code, status="ACTIVE", assigned_at=ts,
                       confirmed_by=clean(data.get("confirmed_by")) or "Demo staff", equipment_ids=[d["id"] for d in ev.devices],
                       source=source, match_score=float(ev.score))
    s.add(alloc)
    ctx.allocations.append(alloc)
    bed.status, bed.current_patient_id, bed.updated_at = "OCCUPIED", p.id, ts
    p.status, p.match_started_at, p.updated_at = "ALLOCATED", None, ts
    for d in ev.devices:
        e = ctx.equipment_by_id[d["id"]]
        e.status, e.assigned_bed_id, e.updated_at = "IN_USE", bed.id, ts
    ward = ctx.ward_by_id[bed.ward_id]
    with_devs = f" with {', '.join(d['equipment_code'] for d in ev.devices)}" if ev.devices else ""
    via = " via AI plan" if source == "AI_PLAN" else ""
    try:
        s.flush()
    except IntegrityError:
        raise ApiError(409, "CONFLICT", f"{bed.bed_code} was just allocated by someone else. Refresh and choose another bed.") from None
    log(s, "ALLOCATED", "bed", bed.id, bed.bed_code, f"{bed.bed_code} ({ward.name}) allocated to {p.patient_code}{with_devs}{via}",
        {"patient_id": p.id, "allocation_id": alloc.id, "score": ev.score, "source": source})
    check_integrity(ctx)
    return {**allocation_view(ctx, alloc), "devices": ev.devices}


def admit(s: Session, alloc_id) -> dict:
    ctx = Ctx(s)
    a = get_or_404(s, Allocation, alloc_id, "Allocation")
    if a.status != "ACTIVE":
        raise ApiError(409, "NOT_ACTIVE", "This allocation is no longer active.")
    p = ctx.patient_by_id[a.patient_id]
    if p.status != "ALLOCATED" or a.admitted_at:
        raise ApiError(409, "ALREADY_ADMITTED", f"{p.patient_code} is already admitted.")
    bed = ctx.bed_by_id[a.bed_id]
    ts = now()
    a.admitted_at = ts
    p.status, p.updated_at = "ADMITTED", ts
    log(s, "ADMITTED", "patient", p.id, p.patient_code, f"{p.patient_code} admitted to {bed.bed_code}", {"allocation_id": a.id})
    check_integrity(ctx)
    return {"allocation_id": a.id, "patient_code": p.patient_code, "bed_code": bed.bed_code}


def _free_devices(ctx: Ctx, bed: Bed, ts) -> None:  # noqa: ANN001
    for e in ctx.equipment:
        if e.assigned_bed_id == bed.id:
            e.status, e.assigned_bed_id, e.updated_at = "AVAILABLE", None, ts


def cancel(s: Session, alloc_id) -> dict:
    ctx = Ctx(s)
    a = get_or_404(s, Allocation, alloc_id, "Allocation")
    if a.status != "ACTIVE":
        raise ApiError(409, "NOT_ACTIVE", "This allocation is no longer active.")
    p = ctx.patient_by_id[a.patient_id]
    if a.admitted_at or p.status == "ADMITTED":
        raise ApiError(409, "ALREADY_ADMITTED", f"{p.patient_code} has already been admitted. Use discharge or transfer instead.")
    bed = ctx.bed_by_id[a.bed_id]
    ts = now()
    a.status, a.released_at, a.outcome = "CANCELLED", ts, "CANCELLED"
    bed.status, bed.current_patient_id, bed.updated_at = "AVAILABLE", None, ts
    p.status, p.match_started_at, p.updated_at = "WAITING", None, ts
    _free_devices(ctx, bed, ts)
    log(s, "ALLOCATION_CANCELLED", "bed", bed.id, bed.bed_code, f"Allocation of {bed.bed_code} to {p.patient_code} cancelled; bed available again",
        {"patient_id": p.id, "allocation_id": a.id})
    check_integrity(ctx)
    return {"allocation_id": a.id, "patient_code": p.patient_code, "bed_code": bed.bed_code}


def release(s: Session, alloc_id, outcome: str = "DISCHARGED") -> dict:
    ctx = Ctx(s)
    a = get_or_404(s, Allocation, alloc_id, "Allocation")
    if a.status != "ACTIVE":
        raise ApiError(409, "NOT_ACTIVE", "This allocation has already been released.")
    require_one_of(outcome, ["DISCHARGED", "TRANSFERRED"], "Outcome")
    bed = ctx.bed_by_id[a.bed_id]
    p = ctx.patient_by_id[a.patient_id]
    ts = now()
    nxt = "CLEANING" if ctx.settings.get("release_to_cleaning", True) else "AVAILABLE"
    a.status, a.released_at, a.outcome = "RELEASED", ts, outcome
    if not a.admitted_at:
        a.admitted_at = ts
    bed.status, bed.current_patient_id, bed.updated_at = nxt, None, ts
    p.status, p.updated_at = outcome, ts
    _free_devices(ctx, bed, ts)
    log(s, "RELEASED", "bed", bed.id, bed.bed_code, f"{bed.bed_code} released ({p.patient_code} {outcome.lower()}); bed → {nxt.lower()}",
        {"patient_id": p.id, "allocation_id": a.id})
    check_integrity(ctx)
    return {"allocation_id": a.id, "bed_code": bed.bed_code, "bed_status": nxt, "patient_code": p.patient_code, "outcome": outcome}


def list_allocations(s: Session, status=None, limit: int = 50) -> list[dict]:
    ctx = Ctx(s)
    rows = [a for a in ctx.allocations if not status or a.status == status]
    rows.sort(key=lambda a: a.released_at or a.assigned_at, reverse=True)
    return [allocation_view(ctx, a) for a in rows[:limit]]
