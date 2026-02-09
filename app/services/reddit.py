from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote_plus

import requests

REDDIT_BASE_URL = "https://www.reddit.com"


def _as_utc_timestamp(created_utc: float | int | None) -> datetime:
    if not created_utc:
        return datetime.now(UTC)
    return datetime.fromtimestamp(float(created_utc), tz=UTC)


def _extract_post_data(post: dict[str, Any], subreddit: str) -> dict[str, Any]:
    permalink = post.get("permalink") or ""
    url = f"{REDDIT_BASE_URL}{permalink}" if permalink else post.get("url")

    return {
        "title": (post.get("title") or "").strip(),
        "url": url,
        "summary": (post.get("selftext") or "").strip(),
        "published_at": _as_utc_timestamp(post.get("created_utc")),
        "source_type": "forum",
        "source_name": f"Reddit:r/{subreddit}",
        "engagement_score": int((post.get("score") or 0) + (post.get("num_comments") or 0) * 2),
        "upvotes": int(post.get("score") or 0),
        "comments": int(post.get("num_comments") or 0),
        "raw": post,
    }


def fetch_reddit_posts(
    query: str,
    subreddits: list[str],
    user_agent: str,
    limit_per_subreddit: int = 25,
    sort: str = "new",
    time_window: str = "day",
) -> list[dict]:
    headers = {"User-Agent": user_agent}
    results: list[dict] = []

    for subreddit in subreddits:
        params = (
            f"q={quote_plus(query)}&restrict_sr=on&sort={sort}&t={time_window}&limit={limit_per_subreddit}"
        )
        url = f"{REDDIT_BASE_URL}/r/{subreddit}/search.json?{params}"
        try:
            response = requests.get(url, headers=headers, timeout=20)
            response.raise_for_status()
            data = response.json()
        except Exception:
            continue

        children = (((data or {}).get("data") or {}).get("children") or [])
        for child in children:
            post = (child or {}).get("data") or {}
            if not post:
                continue
            extracted = _extract_post_data(post, subreddit)
            if extracted["title"] and extracted["url"]:
                results.append(extracted)

    return results
