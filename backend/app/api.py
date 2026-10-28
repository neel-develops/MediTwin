"""REST API. Thin handlers: each one opens a read or write unit of work and calls a service."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query, Request

from . import config
from . import schemas as S
from .constants import (BED_FEATURES, BED_STATUSES, BED_TYPES, CARE_CATEGORIES, DEVICE_TYPES, EQUIPMENT_STATUSES,
                        FLOW_STAGES, MANUAL_TRANSITIONS, PATIENT_STATUSES, PRIORITIES, QUANTITY_TYPES, WARD_CATEGORIES)
from .database import Database
from .seed import seed_demo
from .services import ai, assistant, insights, inventory, patients
from .services.common import get_settings

router = APIRouter(prefix="/api")


def db(request: Request) -> Database:
    return request.app.state.db


# ------------------------------------------------------------------ meta
@router.get("/meta")
def meta(request: Request):
    with db(request).read() as s:
        st = get_settings(s)
    return {"bed_statuses": BED_STATUSES, "bed_types": BED_TYPES, "bed_features": BED_FEATURES, "device_types": DEVICE_TYPES,
            "quantity_types": QUANTITY_TYPES, "equipment_statuses": EQUIPMENT_STATUSES, "patient_statuses": PATIENT_STATUSES,
            "care_categories": CARE_CATEGORIES, "ward_categories": WARD_CATEGORIES, "priorities": PRIORITIES, "flow_stages": FLOW_STAGES,
            "manual_transitions": MANUAL_TRANSITIONS, "hospital_name": st.get("hospital_name"),
            "ai_engine": "groq" if config.GROQ_API_KEY else "local", "ai_model": config.GROQ_MODEL if config.GROQ_API_KEY else None}


@router.get("/health")
def health():
    return {"ok": True}


# ------------------------------------------------------------------ wards
@router.get("/wards")
def list_wards(request: Request, include_inactive: bool = True):
    with db(request).read() as s:
        return inventory.list_wards(s, include_inactive)


@router.post("/wards", status_code=201)
def create_ward(request: Request, body: S.WardCreate):
    with db(request).write() as s:
        return inventory.create_ward(s, body.data())


@router.get("/wards/{ward_id}")
def get_ward(request: Request, ward_id: int):
    with db(request).read() as s:
        return inventory.get_ward(s, ward_id)


@router.patch("/wards/{ward_id}")
def update_ward(request: Request, ward_id: int, body: S.WardPatch):
    with db(request).write() as s:
        return inventory.update_ward(s, ward_id, body.data())


@router.post("/wards/{ward_id}/generate-beds")
def generate_beds(request: Request, ward_id: int, body: S.GenerateBeds):
    with db(request).write() as s:
        return inventory.generate_beds(s, ward_id, body.data())


@router.get("/wards/{ward_id}/reduction-preview")
def reduction_preview(request: Request, ward_id: int, count: int = 0):
    with db(request).read() as s:
        return inventory.preview_reduction(s, ward_id, count)


# ------------------------------------------------------------------ beds
@router.get("/beds")
def list_beds(request: Request, ward_id: Optional[str] = None, status: Optional[str] = None, bed_type: Optional[str] = None,
              search: Optional[str] = None):
    with db(request).read() as s:
        return inventory.list_beds(s, ward_id, status, bed_type, search)


@router.get("/beds/{bed_id}")
def get_bed(request: Request, bed_id: int):
    with db(request).read() as s:
        return inventory.get_bed(s, bed_id)


@router.patch("/beds/{bed_id}/status")
def bed_status(request: Request, bed_id: int, body: S.BedStatus):
    with db(request).write() as s:
        return inventory.update_bed_status(s, bed_id, body.data())


@router.post("/beds/bulk-status")
def bulk_status(request: Request, body: S.BulkBedStatus):
    with db(request).write() as s:
        return inventory.bulk_bed_status(s, body.data())


@router.patch("/beds/{bed_id}")
def update_bed(request: Request, bed_id: int, body: S.BedPatch):
    with db(request).write() as s:
        return inventory.update_bed(s, bed_id, body.data())


@router.get("/beds/{bed_id}/candidates")
def bed_candidates(request: Request, bed_id: int):
    with db(request).read() as s:
        return patients.bed_candidates(s, bed_id)


# ------------------------------------------------------------------ patients
@router.get("/patients")
def list_patients(request: Request, search: Optional[str] = None, status: Optional[str] = None):
    with db(request).read() as s:
        return patients.list_patients(s, search, status)


@router.get("/patients/flow")
def patient_flow(request: Request, search: Optional[str] = None, care_category: Optional[str] = None, bed_type: Optional[str] = None,
                 priority: Optional[str] = None, ward_id: Optional[str] = None, stage: Optional[str] = None,
                 page: int = 1, page_size: int = 24, per_column: int = 6):
    with db(request).read() as s:
        return patients.patient_flow(s, search, care_category, bed_type, priority, ward_id, stage, page, page_size, per_column)


@router.post("/patients", status_code=201)
def create_patient(request: Request, body: S.PatientCreate):
    with db(request).write() as s:
        return patients.create_patient(s, body.data())


@router.get("/patients/{pid}")
def get_patient(request: Request, pid: int):
    with db(request).read() as s:
        return patients.get_patient(s, pid)


@router.patch("/patients/{pid}")
def update_patient(request: Request, pid: int, body: S.PatientPatch):
    with db(request).write() as s:
        return patients.update_patient(s, pid, body.data())


@router.post("/patients/{pid}/matching")
def start_matching(request: Request, pid: int):
    with db(request).write() as s:
        return patients.set_matching(s, pid, True)


@router.delete("/patients/{pid}/matching")
def stop_matching(request: Request, pid: int):
    with db(request).write() as s:
        return patients.set_matching(s, pid, False)


# ------------------------------------------------------------------ allocations
@router.get("/allocations/recommendations")
def recommendations(request: Request, patient_id: int, limit: int = Query(12, ge=0, le=100), soft: bool = False):
    with db(request).read() as s:
        return patients.recommendations(s, patient_id, limit, soft)


@router.get("/allocations")
def list_allocations(request: Request, status: Optional[str] = None, limit: int = Query(50, ge=1, le=500)):
    with db(request).read() as s:
        return patients.list_allocations(s, status, limit)


@router.post("/allocations", status_code=201)
def allocate(request: Request, body: S.AllocationCreate):
    with db(request).write() as s:
        return patients.allocate(s, body.data())


@router.post("/allocations/{alloc_id}/admit")
def admit(request: Request, alloc_id: int):
    with db(request).write() as s:
        return patients.admit(s, alloc_id)


@router.post("/allocations/{alloc_id}/cancel")
def cancel(request: Request, alloc_id: int):
    with db(request).write() as s:
        return patients.cancel(s, alloc_id)


@router.post("/allocations/{alloc_id}/release")
def release(request: Request, alloc_id: int, body: S.Release):
    with db(request).write() as s:
        return patients.release(s, alloc_id, body.outcome)


# ------------------------------------------------------------------ equipment
@router.get("/equipment")
def list_equipment(request: Request, ward_id: Optional[str] = None, status: Optional[str] = None, type: Optional[str] = None,  # noqa: A002
                   search: Optional[str] = None, tracking_mode: Optional[str] = None):
    with db(request).read() as s:
        return inventory.list_equipment(s, ward_id, status, type, search, tracking_mode)


@router.post("/equipment", status_code=201)
def create_equipment(request: Request, body: S.EquipmentCreate):
    with db(request).write() as s:
        return inventory.create_equipment(s, body.data())


@router.get("/equipment/{eq_id}")
def get_equipment(request: Request, eq_id: int):
    with db(request).read() as s:
        return inventory.get_equipment(s, eq_id)


@router.patch("/equipment/{eq_id}")
def update_equipment(request: Request, eq_id: int, body: S.EquipmentPatch):
    with db(request).write() as s:
        return inventory.update_equipment(s, eq_id, body.data())


# ------------------------------------------------------------------ dashboard, alerts, activity, search
@router.get("/dashboard/summary")
def dashboard(request: Request):
    with db(request).read() as s:
        return insights.summary(s)


@router.get("/alerts")
def alerts(request: Request):
    with db(request).read() as s:
        return insights.alerts(s)


@router.get("/activity")
def activity(request: Request, limit: int = 30, resource_type: Optional[str] = None):
    with db(request).read() as s:
        return insights.activity(s, limit, resource_type)


@router.get("/search")
def search(request: Request, q: str = ""):
    with db(request).read() as s:
        return insights.search(s, q)


@router.get("/reports")
def reports(request: Request):
    with db(request).read() as s:
        return insights.reports(s)


@router.post("/simulate/surge")
def surge(request: Request, count: int = 20, seed: int = 7):
    with db(request).read() as s:
        return insights.simulate_surge(s, count, seed)


# ------------------------------------------------------------------ settings & demo data
@router.get("/settings")
def settings(request: Request):
    with db(request).read() as s:
        return get_settings(s)


@router.patch("/settings")
def update_settings(request: Request, body: S.SettingsPatch):
    with db(request).write() as s:
        return insights.update_settings(s, body.data())


@router.get("/integrity")
def integrity(request: Request):
    """Data-consistency check: allocations, bed states, patient states and device assignments agree."""
    from .services.rules import Ctx, integrity_problems

    with db(request).read() as s:
        problems = integrity_problems(Ctx(s))
    return {"ok": not problems, "problems": problems}


@router.post("/demo/seed")
def demo_seed(request: Request):
    with db(request).write() as s:
        return seed_demo(s)


@router.post("/demo/reset")
def demo_reset(request: Request):
    d = db(request)
    d.drop_all()
    d.create_all()
    with d.write() as s:
        return seed_demo(s)


# ------------------------------------------------------------------ AI
@router.get("/ai/briefing")
def ai_briefing(request: Request):
    with db(request).read() as s:
        return ai.briefing(s)


@router.get("/ai/plan")
def ai_plan(request: Request):
    with db(request).read() as s:
        return ai.build_plan(s)


@router.post("/ai/plan/apply")
def ai_apply(request: Request, body: S.PlanApply):
    items = [i.model_dump() for i in body.items]
    return ai.apply_plan(db(request), items, body.confirmed_by or "Demo staff")


@router.get("/ai/forecast")
def ai_forecast(request: Request, hours: int = Query(24, ge=6, le=72), demand: float = Query(1.0, ge=0, le=3)):
    with db(request).read() as s:
        return ai.forecast(s, hours, demand)


@router.get("/ai/unlock/{pid}")
def ai_unlock(request: Request, pid: int):
    with db(request).read() as s:
        return ai.unlock_for_patient(s, pid)


@router.post("/ai/assistant")
def ai_assistant(request: Request, body: S.Chat):
    return assistant.chat(db(request), [m.model_dump() for m in body.messages])
