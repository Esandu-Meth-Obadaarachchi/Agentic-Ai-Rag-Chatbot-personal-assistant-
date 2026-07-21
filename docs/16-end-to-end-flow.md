# 16 — End-to-end flow: what we built, start to finish

This is the one file that walks the whole system in order, from a click in the
browser to the answer on screen. Every other file in `docs/` goes deep on one
piece; this one is the map that shows how the pieces connect, and exactly what
LangChain does versus what LangGraph does. Read this first if you want the whole
picture before the detail, or read it last as the thing that ties everything
together.

## The one-diagram version

```
BROWSER (Next.js frontend, agentic-rag-aws/frontend/)
  │  user signs in with Google (Firebase Auth)
  │  user types a message in the agent chat
  ▼
POST /api/chat  (Next.js route, now a thin proxy)
  │  forwards the request AS-IS, including "Authorization: Bearer <Firebase ID token>"
  ▼
FASTAPI BACKEND (agentic-rag-aws/backend/, this is what we rebuilt)
  │
  ├─ 1. AUTH GATE            security/auth.py + security/firebase.py
  │     verify_id_token(token) -> uid          (401 if invalid/expired)
  │
  ├─ 2. SCOPE RESOLUTION     data/firestore.py
  │     every workspace + project where memberIds array-contains uid
  │     -> the ONLY trusted list of what this user may search or edit
  │
  ├─ 3. THE AGENT             rag/agent.py  (LangGraph, prebuilt ReAct loop)
  │     Claude Haiku decides, per turn, whether it needs a tool
  │     │
  │     ├─ no tool needed          -> answers directly from conversation
  │     │
  │     ├─ search_knowledge tool   -> rag/retrieval.py (LangGraph, hand-authored)
  │     │     rewrite -> retrieve+rerank -> grade -> retry (up to 2x) -> chunks
  │     │        │            │
  │     │        │            ├─ embed query    -> Voyage voyage-3.5   (LangChain)
  │     │        │            ├─ vector search  -> Pinecone            (direct client)
  │     │        │            └─ rerank top 20  -> Voyage rerank-2.5   (LangChain)
  │     │
  │     ├─ list_tasks / create_task / create_tasks / update_task
  │     │     -> Firestore reads/writes, scoped by memberIds
  │     │
  │     └─ summarize_project      -> tasks + a knowledge_search combined
  │
  ├─ 4. GROUNDEDNESS CHECK    rag/retrieval.py::check_grounded
  │     one more Claude call: does every claim trace to a retrieved chunk?
  │     (plain function call, not a graph node, runs after the agent is done)
  │
  ▼
{ answer, steps, sources, cards }   JSON response, same shape the frontend already expects
  ▲
  │
BROWSER renders the answer + source cards + task cards
```

## Step by step, in the order a real request hits them

### 1. The frontend sends the request

The frontend is the same Next.js UI as the original app (`agentic-rag-aws/frontend/`,
copied from `second-brain/`). Its `POST /api/chat`, `/api/ingest` and `/api/related`
routes no longer contain any AI logic — each one now just forwards the request
(headers, body, the Firebase ID token) to the FastAPI backend and passes the
response straight back:

```ts
// frontend/src/app/api/chat/route.ts (the whole route now, roughly)
const res = await fetch(`${RAG_API_URL}/api/chat`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: auth },
  body,
});
return new NextResponse(await res.text(), { status: res.status });
```

`RAG_API_URL` is `http://localhost:8000` locally, and would be the ECS service URL
in production. Nothing else in the frontend changed — same components, same
Firebase sign-in, same chat UI.

### 2. FastAPI verifies who is asking

`backend/app/security/auth.py` is a FastAPI dependency, `get_current_user`, run on
every `/api/*` route. It reads the `Authorization: Bearer <token>` header and
calls `security/firebase.py::verify_id_token`, which hands the token to the
Firebase Admin SDK. The SDK checks the signature, expiry and audience against the
real Firebase project — this is not something we can forge or fake locally. A bad
or missing token is a 401 before anything else runs.

This gives us exactly one trusted fact: `uid`. Nothing else in the request body
(`workspaceId`, `projectId`) is trusted for access control — those are only used
later to pick sensible defaults.

### 3. FastAPI resolves what this user can actually see

`backend/app/data/firestore.py::load_user_scope(uid)` runs two Firestore queries:

```python
workspaces = query("workspaces", where memberIds array_contains uid)
projects   = query("projects",   where memberIds array_contains uid)
```

This is the same isolation model the original TypeScript app's Firestore security
rules already enforce (`memberIds` on every document). Because we query by
`array-contains uid`, it is structurally impossible to get back a project the
user is not a member of — there is no filter to forget, no id to check by hand.
A person scoped to only two projects in a workspace simply never appears in any
other project's `memberIds`, so those other projects never come back here.

The result of this step — the list of accessible projects, each carrying its own
Pinecone namespace (`ragNamespace`) — is what everything downstream is allowed to
touch. Full detail: [02-access-control.md](02-access-control.md).

### 4. The agent runs — this is where LangGraph starts

`backend/app/rag/agent.py::run_agent` builds a **LangGraph prebuilt ReAct agent**:

```python
from langgraph.prebuilt import create_react_agent

agent = create_react_agent(get_llm(), build_tools(ctx), prompt=system)
result = agent.invoke({"messages": messages}, config={"recursion_limit": 14})
```

This one call *is* a LangGraph state machine — `create_react_agent` compiles a
graph that alternates "call the model" and "run any tool calls the model asked
for," looping until the model replies with no tool calls left to make. We do not
draw this graph's nodes ourselves; LangGraph's prebuilt gives us a
production-grade version of it. The `recursion_limit` is the safety cap: a
runaway loop raises `GraphRecursionError`, which we catch and turn into an honest
"I ran out of steps, try a smaller request" reply instead of a 500 or a hang.

The model itself, `get_llm()` in `rag/llm.py`, is `ChatAnthropic` — Claude Haiku
4.5 by default — wired in through **LangChain**, not LangGraph. This is the
recurring split in this build: LangChain supplies the individual parts (the model
wrapper, the embeddings wrapper, the reranker), LangGraph supplies the loop that
decides which parts run and in what order.

The agent is given six tools (`rag/tools.py`), each a LangChain `StructuredTool`
with a Pydantic schema, bound to this one request's resolved scope:

| Tool | What it does |
|------|---------------|
| `search_knowledge` | runs the retrieval subgraph (below) against the user's accessible project namespaces |
| `list_tasks` | reads tasks from Firestore, filterable by project/assignee/status/parent, scoped by `memberIds` |
| `create_task` | writes one task, inheriting the target project's `memberIds` |
| `create_tasks` | writes a whole tree of tasks + nested subtasks in one call |
| `update_task` | patches an existing task by fuzzy title match |
| `summarize_project` | tasks + top knowledge chunks for one project, combined |

The model decides, per user turn, whether any of these are needed. Small talk
gets a direct reply with zero tool calls — there is no separate "router" step,
because a tool-calling model naturally only reaches for a tool when the question
needs one. That is the whole reason this build's outer loop is a ReAct agent
rather than a hand-written router node.

### 5. When the agent needs knowledge — the retrieval subgraph

If (and only if) the model calls `search_knowledge`, that tool runs
`rag/retrieval.py::agentic_retrieve` — a **second, separate LangGraph graph**,
this one hand-authored node by node because retrieval quality is exactly where
hand control over the shape earns its keep:

```
START -> rewrite -> retrieve -> assess ──good, or 2 attempts reached──▶ END
              ▲                    │
              └───weak, attempts < 2───┘
```

Three nodes:

1. **rewrite** — Claude turns the raw question into a clean, standalone search
   query. On a retry, it is told the previous query was weak and asked to come
   at the topic from a different angle.
2. **retrieve** — embeds the query with **Voyage `voyage-3.5`** (via LangChain's
   `VoyageAIEmbeddings`), pulls the top 20 candidates from Pinecone across every
   namespace the user can see (merged and sorted by score — this is what makes
   cross-project search work), then reranks down to the best 4 with **Voyage
   `rerank-2.5`** (via LangChain's `VoyageAIRerank`, used as a cross-encoder
   compressor).
3. **assess** — Claude judges in one word whether those 4 chunks actually answer
   the question: `good` or `weak`. (Named `assess`, not `grade` — LangGraph does
   not allow a node name that collides with a state-graph key.)

A weak grade loops back to `rewrite` with a fresh angle, up to 2 attempts total,
then returns the best set seen regardless of the final grade — never an infinite
loop, never an empty-handed failure when *something* was found. This subgraph is
compiled once at import time and invoked fresh per search call; it holds no state
between calls. Full detail: [09-agentic-loop.md](09-agentic-loop.md) and
[08-retrieval-reranking.md](08-retrieval-reranking.md).

The graded chunks go back to the outer agent as the tool's result. The agent then
either calls another tool or writes the final answer, citing what it found.

### 6. Before the answer goes out — the groundedness check

Once the outer agent produces a final answer with no more tool calls, and *only
if* the turn gathered any source chunks along the way, `agent.py` makes one more
plain Claude call (`check_grounded`, not a graph node — just a function): does
every factual claim in the answer trace back to a retrieved source? A "no"
appends a caveat to the answer rather than blocking or rewriting it — this check
never fails a reply, it only flags it.

### 7. The response

FastAPI returns `{ answer, steps, sources, cards }` — the exact JSON shape the
frontend already expected from the original TypeScript `/api/chat`. `steps` is
the human-readable trace of what the agent did this turn (which tools ran, the
retrieval grade, the groundedness verdict); `sources` are the deduplicated
chunks cited; `cards` are the structured task/source cards the chat UI renders.
Nothing in the frontend had to change to consume this.

## The write path (ingestion) — the other half

Ingestion is simpler: no LangGraph, no loop, no decision-making. It is a straight
pipeline, `backend/app/rag/ingest.py`, triggered by `POST /api/ingest`:

```
file or pasted text
  -> parse    (rag/parse.py — pypdf / python-docx / raw utf-8, by extension)
  -> chunk    (rag/chunker.py — LangChain RecursiveCharacterTextSplitter, 1000/200)
  -> embed    (rag/embeddings.py — Voyage voyage-3.5, via LangChain, batched)
  -> upsert   (rag/vectorstore.py — direct Pinecone client, into the project's namespace)
```

`POST /api/related` (smart-linking) is the same retrieve-and-rerank step used
inside the agent's `search_knowledge` tool, just called directly for one project
with no grading and no retry — a single pass, because it backs a UI hint, not a
chat answer.

## What LangChain gave us vs. what LangGraph gave us — the short version

This is the question worth being able to answer cleanly in an interview.

**LangChain = the parts.** Standard wrappers so the code around them barely
changes if you swap providers: `ChatAnthropic` (the model), `VoyageAIEmbeddings`
and `VoyageAIRerank` (retrieval), `RecursiveCharacterTextSplitter` (chunking),
`StructuredTool` (the six agent tools' schemas). None of these decide *when* to
run — they are called by something else.

**LangGraph = the control flow.** Two separate graphs in this build, nested:

- The **outer** graph is `create_react_agent` — a prebuilt LangGraph state
  machine that loops "call the model, run its tool calls, call the model again"
  until there is a final answer. This is the agent's whole turn.
- The **inner** graph is the 3-node retrieval subgraph we hand-authored
  (`rewrite -> retrieve -> assess`, with a conditional retry edge) — reached only
  when the outer agent calls `search_knowledge`.

Neither graph knows about the other. The outer agent just sees `search_knowledge`
as one tool among six; what that tool does internally (a whole LangGraph loop of
its own) is invisible to it. That nesting — a prebuilt agent loop calling out to
a hand-built retrieval loop as one of its tools — is the actual shape of "agentic
RAG" in this codebase, and it is worth saying exactly that in an interview rather
than "we used LangGraph" as a vague label.

**LangSmith**, mentioned for completeness, is neither of the above — it is
tracing, off by default, that would show every node of both graphs as a
inspectable run if turned on. See [10-langchain-langsmith.md](10-langchain-langsmith.md).

## A concrete worked example

Say the user asks: *"What database does the PowerProx location system use?"*

1. Frontend sends `POST /api/chat` with the Firebase token and the message.
2. FastAPI verifies the token -> `uid`. Loads scope -> this user is a member of,
   say, 24 projects across 5 workspaces, one of them `PowerProx`
   (`ragNamespace: "slt-powerprox"`).
3. The ReAct agent gets the message plus the persona prompt (who it is, which
   projects exist). It has no reason to answer from memory — this is a factual
   question about a specific project's documents — so it calls `search_knowledge`
   with `query="What database does the PowerProx location system use?"`.
4. Inside that tool, the retrieval subgraph runs: rewrites the question into a
   tighter search query, embeds it with Voyage, searches the 24 accessible
   namespaces (weighted so `slt-powerprox` and any other relevant ones each
   contribute), reranks the top 20 down to 4 with Voyage's cross-encoder. Say
   the grade comes back `good` on the first attempt — one pass, no retry.
5. The tool returns the 4 chunks (as JSON text) to the agent, which reads them,
   finds the database mentioned in a spec document chunk, and writes an answer
   citing `PowerProx_Location_Dev_Spec.docx`.
6. Sources were used this turn, so `check_grounded` runs once: does the answer's
   claim about the database appear in those chunks? Yes -> no caveat added.
7. Response: `{answer: "...", steps: ["retrieved 4 chunk(s) in 1 attempt(s), graded good", "groundedness check: passed (4 source(s))"], sources: [...], cards: [{kind: "sources", ...}]}`.
8. The frontend renders the answer and a source card, unchanged from how the
   original TypeScript app rendered the same shape.

## Where each piece lives (file map)

```
backend/app/
  main.py                 FastAPI app, CORS, router mounts
  config.py               env-var settings (pydantic-settings)
  security/
    auth.py                get_current_user dependency — the auth gate
    firebase.py             Firebase Admin bootstrap, verify_id_token, Firestore client
  data/
    firestore.py            load_user_scope, load_project, task reads/writes — all memberIds-scoped
  rag/
    llm.py                  ChatAnthropic wrapper (LangChain)
    embeddings.py            VoyageAIEmbeddings wrapper (LangChain)
    rerank.py                VoyageAIRerank wrapper (LangChain)
    vectorstore.py           direct Pinecone client — namespace-per-project, cross-namespace merge
    retrieval.py             the inner LangGraph subgraph: rewrite -> retrieve -> assess -> retry
    tools.py                 the six agent tools (LangChain StructuredTool)
    persona.py               the agent's system prompt
    agent.py                 the outer LangGraph ReAct agent + groundedness check
    chunker.py               RecursiveCharacterTextSplitter (LangChain), 1000/200
    parse.py                 PDF/DOCX/text parsing for ingestion
    ingest.py                the write-path pipeline: parse -> chunk -> embed -> upsert
  routers/
    chat.py, ingest.py, related.py, health.py   the actual HTTP endpoints
frontend/src/app/api/
  chat/route.ts, ingest/route.ts, related/route.ts   thin proxies to the backend above
```

## If you read nothing else

FastAPI verifies the user, resolves what they can see from Firestore, and hands
that trusted scope to a LangGraph ReAct agent built on Claude. The agent decides
per turn whether it needs a tool. Its knowledge-search tool is itself a small,
hand-built LangGraph loop — rewrite, retrieve with Voyage embeddings, rerank with
Voyage's cross-encoder, grade, retry once if weak — scoped so it can only ever
touch Pinecone namespaces belonging to projects the user is actually a member of.
Everything nests: LangChain supplies the parts, LangGraph supplies the two loops
that decide when each part runs.
