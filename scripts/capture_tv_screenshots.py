#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from playwright.sync_api import sync_playwright


def capture(url: str, width: int, height: int, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": width, "height": height})
        page.goto(url, wait_until="networkidle")
        page.wait_for_timeout(900)
        page.screenshot(path=str(out_path), full_page=False)
        browser.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Capture Wyze Intel Hub TV mode screenshots.")
    ap.add_argument("--base-url", default="http://127.0.0.1:8000", help="Base URL of the running app")
    ap.add_argument("--out-dir", default="docs/screenshots", help="Output directory")
    args = ap.parse_args()

    base = str(args.base_url).rstrip("/")
    out_dir = Path(args.out_dir)

    # rotate=0 keeps the frame stable for screenshots.
    url = f"{base}/tv?rotate=0&ticker=0&page=main"

    capture(url, 1920, 1080, out_dir / "tv-1080p.png")
    capture(url, 3840, 2160, out_dir / "tv-4k.png")


if __name__ == "__main__":
    main()
