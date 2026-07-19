"""The agent — a LangGraph ReAct tool loop over Claude.

Mirrors the TypeScript runAgent: build the persona, send only the last few turns,
let Claude call tools until it produces a final answer, then run a groundedness
self-check when the reply drew on retrieved documents. Tool round-trips are capped
via the graph's recursion limit; output tokens are capped on the model.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from langgraph.errors import GraphRecursionError
from langgraph.prebuilt import create_react_agent

from app.models import ChatTurn, RetrievedChunk
from app.rag.llm import _text_of, get_llm
from app.rag.persona import build_agent_system
from app.rag.retrieval import check_grounded
from app.rag.tools import ToolContext, build_tools

# Ceiling on tool-loop iterations. The graph runs ~2 supersteps per tool round
# (model call, then tool node), so this bounds it to roughly six rounds — headroom
# for a batch create_tasks — before LangGraph raises.
MAX_RECURSION = 14


@dataclass
class AgentResult:
    answer: str
    steps: list[str]
    sources: list[RetrievedChunk]
    cards: list[dict]


@dataclass
class AgentMeta:
    workspace_name: str
    project_name: str | None
    project_list: str


def _dedupe(chunks: list[RetrievedChunk]) -> list[RetrievedChunk]:
    seen: set[str] = set()
    out: list[RetrievedChunk] = []
    for c in chunks:
        if c.id not in seen:
            seen.add(c.id)
            out.append(c)
    return out


def run_agent(
    message: str,
    history: list[ChatTurn],
    ctx: ToolContext,
    meta: AgentMeta,
) -> AgentResult:
    system = build_agent_system(
        user_name=ctx.user_name,
        workspace_name=meta.workspace_name,
        project_name=meta.project_name,
        today=datetime.now(timezone.utc).date().isoformat(),
        project_list=meta.project_list,
    )

    # Only the last 5 turns go to the model — keeps the prompt small and cheap; the
    # full conversation is persisted by the frontend in Firestore.
    role_map = {"user": "human", "assistant": "ai"}
    messages: list[tuple[str, str]] = [
        (role_map.get(h.role, "human"), h.content) for h in history[-5:]
    ]
    messages.append(("human", message))

    agent = create_react_agent(get_llm(), build_tools(ctx), prompt=system)

    try:
        result = agent.invoke({"messages": messages}, config={"recursion_limit": MAX_RECURSION})
        answer = _text_of(result["messages"][-1].content).strip()
    except GraphRecursionError:
        ctx.steps.append("⚠️ hit the tool-round limit")
        return AgentResult(
            answer=(
                "I ran out of steps before finishing that. It was a big request — try "
                'fewer items at a time, or reply "continue" and I\'ll carry on. Anything '
                "created so far is shown below."
            ),
            steps=ctx.steps,
            sources=_dedupe(ctx.sources),
            cards=ctx.cards,
        )

    sources = _dedupe(ctx.sources)

    # Grounded self-check: when the answer drew on retrieved documents, verify every
    # claim is supported. A miss appends a subtle caveat rather than presenting an
    # unverified answer as fact. Never block a reply on the check.
    if sources and answer:
        try:
            grounded = check_grounded(answer, sources)
            ctx.steps.append(
                f"groundedness check: passed ({len(sources)} source(s))"
                if grounded
                else "groundedness check: some claims unverified"
            )
            if not grounded:
                answer += "\n\n_Note: parts of this answer may not be fully backed by your documents._"
        except Exception:  # noqa: BLE001
            pass

    if not answer:
        answer = "I couldn't produce a response for that. Try rephrasing, or breaking it into a smaller request."

    return AgentResult(answer=answer, steps=ctx.steps, sources=sources, cards=ctx.cards)
