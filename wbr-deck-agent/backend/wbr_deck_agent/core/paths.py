from __future__ import annotations

from pathlib import Path
from typing import Optional


def repo_root() -> Path:
    # .../wbr-deck-agent/backend/wbr_deck_agent/core/paths.py -> parents[3] == repo root
    return Path(__file__).resolve().parents[3]


def data_dir() -> Path:
    return repo_root() / "data"


def uploads_dir(run_id: str) -> Path:
    return data_dir() / "uploads" / run_id


def out_dir(run_id: Optional[str] = None) -> Path:
    base = repo_root() / "out"
    return base if run_id is None else base / run_id


def tmp_dir(run_id: Optional[str] = None) -> Path:
    base = repo_root() / "tmp"
    return base if run_id is None else base / run_id


def sqlite_path() -> Path:
    return data_dir() / "wbr_deck_agent.sqlite3"
