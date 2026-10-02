"""FastAPI application factory.

Run locally:
    python -m uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api import agents, audit, cases, demo, health, pills
from app.core.config import get_settings
from app.core.db import dispose_engine
from app.core.errors import install_error_handlers
from app.core.logging import configure_logging, get_logger


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    log = get_logger("app.lifespan")
    settings = get_settings()
    log.info(
        "HARVEST {} starting — llm_enabled={} data=synthetic",
        __version__,
        settings.llm_enabled,
    )
    yield
    await dispose_engine()
    log.info("HARVEST shut down cleanly")


def create_app() -> FastAPI:
    configure_logging()
    settings = get_settings()

    app = FastAPI(
        title="HARVEST — Tower K Energy & Comfort Pill",
        description=(
            "Governed Intelligence Pills for cooling and comfort. "
            "The AI never writes guidance: it selects an approved pill by ID, numbers are "
            "computed in code, and a human approves anything that acts. "
            "All data is synthetic."
        ),
        version=__version__,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    install_error_handlers(app)

    for router in (
        health.router,
        pills.router,
        cases.router,
        agents.router,
        audit.router,
        demo.router,
    ):
        app.include_router(router, prefix=settings.api_prefix)

    return app


app = create_app()
