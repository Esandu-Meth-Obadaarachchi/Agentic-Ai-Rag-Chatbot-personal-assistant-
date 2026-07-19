# Second Brain — Claude Code Working Guide

Read this first in any session. It is the map of the codebase and the rules for changing it.

## What this is

Shipped as **Lune AI — Your Personal Workspace** (product name; the codebase/package is still `second-brain`). An AI-native project + knowledge manager. Notion-meets-Linear feel: dense, dark, keyboard-friendly. Pillars on one backend:

1. **Execution** — Workspace -> Project -> Task -> Subtask (recursive). Nine per-project tabs: Tree, Board (Kanban), List, Calendar, Map (React Flow mind map), Draw (Excalidraw whiteboard), Docs (project pages), **Members** (Kanban grouped by assignee, drag to reassign) and **Team** (per-project member roles/skills + AI task assignment). List/Board only ever show top-level tasks with subtasks nested underneath. The Board supports **per-project custom statuses** on top of the four built-ins.
2. **Knowledge** — per-project RAG. Upload docs, they are chunked, embedded (Voyage) and stored in Pinecone.
3. **Agent** — a Claude tool-calling agent ("the brain") that reads and writes tasks and searches knowledge. Conversations are saved to Firestore (chat history sidebar). Plus a daily standup.
4. **Today** (`/today`) — every task due on the focused day across *all* workspaces, plus a per-user day planner (notebook) synced to Firestore. A day picker (prev/next + back-to-today) drives the task list, stats, export and the notebook together; overdue only shows when the focused day is today. Tasks assigned to the current user float to the top of each group.
5. **Pages** — Notion-style block documents (BlockNote) at workspace or project level, nestable into a page tree.
6. **Sharing + team** — invite teammates by email with owner/admin/member/viewer roles, scoped to the whole workspace or specific projects. Admins set each member's role/skills per project (Team tab) and can turn a brief or doc into an assigned task list with AI (`/api/assign`). See `docs/COLLABORATION.md`.

Full product intent is in `second-brain-app-spec.md` and `second-brain-design-brief.md` at the repo root (source material — not code).

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 14.2 (App Router) + TypeScript | `src/` dir, `@/*` path alias |
| Styling | Tailwind CSS 3.4, CSS-variable tokens | dark default, light fallback |
| Auth | Firebase Auth (Google) | client SDK; server verifies ID tokens |
| Database | Cloud Firestore | real-time `onSnapshot`, per-workspace isolation. **Client init forces long-polling** (`initializeFirestore` + `experimentalForceLongPolling` in `lib/firebase/client.ts`) to dodge a WebChannel watch-stream assertion crash |
| Agent + generation | Anthropic Claude, model via `CLAUDE_MODEL` env (default `claude-haiku-4-5`) | tool-use loop, server-only. Retrieval helper steps run on Haiku regardless |
| Embeddings | Voyage AI (`voyage-3.5`, 1024-dim) | Claude has no embedding model |
| Vector store | Pinecone | one index, namespace per project |
| Drag + drop | @dnd-kit | Kanban + Calendar |
| Mind map | reactflow (v11) | Map view — auto-laid-out task tree |
| Whiteboard | @excalidraw/excalidraw | Draw view — one scene per project, saved to Firestore |
| Pages editor | BlockNote (`@blocknote/*` v0.31, React-18 compatible) | Notion-style block editor; loaded via `ssr:false` dynamic import |
| Hosting | Netlify (`@netlify/plugin-nextjs`) | manual deploys, no CI/CD yet |

`reactStrictMode` is **off** in `next.config.js` on purpose — StrictMode's dev double-mount rapidly re-subscribes Firestore listeners and trips the same WebChannel assertion.

Model + RAG rationale: `docs/RAG.md` and `docs/AGENTIC_RAG.md`. Data model: `docs/DATA_MODEL.md`. Team roles, AI assignment, Members board + custom statuses: `docs/COLLABORATION.md`. Visual system: `docs/DESIGN_SYSTEM.md`. Architecture: `docs/ARCHITECTURE.md`. Setup: `docs/SETUP.md`. Google Calendar sync: `docs/CALENDAR.md`. Deployment: `docs/DEPLOYMENT.md`. Roadmap + phase status: `docs/ROADMAP.md`. Recent changes: `docs/CHANGELOG.md`.

## Live instance (provisioned + deployed)

- **Production:** https://luneai.site (Netlify site `esa-ai-personal-assistant`, team `eobadaarachchi`/"Shona"; the `*.netlify.app` subdomain still resolves). Deploy manually with `netlify deploy --build --prod`. Env vars live on the Netlify site (imported from `.env.local`, with the URL-based ones repointed to the prod domain). Set `CLAUDE_MODEL` there to change the generation model (default Haiku).
- **Firebase project:** `second-brain-fbf414` (owner `eobadaarachchi@gmail.com`), pinned in `.firebaserc`.
- **Auth:** Google sign-in enabled. Authorised domains include `localhost`, `esa-ai-personal-assistant.netlify.app` and `luneai.site`. On first login a signed-in user is seeded with a single **Test it out** sandbox workspace holding two demo projects.
- **Firestore:** `asia-south1`. **Rules must be redeployed after any change** (`firebase deploy --only firestore:rules`) — hosting on Netlify does not touch them. New collections (`dayPlans`, `whiteboards`, `pages`, `chats`, `chatMessages`) will 403 until the rules are live.
- **Admin SDK:** service-account key set in `.env.local` + Netlify — powers `requireUser`, agent writes and all sharing writes.
- **AI keys:** `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `PINECONE_API_KEY` are configured. If ever blank, everything except `/api/chat`, `/api/ingest`, `/api/related`, `/api/assign` still works.

Setup for a fresh instance from scratch: `docs/SETUP.md`. Hosting details: `docs/DEPLOYMENT.md`.

## Directory map

```
src/
  app/
    layout.tsx                 Root: AuthProvider + ThemeProvider, theme-flash guard
    (auth)/login/page.tsx      Google sign-in + interactive marketing/landing content
    (app)/layout.tsx           Auth guard -> WorkspaceProvider -> AppFrame
    (app)/page.tsx             Project View (Tree/Board/List/Calendar/Map/Draw/Docs + task drawer)
    (app)/today/page.tsx       Today: due-today across all workspaces + day planner notebook
    (app)/overview/page.tsx    Per-workspace dashboard (project cards, status, attention, Share)
    (app)/workspaces/page.tsx  All-workspaces portfolio board
    (app)/pages/page.tsx       Pages index (docs grouped by workspace + project)
    (app)/pages/[id]/page.tsx  Single page -> <PageView> block editor
    (app)/agent/page.tsx       Standup + chat surface (with saved chat-history sidebar)
    (app)/knowledge/page.tsx   Document / note ingestion
    api/chat|ingest|related    Agent, RAG ingest, smart-linking (POST)
    api/assign/route.ts        AI task assignment: brief -> workload-aware task proposals (admin only)
    api/members/route.ts       Sharing: list/invite/accept/update/remove (POST/GET).
                               NB named /api/members, NOT /api/share — ad-blockers block "share" URLs.
    api/calendar/*             Google Calendar OAuth + two-way sync
  components/
    ui/        Design-system primitives (Button, Avatar, Dropdown, Modal, chips, StatusControl...).
               Dropdown renders in a body portal (fixed, viewport-clamped, flips up).
    shell/     Sidebar (collapsible), WorkspaceSwitcher, AppFrame, ShareDialog
    task/      TaskRow, TaskCard, TaskDrawer, Pickers, TimeTracker
    views/     TreeView, KanbanBoard, ListView, CalendarView, DayDetail,
               MindMapView (React Flow), WhiteboardView (Excalidraw), MemberBoard (Kanban by assignee)
    pages/     PageView, BlockEditor (BlockNote, ssr:false), ProjectPages (Docs tab)
    project/   ProjectHeader (tabs + stats + export), PrintView, CalendarSync, TeamView (roles + AI assign)
    agent/     StandupCard, AgentMessage, ChatSidebar, cards
  lib/
    firebase/  client.ts (browser, long-polling), admin.ts (server, requireUser)
    auth/ theme/  AuthContext, ThemeContext
    data/      firestore.ts (tasks, projects, pages, dayPlans, whiteboards, chats, custom statuses, ensureInbox),
               WorkspaceContext (tasks, workspaceTasks, allTasks, pages, inboxProject, useProjectStatuses),
               useTaskActions, tree.ts, standup.ts
    share/     server.ts (admin-side membership: invites, roles, per-project scope, recompute)
    ai/        voyage, pinecone, anthropic, chunker, parse, persona, tools, agent, retrieval, server
    google/    calendar.ts, store.ts, sync.ts
    types.ts, constants.ts, date.ts, utils.ts, api.ts, export.ts
firestore.rules / firestore.indexes.json / firebase.json / netlify.toml
```

## Non-negotiable rules

1. **Secrets stay server-side.** `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `PINECONE_API_KEY` and the Firebase Admin key are only ever read inside `src/app/api/**` or `src/lib/ai/**` / `src/lib/firebase/admin.ts`. Never import those into a client component. Only `NEXT_PUBLIC_*` Firebase values reach the browser.
2. **All task/project/workspace mutations go through the data layer.** Client code calls `useTaskActions()` or the functions in `src/lib/data/firestore.ts` — never `updateDoc` inline in a component. The agent (server) writes through `firebase-admin` in `src/lib/ai/tools.ts`.
3. **Per-workspace isolation is enforced by `memberIds`.** Every `workspaces`/`projects`/`tasks`/`pages`/`whiteboards`/`dayPlans` doc carries `memberIds`. `firestore.rules` gates every read/write on `request.auth.uid in memberIds`. When you add a doc type, add `memberIds` and a rule. Docs that may not exist yet (a fresh page/whiteboard/dayPlan) use `allow read: if (resource == null && signedIn()) || isMember(resource.data)` so the empty state loads instead of 403-ing.
4. **Sharing/membership writes go through the server.** All membership changes (invite, accept, role, scope, remove) run in `lib/share/server.ts` via `firebase-admin` and call `recomputeMembership`, which re-derives every project/task `memberIds` from `workspace.members[].scope`. Never edit `memberIds` from the client. `invites` is server-only (`allow read,write: if false`).
5. **Colours come from tokens.** Use the Tailwind semantic tokens (`bg`, `surface`, `accent`, `text-muted`, `danger`...). Do not hardcode hex in components. New colours go in `globals.css` + `tailwind.config.ts`.
6. **Keep the task views consistent.** Tree/List/Board/Calendar/Map render the same `Task` data; a field added to one editing surface should be honoured everywhere. List/Board show only top-level tasks (subtasks nest under their parent). Ordering: Tree and List float the current user's assigned tasks to the top of each group (done still sinks to the bottom, manual `order` breaks ties); Board and Map stay in pure manual order. See `docs/DATA_MODEL.md`.
7. **Never name a client-hit route with an ad-blockable word.** `/api/share` was silently killed by ad-blockers (`ERR_BLOCKED_BY_CLIENT`); it is now `/api/members`. Avoid `share`, `track`, `ad`, `analytics`, `collect` in public route paths.
8. **Never push straight to `main` on a real deployment.** Feature branch + PR. (Local dev on `main` is fine.) The auto-approver enforces this.

## How the agent works (important)

`POST /api/chat` -> `requireUser` verifies the Firebase ID token -> `loadUserScope` fetches **every workspace and project the user can access, across all their workspaces** (each gated by `memberIds`, so per-project scope still holds — a scoped member never sees another project's tasks or knowledge) -> `runAgent` runs a Claude tool-use loop (`src/lib/ai/agent.ts`) with the tools in `src/lib/ai/tools.ts`:

- `search_knowledge` — Voyage-embed the query, agentic retrieve + rerank across every accessible project namespace (all workspaces)
- `list_tasks`, `create_task`, `update_task` — read/write Firestore via admin; `list_tasks` spans all the user's workspaces, so "my tasks today" is global. `create_task` writes into the target project's own workspace + `memberIds`
- `summarize_project` — tasks + top knowledge chunks

The request's `workspaceId`/`projectId` are only the current view — used to default new tasks and name the current workspace in the prompt, not to limit scope. Cost caps live in `agent.ts` (`MAX_ANSWER_TOKENS` 1024, `MAX_TOOL_ROUNDS` 4) and only the last 5 turns are sent to the model; the full conversation is persisted in Firestore (`chats` + `chatMessages`, personal to the user and **global across workspaces** — the sidebar shows every past chat regardless of which workspace is active). Tool executors accumulate `sources`, `cards` and `steps` on the `ToolContext`; these are returned to the UI and rendered by `components/agent/cards.tsx`. Thinking is left off for latency; the persona prompt (`src/lib/ai/persona.ts`) keeps reasoning out of the visible answer. Retrieval quality (rewrite -> rerank -> grade-and-retry -> grounded self-check) is in `src/lib/ai/retrieval.ts` — see `docs/AGENTIC_RAG.md`.

The generation model is `CLAUDE_MODEL` (default `claude-haiku-4-5`); the retrieval helper steps always run on Haiku. When you change the API/agent surface, read the `claude-api` skill for current model IDs and SDK shapes — do not guess.

## Working conventions

- Commit per subtask with a conventional-commit subject (`feat(scope): …`). Keep commits coherent and buildable.
- Run `npm run typecheck` before committing; `npm run build` before opening a PR.
- Match the surrounding style: comment density, naming, token usage. New components are `"use client"` only when they use hooks/state.
- Prefer editing an existing primitive over inventing a parallel one. Reuse `Dropdown`, `Modal`, `Button`, the pickers.

## Commands

```bash
npm run dev        # http://localhost:3000
npm run typecheck  # tsc --noEmit
npm run build      # production build (run before PRs)
npm run lint       # next lint
```

## Where to start for common tasks

| Task | Start in |
|---|---|
| A new task field | `lib/types.ts` -> `firestore.ts` + `useTaskActions` -> the task views + `TaskDrawer` |
| A new agent tool | `lib/ai/tools.ts` (schema + executor) -> it is auto-wired into the loop |
| A new project view/tab | `components/views/` (or `project/`) -> add a `ViewTab` in `project/ProjectHeader.tsx` + a branch in `app/(app)/page.tsx` |
| Task statuses / custom statuses | `constants.ts` (`projectStatuses`, `statusMeta`), `KanbanBoard`/`ListView`, `useProjectStatuses`. See `docs/COLLABORATION.md` |
| Team roles / AI assignment | `components/project/TeamView.tsx` + `api/assign/route.ts` (server, admin-gated) |
| Pages / block editor | `components/pages/` (PageView, BlockEditor, ProjectPages), `firestore.ts` page fns, `pages` rule |
| Sharing / roles | `lib/share/server.ts` + `api/members/route.ts` + `components/shell/ShareDialog.tsx` |
| Change the look | `src/app/globals.css` tokens + `tailwind.config.ts`, then `docs/DESIGN_SYSTEM.md` |
| A new doc type / collection | `lib/types.ts`, `firestore.ts`, add a rule in `firestore.rules`, then `firebase deploy --only firestore:rules` |
| Deploy | `netlify deploy --build --prod`; rules separately via Firebase CLI. See `docs/DEPLOYMENT.md` |

Also see `.claude/skills/` for the design-system, component-builder and firestore-patterns skills, and `.claude/agents/` for specialised subagents.
