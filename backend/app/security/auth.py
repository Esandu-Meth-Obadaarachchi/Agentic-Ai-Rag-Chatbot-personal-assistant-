"""Auth dependency.

The single security gate on every non-public endpoint: verify the caller's
Firebase ID token and resolve their uid. Everything downstream trusts this uid
and never re-derives identity from the request body.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.security.firebase import verify_id_token

_bearer = HTTPBearer(auto_error=False)


@dataclass
class AuthedUser:
    uid: str
    email: str | None = None
    name: str | None = None
    picture: str | None = None


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> AuthedUser:
    """FastAPI dependency: require a valid `Authorization: Bearer <idToken>`."""
    if creds is None or not creds.credentials:
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        decoded = verify_id_token(creds.credentials)
    except Exception:  # noqa: BLE001 — any failure is an auth failure
        raise HTTPException(status_code=401, detail="Unauthorized") from None
    return AuthedUser(
        uid=decoded["uid"],
        email=decoded.get("email"),
        name=decoded.get("name"),
        picture=decoded.get("picture"),
    )
