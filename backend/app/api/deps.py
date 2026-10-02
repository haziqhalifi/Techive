"""Shared FastAPI dependencies, re-exported for routers."""

from app.core.db import get_session
from app.core.security import get_role, get_user_id

__all__ = ["get_session", "get_role", "get_user_id"]
