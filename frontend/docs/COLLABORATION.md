# Team, assignment and custom statuses

Four connected features that turn the app from a personal tool into a team one. All are per project.

## 1. Team roles (Team tab)

`components/project/TeamView.tsx`. Each project has a **Team** tab. It lists the workspace members who can access the project (from `workspace.members`, filtered by `project.memberIds`). An owner or admin sets, per person:

- **role** — a preset (`PROJECT_ROLES`: Full stack, Frontend, Backend, DevOps, Mobile, ML / AI, Data, QA, Design, PM) or free text
- **skills** — comma-separated tech stack
- **notes** — anything the AI should weigh (availability, focus)

Saved onto `project.team: ProjectMember[]` via `updateProject`. Non-admins see it read-only. The same person can be backend on one project and full stack on another, which is why this lives on the project, not the workspace.

## 2. AI task assignment (`/api/assign`)

`src/app/api/assign/route.ts`, admin/owner only. Flow:

1. Client uploads a brief (PDF/DOCX/MD/text) or pastes one, POSTed as `FormData` with the `projectId`.
2. Route re-checks workspace membership (`loadProject`/`loadWorkspace`) then requires an owner/admin role.
3. It parses the brief (`parseFile`, capped at `MAX_BRIEF_CHARS`), builds the roster (each accessible member's role/skills/notes from `project.team`) and counts each member's **current open tasks** in the project.
4. It asks `CLAUDE_MODEL` for a strict JSON array of tasks, each assigned to the best-fit member by role + skills, balancing workload — fewer open tasks wins ties. `normalise()` clamps every assignee to a real member and every priority to a valid one, so a stray value can never land on a stranger.
5. The route returns **proposals only** — nothing is written.

The client (`AssignModal` in `TeamView.tsx`) shows the proposed list. The admin edits assignee/priority/title, removes rows, then **Create** writes each through the normal `createTask` data layer (with `notes`, the chosen assignee and the project's `memberIds`). Preview-then-approve, so nothing hits the shared board unchecked. The brief is read once for tasks and **not** ingested into the knowledge base.

## 3. Members board (Kanban by assignee)

`components/views/MemberBoard.tsx`, the **Members** tab. One column per project member plus **Unassigned**, each with a live count. Built on the same `@dnd-kit` engine as the status board, but grouping is by `assigneeId`. Dragging a card to another column calls `setAssignees` to reassign it (or clears it in Unassigned). A task assigned to someone no longer on the project falls into Unassigned so nothing is hidden.

This is separate from the Team tab: **Team** configures roles, **Members** is the by-person work board.

## 4. Custom statuses (per project)

The four built-ins (To Do / In Progress / Blocked / Done) are fixed; a project adds its own on top.

- `types.ts`: `CustomStatus { id, label, color }` on `Project.customStatuses`. `TaskStatus` is `"todo" | "in_progress" | "blocked" | "done" | (string & {})` — the literals keep autocomplete, custom ids are any string. Only `"done"` ever counts as complete, so overdue/standup logic is untouched.
- `constants.ts`: `projectStatuses(project)` returns the built-ins plus the custom ones; `statusMeta(id, list)` resolves one, with a prettified grey fallback for an unknown id (e.g. a task from another project shown in a cross-project view). `slugStatus` makes collision-free ids; `STATUS_COLORS` is the palette.
- `WorkspaceContext.useProjectStatuses()` gives the current project's list to `StatusControl` with no prop drilling, so the status picker offers custom statuses everywhere within the project.
- **Board** (`KanbanBoard.tsx`): columns are `projectStatuses(currentProject)`. An **Add status** control creates one (name + colour); custom columns get a delete. `deleteCustomStatus` moves any task still in a removed status back to To Do so none is stranded. **List** view groups by the same dynamic set.

Colours render on the Board, List, status picker and rows. Cross-project screens (Today, Overview, Map) show a custom status as a neutral chip with its name, since they span projects.

## Rules note

None of these needed a Firestore rules change — `team` and `customStatuses` are fields on the existing `projects` doc, and assignment writes go through the member-gated `tasks` path. Only membership already gates them.
