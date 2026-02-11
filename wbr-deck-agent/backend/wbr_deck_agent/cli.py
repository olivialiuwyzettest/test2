from __future__ import annotations

import argparse
import shutil
import sys
import uuid
from pathlib import Path
from typing import Optional

from wbr_deck_agent.core import db
from wbr_deck_agent.core.config import Settings, get_settings
from wbr_deck_agent.core.paths import out_dir, uploads_dir
from wbr_deck_agent.pipeline.build import build_run


def _iter_input_files(input_dir: Path) -> list[Path]:
    files: list[Path] = []
    for p in sorted(input_dir.rglob("*")):
        if not p.is_file():
            continue
        suf = p.suffix.lower()
        if suf in (".png", ".jpg", ".jpeg", ".pdf"):
            files.append(p)
    return files


def cmd_build(args: argparse.Namespace) -> int:
    db.init_db()

    settings = get_settings()
    if args.mock:
        settings = settings.model_copy(update={"mock_mode": True})

    run = db.create_run(
        week=args.week,
        max_topics=args.max_topics,
        max_insights=args.max_insights,
        agenda_notes=args.agenda_notes,
    )
    run_id = run["id"]

    up_dir = uploads_dir(run_id)
    up_dir.mkdir(parents=True, exist_ok=True)

    input_dir = Path(args.input).resolve()
    if not input_dir.exists() or not input_dir.is_dir():
        print(f"--input must be a directory: {input_dir}", file=sys.stderr)
        return 2

    files = _iter_input_files(input_dir)
    if not files:
        print(f"No supported files found in: {input_dir}", file=sys.stderr)
        return 2

    for p in files:
        original = p.name
        stored_name = f"{uuid.uuid4().hex}_{original}"
        stored_path = up_dir / stored_name
        shutil.copy2(p, stored_path)
        if p.suffix.lower() == ".pdf":
            db.add_asset(
                run_id=run_id,
                source_type="pdf",
                original_filename=original,
                stored_path=stored_path,
                page=None,
                image_path=None,
                status="uploaded",
            )
        else:
            db.add_asset(
                run_id=run_id,
                source_type="image",
                original_filename=original,
                stored_path=stored_path,
                page=None,
                image_path=stored_path,
                status="uploaded",
            )

    res = build_run(run_id, settings)
    # MVP contract: latest artifacts are mirrored to out/
    print(f"Run: {run_id}")
    print(f"Run out: {res['out_dir']}")
    print(f"Latest deck: {out_dir() / 'deck.html'}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="wbr-deck-agent")
    sub = p.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="Build a WBR deck from a folder of screenshots/PDFs.")
    b.add_argument("--input", required=True, help="Directory containing .png/.jpg/.jpeg/.pdf assets")
    b.add_argument("--week", required=True, help="WBR week/date string (e.g. 2026-W06)")
    b.add_argument("--max-topics", type=int, default=6)
    b.add_argument("--max-insights", type=int, default=12)
    b.add_argument("--agenda-notes", type=str, default=None)
    b.add_argument("--mock", action="store_true", help="Force mock mode (no OpenAI calls).")
    b.set_defaults(func=cmd_build)
    return p


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
