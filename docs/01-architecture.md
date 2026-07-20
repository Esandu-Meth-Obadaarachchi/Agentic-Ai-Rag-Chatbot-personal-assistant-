# 01 — Architecture

## The components

| Component | Job | Technology |
|-----------|-----|------------|
| API | Front door. Auth, routing, orchestration | FastAPI |
| Orchestrator | Runs the retrieval loop as a state machine; the agent as a tool-calling loop | LangGraph |
| Reasoning model | Agent reasoning, tool calls, generation, and the retrieval helper calls (rewrite, grade, groundedness) | Claude (Haiku 4.5 by default, `CLAUDE_MODEL`) |
| Embedder | Turns text into vectors | Voyage `voyage-3.5`, hosted API |
| Reranker | Orders chunks by true relevance | Voyage `rerank-2.5`, hosted API |
| Vector store | Holds chunks and their vectors | Pinecone, one namespace per project |
| Metadata store | Workspaces, projects, tasks, membership, chat history | Firestore |
| Auth | Verifies the caller | Firebase Admin (ID token verification) |

The reasoning model, embedder, and reranker are three different models with three different jobs. Do not confuse them.

- The embedder is a bi-encoder. It reads one piece of text and outputs a vector. Fast, used at scale.
- The reranker is a cross-encoder. It reads the question and one chunk together and outputs a relevance score. Slower, used on a short list.
- Claude is the generator and the decision-maker. It reads the conversation, decides which tools to call, and writes the final prose.

## Two paths through the system

### Write path (ingestion)

`POST /api/ingest` runs synchronously inside the request — there is no background worker or queue in this build. A user is waiting, but the work is small (one file, embedded in batches), so it finishes within the request's timeout.

```
document upload (multipart) or pasted text
   -> FastAPI /api/ingest
   -> auth + membership check (load_project enforces the caller is on the project)   [SECURITY GATE]
   -> parse (pypdf / python-docx / raw text)
   -> chunk (RecursiveCharacterTextSplitter, ~1000 chars, 200 overlap)
   -> embed each chunk (Voyage voyage-3.5)
   -> upsert to Pinecone, namespace = the project's own namespace
   -> return {chunksStored, filename, project}
```

Detail in [ingestion.md](07-ingestion.md).

### Read path (chat)

`POST /api/chat` runs the agent. This is online; a user is waiting.

```
user message
   -> FastAPI /api/chat
   -> auth: verify Firebase ID token, resolve uid                    [SECURITY GATE]
   -> load_user_scope: every workspace + project the uid is a member of (Firestore)
   -> LangGraph ReAct agent (Claude, tool-calling loop):
        -> the model decides which tool(s) to call, if any
        -> search_knowledge  -> runs the retrieval subgraph (rewrite -> retrieve
                                 -> rerank -> grade -> retry), scoped to the
                                 caller's accessible project namespaces
        -> list_tasks / create_task / create_tasks / update_task / summarize_project
           -> read/write Firestore, scoped by memberIds
        -> repeats until the model produces a final answer with no more tool calls
   -> groundedness self-check, if any sources were used (plain function call, not a graph node)
   -> return {answer, steps, sources, cards}
```

Detail on the agent in [agentic-loop.md](09-agentic-loop.md), on the retrieval subgraph in [retrieval-reranking.md](08-retrieval-reranking.md).

Note what this build does *not* have: no separate "router" node that classifies small talk versus a real question before the loop starts. Routing happens implicitly — the ReAct agent simply does not call `search_knowledge` (or any tool) when the message does not call for one, so "hi" costs one small model call and nothing else. This is a different mechanism from an explicit classifier node, and it is worth knowing the difference if you are asked about it.

## The data-flow picture

```
   Next.js frontend  ─────▶  FastAPI  ── verify Firebase ID token ──┐
                                                                     │ uid (trusted)
                                                                     ▼
                                                     load_user_scope (Firestore, memberIds)
                                                                     │ accessible projects
                                                                     ▼
                                              ┌──────────────────────────────────┐
                                              │   LangGraph ReAct agent (Claude)  │
                                              │   tool-calling loop               │
                                              └───┬─────────────┬─────────────┬──┘
                                                  │             │             │
                                    ┌─────────────▼──┐   ┌──────▼─────┐  ┌────▼──────┐
                                    │ search_knowledge│   │  Pinecone  │  │ Firestore │
                                    │  -> retrieval    │──▶│ (vectors,  │  │ (tasks,   │
                                    │     subgraph     │   │ ns/project)│  │ workspaces,│
                                    │  rewrite->retrieve│  └────────────┘  │ memberIds)│
                                    │  ->rerank->grade  │                  └───────────┘
                                    │  ->retry (Voyage) │
                                    └───────────────────┘
```

## Where the security boundary sits

The boundary sits in FastAPI, before the agent runs. `get_current_user` verifies the token; `load_user_scope` resolves the accessible projects from Firestore. By the time the LangGraph agent starts, the project list (and therefore which Pinecone namespaces can ever be searched, and which Firestore docs can ever be read) is already fixed server-side. The agent never re-derives it and never trusts anything from the request body except the message itself. This placement is deliberate and non-negotiable. See [access-control.md](02-access-control.md).

## Deployment shape

- FastAPI runs as a single stateless container — no separate worker process, no Redis. Ingestion is synchronous, so there is nothing to queue.
- Voyage, Pinecone, Anthropic, and Firebase are managed services reached over the network; no model weights are loaded into the container.
- Target: AWS ECS Fargate behind an Application Load Balancer, secrets from AWS Secrets Manager. See [deploy-aws-ecs.md](15-deploy-aws-ecs.md).
