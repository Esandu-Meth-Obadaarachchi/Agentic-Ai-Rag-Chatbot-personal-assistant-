"""FastAPI application entry point.

Phase 0 scaffold: the app boots and serves /health so the container and the
deployment pipeline can be proven before any RAG code exists. Config, Firebase
auth, and the LangGraph agent slot in on the feature branches that follow.
"""

from __future__ import annotations

from fastapi import FastAPI

app = FastAPI(title="Agentic RAG API", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe. Used by Docker, ECS, and load balancers."""
    return {"status": "ok"}


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "agentic-rag-api", "docs": "/docs", "health": "/health"}
