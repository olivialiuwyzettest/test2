from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Wyze External Intel Hub"
    database_url: str = "sqlite:///./intel.db"
    timezone: str = "America/Los_Angeles"
    daily_refresh_hour: int = 6
    daily_refresh_minute: int = 0
    run_refresh_on_startup: bool = True
    item_retention_days: int = 30
    max_items_per_query: int = 30
    high_engagement_score: int = 20
    high_engagement_comments: int = 10
    reddit_user_agent: str = "wyze-intel-monitor/1.0"
    admin_token: str | None = None
    stale_after_hours: int = 48

    tv_rotation_seconds: int = 20
    tv_ticker_seconds: int = 30
    tv_burnin_shift_seconds: int = 240
    tv_reload_seconds: int = 600

    main_competitors: list[str] = [
        "ring",
        "blink",
        "eufy",
        "tp-link",
        "reolink",
        "arlo",
    ]

    emerging_competitor_candidates: list[str] = [
        "aqara",
        "simpliSafe",
        "lorex",
        "google nest",
        "xiaomi",
        "hikvision",
        "dahua",
        "unifi protect",
        "tapo",
        "swann",
        "annke",
        "yi home",
        "ecobee",
        "abode",
        "canary",
        "deep sentinel",
    ]

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


@lru_cache
def get_settings() -> Settings:
    return Settings()
