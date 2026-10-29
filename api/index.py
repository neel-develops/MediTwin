"""Vercel entry point: serves the FastAPI backend as a Python function under /api.

The React build is served by Vercel as static files (see vercel.json). Vercel's filesystem is
read-only except /tmp, so the SQLite demo database lives there and is seeded on cold start.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("MEDITWIN_DB", "/tmp/meditwin.db")

from app.main import create_app, prepare_database  # noqa: E402

app = create_app(frontend=ROOT / "_no_frontend")
prepare_database(app.state.db)
