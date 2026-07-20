# 09 — The agentic loop

This build has two loops, not one, and they nest. Understand the shape before the code: an outer tool-calling agent (the ReAct loop), and an inner retrieval loop (a LangGraph state machine) that the agent reaches for only when it decides to search knowledge.

## Why two loops, not one big graph

An earlier design for this project (see the git history) planned one top-level graph: route -> rewrite -> retrieve -> rerank -> grade -> generate -> self-check, every question passing through every node. This build took a different, and arguably more faithful, shape: it ports the original TypeScript app's design, which is a Claude tool-calling agent that decides for itself, per turn, whether a question needs a knowledge search, a task lookup, a task write, or just an answer from the conversation. That decision is not a separate "router" node — it is the normal behaviour of a tool-calling model: it only calls a tool when the tool is useful.

The result: small talk costs one model call and no tool calls, exactly as the routed design intended, but without hand-writing a classifier prompt. The trade is that this loop is a LangGraph *prebuilt* (`create_react_agent`), not a graph you author node by node — you get less visible control over the top-level shape, in exchange for a battle-tested tool loop.

## Outer loop: the ReAct agent

`backend/app/rag/agent.py` builds the agent per request:

```python
from langgraph.prebuilt import create_react_agent

agent = create_react_agent(get_llm(), build_tools(ctx), prompt=system)
result = agent.invoke({"messages": messages}, config={"recursion_limit": MAX_RECURSION})
```

- `get_llm()` is `ChatAnthropic` on `CLAUDE_MODEL` (Haiku 4.5 by default).
- `build_tools(ctx)` returns six LangChain `StructuredTool`s bound to the caller's resolved scope: `search_knowledge`, `list_tasks`, `create_task`, `create_tasks`, `update_task`, `summarize_project`. See [tools in agent.py and tools.py].
- `prompt=system` is the persona (`persona.py`) — same voice and rules as the original TypeScript agent: confident, brief, tool-first, no narrated reasoning.
- Only the last 5 turns of history are sent, keeping the prompt small; the full conversation is persisted by the frontend in Firestore, not by this backend.
- `recursion_limit` caps tool round-trips (`MAX_RECURSION = 14`, headroom for a batch `create_tasks`). Hitting the cap raises `GraphRecursionError`, caught and turned into an honest "I ran out of steps" reply rather than a 500.

This *is* the LangGraph state machine for the conversation: `create_react_agent` compiles a graph of (call the model) -> (run any tool calls) -> (call the model again) -> ... until the model responds with no tool calls. You do not see its nodes directly, but it is the same underlying mechanism as a hand-authored graph.

## Inner loop: the retrieval subgraph

When the agent calls `search_knowledge`, that tool runs `agentic_retrieve` in `backend/app/rag/retrieval.py` — a LangGraph graph you *do* author node by node, because retrieval quality is where hand control earns its keep.

```python
class _RetrieveState(TypedDict):
    question: str
    namespaces: list[str]
    query: str
    chunks: list[RetrievedChunk]
    best: list[RetrievedChunk]
    attempts: int
    grade: Literal["good", "weak"]
```

Three nodes, one conditional edge:

```
START -> rewrite -> retrieve -> assess ──good, or attempts>=MAX_ATTEMPTS──▶ END
                        ▲                │
                        └────weak, attempts<MAX_ATTEMPTS────┘
```

(The grading node is named `assess`, not `grade` — LangGraph reserves the node name from colliding with a state key of the same name.)

- **rewrite** — turn the raw question into a search-optimised query (Claude, `CLAUDE_FAST_MODEL`). On a retry it is told the previous query was weak and asked for a different angle.
- **retrieve** — embed the query (Voyage), pull the top 20 candidates from the caller's accessible Pinecone namespaces, cross-encoder rerank (Voyage `rerank-2.5`) down to 4. See [retrieval-reranking.md](08-retrieval-reranking.md).
- **assess** — Claude judges in one word whether the 4 chunks answer the question: `good` or `weak`.
- The conditional edge retries (back to rewrite) on a weak grade, up to `MAX_ATTEMPTS = 2`. At the cap it returns whatever it has, `best` tracking the highest-scoring set seen across attempts even if the final attempt scored lower.

```python
def _build_graph():
    graph = StateGraph(_RetrieveState)
    graph.add_node("rewrite", _rewrite_node)
    graph.add_node("retrieve", _retrieve_node)
    graph.add_node("assess", _grade_node)
    graph.add_edge(START, "rewrite")
    graph.add_edge("rewrite", "retrieve")
    graph.add_edge("retrieve", "assess")
    graph.add_conditional_edges("assess", _should_continue, {"rewrite": "rewrite", END: END})
    return graph.compile()
```

This subgraph is compiled once at import time and invoked fresh per search — it holds no state between calls.

## The groundedness self-check

After the outer agent produces a final answer, if any sources were gathered during the turn (`ctx.sources`, accumulated by `search_knowledge` and `summarize_project`), `agent.py` runs one more Claude call: does every claim in the answer trace to the sources? This is a plain function call (`check_grounded` in `retrieval.py`), not a LangGraph node — it runs once, after the agent loop has already finished, and never blocks a reply on failure. A "no" appends a caveat to the answer rather than rewriting it.

```python
if sources and answer:
    grounded = check_grounded(answer, sources)
    if not grounded:
        answer += "\n\n_Note: parts of this answer may not be fully backed by your documents._"
```

## Putting it together

```
user message
  -> outer ReAct agent (LangGraph prebuilt)
       -> decides: no tool needed?  -> answers directly, done
       -> decides: search_knowledge -> inner retrieval subgraph (LangGraph, hand-authored)
                                          rewrite -> retrieve -> assess -> (retry up to 2x)
                                       -> returns graded chunks -> agent reads them, may call
                                          another tool or produce the final answer
       -> decides: a task tool      -> reads/writes Firestore, scoped by memberIds
       -> ... repeats until a final answer with no tool calls, or MAX_RECURSION
  -> groundedness self-check (plain function, only if sources were used)
  -> {answer, steps, sources, cards}
```

Two caps matter, for the same reason: an unbounded loop is a cost and latency risk on a question the system cannot resolve. `MAX_RECURSION` bounds the outer tool loop; `MAX_ATTEMPTS` bounds the inner retrieval retry. Both fail toward an honest message to the user rather than a silent timeout.

## Why Claude Haiku for every reasoning step

Tool selection, query rewriting, chunk grading, and the groundedness check are all small, well-scoped judgements — Haiku handles them well and cheaply. Only the final answer, and any tool-result summarising, produces real prose. Cost breakdown in [cost-and-caching.md](11-cost-and-caching.md).
