from __future__ import annotations

from pathlib import Path

from PIL import Image


def create_thumbnail(src: Path, dest: Path, *, max_size: tuple[int, int] = (420, 260)) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as im:
        im = im.convert("RGB")
        im.thumbnail(max_size)
        im.save(dest, format="PNG", optimize=True)

