# 03 — Data model (Firestore)

## Why Firestore and not Postgres

Firestore is a document store with no joins. You model relationships by denormalising — storing a small copy of related data where you need to read it. For access control this is genuinely helpful: a project document already carries its own `memberIds`, so one query answers "which of these can this user see" with no join. This build reuses the exact collections and fields the original TypeScript app already has in production, so the two stacks read and write the same data.

The vector data does not live in Firestore. It lives in Pinecone. Firestore holds identity, membership, projects, tasks, and chat history (the last one written and read by the frontend, not this backend). Keep that split clear.

## Collections this build reads and writes

### workspaces

```
workspaces/{workspaceId}
  name: string
  emoji: string
  ownerId: string
  memberIds: array<string>       // every uid with any access — the isolation query key
  members: array<{uid, name, email, role, scope}>
  createdAt: timestamp
```

### projects

```
projects/{projectId}
  workspaceId: string             // parent workspace
  name: string
  ragNamespace: string            // the project's own Pinecone namespace, e.g. "slt-powerprox"
  memberIds: array<string>        // full-access workspace members + anyone scoped to this project
  createdAt: timestamp
```

`ragNamespace` is the load-bearing field for retrieval: `search_knowledge` builds its namespace list straight from the accessible projects' `ragNamespace` values (see [namespaces-pinecone.md](06-namespaces-pinecone.md)).

### tasks

```
tasks/{taskId}
  workspaceId: string
  projectId: string
  parentId: string | null         // subtask nesting
  title: string
  status: string                  // todo | in_progress | blocked | done (+ project-defined custom ones)
  priority: string                // low | med | high | urgent
  assignees: array<{id, name, avatar}>
  assigneeId, assigneeName: string  // legacy single-assignee fields, still read
  dueDate: string | null           // yyyy-mm-dd
  memberIds: array<string>         // inherited from the owning project at creation time
  order, createdAt, updatedAt, createdBy: ...
```

There is no separate `memberships` collection in this data model. Membership is denormalised directly onto `workspaces.memberIds`, `projects.memberIds` and `tasks.memberIds` — every doc a user can see already lists their uid, so isolation is one `array-contains` query, not a join through a membership table. Same reasoning as above, applied consistently through every collection. Role (owner/admin/member/viewer) and per-project scope live on `workspace.members[]`, computed once when someone is invited or their access changes; this backend does not recompute it, only reads the already-denormalised `memberIds`.

### Chat history — not this backend's concern

The frontend persists conversations to Firestore (`chats` + `chatMessages`, keyed to the user, global across workspaces). This backend does not read or write those collections — `/api/chat` is stateless per request, given only the last 5 turns the frontend sends in the request body. Keep that boundary in mind: if you go looking for where a past conversation is stored, it is in the frontend's data layer, not here.

## The access-control read, in code

```python
# backend/app/data/firestore.py
def load_user_scope(uid: str) -> tuple[list[dict], list[dict]]:
    workspaces = query("workspaces", where memberIds array_contains uid)
    projects   = query("projects",   where memberIds array_contains uid)
    return workspaces, projects
```

That one function (plus `fetch_accessible_tasks`, the same query against `tasks`) is the entire access-control read. Everything downstream — the agent's tool set, the namespaces it can search, the tasks it can list — is built from this result and never re-reads the client. Detail on why this is safe in [access-control.md](02-access-control.md).

## Indexing note

Firestore needs a composite index for any query filtering on more than one field. The `array-contains` queries here filter on a single field (`memberIds`), so they need no composite index. If you add a query that filters `memberIds` and, say, `status` together, Firestore will prompt you with the exact index to add the first time that query runs.

## What this backend does not store

- No vectors. They go to Pinecone.
- No `documents` collection tracking ingestion status or content hashes — ingestion is synchronous and either succeeds within the request or returns an error (see [ingestion.md](07-ingestion.md)).
- No secrets or API keys.
