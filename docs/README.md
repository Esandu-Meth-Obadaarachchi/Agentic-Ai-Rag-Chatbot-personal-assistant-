# Agentic RAG Chatbot — Documentation

This folder teaches the whole system, part by part. Read it top to bottom the first time. After that, treat each file as a reference.

The goal is understanding, not copy-paste. Every file explains the why before the how, so you are able to defend each choice in an interview or a design review.

## Reading order

| # | File | What it covers |
|---|------|----------------|
| 00 | [overview.md](00-overview.md) | What RAG is, what "agentic" adds, and the mental model |
| 01 | [architecture.md](01-architecture.md) | Every component and how data flows between them |
| 02 | [access-control.md](02-access-control.md) | Roles, workspaces, projects, and the two security gates |
| 03 | [data-model-firestore.md](03-data-model-firestore.md) | Firestore collections and why we skip Postgres |
| 04 | [embeddings.md](04-embeddings.md) | The free embedding model and how vectors carry meaning |
| 05 | [chunking.md](05-chunking.md) | Splitting documents, 15% overlap, and metadata |
| 06 | [namespaces-pinecone.md](06-namespaces-pinecone.md) | Namespace strategy and cross-project comparison |
| 07 | [ingestion.md](07-ingestion.md) | The write path: document in, vectors out |
| 08 | [retrieval-reranking.md](08-retrieval-reranking.md) | Bi-encoder search plus cross-encoder reranking |
| 09 | [agentic-loop.md](09-agentic-loop.md) | The LangGraph loop, step by step, with the why |
| 10 | [langchain-langsmith.md](10-langchain-langsmith.md) | What each library does and how tracing works |
| 11 | [cost-and-caching.md](11-cost-and-caching.md) | Haiku pricing and prompt caching |
| 12 | [evaluation.md](12-evaluation.md) | How to measure whether the bot is any good |
| 13 | [glossary.md](13-glossary.md) | Every term in one place |
| 14 | [model-hosting.md](14-model-hosting.md) | Where the local models live and run after deploy |

## The one-paragraph summary

A user asks a question. The system checks who they are and which workspace and projects they are allowed to see. It rewrites the question into a clean search query, pulls candidate text chunks from Pinecone (filtered to their workspace and projects), reranks those chunks with a cross-encoder for accuracy, and asks Claude Haiku to answer using only those chunks, with citations. If the retrieved text is weak, the system loops back and tries again, up to three times. If it still has nothing solid, it says so instead of guessing.

## Stack at a glance

- Orchestration: LangChain plus LangGraph
- Model: Claude Haiku 4.5 (`claude-haiku-4-5`) through `ChatAnthropic`
- Embeddings: free HuggingFace model, runs locally
- Reranking: free cross-encoder, runs locally
- Vector store: Pinecone, one namespace per workspace
- Metadata and access store: Firebase Firestore
- API: Python FastAPI
- Tracing and evaluation: LangSmith
