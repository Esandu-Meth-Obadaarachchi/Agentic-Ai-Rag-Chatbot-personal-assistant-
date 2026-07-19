"""Agentic retrieval, as a LangGraph state machine.

Instead of a single embed-and-fetch, this runs the loop the RAG docs describe:

    rewrite the query -> cast a wide net (bi-encoder) -> cross-encoder rerank
    -> grade whether the chunks answer the question -> retry on a weak grade

A weak grade reformulates the query and searches again, up to MAX_ATTEMPTS. The
loop itself is a LangGraph graph, so every step is a named node you can trace.
See docs/08-retrieval-reranking.md and docs/09-agentic-loop.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, TypedDict

from langgraph.graph import END, START, StateGraph

from app.models import RetrievedChunk
from app.rag.embeddings import embed_query
from app.rag.llm import complete
from app.rag.rerank import rerank
from app.rag.vectorstore import query_namespaces

CANDIDATES = 20  # wide net from the bi-encoder (recall)
KEEP = 4         # kept after the cross-encoder rerank (precision, and prompt size)
MAX_ATTEMPTS = 2  # grade-and-retry ceiling (each retry costs helper calls)


@dataclass
class AgenticRetrieval:
    chunks: list[RetrievedChunk]
    query: str                       # the final search query actually used
    attempts: int                    # how many retrieve attempts ran (1..MAX_ATTEMPTS)
    grade: Literal["good", "weak"]   # the grader's verdict on the returned chunks


def rewrite_query(raw: str, previous: str | None = None) -> str:
    """Rewrite a raw question into a search-optimised query. On a retry it is told
    the previous query was weak, so it comes at the topic from a different angle."""
    if previous:
        prompt = (
            f'The search query "{previous}" returned weak results for this question:\n'
            f'"{raw}"\n\nWrite ONE different, more effective search query. Use the key '
            "entities and terms. Return only the query, no preamble."
        )
    else:
        prompt = (
            "Turn this into ONE concise search query optimised for semantic document "
            "retrieval. Keep the key entities and terms. Return only the query, no "
            f"preamble.\n\nQuestion: {raw}"
        )
    out = complete(prompt, max_tokens=80).strip().strip("\"'")
    return out or raw


def retrieve_and_rerank(
    namespaces: list[str], query: str, keep: int = KEEP
) -> list[RetrievedChunk]:
    """Wide candidate set across the namespaces, then cross-encoder rerank to the
    best few. Returned chunks carry the rerank score in `score`."""
    if not namespaces:
        return []
    vector = embed_query(query)
    candidates = query_namespaces(namespaces, vector, CANDIDATES)
    if not candidates:
        return []
    hits = rerank(query, [c.text for c in candidates], keep)
    out: list[RetrievedChunk] = []
    for index, score in hits:
        chunk = candidates[index].model_copy(update={"score": score})
        out.append(chunk)
    return out


def grade_chunks(question: str, chunks: list[RetrievedChunk]) -> Literal["good", "weak"]:
    """Grade whether the chunks actually answer the question. Cheap Haiku call."""
    if not chunks:
        return "weak"
    context = "\n\n".join(f"[{i + 1}] {c.text[:500]}" for i, c in enumerate(chunks))
    verdict = complete(
        f"Question: {question}\n\nRetrieved passages:\n{context}\n\nDo these passages "
        'contain enough information to answer the question? Reply with exactly one '
        'word: "good" or "weak".',
        max_tokens=5,
    )
    return "good" if "good" in verdict.lower() else "weak"


def check_grounded(answer: str, chunks: list[RetrievedChunk]) -> bool:
    """Groundedness self-check: is every factual claim in the answer supported by the
    retrieved sources? True when there is nothing to check (no sources used)."""
    if not chunks:
        return True
    context = "\n\n".join(f"[{i + 1}] {c.text[:500]}" for i, c in enumerate(chunks))
    verdict = complete(
        f"Sources:\n{context}\n\nAnswer:\n{answer}\n\nIs every factual claim in the "
        'answer supported by the sources above? Reply with exactly one word: "yes" or '
        '"no".',
        max_tokens=5,
    )
    return "yes" in verdict.lower()


# --------------------------- the LangGraph loop --------------------------- #


class _RetrieveState(TypedDict):
    question: str
    namespaces: list[str]
    query: str
    chunks: list[RetrievedChunk]
    best: list[RetrievedChunk]
    attempts: int
    grade: Literal["good", "weak"]


def _rewrite_node(state: _RetrieveState) -> dict:
    previous = state["query"] if state["attempts"] > 0 else None
    return {"query": rewrite_query(state["question"], previous)}


def _retrieve_node(state: _RetrieveState) -> dict:
    chunks = retrieve_and_rerank(state["namespaces"], state["query"])
    best = state["best"]
    if chunks and (not best or chunks[0].score > best[0].score):
        best = chunks
    return {"chunks": chunks, "best": best, "attempts": state["attempts"] + 1}


def _grade_node(state: _RetrieveState) -> dict:
    return {"grade": grade_chunks(state["question"], state["chunks"])}


def _should_continue(state: _RetrieveState) -> Literal["rewrite", "__end__"]:
    if state["grade"] == "good" or state["attempts"] >= MAX_ATTEMPTS:
        return END
    return "rewrite"


def _build_graph():
    graph = StateGraph(_RetrieveState)
    graph.add_node("rewrite", _rewrite_node)
    graph.add_node("retrieve", _retrieve_node)
    graph.add_node("assess", _grade_node)  # not "grade" — collides with the state key
    graph.add_edge(START, "rewrite")
    graph.add_edge("rewrite", "retrieve")
    graph.add_edge("retrieve", "assess")
    graph.add_conditional_edges("assess", _should_continue, {"rewrite": "rewrite", END: END})
    return graph.compile()


_RETRIEVE_GRAPH = _build_graph()


def agentic_retrieve(namespaces: list[str], question: str) -> AgenticRetrieval:
    """Run the full rewrite -> retrieve -> rerank -> grade -> retry loop."""
    if not namespaces:
        return AgenticRetrieval(chunks=[], query=question, attempts=0, grade="weak")
    final: _RetrieveState = _RETRIEVE_GRAPH.invoke(
        {
            "question": question,
            "namespaces": namespaces,
            "query": "",
            "chunks": [],
            "best": [],
            "attempts": 0,
            "grade": "weak",
        }
    )
    chunks = final["chunks"] or final["best"]
    return AgenticRetrieval(
        chunks=chunks,
        query=final["query"],
        attempts=final["attempts"],
        grade=final["grade"],
    )
