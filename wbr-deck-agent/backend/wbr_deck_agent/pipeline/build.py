from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any, Optional

from wbr_deck_agent.core import db
from wbr_deck_agent.core.config import Settings
from wbr_deck_agent.core.paths import out_dir, uploads_dir
from wbr_deck_agent.pipeline.extract import extract_asset
from wbr_deck_agent.pipeline.images import create_thumbnail
from wbr_deck_agent.pipeline.pdf_render import render_pdf_to_images
from wbr_deck_agent.pipeline.schemas import AssetExtraction, SourceRef
from wbr_deck_agent.pipeline.synthesize import build_insights_document
from wbr_deck_agent.render.deck import write_deck
from wbr_deck_agent.util.redact import redact_secrets


def _write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=True), encoding="utf-8")


def _append_jsonl(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=True))
        f.write("\n")


def _publish_latest(run_out: Path) -> None:
    """
    Mirror the latest run artifacts to out/ for the MVP contract.

    - out/deck.html
    - out/extraction.jsonl
    - out/insights.json
    - out/topics.json
    - out/thumbs/*
    """
    latest = out_dir()
    latest.mkdir(parents=True, exist_ok=True)

    for name in ["deck.html", "extraction.jsonl", "insights.json", "topics.json"]:
        src = run_out / name
        if src.exists():
            shutil.copy2(src, latest / name)

    src_thumbs = run_out / "thumbs"
    if src_thumbs.exists():
        dst_thumbs = latest / "thumbs"
        dst_thumbs.mkdir(parents=True, exist_ok=True)
        for p in src_thumbs.glob("*.png"):
            shutil.copy2(p, dst_thumbs / p.name)


def _placeholder_failed_extraction(
    *,
    asset_id: str,
    source_type: str,
    filename: str,
    page: Optional[int],
    error: str,
) -> AssetExtraction:
    error = redact_secrets(error)
    return AssetExtraction(
        asset_id=asset_id,
        source_type="pdf_page" if source_type == "pdf_page" else "image",
        source_ref=SourceRef(filename=filename, page=page),
        dashboard_title="",
        time_range="",
        metrics=[],
        notable_trends=[f"[NEEDS DATA] Extraction failed: {error.splitlines()[0][:180]}"],
        anomalies=[],
        tags=[],
        confidence=0.0,
        raw_evidence_notes=["Extraction failed; no grounded numbers emitted."],
    )


def build_run(run_id: str, settings: Settings) -> dict[str, Any]:
    run = db.get_run(run_id)
    if not run:
        raise RuntimeError(f"Run not found: {run_id}")

    run_uploads = uploads_dir(run_id)
    run_uploads.mkdir(parents=True, exist_ok=True)

    run_out = out_dir(run_id)
    run_out.mkdir(parents=True, exist_ok=True)

    extraction_jsonl = run_out / "extraction.jsonl"
    insights_json = run_out / "insights.json"
    topics_json = run_out / "topics.json"
    deck_html = run_out / "deck.html"

    warnings: list[str] = []

    db.update_run(run_id, status="running", stage="extracting", message="Starting extraction...", progress_current=0)

    assets = db.list_assets(run_id)
    uploaded_images = [a for a in assets if a["source_type"] == "image"]
    uploaded_pdfs = [a for a in assets if a["source_type"] == "pdf"]

    # Render PDFs into page images (creates additional asset records).
    for a in uploaded_pdfs:
        pdf_path = db.rel_to_abs(a["stored_path"])
        if not pdf_path:
            continue
        db.update_run(run_id, message=f"Rendering PDF: {a['original_filename']}")
        try:
            rendered_dir = run_uploads / "rendered" / Path(a["original_filename"]).stem
            pages = render_pdf_to_images(pdf_path, rendered_dir)
            for page_no, img_path in pages:
                db.add_asset(
                    run_id=run_id,
                    source_type="pdf_page",
                    original_filename=a["original_filename"],
                    stored_path=pdf_path,
                    page=page_no,
                    image_path=img_path,
                    status="rendered",
                )
        except Exception as e:
            msg = redact_secrets(f"PDF render failed for {a['original_filename']}: {e}")
            warnings.append(msg)
            db.update_asset(a["id"], status="failed", error=msg)

    # Refresh asset list after adding pdf pages.
    assets = db.list_assets(run_id)
    extract_targets = [a for a in assets if a["source_type"] in ("image", "pdf_page")]

    db.update_run(run_id, progress_total=len(extract_targets), progress_current=0)

    asset_thumbs: dict[str, str] = {}
    extractions: list[AssetExtraction] = []

    for i, a in enumerate(extract_targets, start=1):
        asset_id = a["id"]
        filename = a["original_filename"]
        page = a.get("page")
        image_path = db.rel_to_abs(a.get("image_path")) or db.rel_to_abs(a.get("stored_path"))
        if not image_path:
            msg = f"Missing image_path for asset {asset_id}"
            warnings.append(msg)
            db.update_asset(asset_id, status="failed", error=msg)
            continue

        db.update_run(run_id, message=f"Extracting {i}/{len(extract_targets)}: {filename}")

        try:
            ex = extract_asset(
                settings=settings,
                image_path=image_path,
                asset_id=asset_id,
                source_type=a["source_type"],
                source_ref=SourceRef(filename=filename, page=page),
            )
            db.update_asset(asset_id, status="extracted", error=None)
        except Exception as e:
            msg = redact_secrets(
                f"Extraction failed for {filename}{' p'+str(page) if page else ''}: {e}"
            )
            warnings.append(msg)
            db.update_asset(asset_id, status="failed", error=msg)
            ex = _placeholder_failed_extraction(
                asset_id=asset_id,
                source_type=a["source_type"],
                filename=filename,
                page=page,
                error=str(e),
            )

        _append_jsonl(extraction_jsonl, ex.model_dump())
        extractions.append(ex)

        # Asset-level thumbnail (full image; no cropping in MVP).
        try:
            thumb_rel = f"thumbs/{asset_id}.png"
            thumb_abs = run_out / thumb_rel
            create_thumbnail(image_path, thumb_abs)
            asset_thumbs[asset_id] = thumb_rel
        except Exception as e:
            warnings.append(redact_secrets(f"Thumbnail generation failed for {filename}: {e}"))

        db.update_run(run_id, progress_current=i)

    db.update_run(run_id, stage="synthesizing", message="Synthesizing topics + insights...")

    # Build insights doc (source-of-truth for rendering).
    doc = build_insights_document(
        run_id=run_id,
        week=run["week"],
        extractions=extractions,
        assets=assets,
        max_topics=int(run["max_topics"]),
        max_insights=int(run["max_insights"]),
        agenda_notes=run.get("agenda_notes"),
        asset_thumbs=asset_thumbs,
        warnings=warnings,
    )

    _write_json(insights_json, doc)
    _write_json(topics_json, doc.get("topics") or [])

    db.update_run(run_id, stage="rendering", message="Rendering deck.html...")
    write_deck(deck_html, doc)

    _publish_latest(run_out)

    db.update_run(run_id, status="succeeded", stage="done", message="Done.")
    return {"run_id": run_id, "out_dir": str(run_out)}
