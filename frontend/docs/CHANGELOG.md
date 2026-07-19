# Changelog

Notable changes, newest first. Product name: **Lune AI**.

## 2026-07-16 — Docs deep-dive

- Rewrote `docs/RAG.md` and `docs/AGENTIC_RAG.md` as full teaching guides: the ingestion pipeline (parse/chunk/embed/upsert), embeddings and the vector store, the bi-encoder vs cross-encoder two-stage retrieval, the agentic loop, the agent tool loop, the cost model, security/isolation, observability, design choices and every fix — the what, how and why. Refreshed `docs/ARCHITECTURE.md`.

## 2026-07-16 — All my tasks

### Added
- **"All my tasks"** — a new sidebar item (under All workspaces) and `/my-tasks` page showing every task assigned to you across every project and workspace, in the same **List / Board / Tree / Calendar** views used inside a project. The view components now take an optional `tasks` prop (defaulting to the current project) so they render any task set; creation affordances are hidden in the cross-project view. Still membership-gated — only tasks you can see appear.

## 2026-07-16 — Reliable task trees + assignees/subtasks

### Added
- **`create_tasks` batch tool.** The agent can build a whole task tree — tasks with nested subtasks — in a single call, with exact parent-child links. This fixes the agent creating top-level tasks but stopping before the subtasks (it used to run out of tool rounds making one `create_task` call per node), and makes deep nesting (identical subtask names under many parents) reliable. Tool-round cap raised 4 → 6 for headroom.

### Fixed
- **Silent "…" on an over-long request.** When a batch was too big, the model's tool call exceeded the output-token cap (`stop_reason: max_tokens`) and the agent returned an empty answer that rendered as "…". It now detects truncation and says so, telling the user to split into smaller batches, and keeps whatever was already created. Tool-execution errors are surfaced in the action trace and marked `is_error`, and an empty answer falls back to a clear message instead of blank.

### Fixed
- **The agent could not answer "who is X's tasks" or "subtasks of Y".** `list_tasks` was dropping the assignee and parent-task fields, and had no filter for either. It now returns each task's assignee and parent, and accepts an `assignee` filter and an `under` filter (a parent task's title → its subtasks). The persona prompt tells the agent to use them. The `task_list` card shows the assignee, parent (↳) and subtask count.

### Also
- The Agent page is mobile-responsive (chat-list drawer, collapsible standup, roomy composer).

## 2026-07-15 — Cross-workspace agent + global chat history

### Changed
- **The agent now spans every workspace.** `/api/chat` loads `loadUserScope` (all workspaces + projects the user can access, gated by `memberIds`) instead of a single workspace. So "what are my tasks today / assigned to me" returns tasks from every workspace, and knowledge search reaches every accessible project's docs. The current `workspaceId`/`projectId` are now only the default for new tasks and the prompt's naming. Per-project isolation is unchanged — a scoped member still only sees their projects.
- **Chat history is global.** `watchChats(uid)` no longer filters by workspace, and the Agent page no longer resets the conversation when you switch workspace. Any past chat opens from any workspace.
- `create_task` writes into the target project's own workspace and `memberIds` (the agent can create in any accessible project, not only the current workspace).

## 2026-07-15 — Team, statuses, cheaper agent

Shipped to `main` and deployed to https://luneai.site.

### Added
- **AI task assignment + Team tab.** Per-project member roles/skills (`project.team`) set on a new **Team** tab. Admins turn a brief (PDF/DOCX/text) into an assigned task list via `/api/assign` — the AI splits the work and assigns by role, skills and current workload, shown as a preview to approve before anything is written. See `docs/COLLABORATION.md`.
- **Members board.** New **Members** tab: a Kanban with one column per teammate + Unassigned, live counts, and drag-to-reassign.
- **Custom task statuses.** Per-project status columns on top of the four built-ins. Add/delete on the Board with a colour; deleting one moves its tasks back to To Do. Shown in the Board, List and status picker.
- **Agent chat history.** Conversations save to Firestore (`chats` + `chatMessages`), with a sidebar to reopen and delete them. Only the last 5 turns are sent to the model.
- **Configurable model.** Generation model is now the `CLAUDE_MODEL` env var (default `claude-haiku-4-5`); set it to Opus/Sonnet for higher quality.

### Changed
- **Cheaper agent.** Output capped at `MAX_ANSWER_TOKENS` 1024, tool rounds at `MAX_TOOL_ROUNDS` 4; retrieval trimmed to `KEEP` 4 chunks / 500-char passages / `MAX_ATTEMPTS` 2; chat input capped at `MAX_CHAT_INPUT_CHARS` 2000 (composer + server).
- **Composer grows** with the prompt up to a cap, then scrolls.
- **First-run seed** is now a single **Test it out** sandbox workspace with two demo projects (was Office / Freelance / LeadX).

### Fixed
- **RAG per-project scope.** `loadWorkspace` now filters the agent's projects by per-project membership, not just workspace membership — a scoped member can no longer read another project's knowledge or tasks through the chatbot.
- **Chat history loaded blank.** `loadChatMessages`/`deleteChat` queried `chatMessages` by `chatId` only, which the rules reject ("rules are not filters"). They now query by `memberIds array-contains uid` and narrow to the chat in JS.

### Ops
- Firestore `chats`/`chatMessages` rules must be live for chat history — `firebase deploy --only firestore:rules`.
