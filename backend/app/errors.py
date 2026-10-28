"""Structured API errors: {"error": {"status", "code", "message", "details"}}."""
from __future__ import annotations

from typing import Any


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: Any = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details

    def to_dict(self) -> dict:
        return {"error": {"status": self.status, "code": self.code, "message": self.message, "details": self.details}}


def not_found(label: str) -> ApiError:
    return ApiError(404, "NOT_FOUND", f"{label} not found.")


def validation(message: str, field: str | None = None) -> ApiError:
    return ApiError(422, "VALIDATION", message, {"field": field} if field else None)
