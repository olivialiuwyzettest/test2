from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import IntelItem, RefreshRun


def create_refresh_run(db: Session) -> RefreshRun:
    run = RefreshRun(started_at=datetime.now(UTC), status="running", message="Ingesting latest intel")
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def complete_refresh_run(db: Session, run: RefreshRun, status: str, message: str, items_ingested: int) -> None:
    run.completed_at = datetime.now(UTC)
    run.status = status
    run.message = message
    run.items_ingested = items_ingested
    db.add(run)
    db.commit()


def upsert_intel_item(db: Session, payload: dict) -> bool:
    existing = db.scalar(
        select(IntelItem).where(
            IntelItem.topic == payload["topic"],
            IntelItem.entity == payload.get("entity", ""),
            IntelItem.url == payload["url"],
        )
    )
    if existing:
        existing.title = payload["title"]
        existing.summary = payload.get("summary", "")
        existing.published_at = payload["published_at"]
        existing.fetched_at = datetime.now(UTC)
        existing.engagement_score = int(payload.get("engagement_score", 0))
        existing.sentiment_score = float(payload.get("sentiment_score", 0.0))
        existing.relevance_score = float(payload.get("relevance_score", 0.0))
        existing.source_name = payload.get("source_name", existing.source_name)
        existing.source_type = payload.get("source_type", existing.source_type)
        existing.entity = payload.get("entity", existing.entity)
        existing.raw_json = json.dumps(payload.get("raw", {}), ensure_ascii=True)
        db.add(existing)
        return False

    item = IntelItem(
        topic=payload["topic"],
        entity=payload.get("entity", ""),
        source_type=payload.get("source_type", "unknown"),
        source_name=payload.get("source_name", "unknown"),
        title=payload["title"],
        url=payload["url"],
        summary=payload.get("summary", ""),
        published_at=payload["published_at"],
        fetched_at=datetime.now(UTC),
        engagement_score=int(payload.get("engagement_score", 0)),
        sentiment_score=float(payload.get("sentiment_score", 0.0)),
        relevance_score=float(payload.get("relevance_score", 0.0)),
        raw_json=json.dumps(payload.get("raw", {}), ensure_ascii=True),
    )
    db.add(item)
    return True


def get_latest_items(db: Session, topic: str, limit: int = 50, entity: str | None = None) -> list[IntelItem]:
    stmt = select(IntelItem).where(IntelItem.topic == topic)
    if entity:
        stmt = stmt.where(IntelItem.entity == entity)

    stmt = stmt.order_by(IntelItem.published_at.desc(), IntelItem.relevance_score.desc()).limit(limit)
    return list(db.scalars(stmt).all())


def get_items_since(
    db: Session,
    topic: str,
    since: datetime,
    limit: int = 200,
    entity: str | None = None,
    order_by: str = "published",
) -> list[IntelItem]:
    stmt = select(IntelItem).where(IntelItem.topic == topic, IntelItem.published_at >= since)
    if entity:
        stmt = stmt.where(IntelItem.entity == entity)

    if order_by == "engagement":
        stmt = stmt.order_by(IntelItem.engagement_score.desc(), IntelItem.published_at.desc())
    elif order_by == "relevance":
        stmt = stmt.order_by(IntelItem.relevance_score.desc(), IntelItem.published_at.desc())
    else:
        stmt = stmt.order_by(IntelItem.published_at.desc(), IntelItem.relevance_score.desc())

    stmt = stmt.limit(limit)
    return list(db.scalars(stmt).all())


def cleanup_old_items(db: Session, retention_days: int) -> int:
    cutoff = datetime.now(UTC) - timedelta(days=retention_days)
    stmt = select(IntelItem).where(IntelItem.published_at < cutoff)
    old_items = list(db.scalars(stmt).all())
    for item in old_items:
        db.delete(item)
    db.commit()
    return len(old_items)


def get_recent_hub_metrics(db: Session, hours: int = 24) -> dict:
    cutoff = datetime.now(UTC) - timedelta(hours=hours)

    def count_topic(topic: str) -> int:
        return int(
            db.scalar(select(func.count()).select_from(IntelItem).where(IntelItem.topic == topic, IntelItem.published_at >= cutoff))
            or 0
        )

    wyze_mentions = count_topic("wyze")
    sentiment_mentions = count_topic("sentiment")
    competitor_mentions = count_topic("competitor")
    emerging_mentions = count_topic("emerging")

    avg_sentiment = db.scalar(
        select(func.avg(IntelItem.sentiment_score)).where(IntelItem.topic == "sentiment", IntelItem.published_at >= cutoff)
    )

    return {
        "wyze_mentions": wyze_mentions,
        "sentiment_mentions": sentiment_mentions,
        "competitor_mentions": competitor_mentions,
        "emerging_mentions": emerging_mentions,
        "avg_sentiment": round(float(avg_sentiment or 0.0), 4),
    }


def get_competitor_rollup(db: Session, window_days: int = 7) -> list[dict]:
    cutoff = datetime.now(UTC) - timedelta(days=window_days)

    stmt = (
        select(
            IntelItem.entity,
            func.count().label("mentions"),
            func.avg(IntelItem.sentiment_score).label("avg_sentiment"),
            func.max(IntelItem.published_at).label("last_seen"),
        )
        .where(IntelItem.topic == "competitor", IntelItem.published_at >= cutoff)
        .group_by(IntelItem.entity)
        .order_by(func.count().desc())
    )

    rows = db.execute(stmt).all()
    output: list[dict] = []
    for entity, mentions, avg_sentiment, last_seen in rows:
        output.append(
            {
                "entity": entity,
                "mentions": int(mentions or 0),
                "avg_sentiment": round(float(avg_sentiment or 0.0), 4),
                "last_seen": last_seen,
            }
        )
    return output


def get_emerging_rollup(db: Session, window_days: int = 14) -> list[dict]:
    cutoff = datetime.now(UTC) - timedelta(days=window_days)

    stmt = (
        select(
            IntelItem.entity,
            func.count().label("mentions"),
            func.max(IntelItem.relevance_score).label("max_relevance"),
            func.max(IntelItem.published_at).label("last_seen"),
        )
        .where(IntelItem.topic == "emerging", IntelItem.published_at >= cutoff)
        .group_by(IntelItem.entity)
        .order_by(func.count().desc(), func.max(IntelItem.relevance_score).desc())
    )

    rows = db.execute(stmt).all()
    output: list[dict] = []
    for entity, mentions, max_relevance, last_seen in rows:
        output.append(
            {
                "entity": entity,
                "mentions": int(mentions or 0),
                "max_relevance": round(float(max_relevance or 0.0), 4),
                "last_seen": last_seen,
            }
        )
    return output


def get_sentiment_timeseries(db: Session, days: int = 7) -> list[dict]:
    cutoff = datetime.now(UTC) - timedelta(days=days)
    stmt = (
        select(
            func.date(IntelItem.published_at).label("day"),
            func.avg(IntelItem.sentiment_score).label("avg_sentiment"),
            func.count().label("posts"),
        )
        .where(IntelItem.topic == "sentiment", IntelItem.published_at >= cutoff)
        .group_by(func.date(IntelItem.published_at))
        .order_by(func.date(IntelItem.published_at).asc())
    )

    return [
        {
            "day": str(row.day),
            "avg_sentiment": round(float(row.avg_sentiment or 0.0), 4),
            "posts": int(row.posts or 0),
        }
        for row in db.execute(stmt).all()
    ]


def get_topic_daily_counts(db: Session, topic: str, days: int = 30) -> list[dict]:
    cutoff = datetime.now(UTC) - timedelta(days=days)
    stmt = (
        select(
            func.date(IntelItem.published_at).label("day"),
            func.count().label("mentions"),
        )
        .where(IntelItem.topic == topic, IntelItem.published_at >= cutoff)
        .group_by(func.date(IntelItem.published_at))
        .order_by(func.date(IntelItem.published_at).asc())
    )
    return [
        {"day": str(row.day), "mentions": int(row.mentions or 0)}
        for row in db.execute(stmt).all()
    ]


def latest_refresh_run(db: Session) -> RefreshRun | None:
    stmt = select(RefreshRun).order_by(RefreshRun.started_at.desc()).limit(1)
    return db.scalar(stmt)


def latest_successful_refresh_run(db: Session) -> RefreshRun | None:
    stmt = (
        select(RefreshRun)
        .where(RefreshRun.status == "success")
        .order_by(RefreshRun.completed_at.desc().nullslast(), RefreshRun.started_at.desc())
        .limit(1)
    )
    return db.scalar(stmt)


def get_topic_counts_between(db: Session, start: datetime, end: datetime) -> dict[str, int]:
    stmt = (
        select(IntelItem.topic, func.count().label("mentions"))
        .where(IntelItem.published_at >= start, IntelItem.published_at < end)
        .group_by(IntelItem.topic)
    )
    out: dict[str, int] = {}
    for topic, mentions in db.execute(stmt).all():
        out[str(topic)] = int(mentions or 0)
    return out


def get_entity_counts_between(db: Session, topic: str, start: datetime, end: datetime) -> dict[str, int]:
    stmt = (
        select(IntelItem.entity, func.count().label("mentions"))
        .where(IntelItem.topic == topic, IntelItem.published_at >= start, IntelItem.published_at < end)
        .group_by(IntelItem.entity)
    )
    out: dict[str, int] = {}
    for entity, mentions in db.execute(stmt).all():
        out[str(entity)] = int(mentions or 0)
    return out
