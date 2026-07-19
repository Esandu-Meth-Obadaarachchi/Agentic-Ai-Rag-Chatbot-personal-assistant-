# Roadmap + status

From `second-brain-app-spec.md` §5. This build delivers a solid runnable foundation (Phase 1 + auth + the Claude agent/RAG core). Later phases are scaffolded to slot into the server boundary.

**Live in production** at https://luneai.site (Netlify, manual deploys, no CI/CD yet) under the product name **Lune AI**. Firebase project `second-brain-fbf414`: Google auth enabled (localhost + the Netlify + `luneai.site` domains authorised), Firestore in `asia-south1`, Admin SDK + AI keys set. Remember `firebase deploy --only firestore:rules` after any rules change — Netlify does not deploy them. See `docs/DEPLOYMENT.md`.

| Phase | Scope | Status |
|---|---|---|
| 1 | Data model, React app, task CRUD, four views, doc export | **Done** (doc export pending) |
| — | Firebase Google auth + per-business workspaces | **Done** |
| — | Knowledge (Voyage + Pinecone) + agent action tools (Phase 3 pulled forward) | **Done** |
| — | Daily AI standup + smart linking | **Done** |
| 2 | Google Calendar two-way sync | **Done** — OAuth (offline), push task->event, watch-channel + webhook reverse sync, "Sync now". Needs a Google OAuth client + (for live reverse) a public webhook URL. See `docs/CALENDAR.md` |
| 4 | WhatsApp Cloud API bot | Not started — reuses `runAgent` behind a webhook route |
| 5 | Time tracking, recurring tasks, templates, roles | **Time tracking + recurring tasks done**; **sharing done** (invite by email, owner/admin/member/viewer roles, whole-workspace or per-project scope — `lib/share/server.ts` + `/api/members`); **per-project member roles/skills + AI task assignment done** (Team tab + `/api/assign`); templates not started |
| — | Members board (Kanban by assignee) | **Done** — one column per teammate + Unassigned, live counts, drag a card to reassign |
| — | Custom task statuses | **Done** — per-project status columns on top of the four built-ins, add/delete on the Board, tasks migrate to To Do on delete |
| — | Agent chat history | **Done** — conversations saved to Firestore (`chats`/`chatMessages`), sidebar to reopen/delete; last 5 turns sent to the model |
| — | Configurable + cheaper model | **Done** — `CLAUDE_MODEL` env (default Haiku 4.5), output/tool-round caps, per-project RAG scope enforced |
| — | Mind map view (Map) | **Done** — React Flow auto-laid-out task tree, click to open |
| — | Whiteboard per project (Draw) | **Done** — Excalidraw scene saved per project |
| — | Today + day planner | **Done** — `/today`: due-today across all workspaces + a per-user notebook synced to Firestore |
| — | Pages (Notion-style docs) | **Done** — BlockNote block editor, workspace + project level, nestable page tree, `/pages` |
| — | Landing page, mobile-responsive shell, motion polish | **Done** |
| — | Production hosting | **Done** — Netlify manual deploys; `docs/DEPLOYMENT.md` |
| — | Single-page doc export (Phase 1) | **Done** — printable project + task-tree, PDF via print |
| — | Time-of-day on tasks | **Done** — `dueTime`; timed calendar events |
| — | Inbox (tasks without a project) | **Done** — per-workspace Inbox + sidebar quick-capture |
| — | Workspace overview dashboard | **Done** — `/overview`: project cards, status summary, attention list |
| — | Calendar: day agenda + cross-project + read-only Google events | **Done** — click a date for its agenda; calendar shows all workspace tasks colour-coded by project |
| 6 | Stripe billing + client-viewer portal | Not started |

## What is intentionally stubbed / not built

- **Project templates**: not built.
- **WhatsApp / Stripe**: need external accounts + approvals; not wired.
- **RAG / agent** (search, chat, smart-linking, meeting-notes->tasks): built but needs `ANTHROPIC_API_KEY` + `VOYAGE_API_KEY` + `PINECONE_API_KEY`.
- **Calendar live reverse-sync** works only with a public `CALENDAR_WEBHOOK_URL` (tunnel/deploy); push + manual "Sync now" work on localhost. Publishing the OAuth app beyond test users triggers Google's weeks-long sensitive-scope review.

## Building the next phases

- **Calendar sync** — `/api/calendar/*` routes: OAuth 2.0, push task due-date changes to Google, receive watch-channel callbacks, reconcile. Store the Google refresh token per user (server-only).
- **WhatsApp** — `/api/whatsapp/webhook`: verify Meta signature -> resolve user -> `runAgent(message, [], ctx)` -> reply. The agent layer is already interface-agnostic.
- **Time tracking** — add `time_entries[]` to `Task`, a timer control, and a billable-hours export.
- **Templates + recurring** — a `TaskTemplate` collection that spawns a task tree; a scheduled job (or cron route) for recurring tasks.
- **Billing** — Stripe checkout route + `subscription` on the workspace; gate workspace/storage/agent limits.

Pre-launch long-lead items (start early): Google OAuth verification, WhatsApp Business approval, a privacy policy for processing customer documents through RAG + Google + WhatsApp.
