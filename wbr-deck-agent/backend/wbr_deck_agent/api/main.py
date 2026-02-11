from __future__ import annotations

import mimetypes
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel, Field

from wbr_deck_agent.core.config import get_settings
from wbr_deck_agent.core.db import (
    add_asset,
    get_run,
    init_db,
    list_assets,
    list_runs,
    rel_to_abs,
    update_run,
)
from wbr_deck_agent.core.job_queue import JOB_QUEUE, Job
from wbr_deck_agent.core.paths import out_dir, uploads_dir
from wbr_deck_agent.pipeline.build import build_run
from wbr_deck_agent.util.zip import zip_dir_to_file


class CreateRunIn(BaseModel):
    week: str = Field(min_length=1, max_length=64)
    max_topics: int = Field(default=6, ge=1, le=12)
    max_insights: int = Field(default=12, ge=1, le=40)
    agenda_notes: Optional[str] = Field(default=None, max_length=4000)


app = FastAPI(title="wbr-deck-agent", version="0.1.0")

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    init_db()

    def _handler(job: Job) -> None:
        if job.kind == "build":
            build_run(job.run_id, settings)
        else:
            raise RuntimeError(f"Unknown job kind: {job.kind}")

    JOB_QUEUE.start(_handler)


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "mock_mode": settings.effective_mock_mode(),
        "provider": settings.effective_provider(),
        "model": settings.effective_model(),
    }


@app.get("/api/runs")
def runs() -> list[dict[str, Any]]:
    return list_runs()


@app.post("/api/runs")
def create_run(inp: CreateRunIn) -> dict[str, Any]:
    from wbr_deck_agent.core.db import create_run

    run = create_run(
        week=inp.week,
        max_topics=inp.max_topics,
        max_insights=inp.max_insights,
        agenda_notes=inp.agenda_notes,
    )
    uploads_dir(run["id"]).mkdir(parents=True, exist_ok=True)
    out_dir(run["id"]).mkdir(parents=True, exist_ok=True)
    return run


@app.get("/api/runs/{run_id}")
def get_run_detail(run_id: str) -> dict[str, Any]:
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="run not found")
    return {"run": run, "assets": list_assets(run_id)}


@app.post("/api/runs/{run_id}/uploads")
async def upload_assets(run_id: str, files: list[UploadFile] = File(...)) -> dict[str, Any]:
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="run not found")
    if run["status"] not in ("created",):
        raise HTTPException(status_code=400, detail=f"run not uploadable in status={run['status']}")

    up_dir = uploads_dir(run_id)
    up_dir.mkdir(parents=True, exist_ok=True)

    created: list[dict[str, Any]] = []

    for f in files:
        if not f.filename:
            continue
        original = Path(f.filename).name
        ext = Path(original).suffix.lower()
        is_pdf = ext == ".pdf"
        is_img = ext in (".png", ".jpg", ".jpeg")
        if not (is_pdf or is_img):
            raise HTTPException(status_code=400, detail=f"unsupported file type: {original}")

        stored_name = f"{uuid.uuid4().hex}_{original}"
        stored_path = up_dir / stored_name

        content = await f.read()
        stored_path.write_bytes(content)

        if is_pdf:
            a = add_asset(
                run_id=run_id,
                source_type="pdf",
                original_filename=original,
                stored_path=stored_path,
                page=None,
                image_path=None,
                status="uploaded",
            )
        else:
            a = add_asset(
                run_id=run_id,
                source_type="image",
                original_filename=original,
                stored_path=stored_path,
                page=None,
                image_path=stored_path,
                status="uploaded",
            )
        created.append(a)

    return {"created": created}


@app.post("/api/runs/{run_id}/start")
def start_run(run_id: str) -> dict[str, Any]:
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="run not found")
    if run["status"] not in ("created",):
        raise HTTPException(status_code=400, detail=f"run not startable in status={run['status']}")

    update_run(run_id, status="queued", stage="queued", message="Queued.", progress_current=0)
    job = JOB_QUEUE.enqueue(run_id, "build")
    return {"enqueued": {"job_id": job.id, "kind": job.kind, "run_id": job.run_id}}


@app.get("/api/runs/{run_id}/out/{path:path}")
def get_out_file(run_id: str, path: str) -> FileResponse:
    base = out_dir(run_id).resolve()
    target = (base / path).resolve()
    if not str(target).startswith(str(base)):
        raise HTTPException(status_code=400, detail="invalid path")
    if not target.exists():
        raise HTTPException(status_code=404, detail="not found")

    media_type, _enc = mimetypes.guess_type(str(target))
    return FileResponse(str(target), media_type=media_type or "application/octet-stream")


@app.get("/api/runs/{run_id}/deck")
def get_deck(run_id: str) -> RedirectResponse:
    # Redirect so relative paths (e.g. thumbs/*) resolve under /out/.
    return RedirectResponse(url=f"/api/runs/{run_id}/out/deck.html", status_code=302)


@app.get("/api/runs/{run_id}/download.zip")
def download_zip(run_id: str) -> FileResponse:
    base = out_dir(run_id)
    if not base.exists():
        raise HTTPException(status_code=404, detail="run output not found")
    zip_path = out_dir(run_id) / "out.zip"
    zip_dir_to_file(base, zip_path)
    return FileResponse(str(zip_path), media_type="application/zip", filename=f"wbr-out-{run_id}.zip")


@app.get("/api/latest/deck")
def latest_deck() -> RedirectResponse:
    # Redirect so relative paths (e.g. thumbs/*) resolve under /api/latest/out/.
    return RedirectResponse(url="/api/latest/out/deck.html", status_code=302)


@app.get("/api/latest/insights")
def latest_insights() -> JSONResponse:
    base = out_dir()
    p = (base / "insights.json").resolve()
    if not p.exists():
        raise HTTPException(status_code=404, detail="no latest insights.json found")
    return JSONResponse(content=json_load(p))


@app.get("/api/latest/out/{path:path}")
def latest_out_file(path: str) -> FileResponse:
    base = out_dir().resolve()
    target = (base / path).resolve()
    if not str(target).startswith(str(base)):
        raise HTTPException(status_code=400, detail="invalid path")
    if not target.exists():
        raise HTTPException(status_code=404, detail="not found")

    media_type, _enc = mimetypes.guess_type(str(target))
    return FileResponse(str(target), media_type=media_type or "application/octet-stream")


def json_load(path: Path) -> Any:
    return __import__("json").loads(path.read_text(encoding="utf-8"))
