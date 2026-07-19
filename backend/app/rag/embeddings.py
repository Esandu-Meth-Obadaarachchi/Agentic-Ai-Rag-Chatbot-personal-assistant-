"""Voyage embeddings, via LangChain.

Claude has no embedding model, so retrieval runs on Voyage — the same choice as
the TypeScript app. voyage-3.5 returns 1024-dim vectors by default, which matches
the existing Pinecone index, so this backend reads the data the TS app already
wrote. LangChain's VoyageAIEmbeddings sets input_type="query" for embed_query and
"document" for embed_documents, exactly as the two-sided retrieval needs.
"""

from __future__ import annotations

from functools import lru_cache

from langchain_voyageai import VoyageAIEmbeddings

from app.config import get_settings


@lru_cache
def get_embeddings() -> VoyageAIEmbeddings:
    settings = get_settings()
    return VoyageAIEmbeddings(
        model=settings.voyage_embed_model,   # voyage-3.5 -> 1024-dim
        api_key=settings.voyage_api_key,
        batch_size=96,
    )


def embed_query(text: str) -> list[float]:
    return get_embeddings().embed_query(text)


def embed_documents(texts: list[str]) -> list[list[float]]:
    return get_embeddings().embed_documents(texts)
