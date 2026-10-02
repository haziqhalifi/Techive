"""Small JSON helpers for reading raw SQL results.

asyncpg returns `json`/`jsonb` columns as strings for untyped `text()` queries, so every
JSON column read through raw SQL must be normalised before use.
"""

from __future__ import annotations

import json
from typing import Any


def loads_if_str(value: Any, default: Any = None) -> Any:
    """Decode a JSON string; pass through anything already decoded.

    Returns `default` for None or unparseable input rather than raising.
    """
    if value is None:
        return default
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return default
    return value


def as_list(value: Any) -> list:
    decoded = loads_if_str(value, default=[])
    return decoded if isinstance(decoded, list) else []


def as_dict(value: Any) -> dict:
    decoded = loads_if_str(value, default={})
    return decoded if isinstance(decoded, dict) else {}
