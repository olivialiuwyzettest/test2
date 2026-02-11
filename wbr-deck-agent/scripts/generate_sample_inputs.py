from __future__ import annotations

from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image, ImageDraw


def make_png(path: Path, text: str) -> None:
    im = Image.new("RGB", (1200, 700), (255, 255, 255))
    d = ImageDraw.Draw(im)
    d.text((60, 60), text, fill=(0, 0, 0))
    d.text((60, 140), "Mock-safe placeholder (no real numbers).", fill=(90, 90, 110))
    im.save(path, format="PNG")


def make_pdf(path: Path, text: str) -> None:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text)
    page.insert_text((72, 110), "Mock-safe placeholder (no real numbers).")
    doc.save(str(path))
    doc.close()


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    out = root / "sample_inputs"
    out.mkdir(parents=True, exist_ok=True)

    png = out / "revenue.png"
    pdf = out / "ops.pdf"
    if not png.exists():
        make_png(png, "Sample: Revenue dashboard screenshot")
    if not pdf.exists():
        make_pdf(pdf, "Sample: Ops dashboard (PDF)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

