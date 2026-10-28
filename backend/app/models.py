"""SQLAlchemy ORM models. Internal integer ids + separate human-readable codes."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Ward(Base):
    __tablename__ = "wards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(60))
    name_key: Mapped[str] = mapped_column(String(60), unique=True)  # lower-cased name, enforces case-insensitive uniqueness
    category: Mapped[str] = mapped_column(String(40), default="Other")
    bed_code_prefix: Mapped[str] = mapped_column(String(6), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Bed(Base):
    __tablename__ = "beds"
    __table_args__ = (UniqueConstraint("ward_id", "seq_no", name="uq_bed_ward_seq"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bed_code: Mapped[str] = mapped_column(String(16), unique=True)
    seq_no: Mapped[int] = mapped_column(Integer)
    ward_id: Mapped[int] = mapped_column(ForeignKey("wards.id", ondelete="CASCADE"), index=True)
    bed_type: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(16), default="AVAILABLE", index=True)
    current_patient_id: Mapped[int | None] = mapped_column(ForeignKey("patients.id"), nullable=True)
    features: Mapped[list] = mapped_column(JSON, default=list)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_code: Mapped[str] = mapped_column(String(16), unique=True)
    display_name: Mapped[str] = mapped_column(String(60))
    care_category: Mapped[str] = mapped_column(String(40))
    required_bed_type: Mapped[str] = mapped_column(String(20))
    required_equipment_types: Mapped[list] = mapped_column(JSON, default=list)
    required_bed_features: Mapped[list] = mapped_column(JSON, default=list)
    priority: Mapped[str] = mapped_column(String(10), default="ROUTINE")
    match_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="WAITING", index=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Equipment(Base):
    __tablename__ = "equipment"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    equipment_code: Mapped[str] = mapped_column(String(20), unique=True)
    equipment_type: Mapped[str] = mapped_column(String(30), index=True)
    tracking_mode: Mapped[str] = mapped_column(String(12))  # INDIVIDUAL | QUANTITY
    status: Mapped[str] = mapped_column(String(16), default="AVAILABLE")
    ward_id: Mapped[int | None] = mapped_column(ForeignKey("wards.id", ondelete="SET NULL"), nullable=True)
    assigned_bed_id: Mapped[int | None] = mapped_column(ForeignKey("beds.id", ondelete="SET NULL"), nullable=True)
    quantity_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    quantity_available: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Allocation(Base):
    __tablename__ = "allocations"
    __table_args__ = (
        # The database itself guarantees one active allocation per bed and per patient.
        Index("uq_active_alloc_bed", "bed_id", unique=True, sqlite_where=text("status = 'ACTIVE'")),
        Index("uq_active_alloc_patient", "patient_id", unique=True, sqlite_where=text("status = 'ACTIVE'")),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    bed_id: Mapped[int | None] = mapped_column(ForeignKey("beds.id", ondelete="SET NULL"), nullable=True)
    bed_code: Mapped[str] = mapped_column(String(16))  # snapshot, survives bed removal
    status: Mapped[str] = mapped_column(String(12), default="ACTIVE")  # ACTIVE | RELEASED | CANCELLED
    assigned_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    admitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    released_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    confirmed_by: Mapped[str] = mapped_column(String(60), default="Demo staff")
    equipment_ids: Mapped[list] = mapped_column(JSON, default=list)
    outcome: Mapped[str | None] = mapped_column(String(16), nullable=True)
    source: Mapped[str] = mapped_column(String(12), default="MANUAL")  # MANUAL | AI_PLAN | SEED
    match_score: Mapped[float | None] = mapped_column(Float, nullable=True)


class ActivityEvent(Base):
    __tablename__ = "activity"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_label: Mapped[str] = mapped_column(String(60), default="Demo staff")
    action: Mapped[str] = mapped_column(String(40))
    resource_type: Mapped[str] = mapped_column(String(20))
    resource_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    resource_code: Mapped[str] = mapped_column(String(40), default="")
    message: Mapped[str] = mapped_column(Text)
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)
