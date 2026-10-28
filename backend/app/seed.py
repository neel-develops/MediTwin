"""Idempotent fictional demo data. Running it twice never duplicates wards, codes or patients."""
from __future__ import annotations

import random
from datetime import timedelta

from sqlalchemy.orm import Session

from .constants import DEVICE_PREFIX, TYPICAL_STAY_HOURS
from .models import Allocation, Bed, Equipment, Patient, Ward
from .services.common import ago, bed_code, log
from .services.rules import Ctx, pick_device

FIRST = ["Asha", "Ben", "Chloe", "Dev", "Elena", "Farid", "Grace", "Hiro", "Isla", "Jonah", "Kavya", "Liam", "Maya", "Noah", "Olu",
         "Priya", "Quinn", "Rosa", "Sami", "Tara", "Uma", "Vik", "Wren", "Yara", "Zane", "Leela", "Omar", "Nina", "Ravi", "Ines"]
LAST = ["Arden", "Bell", "Castillo", "Desai", "Ellis", "Fontaine", "Gupta", "Hale", "Ito", "Jensen", "Khan", "Lowe", "Mehta", "Novak",
        "Okafor", "Pereira", "Quill", "Rao", "Silva", "Thorne", "Usman", "Varga", "Walsh", "Yilmaz", "Zhou"]


def _w1(n: int) -> list[str]:
    f = []
    if n % 2:
        f.append("Oxygen Outlet")
    if n % 10 == 0:
        f.append("Suction")
    if n > 90:
        f.append("Isolation Capable")
    if n in (45, 46):
        f.append("Bariatric")
    return f


SEED_WARDS = [
    {"name": "Ward 1", "category": "General Ward", "prefix": "W1", "count": 100, "type": "General", "occ": 0.42, "features": _w1},
    {"name": "Ward 2", "category": "General Ward", "prefix": "W2", "count": 40, "type": "General", "occ": 0.5,
     "features": lambda n: ["Oxygen Outlet"] if n % 3 == 0 else []},
    {"name": "ICU", "category": "Critical Care", "prefix": "ICU", "count": 20, "type": "ICU", "occ": 0.72,
     "features": lambda n: ["Oxygen Outlet", "Suction"] + (["Isolation Capable"] if n <= 4 else [])},
    {"name": "Pediatrics", "category": "Paediatrics", "prefix": "PED", "count": 30, "type": "Pediatric", "occ": 0.4,
     "features": lambda n: ["Oxygen Outlet"] if n % 2 == 0 else []},
    {"name": "Maternity", "category": "Maternity", "prefix": "MAT", "count": 15, "type": "Maternity", "occ": 0.45,
     "features": lambda n: ["Oxygen Outlet"]},
]
# Fixed states that make the demo tell a story: the only free isolation-capable ICU bed (ICU-002) is
# first on the list, so first-come-first-served gives it to the urgent ventilator patient and strands
# P-9009, who needs it. The AI plans around that. One bariatric bed is free for P-9008.
SCENARIO = {"ICU-001": "OCCUPIED", "ICU-002": "AVAILABLE", "ICU-003": "OCCUPIED", "ICU-004": "OCCUPIED",
            "ICU-005": "AVAILABLE", "ICU-006": "AVAILABLE", "W1-045": "AVAILABLE", "W1-046": "OCCUPIED"}
CARE_FOR_TYPE = {"General": "General Medicine", "ICU": "Critical Care", "Pediatric": "Paediatrics", "Maternity": "Maternity", "Isolation": "Infectious Disease"}
WAITING = [
    {"code": "P-9001", "type": "General", "devs": ["Monitor"], "feats": ["Oxygen Outlet"], "care": "General Medicine", "priority": "HIGH", "match_ago": 9},
    {"code": "P-9002", "type": "General", "devs": [], "feats": [], "care": "Surgery Recovery", "priority": "ROUTINE"},
    {"code": "P-9003", "type": "ICU", "devs": ["Monitor", "Ventilator"], "feats": [], "care": "Critical Care", "priority": "URGENT", "match_ago": 4},
    {"code": "P-9004", "type": "Pediatric", "devs": ["Infusion Pump"], "feats": ["Oxygen Outlet"], "care": "Paediatrics", "priority": "HIGH"},
    {"code": "P-9005", "type": "Maternity", "devs": ["Monitor"], "feats": [], "care": "Maternity", "priority": "ROUTINE"},
    {"code": "P-9006", "type": "General", "devs": [], "feats": ["Isolation Capable"], "care": "Infectious Disease", "priority": "HIGH"},
    {"code": "P-9007", "type": "Isolation", "devs": ["Monitor"], "feats": [], "care": "Infectious Disease", "priority": "URGENT"},
    {"code": "P-9008", "type": "General", "devs": ["Infusion Pump"], "feats": ["Bariatric"], "care": "Surgery Recovery", "priority": "ROUTINE"},
    {"code": "P-9009", "type": "ICU", "devs": ["Monitor"], "feats": ["Isolation Capable"], "care": "Critical Care", "priority": "HIGH"},
    {"code": "P-9010", "type": "General", "devs": [], "feats": ["Oxygen Outlet"], "care": "General Medicine", "priority": "ROUTINE"},
    {"code": "P-9011", "type": "Pediatric", "devs": [], "feats": [], "care": "Paediatrics", "priority": "ROUTINE"},
    {"code": "P-9012", "type": "General", "devs": ["Monitor"], "feats": ["Suction"], "care": "Surgery Recovery", "priority": "HIGH"},
]


def seed_demo(s: Session) -> dict:
    ctx = Ctx(s)
    created = {"wards": 0, "beds": 0, "patients": 0, "equipment": 0}
    new_wards: list[tuple[Ward, dict, int]] = []

    for idx, sw in enumerate(SEED_WARDS, start=1):
        if any(w.name.lower() == sw["name"].lower() or w.bed_code_prefix == sw["prefix"] for w in ctx.wards):
            continue
        ts = ago(60 * 24 * 3)
        ward = Ward(name=sw["name"], name_key=sw["name"].lower(), category=sw["category"], bed_code_prefix=sw["prefix"], is_active=True,
                    sort_order=idx, created_at=ts, updated_at=ts)
        s.add(ward)
        s.flush()
        ctx.wards.append(ward)
        created["wards"] += 1
        for n in range(1, sw["count"] + 1):
            b = Bed(bed_code=bed_code(sw["prefix"], n), seq_no=n, ward_id=ward.id, bed_type=sw["type"], status="AVAILABLE",
                    features=sw["features"](n), notes="", created_at=ts, updated_at=ts)
            s.add(b)
            ctx.beds.append(b)
            created["beds"] += 1
        new_wards.append((ward, sw, idx))
    s.flush()
    ctx.reindex()

    ward_id = {w.name: w.id for w in ctx.wards}
    codes = {e.equipment_code for e in ctx.equipment}
    device_spec = [
        ("Monitor", 60, ["Ward 1", "Ward 1", "Ward 1", "Ward 2", "ICU", "ICU", "Pediatrics", "Maternity", None]),
        ("Ventilator", 14, ["ICU", "ICU", "ICU", None]),
        ("Infusion Pump", 40, ["Ward 1", "Ward 2", "ICU", "Pediatrics", "Maternity", None]),
    ]
    maintenance = {"MON-007", "MON-031", "VEN-013", "INF-022"}
    for dtype, total, rota in device_spec:
        for i in range(1, total + 1):
            code = f"{DEVICE_PREFIX[dtype]}-{i:03d}"
            if code in codes:
                continue
            wn = rota[(i - 1) % len(rota)]
            ts = ago(60 * 24 * 3)
            e = Equipment(equipment_code=code, equipment_type=dtype, tracking_mode="INDIVIDUAL",
                          status="MAINTENANCE" if code in maintenance else "AVAILABLE", ward_id=ward_id.get(wn) if wn else None,
                          notes="Scheduled service (demo)" if code in maintenance else "", created_at=ts, updated_at=ts)
            s.add(e)
            ctx.equipment.append(e)
            created["equipment"] += 1
    for dtype, total, avail in (("Wheelchair", 25, 18), ("Oxygen Cylinder", 40, 31), ("Stretcher", 10, 7)):
        code = f"QTY-{''.join(c for c in dtype if c.isalpha())[:3].upper()}-POOL"
        if code in codes:
            continue
        ts = ago(60 * 24 * 3)
        e = Equipment(equipment_code=code, equipment_type=dtype, tracking_mode="QUANTITY", status="AVAILABLE", ward_id=None,
                      quantity_total=total, quantity_available=avail, created_at=ts, updated_at=ts)
        s.add(e)
        ctx.equipment.append(e)
        created["equipment"] += 1
    s.flush()
    ctx.equipment.sort(key=lambda e: e.equipment_code)
    ctx.reindex()

    pcodes = {p.patient_code for p in ctx.patients}
    for ward, sw, idx in new_wards:
        rnd = random.Random(1000 + idx)
        stay_h = TYPICAL_STAY_HOURS.get(sw["type"], 72)
        for bed in ctx.ward_beds(ward.id):
            r = rnd.random()
            occ = sw["occ"]
            pick = ("OCCUPIED" if r < occ else "RESERVED" if r < occ + 0.04 else "CLEANING" if r < occ + 0.08
                    else "MAINTENANCE" if r < occ + 0.11 else "AVAILABLE")
            pick = SCENARIO.get(bed.bed_code, pick)
            if pick != "OCCUPIED":
                bed.status = pick
                bed.updated_at = ago({"RESERVED": rnd.randint(20, 200), "CLEANING": rnd.randint(4, 70),
                                      "MAINTENANCE": rnd.randint(180, 3000)}.get(pick, rnd.randint(60, 2400)))
                if pick == "CLEANING":
                    # The bed was just vacated: record the discharge that sent it to cleaning.
                    code = f"P-{idx}{bed.seq_no:03d}"
                    if code not in pcodes:
                        out_at = bed.updated_at
                        in_at = out_at - timedelta(hours=stay_h * rnd.uniform(0.6, 1.3))
                        p = Patient(patient_code=code, display_name=f"{rnd.choice(FIRST)} {rnd.choice(LAST)}", care_category=CARE_FOR_TYPE[sw["type"]],
                                    required_bed_type=sw["type"], required_equipment_types=[], required_bed_features=[], priority="ROUTINE",
                                    status="DISCHARGED", is_demo=True, created_at=in_at, updated_at=out_at)
                        s.add(p)
                        s.flush()
                        ctx.patients.append(p)
                        pcodes.add(code)
                        created["patients"] += 1
                        a = Allocation(patient_id=p.id, bed_id=bed.id, bed_code=bed.bed_code, status="RELEASED", assigned_at=in_at,
                                       admitted_at=in_at + timedelta(minutes=25), released_at=out_at, outcome="DISCHARGED",
                                       confirmed_by="Demo seed", equipment_ids=[], source="SEED")
                        s.add(a)
                        ctx.allocations.append(a)
                continue
            code = f"P-{idx}{bed.seq_no:03d}"
            if code in pcodes:
                continue
            arrived = rnd.random() > 0.08
            mins = int(stay_h * 60 * rnd.uniform(0.05, 0.97)) if arrived else rnd.randint(10, 100)
            ts = ago(mins)
            bed.updated_at = ts
            devs = []
            if sw["type"] == "ICU":
                devs.append("Monitor")
                if rnd.random() < 0.5:
                    devs.append("Ventilator")
            elif rnd.random() < 0.2:
                devs.append("Monitor" if rnd.random() < 0.5 else "Infusion Pump")
            p = Patient(patient_code=code, display_name=f"{rnd.choice(FIRST)} {rnd.choice(LAST)}", care_category=CARE_FOR_TYPE[sw["type"]],
                        required_bed_type=sw["type"], required_equipment_types=[],
                        required_bed_features=["Oxygen Outlet"] if "Oxygen Outlet" in (bed.features or []) and rnd.random() < 0.4 else [],
                        priority="HIGH" if sw["type"] == "ICU" else "ROUTINE", status="ADMITTED" if arrived else "ALLOCATED",
                        is_demo=True, created_at=ts, updated_at=ts)
            s.add(p)
            s.flush()
            ctx.patients.append(p)
            pcodes.add(code)
            created["patients"] += 1
            eq_ids = []
            got = []
            for t in devs:
                d = pick_device(ctx, t, ward.id, set(eq_ids))
                if d:
                    d.status, d.assigned_bed_id, d.updated_at = "IN_USE", bed.id, ts
                    eq_ids.append(d.id)
                    got.append(t)
            p.required_equipment_types = got
            a = Allocation(patient_id=p.id, bed_id=bed.id, bed_code=bed.bed_code, status="ACTIVE", assigned_at=ts,
                           admitted_at=ago(mins - 20) if arrived else None, confirmed_by="Demo seed", equipment_ids=eq_ids, source="SEED")
            s.add(a)
            ctx.allocations.append(a)
            bed.status, bed.current_patient_id = "OCCUPIED", p.id
    s.flush()

    for i, w in enumerate(WAITING):
        if w["code"] in pcodes:
            continue
        ts = ago(70 - i * 5)
        s.add(Patient(patient_code=w["code"], display_name=f"{FIRST[(i * 7 + 3) % len(FIRST)]} {LAST[(i * 5 + 2) % len(LAST)]}",
                      care_category=w["care"], required_bed_type=w["type"], required_equipment_types=list(w["devs"]),
                      required_bed_features=list(w["feats"]), priority=w["priority"],
                      match_started_at=ago(w["match_ago"]) if w.get("match_ago") is not None else None,
                      status="WAITING", is_demo=True, created_at=ts, updated_at=ts))
        created["patients"] += 1
    s.flush()

    if created["wards"]:
        ctx = Ctx(s)
        events: list[tuple[int, str, str, int | None, str, str]] = [(3, "DEMO_SEEDED", "settings", 0, "demo", "Demo data loaded (fictional wards, beds, equipment and patients)")]
        from .services.common import minutes_since

        for a in sorted((x for x in ctx.allocations if x.status == "ACTIVE"), key=lambda x: x.assigned_at)[-5:]:
            p = ctx.patient_by_id[a.patient_id]
            events.append((minutes_since(a.assigned_at), "ALLOCATED", "bed", a.bed_id, a.bed_code, f"{a.bed_code} allocated to {p.patient_code}"))
        for a in sorted((x for x in ctx.allocations if x.status == "RELEASED"), key=lambda x: x.released_at)[-4:]:
            p = ctx.patient_by_id[a.patient_id]
            events.append((minutes_since(a.released_at), "RELEASED", "bed", a.bed_id, a.bed_code, f"{a.bed_code} released ({p.patient_code} discharged); bed → cleaning"))
        for status, verb in (("RESERVED", "available → reserved"), ("MAINTENANCE", "available → maintenance")):
            b = max((x for x in ctx.beds if x.status == status), key=lambda x: x.updated_at, default=None)
            if b:
                events.append((minutes_since(b.updated_at), "BED_STATUS", "bed", b.id, b.bed_code, f"{b.bed_code} {verb}"))
        for minutes, action, rt, rid, code, msg in sorted(events, key=lambda e: -e[0]):
            log(s, action, rt, rid, code, msg, at=ago(minutes), actor="Demo seed")
    return created
