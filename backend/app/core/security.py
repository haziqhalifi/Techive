"""Access control — deny by default.

There is no real authentication in the local demo. The console identifies itself with
`X-Role` and `X-User-Id` headers. An unknown or missing role is rejected with 403 —
nothing is allowed unless a recognised role is presented.

Production would replace this with Supabase Auth (JWT) + Row Level Security; see
docs/DECISIONS.md.
"""

from __future__ import annotations

from collections.abc import Callable

from fastapi import Depends, Header, HTTPException, status

from app.models.enums import Role

_ROLE_HEADER = "X-Role"
_USER_HEADER = "X-User-Id"


def get_role(
    x_role: str | None = Header(default=None, alias=_ROLE_HEADER),
) -> Role:
    """Resolve the caller's role. Missing or unknown role -> 403 (deny by default)."""
    if not x_role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Missing {_ROLE_HEADER} header — access is denied by default.",
        )
    try:
        return Role(x_role.strip().lower())
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Unknown role '{x_role}'.",
        ) from exc


def get_user_id(
    x_user_id: str | None = Header(default=None, alias=_USER_HEADER),
) -> str | None:
    """Optional actor id, recorded in the audit trail."""
    return x_user_id.strip() if x_user_id else None


def require_role(*allowed: Role) -> Callable[[Role], Role]:
    """Dependency factory: allow only the listed roles."""

    def _dependency(role: Role = Depends(get_role)) -> Role:
        if role not in allowed:
            permitted = ", ".join(sorted(r.value for r in allowed))
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{role.value}' may not perform this action. Permitted: {permitted}.",
            )
        return role

    return _dependency


# Convenience guards used by the routers.
ANY_ROLE = require_role(*Role)
CAN_RUN_CASES = require_role(Role.AOM, Role.SITE_OPERATOR, Role.CHIEF_ENGINEER)
CAN_APPROVE = require_role(Role.PILL_REVIEWER)
CAN_READ_AUDIT = require_role(Role.GOVERNANCE_ADMIN, Role.PILL_REVIEWER)
