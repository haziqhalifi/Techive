"""Application settings, loaded from environment / .env files.

Resolution order (later wins): defaults -> backend/.env -> repo-root .env -> real env vars.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "HARVEST"
    api_prefix: str = "/api/v1"
    log_level: str = "INFO"

    database_url: str = "postgresql+asyncpg://harvest:harvest@localhost:5433/harvest"

    # The LLM may only ever emit pill IDs and rationale codes — never numbers or guidance.
    llm_enabled: bool = False
    llm_provider: str = "openai"
    openai_api_key: str = ""
    openai_base_url: str = ""
    openai_model: str = "gpt-4o-mini"

    # Comma-separated list, e.g. "http://localhost:3000,https://harvest.example"
    cors_origins: str = "http://localhost:3000"

    # Demo identity: the console sends X-Role / X-User-Id headers (no real auth locally).
    demo_default_role: str = "aom"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
