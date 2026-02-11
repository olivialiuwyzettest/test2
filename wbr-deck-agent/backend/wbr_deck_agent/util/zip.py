from __future__ import annotations

import zipfile
from pathlib import Path


def zip_dir_to_file(src_dir: Path, zip_path: Path) -> None:
    src_dir = src_dir.resolve()
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for p in src_dir.rglob("*"):
            if p.is_dir():
                continue
            if p.name == zip_path.name:
                continue
            rel = p.relative_to(src_dir)
            zf.write(p, arcname=str(rel))

