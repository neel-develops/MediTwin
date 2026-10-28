"""Runtime configuration, read from environment variables (see .env.example)."""
from __future__ import annotations

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent


def _load_dotenv() -> None:
    """Minimal .env loader so the app runs without extra packages."""
    for path in (BACKEND_DIR / ".env", ROOT_DIR / ".env"):
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()

DATABASE_PATH = Path(os.environ.get("MEDITWIN_DB", str(BACKEND_DIR / "data" / "meditwin.db")))
FRONTEND_DIST = Path(os.environ.get("MEDITWIN_FRONTEND_DIST", str(ROOT_DIR / "frontend" / "dist")))
SEED_ON_START = os.environ.get("MEDITWIN_SEED_ON_START", "1") != "0"

# Optional: powers the AI assistant with Groq (gpt-oss-120b). Without a key it uses the built-in engine.
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip()
GROQ_MODEL = os.environ.get("MEDITWIN_AI_MODEL", "openai/gpt-oss-120b")
