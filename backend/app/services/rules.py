"""Allocation rules: eligibility, explainable match scoring, recommendations and integrity checks.

Everything here is *resource compatibility*, never a clinical assessment. A bed is
eligible only if its ward is active, it is AVAILABLE with no active allocation, its type
matches (or is configured as compatible), it has every required bed feature, and each
required device type has an AVAILABLE unit in the bed's ward or the shared pool.

Eligible beds are ranked by the MediTwin AI match score (0–100), built from transparent
factors that staff can read in the UI.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from ..constants import ACTIVE_PATIENT, BED_STATUSES, CARE_WARD_FIT
from ..models import Allocation, Bed, Equipment, Patient, Ward
from .common import all_rows, get_settings

# How costly it is to "spend" a special bed feature on a patient who doesn't need it.
FEATURE_WEIGHT = {"Isolation Capable": 7.0, "Bariatric": 6.0, "Suction": 4.0, "Oxygen Outlet": 2.0}


class Ctx:
    """An in-memory view of the hospital loaded inside one session/transaction."""

    def __init__(self, s: Session):
        self.s = s
        self.settings = get_settings(s)
        self.wards: list[Ward] = all_rows(s, Ward, Ward.sort_order, Ward.id)
        self.beds: list[Bed] = all_rows(s, Bed, Bed.ward_id, Bed.seq_no)
        self.equipment: list[Equipment] = all_rows(s, Equipment, Equipment.equipment_code)
        self.patients: list[Patient] = all_rows(s, Patient, Patient.id)
        self.allocations: list[Allocation] = all_rows(s, Allocation, Allocation.id)
        self.reindex()

    def reindex(self) -> None:
        self.ward_by_id = {w.id: w for w in self.wards}
        self.bed_by_id = {b.id: b for b in self.beds}
        self.patient_by_id = {p.id: p for p in self.patients}
        self.equipment_by_id = {e.id: e for e in self.equipment}
        self.active_by_bed: dict[int, Allocation] = {}
        self.active_by_patient: dict[int, Allocation] = {}
        for a in self.allocations:
            if a.status == "ACTIVE":
                if a.bed_id is not None:
                    self.active_by_bed[a.bed_id] = a
                self.active_by_patient[a.patient_id] = a
        self._ward_occ: dict[int, float] | None = None
        self._feature_scarcity: dict[str, float] | None = None

    @property
    def active_ward_ids(self) -> set[int]:
        return {w.id for w in self.wards if w.is_active}

    def ward_beds(self, ward_id: int) -> list[Bed]:
        return sorted((b for b in self.beds if b.ward_id == ward_id), key=lambda b: b.seq_no)

    def ward_occupancy(self, ward_id: int) -> float:
        if self._ward_occ is None:
            tot: dict[int, int] = defaultdict(int)
            occ: dict[int, int] = defaultdict(int)
            for b in self.beds:
                tot[b.ward_id] += 1
                if b.status == "OCCUPIED":
                    occ[b.ward_id] += 1
            self._ward_occ = {wid: occ[wid] / tot[wid] for wid in tot}
        return self._ward_occ.get(ward_id, 0.0)

    def feature_scarcity(self, feature: str) -> float:
        """0 = every available bed has it, 1 = almost none do."""
        if self._feature_scarcity is None:
            avail = [b for b in self.beds if b.status == "AVAILABLE" and b.ward_id in self.active_ward_ids]
            n = max(1, len(avail))
            self._feature_scarcity = {f: 1 - sum(1 for b in avail if f in (b.features or [])) / n for f in FEATURE_WEIGHT}
        return self._feature_scarcity.get(feature, 0.5)

    def compatible_types(self, requested: str) -> list[str]:
        lst = (self.settings.get("bed_type_compat") or {}).get(requested)
        return lst if isinstance(lst, list) and lst else [requested]


@dataclass
class Evaluation:
    eligible: bool
    matches: list[str] = field(default_factory=list)
    unmet: list[dict] = field(default_factory=list)
    devices: list[dict] = field(default_factory=list)
    score: int = 0
    factors: list[dict] = field(default_factory=list)


def pick_device(ctx: Ctx, dtype: str, ward_id: int, exclude: set[int]) -> Equipment | None:
    best: Equipment | None = None
    for e in ctx.equipment:
        if (e.tracking_mode != "INDIVIDUAL" or e.equipment_type != dtype or e.status != "AVAILABLE"
                or e.assigned_bed_id is not None or e.id in exclude):
            continue
        if e.ward_id != ward_id and e.ward_id is not None:
            continue
        if e.ward_id == ward_id:
            return e  # list is sorted by code, so the first same-ward unit wins
        if best is None:
            best = e
    return best


def evaluate_bed(ctx: Ctx, bed: Bed, patient, taken_devices: set[int] | None = None,
                 assume_available: bool = False, compat_override: list[str] | None = None) -> Evaluation:
    """Explain whether one bed fits one patient, and score the fit.

    ``patient`` may be a Patient row or any object with the same requirement attributes
    (used by the surge simulation). ``assume_available`` evaluates a bed as if it were
    free — used by the AI to suggest which cleaning/reserved bed would unblock someone.
    """
    ward = ctx.ward_by_id.get(bed.ward_id)
    ev = Evaluation(eligible=False)
    taken = set(taken_devices or ())

    if ward is None or not ward.is_active:
        ev.unmet.append({"key": "ward", "text": "Ward is inactive"})
    if not assume_available:
        if bed.status != "AVAILABLE":
            ev.unmet.append({"key": "status", "text": f"Bed is {bed.status.lower()}"})
        elif bed.id in ctx.active_by_bed:
            ev.unmet.append({"key": "status", "text": "Bed already has an active allocation"})
        else:
            ev.matches.append("Bed is available")

    req_type = patient.required_bed_type
    compat = compat_override if compat_override is not None else ctx.compatible_types(req_type)
    type_pts = 0.0
    if bed.bed_type == req_type:
        ev.matches.append(f"Bed type matches ({req_type})")
        type_pts = 30
    elif bed.bed_type in compat:
        ev.matches.append(f"{bed.bed_type} bed is configured as compatible with {req_type}")
        type_pts = 20
    else:
        ev.unmet.append({"key": f"type:{req_type}", "text": f"Bed type {bed.bed_type} is not compatible with required {req_type}"})

    feats = bed.features or []
    req_feats = list(patient.required_bed_features or [])
    if req_type == "Isolation" and bed.bed_type != "Isolation" and "Isolation Capable" not in req_feats:
        req_feats.append("Isolation Capable")  # a substitute bed for an isolation request must be isolation-capable
    for f in req_feats:
        if f in feats:
            ev.matches.append(f"Has {f}")
        else:
            ev.unmet.append({"key": f"feature:{f}", "text": f"Missing bed feature: {f}"})

    dev_pts_each: list[float] = []
    for dtype in patient.required_equipment_types or []:
        d = pick_device(ctx, dtype, bed.ward_id, taken)
        if d:
            taken.add(d.id)
            same = d.ward_id == bed.ward_id
            ev.devices.append({"id": d.id, "equipment_code": d.equipment_code, "equipment_type": d.equipment_type,
                               "ward_id": d.ward_id, "same_ward": same})
            where = (ward.name if ward else "this ward") if same else "shared pool"
            ev.matches.append(f"{dtype} {d.equipment_code} available ({where})")
            dev_pts_each.append(1.0 if same else 0.6)
        else:
            ev.unmet.append({"key": f"device:{dtype}", "text": f"No available {dtype} in {ward.name if ward else 'this ward'} or the shared pool"})

    ev.eligible = not ev.unmet

    # ---- explainable match score (resource fit, not clinical)
    spare = [f for f in feats if f not in req_feats]
    waste = sum(FEATURE_WEIGHT.get(f, 2.0) * (0.5 + 0.5 * ctx.feature_scarcity(f)) for f in spare)
    preserve_pts = max(0.0, 15 - waste)
    equip_pts = 20 * (sum(dev_pts_each) / len(dev_pts_each)) if dev_pts_each else (20.0 if not patient.required_equipment_types else 0.0)
    fit_cats = CARE_WARD_FIT.get(getattr(patient, "care_category", "") or "", [])
    ward_fit_pts = 10.0 if ward and ward.category in fit_cats else 4.0
    load_pts = 5 * (1 - ctx.ward_occupancy(bed.ward_id))
    feat_pts = 20.0 if all(f in feats for f in req_feats) else 0.0
    ev.factors = [
        {"key": "type", "label": "Bed type", "points": round(type_pts, 1), "max": 30,
         "note": "Exact match" if type_pts == 30 else ("Compatible type" if type_pts else "Not compatible")},
        {"key": "features", "label": "Bed features", "points": feat_pts, "max": 20,
         "note": ("All required features" if req_feats else "No special features needed") if feat_pts else "Missing features"},
        {"key": "equipment", "label": "Equipment ready", "points": round(equip_pts, 1), "max": 20,
         "note": "No devices needed" if not patient.required_equipment_types else
         ("All devices in this ward" if dev_pts_each and min(dev_pts_each) == 1.0 else "Some devices from shared pool" if dev_pts_each else "Devices unavailable")},
        {"key": "preserve", "label": "Keeps scarce beds free", "points": round(preserve_pts, 1), "max": 15,
         "note": ("Uses no extra special features" if not spare else f"Would tie up {', '.join(spare)}")},
        {"key": "ward_fit", "label": "Ward suits care category", "points": ward_fit_pts, "max": 10,
         "note": f"{ward.category if ward else '—'} ward" + (" fits" if ward_fit_pts == 10 else " (other category)")},
        {"key": "load", "label": "Balances ward load", "points": round(load_pts, 1), "max": 5,
         "note": f"{round(ctx.ward_occupancy(bed.ward_id) * 100)}% occupied"},
    ]
    ev.score = int(round(type_pts + feat_pts + equip_pts + preserve_pts + ward_fit_pts + load_pts)) if ev.eligible else 0
    return ev


def bed_counts(beds) -> dict:
    c = {"total": 0, **{s: 0 for s in BED_STATUSES}}
    for b in beds:
        c["total"] += 1
        c[b.status] += 1
    return c


def summarize_rejections(ctx: Ctx, patient, evaluations: list[tuple[Bed, Evaluation]]) -> list[dict]:
    not_available = 0
    reasons: dict[str, int] = defaultdict(int)
    for _bed, ev in evaluations:
        if ev.eligible:
            continue
        if any(u["key"] == "status" for u in ev.unmet):
            not_available += 1
            continue
        for u in ev.unmet:
            k = u["key"]
            if k.startswith("type:"):
                label = f"Bed type not compatible with {patient.required_bed_type}"
            elif k.startswith("device:"):
                label = f"No available {k[7:]} for the bed's ward or the shared pool"
            else:
                label = u["text"]
            reasons[label] += 1
    out = []
    if not_available:
        out.append({"reason": "Not available (occupied, reserved, cleaning or maintenance)", "count": not_available})
    out.extend({"reason": r, "count": c} for r, c in reasons.items())
    out.sort(key=lambda x: -x["count"])
    return out


def recommendation_view(ctx: Ctx, bed: Bed, ev: Evaluation, rank: int) -> dict:
    ward = ctx.ward_by_id.get(bed.ward_id)
    return {
        "rank": rank, "bed_id": bed.id, "bed_code": bed.bed_code, "bed_type": bed.bed_type, "features": bed.features or [],
        "ward_id": bed.ward_id, "ward_name": ward.name if ward else "", "matches": ev.matches, "devices": ev.devices,
        "score": ev.score, "factors": ev.factors,
    }


def recommend_for(ctx: Ctx, patient, limit: int = 12) -> dict:
    active = ctx.active_ward_ids
    evals = [(b, evaluate_bed(ctx, b, patient)) for b in ctx.beds if b.ward_id in active]
    eligible = [(b, ev) for b, ev in evals if ev.eligible]
    eligible.sort(key=lambda x: (-x[1].score, x[0].bed_code))
    return {
        "eligible_count": len(eligible),
        "recommendations": [recommendation_view(ctx, b, ev, i + 1) for i, (b, ev) in enumerate(eligible[:limit])] if limit else [],
        "rejected_summary": summarize_rejections(ctx, patient, evals),
    }


def eligible_count(ctx: Ctx, patient) -> int:
    active = ctx.active_ward_ids
    return sum(1 for b in ctx.beds if b.ward_id in active and b.status == "AVAILABLE" and evaluate_bed(ctx, b, patient).eligible)


def patient_stage(p: Patient) -> str:
    if p.status == "WAITING":
        return "MATCHING" if p.match_started_at else "WAITING"
    if p.status in ACTIVE_PATIENT:
        return p.status
    return "CLOSED"


def integrity_problems(ctx: Ctx) -> list[str]:
    problems: list[str] = []

    def dupes(items, key, label):  # noqa: ANN001
        seen = set()
        for it in items:
            k = key(it)
            if k is None:
                continue
            if k in seen:
                problems.append(f"Duplicate {label}: {k}")
            seen.add(k)

    dupes(ctx.wards, lambda w: w.name.lower(), "ward name")
    dupes(ctx.wards, lambda w: w.bed_code_prefix, "ward bed-code prefix")
    dupes(ctx.beds, lambda b: b.bed_code, "bed code")
    dupes(ctx.patients, lambda p: p.patient_code, "patient code")
    dupes(ctx.equipment, lambda e: e.equipment_code, "equipment code")

    by_bed: dict[int, Allocation] = {}
    by_patient: dict[int, Allocation] = {}
    for a in ctx.allocations:
        if a.status != "ACTIVE":
            continue
        bed = ctx.bed_by_id.get(a.bed_id) if a.bed_id is not None else None
        pat = ctx.patient_by_id.get(a.patient_id)
        if a.bed_id in by_bed:
            problems.append(f"Bed {bed.bed_code if bed else a.bed_id} has more than one active allocation")
        if a.patient_id in by_patient:
            problems.append(f"Patient {pat.patient_code if pat else a.patient_id} has more than one active allocation")
        if a.bed_id is not None:
            by_bed[a.bed_id] = a
        by_patient[a.patient_id] = a
        if not bed or not pat:
            problems.append(f"Allocation {a.id} references a missing record")
            continue
        if bed.status != "OCCUPIED" or bed.current_patient_id != pat.id:
            problems.append(f"Bed {bed.bed_code} is not marked occupied by {pat.patient_code}")
        if pat.status not in ACTIVE_PATIENT:
            problems.append(f"Patient {pat.patient_code} has an active allocation but status {pat.status}")
    for b in ctx.beds:
        if b.status == "OCCUPIED" and b.id not in by_bed:
            problems.append(f"Bed {b.bed_code} is occupied without an active allocation")
        if b.status != "OCCUPIED" and b.current_patient_id is not None:
            problems.append(f"Bed {b.bed_code} has a patient but status {b.status}")
    for p in ctx.patients:
        a = by_patient.get(p.id)
        if p.status in ACTIVE_PATIENT and a is None:
            problems.append(f"Patient {p.patient_code} is {p.status.lower()} without an active allocation")
        if a and p.status == "ADMITTED" and not a.admitted_at:
            problems.append(f"Patient {p.patient_code} is admitted but the allocation has no admission time")
        if a and p.status == "ALLOCATED" and a.admitted_at:
            problems.append(f"Patient {p.patient_code} has an admission time but is not marked admitted")
    for e in ctx.equipment:
        if e.tracking_mode != "INDIVIDUAL":
            continue
        if e.status == "IN_USE":
            if e.assigned_bed_id not in by_bed:
                problems.append(f"Equipment {e.equipment_code} is in use without an active bed allocation")
        elif e.assigned_bed_id is not None:
            problems.append(f"Equipment {e.equipment_code} is assigned to a bed but status {e.status}")
    return problems
