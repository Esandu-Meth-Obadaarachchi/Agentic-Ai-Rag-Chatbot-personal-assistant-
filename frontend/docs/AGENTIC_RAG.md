# Agentic RAG — the retrieval loop, in depth

`docs/RAG.md` covers the whole system. This document zooms into the **retrieval loop** — the part that decides *which passages* the agent gets to reason over. Retrieval quality is the ceiling on answer quality: the best model in the world cannot answer well from the wrong context. Everything here lives in `src/lib/ai/retrieval.ts`.

---

## Why "agentic" retrieval instead of a single fetch

The naive RAG pipeline is one step: embed the question, fetch the top-k nearest vectors, stuff them in the prompt. It fails in predictable ways:

- The user's phrasing is a bad search query ("what did we decide about the thing last week?").
- The top-k by vector similarity are *approximately* relevant, not the *best* passages.
- Sometimes the right passage simply is not in the first pull, and a naive pipeline has no recourse — it answers from weak context anyway.

Agentic retrieval adds a small control loop that fixes each of these: it rewrites the query, reranks with a cross-encoder, grades its own results, and retries when they are weak — then checks the final answer against its sources. It is "agentic" because the system makes decisions about its own retrieval rather than running a fixed pipeline once.

```
question
  -> rewrite      (Haiku turns it into a search-optimised query)
  -> retrieve     (Voyage embed + Pinecone across the user's allowed namespaces, WIDE net of 20)
  -> rerank       (Voyage rerank-2.5 cross-encoder, keep the best 4)
  -> grade        (Haiku: do these chunks answer the question? good | weak)
        weak and attempts < 2 -> rewrite from a NEW angle and retry
  -> generate     (the agent writes the answer in agent.ts, on CLAUDE_MODEL)
  -> self-check    (Haiku: is every claim supported by the sources?)
```

The "allowed namespaces" are every project the requesting user belongs to, across all their workspaces (`loadUserScope`), each gated by `memberIds` — broad access, no isolation leak.

---

## Step 1 — Rewrite (`rewriteQuery`)

**What:** a cheap Haiku call turns the raw question into a keyword-and-entity-rich search query.

**Why:** embedding search matches *meaning*, but a conversational question carries filler ("can you remind me...", "I think we...") that dilutes the signal. Rewriting concentrates the query on the entities and terms that actually discriminate between documents. On a **retry**, the rewriter is told the previous query was weak and asked for a *different* angle, so the second attempt is not just a rephrase of the first — it comes at the topic from a new direction (different synonyms, a related entity, a broader or narrower framing).

**Cost:** one short Haiku call (`maxTokens: 80`).

---

## Step 2 — Retrieve, the wide net (`retrieveAndRerank`, first half)

**What:** embed the query (`embedQuery`, `input_type: "query"`) and pull **`CANDIDATES = 20`** nearest vectors from the allowed namespaces via `queryNamespaces`, which fans out across namespaces and merges by score.

**Why 20 and not 4?** This stage optimises **recall**, not precision. We do not yet care about perfect ordering — we care that the truly-relevant passage is *somewhere* in the set. The bi-encoder (embedding search) is fast but only approximately right, so we cast a deliberately wide net and let the next stage sort it out. If the right passage is not in these 20, no amount of reranking recovers it; if it is buried at position 15, reranking will surface it.

---

## Step 3 — Rerank, the precision pass (`rerank`, `retrieveAndRerank` second half)

**What:** `rerank-2.5` (a cross-encoder) scores each of the 20 `(query, chunk)` pairs and we keep the top **`KEEP = 4`**.

**Bi-encoder vs cross-encoder — the core idea:**
- The embedding search is a **bi-encoder**: query and document are encoded into vectors *separately*, then compared by cosine. Separate encoding is what makes it fast (documents are pre-embedded once) but also what makes it imprecise — the model never sees the two together, so it cannot judge subtle relevance.
- The reranker is a **cross-encoder**: it runs the query and one document through the model *together*, so it can directly weigh "how well does this passage answer this query?". Much more accurate, but it cannot be pre-computed, so it only runs on the 20 candidates, never the whole corpus.

**Why this is the biggest lever after chunking:** vector similarity confuses "about the same topic" with "answers this question". The cross-encoder fixes exactly that, promoting the passage that *answers* over the passage that merely *mentions*. Going from top-4-by-cosine to top-4-after-rerank is usually the single largest jump in answer quality.

---

## Step 4 — Grade (`gradeChunks`)

**What:** a Haiku call reads the kept passages and returns one word: `good` or `weak` — does this context contain enough to answer the question?

**Why:** without a grader, the pipeline always answers, even from irrelevant context, which is how you get confident hallucination. The grader is the loop's decision point: a `good` verdict proceeds to generation; a `weak` verdict triggers a retry with a fresh query. It is a cheap, blunt instrument (5 output tokens), and that is fine — we only need a rough "is this worth answering from?" signal.

---

## Step 5 — Retry (the loop in `agenticRetrieve`)

On a `weak` grade, and while `attempts < MAX_ATTEMPTS = 2`, the loop rewrites the query from a new angle and searches again, keeping the best-scoring set seen so far. After the ceiling it stops and returns the best it found rather than looping forever.

**Why cap at 2?** Each retry is another rewrite + embed + Pinecone query + rerank + grade — real latency and cost. In practice a second, differently-angled attempt captures most of the recoverable cases; a third rarely helps enough to justify the wait. This is a latency/accuracy trade-off, and 2 is the tuned default.

---

## Step 6 — Generate

The agent (`agent.ts`, on `CLAUDE_MODEL`) writes the answer from the kept passages. This is the only expensive call in the chain; everything above uses cheap Haiku helpers so we spend the big model's budget once, on well-chosen context.

---

## Step 7 — Grounded self-check (`checkGrounded`)

**What:** after generation, a Haiku call asks: is every factual claim in the answer supported by the retrieved sources? If not, the answer gets a subtle caveat appended rather than being presented as fact.

**Why:** even with good retrieval, a model can over-reach and assert things the sources do not support. This is a last, cheap guardrail against hallucination — it does not block the reply (never fail a whole answer on the self-check), it just flags when the answer drifted past its evidence. It only runs when the answer actually drew on retrieved documents.

---

## The models and where the money goes

| Step | Model | Why |
|---|---|---|
| rewrite, grade, groundedness | **Haiku** (`CLAUDE_FAST_MODEL`) | short answers, run often — always the cheapest model regardless of the generation model |
| retrieve | Voyage `voyage-3.5` embeddings + Pinecone | fast first-stage recall |
| rerank | Voyage `rerank-2.5` cross-encoder | precise second-stage ranking |
| generate | `CLAUDE_MODEL` (default Haiku, swap to Opus/Sonnet) | the one expensive reasoning call |

Generation is also cost-capped in `agent.ts`: `MAX_ANSWER_TOKENS` 1024, `MAX_TOOL_ROUNDS` 6, and only the last 5 turns are sent. So a knowledge question is: a few tiny Haiku calls + one Voyage rerank + one bounded generation. Cheap, and every stage is independently tunable.

---

## Tuning knobs (`src/lib/ai/retrieval.ts`)

- `CANDIDATES` (20) — the wide net from the bi-encoder. Raise for more recall at more rerank cost.
- `KEEP` (4) — chunks kept after reranking and fed to the model. Fewer keeps the prompt tight and cheaper; more gives the model more to work with.
- `MAX_ATTEMPTS` (2) — the grade-and-retry ceiling. Bounds latency and cost.

Rules of thumb: if answers miss facts that *are* in the docs, raise `CANDIDATES` (recall problem) or check chunking. If answers are padded with irrelevant context, lower `KEEP` (precision problem). If specific hard questions fail, raise `MAX_ATTEMPTS` or improve the rewrite prompt.

---

## What was deliberately left out, and why

**LangChain / LangGraph.** The loop is small enough to read top-to-bottom in `retrieval.ts` and `agent.ts`. A framework would add a dependency and a layer of indirection for a loop we can already see and control. LangSmith gives the observability without the framework — the reason most people reach for LangChain.

**A vector-only, no-rerank pipeline.** Simpler and slightly cheaper, but it caps out at "top-k by cosine", which is the accuracy problem the cross-encoder exists to solve. The rerank pass is worth its cost.

---

## Observability

With `LANGSMITH_TRACING=true` and a key set, every call in this loop is traced: you can see the rewritten query, exactly which 20 candidates came back, how the reranker reordered them, the grade verdict, and the groundedness result. When a RAG answer is wrong, this is how you find *where* — bad rewrite, bad recall, bad ranking, or bad generation — instead of guessing.

---

## No re-ingestion needed for retrieval changes

The retrieval loop, the reranker, the cross-workspace scope, and the cost caps all operate at *query* time. They do not change how documents are stored (still `voyage-3.5`, 1024-dim, per-project namespaces), so existing Pinecone vectors stay valid — you can tune retrieval freely without re-embedding anything. Re-ingestion is only needed if you change the embedding model, dimension, or chunking.
