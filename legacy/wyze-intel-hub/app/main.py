from __future__ import annotations

import logging
import base64
import io
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import engine, get_db
from app.jobs import start_scheduler, stop_scheduler
from app.models import Base
from app.services.intelligence import run_full_ingestion
from app.services.repository import (
    complete_refresh_run,
    create_refresh_run,
    get_competitor_rollup,
    get_entity_counts_between,
    get_emerging_rollup,
    get_items_since,
    get_latest_items,
    get_topic_daily_counts,
    get_topic_counts_between,
    get_recent_hub_metrics,
    get_sentiment_timeseries,
    latest_successful_refresh_run,
    latest_refresh_run,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
BASE_DIR = Path(__file__).resolve().parent
PT = ZoneInfo("America/Los_Angeles")


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _fmt_pt(dt: datetime | None) -> str:
    if not dt:
        return "-"
    local = _ensure_utc(dt).astimezone(PT)
    month = local.strftime("%b")
    day = local.day
    time = local.strftime("%I:%M %p").lstrip("0")
    return f"{month} {day}, {time} PT"


def _fmt_age(dt: datetime | None, *, now: datetime) -> str:
    if not dt:
        return "-"
    delta = now - _ensure_utc(dt)
    seconds = max(0, int(delta.total_seconds()))
    if seconds < 90:
        return "just now"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes}m ago"
    hours = minutes // 60
    if hours < 36:
        return f"{hours}h ago"
    days = hours // 24
    return f"{days}d ago"


def _display_entity(entity: str) -> str:
    key = (entity or "").strip().lower()
    mapping = {
        "tp-link": "TP-Link",
        "tapo": "Tapo",
        "google nest": "Google Nest",
        "unifi protect": "UniFi Protect",
        "simplisafe": "SimpliSafe",
    }
    if key in mapping:
        return mapping[key]
    if not key:
        return "-"
    words: list[str] = []
    for part in key.replace("-", " ").split():
        if part in {"ai", "iot"}:
            words.append(part.upper())
        else:
            words.append(part[:1].upper() + part[1:])
    return " ".join(words)


# TV "brand marks" used in the Market Watch panel.
# These are intentionally simple, high-contrast monograms (10-foot UI) and do
# not rely on third-party logo image hosting.
_BRAND_MARK_PALETTE: dict[str, tuple[str, str]] = {
    "wyze": ("#7951D6", "#5B3BA8"),
    "ring": ("#38BDF8", "#0EA5E9"),
    "blink": ("#F59E0B", "#D97706"),
    "eufy": ("#22C55E", "#16A34A"),
    "tp-link": ("#14B8A6", "#0D9488"),
    "reolink": ("#EF4444", "#DC2626"),
    "arlo": ("#A78BFA", "#7C3AED"),
}

_BRAND_LOGO_DOMAINS: dict[str, str] = {
    # Main competitors
    "ring": "ring.com",
    "blink": "blinkforhome.com",
    "eufy": "eufy.com",
    "tp-link": "tp-link.com",
    "reolink": "reolink.com",
    "arlo": "arlo.com",
    # Emerging set (best-effort)
    "aqara": "aqara.com",
    "simplisafe": "simplisafe.com",
    "lorex": "lorex.com",
    "google nest": "nest.com",
    "xiaomi": "xiaomi.com",
    "hikvision": "hikvision.com",
    "dahua": "dahuasecurity.com",
    "unifi protect": "ui.com",
    "tapo": "tapo.com",
    "swann": "swann.com",
    "annke": "annke.com",
    "yi home": "yitechnology.com",
    "ecobee": "ecobee.com",
    "abode": "goabode.com",
    "canary": "canary.is",
    "deep sentinel": "deepsentinel.com",
}


def _brand_logo_url(entity: str) -> str:
    key = (entity or "").strip().lower()
    domain = _BRAND_LOGO_DOMAINS.get(key, "")
    if not domain:
        return ""
    return f"https://www.google.com/s2/favicons?domain={domain}&sz=128"


def _brand_mark_text(display: str) -> str:
    display = (display or "").strip()
    if not display:
        return "?"

    caps = [ch for ch in display if ch.isalpha() and ch.isupper()]
    if len(caps) >= 2:
        return (caps[0] + caps[1]).upper()

    cleaned = "".join(ch for ch in display if ch.isalnum())
    if not cleaned:
        return "?"
    return cleaned[:2].upper()


def _brand_mark(entity: str) -> dict[str, str]:
    key = (entity or "").strip().lower()
    display = _display_entity(entity)

    if key in _BRAND_MARK_PALETTE:
        bg1, bg2 = _BRAND_MARK_PALETTE[key]
    else:
        # Deterministic HSL fallback for emerging/unknown brands.
        # Keep it vibrant but still readable on the dark TV background.
        h = 0
        for ch in key:
            h = (h * 31 + ord(ch)) % 360
        bg1 = f"hsl({h} 72% 52%)"
        bg2 = f"hsl({(h + 18) % 360} 72% 38%)"

    return {
        "text": _brand_mark_text(display),
        "bg1": bg1,
        "bg2": bg2,
        "title": display,
    }


def _delta_badge(current: int, previous: int) -> dict:
    delta = int(current) - int(previous)
    if delta > 0:
        arrow = "▲"
        cls = ""
    elif delta < 0:
        arrow = "▼"
        cls = "is-down"
    else:
        arrow = "•"
        cls = "is-flat"

    if previous > 0:
        pct = (delta / previous) * 100.0
        text = f"{arrow} {delta:+d} ({pct:+.0f}%)"
    else:
        if delta > 0:
            text = f"{arrow} {delta:+d} (new)"
        else:
            text = f"{arrow} {delta:+d}"
    return {"text": text, "class": cls, "delta": delta}


def _qr_svg_data_uri(url: str) -> str:
    # Pure-Python QR -> base64 SVG data URI.
    import segno

    qr = segno.make(url, error="m")
    buf = io.BytesIO()
    qr.save(buf, kind="svg", scale=3, border=2, dark="black", light="white")
    svg = buf.getvalue()
    b64 = base64.b64encode(svg).decode("ascii")
    return f"data:image/svg+xml;base64,{b64}"


def _abs_url(request: Request, path: str) -> str:
    base = str(request.base_url).rstrip("/")
    return f"{base}{path}"


def _build_tv_context(request: Request, db: Session, settings: Settings) -> dict:
    now = _now_utc()

    last_run = latest_refresh_run(db)
    last_success = latest_successful_refresh_run(db)

    success_dt = last_success.completed_at if last_success else None
    last_success_age = (now - _ensure_utc(success_dt)).total_seconds() if success_dt else None
    is_stale = not success_dt or bool(last_success_age and last_success_age > settings.stale_after_hours * 3600)

    pipeline_label = "No data"
    pipeline_class = "is-warning"
    last_refresh_dt = last_run.completed_at if last_run and last_run.completed_at else (last_run.started_at if last_run else None)

    if last_run:
        if last_run.status == "success":
            pipeline_label = "Success"
            pipeline_class = "is-success" if not is_stale else "is-warning"
        elif last_run.status == "failed":
            pipeline_label = "Error"
            pipeline_class = "is-danger"
        elif last_run.status == "running":
            pipeline_label = "Refreshing"
            pipeline_class = "is-info"
        else:
            pipeline_label = str(last_run.status or "Unknown").title()
            pipeline_class = "is-warning"

    header = {
        "pipeline_label": pipeline_label,
        "pipeline_class": pipeline_class,
        "last_refresh_pt": _fmt_pt(last_refresh_dt),
        "last_refresh_ago": _fmt_age(last_refresh_dt, now=now) if last_refresh_dt else "",
    }

    banner = None
    if last_run and last_run.status == "failed":
        banner = {
            "class": "is-danger",
            "headline": "REFRESH FAILED",
            "details": f"Last success: {_fmt_pt(success_dt)}",
            "badge_text": "ACTION: Check pipeline",
            "badge_class": "is-danger",
        }
    elif is_stale:
        banner = {
            "class": "",
            "headline": "DATA STALE",
            "details": f"Last success: {_fmt_pt(success_dt)}",
            "badge_text": "ACTION: Trigger refresh",
            "badge_class": "is-warning",
        }

    # KPI counts + deltas (24h vs prior 24h)
    start_24h = now - timedelta(hours=24)
    start_48h = now - timedelta(hours=48)
    curr_counts = get_topic_counts_between(db, start=start_24h, end=now)
    prev_counts = get_topic_counts_between(db, start=start_48h, end=start_24h)

    def kpi(topic: str, label: str, note: str) -> dict:
        current = int(curr_counts.get(topic, 0))
        previous = int(prev_counts.get(topic, 0))
        return {
            "label": label,
            "value": current,
            "note": note,
            "delta": _delta_badge(current, previous),
        }

    kpis = [
        {"key": "wyze", **kpi("wyze", "Wyze Mentions (24h)", "News + public discussions")},
        {"key": "sentiment", **kpi("sentiment", "Sentiment Posts (24h)", "High-engagement forum posts")},
        {"key": "competitor", **kpi("competitor", "Competitor Mentions (24h)", "Ring, Blink, Eufy, TP-Link, Reolink, Arlo")},
        {"key": "emerging", **kpi("emerging", "Emerging Mentions (24h)", "AI monitoring + smart security players")},
    ]

    # 30-day daily trendlines (sparklines) for each area.
    def fill_30d(topic: str) -> list[int]:
        raw = get_topic_daily_counts(db, topic=topic, days=30)
        by_day = {str(r.get("day")): int(r.get("mentions") or 0) for r in raw}
        start_day = (now - timedelta(days=29)).date()
        out: list[int] = []
        for i in range(30):
            d = (start_day + timedelta(days=i)).isoformat()
            out.append(int(by_day.get(d, 0)))
        return out

    sparks = {t: fill_30d(t) for t in ["wyze", "sentiment", "competitor", "emerging"]}

    # Sentiment set (30d) for top lists + mix.
    sentiment_items_30d = get_items_since(db, topic="sentiment", since=now - timedelta(days=30), limit=2000, order_by="published")
    sentiment_mix = {
        "positive": sum(1 for it in sentiment_items_30d if float(it.sentiment_score or 0.0) >= 0.2),
        "negative": sum(1 for it in sentiment_items_30d if float(it.sentiment_score or 0.0) <= -0.2),
        "neutral": 0,
        "avg7d": "+0.00",
    }
    sentiment_mix["neutral"] = len(sentiment_items_30d) - sentiment_mix["positive"] - sentiment_mix["negative"]

    sentiment_items_7d = [it for it in sentiment_items_30d if _ensure_utc(it.published_at) >= now - timedelta(days=7)]
    if sentiment_items_7d:
        avg7d = sum(float(it.sentiment_score or 0.0) for it in sentiment_items_7d) / max(1, len(sentiment_items_7d))
        sentiment_mix["avg7d"] = f"{avg7d:+.2f}"

    # Competitor/emerging spikes (24h vs prior 24h)
    comp_curr = get_entity_counts_between(db, topic="competitor", start=start_24h, end=now)
    comp_prev = get_entity_counts_between(db, topic="competitor", start=start_48h, end=start_24h)
    em_curr = get_entity_counts_between(db, topic="emerging", start=start_24h, end=now)
    em_prev = get_entity_counts_between(db, topic="emerging", start=start_48h, end=start_24h)

    def spikes(curr: dict[str, int], prev: dict[str, int]) -> list[dict]:
        rows = []
        for ent in sorted(set(curr) | set(prev)):
            c = int(curr.get(ent, 0))
            p = int(prev.get(ent, 0))
            badge = _delta_badge(c, p)
            mark = _brand_mark(ent)
            rows.append(
                {
                    "entity": ent,
                    "entity_display": _display_entity(ent),
                    "current": c,
                    "previous": p,
                    "delta": badge["delta"],
                    "delta_text": badge["text"],
                    "delta_class": badge["class"],
                    "logo_url": _brand_logo_url(ent),
                    "mark_text": mark["text"],
                    "mark_bg1": mark["bg1"],
                    "mark_bg2": mark["bg2"],
                    "mark_title": mark["title"],
                }
            )
        rows.sort(key=lambda r: (r["delta"], r["current"]), reverse=True)
        return rows

    tv_competitor_spikes = spikes(comp_curr, comp_prev)
    tv_emerging_spikes = spikes(em_curr, em_prev)

    # Rolling "latest feed" (news + discussions across all topics).
    def feed_items() -> list[dict]:
        out: list[dict] = []

        def add(topic: str, label: str, items: list) -> None:
            for it in items:
                row = {
                    "topic_key": topic,
                    "topic_label": label,
                    "title": str(it.title or "").strip(),
                    "source_name": str(it.source_name or "").strip(),
                    "age": _fmt_age(it.published_at, now=now),
                    "published_at": _ensure_utc(it.published_at) if getattr(it, "published_at", None) else now,
                    "entity_display": "",
                }
                if topic in {"competitor", "emerging"}:
                    row["entity_display"] = _display_entity(str(it.entity or "").strip())
                out.append(row)

        add("wyze", "Wyze", get_latest_items(db, topic="wyze", limit=12))
        add("sentiment", "Sentiment", get_latest_items(db, topic="sentiment", limit=12))
        add("competitor", "Competitors", get_latest_items(db, topic="competitor", limit=12))
        add("emerging", "Emerging", get_latest_items(db, topic="emerging", limit=12))

        out.sort(key=lambda r: r["published_at"], reverse=True)
        return out[:32]

    ticker_items = feed_items()

    def item_dict(it, *, include_entity: bool = False) -> dict:
        row = {
            "title": str(it.title or "").strip(),
            "url": str(it.url or "").strip(),
            "source_name": str(it.source_name or "").strip(),
            "engagement_score": int(it.engagement_score or 0),
            "sentiment_score": float(it.sentiment_score or 0.0),
            "age": _fmt_age(it.published_at, now=now),
        }
        if include_entity:
            row["entity"] = str(it.entity or "").strip()
            row["entity_display"] = _display_entity(row["entity"])
        return row

    # Main page panels (no scrolling; top-N only)
    wyze_candidates = get_items_since(db, topic="wyze", since=now - timedelta(hours=48), limit=120, order_by="relevance")
    if len(wyze_candidates) < 5:
        wyze_candidates = get_latest_items(db, topic="wyze", limit=40)
    tv_wyze_signals = [item_dict(it) for it in wyze_candidates[:4]]

    neg_posts = [it for it in sentiment_items_30d if float(it.sentiment_score or 0.0) <= -0.2]
    pos_posts = [it for it in sentiment_items_30d if float(it.sentiment_score or 0.0) >= 0.2]
    neg_posts.sort(key=lambda it: (int(it.engagement_score or 0), _ensure_utc(it.published_at)), reverse=True)
    pos_posts.sort(key=lambda it: (int(it.engagement_score or 0), _ensure_utc(it.published_at)), reverse=True)

    tv_sentiment_negative = [item_dict(it) for it in neg_posts[:4]]
    tv_sentiment_positive = [item_dict(it) for it in pos_posts[:4]]

    # Competitor/emerging lists
    tv_competitor_latest = [item_dict(it, include_entity=True) for it in get_latest_items(db, topic="competitor", limit=7)]
    tv_emerging_latest = [item_dict(it, include_entity=True) for it in get_latest_items(db, topic="emerging", limit=7)]

    # Rollups (enriched for display)
    competitor_rollup = []
    for row in get_competitor_rollup(db, window_days=7)[:12]:
        avg = float(row.get("avg_sentiment") or 0.0)
        if avg >= 0.2:
            sentiment_class = "is-positive"
            sentiment_label = "positive"
        elif avg <= -0.2:
            sentiment_class = "is-negative"
            sentiment_label = "negative"
        else:
            sentiment_class = "is-neutral"
            sentiment_label = "neutral"
        competitor_rollup.append(
            {
                "entity": row.get("entity", ""),
                "entity_display": _display_entity(str(row.get("entity", ""))),
                "mentions": int(row.get("mentions") or 0),
                "avg_sentiment": f"{avg:+.2f}",
                "sentiment_class": sentiment_class,
                "sentiment_label": sentiment_label,
            }
        )

    emerging_rollup = []
    for row in get_emerging_rollup(db, window_days=14)[:12]:
        emerging_rollup.append(
            {
                "entity": row.get("entity", ""),
                "entity_display": _display_entity(str(row.get("entity", ""))),
                "mentions": int(row.get("mentions") or 0),
                "max_relevance": f"{float(row.get('max_relevance') or 0.0):.2f}",
            }
        )

    # QR codes point to the non-TV dashboards for click-free exploration.
    qrs = {
        "wyze": _qr_svg_data_uri(_abs_url(request, "/dashboards/wyze")),
        "sentiment": _qr_svg_data_uri(_abs_url(request, "/dashboards/sentiment")),
        "competitors": _qr_svg_data_uri(_abs_url(request, "/dashboards/competitors")),
        "emerging": _qr_svg_data_uri(_abs_url(request, "/dashboards/emerging")),
    }

    return {
        "request": request,
        "page_title": "TV Mode",
        "tv": {
            "rotation_seconds": settings.tv_rotation_seconds,
            "ticker_seconds": settings.tv_ticker_seconds,
            "burnin_shift_seconds": settings.tv_burnin_shift_seconds,
            "reload_seconds": settings.tv_reload_seconds,
        },
        "header": header,
        "banner": banner,
        "kpis": kpis,
        "ticker_items": ticker_items,
        "sparks": sparks,
        "qrs": qrs,
        "tv_wyze_signals": tv_wyze_signals,
        "tv_sentiment_negative": tv_sentiment_negative,
        "tv_sentiment_positive": tv_sentiment_positive,
        "tv_competitor_spikes": tv_competitor_spikes,
        "tv_emerging_spikes": tv_emerging_spikes,
        "tv_competitor_latest": tv_competitor_latest[:4],
        "tv_emerging_latest": tv_emerging_latest[:4],
        "competitor_rollup": competitor_rollup,
        "emerging_rollup": emerging_rollup,
        "sentiment_mix": sentiment_mix,
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="Wyze Intel Hub", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok", "ts": _now_utc().isoformat()}


@app.get("/", response_class=HTMLResponse)
def intel_hub(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    if (request.query_params.get("mode") or "").strip().lower() == "tv":
        return templates.TemplateResponse("tv.html", _build_tv_context(request, db, settings))

    context = {
        "request": request,
        "page_title": "Main Intel Hub",
        "metrics": get_recent_hub_metrics(db, hours=24),
        "last_refresh": latest_refresh_run(db),
        "wyze_latest": get_latest_items(db, topic="wyze", limit=8),
        "sentiment_latest": get_latest_items(db, topic="sentiment", limit=8),
        "competitor_latest": get_latest_items(db, topic="competitor", limit=8),
        "emerging_latest": get_latest_items(db, topic="emerging", limit=8),
    }
    return templates.TemplateResponse("hub.html", context)


@app.get("/tv", response_class=HTMLResponse)
def tv_mode(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    return templates.TemplateResponse("tv.html", _build_tv_context(request, db, settings))


@app.get("/dashboards/wyze", response_class=HTMLResponse)
def wyze_dashboard(request: Request, db: Session = Depends(get_db)):
    items = get_latest_items(db, topic="wyze", limit=80)
    return templates.TemplateResponse(
        "wyze.html",
        {
            "request": request,
            "page_title": "Wyze Latest Uses & Mentions",
            "items": items,
            "last_refresh": latest_refresh_run(db),
        },
    )


@app.get("/dashboards/sentiment", response_class=HTMLResponse)
def sentiment_dashboard(request: Request, db: Session = Depends(get_db)):
    window_days = 30
    since = datetime.now(UTC) - timedelta(days=window_days)

    items = get_items_since(db, topic="sentiment", since=since, limit=600)
    displayed_items = items[:50]
    positive_count = sum(1 for item in items if item.sentiment_score >= 0.2)
    negative_count = sum(1 for item in items if item.sentiment_score <= -0.2)
    neutral_count = len(items) - positive_count - negative_count
    top_positive = sorted(items, key=lambda x: (x.sentiment_score, x.engagement_score), reverse=True)[:8]
    top_negative = sorted(items, key=lambda x: (x.sentiment_score, -x.engagement_score))[:8]

    return templates.TemplateResponse(
        "sentiment.html",
        {
            "request": request,
            "page_title": "Consumer Sentiment",
            "window_days": window_days,
            "total_items_count": len(items),
            "items": displayed_items,
            "positive_count": positive_count,
            "negative_count": negative_count,
            "neutral_count": neutral_count,
            "top_positive": top_positive,
            "top_negative": top_negative,
            "timeseries": get_sentiment_timeseries(db, days=window_days),
            "last_refresh": latest_refresh_run(db),
        },
    )


@app.get("/dashboards/competitors", response_class=HTMLResponse)
def competitor_dashboard(request: Request, db: Session = Depends(get_db)):
    rollup = get_competitor_rollup(db, window_days=7)
    items = get_latest_items(db, topic="competitor", limit=120)
    return templates.TemplateResponse(
        "competitors.html",
        {
            "request": request,
            "page_title": "Main Competitor Tracker",
            "rollup": rollup,
            "items": items,
            "last_refresh": latest_refresh_run(db),
        },
    )


@app.get("/dashboards/emerging", response_class=HTMLResponse)
def emerging_dashboard(request: Request, db: Session = Depends(get_db)):
    rollup = get_emerging_rollup(db, window_days=14)
    items = get_latest_items(db, topic="emerging", limit=120)

    return templates.TemplateResponse(
        "emerging.html",
        {
            "request": request,
            "page_title": "Emerging Competitor Watch",
            "rollup": rollup,
            "items": items,
            "last_refresh": latest_refresh_run(db),
        },
    )


@app.get("/api/sentiment/timeseries")
def sentiment_timeseries_api(days: int = 30, db: Session = Depends(get_db)):
    days = max(1, min(int(days), 60))
    return JSONResponse({"series": get_sentiment_timeseries(db, days=days)})


@app.post("/admin/refresh")
def manual_refresh(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    token = request.headers.get("x-intel-token")
    expected = getattr(settings, "admin_token", None)

    if expected and token != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")

    run = create_refresh_run(db)
    try:
        stats = run_full_ingestion(db, settings)
        message = (
            f"Inserted {stats.inserted}, updated {stats.updated}, skipped {stats.skipped}, "
            f"deleted_old {stats.deleted_old}, errors {stats.errors}"
        )
        complete_refresh_run(db, run, status="success", message=message, items_ingested=stats.inserted)
    except Exception as exc:
        db.rollback()
        logger.exception("Manual refresh failed")
        complete_refresh_run(db, run, status="failed", message=str(exc), items_ingested=0)
        raise HTTPException(status_code=500, detail="Refresh failed") from exc

    return {"status": "ok", "message": message}
