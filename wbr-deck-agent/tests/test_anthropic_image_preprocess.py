from __future__ import annotations

import os
from pathlib import Path

from PIL import Image

from wbr_deck_agent.pipeline import extract as ex


def _b64_len(raw_len: int) -> int:
    # Base64 length in bytes for ASCII output.
    return 4 * ((raw_len + 2) // 3)


def test_prepare_image_bytes_for_anthropic_keeps_small_png(tmp_path: Path) -> None:
    p = tmp_path / "small.png"
    Image.new("RGB", (200, 200), (10, 20, 30)).save(p, format="PNG", optimize=True)

    mime, b = ex._prepare_image_bytes_for_anthropic(p)

    assert mime == "image/png"
    assert b == p.read_bytes()
    assert _b64_len(len(b)) <= ex.ANTHROPIC_IMAGE_MAX_B64_BYTES


def test_prepare_image_bytes_for_anthropic_shrinks_when_base64_too_large(
    tmp_path: Path,
) -> None:
    # Construct a noisy screenshot-like image that yields a large PNG.
    w, h = 1800, 1800
    im = Image.frombytes("RGB", (w, h), os.urandom(w * h * 3))
    p = tmp_path / "big.png"
    im.save(p, format="PNG", compress_level=0)

    # Ensure the base64 payload would exceed Anthropic's limit before preprocessing.
    assert _b64_len(p.stat().st_size) > ex.ANTHROPIC_IMAGE_MAX_B64_BYTES

    mime, b = ex._prepare_image_bytes_for_anthropic(p)

    assert mime == "image/jpeg"
    assert _b64_len(len(b)) <= ex.ANTHROPIC_IMAGE_MAX_B64_BYTES

