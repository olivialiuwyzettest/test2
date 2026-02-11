from __future__ import annotations

from functools import lru_cache
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "wbr-deck-agent"

    provider: str = Field(default="auto", alias="WBR_PROVIDER")  # auto|openai|anthropic

    openai_api_key: Optional[str] = Field(default=None, alias="OPENAI_API_KEY")
    openai_model: str = Field(default="gpt-4o-mini", alias="WBR_OPENAI_MODEL")

    anthropic_api_key: Optional[str] = Field(default=None, alias="ANTHROPIC_API_KEY")
    anthropic_model: str = Field(default="claude-3-5-sonnet-latest", alias="WBR_ANTHROPIC_MODEL")

    mock_mode: Optional[bool] = Field(default=None, alias="WBR_MOCK_MODE")

    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )

    def effective_provider(self) -> str:
        p = (self.provider or "auto").strip().lower()
        if p in ("anthropic", "claude"):
            return "anthropic"
        if p == "openai":
            return "openai"
        # auto
        if self.openai_api_key:
            return "openai"
        if self.anthropic_api_key:
            return "anthropic"
        return "openai"

    def effective_model(self) -> str:
        return self.anthropic_model if self.effective_provider() == "anthropic" else self.openai_model

    def effective_mock_mode(self) -> bool:
        if self.mock_mode is not None:
            return bool(self.mock_mode)
        provider = self.effective_provider()
        if provider == "anthropic":
            return not bool(self.anthropic_api_key)
        return not bool(self.openai_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
