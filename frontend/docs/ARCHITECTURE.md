# Architecture

## Layers

```
Browser (client components)
  AuthContext ─ Firebase Auth (Google), current user + ID token
  ThemeContext ─ dark/light
  WorkspaceContext ─ workspaces/projects/tasks via onSnapshot, selection state, first-run seed
  useTaskActions ─ task mutations bound to current project/workspace/user
        │  (reads/writes Firestore directly, gated by rules)
        ▼
  Cloud Firestore  ◄───────────────┐
        ▲                          │ firebase-admin (bypasses rules,
        │ authedFetch (ID token)   │ membership re-checked in code)
        ▼                          │
Next.js API routes (server, Node runtime)
  /api/chat    requireUser -> loadUserScope (all workspaces, memberIds-gated) -> runAgent (Claude tool loop) ──┘
  /api/ingest  requireUser -> loadProject -> parse -> chunk -> Voyage -> Pinecone
  /api/related requireUser -> loadProject -> Voyage query + rerank -> Pinecone query
  /api/assign  requireUser -> loadProject (+admin role) -> parse brief -> Claude -> task proposals
  /api/members requireUser -> lib/share/server.ts (invite/accept/role/scope/remove)
  /api/calendar/* Google OAuth + two-way sync
        │
        ▼
  Anthropic (Claude)   Voyage (embeddings)   Pinecone (vectors)   Google Calendar
```

The Firestore client is initialised with **forced long-polling** (`lib/firebase/client.ts`) and `reactStrictMode` is off, both to avoid a WebChannel watch-stream internal-assertion crash. Client-hit routes avoid ad-blockable words in their path (hence `/api/members`, not `/api/share`).

## Request flows

**Task edits** never touch an API route. The client writes to Firestore through `useTaskActions` / `lib/data/firestore.ts`; rules enforce access; `onSnapshot` pushes the change back to every view. This keeps the UI instant and offline-friendly.

**Agent chat**: the client posts `{ message, workspaceId, projectId, history }` (only the last 5 turns) with the Firebase ID token. `loadUserScope` loads **every workspace and project the user can access, across all workspaces** — each gated by `memberIds`, so per-project scope still holds and nothing they can't access loads. So "my tasks today" and knowledge search span everything, not just the current workspace; `workspaceId`/`projectId` are only the current view (default for new tasks + prompt naming). The Claude tool-use loop (bounded by `MAX_TOOL_ROUNDS`, output by `MAX_ANSWER_TOKENS`) runs; tool executors read/write tasks via admin and run agentic retrieval over Pinecone. The response carries `{ answer, steps, sources, cards }`, rendered by `components/agent/`. Conversations persist to `chats`/`chatMessages` (global across workspaces) and reload via the `ChatSidebar`.

**AI task assignment**: an admin posts a brief (file or text) to `/api/assign`; the route re-checks membership + owner/admin role, parses the brief, gathers the project roster (roles/skills from `project.team`) and each member's current open-task count, then asks Claude for a JSON task list assigned by best-fit and workload. It returns proposals only — the client previews them and writes the approved ones through the normal data layer. See `docs/COLLABORATION.md`.

**Ingestion**: multipart upload (or pasted text) -> parse (pdf-parse / mammoth / raw) -> recursive chunker -> Voyage document embeddings -> Pinecone upsert into the project's namespace.

**Sharing**: managers POST `/api/members`; `lib/share/server.ts` edits `workspace.members[]` (role + scope) via admin, then `recomputeMembership` re-derives `memberIds` on every project and task from the members' scopes and batch-writes them. Invitees claim pending invites by email on first sign-in, and the shared workspace then streams in through their `watchWorkspaces` listener. Client never touches `memberIds`.

**Pages**: `PageView` loads a page once, renders the BlockNote editor (`BlockEditor`, dynamic `ssr:false`), and autosaves the serialised blocks with a debounce. The whiteboard and day planner follow the same load-once + debounced-save pattern.

**Cross-project views (All my tasks)**: the project views (`TreeView`, `ListView`, `KanbanBoard`, `CalendarView`) each take an optional `tasks` prop, defaulting to the current project's tasks from context. `/my-tasks` filters `allTasks` (every task the user can see) down to the ones assigned to them and feeds that set to whichever view is selected. Creation affordances are hidden in this cross-project mode (there is no single target project); edits (status/priority/due/assignee) still work because those mutations are id-based, not project-bound. Same pattern powers the per-assignee Members board.

**Batch task creation**: the agent's `create_tasks` tool builds a whole nested task tree in one call (recursive create, exact parent ids), so the model does not run out of tool rounds emitting one `create_task` per node. The agent loop also detects a truncated response (`stop_reason: max_tokens`) and returns an actionable message instead of an empty reply. See `docs/RAG.md` §4.

## Route groups

- `(auth)` — unauthenticated (`/login`, which doubles as the marketing/landing surface).
- `(app)` — auth-guarded; layout redirects to `/login` when signed out and wraps `WorkspaceProvider` + `AppFrame` (collapsible sidebar + mobile drawer + content + seeding overlay). Screens: project view (`/`), `/today`, `/overview`, `/workspaces`, `/my-tasks`, `/pages` + `/pages/[id]`, `/agent`, `/knowledge`.

## Why Next.js (not plain Vite React)

The Anthropic, Voyage and Pinecone keys must never reach the browser, and Firebase Admin token verification must run server-side. Co-located API routes give us that boundary in one deploy, while the app is still a React SPA behind the routes. This also inherits the existing V1 RAG stack (Next.js 14).

## Extending toward the roadmap

The server boundary is where Phases 2–6 slot in: Google Calendar sync and the WhatsApp webhook are new API routes reusing `runAgent`; Stripe billing is another route + a `subscription` field on the workspace. See `docs/ROADMAP.md`.
