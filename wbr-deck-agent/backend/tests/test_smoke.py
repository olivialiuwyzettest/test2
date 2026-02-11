from __future__ import annotations

import json
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image, ImageDraw

from wbr_deck_agent.cli import main as cli_main
from wbr_deck_agent.core.paths import out_dir


def _make_png(path: Path, text: str) -> None:
    im = Image.new("RGB", (900, 520), (255, 255, 255))
    d = ImageDraw.Draw(im)
    d.text((30, 40), text, fill=(0, 0, 0))
    im.save(path, format="PNG")


def _make_pdf(path: Path, text: str) -> None:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text)
    doc.save(str(path))
    doc.close()


def test_cli_build_mock_generates_deck(tmp_path: Path) -> None:
    input_dir = tmp_path / "inputs"
    input_dir.mkdir(parents=True, exist_ok=True)

    _make_png(input_dir / "revenue.png", "Revenue dashboard (mock)")
    _make_pdf(input_dir / "ops.pdf", "Ops dashboard PDF (mock)")

    rc = cli_main(
        [
            "build",
            "--input",
            str(input_dir),
            "--week",
            "2026-W06",
            "--mock",
            "--max-topics",
            "6",
            "--max-insights",
            "12",
        ]
    )
    assert rc == 0

    latest_out = out_dir()
    deck = latest_out / "deck.html"
    extraction = latest_out / "extraction.jsonl"
    insights = latest_out / "insights.json"

    assert deck.exists()
    assert extraction.exists()
    assert insights.exists()

    html = deck.read_text(encoding="utf-8")
    assert "WBR — 2026-W06" in html
    assert "Exec Summary" in html

    lines = [ln for ln in extraction.read_text(encoding="utf-8").splitlines() if ln.strip()]
    # At least one image + one pdf page extraction
    assert len(lines) >= 2

    doc = json.loads(insights.read_text(encoding="utf-8"))
    assert doc["week"] == "2026-W06"
    assert "insights" in doc

