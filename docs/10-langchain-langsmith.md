# 10 — LangChain, LangGraph, and LangSmith

Three tools with three jobs. People blur them together. Keep them apart.

## LangChain — the building blocks

LangChain is a library of standard interfaces for the parts of an LLM app: loaders, splitters, embedding wrappers, vector store wrappers, retrievers, and model wrappers. Its value is that each part has one interface, so you swap implementations without rewriting the rest. Switch the embedder or the vector store and the code around it barely changes.

What this build actually uses from LangChain (`backend/app/rag/`):

- Text splitter. `RecursiveCharacterTextSplitter` for chunking, 1000/200 (`chunker.py`; see [chunking.md](05-chunking.md)).
- Embeddings wrapper. `VoyageAIEmbeddings` around `voyage-3.5` (`embeddings.py`; see [embeddings.md](04-embeddings.md)) — not a HuggingFace wrapper; this build calls the hosted Voyage API.
- Reranker. `VoyageAIRerank` used directly as a `ContextualCompressionRetriever`-style compressor (`rerank.py`; see [retrieval-reranking.md](08-retrieval-reranking.md)) — again Voyage's hosted `rerank-2.5`, not a local cross-encoder.
- Vector store. Talked to directly through the official `pinecone` client (`vectorstore.py`), not LangChain's `PineconeVectorStore` wrapper — the read path merges hits across several project namespaces in one call, which the single-namespace VectorStore interface does not express cleanly. See [namespaces-pinecone.md](06-namespaces-pinecone.md) for why.
- Model wrapper. `ChatAnthropic` for both the agent (`CLAUDE_MODEL`, Haiku 4.5 by default) and the retrieval helper calls (`CLAUDE_FAST_MODEL`).
- Agent runtime. `langgraph.prebuilt.create_react_agent` — the tool-calling loop itself, not a hand-authored LangChain chain. See [agentic-loop.md](09-agentic-loop.md).
- Tools. Six `StructuredTool`s (`tools.py`) with Pydantic `args_schema`s, including a recursive schema for nested subtasks in `create_tasks`.

There is no chat-history integration in this codebase (no `FirestoreChatMessageHistory` or similar) — the frontend persists conversations to Firestore itself; this backend is stateless per request, given only the last 5 turns in the request body.

```python
from langchain_anthropic import ChatAnthropic

llm = ChatAnthropic(
    model="claude-haiku-4-5",
    api_key=settings.anthropic_api_key,
    max_tokens=1024,
    timeout=60,
)
```

Think of LangChain as the socket set. Standard sockets, many tools fit — though this build reaches past a couple of the standard sockets (the vector store wrapper, the chat-history integration) where the exact shape of the isolation model or the request/response contract mattered more than reuse.

## LangGraph — the control flow

LangChain runs pipes. LangGraph runs state machines with branches and loops. The agentic loop needs to decide (small talk vs answer) and repeat (retry on weak retrieval), so LangGraph holds the loop. It sits on top of LangChain: the nodes call LangChain objects (the retriever, the reranker, `ChatAnthropic`), and LangGraph decides the order and the branching.

The full graph is in [agentic-loop.md](09-agentic-loop.md). The one-line summary: LangChain gives you the parts, LangGraph wires them into a loop with decisions.

## LangSmith — the observability

LangSmith records every step of every run: the inputs, the outputs, the tokens, the latency, and the exact prompt sent to Haiku at each node. It is the camera in the control room. Without it, a wrong answer is a mystery. With it, you open the run, see that the rewrite produced a bad query, and fix the rewrite prompt.

### Why you need it

An agentic loop has many steps. When an answer is wrong, the fault could be in routing, rewriting, retrieval, reranking, grading, or generation. LangSmith shows each step's input and output, so you find the guilty node in seconds instead of guessing. This is the difference between debugging by evidence and debugging by hope.

### Turning it on

Set three values in `backend/.env`:

```bash
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=your_langsmith_key
LANGSMITH_PROJECT=agentic-rag-aws
```

`config.get_settings()` reads these through `pydantic-settings` and, if tracing is on, propagates them into the real process environment as the `LANGCHAIN_TRACING_V2` / `LANGCHAIN_API_KEY` / `LANGCHAIN_PROJECT` names LangChain and LangGraph actually check at call time. This propagation step exists because `pydantic-settings` only loads `.env` into the `Settings` object's attributes — it does not export them back to `os.environ`, and LangChain's tracing check reads `os.environ` directly, not any app object. `get_settings()` runs once at app startup, before any request is served, so the real env vars are in place before the first agent or retrieval call.

With tracing on, every LangGraph run — the retrieval subgraph and the outer ReAct agent — appears in the LangSmith project as a trace tree: one node per step, each expandable to show the prompt and the response.

### What to look at in a trace

- The rewritten query. Is it a clean, standalone question? Bad answers often start here.
- The retrieved chunks. Did the right chunk come back at all? If not, the problem is retrieval or chunking, not the model.
- The rerank order. Did the cross-encoder put the best chunk on top?
- The grade. Did the system correctly judge the chunks good or weak?
- Token counts. Which node costs the most? Usually generation.

### Evaluation with LangSmith

LangSmith also runs evaluations. You build a dataset of questions with known good answers, run the graph over it, and LangSmith scores the outputs. This turns "it feels better" into a number you are able to track across changes. Full method in [evaluation.md](12-evaluation.md).

## How they fit together

```
LangSmith  ── watches everything ──▶ traces + evals
    ▲
    │ (automatic tracing)
LangGraph  ── the loop: route → rewrite → retrieve → grade → generate → check
    │ calls
    ▼
LangChain  ── the parts: loaders, splitter, embeddings, retriever, reranker, ChatAnthropic
```

One sentence each: LangChain is the parts, LangGraph is the wiring, LangSmith is the camera. You need all three, and they are built to work together.
