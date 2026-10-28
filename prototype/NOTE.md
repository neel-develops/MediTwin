# Original static prototype (Graphite design)

This folder keeps the original no-build prototype exactly as it was at commit `3881961`
("Bed Allocations concept layout and overlap fixes"). Its design — the Graphite dark glass theme,
10-colour palette and Bed Allocations concept layout — is what the full-stack app in `frontend/`
reproduces. Run it on its own with:

    powershell -ExecutionPolicy Bypass -File prototype/serve.ps1

It stores data in the browser only; the real app (FastAPI + SQLite backend) is started with `start.ps1` at the repo root.
