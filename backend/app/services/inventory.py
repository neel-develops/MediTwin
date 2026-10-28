"""Wards, beds and equipment."""
from __future__ import annotations

from sqlalchemy.orm import Session

from ..constants import (BED_FEATURES, BED_STATUSES, BED_TYPES, DEVICE_PREFIX, DEVICE_TYPES, MANUAL_TRANSITIONS,
                         QUANTITY_TYPES, WARD_CATEGORIES)
from ..errors import ApiError, validation
from ..models import Bed, Equipment, Ward
from .common import (bed_code, clean, derive_prefix, get_or_404, iso, log, now, require_int, require_one_of,
                     require_prefix, require_text, subset_of)
from .rules import Ctx, bed_counts, integrity_problems


def check_integrity(ctx: Ctx) -> None:
    ctx.s.flush()
    ctx.reindex()
    problems = integrity_problems(ctx)
    if problems:
        raise ApiError(500, "INTEGRITY", f"Change rejected to protect data consistency: {problems[0]}", {"problems": problems})


# ------------------------------------------------------------------ views
def ward_view(ctx: Ctx, w: Ward) -> dict:
    beds = [b for b in ctx.beds if b.ward_id == w.id]
    counts = bed_counts(beds)
    n = len(beds)
    return {
        "id": w.id, "name": w.name, "category": w.category, "bed_code_prefix": w.bed_code_prefix, "is_active": w.is_active,
        "bed_count": n, "counts": counts,
        "occupancy_pct": round(counts["OCCUPIED"] / n * 100) if n else 0,
        "available_pct": round(counts["AVAILABLE"] / n * 100) if n else 0,
        "bed_types": sorted({b.bed_type for b in beds}),
        "created_at": iso(w.created_at), "updated_at": iso(w.updated_at),
    }


def bed_view(ctx: Ctx, b: Bed) -> dict:
    ward = ctx.ward_by_id.get(b.ward_id)
    p = ctx.patient_by_id.get(b.current_patient_id) if b.current_patient_id else None
    return {
        "id": b.id, "bed_code": b.bed_code, "seq_no": b.seq_no, "ward_id": b.ward_id, "ward_name": ward.name if ward else "",
        "bed_type": b.bed_type, "status": b.status, "features": b.features or [], "notes": b.notes or "",
        "current_patient_id": b.current_patient_id, "patient_code": p.patient_code if p else None,
        "patient_name": p.display_name if p else None,
        "created_at": iso(b.created_at), "updated_at": iso(b.updated_at),
    }


def equipment_view(ctx: Ctx, e: Equipment) -> dict:
    ward = ctx.ward_by_id.get(e.ward_id) if e.ward_id else None
    bed = ctx.bed_by_id.get(e.assigned_bed_id) if e.assigned_bed_id else None
    return {
        "id": e.id, "equipment_code": e.equipment_code, "equipment_type": e.equipment_type, "tracking_mode": e.tracking_mode,
        "status": e.status, "ward_id": e.ward_id, "ward_name": ward.name if ward else "Shared pool",
        "assigned_bed_id": e.assigned_bed_id, "bed_code": bed.bed_code if bed else None, "bed_ward_id": bed.ward_id if bed else None,
        "quantity_total": e.quantity_total, "quantity_available": e.quantity_available, "notes": e.notes or "",
        "created_at": iso(e.created_at), "updated_at": iso(e.updated_at),
    }


# ------------------------------------------------------------------ wards
def list_wards(s: Session, include_inactive: bool = True) -> list[dict]:
    ctx = Ctx(s)
    return [ward_view(ctx, w) for w in ctx.wards if include_inactive or w.is_active]


def get_ward(s: Session, ward_id) -> dict:
    ctx = Ctx(s)
    return ward_view(ctx, get_or_404(s, Ward, ward_id, "Ward"))


def _resize(ctx: Ctx, ward: Ward, count: int, bed_type: str, features: list[str]) -> tuple[list[str], list[str]]:
    beds = ctx.ward_beds(ward.id)
    added: list[str] = []
    removed: list[str] = []
    if count > len(beds):
        n = beds[-1].seq_no if beds else 0
        ts = now()
        for _ in range(len(beds), count):
            n += 1
            b = Bed(bed_code=bed_code(ward.bed_code_prefix, n), seq_no=n, ward_id=ward.id, bed_type=bed_type, status="AVAILABLE",
                    features=list(features), notes="", created_at=ts, updated_at=ts)
            ctx.s.add(b)
            ctx.beds.append(b)
            added.append(b.bed_code)
    elif count < len(beds):
        to_remove = beds[count:]
        blocked = [b for b in to_remove if b.status == "OCCUPIED" or b.id in ctx.active_by_bed]
        if blocked:
            codes = ", ".join(b.bed_code for b in blocked[:8]) + ("…" if len(blocked) > 8 else "")
            raise ApiError(409, "UNSAFE_REDUCTION",
                           f"Cannot reduce {ward.name} to {count} beds: {len(blocked)} of the beds that would be removed have patients "
                           f"({codes}). Release or move those patients first.", {"blocked": [b.bed_code for b in blocked]})
        for b in to_remove:
            for e in ctx.equipment:
                if e.assigned_bed_id == b.id:
                    e.assigned_bed_id = None
            ctx.s.delete(b)
            ctx.beds.remove(b)
            removed.append(b.bed_code)
    return added, removed


def create_ward(s: Session, data: dict) -> dict:
    ctx = Ctx(s)
    name = require_text(data.get("name"), "Ward name", 60)
    if any(w.name.lower() == name.lower() for w in ctx.wards):
        raise ApiError(409, "DUPLICATE", f'A ward named "{name}" already exists.')
    prefix = require_prefix(clean(data.get("bed_code_prefix")) or derive_prefix(name))
    if any(w.bed_code_prefix == prefix for w in ctx.wards):
        raise ApiError(409, "DUPLICATE", f'Bed code prefix "{prefix}" is already used by another ward.')
    count = require_int(data.get("bed_count") if data.get("bed_count") is not None else 0, "Bed count", 0, 500)
    bed_type = require_one_of(data.get("bed_type") or "General", BED_TYPES, "Bed type")
    features = subset_of(data.get("features"), BED_FEATURES, "Bed features")
    category = require_one_of(data.get("category"), WARD_CATEGORIES, "Category") if data.get("category") else "Other"
    ts = now()
    ward = Ward(name=name, name_key=name.lower(), category=category, bed_code_prefix=prefix, is_active=True,
                sort_order=max([w.sort_order for w in ctx.wards] + [0]) + 1, created_at=ts, updated_at=ts)
    s.add(ward)
    s.flush()
    ctx.wards.append(ward)
    added, _ = _resize(ctx, ward, count, bed_type, features)
    rng = f"{prefix}-001" + (f" to {bed_code(prefix, count)}" if count > 1 else "")
    log(s, "WARD_CREATED", "ward", ward.id, ward.name, f"{ward.name} created with {count} beds ({rng})", {"added": len(added)})
    check_integrity(ctx)
    return ward_view(ctx, ward)


def update_ward(s: Session, ward_id, patch: dict) -> dict:
    ctx = Ctx(s)
    ward = get_or_404(s, Ward, ward_id, "Ward")
    changes: list[str] = []
    if patch.get("name") is not None:
        name = require_text(patch["name"], "Ward name", 60)
        if any(w.id != ward.id and w.name.lower() == name.lower() for w in ctx.wards):
            raise ApiError(409, "DUPLICATE", f'A ward named "{name}" already exists.')
        if name != ward.name:
            changes.append(f"renamed to {name}")
            ward.name, ward.name_key = name, name.lower()
    if patch.get("category") is not None:
        ward.category = require_one_of(patch["category"], WARD_CATEGORIES, "Category")
    if patch.get("bed_code_prefix") is not None:
        prefix = require_prefix(patch["bed_code_prefix"])
        if prefix != ward.bed_code_prefix:
            if any(w.id != ward.id and w.bed_code_prefix == prefix for w in ctx.wards):
                raise ApiError(409, "DUPLICATE", f'Bed code prefix "{prefix}" is already used by another ward.')
            ward.bed_code_prefix = prefix
            beds = ctx.ward_beds(ward.id)
            for b in beds:  # two passes avoid transient unique-code clashes
                b.bed_code = f"~{b.id}"
            s.flush()
            for b in beds:
                b.bed_code = bed_code(prefix, b.seq_no)
                b.updated_at = now()
            changes.append(f"bed codes now use prefix {prefix}")
    if patch.get("is_active") is not None and bool(patch["is_active"]) != ward.is_active:
        if not patch["is_active"]:
            busy = [b for b in ctx.beds if b.ward_id == ward.id and b.id in ctx.active_by_bed]
            if busy:
                raise ApiError(409, "WARD_IN_USE", f"Cannot deactivate {ward.name}: {len(busy)} bed(s) have active allocations. Release those patients first.")
        ward.is_active = bool(patch["is_active"])
        changes.append("reactivated" if ward.is_active else "deactivated")
    ward.updated_at = now()
    if changes:
        log(s, "WARD_UPDATED", "ward", ward.id, ward.name, f"{ward.name}: {', '.join(changes)}")
    check_integrity(ctx)
    return ward_view(ctx, ward)


def generate_beds(s: Session, ward_id, data: dict) -> dict:
    ctx = Ctx(s)
    ward = get_or_404(s, Ward, ward_id, "Ward")
    count = require_int(data.get("count"), "Bed count", 0, 500)
    bed_type = require_one_of(data.get("bed_type") or "General", BED_TYPES, "Bed type")
    features = subset_of(data.get("features"), BED_FEATURES, "Bed features")
    before = len(ctx.ward_beds(ward.id))
    added, removed = _resize(ctx, ward, count, bed_type, features)
    ward.updated_at = now()
    if added or removed:
        msg = f"{ward.name} bed count {before} → {count}"
        if added:
            msg += f" (added {added[0]}–{added[-1]})"
        if removed:
            msg += f" (removed {removed[0]}–{removed[-1]})"
        log(s, "BEDS_GENERATED", "ward", ward.id, ward.name, msg, {"added": added, "removed": removed})
    check_integrity(ctx)
    return {**ward_view(ctx, ward), "added": added, "removed": removed}


def preview_reduction(s: Session, ward_id, count: int) -> dict:
    ctx = Ctx(s)
    ward = get_or_404(s, Ward, ward_id, "Ward")
    to_remove = ctx.ward_beds(ward.id)[max(0, count):]
    return {"remove": [{"bed_code": b.bed_code, "status": b.status} for b in to_remove],
            "blocked": [b.bed_code for b in to_remove if b.status == "OCCUPIED"]}


# ------------------------------------------------------------------ beds
def list_beds(s: Session, ward_id=None, status=None, bed_type=None, search=None) -> list[dict]:
    ctx = Ctx(s)
    q = clean(search).lower()
    order = {w.id: i for i, w in enumerate(ctx.wards)}
    active = ctx.active_ward_ids
    out = []
    for b in ctx.beds:
        if ward_id not in (None, ""):
            if b.ward_id != int(ward_id):
                continue
        elif b.ward_id not in active:
            continue
        if status and b.status != status:
            continue
        if bed_type and b.bed_type != bed_type:
            continue
        if q and q not in b.bed_code.lower():
            continue
        out.append(b)
    out.sort(key=lambda b: (order.get(b.ward_id, 0), b.seq_no))
    return [bed_view(ctx, b) for b in out]


def get_bed(s: Session, bed_id) -> dict:
    ctx = Ctx(s)
    bed = get_or_404(s, Bed, bed_id, "Bed")
    ward = ctx.ward_by_id.get(bed.ward_id)
    alloc = ctx.active_by_bed.get(bed.id)
    patient = ctx.patient_by_id.get(bed.current_patient_id) if bed.current_patient_id else None
    devices = [equipment_view(ctx, e) for e in ctx.equipment if e.assigned_bed_id == bed.id]
    idx = next((i for i, b in enumerate(ctx.ward_beds(bed.ward_id)) if b.id == bed.id), 0)
    from .patients import allocation_view, patient_view  # local import avoids a cycle

    return {
        **bed_view(ctx, bed), "ward_active": ward.is_active if ward else False, "ward_category": ward.category if ward else "",
        "index_in_ward": idx, "allocation": allocation_view(ctx, alloc) if alloc else None,
        "patient": patient_view(ctx, patient) if patient else None, "devices": devices,
        "allowed_transitions": MANUAL_TRANSITIONS.get(bed.status, []),
    }


def update_bed_status(s: Session, bed_id, data: dict) -> dict:
    ctx = Ctx(s)
    bed = get_or_404(s, Bed, bed_id, "Bed")
    to = require_one_of(data.get("status"), BED_STATUSES, "Status")
    if to == bed.status:
        raise ApiError(409, "NO_CHANGE", f"{bed.bed_code} is already {to.lower()}.")
    if bed.status == "OCCUPIED":
        raise ApiError(409, "INVALID_TRANSITION", f"{bed.bed_code} is occupied. Release the patient through the allocation workflow first.")
    if to == "OCCUPIED":
        raise ApiError(409, "INVALID_TRANSITION", "Beds become occupied only by confirming a patient allocation.")
    if to not in MANUAL_TRANSITIONS[bed.status]:
        raise ApiError(409, "INVALID_TRANSITION", f"Cannot change {bed.bed_code} from {bed.status.lower()} to {to.lower()}.")
    frm = bed.status
    bed.status = to
    bed.updated_at = now()
    log(s, "BED_STATUS", "bed", bed.id, bed.bed_code, f"{bed.bed_code} {frm.lower()} → {to.lower()}", {"from": frm, "to": to})
    check_integrity(ctx)
    return bed_view(ctx, bed)


def bulk_bed_status(s: Session, data: dict) -> dict:
    """Move every bed in the given list (or ward + from-status) to a new status, skipping ineligible beds."""
    ctx = Ctx(s)
    to = require_one_of(data.get("status"), BED_STATUSES, "Status")
    frm = data.get("from_status")
    ward_id = data.get("ward_id")
    ids = data.get("bed_ids")
    targets = [b for b in ctx.beds if (ids is None or b.id in set(ids)) and (not frm or b.status == frm)
               and (ward_id in (None, "") or b.ward_id == int(ward_id))]
    changed = [b for b in targets if b.status != "OCCUPIED" and to != "OCCUPIED" and to in MANUAL_TRANSITIONS[b.status]]
    ts = now()
    for b in changed:
        b.status = to
        b.updated_at = ts
    if changed:
        log(s, "BED_STATUS_BULK", "bed", None, f"{len(changed)} beds",
            f"{len(changed)} bed{'s' if len(changed) != 1 else ''} → {to.lower()} ({', '.join(b.bed_code for b in changed[:6])}{'…' if len(changed) > 6 else ''})",
            {"to": to, "beds": [b.bed_code for b in changed]})
    check_integrity(ctx)
    return {"changed": len(changed), "skipped": len(targets) - len(changed), "bed_codes": [b.bed_code for b in changed]}


def update_bed(s: Session, bed_id, patch: dict) -> dict:
    ctx = Ctx(s)
    bed = get_or_404(s, Bed, bed_id, "Bed")
    changing_spec = patch.get("bed_type") is not None or patch.get("features") is not None
    if changing_spec and bed.status == "OCCUPIED":
        raise ApiError(409, "BED_OCCUPIED", f"Cannot change the type or features of {bed.bed_code} while it is occupied.")
    if patch.get("bed_type") is not None:
        bed.bed_type = require_one_of(patch["bed_type"], BED_TYPES, "Bed type")
    if patch.get("features") is not None:
        bed.features = subset_of(patch["features"], BED_FEATURES, "Bed features")
    if patch.get("notes") is not None:
        bed.notes = clean(patch["notes"])[:300]
    bed.updated_at = now()
    feats = ", ".join(bed.features or [])
    log(s, "BED_UPDATED", "bed", bed.id, bed.bed_code, f"{bed.bed_code} details updated ({bed.bed_type}{', ' + feats if feats else ''})")
    check_integrity(ctx)
    return bed_view(ctx, bed)


# ------------------------------------------------------------------ equipment
def _ward_ref(ctx: Ctx, value) -> int | None:
    if value in (None, "", "pool"):
        return None
    return get_or_404(ctx.s, Ward, value, "Ward").id


def list_equipment(s: Session, ward_id=None, status=None, type=None, search=None, tracking_mode=None) -> list[dict]:  # noqa: A002
    ctx = Ctx(s)
    q = clean(search).lower()
    out = []
    for e in ctx.equipment:
        if ward_id not in (None, ""):
            if ward_id == "pool":
                if e.ward_id is not None:
                    continue
            elif e.ward_id != int(ward_id):
                continue
        if status and e.status != status:
            continue
        if type and e.equipment_type != type:
            continue
        if tracking_mode and e.tracking_mode != tracking_mode:
            continue
        if q and q not in e.equipment_code.lower() and q not in e.equipment_type.lower():
            continue
        out.append(equipment_view(ctx, e))
    return out


def get_equipment(s: Session, eq_id) -> dict:
    ctx = Ctx(s)
    return equipment_view(ctx, get_or_404(s, Equipment, eq_id, "Equipment"))


def create_equipment(s: Session, data: dict) -> dict:
    ctx = Ctx(s)
    mode = require_one_of(data.get("tracking_mode") or "INDIVIDUAL", ["INDIVIDUAL", "QUANTITY"], "Tracking mode")
    ward_id = _ward_ref(ctx, data.get("ward_id"))
    ts = now()
    codes = {e.equipment_code for e in ctx.equipment}
    if mode == "INDIVIDUAL":
        dtype = require_one_of(data.get("equipment_type"), DEVICE_TYPES, "Equipment type")
        code = clean(data.get("equipment_code")).upper()
        if code:
            import re

            if not re.fullmatch(r"[A-Z0-9-]{2,16}", code):
                raise validation("Equipment code must be 2–16 letters, digits or dashes.", "equipment_code")
            if code in codes:
                raise ApiError(409, "DUPLICATE", f"Equipment code {code} already exists.")
        else:
            n = sum(1 for e in ctx.equipment if e.equipment_type == dtype) + 1
            while f"{DEVICE_PREFIX[dtype]}-{n:03d}" in codes:
                n += 1
            code = f"{DEVICE_PREFIX[dtype]}-{n:03d}"
        e = Equipment(equipment_code=code, equipment_type=dtype, tracking_mode=mode, status="AVAILABLE", ward_id=ward_id,
                      notes=clean(data.get("notes"))[:300], created_at=ts, updated_at=ts)
    else:
        dtype = require_one_of(data.get("equipment_type"), QUANTITY_TYPES, "Equipment type")
        if any(x.tracking_mode == "QUANTITY" and x.equipment_type == dtype and x.ward_id == ward_id for x in ctx.equipment):
            raise ApiError(409, "DUPLICATE", f"{dtype} stock already exists for this location — edit its quantity instead.")
        total = require_int(data.get("quantity_total"), "Quantity", 0, 10000)
        ward_part = "POOL" if ward_id is None else ctx.ward_by_id[ward_id].bed_code_prefix
        code = f"QTY-{''.join(c for c in dtype if c.isalpha())[:3].upper()}-{ward_part}"
        e = Equipment(equipment_code=code, equipment_type=dtype, tracking_mode=mode, status="AVAILABLE", ward_id=ward_id,
                      quantity_total=total, quantity_available=total, notes=clean(data.get("notes"))[:300], created_at=ts, updated_at=ts)
    s.add(e)
    s.flush()
    ctx.equipment.append(e)
    log(s, "EQUIPMENT_ADDED", "equipment", e.id, e.equipment_code,
        f"{e.equipment_type} {e.equipment_code} added to inventory" if mode == "INDIVIDUAL" else f"{e.equipment_type} stock added ({e.quantity_total})")
    check_integrity(ctx)
    return equipment_view(ctx, e)


def update_equipment(s: Session, eq_id, patch: dict) -> dict:
    ctx = Ctx(s)
    e = get_or_404(s, Equipment, eq_id, "Equipment")
    changes: list[str] = []
    if e.tracking_mode == "INDIVIDUAL":
        status_change = patch.get("status") is not None and patch["status"] != e.status
        if (status_change or "ward_id" in patch) and e.status == "IN_USE":
            bed = ctx.bed_by_id.get(e.assigned_bed_id)
            raise ApiError(409, "EQUIPMENT_IN_USE", f"{e.equipment_code} is in use at bed {bed.bed_code if bed else '?'}. Release that allocation first.")
        if status_change:
            to = require_one_of(patch["status"], ["AVAILABLE", "RESERVED", "MAINTENANCE"], "Status")
            changes.append(f"{e.status.lower()} → {to.lower()}")
            e.status = to
        if "ward_id" in patch:
            wid = _ward_ref(ctx, patch["ward_id"])
            if wid != e.ward_id:
                e.ward_id = wid
                changes.append("moved to " + ("shared pool" if wid is None else ctx.ward_by_id[wid].name))
    else:
        total = require_int(patch["quantity_total"], "Total quantity", 0, 10000) if patch.get("quantity_total") is not None else e.quantity_total
        avail = require_int(patch["quantity_available"], "Available quantity", 0, 10000) if patch.get("quantity_available") is not None else e.quantity_available
        if avail > total:
            raise validation("Available quantity cannot exceed total quantity.", "quantity_available")
        if total != e.quantity_total or avail != e.quantity_available:
            changes.append(f"{avail}/{total} available")
        e.quantity_total, e.quantity_available = total, avail
    if patch.get("notes") is not None:
        e.notes = clean(patch["notes"])[:300]
    e.updated_at = now()
    log(s, "EQUIPMENT_UPDATED", "equipment", e.id, e.equipment_code,
        f"{e.equipment_type} {e.equipment_code}" + (": " + ", ".join(changes) if changes else " updated"))
    check_integrity(ctx)
    return equipment_view(ctx, e)
