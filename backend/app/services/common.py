"""Small helpers shared by the service modules."""
from __future__ import annotations

import copy
import re
from datetime import datetime, timedelta
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..constants import default_settings
from ..errors import ApiError, validation
from ..models import ActivityEvent, AppSetting, utcnow

ACTOR = "Demo staff"


def now() -> datetime:
    return utcnow()


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.replace(microsecond=0).isoformat() + "Z"


def minutes_since(dt: datetime | None, ref: datetime | None = None) -> int:
    if dt is None:
        return 0
    return max(0, int(((ref or now()) - dt).total_seconds() // 60))


def ago(minutes: float) -> datetime:
    return now() - timedelta(minutes=minutes)


def clean(value: Any) -> str:
    return str(value if value is not None else "").strip()


def require_text(value: Any, field: str, max_len: int) -> str:
    v = clean(value)
    if not v:
        raise validation(f"{field} is required.", field)
    if len(v) > max_len:
        raise validation(f"{field} must be {max_len} characters or fewer.", field)
    return v


def require_one_of(value: Any, options: Iterable[str], field: str) -> str:
    opts = list(options)
    if value not in opts:
        raise validation(f"{field} must be one of: {', '.join(opts)}.", field)
    return value


def subset_of(values: Any, options: Iterable[str], field: str) -> list[str]:
    opts = list(options)
    arr = list(values) if isinstance(values, (list, tuple, set)) else []
    bad = [v for v in arr if v not in opts]
    if bad:
        raise validation(f"{field} contains unknown values: {', '.join(map(str, bad))}.", field)
    out: list[str] = []
    for v in arr:
        if v not in out:
            out.append(v)
    return out


def require_int(value: Any, field: str, lo: int, hi: int) -> int:
    try:
        n = int(value)
        if isinstance(value, float) and not value.is_integer():
            raise ValueError
        if isinstance(value, str) and not re.fullmatch(r"-?\d+", value.strip()):
            raise ValueError
    except (TypeError, ValueError):
        raise validation(f"{field} must be a whole number from {lo} to {hi}.", field) from None
    if n < lo or n > hi:
        raise validation(f"{field} must be a whole number from {lo} to {hi}.", field)
    return n


def require_prefix(value: Any) -> str:
    p = clean(value).upper()
    if not re.fullmatch(r"[A-Z0-9]{1,6}", p):
        raise validation("Bed code prefix must be 1–6 letters or digits.", "bed_code_prefix")
    return p


def derive_prefix(name: str) -> str:
    words = [w for w in re.sub(r"[^A-Z0-9 ]", " ", clean(name).upper()).split() if w]
    if not words:
        return "BED"
    if len(words) == 1:
        return words[0][:3]
    return "".join(w if w.isdigit() else w[0] for w in words)[:6]


def bed_code(prefix: str, n: int) -> str:
    return f"{prefix}-{n:03d}"


def log(s: Session, action: str, resource_type: str, resource_id: int | None, resource_code: str, message: str,
        details: dict | None = None, at: datetime | None = None, actor: str = ACTOR) -> None:
    s.add(ActivityEvent(actor_label=actor, action=action, resource_type=resource_type, resource_id=resource_id,
                        resource_code=resource_code, message=message, details=details, created_at=at or now()))


def get_settings(s: Session) -> dict:
    row = s.get(AppSetting, "settings")
    merged = default_settings()
    if row and isinstance(row.value, dict):
        for k, v in row.value.items():
            if isinstance(v, dict) and isinstance(merged.get(k), dict):
                merged[k] = {**merged[k], **v}
            else:
                merged[k] = v
    return merged


def save_settings(s: Session, settings: dict) -> None:
    row = s.get(AppSetting, "settings")
    if row is None:
        s.add(AppSetting(key="settings", value=copy.deepcopy(settings)))
    else:
        row.value = copy.deepcopy(settings)  # reassign so the JSON change is detected


def get_or_404(s: Session, model, ident: Any, label: str):  # noqa: ANN001
    try:
        key = int(ident)
    except (TypeError, ValueError):
        raise ApiError(404, "NOT_FOUND", f"{label} not found.") from None
    obj = s.get(model, key)
    if obj is None:
        raise ApiError(404, "NOT_FOUND", f"{label} not found.")
    return obj


def all_rows(s: Session, model, *order):  # noqa: ANN001
    return list(s.scalars(select(model).order_by(*order)).all()) if order else list(s.scalars(select(model)).all())
