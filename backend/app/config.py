"""Application settings.

Loaded from environment variables (and a local .env in dev) via pydantic-settings.
Env var names deliberately match the frontend (second-brain/.env.local) so both
halves of the app authenticate against the same Firebase project and hit the same
Pinecone index and models.
"""

from __future__ import annotations

import os
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_env: str = "dev"

    # --- Anthropic: generation + agent reasoning ---
    anthropic_api_key: str | None = None
    claude_model: str = "claude-haiku-4-5"       # generation + the agent tool loop
    claude_fast_model: str = "claude-haiku-4-5"  # rewrite / grade / grounded checks

    # --- Voyage: embeddings + cross-encoder reranking ---
    voyage_api_key: str | None = None
    voyage_embed_model: str = "voyage-3.5"
    voyage_rerank_model: str = "rerank-2.5"
    embed_dim: int = 1024

    # --- Pinecone: vector store (one namespace per project) ---
    pinecone_api_key: str | None = None
    pinecone_index_name: str = "second-brain"

    # --- Firebase Admin: auth + Firestore ---
    firebase_admin_project_id: str | None = None
    firebase_admin_client_email: str | None = None
    firebase_admin_private_key: str | None = None

    # --- LangSmith: optional tracing ---
    langsmith_tracing: bool = False
    langsmith_api_key: str | None = None
    langsmith_project: str = "agentic-rag-aws"

    # --- CORS: comma-separated frontend origins ---
    cors_origins: str = "http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_dev(self) -> bool:
        return self.app_env == "dev"


@lru_cache
def get_settings() -> Settings:
    """Cached singleton so the .env is read once per process.

    Also propagates the langsmith_* settings into the real process environment as
    the LANGCHAIN_* names LangChain/LangGraph actually check for auto-tracing.
    Without this, LANGSMITH_TRACING=true in .env would sit unused in the Settings
    object — pydantic-settings reads .env into attributes, it does not export them
    back to os.environ, and LangChain reads os.environ directly.
    """
    settings = Settings()
    if settings.langsmith_tracing:
        os.environ.setdefault("LANGCHAIN_TRACING_V2", "true")
        if settings.langsmith_api_key:
            os.environ.setdefault("LANGCHAIN_API_KEY", settings.langsmith_api_key)
        os.environ.setdefault("LANGCHAIN_PROJECT", settings.langsmith_project)
    return settings
