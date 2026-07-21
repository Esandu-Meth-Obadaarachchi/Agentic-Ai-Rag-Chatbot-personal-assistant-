# 17 — Frontend overview: Lune AI, features and stack

The backend docs (00–16) cover the FastAPI/LangGraph rebuild. This file is the
matching overview for the other half of the system: the Next.js frontend the
backend serves — what it actually does, feature by feature, and what it is built
with. One read, no other file needed to get the whole picture of the UI.

The frontend in this repo (`agentic-rag-aws/frontend/`) is a copy of the original
TypeScript app — same product, same UI, same features. The only change is that
its three AI routes now proxy to the Python backend instead of running the RAG
logic inline (see [16-end-to-end-flow.md](16-end-to-end-flow.md)). Everything
described below is real, running code, not a plan.

## What it is

Shipped as **Lune AI — Your Personal Workspace** (the product name; the codebase
is still called `second-brain`). It is an AI-native project and knowledge
manager — a Notion-meets-Linear feel: dense, dark, keyboard-friendly — built
around one idea: tasks and knowledge share the same backend, so the AI agent can
reason across both at once instead of treating them as separate tools.

Everything sits on one hierarchy: **Workspace → Project → Task → Subtask**
(recursive), with knowledge (uploaded documents) and pages (written docs) living
alongside tasks at the project or workspace level.

## Features

### 1. Execution — tasks, five ways to view them

Every project gets the same task data shown through nine tabs, so you pick
whichever view fits the moment:

| Tab | What it shows |
|-----|----------------|
| Tree | Nested task/subtask hierarchy, expand/collapse |
| Board | Kanban columns — the four built-in statuses plus **per-project custom statuses** you define |
| List | Flat sortable list, top-level tasks only (subtasks nest under their parent) |
| Calendar | Tasks placed by due date, drag to reschedule |
| Map | Auto-laid-out mind map of the task tree (React Flow) |
| Draw | A freeform whiteboard, one scene per project (Excalidraw), saved to Firestore |
| Docs | Project-level written pages (see Pages, below) |
| Members | Kanban grouped by assignee — drag a task to reassign it |
| Team | Per-project member roles/skills, and the AI task-assignment flow (below) |

List and Board only ever show top-level tasks, with subtasks nested underneath —
so the board never gets cluttered by every subtask appearing as its own card.
Drag-and-drop across Kanban and Calendar runs on `@dnd-kit`.

A task carries: title, notes, status, priority, assignee(s), due/start date, tags,
dependencies, linked docs, and manual ordering. Tree and List float the current
user's own assigned tasks to the top of each group (done still sinks to the
bottom); Board and Map keep pure manual order.

### 2. Knowledge — per-project RAG

Upload a document (or paste text) into a project's Knowledge tab. It gets parsed,
chunked, embedded and stored in Pinecone under that project's own namespace — the
write path documented in [07-ingestion.md](07-ingestion.md). This is what the
agent's `search_knowledge` tool searches when you ask it a question grounded in
your own documents.

### 3. Agent — the chat "brain"

A Claude tool-calling agent (branded "Lune") that reads and writes tasks and
searches knowledge, reachable from a persistent chat sidebar (`/agent`). It sees
everything the signed-in user can access, across every workspace they belong to,
not only the one currently open. Conversations persist to Firestore, so the chat
history sidebar shows every past conversation regardless of which workspace is
active. A daily **standup** feature summarises what changed since yesterday. Full
mechanics of the agent itself: [16-end-to-end-flow.md](16-end-to-end-flow.md).

### 4. Today — the daily driver

`/today` shows every task due on a focused day, across *all* workspaces at once,
plus a per-user day planner (a free-text notebook synced to Firestore). A day
picker (previous/next/back-to-today) drives the task list, the day's stats, an
export button and the notebook together as one unit. Overdue tasks only surface
when the focused day is today — so looking at a past day doesn't dump every
overdue task from history onto it.

### 5. Pages — written docs, Notion-style

Block-based documents (headings, lists, checkboxes, embeds — the usual Notion
building blocks) editable with **BlockNote**, nestable into a page tree, scoped
to a workspace or a specific project. A `/pages` index groups every page by
workspace and project.

### 6. Sharing and team

Invite teammates by email with one of four roles — owner, admin, member,
client-viewer — scoped either to the whole workspace or to specific projects.
Admins set each member's role and skills per project on the Team tab, and can
turn a written brief into a workload-aware, AI-proposed task list
(`POST /api/assign`, admin-gated — this one stays on Next.js, it was not part of
the Python RAG rebuild). Sharing writes always go through the server
(`lib/share/server.ts`), never directly from the client, and every membership
change recomputes `memberIds` across every affected project and task — the same
isolation mechanism the backend's access control relies on
(see [02-access-control.md](02-access-control.md)).

### 7. Calendar sync

Two-way Google Calendar sync per user: connect an account, push tasks with due
dates as events, and pull calendar changes back. OAuth handshake plus a webhook
for live reverse sync (`/api/calendar/*`).

### 8. Workspaces and overview dashboards

`/workspaces` is a portfolio board across every workspace the user belongs to.
`/overview` is a single workspace's dashboard — project cards, status, what needs
attention, and the Share dialog.

## Tech stack

| Layer | Choice | Version | Notes |
|---|---|---|---|
| Framework | Next.js (App Router) | 14.2.23 | `src/` dir, `@/*` path alias |
| Language | TypeScript | ^5.7 | strict app code, `tsc --noEmit` gate before commits |
| Styling | Tailwind CSS | ^3.4 | CSS-variable design tokens, dark default with a light fallback |
| Auth | Firebase Auth (Google sign-in) | firebase ^11.3 | client SDK; server verifies ID tokens with `firebase-admin` ^13.1 |
| Database | Cloud Firestore | — | real-time `onSnapshot` listeners, isolation via `memberIds` on every doc |
| Drag and drop | `@dnd-kit` | ^6 / ^9 / ^10 | Kanban board + Calendar |
| Mind map | `reactflow` | ^11.11 | Map view — auto-laid-out task tree |
| Whiteboard | `@excalidraw/excalidraw` | ^0.18 | Draw view, one scene per project |
| Block editor | `@blocknote/*` (core, react, mantine) | ^0.31 | Pages tab, React-18 compatible, loaded `ssr:false` |
| Icons | `lucide-react` | ^0.469 | |
| Animation | `framer-motion` | ^11.18 | |
| Markdown | `react-markdown` + `remark-gfm` | ^9 / ^4 | agent messages, page rendering |
| Validation | `zod` | ^3.24 | |
| Document parsing (legacy Next.js path) | `pdf-parse`, `mammoth` | ^1.1 / ^1.9 | still present for the original in-Next ingestion route; the Python backend now does this in `rag/parse.py` |

### The two AI-stack states, side by side

The `package.json` in this copy still lists the *original* AI dependencies
(`@anthropic-ai/sdk`, `@pinecone-database/pinecone`, `langsmith`) because the file
was copied as-is, and they are not all dead — `api/chat`, `api/ingest` and
`api/related` no longer use them (those three now just forward to the FastAPI
backend), but **`api/assign`** (turn a brief into an AI-proposed task list) still
runs entirely in Next.js and still calls Claude directly through
`lib/ai/anthropic.ts`, `lib/ai/server.ts` and `lib/ai/parse.ts`. That route was
not part of the RAG rebuild, so it was left exactly as it was.

Inside `lib/ai/`, the split is precise:

| File | Status | Used by |
|---|---|---|
| `anthropic.ts`, `server.ts`, `parse.ts` | **still live** | `api/assign/route.ts` |
| `agent.ts`, `persona.ts`, `tools.ts`, `retrieval.ts`, `voyage.ts`, `pinecone.ts`, `chunker.ts` | **dead code** — nothing imports them anymore | (was `api/chat`, `api/ingest`, `api/related`, before they became proxies) |

So the real AI stack for chat/ingest/related in this repo is the Python one in
`backend/` (Voyage, Pinecone's Python client, LangChain, LangGraph,
`anthropic`/`langchain-anthropic`) — see [16-end-to-end-flow.md](16-end-to-end-flow.md)
for what replaced them. `api/assign` is the one feature still genuinely running
on the original TypeScript AI stack.

| Concern | Original Next.js path (still in package.json, now dead code) | This repo's actual path |
|---|---|---|
| Generation + agent | `@anthropic-ai/sdk` | `anthropic` / `langchain-anthropic` (Python, FastAPI) |
| Embeddings + rerank | plain `fetch` to Voyage's REST API | `langchain-voyageai` (Python) |
| Vector store | `@pinecone-database/pinecone` (Node client) | `pinecone` (Python client) |
| Tracing | `langsmith` (JS) | `langsmith` (Python) |
| Orchestration | hand-written tool loop (`lib/ai/agent.ts`) | LangGraph (`create_react_agent` + a hand-authored retrieval subgraph) |

### Hosting (the original app; this copy is not deployed)

- Netlify (`@netlify/plugin-nextjs`), manual deploys, no CI/CD.
- `reactStrictMode` is off on purpose in `next.config.js` — StrictMode's dev
  double-mount rapidly re-subscribes Firestore listeners and trips a WebChannel
  watch-stream assertion crash. The Firestore client is also forced onto
  long-polling (`experimentalForceLongPolling`) for the same reason.

## Directory map

```
frontend/src/
  app/
    layout.tsx                 root: AuthProvider + ThemeProvider
    (auth)/login/page.tsx      Google sign-in + landing content
    (app)/layout.tsx           auth guard -> WorkspaceProvider -> AppFrame
    (app)/page.tsx             Project View — Tree/Board/List/Calendar/Map/Draw/Docs + task drawer
    (app)/today/page.tsx       Today — due-today across all workspaces + day planner
    (app)/overview/page.tsx    per-workspace dashboard
    (app)/workspaces/page.tsx  all-workspaces portfolio board
    (app)/pages/page.tsx       Pages index
    (app)/pages/[id]/page.tsx  single page -> BlockEditor
    (app)/agent/page.tsx       standup + chat surface
    (app)/knowledge/page.tsx   document/note ingestion
    (app)/my-tasks/page.tsx    tasks assigned to the current user
    api/chat|ingest|related    proxy to the FastAPI backend (this repo's change)
    api/assign                 AI task assignment (still Next.js — not part of the RAG rebuild)
    api/members                sharing: invite/accept/update/remove
    api/calendar/*             Google Calendar OAuth + two-way sync
  components/
    ui/        design-system primitives (Button, Avatar, Dropdown, Modal, chips...)
    shell/     Sidebar, WorkspaceSwitcher, AppFrame, ShareDialog
    task/      TaskRow, TaskCard, TaskDrawer, Pickers, TimeTracker
    views/     TreeView, KanbanBoard, ListView, CalendarView, DayDetail, MindMapView, WhiteboardView, MemberBoard
    pages/     PageView, BlockEditor, ProjectPages
    project/   ProjectHeader, PrintView, CalendarSync, TeamView
    agent/     StandupCard, AgentMessage, ChatSidebar, cards
  lib/
    firebase/  client.ts (browser), admin.ts (server, requireUser)
    auth/ theme/  AuthContext, ThemeContext
    data/      firestore.ts, WorkspaceContext, useTaskActions, tree.ts, standup.ts
    share/     server.ts — admin-side membership: invites, roles, per-project scope
    ai/        the original TypeScript AI code — now unused by the three proxy routes,
               kept in the tree but dead code in this repo (see the table above)
    google/    calendar.ts, store.ts, sync.ts
    ai/        anthropic.ts/server.ts/parse.ts still live (api/assign); the rest
               (agent.ts, tools.ts, retrieval.ts, voyage.ts, pinecone.ts, persona.ts,
               chunker.ts) is dead code — nothing imports it since chat/ingest/related
               became proxies (see the table above)
```

## If you read nothing else

Lune AI is a task manager and a per-project knowledge base with a Claude agent
sitting across both, so "what's overdue on PowerProx" and "what does the spec say
about X" get answered by the same chat. Nine ways to view tasks (tree, kanban,
list, calendar, mind map, whiteboard, docs, members, team), a daily driver
(`/today`) spanning every workspace, block-based pages, granular sharing down to
individual projects, and Google Calendar sync. Next.js 14 App Router, TypeScript,
Tailwind, Firebase/Firestore, with drag-and-drop, mind-mapping and whiteboard
libraries doing the specialised view work. In this repo, chat, knowledge ingest
and smart-linking are proxied to the Python/FastAPI/LangGraph backend covered in
[16-end-to-end-flow.md](16-end-to-end-flow.md) — the one AI feature still running
natively in Next.js is `/api/assign` (brief-to-tasks), untouched by the rebuild.
