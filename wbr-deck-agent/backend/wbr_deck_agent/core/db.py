from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

from wbr_deck_agent.core.paths import data_dir, repo_root, sqlite_path

DB_LOCK = threading.Lock()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _rel(p: Optional[Path]) -> Optional[str]:
    if p is None:
        return None
    try:
        return str(p.resolve().relative_to(repo_root()))
    except Exception:
        # Fallback: keep the raw path if it is outside repo_root for some reason.
        return str(p)


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    data_dir().mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(sqlite_path()), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with DB_LOCK, _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS runs (
              id TEXT PRIMARY KEY,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              week TEXT NOT NULL,
              max_topics INTEGER NOT NULL,
              max_insights INTEGER NOT NULL,
              agenda_notes TEXT,
              status TEXT NOT NULL,
              stage TEXT NOT NULL,
              progress_current INTEGER NOT NULL,
              progress_total INTEGER NOT NULL,
              message TEXT,
              warnings_json TEXT
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS assets (
              id TEXT PRIMARY KEY,
              run_id TEXT NOT NULL,
              created_at TEXT NOT NULL,
              source_type TEXT NOT NULL,
              original_filename TEXT NOT NULL,
              stored_path TEXT NOT NULL,
              page INTEGER,
              image_path TEXT,
              status TEXT NOT NULL,
              error TEXT,
              FOREIGN KEY (run_id) REFERENCES runs(id)
            );
            """
        )


def create_run(
    *,
    week: str,
    max_topics: int,
    max_insights: int,
    agenda_notes: Optional[str],
) -> dict[str, Any]:
    run_id = uuid.uuid4().hex
    now = _utc_now_iso()
    row = {
        "id": run_id,
        "created_at": now,
        "updated_at": now,
        "week": week,
        "max_topics": int(max_topics),
        "max_insights": int(max_insights),
        "agenda_notes": agenda_notes,
        "status": "created",
        "stage": "idle",
        "progress_current": 0,
        "progress_total": 0,
        "message": None,
        "warnings_json": json.dumps([]),
    }
    with DB_LOCK, _connect() as conn:
        conn.execute(
            """
            INSERT INTO runs (
              id, created_at, updated_at, week, max_topics, max_insights, agenda_notes,
              status, stage, progress_current, progress_total, message, warnings_json
            ) VALUES (
              :id, :created_at, :updated_at, :week, :max_topics, :max_insights, :agenda_notes,
              :status, :stage, :progress_current, :progress_total, :message, :warnings_json
            );
            """,
            row,
        )
    return row


def get_run(run_id: str) -> Optional[dict[str, Any]]:
    with DB_LOCK, _connect() as conn:
        cur = conn.execute("SELECT * FROM runs WHERE id = ?;", (run_id,))
        r = cur.fetchone()
        return dict(r) if r else None


def list_runs(limit: int = 50) -> list[dict[str, Any]]:
    with DB_LOCK, _connect() as conn:
        cur = conn.execute("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?;", (limit,))
        return [dict(r) for r in cur.fetchall()]


def update_run(run_id: str, **fields: Any) -> None:
    if not fields:
        return
    fields = dict(fields)
    fields["updated_at"] = _utc_now_iso()
    cols = ", ".join([f"{k} = :{k}" for k in fields.keys()])
    fields["id"] = run_id
    with DB_LOCK, _connect() as conn:
        conn.execute(f"UPDATE runs SET {cols} WHERE id = :id;", fields)


def add_asset(
    *,
    run_id: str,
    source_type: str,
    original_filename: str,
    stored_path: Path,
    page: Optional[int],
    image_path: Optional[Path],
    status: str,
    error: Optional[str] = None,
) -> dict[str, Any]:
    asset_id = uuid.uuid4().hex
    now = _utc_now_iso()
    row = {
        "id": asset_id,
        "run_id": run_id,
        "created_at": now,
        "source_type": source_type,
        "original_filename": original_filename,
        "stored_path": _rel(stored_path) or str(stored_path),
        "page": page,
        "image_path": _rel(image_path),
        "status": status,
        "error": error,
    }
    with DB_LOCK, _connect() as conn:
        conn.execute(
            """
            INSERT INTO assets (
              id, run_id, created_at, source_type, original_filename, stored_path,
              page, image_path, status, error
            ) VALUES (
              :id, :run_id, :created_at, :source_type, :original_filename, :stored_path,
              :page, :image_path, :status, :error
            );
            """,
            row,
        )
    return row


def update_asset(asset_id: str, **fields: Any) -> None:
    if not fields:
        return
    if "stored_path" in fields and isinstance(fields["stored_path"], Path):
        fields["stored_path"] = _rel(fields["stored_path"])
    if "image_path" in fields and isinstance(fields["image_path"], Path):
        fields["image_path"] = _rel(fields["image_path"])
    cols = ", ".join([f"{k} = :{k}" for k in fields.keys()])
    fields["id"] = asset_id
    with DB_LOCK, _connect() as conn:
        conn.execute(f"UPDATE assets SET {cols} WHERE id = :id;", fields)


def list_assets(run_id: str) -> list[dict[str, Any]]:
    with DB_LOCK, _connect() as conn:
        cur = conn.execute("SELECT * FROM assets WHERE run_id = ? ORDER BY created_at;", (run_id,))
        return [dict(r) for r in cur.fetchall()]


def rel_to_abs(p: Optional[str]) -> Optional[Path]:
    if not p:
        return None
    path = Path(p)
    if path.is_absolute():
        return path
    return repo_root() / path
