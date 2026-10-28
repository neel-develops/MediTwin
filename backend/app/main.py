"""FastAPI application: JSON API under /api, plus the built React frontend when it exists."""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import config
from .api import router
from .database import Database
from .errors import ApiError


def create_app(db_path: Path | str | None = None, seed: bool | None = None, frontend: Path | None = None) -> FastAPI:
    database = Database(db_path or config.DATABASE_PATH)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        database.create_all()
        if config.SEED_ON_START if seed is None else seed:
            from .models import Ward
            from .seed import seed_demo

            with database.read() as s:
                empty = s.query(Ward).first() is None
            if empty:
                with database.write() as s:
                    seed_demo(s)
        yield
        database.dispose()

    app = FastAPI(title="MediTwin API", version="2.0.0", lifespan=lifespan,
                  description="Hospital bed & equipment allocation with explainable AI planning. Fictional demo data only.")
    app.state.db = database
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_methods=["*"], allow_headers=["*"])

    @app.exception_handler(ApiError)
    async def _api_error(_req: Request, exc: ApiError):
        return JSONResponse(exc.to_dict(), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(_req: Request, exc: RequestValidationError):
        first = exc.errors()[0] if exc.errors() else {}
        loc = ".".join(str(x) for x in first.get("loc", []) if x not in ("body", "query", "path"))
        msg = f"{loc}: {first.get('msg', 'Invalid input')}" if loc else first.get("msg", "Invalid input")
        return JSONResponse(ApiError(422, "VALIDATION", msg, {"field": loc or None}).to_dict(), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_req: Request, exc: StarletteHTTPException):
        code = "NOT_FOUND" if exc.status_code == 404 else "HTTP_ERROR"
        return JSONResponse(ApiError(exc.status_code, code, str(exc.detail)).to_dict(), status_code=exc.status_code)

    @app.exception_handler(Exception)
    async def _unexpected(_req: Request, exc: Exception):
        return JSONResponse(ApiError(500, "SERVER_ERROR", "Something went wrong on the server. Nothing was changed.").to_dict(), status_code=500)

    app.include_router(router)

    dist = Path(frontend or config.FRONTEND_DIST)
    if (dist / "index.html").is_file():
        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            if path.startswith("api/"):
                raise StarletteHTTPException(404, "Not found")
            target = (dist / path).resolve()
            if path and target.is_file() and dist.resolve() in target.parents:
                return FileResponse(target)
            if path.startswith("assets/") or "." in path.rsplit("/", 1)[-1]:
                raise StarletteHTTPException(404, "Not found")  # a missing file, not an app route
            return FileResponse(dist / "index.html", headers={"Cache-Control": "no-cache"})

    return app


app = create_app()
