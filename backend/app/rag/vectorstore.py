"""Pinecone vector store.

Each project owns a namespace (project.ragNamespace), so every project's knowledge
stays isolated inside one index. This talks to the Pinecone client directly rather
than through LangChain's VectorStore, because the read path merges hits across
several project namespaces in one query — the isolation model the app depends on,
which a single-namespace VectorStore wrapper does not express cleanly.
"""

from __future__ import annotations

from functools import lru_cache
from math import ceil
from typing import Any

from pinecone import Pinecone

from app.config import get_settings
from app.models import RetrievedChunk


@lru_cache
def _index():
    settings = get_settings()
    if not settings.pinecone_api_key:
        raise RuntimeError("PINECONE_API_KEY is not set.")
    pc = Pinecone(api_key=settings.pinecone_api_key)
    return pc.Index(settings.pinecone_index_name)


def upsert_chunks(namespace: str, vectors: list[dict[str, Any]]) -> None:
    """Upsert vectors ({id, values, metadata}) into a project namespace, batched."""
    index = _index()
    batch = 100
    for i in range(0, len(vectors), batch):
        index.upsert(vectors=vectors[i : i + batch], namespace=namespace)


def query_namespace(namespace: str, vector: list[float], top_k: int = 5) -> list[RetrievedChunk]:
    res = _index().query(
        namespace=namespace, vector=vector, top_k=top_k, include_metadata=True
    )
    chunks: list[RetrievedChunk] = []
    for match in res.matches or []:
        meta = match.metadata or {}
        chunks.append(
            RetrievedChunk(
                id=match.id,
                score=match.score or 0.0,
                text=meta.get("text", ""),
                source=meta.get("source", "unknown"),
                project=meta.get("project"),
            )
        )
    return chunks


def query_namespaces(
    namespaces: list[str], vector: list[float], top_k: int = 6
) -> list[RetrievedChunk]:
    """Query several project namespaces and merge by score — cross-project search."""
    if not namespaces:
        return []
    per = max(2, ceil(top_k / len(namespaces)))
    merged: list[RetrievedChunk] = []
    for ns in namespaces:
        try:
            merged.extend(query_namespace(ns, vector, per))
        except Exception:  # noqa: BLE001 — a missing/empty namespace must not fail the search
            continue
    merged.sort(key=lambda c: c.score, reverse=True)
    return merged[:top_k]
