"""Firebase Admin bootstrap — server only.

Verifies caller ID tokens and hands out a Firestore client. Mirrors the
frontend's admin.ts: it reads the same service-account env vars, so the API and
the UI authenticate against the same Firebase project. Never import this into
client code.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

import firebase_admin
from firebase_admin import auth as fb_auth
from firebase_admin import credentials, firestore

from app.config import get_settings


@lru_cache
def _app() -> firebase_admin.App:
    """Initialise (once) the Firebase Admin app from the service-account env vars."""
    if firebase_admin._apps:  # already initialised in this process
        return firebase_admin.get_app()

    settings = get_settings()
    project_id = settings.firebase_admin_project_id
    client_email = settings.firebase_admin_client_email
    private_key = settings.firebase_admin_private_key

    if not (project_id and client_email and private_key):
        raise RuntimeError(
            "Firebase Admin is not configured. Set FIREBASE_ADMIN_PROJECT_ID, "
            "FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY."
        )

    cred = credentials.Certificate(
        {
            "type": "service_account",
            "project_id": project_id,
            "client_email": client_email,
            # .env keeps the literal \n escapes; the SDK needs real newlines.
            "private_key": private_key.replace("\\n", "\n"),
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    )
    return firebase_admin.initialize_app(cred)


def verify_id_token(id_token: str) -> dict[str, Any]:
    """Verify a Firebase ID token. Raises on an invalid/expired token."""
    return fb_auth.verify_id_token(id_token, app=_app())


@lru_cache
def get_db() -> firestore.firestore.Client:
    """Cached Firestore client bound to the admin app."""
    return firestore.client(_app())
