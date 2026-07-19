# RAG + the agent — how Lune AI's brain works

This is the full teaching walkthrough of Lune AI's retrieval-augmented generation (RAG) system and the agent that sits on top of it: **what** each piece is, **how** it works, and **why** it was built that way. Read `docs/AGENTIC_RAG.md` next for the deep dive on the retrieval loop specifically.

---

## 0. The 30-second mental model

A user asks a question. We do not send that question straight to the language model and hope. Instead:

1. **Retrieval** finds the handful of document passages most likely to answer it (from the user's uploaded docs).
2. **Generation** hands those passages plus the question to Claude, which writes a grounded answer and can also read/write the user's tasks.

RAG = *retrieve the right context, then generate*. The model's job shifts from "remember everything" to "reason over what we handed it". That is what makes answers accurate and citable instead of confidently wrong.

Two model families do the work, because they are good at different things:

| Job | Model | Why |
|---|---|---|
| Turn text into vectors (embeddings) | **Voyage `voyage-3.5`** (1024-dim) | Claude has no embedding endpoint. Voyage is Anthropic's recommended embedding partner. |
| Score (query, passage) relevance | **Voyage `rerank-2.5`** (cross-encoder) | A dedicated reranker is far more precise than raw vector similarity. |
| Read, reason, write the answer, call tools | **Claude** (`CLAUDE_MODEL`, default `claude-haiku-4-5`) | The generative "brain". |

---

## 1. Why this architecture

**Why split embeddings and generation across two vendors?** Because retrieval and generation are different problems. Embeddings need a model trained to place similar *meanings* near each other in vector space; generation needs a model trained to reason and write. Claude is excellent at the second and does not expose the first, so we pair it with Voyage. Keeping them separate also means we can swap either side without touching the other.

**Why RAG at all instead of stuffing everything into the prompt?** Two reasons: cost and accuracy. Sending an entire document library on every question is expensive and dilutes the model's attention. Retrieving only the relevant 4 passages keeps the prompt small, cheap, and focused, and lets us cite exactly what the answer came from.

**Why per-project isolation?** Each project owns its own slice of the vector store (a Pinecone *namespace*). A question scoped to one project can never surface another project's documents. This is both a product feature (clean separation) and a security boundary (see §6).

---

## 2. The ingestion pipeline — getting documents in

Route: `POST /api/ingest` (`src/app/api/ingest/route.ts`). Flow:

```
file or pasted text
  -> parse        (extract plain text)
  -> chunk        (split into ~1000-char overlapping pieces)
  -> embed        (Voyage: each chunk -> a 1024-number vector)
  -> upsert       (store vectors in the project's Pinecone namespace)
```

### 2.1 Parsing — `src/lib/ai/parse.ts`

Turn any upload into plain UTF-8 text:
- **PDF** → `pdf-parse`
- **DOCX** → `mammoth` (`extractRawText`)
- **Markdown / code / txt / csv / json** → read as raw UTF-8

The `type` (pdf/docx/markdown/code/text) is stored as metadata so the UI and the model know what a chunk came from.

### 2.2 Chunking — `src/lib/ai/chunker.ts`

**What:** a *recursive character splitter*, ~**1000 characters per chunk with 200 characters of overlap** (a 20% overlap).

**How:** it walks the text in ~1000-char windows, but before cutting it tries to break on the *nicest* separator available inside the window, in priority order: paragraph break (`\n\n`) → line break (`\n`) → sentence end (`. `) → space → hard cut. It only accepts a separator past the halfway point of the window, so chunks stay a sensible size instead of collapsing to tiny fragments.

**Why chunk at all?** Embedding models have an input limit and, more importantly, a *whole document* embedded as one vector is a blurry average of everything in it — you lose the ability to pinpoint the one relevant paragraph. Smaller chunks give sharper, more targeted matches.

**Why overlap?** Because a fact can straddle a boundary. If chunk A ends "...the deadline is" and chunk B starts "the 14th of March", neither alone answers "when is the deadline?". Overlapping the last 200 characters of A into the start of B means the complete sentence lives in at least one chunk. The cost is mild duplication in the store; the benefit is not losing facts at the seams. 20% is a common sweet spot: enough to catch boundary-spanning facts, not so much that the index bloats.

**Why break on separators instead of a blind cut?** A chunk that ends mid-word or mid-sentence embeds poorly (the vector represents a fragment of an idea). Breaking on paragraph/sentence boundaries keeps each chunk a coherent unit of meaning.

### 2.3 Embeddings — `src/lib/ai/voyage.ts`

**What:** `voyage-3.5`, output forced to **1024 dimensions** (`output_dimension: 1024`).

**How:** each chunk becomes a list of 1024 floating-point numbers — a point in 1024-dimensional space where semantically similar text lands nearby. Documents are embedded in **batches of 96** (`embedDocuments`) to respect API limits; a search query is embedded one at a time (`embedQuery`).

**Why the `input_type` distinction (`document` vs `query`)?** Voyage embeds documents and queries with slightly different instructions so that a short question and the longer passage that answers it land close together despite their different shape and length. Ingestion uses `input_type: "document"`; search uses `input_type: "query"`. Getting this wrong quietly hurts recall.

**Why 1024 dimensions?** More dimensions capture more nuance but cost more storage and compute; fewer are cheaper but coarser. 1024 is a strong balance for this size of corpus, and it must match the Pinecone index exactly.

### 2.4 Vector store — `src/lib/ai/pinecone.ts`

**What:** one Pinecone index, **dimension 1024, metric cosine**, with **one namespace per project** (`project.ragNamespace`, a slug of workspace + project name).

**How:** `upsertChunks` writes vectors (in batches of 100) into the project's namespace. Each vector carries metadata: the original `text`, the `source` filename, the `project` name, the `type`, and `uploadedAt`. Storing the text alongside the vector means retrieval returns the passage directly — no second lookup.

**Why cosine?** Cosine similarity measures the *angle* between two vectors, i.e. how aligned their directions are, ignoring magnitude. For text embeddings, direction encodes meaning, so cosine is the natural fit (and it must match how the embedding model was trained).

**Why namespaces instead of one big pool with a project filter?** Namespaces are a hard partition inside the index. Searching a namespace physically cannot return another namespace's vectors, so isolation is structural, not a filter you might forget to apply. It is also faster — you search a smaller space.

---

## 3. The retrieval pipeline — finding the right passages

This is the heart of RAG, and Lune AI runs an **agentic loop** rather than a single fetch. Full detail in `docs/AGENTIC_RAG.md`; the summary:

```
question
  -> rewrite      (Haiku turns the question into a search-optimised query)
  -> retrieve     (embed + Pinecone across allowed namespaces — a WIDE net of 20)
  -> rerank       (rerank-2.5 cross-encoder scores each pair, keep the best 4)
  -> grade        (Haiku: do these passages actually answer it? good | weak)
        weak, attempts < 2 -> rewrite from a new angle and retry
  -> generate     (the agent writes the answer on CLAUDE_MODEL)
  -> self-check    (Haiku: is every claim supported by the sources?)
```

### 3.1 The one concept that matters most: bi-encoder vs cross-encoder

- A **bi-encoder** (the embedding search) encodes the query and each document *separately* into vectors, then compares them by cosine. It is fast — you can pre-compute every document vector once — and it powers the first-stage "wide net". But because it never looks at the query and document *together*, it is only approximately right.
- A **cross-encoder** (the reranker) takes a `(query, document)` pair and runs them through the model *together*, so it can weigh exactly how well this document answers this query. It is far more precise, but you cannot pre-compute it — you must run one model pass per candidate, so it is too slow to run over the whole corpus.

The winning pattern, used here, is **two-stage retrieve-then-rerank**: use the cheap bi-encoder to pull a wide net of ~20 candidates (optimise *recall* — get the right passage in there somewhere), then use the expensive cross-encoder to reorder them and keep the best 4 (optimise *precision* — put the right passage at the top). This is the single biggest accuracy lever after chunking.

### 3.2 Scope and security — cross-workspace, but membership-gated

The agent searches **every project the user can access, across all their workspaces** (`loadUserScope` in `src/lib/ai/server.ts`). `queryNamespaces` fans out across those namespaces and merges results by score. Crucially, "can access" is gated by `memberIds`: a user only ever sees projects whose `memberIds` include their uid, so a teammate scoped to specific projects can never retrieve another project's knowledge through the chatbot. Access is broad (all your workspaces); isolation never leaks. See §6.

---

## 4. Generation — the agent tool loop

Retrieval is only half the system. The other half is the **agent**: a Claude tool-use loop (`src/lib/ai/agent.ts`) that can search knowledge *and* read/write tasks.

### 4.1 How a tool-use loop works

```
1. Send: system prompt + tool schemas + conversation.
2. Claude replies. If it wants to act, it returns tool_use block(s) (stop_reason "tool_use").
3. We execute each tool, append the results, and loop back to step 1.
4. When Claude returns text with no tool_use, that is the final answer.
```

The tools (`src/lib/ai/tools.ts`):

| Tool | What it does |
|---|---|
| `search_knowledge` | Runs the agentic retrieval loop over the allowed namespaces |
| `list_tasks` | Lists tasks across all the user's workspaces; filters by project, **assignee**, **parent (subtasks-of)**, status or time; each row carries its assignee + parent |
| `create_task` | Creates one task |
| `create_tasks` | Creates many tasks / a nested subtask tree in one call, with exact parent-child links |
| `update_task` | Updates a task by title |
| `summarize_project` | Tasks + top knowledge for a project |

Tool executors accumulate `sources`, `cards` and `steps` on a shared `ToolContext`, which the route returns so the UI can render structured cards (task lists, created tasks, sources) instead of only prose.

### 4.2 Why `create_tasks` (the batch tool) exists

Every task and subtask is one write. Building a 10-task tree with subtasks is ~50 operations. On Haiku with a bounded output budget, the model cannot emit 50 tool calls — it would create the top-level tasks and stop. `create_tasks` lets the model send the whole nested tree in a single call; the server creates it recursively, threading the real parent id so nesting is exact (no fragile title-matching). This is both a reliability fix and the correct way to express hierarchy.

### 4.3 Cost caps (`agent.ts`)

- `MAX_ANSWER_TOKENS = 1024` — ceiling on generated output per reply. Output tokens are the expensive side.
- `MAX_TOOL_ROUNDS = 6` — ceiling on loop iterations, with headroom for a big `create_tasks` build.
- Only the **last 5 conversation turns** are sent to the model each request; the full history lives in Firestore. This keeps the input prompt small and cheap.
- `MAX_CHAT_INPUT_CHARS = 2000` bounds a single user message (enforced in the composer and again server-side).

### 4.4 Handling truncation and errors

If the model is cut off mid-response (`stop_reason: "max_tokens"` — usually a `create_tasks` call too big for one turn), the loop detects it and returns a clear "that was too much, split it into smaller batches" message instead of a blank reply. Tool executions that throw are surfaced in the action trace (`⚠️ tool failed: …`) and marked `is_error` to the model. An empty answer falls back to a readable message. Silence is never an acceptable outcome.

### 4.5 Why "thinking" is off and reasoning is hidden

Extended thinking would add latency and cost. Instead the persona prompt (`src/lib/ai/persona.ts`) instructs Claude to reply with final answers only; the tool-call trace is surfaced separately as collapsible **steps**, so the user still sees *what* the agent did without the model narrating its reasoning into the chat.

---

## 5. The cost model — where the money goes

Understanding this is core to being an AI engineer: you pay per token, split into input and output, and output is pricier.

| Lever | Where | Effect |
|---|---|---|
| Generation model | `CLAUDE_MODEL` env (default Haiku `$1/$5` per 1M in/out) | The single biggest driver. Opus is ~5× the cost of Haiku. |
| Output cap | `MAX_ANSWER_TOKENS` 1024 | Bounds the expensive side per reply. |
| Tool rounds | `MAX_TOOL_ROUNDS` 6 | Each round re-sends the growing context (input tokens). |
| History window | last 5 turns | Caps input tokens from conversation. |
| Retrieval context | 4 chunks × 500 chars | Fewer/shorter passages = smaller prompt. |
| Retry ceiling | `MAX_ATTEMPTS` 2 | Bounds the cheap Haiku helper calls. |

The retrieval *helper* steps (rewrite, grade, groundedness) always run on **Haiku** regardless of the generation model — they only need a short answer, so paying Opus rates for them would be waste. A single knowledge question adds a few small Haiku calls plus one Voyage rerank on top of the embed + Pinecone query.

---

## 6. Security and isolation

Every task/project/workspace/knowledge boundary is enforced by `memberIds`:

- Firestore documents carry `memberIds`; `firestore.rules` gates every read/write on `request.auth.uid in memberIds`.
- The agent runs server-side with the Firebase Admin SDK, which **bypasses** those rules — so it re-checks membership in code. `loadUserScope` only loads workspaces/projects where the uid is in `memberIds`, and `list_tasks` queries `where("memberIds", "array-contains", uid)`.
- Because knowledge namespaces map 1:1 to projects, and the agent only ever searches the user's accessible projects' namespaces, RAG inherits the same isolation.

The net guarantee: access is as broad as the user's real membership (all their workspaces), and never one document wider.

---

## 7. Observability — LangSmith

The Anthropic client is wrapped with LangSmith (`wrapAnthropic` in `src/lib/ai/anthropic.ts`). It is a no-op unless `LANGSMITH_TRACING=true` and a key are set, so it is always safe to leave in. When on, every model call in the agent and the retrieval loop is traced — you can inspect the rewritten query, the grade verdict, the groundedness check, and the full tool loop for any request. This is how you debug a RAG system: you look at what was actually retrieved and how the model reasoned over it.

---

## 8. Design choices and trade-offs

- **No LangChain / LangGraph.** The agent calls the Anthropic SDK directly. The loop is ~120 readable lines in `agent.ts`; a framework would add weight and indirection without buying anything here. LangSmith gives the observability people usually reach for LangChain to get.
- **Manual tool loop, not a hosted agent.** We own the loop, so we own the cost caps, the truncation handling, and the exact tools. Full control, no black box.
- **Per-project namespaces, not one pool + metadata filter.** Structural isolation beats a filter you can forget.
- **Two-stage retrieve-then-rerank, not top-k vector search alone.** Precision matters more than a slightly cheaper query.
- **Cheap model by default, configurable up.** Haiku handles most questions; `CLAUDE_MODEL` swaps to Opus/Sonnet for hard ones without a code change.
- **Store the chunk text in the vector metadata.** Trades a little storage for one fewer round-trip on every retrieval.

---

## 9. Fixes and lessons (real bugs, and why they happened)

- **Per-project scope was not enforced in the agent.** The chat route originally loaded every project in the *workspace*, so a scoped member could read another project's knowledge. Fixed by filtering to the user's `memberIds` projects — a reminder that admin-SDK code must re-implement the checks that Firestore rules would otherwise enforce.
- **Chat history loaded blank.** `loadChatMessages` queried by `chatId` only. Firestore rules are *not* filters — a list query must itself be constrained to what the rules allow (`memberIds array-contains uid`), or it is rejected outright. Fixed by querying on `memberIds` and narrowing to the chat in JS.
- **Agent created top-level tasks but not subtasks.** ~50 separate `create_task` calls exceeded the tool-round / token budget. Fixed with the `create_tasks` batch tool.
- **Silent "…" on an over-long request.** A too-big tool call hit `max_tokens`, the loop treated the truncated response as "no tool call", and returned an empty string. Fixed by detecting `max_tokens` and returning an actionable message.
- **Agent could not answer "assigned to X" or "subtasks of Y".** `list_tasks` was dropping the assignee and parent fields and had no filter for them. Fixed by returning both and adding `assignee` / `under` filters.

The through-line: most RAG/agent bugs are not the model being dumb — they are *plumbing* (wrong query shape, dropped fields, budget limits, missing re-checks). Read the traces, check the data shape.

---

## 10. Where the code lives

| File | Role |
|---|---|
| `src/app/api/ingest/route.ts` | Ingestion endpoint |
| `src/lib/ai/parse.ts` | Document parsing (pdf/docx/text) |
| `src/lib/ai/chunker.ts` | Recursive character splitter |
| `src/lib/ai/voyage.ts` | Embeddings (`embedDocuments`/`embedQuery`) + `rerank` |
| `src/lib/ai/pinecone.ts` | Vector upsert + `queryNamespace(s)` |
| `src/lib/ai/retrieval.ts` | The agentic retrieval loop (see `docs/AGENTIC_RAG.md`) |
| `src/lib/ai/tools.ts` | Agent tool schemas + executors |
| `src/lib/ai/agent.ts` | The Claude tool-use loop, cost caps, truncation handling |
| `src/lib/ai/persona.ts` | The agent's system prompt |
| `src/lib/ai/anthropic.ts` | Anthropic client + LangSmith wrap + `complete()` helper |
| `src/lib/ai/server.ts` | `loadUserScope` / `loadProject` (membership-checked loads) |
| `src/app/api/chat/route.ts` | Chat endpoint — assembles the tool context and runs the agent |

Always check the `claude-api` skill for the current model ids and SDK shapes before editing this layer — do not guess.

## 11. Tuning knobs (quick reference)

| Knob | Where | Default | Raise to… |
|---|---|---|---|
| Chunk size / overlap | `chunker.ts` | 1000 / 200 | larger for prose, smaller for dense/technical text |
| Embedding dim | `voyage.ts` `EMBED_DIM` | 1024 | must match the Pinecone index |
| Wide-net size | `retrieval.ts` `CANDIDATES` | 20 | more recall, more rerank cost |
| Kept after rerank | `retrieval.ts` `KEEP` | 4 | more context, bigger prompt |
| Retry ceiling | `retrieval.ts` `MAX_ATTEMPTS` | 2 | more chances on hard queries, more latency |
| Generation model | `CLAUDE_MODEL` env | `claude-haiku-4-5` | higher answer quality at higher cost |
| Output cap | `agent.ts` `MAX_ANSWER_TOKENS` | 1024 | longer answers / bigger batches per turn |
| Tool rounds | `agent.ts` `MAX_TOOL_ROUNDS` | 6 | more multi-step headroom |
