from __future__ import annotations

from pathlib import Path

import fitz  # PyMuPDF


def render_pdf_to_images(pdf_path: Path, out_dir: Path, *, zoom: float = 2.0) -> list[tuple[int, Path]]:
    """
    Render a PDF to page PNGs.

    Returns list of (page_number_1_indexed, image_path).
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(str(pdf_path))
    results: list[tuple[int, Path]] = []
    try:
        for i in range(doc.page_count):
            page_no = i + 1
            page = doc.load_page(i)
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
            out_path = out_dir / f"{pdf_path.stem}_p{page_no:03d}.png"
            pix.save(str(out_path))
            results.append((page_no, out_path))
    finally:
        doc.close()
    return results

