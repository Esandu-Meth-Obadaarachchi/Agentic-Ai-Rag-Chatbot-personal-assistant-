<div align="center">

# 🌙 Lune AI — Agentic RAG, rebuilt on FastAPI + LangGraph

**The same AI-native workspace, with its RAG brain rebuilt in Python.**

A tool-calling Claude agent that searches your documents and reads/writes your tasks, backed by a
hand-authored LangGraph retrieval loop (rewrite → retrieve → rerank → grade → retry) and a
groundedness self-check. Containerised for AWS ECS.

</div>

---

## Why this exists

Lune AI (`second-brain/`, live at **https://luneai.site**) already runs this agent in TypeScript,
inside Next.js API routes. This repo is a from-scratch rebuild of that same RAG system in Python —
same Pinecone data, same Voyage models, same Claude generation — to package it as a real backend
service: containerised with Docker, deployed to AWS ECS, sitting behind the existing frontend
unchanged. The point was learning Docker and ECS by shipping something real, and doing the RAG
side in FastAPI because that is the stack AI engineering interviews expect to see.

## What it does

- **Agentic retrieval, not a single embed-and-fetch.** A LangGraph state machine rewrites the
  question into a search query, retrieves a wide candidate set from Pinecone, reranks with a
  cross-encoder, grades whether the result actually answers the question, and retries with a
  reformulated query on a weak grade (capped at 2 attempts). See `backend/app/rag/retrieval.py`.
- **A tool-calling agent, not a fixed pipeline.** A LangGraph ReAct agent (Claude) decides per turn
  whether to search knowledge, list tasks, create or update tasks (single or as a nested batch), or
  summarise a project — small talk costs one model call and no tools, exactly as it should.
- **A groundedness self-check.** After the agent answers, a follow-up Claude call verifies every
  claim traces back to a retrieved source; an unsupported answer gets a visible caveat, not a
  silent pass.
- **Per-project knowledge isolation.** Every project owns its own Pinecone namespace. A user's
  search only ever reaches the namespaces of projects they are a member of (`memberIds` on every
  Firestore doc) — enforced server-side, never trusted from the client.
- **Document ingestion.** PDF, DOCX, markdown, code and plain text, chunked (1000 chars / 200
  overlap) and embedded into the target project's namespace.
- **The existing frontend, unchanged.** The Next.js UI's AI routes (`/api/chat`, `/api/ingest`,
  `/api/related`) now proxy to this backend, Firebase ID token and all, so the product behaves
  exactly as it did before — the brain just moved.

## Stack

FastAPI · LangChain · LangGraph · Claude (Haiku 4.5, `CLAUDE_MODEL`) · Voyage AI (`voyage-3.5`
embeddings, `rerank-2.5` reranking) · Pinecone · Firebase Auth + Firestore · Docker · AWS ECS
(Fargate target). Frontend: the existing Next.js 14 app, untouched apart from three proxy routes.

## Layout

```
agentic-rag-aws/
  backend/     FastAPI service — the RAG brain (Docker + ECS target)
    app/rag/       embeddings, rerank, vectorstore, retrieval graph, agent, tools, ingestion
    app/data/      Firestore access, scoped by memberIds
    app/security/  Firebase ID-token verification
    app/routers/   /health, /api/chat, /api/ingest, /api/related
  frontend/    the existing Next.js app; its AI routes proxy to the backend
  docs/        design and teaching notes — read these for the "why" behind every part
  docker-compose.yml   run backend + frontend together locally
```

## Architecture at a glance

```
  Next.js frontend
        │  Authorization: Bearer <Firebase ID token>
        ▼
  FastAPI  ──►  verify token (Firebase Admin) ──►  load accessible workspaces/projects (Firestore)
        │
        ▼
  LangGraph ReAct agent (Claude) — decides which tool(s) to call, if any
        │
        ├─ search_knowledge ──► retrieval subgraph (LangGraph):
        │                        rewrite → retrieve (Voyage embed → Pinecone,
        │                        namespace per accessible project) → rerank (Voyage)
        │                        → grade → retry (≤2 attempts)
        ├─ list_tasks / create_task / create_tasks / update_task / summarize_project ──► Firestore
        │
        ▼
  final answer  ──►  groundedness self-check (Claude, only if sources were used)  ──►  response
```

Full request flow, the security boundary, and why it is shaped this way: [docs/01-architecture.md](docs/01-architecture.md) and [docs/09-agentic-loop.md](docs/09-agentic-loop.md).

## Run it locally (two terminals)

### Terminal 1 — backend (FastAPI, port 8000)

```bash
cd backend
cp .env.example .env                       # fill in the keys (reuse the frontend's)
python3.11 -m venv .venv                    # Python 3.11 or 3.12 (not 3.14 — ML wheels lag)
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Check it: http://localhost:8000/health and http://localhost:8000/docs (Swagger).

### Terminal 2 — frontend (Next.js, port 3000)

```bash
cd frontend
npm install
npm run dev                                 # http://localhost:3000
# if port 3000 is taken, pick another: npm run dev -- -p 3002
```

The frontend's `RAG_API_URL` (in `frontend/.env.local`) points at the backend, default
`http://localhost:8000`. Open the frontend, sign in with Google, and the agent chat flows through
to FastAPI.

### Restarting a background run

```bash
pkill -f "uvicorn app.main:app"             # stop the backend
pkill -f "next dev"                          # stop the frontend (careful: stops all Next dev servers)
```

## Run the backend in Docker

```bash
cd backend
docker build --platform linux/amd64 -t agentic-rag-api .   # linux/amd64 for M1 -> ECS
docker run --env-file .env -p 8000:8000 agentic-rag-api
```

Or both together: `docker compose up --build` (see `docker-compose.yml`).
Deploying to AWS ECS: [docs/15-deploy-aws-ecs.md](docs/15-deploy-aws-ecs.md).

## Docs

|                                                                     |                                                                       |
| ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [docs/00-overview.md](docs/00-overview.md)                           | What agentic RAG is and why plain RAG breaks                          |
| [docs/01-architecture.md](docs/01-architecture.md)                   | The seven moving parts, the two request paths                        |
| [docs/02-access-control.md](docs/02-access-control.md)               | The `memberIds` isolation model and the Firebase auth gate            |
| [docs/03-data-model-firestore.md](docs/03-data-model-firestore.md)   | Collections this backend actually reads/writes                       |
| [docs/04-embeddings.md](docs/04-embeddings.md)                       | Voyage `voyage-3.5`, why hosted not local                             |
| [docs/05-chunking.md](docs/05-chunking.md)                           | 1000/200 character chunking, matching the TS app                     |
| [docs/06-namespaces-pinecone.md](docs/06-namespaces-pinecone.md)     | Namespace-per-project, cross-project merge                           |
| [docs/07-ingestion.md](docs/07-ingestion.md)                         | The synchronous ingest pipeline, what it does not do yet              |
| [docs/08-retrieval-reranking.md](docs/08-retrieval-reranking.md)     | Bi-encoder vs cross-encoder, Voyage `rerank-2.5`                      |
| [docs/09-agentic-loop.md](docs/09-agentic-loop.md)                   | The two nested LangGraph loops, node by node                          |
| [docs/10-langchain-langsmith.md](docs/10-langchain-langsmith.md)     | What's actually used from each library, LangSmith tracing             |
| [docs/11-cost-and-caching.md](docs/11-cost-and-caching.md)           | Where the tokens go, per-question cost                                |
| [docs/12-evaluation.md](docs/12-evaluation.md)                       | How you would measure it (not yet built)                              |
| [docs/13-glossary.md](docs/13-glossary.md)                           | Every term, in plain words                                            |
| [docs/14-model-hosting.md](docs/14-model-hosting.md)                 | Why every model call is a hosted API, none in-process                 |
| [docs/15-deploy-aws-ecs.md](docs/15-deploy-aws-ecs.md)                | Build → ECR → Secrets Manager → Fargate → ALB                         |

## Security

Secrets (`ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `PINECONE_API_KEY`, the Firebase Admin key) live
only in the backend's `.env` (gitignored) or, in production, AWS Secrets Manager — never in the
frontend or committed to git. Every `/api/*` route requires a valid Firebase ID token; project
access is resolved server-side from Firestore `memberIds` and never trusted from the request body.
See [docs/02-access-control.md](docs/02-access-control.md).

## Build history

Built branch by branch, each a working, committed slice: `feature/backend-core` (FastAPI + auth) →
`feature/rag-pipeline` (LangGraph retrieval + agent, verified live against real Pinecone/Firestore
data) → `feature/ingestion` → `feature/frontend-integration` (proxy routes) → `feature/docker`
(Dockerfile + ECS guide) → `feature/docs-sync`, merged through `dev` to `main`.
