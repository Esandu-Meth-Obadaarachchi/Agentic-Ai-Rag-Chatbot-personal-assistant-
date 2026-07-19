# 09 — The agentic loop

This is the brain. It is a state machine built with LangGraph. Each node is one step. Edges decide what happens next based on the state. Read this file slowly, because every node earns its place.

## Why LangGraph and not a plain chain

A plain LangChain chain is a straight pipe: A then B then C, once, no going back. Our loop needs to branch (small talk skips retrieval) and repeat (weak retrieval triggers a retry). LangGraph models exactly this. It holds a shared state object, runs nodes that read and update it, and follows conditional edges. You get loops, retries, and branches with a limit, and every transition shows up in LangSmith.

## The shared state

Every node reads and writes one state dict. Define it up front.

```python
from typing import TypedDict, Literal

class RagState(TypedDict):
    # set before the loop (from FastAPI, trusted)
    workspace_id: str
    allowed_project_ids: list[str]
    search_project_ids: list[str]
    namespace: str
    chat_history: list[dict]

    # produced during the loop
    question: str            # the raw user message
    route: Literal["smalltalk", "clarify", "answer"]
    search_query: str        # rewritten, standalone query
    candidates: list[dict]   # retrieved + reranked chunks
    grade: Literal["good", "weak"]
    tries: int               # retrieval attempts so far
    answer: str
    citations: list[dict]
    grounded: bool
```

The trusted access fields (`workspace_id`, `namespace`, `allowed_project_ids`) are placed by FastAPI before the loop runs. The loop never changes them.

## The nodes

### Node 0 — route (the conversational check)

The first decision. Haiku classifies the message.

- `smalltalk`: greetings, thanks, chit-chat. Answer directly, skip retrieval.
- `clarify`: a real question but too vague to search. Ask one clarifying question back.
- `answer`: a real, searchable question. Proceed.

Why it exists: it stops the system running a full search and paying for retrieval on "hi". It also stops the model inventing an answer to a question it does not yet understand. This is the cheapest node and it saves the most waste.

```python
def route(state: RagState) -> RagState:
    prompt = ROUTER_PROMPT.format(
        history=state["chat_history"], message=state["question"]
    )
    label = haiku.invoke(prompt).content.strip()   # returns one word
    return {**state, "route": label}
```

### Node 1 — rewrite

Turn the user message into a clean, standalone search query using the chat history.

Why it exists: users speak in context. "What about the second one?" is meaningless to a search engine. The rewrite resolves references from the history into a full query like "What are the cancellation terms for the second booking package?". Retrieval is only as good as the query it gets, so this node lifts everything downstream.

```python
def rewrite(state: RagState) -> RagState:
    prompt = REWRITE_PROMPT.format(
        history=state["chat_history"], message=state["question"]
    )
    query = haiku.invoke(prompt).content.strip()
    return {**state, "search_query": query}
```

### Node 2 — retrieve and rerank

Search Pinecone with the access filter, then rerank with the cross-encoder. This node is the whole of [retrieval-reranking.md](08-retrieval-reranking.md), wrapped as one step.

```python
def retrieve(state: RagState) -> RagState:
    q_vec = embeddings.embed_query(state["search_query"])
    hits = index.query(
        namespace=state["namespace"],
        vector=q_vec,
        top_k=20,
        include_metadata=True,
        filter={
            "workspace_id": {"$eq": state["workspace_id"]},
            "project_id": {"$in": state["search_project_ids"]},
        },
    )
    candidates = [h["metadata"] for h in hits["matches"]]
    top = rerank(state["search_query"], candidates, top_n=5)
    return {**state, "candidates": top, "tries": state["tries"] + 1}
```

The access filter lives here, inside every retrieval, as Gate 2.

### Node 3 — grade

Haiku judges whether the retrieved chunks actually answer the question. Output is `good` or `weak`.

Why it exists: this is the self-check that makes the system agentic. Plain RAG uses whatever it retrieved. Here, if the chunks do not contain the answer, the system knows, and it tries again with a different query instead of generating from thin air.

```python
def grade(state: RagState) -> RagState:
    prompt = GRADE_PROMPT.format(
        question=state["question"],
        chunks=render(state["candidates"]),
    )
    verdict = haiku.invoke(prompt).content.strip()   # "good" or "weak"
    return {**state, "grade": verdict}
```

### Node 4 — generate

Write the answer using only the retrieved chunks, with citations. The prompt tells Haiku to answer strictly from the provided context and to cite the `doc_id` and section of each fact.

```python
def generate(state: RagState) -> RagState:
    prompt = ANSWER_PROMPT.format(
        question=state["question"],
        context=render_with_ids(state["candidates"]),
    )
    result = haiku.invoke(prompt)
    return {**state, "answer": result.content, "citations": extract_citations(result)}
```

### Node 5 — self-check (groundedness)

Confirm every claim in the answer traces to a chunk. If a claim has no source, the answer is not grounded.

Why it exists: this is the last guard against hallucination. Even with good chunks, a model sometimes adds a detail from memory. The check catches it. If ungrounded, either strip the unsupported claim or return "I do not have that in your documents".

```python
def self_check(state: RagState) -> RagState:
    prompt = GROUNDED_PROMPT.format(
        answer=state["answer"], context=render(state["candidates"])
    )
    grounded = haiku.invoke(prompt).content.strip() == "yes"
    return {**state, "grounded": grounded}
```

## The edges (the control flow)

Nodes do work. Edges decide the path. This is where the loop and the branches live.

```
route ──smalltalk──▶ direct reply ──▶ END
      ──clarify────▶ ask question ──▶ END
      ──answer─────▶ rewrite

rewrite ──▶ retrieve ──▶ grade

grade ──good──▶ generate
      ──weak──▶ (tries < 3) ? rewrite : generate_with_no_answer

generate ──▶ self_check

self_check ──grounded──▶ END (return answer + citations)
           ──not grounded──▶ generate_with_no_answer ──▶ END
```

Two control points matter.

- The retrieval loop. `grade` sends weak results back to `rewrite` for another attempt, but only while `tries < 3`. The cap is essential. Without it the loop could spin forever on a question the documents cannot answer. At the cap, the system stops and returns an honest "I could not find this".
- The groundedness gate. Even a generated answer must pass the self-check before it reaches the user.

## Wiring it in LangGraph

```python
from langgraph.graph import StateGraph, END

g = StateGraph(RagState)
g.add_node("route", route)
g.add_node("rewrite", rewrite)
g.add_node("retrieve", retrieve)
g.add_node("grade", grade)
g.add_node("generate", generate)
g.add_node("self_check", self_check)

g.set_entry_point("route")

g.add_conditional_edges("route", lambda s: s["route"], {
    "smalltalk": END,
    "clarify": END,
    "answer": "rewrite",
})
g.add_edge("rewrite", "retrieve")
g.add_edge("retrieve", "grade")
g.add_conditional_edges("grade", lambda s:
    "generate" if s["grade"] == "good" or s["tries"] >= 3 else "rewrite",
    {"generate": "generate", "rewrite": "rewrite"},
)
g.add_edge("generate", "self_check")
g.add_conditional_edges("self_check", lambda s:
    "done" if s["grounded"] else "generate",
    {"done": END, "generate": "generate"},
)

app = g.compile()
```

## Why every reasoning node uses Haiku

Routing, rewriting, grading, generating, and the self-check are all small, well-scoped tasks. Haiku handles them well and cheaply. Four of the five calls produce tiny output. Only generation writes real prose. This keeps a whole conversation to pennies. Cost breakdown in [cost-and-caching.md](11-cost-and-caching.md).

## The three loops you asked for

"Three loops" is the retrieval cap. Pass 1 is the first search. If graded weak, pass 2 rewrites and searches again. If still weak, pass 3 is the last attempt. After three, the system stops and answers honestly rather than looping without end. Three is a balance: enough to recover from a bad first query, few enough to keep latency and cost bounded.
