"""Voyage cross-encoder reranking, via LangChain.

The embedding search (a bi-encoder) casts a wide net fast; the reranker reads each
(query, document) pair together and scores true relevance, so the best chunks rise
to the top. Two-stage retrieve-then-rerank is the biggest accuracy lever after
chunking. Same model (rerank-2.5) as the TypeScript app.
"""

from __future__ import annotations

from functools import lru_cache

from langchain_core.documents import Document
from langchain_voyageai import VoyageAIRerank

from app.config import get_settings


@lru_cache
def _reranker(top_k: int) -> VoyageAIRerank:
    settings = get_settings()
    # NB: VoyageAIRerank's key field is `voyage_api_key` with no `api_key` alias
    # (VoyageAIEmbeddings has the alias; the two classes differ), so passing
    # `api_key=` here is silently dropped and the client raises AuthenticationError.
    return VoyageAIRerank(
        model=settings.voyage_rerank_model,   # rerank-2.5
        voyage_api_key=settings.voyage_api_key,
        top_k=top_k,
    )


def rerank(query: str, documents: list[str], top_k: int) -> list[tuple[int, float]]:
    """Return (original_index, relevance_score) pairs, best first, capped at top_k."""
    if not documents:
        return []
    docs = [Document(page_content=t, metadata={"_i": i}) for i, t in enumerate(documents)]
    ranked = _reranker(min(top_k, len(documents))).compress_documents(docs, query)
    return [
        (int(d.metadata["_i"]), float(d.metadata.get("relevance_score", 0.0)))
        for d in ranked
    ]
