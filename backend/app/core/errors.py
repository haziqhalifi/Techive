"""Typed error envelope.

Domain errors raise HarvestError and are rendered as:
    {"error": {"code": "...", "message": "...", "details": {...}}}
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import InterfaceError, OperationalError

from app.core.logging import get_logger

log = get_logger("core.errors")


class HarvestError(Exception):
    """Base class for expected, client-visible domain errors."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}


class NotFound(HarvestError):
    def __init__(self, entity: str, entity_id: str) -> None:
        super().__init__(
            code="not_found",
            message=f"{entity} '{entity_id}' was not found.",
            status_code=404,
            details={"entity": entity, "id": entity_id},
        )


class ValidationFailure(HarvestError):
    """A pill or claim failed a governance rule (e.g. FR-02 provenance)."""

    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(
            code="validation_failure",
            message=message,
            status_code=422,
            details=details,
        )


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(HarvestError)
    async def _harvest_error_handler(_: Request, exc: HarvestError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code, "message": exc.message, "details": exc.details}},
        )

    @app.exception_handler(OperationalError)
    @app.exception_handler(InterfaceError)
    @app.exception_handler(ConnectionError)  # builtin — asyncpg raises ConnectionRefusedError raw
    async def _db_unavailable_handler(_: Request, exc: Exception) -> JSONResponse:
        """The database is unreachable — a setup problem, not a bug in the request."""
        log.warning("database unavailable: {}", exc)
        return JSONResponse(
            status_code=503,
            content={
                "error": {
                    "code": "database_unavailable",
                    "message": (
                        "The database is not reachable. Start it with "
                        "`docker compose up -d db` and try again."
                    ),
                    "details": {},
                }
            },
        )

    @app.exception_handler(Exception)
    async def _unhandled_handler(_: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error: {}", exc)
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "internal_error",
                    "message": "An unexpected error occurred.",
                    "details": {},
                }
            },
        )
