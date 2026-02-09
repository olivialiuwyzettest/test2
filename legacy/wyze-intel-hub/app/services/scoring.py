from datetime import UTC, datetime


def normalize_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def relevance_score(published_at: datetime, engagement_score: int = 0, query_bonus: float = 0.0) -> float:
    now = datetime.now(UTC)
    published_at = normalize_datetime(published_at)
    age_hours = max((now - published_at).total_seconds() / 3600.0, 0.0)

    recency_component = max(0.0, 1.0 - min(age_hours / 72.0, 1.0))
    engagement_component = min(max(engagement_score, 0) / 500.0, 1.0)

    score = (0.72 * recency_component) + (0.23 * engagement_component) + (0.05 * query_bonus)
    return round(min(max(score, 0.0), 1.0), 4)
