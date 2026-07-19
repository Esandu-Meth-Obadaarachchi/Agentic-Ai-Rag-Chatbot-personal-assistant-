# Backend — Agentic RAG API (FastAPI)

The RAG brain. Verifies the caller's Firebase ID token, resolves their workspace
and project scope from Firestore, then runs a LangGraph agent that retrieves from
Pinecone (Voyage embeddings + rerank) and generates with Claude.

## Run locally

```bash
cp .env.example .env          # fill in keys (reuse the frontend's)
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

- Health: http://localhost:8000/health
- Swagger: http://localhost:8000/docs

## Endpoints (target)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness probe |
| POST | `/api/chat` | Agent turn: `{message, workspaceId?, projectId?, history?}` → `{answer, steps, sources, cards}` |
| POST | `/api/ingest` | Ingest a doc/note into a project namespace (multipart) |
| POST | `/api/related` | Related knowledge chunks for a query |

All endpoints except `/health` require `Authorization: Bearer <Firebase ID token>`.

## Layout

```
app/
  main.py        FastAPI app + routers
  config.py      settings (pydantic-settings, reads .env)
  models.py      request/response schemas
  security/      Firebase auth dependency + scope resolution
  rag/           embeddings, vectorstore, rerank, retrieval graph, agent, tools
  data/          Firestore access (workspaces, projects, tasks, chat history)
  routers/       health, chat, ingest, related
```

## Docker

```bash
docker build -t agentic-rag-api .
docker run --env-file .env -p 8000:8000 agentic-rag-api
```
