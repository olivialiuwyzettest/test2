from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger

from app.config import get_settings
from app.db import SessionLocal
from app.services.intelligence import run_full_ingestion
from app.services.repository import complete_refresh_run, create_refresh_run

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


def _run_refresh_job() -> None:
    settings = get_settings()
    with SessionLocal() as db:
        run = create_refresh_run(db)
        try:
            stats = run_full_ingestion(db, settings)
            message = (
                f"Inserted {stats.inserted}, updated {stats.updated}, skipped {stats.skipped}, "
                f"deleted_old {stats.deleted_old}, errors {stats.errors}"
            )
            complete_refresh_run(db, run, status="success", message=message, items_ingested=stats.inserted)
            logger.info("Intel refresh completed: %s", message)
        except Exception as exc:
            db.rollback()
            logger.exception("Intel refresh failed")
            complete_refresh_run(db, run, status="failed", message=str(exc), items_ingested=0)


def start_scheduler() -> AsyncIOScheduler:
    global _scheduler

    if _scheduler and _scheduler.running:
        return _scheduler

    settings = get_settings()
    scheduler = AsyncIOScheduler(timezone=settings.timezone)

    scheduler.add_job(
        _run_refresh_job,
        trigger=CronTrigger(hour=settings.daily_refresh_hour, minute=settings.daily_refresh_minute),
        id="daily_intel_refresh",
        replace_existing=True,
    )

    if settings.run_refresh_on_startup:
        scheduler.add_job(
            _run_refresh_job,
            trigger=DateTrigger(run_date=datetime.now(UTC) + timedelta(seconds=3)),
            id="startup_intel_refresh",
            replace_existing=True,
        )

    scheduler.start()
    _scheduler = scheduler
    logger.info(
        "Scheduler started. Daily refresh at %02d:%02d %s",
        settings.daily_refresh_hour,
        settings.daily_refresh_minute,
        settings.timezone,
    )
    return scheduler


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        _scheduler = None
