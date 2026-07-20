# 02 — Access control

This is the most important file in the folder. Get it wrong and one person reads another person's private documents. Get it right and the rest of the system is free to be simple.

## The rule

A person belongs to one or more workspaces. Each workspace holds projects. A person has access to a set of projects, either the whole workspace or a specific subset. A query must only ever touch documents and tasks from projects the requester is a member of. Nothing the client sends is trusted. The server decides everything from stored records.

## How this build enforces it: `memberIds`

Every project, task, workspace and document carries a `memberIds` array — the list of user ids allowed to see it. This is the same isolation model the original app uses in its Firestore security rules. Two things follow from it:

1. To find what a user can access, you query Firestore for docs where `memberIds` array-contains their uid. That query can never return a doc they are not a member of.
2. Per-project scope is already baked in. When someone is added to a workspace but scoped to two projects, only those two projects (and their tasks) carry their uid in `memberIds`. A full-access member's uid is in every project in the workspace. So the same `array-contains` query respects per-project scope automatically.

There is no `workspace_id` or `role` read from the request body and trusted. The uid is the only identity, and it comes from a verified token.

## Identity: the Firebase ID token

The frontend signs the user in with Firebase (Google). Every request to the backend carries the user's Firebase ID token as `Authorization: Bearer <token>`. The backend verifies it with the Firebase Admin SDK:

```python
# backend/app/security/auth.py -> firebase.verify_id_token
decoded = verify_id_token(bearer_token)   # raises on an invalid/expired token
uid = decoded["uid"]                       # the only trusted identity
```

A Firebase ID token is a JWT signed by Google. `verify_id_token` checks the signature, expiry and audience, so the client cannot forge the uid. Verification failure is a 401. This is the single authentication gate, in `get_current_user`, applied to every `/api/*` route.

## Resolving scope

Once the uid is trusted, the backend loads everything the user can act on, across all their workspaces:

```python
# backend/app/data/firestore.py
workspaces = query("workspaces", where memberIds array_contains uid)
projects   = query("projects",   where memberIds array_contains uid)
```

The agent's scope is the set of projects returned here. `workspaceId` and `projectId` in the request body are only the current view — used to default new tasks and to name the current workspace in the prompt. They never widen scope. A scoped member who names a project they cannot see simply does not have it in their project set, so it is never searched.

## Where the wall sits: the project namespace

Each project owns one Pinecone namespace (`project.ragNamespace`, for example `slt-powerprox`). A Pinecone query runs against exactly one namespace and never sees vectors in another. Knowledge search only ever queries the namespaces of projects in the user's resolved scope:

```python
# backend/app/rag/tools.py -> search_knowledge
namespaces = [p.rag_namespace for p in ctx.projects]   # only projects the user is a member of
```

A user physically cannot search a namespace whose project they are not a member of, because the namespace list is built from their Firestore membership, not their request. That is the structural wall. Details in [namespaces-pinecone.md](06-namespaces-pinecone.md).

## Tasks use the same gate

The agent's task tools read Firestore with the identical isolation query:

```python
# fetch_accessible_tasks
tasks = query("tasks", where memberIds array_contains uid)
```

So "what are my tasks" spans every workspace the user belongs to, and never returns a task from a project they cannot see. New tasks the agent creates inherit the target project's `memberIds`, so they land inside the same wall.

## Defence in depth

The isolation holds in two independent places, so a single bug does not leak data:

- In this backend, the accessible-project set (and therefore the searchable namespaces and readable tasks) is derived server-side from `memberIds`, never from the request.
- In Firestore itself, the security rules gate every read and write on `request.auth.uid in memberIds`. Even a direct client read cannot cross the line.

## Cross-project queries

A user often wants to compare two projects they both belong to. That works: knowledge search queries each accessible project's namespace and merges the hits by score (see `query_namespaces` in `vectorstore.py`). Because every chunk carries its project name in metadata, the model attributes each fact to the right project in its answer. A user cannot pull in a project they lack access to, because its namespace is never in the list.

## The test to keep green

```
Given a user who is a member of project A only
When the agent searches knowledge or lists tasks
Then only project A's namespace is queried and only project A's tasks return
And no request field can add project B
```

## Common mistakes to avoid

- Reading `workspaceId` or a role from the request body and trusting it. Never do this. Trust only the verified uid and the `memberIds` records.
- Building the namespace list from a client value. Build it from the user's resolved projects only.
- Putting the access resolution inside the agent loop. Resolve scope in the route, before the agent runs, so the agent only ever sees a trusted project set.
