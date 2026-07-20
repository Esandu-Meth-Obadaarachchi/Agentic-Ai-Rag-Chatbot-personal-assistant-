# Agentic RAG — Personal Assistant (FastAPI + LangGraph)

An agentic RAG chatbot rebuilt on a Python stack. Same retrieval architecture as
the original TypeScript app (Voyage embeddings, Voyage cross-encoder reranking,
Pinecone with a namespace per project, Claude for generation, Firebase for auth
and data), but the agent loop and tool-calling run on **LangGraph + LangChain**,
served by **FastAPI** and shipped as a **Docker image for AWS ECS**.

The point of the rebuild: a containerised Python RAG service, deployed to ECS,
that the existing Next.js frontend talks to unchanged.

## Layout

```
agentic-rag-aws/
  backend/     FastAPI service — the RAG brain (Docker + ECS target)
  frontend/    Next.js app (the existing UI; AI routes proxy to the backend)
  docs/        design and teaching notes on the RAG architecture
  docker-compose.yml   run backend + frontend together locally
```

## Architecture at a glance

```
  Next.js frontend
        │  Firebase ID token (Bearer)
        ▼
  FastAPI  ──►  verify token (Firebase Admin) ──►  resolve user scope (Firestore)
        │
        ▼
  LangGraph agent loop
    route → rewrite → retrieve (Voyage embed → Pinecone) → rerank (Voyage)
          → grade → retry → generate (Claude) → grounded self-check
        │
        ├─ Pinecone   (vectors, one namespace per project)
        ├─ Firestore  (workspaces, projects, tasks, chat history)
        └─ Claude     (generation + agent reasoning)
```

## Run it locally (two terminals)

The backend and frontend run as two processes. Start the backend first, then the
frontend pointed at it.

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

The frontend's `RAG_API_URL` (in `frontend/.env.local`) points at the backend,
default `http://localhost:8000`. Open the frontend, sign in with Google, and the
agent chat flows through to FastAPI.

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
Deploying to AWS ECS: `docs/15-deploy-aws-ecs.md`.

## Build phases

| Phase | Scope | Branch |
|-------|-------|--------|
| 0 | Monorepo scaffold, docs, boots `/health` | initial commit |
| 1 | FastAPI core: config, Firebase auth, CORS, models | `feature/backend-core` |
| 2 | RAG pipeline: Voyage + Pinecone + LangGraph agentic retrieval | `feature/rag-pipeline` |
| 3 | Agent tools + Firestore + `/api/chat` | `feature/rag-pipeline` |
| 4 | Ingestion + related endpoints | `feature/ingestion` |
| 5 | Frontend integration (proxy AI routes) | `feature/frontend-integration` |
| 6 | Docker + AWS ECS | `feature/docker` |

See [docs/](docs/README.md) for the reasoning behind each part.
