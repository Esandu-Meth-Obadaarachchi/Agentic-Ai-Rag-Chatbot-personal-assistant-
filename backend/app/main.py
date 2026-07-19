"""FastAPI application entry point.

Wires CORS (so the Next.js frontend can call the API cross-origin with a Bearer
token) and mounts the routers. Health is public; /api/* requires a valid Firebase
ID token. The RAG implementation behind /api/chat, /api/ingest and /api/related
lands on the feature branches that follow.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import chat, health, ingest, related

settings = get_settings()

app = FastAPI(title="Agentic RAG API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, tags=["health"])
app.include_router(chat.router, prefix="/api", tags=["chat"])
app.include_router(ingest.router, prefix="/api", tags=["ingest"])
app.include_router(related.router, prefix="/api", tags=["related"])
