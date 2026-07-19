"""Public health + root endpoints. No auth."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    """Liveness probe. Used by Docker, ECS, and load balancers."""
    return {"status": "ok"}


@router.get("/")
def root() -> dict[str, str]:
    return {"service": "agentic-rag-api", "docs": "/docs", "health": "/health"}
