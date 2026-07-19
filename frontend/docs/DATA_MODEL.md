# Data model

Flat top-level Firestore collections (not deeply nested) so security rules and `array-contains` isolation queries stay simple. Every user-facing doc carries `memberIds` for isolation: `workspaces`, `projects`, `tasks`, `pages`, `whiteboards`, `dayPlans`, `chats`, `chatMessages`. `invites` is server-only. Two more (`calendarConnections`, `calendarOAuthStates`) are server-only and never in the rules.

## Collections

### `workspaces/{id}`
```
name: string
emoji: string
ownerId: string
memberIds: string[]         # uids with access (isolation key)
members: WorkspaceMember[]  # { uid, name, email, photoURL, role, scope }
createdAt: number
```
`WorkspaceMember.role` is `owner | admin | member | client-viewer`. `scope` is `string[] | null` — `null` means the whole workspace, an array means access is limited to those project ids. `members` is the source of truth for sharing; project/task `memberIds` are re-derived from it by `recomputeMembership` (`lib/share/server.ts`).

### `projects/{id}`
```
workspaceId: string
name: string
description: string
ragNamespace: string        # Pinecone namespace for this project's knowledge
color: string               # hex from PROJECT_COLORS
archived: boolean
isInbox: boolean            # the per-workspace catch-all for project-less tasks
createdAt: number
memberIds: string[]         # denormalised from the workspace for rules
tags: string[]              # the project's tag palette (optional)
team: ProjectMember[]       # per-project member roles/skills for AI assignment: { uid, name, role, skills[], notes }
customStatuses: CustomStatus[] # extra status columns on top of the built-ins: { id, label, color(hex) }
```
`team` and `customStatuses` are optional and admin-managed from the Team and Board tabs. See `docs/COLLABORATION.md`.

### `tasks/{id}`
```
workspaceId, projectId: string
parentId: string | null     # null = top-level; else recursive subtask
title, notes: string
status: string              # "todo" | "in_progress" | "blocked" | "done", or a project custom-status id. Only "done" counts as complete
priority: "low" | "med" | "high" | "urgent"
assigneeId, assigneeName, assigneeAvatar
dueDate, startDate: string | null   # yyyy-mm-dd
dueTime: string | null      # HH:MM (24h); null => all-day
tags: string[]
dependencies: string[]      # task ids
linkedDocs: LinkedDoc[]
recurrence: {freq, interval} | null # spawns the next occurrence on completion
timeEntries: TimeEntry[]    # time tracking (start/end/seconds)
googleEventId: string | null        # linked Google Calendar event (when synced)
order: number               # sibling ordering within a level / column
createdAt, updatedAt: number
createdBy: string
memberIds: string[]         # isolation
```

### `pages/{id}`  (Notion-style documents)
```
workspaceId: string
projectId: string | null    # null = workspace-level page; else a project doc
parentId: string | null     # null = top-level; else nested subpage (page tree)
title: string
icon: string                # emoji, optional
content: string             # serialised BlockNote blocks (JSON string)
order, createdAt, updatedAt: number
createdBy: string
memberIds: string[]         # workspace members, or the project's members when scoped
```

### `whiteboards/{projectId}`  (Excalidraw scene, one per project)
```
projectId: string
scene: string               # serialised Excalidraw elements + files (JSON)
updatedAt: number
memberIds: string[]         # mirrors the project
```

### `dayPlans/{uid}_{date}`  (per-user day planner notebook)
```
uid: string
date: string                # yyyy-mm-dd
content: string             # free text
updatedAt: number
memberIds: string[]         # always [uid]
```

### `chats/{id}`  (saved agent conversations, personal to one user, global across workspaces)
```
uid: string
workspaceId: string
title: string               # taken from the first message
createdAt, updatedAt: number
memberIds: string[]         # always [uid]
```

### `chatMessages/{id}`  (turns within a chat)
```
chatId: string
uid: string
role: "user" | "assistant"
content: string
steps: string[]             # tool-call trace (assistant turns)
sources: RetrievedChunk[]   # retrieved knowledge (assistant turns)
cardsJson: string           # serialised AgentCard[] (JSON; Firestore rejects nested arrays as native fields)
createdAt: number
memberIds: string[]         # always [uid]
```
Loaded/deleted by `memberIds array-contains uid` then narrowed to `chatId` in JS — a `chatId`-only query is rejected by the rules ("rules are not filters"), which is what once left opened chats blank.

### `invites/{id}`  (server-only, `allow read,write: if false`)
```
workspaceId, workspaceName, workspaceEmoji: string
email: string               # lowercased; the invitee's Google email
role: MemberRole
scope: string[] | null      # project ids, or null for whole-workspace
invitedByUid, invitedByName: string
status: "pending" | "accepted"
createdAt: number
```
Written/read only by `lib/share/server.ts` (admin). On the invitee's first sign-in, `WorkspaceContext` POSTs `/api/members {action:"accept"}`, which claims every pending invite matching their email and adds them to the workspace.

> Server-only collections (never in `firestore.rules`, so clients can't read
> them): `calendarConnections/{uid}` (Google refresh token + sync state) and
> `calendarOAuthStates/{state}` (short-lived OAuth handshake).

The task tree is stored flat and assembled client-side (`lib/data/tree.ts` -> `buildTree`). Subtasks nest arbitrarily deep via `parentId`. The page tree works the same way via `Page.parentId`.

Sibling ordering inside each group (Tree and List) is: done tasks sink to the bottom, then tasks the current user is an assignee of float to the top, then manual `order`. Pass the viewer's uid to `buildTree(tasks, myUid)` to get the assignee float; List applies the same rule on top of its priority-then-due sort. Kanban Board and Mind Map keep pure manual `order` — column position and graph layout there are user-placed, so assignment must not reshuffle them.

## Isolation

`firestore.rules` gates every operation on `request.auth.uid in resource.data.memberIds`. Businesses are fully separated — switching workspaces never leaks data. The server (agent) uses `firebase-admin`, which bypasses rules, so `src/lib/ai/server.ts` re-checks membership in code before any read/write.

## Queries + indexes

Every query is single-field equality or `array-contains` and sorted/filtered client-side, so **no composite indexes are needed** (`firestore.indexes.json` is empty by design). This includes the sharing queries on the server: `invites where workspaceId == x` (or `where email == y`) then filter `status`/`email` in memory — deliberately not multi-`where`, to avoid ever needing a composite index.

- `workspaces / projects / pages / chats where memberIds array-contains uid` (then filter by workspace client-side)
- `tasks where memberIds array-contains uid` (then filter by project/workspace)
- `chatMessages where memberIds array-contains uid` (then filter by `chatId`)
- `pages/{id}`, `whiteboards/{projectId}`, `dayPlans/{uid}_{date}` — direct doc reads

## Real-time

The client uses `onSnapshot` watchers (`lib/data/firestore.ts`) surfaced through `WorkspaceContext` (workspaces, projects, tasks, `allTasks`, pages, inbox). Every mutation reflects instantly across open tabs and views. The client forces **long-polling** transport (`lib/firebase/client.ts`) to avoid a WebChannel watch-stream assertion crash that the day planner and whiteboard listeners triggered.
