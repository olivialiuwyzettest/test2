from __future__ import annotations

from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus

import feedparser
import requests

GOOGLE_NEWS_RSS = "https://news.google.com/rss/search"


def _parse_published(raw_date: str | None) -> datetime:
    if not raw_date:
        return datetime.now(UTC)
    try:
        parsed = parsedate_to_datetime(raw_date)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
    except Exception:
        return datetime.now(UTC)


def fetch_google_news(query: str, max_items: int = 30) -> list[dict]:
    params = f"q={quote_plus(query)}&hl=en-US&gl=US&ceid=US:en"
    url = f"{GOOGLE_NEWS_RSS}?{params}"
    response = requests.get(url, timeout=20)
    response.raise_for_status()

    parsed = feedparser.parse(response.text)
    results: list[dict] = []

    for entry in parsed.entries[:max_items]:
        title = (entry.get("title") or "").strip()
        link = (entry.get("link") or "").strip()
        if not title or not link:
            continue

        source = "Google News"
        if entry.get("source") and isinstance(entry.get("source"), dict):
            source = entry["source"].get("title") or source

        results.append(
            {
                "title": title,
                "url": link,
                "summary": (entry.get("summary") or "").strip(),
                "published_at": _parse_published(entry.get("published") or entry.get("updated")),
                "source_type": "news",
                "source_name": source,
                "engagement_score": 0,
                "raw": entry,
            }
        )

    return results
