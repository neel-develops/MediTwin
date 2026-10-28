#!/usr/bin/env bash
# MediTwin one-command launcher (macOS / Linux / Git Bash).
#   ./start.sh            build + run on http://localhost:8000
#   ./start.sh --dev      hot-reload dev mode (API :8000, UI :5173)
#   ./start.sh --reset    start with fresh demo data
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8000}"
DEV=0
for a in "$@"; do
  case "$a" in
    --dev) DEV=1 ;;
    --reset) rm -f "$ROOT"/backend/data/meditwin.db* ;;
  esac
done

if [ -x "$ROOT/backend/.venv/Scripts/python.exe" ]; then PY="$ROOT/backend/.venv/Scripts/python.exe"
elif [ -x "$ROOT/backend/.venv/bin/python" ]; then PY="$ROOT/backend/.venv/bin/python"
else
  echo "> Creating Python virtual environment"
  (command -v python3 >/dev/null && python3 -m venv "$ROOT/backend/.venv") || python -m venv "$ROOT/backend/.venv"
  if [ -x "$ROOT/backend/.venv/bin/python" ]; then PY="$ROOT/backend/.venv/bin/python"; else PY="$ROOT/backend/.venv/Scripts/python.exe"; fi
fi
echo "> Installing backend packages"
"$PY" -m pip install -q --disable-pip-version-check -r "$ROOT/backend/requirements.txt"
[ -d "$ROOT/frontend/node_modules" ] || { echo "> Installing frontend packages"; npm --prefix "$ROOT/frontend" install --no-audit --no-fund; }

if [ "$DEV" = 1 ]; then
  "$PY" -m uvicorn app.main:app --app-dir "$ROOT/backend" --port "$PORT" --reload --reload-dir "$ROOT/backend/app" &
  API=$!
  trap 'kill $API 2>/dev/null' EXIT
  npm --prefix "$ROOT/frontend" run dev
else
  echo "> Building the frontend"
  npm --prefix "$ROOT/frontend" run build
  echo "> MediTwin is running at http://localhost:$PORT  (Ctrl+C to stop)"
  "$PY" -m uvicorn app.main:app --app-dir "$ROOT/backend" --port "$PORT"
fi
