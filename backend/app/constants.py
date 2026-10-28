"""Enumerations and fixed vocabularies shared by every service."""
from __future__ import annotations

BED_STATUSES = ["AVAILABLE", "OCCUPIED", "RESERVED", "CLEANING", "MAINTENANCE"]
BED_TYPES = ["General", "ICU", "Pediatric", "Maternity", "Isolation"]
BED_FEATURES = ["Oxygen Outlet", "Suction", "Isolation Capable", "Bariatric"]
DEVICE_TYPES = ["Monitor", "Ventilator", "Infusion Pump"]  # individually tracked, allocatable
QUANTITY_TYPES = ["Wheelchair", "Oxygen Cylinder", "Stretcher"]  # counted stock only
EQUIPMENT_STATUSES = ["AVAILABLE", "IN_USE", "RESERVED", "MAINTENANCE"]
PATIENT_STATUSES = ["WAITING", "ALLOCATED", "ADMITTED", "DISCHARGED", "TRANSFERRED"]
FLOW_STAGES = ["WAITING", "MATCHING", "ALLOCATED", "ADMITTED"]
PRIORITIES = ["URGENT", "HIGH", "ROUTINE"]  # staff-set administrative priority, not a clinical score
PRIORITY_RANK = {"URGENT": 0, "HIGH": 1, "ROUTINE": 2}
ACTIVE_PATIENT = ["ALLOCATED", "ADMITTED"]
CARE_CATEGORIES = ["General Medicine", "Surgery Recovery", "Critical Care", "Paediatrics", "Maternity", "Infectious Disease"]
WARD_CATEGORIES = ["General Ward", "Critical Care", "Paediatrics", "Maternity", "Isolation", "Other"]
DEVICE_PREFIX = {"Monitor": "MON", "Ventilator": "VEN", "Infusion Pump": "INF"}

# Manual status changes. OCCUPIED is only entered/left through allocation and release.
MANUAL_TRANSITIONS: dict[str, list[str]] = {
    "AVAILABLE": ["RESERVED", "CLEANING", "MAINTENANCE"],
    "RESERVED": ["AVAILABLE", "CLEANING", "MAINTENANCE"],
    "CLEANING": ["AVAILABLE", "MAINTENANCE"],
    "MAINTENANCE": ["AVAILABLE", "CLEANING"],
    "OCCUPIED": [],
}

# Which ward categories naturally serve which care categories (used for "ward fit" in AI scoring).
CARE_WARD_FIT = {
    "General Medicine": ["General Ward"],
    "Surgery Recovery": ["General Ward"],
    "Critical Care": ["Critical Care"],
    "Paediatrics": ["Paediatrics"],
    "Maternity": ["Maternity"],
    "Infectious Disease": ["Isolation", "General Ward"],
}

# Demo planning assumptions for the capacity forecast (hours). Clearly simulated, not clinical.
TYPICAL_STAY_HOURS = {"General": 72, "ICU": 120, "Pediatric": 48, "Maternity": 54, "Isolation": 96}


def default_settings() -> dict:
    return {
        "low_available_pct": 10,
        "high_occupancy_pct": 85,
        "equipment_min_available": {"Monitor": 3, "Ventilator": 2, "Infusion Pump": 3},
        "release_to_cleaning": True,
        "cleaning_turnaround_minutes": 45,
        "group_size": 10,
        "hospital_name": "City General Hospital",
        "bed_type_compat": {t: [t] for t in BED_TYPES},
    }
