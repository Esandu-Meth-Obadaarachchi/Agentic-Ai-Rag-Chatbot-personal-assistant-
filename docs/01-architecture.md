# 01 — Architecture

## The components

The system has seven moving parts. Learn what each one owns.

| Component | Job | Technology |
|-----------|-----|------------|
| API | Front door. Auth, routing, orchestration | FastAPI |
| Orchestrator | Runs the agentic loop and holds its state | LangGraph |
| Reasoning model | Router, rewrite, grade, generate | Claude Haiku 4.5 |
| Embedder | Turns text into vectors | HuggingFace model, local |
| Reranker | Orders chunks by true relevance | Cross-encoder, local |
| Vector store | Holds chunks and their vectors | Pinecone |
| Metadata store | Users, roles, projects, chat history | Firestore |
| Observability | Records every step | LangSmith |

The reasoning model, embedder, and reranker are three different models with three different jobs. Do not confuse them.

- The embedder is a bi-encoder. It reads one piece of text and outputs a vector. Fast, used at scale.
- The reranker is a cross-encoder. It reads the question and one chunk together and outputs a relevance score. Slower, used on a short list.
- Haiku is the generator and the decision-maker. It reads the question and the top chunks and writes prose.

## Two paths through the system

There are two flows. Keep them separate in your head.

### Write path (ingestion)

This runs when a document is added or changed. It is offline and asynchronous. A user is not waiting on it.

```
document upload
   -> FastAPI ingestion endpoint
   -> background worker
        -> extract text
        -> chunk with overlap
        -> embed each chunk
        -> upsert to Pinecone (workspace namespace, project metadata)
        -> write status to Firestore
```

Detail in [ingestion.md](07-ingestion.md).

### Read path (query)

This runs when a user asks a question. It is online and a user is waiting, so latency matters.

```
user question
   -> FastAPI chat endpoint
   -> auth: resolve user, workspace, allowed projects   [SECURITY GATE]
   -> LangGraph loop:
        -> route (small talk? vague? real question?)
        -> rewrite question into a search query
        -> retrieve from Pinecone (filtered by workspace + projects)
        -> rerank with cross-encoder
        -> grade the chunks; if weak and tries < 3, rewrite and retry
        -> generate answer with citations
        -> self-check answer against sources
   -> return answer + citations
   -> save turn to Firestore chat history
```

Detail in [agentic-loop.md](09-agentic-loop.md).

## The data-flow picture

```
                         ┌─────────────────────────────┐
   React frontend  ─────▶│          FastAPI            │
                         │  auth + membership check    │
                         └──────────────┬──────────────┘
                                        │ (workspace, project list resolved here)
                                        ▼
                         ┌─────────────────────────────┐
                         │        LangGraph loop        │
                         │  route → rewrite → retrieve  │
                         │  → rerank → grade → generate │
                         └───┬───────────┬───────────┬──┘
                             │           │           │
                  ┌──────────▼──┐  ┌─────▼─────┐  ┌──▼────────┐
                  │  Haiku 4.5  │  │  Pinecone │  │ Firestore │
                  │ (reasoning) │  │ (vectors) │  │ (roles,   │
                  └─────────────┘  └─────┬─────┘  │  history) │
                                         │        └───────────┘
                            ┌────────────▼───────────┐
                            │  local cross-encoder    │
                            │  (rerank top-k chunks)  │
                            └─────────────────────────┘

   Every arrow above is traced in LangSmith.
```

## Where the security boundary sits

The boundary sits in FastAPI, before the loop starts. By the time LangGraph runs, the workspace and the allowed project list are already fixed from the server side. The loop never re-derives them and never trusts anything from the client. This placement is deliberate and non-negotiable. See [access-control.md](02-access-control.md).

## Why FastAPI holds the loop, not N8n

The loop contains a security gate, retry logic, and four model calls with branching. This is application code. It needs unit tests, clean auth middleware, and version control. FastAPI gives you all of that. N8n hides the same logic in a visual canvas where you cannot easily test the security boundary. Use N8n only as an optional trigger that calls the ingestion endpoint when a file lands somewhere. The brain stays in FastAPI.

## Deployment shape

- FastAPI runs as a web service.
- The background worker runs as a separate process (arq or Celery) with Redis as the queue.
- The embedder and cross-encoder load once at worker or API startup and stay in memory. On an M1 with 8GB RAM, small models fit comfortably.
- Pinecone, Firestore, Anthropic, and LangSmith are managed services reached over the network.

Load the local models once. Loading a model per request is the classic mistake and it will make every request slow.
