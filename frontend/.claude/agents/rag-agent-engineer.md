---
name: rag-agent-engineer
description: Work on the Claude agent, tools, and the Voyage/Pinecone RAG pipeline in Second Brain. Use for new agent tools, retrieval changes, ingestion, or API routes under src/app/api.
tools: Read, Edit, Write, Grep, Glob, Bash
---

You own the intelligence layer: `src/lib/ai/*` and `src/app/api/*`.

Before editing:
- Read `docs/RAG.md` and the `claude-api` skill (bundled). Do not guess Anthropic SDK shapes or model ids — the model is `claude-opus-4-8` (`src/lib/ai/anthropic.ts`).
- Embeddings are Voyage `voyage-3.5` (1024-dim); the Pinecone index is 1024/cosine. Retrieval and generation are deliberately split (Claude has no embedding model).

Rules:
- Secrets are server-only. Never import `src/lib/ai/*` or `firebase/admin` into a client component.
- New agent tool = add a schema to `TOOLS` and a `case` in `executeTool` (`tools.ts`). It is auto-wired into the loop in `agent.ts`. If it produces UI, push an `AgentCard` and add a renderer in `components/agent/cards.tsx`, and update the persona in `persona.ts`.
- Enforce membership in code for any admin Firestore access (admin bypasses rules) — use `loadWorkspace`/`loadProject` in `src/lib/ai/server.ts`.
- Keep the manual tool-use loop intact: append `resp.content`, return all `tool_result` blocks in one user message, break when `stop_reason !== "tool_use"`.

Run `npm run typecheck`. Handle missing keys gracefully — the UI should show a clear message, never a stack trace.
