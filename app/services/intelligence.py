from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Iterable

from sqlalchemy.orm import Session

from app.config import Settings
from app.services.news import fetch_google_news
from app.services.reddit import fetch_reddit_posts
from app.services.repository import cleanup_old_items, upsert_intel_item
from app.services.scoring import relevance_score
from app.services.sentiment import analyze_text_sentiment

REDDIT_SENTIMENT_SUBREDDITS = [
    "wyzecam",
    "smarthome",
    "homeautomation",
    "homesecurity",
    "homeassistant",
]

REDDIT_MARKET_SUBREDDITS = [
    "smarthome",
    "homeautomation",
    "homesecurity",
    "homeassistant",
    "securitycameras",
]


@dataclass
class IngestionStats:
    inserted: int = 0
    updated: int = 0
    skipped: int = 0
    deleted_old: int = 0
    errors: int = 0


def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _finalize_item(base: dict, topic: str, entity: str, query_bonus: float = 0.0) -> dict:
    text = f"{base.get('title', '')}\n{base.get('summary', '')}".strip()
    sentiment = analyze_text_sentiment(text)

    published_at = _ensure_utc(base.get("published_at") or datetime.now(UTC))
    engagement = int(base.get("engagement_score") or 0)

    payload = {
        "topic": topic,
        "entity": entity.lower().strip(),
        "source_type": base.get("source_type", "unknown"),
        "source_name": base.get("source_name", "unknown"),
        "title": base.get("title", "").strip(),
        "url": base.get("url", "").strip(),
        "summary": base.get("summary", "").strip(),
        "published_at": published_at,
        "engagement_score": engagement,
        "sentiment_score": sentiment,
        "relevance_score": relevance_score(published_at, engagement, query_bonus=query_bonus),
        "raw": base.get("raw", {}),
    }
    return payload


def _store_batch(db: Session, stats: IngestionStats, items: Iterable[dict]) -> None:
    seen_keys: set[tuple[str, str, str]] = set()
    for item in items:
        if not item.get("title") or not item.get("url"):
            stats.skipped += 1
            continue
        key = (str(item.get("topic", "")), str(item.get("entity", "")), str(item.get("url", "")))
        if key in seen_keys:
            stats.skipped += 1
            continue
        seen_keys.add(key)
        inserted = upsert_intel_item(db, item)
        if inserted:
            stats.inserted += 1
        else:
            stats.updated += 1


def _fetch_news_safe(query: str, max_items: int, stats: IngestionStats) -> list[dict]:
    try:
        return fetch_google_news(query, max_items=max_items)
    except Exception:
        stats.errors += 1
        return []


def _fetch_reddit_safe(
    query: str,
    subreddits: list[str],
    user_agent: str,
    max_items: int,
    stats: IngestionStats,
    sort: str = "new",
    time_window: str = "day",
) -> list[dict]:
    try:
        return fetch_reddit_posts(
            query=query,
            subreddits=subreddits,
            user_agent=user_agent,
            limit_per_subreddit=max_items,
            sort=sort,
            time_window=time_window,
        )
    except Exception:
        stats.errors += 1
        return []


def _topic_wyze(db: Session, settings: Settings, stats: IngestionStats) -> None:
    news_queries = [
        "Wyze camera OR Wyze security",
        "Wyze AI OR Wyze monitoring",
    ]

    reddit_queries = ["wyze camera", "wyze app", "wyze security"]

    items: list[dict] = []
    for query in news_queries:
        for item in _fetch_news_safe(query, settings.max_items_per_query, stats):
            items.append(_finalize_item(item, topic="wyze", entity="wyze", query_bonus=0.5))

    for query in reddit_queries:
        for item in _fetch_reddit_safe(
            query,
            REDDIT_SENTIMENT_SUBREDDITS,
            settings.reddit_user_agent,
            max_items=10,
            stats=stats,
            sort="new",
            time_window="day",
        ):
            items.append(_finalize_item(item, topic="wyze", entity="wyze", query_bonus=0.45))

    _store_batch(db, stats, items)


def _topic_sentiment(db: Session, settings: Settings, stats: IngestionStats) -> None:
    raw_posts = _fetch_reddit_safe(
        query="wyze",
        subreddits=REDDIT_SENTIMENT_SUBREDDITS,
        user_agent=settings.reddit_user_agent,
        max_items=settings.max_items_per_query,
        stats=stats,
        sort="top",
        time_window="month",
    )

    filtered: list[dict] = []
    for post in raw_posts:
        upvotes = int(post.get("upvotes") or 0)
        comments = int(post.get("comments") or 0)
        if upvotes >= settings.high_engagement_score or comments >= settings.high_engagement_comments:
            filtered.append(_finalize_item(post, topic="sentiment", entity="wyze", query_bonus=0.6))

    _store_batch(db, stats, filtered)


def _topic_competitors(db: Session, settings: Settings, stats: IngestionStats) -> None:
    items: list[dict] = []
    for competitor in settings.main_competitors:
        news_query = f"{competitor} smart camera OR {competitor} home security"
        reddit_query = f"{competitor} camera"

        for article in _fetch_news_safe(news_query, settings.max_items_per_query, stats):
            items.append(_finalize_item(article, topic="competitor", entity=competitor, query_bonus=0.55))

        for post in _fetch_reddit_safe(
            query=reddit_query,
            subreddits=REDDIT_MARKET_SUBREDDITS,
            user_agent=settings.reddit_user_agent,
            max_items=10,
            stats=stats,
            sort="new",
            time_window="day",
        ):
            items.append(_finalize_item(post, topic="competitor", entity=competitor, query_bonus=0.4))

    _store_batch(db, stats, items)


def _normalize_key(value: str) -> str:
    return value.lower().replace("-", " ").strip()


def _extract_brands(text: str, candidates: list[str]) -> list[str]:
    lower = text.lower().replace("-", " ")
    found: list[str] = []
    for candidate in candidates:
        needle = _normalize_key(candidate)
        if needle and needle in lower:
            found.append(candidate.lower())
    return sorted(set(found))


def _topic_emerging(db: Session, settings: Settings, stats: IngestionStats) -> None:
    main_set = {_normalize_key(name) for name in settings.main_competitors}
    all_candidates = list({name.lower() for name in settings.emerging_competitor_candidates if name})

    generic_news = _fetch_news_safe(
        "smart camera AI monitoring OR home security camera startup",
        settings.max_items_per_query,
        stats,
    )
    generic_reddit = _fetch_reddit_safe(
        query="smart security camera ai monitoring",
        subreddits=REDDIT_MARKET_SUBREDDITS,
        user_agent=settings.reddit_user_agent,
        max_items=12,
        stats=stats,
        sort="top",
        time_window="week",
    )

    collected: list[dict] = []
    for raw_item in generic_news + generic_reddit:
        text_blob = f"{raw_item.get('title', '')}\n{raw_item.get('summary', '')}".strip()
        matches = _extract_brands(text_blob, all_candidates)
        for brand in matches:
            if _normalize_key(brand) in main_set or brand == "wyze":
                continue
            collected.append(_finalize_item(raw_item, topic="emerging", entity=brand, query_bonus=0.65))

    _store_batch(db, stats, collected)


def run_full_ingestion(db: Session, settings: Settings) -> IngestionStats:
    stats = IngestionStats()

    _topic_wyze(db, settings, stats)
    _topic_sentiment(db, settings, stats)
    _topic_competitors(db, settings, stats)
    _topic_emerging(db, settings, stats)

    db.commit()

    stats.deleted_old = cleanup_old_items(db, settings.item_retention_days)
    return stats
