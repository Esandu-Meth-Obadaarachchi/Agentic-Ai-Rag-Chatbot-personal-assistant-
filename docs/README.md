# Agentic RAG Chatbot — Documentation

This folder teaches the whole system, part by part. Read it top to bottom the first time. After that, treat each file as a reference.

The goal is understanding, not copy-paste. Every file explains the why before the how, and is written against the actual code in `../backend/app/`, so you are able to defend each choice in an interview or a design review — including the places this build simplified or diverged from a fuller design, which each file calls out explicitly rather than glossing over.

## Reading order

| # | File | What it covers |
|---|------|----------------|
| 00 | [overview.md](00-overview.md) | What RAG is, what "agentic" adds, and the mental model |
| 01 | [architecture.md](01-architecture.md) | Every component and how data flows between them |
| 02 | [access-control.md](02-access-control.md) | Firebase ID tokens, `memberIds` isolation, the project-namespace wall |
| 03 | [data-model-firestore.md](03-data-model-firestore.md) | Firestore collections this backend actually reads/writes |
| 04 | [embeddings.md](04-embeddings.md) | Voyage `voyage-3.5`, and why hosted rather than local |
| 05 | [chunking.md](05-chunking.md) | 1000/200 character chunking, matching the TypeScript app exactly |
| 06 | [namespaces-pinecone.md](06-namespaces-pinecone.md) | Namespace-per-project and cross-project search by merge |
| 07 | [ingestion.md](07-ingestion.md) | The synchronous write path, and what it does not do yet (no queue, no idempotency) |
| 08 | [retrieval-reranking.md](08-retrieval-reranking.md) | Bi-encoder search plus Voyage `rerank-2.5` cross-encoder reranking |
| 09 | [agentic-loop.md](09-agentic-loop.md) | The two nested LangGraph loops — the ReAct agent and the retrieval subgraph |
| 10 | [langchain-langsmith.md](10-langchain-langsmith.md) | What each library actually does here, and how tracing turns on |
| 11 | [cost-and-caching.md](11-cost-and-caching.md) | Where the tokens go, and why prompt caching isn't wired up yet |
| 12 | [evaluation.md](12-evaluation.md) | How you would measure this system (not yet built) |
| 13 | [glossary.md](13-glossary.md) | Every term, matched to what this build actually does |
| 14 | [model-hosting.md](14-model-hosting.md) | Why every model call is a hosted API, none in-process |
| 15 | [deploy-aws-ecs.md](15-deploy-aws-ecs.md) | Build → ECR → Secrets Manager → Fargate → ALB |

## The one-paragraph summary

A user sends a message. FastAPI verifies their Firebase ID token and loads every workspace and project they belong to from Firestore. A LangGraph ReAct agent (Claude) decides what the message needs: nothing (small talk gets a direct reply), a knowledge search, or a task read/write. A knowledge search runs its own LangGraph loop — rewrite the question into a search query, retrieve a wide candidate set from Pinecone (only the namespaces of projects the user can see), rerank with a cross-encoder, grade whether the result actually answers the question, and retry with a reformulated query on a weak grade, up to two attempts. Once the agent has a final answer, a groundedness self-check confirms every claim traces back to a retrieved source.

## Stack at a glance

- Orchestration: LangChain plus LangGraph — a ReAct tool-calling agent as the outer loop, a hand-authored 3-node graph (rewrite → retrieve → assess) as the inner retrieval loop.
- Model: Claude Haiku 4.5 (`claude-haiku-4-5`) through `ChatAnthropic`, for both the agent and the retrieval helper calls.
- Embeddings: Voyage `voyage-3.5`, 1024-dim, hosted API — matches the original TypeScript app's data.
- Reranking: Voyage `rerank-2.5` cross-encoder, hosted API.
- Vector store: Pinecone, one namespace per **project** (not per workspace).
- Metadata and access store: Firebase Firestore, isolation via `memberIds` array-contains queries, not a separate memberships collection.
- Auth: Firebase ID tokens, verified server-side with the Firebase Admin SDK.
- API: Python FastAPI, containerised for AWS ECS Fargate.
- Tracing: LangSmith, off by default — three env vars turn it on (see [langchain-langsmith.md](10-langchain-langsmith.md)).
- Evaluation: not built yet — [evaluation.md](12-evaluation.md) is the method to follow, not a running system.
