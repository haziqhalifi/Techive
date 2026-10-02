"""Structured logging via loguru.

Every graph node logs entry, exit and latency, so a demo run is fully traceable.
"""

from __future__ import annotations

import sys

from loguru import logger

from app.core.config import get_settings

_FORMAT = (
    "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
    "<level>{level: <8}</level> | "
    "<cyan>{extra[component]}</cyan> | <level>{message}</level>"
)


def configure_logging() -> None:
    settings = get_settings()
    logger.remove()
    logger.configure(extra={"component": "app"})
    logger.add(
        sys.stderr,
        level=settings.log_level.upper(),
        format=_FORMAT,
        backtrace=False,
        diagnose=False,
        enqueue=False,
    )


def get_logger(component: str):
    """Return a logger bound to a component name (e.g. 'node.parse_case')."""
    return logger.bind(component=component)
