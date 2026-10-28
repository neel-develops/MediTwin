"""Pydantic request schemas. Field types are permissive (``Any`` for numbers) so the service
layer can return its own precise, human-readable validation messages."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict


class _In(BaseModel):
    model_config = ConfigDict(extra="ignore")

    def data(self) -> dict:
        return self.model_dump(exclude_unset=True)


class WardCreate(_In):
    name: Any = None
    category: Optional[str] = None
    bed_code_prefix: Optional[str] = None
    bed_count: Any = 0
    bed_type: Optional[str] = None
    features: Optional[list[str]] = None


class WardPatch(_In):
    name: Optional[str] = None
    category: Optional[str] = None
    bed_code_prefix: Optional[str] = None
    is_active: Optional[bool] = None


class GenerateBeds(_In):
    count: Any = None
    bed_type: Optional[str] = None
    features: Optional[list[str]] = None


class BedStatus(_In):
    status: Any = None


class BulkBedStatus(_In):
    status: Any = None
    bed_ids: Optional[list[int]] = None
    ward_id: Any = None
    from_status: Optional[str] = None


class BedPatch(_In):
    bed_type: Optional[str] = None
    features: Optional[list[str]] = None
    notes: Optional[str] = None


class PatientCreate(_In):
    display_name: Any = None
    patient_code: Optional[str] = None
    care_category: Optional[str] = None
    required_bed_type: Optional[str] = None
    required_equipment_types: Optional[list[str]] = None
    required_bed_features: Optional[list[str]] = None
    priority: Optional[str] = None
    notes: Optional[str] = None


class PatientPatch(_In):
    display_name: Optional[str] = None
    care_category: Optional[str] = None
    required_bed_type: Optional[str] = None
    required_equipment_types: Optional[list[str]] = None
    required_bed_features: Optional[list[str]] = None
    priority: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None


class AllocationCreate(_In):
    patient_id: Any = None
    bed_id: Any = None
    confirmed_by: Optional[str] = None


class Release(_In):
    outcome: Literal["DISCHARGED", "TRANSFERRED"] = "DISCHARGED"


class EquipmentCreate(_In):
    tracking_mode: Optional[str] = None
    equipment_type: Optional[str] = None
    equipment_code: Optional[str] = None
    ward_id: Any = None
    quantity_total: Any = None
    notes: Optional[str] = None


class EquipmentPatch(_In):
    status: Optional[str] = None
    ward_id: Any = None
    quantity_total: Any = None
    quantity_available: Any = None
    notes: Optional[str] = None


class SettingsPatch(_In):
    low_available_pct: Any = None
    high_occupancy_pct: Any = None
    group_size: Any = None
    cleaning_turnaround_minutes: Any = None
    release_to_cleaning: Optional[bool] = None
    hospital_name: Optional[str] = None
    equipment_min_available: Optional[dict[str, Any]] = None
    bed_type_compat: Optional[dict[str, list[str]]] = None


class PlanItem(_In):
    patient_id: int
    bed_id: int


class PlanApply(_In):
    items: list[PlanItem]
    confirmed_by: Optional[str] = None


class ChatMessage(_In):
    role: str
    content: str


class Chat(_In):
    messages: list[ChatMessage]
