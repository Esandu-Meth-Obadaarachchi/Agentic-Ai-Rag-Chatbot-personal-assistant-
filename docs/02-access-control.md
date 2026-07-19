# 02 — Access control

This is the most important file in the folder. Get it wrong and one workspace reads another workspace's private documents. Get it right and the rest of the system is free to be simple.

## The rule

A person belongs to one or more workspaces. In each workspace they hold a role, and they have access to a set of projects. A query must only ever touch data from the requester's workspace, and only the projects they are allowed to see. Nothing the client sends is trusted. The server decides everything from stored records.

## The three things you store

1. Membership. Which workspaces a user belongs to, and the role in each.
2. Project access. Which projects inside a workspace a user is able to see.
3. Roles. What each role is allowed to do.

You already store roles and project access in Firestore. Reuse it. The exact shape is in [data-model-firestore.md](03-data-model-firestore.md).

## Roles

Keep it to four. Fewer roles, fewer mistakes.

| Role | Read documents | Ingest documents | Manage projects | Manage members |
|------|:--------------:|:----------------:|:---------------:|:--------------:|
| owner | yes | yes | yes | yes |
| admin | yes | yes | yes | yes |
| member | yes | yes | no | no |
| viewer | yes | no | no | no |

Owner and admin differ only in edge cases like billing or deleting the workspace. Start with them identical and split later if needed.

## The two gates

Access control is two checks, both on the server, both on every query. One is enough in theory. Two means a single bug does not leak data. This is defence in depth.

### Gate 1 — the authorisation gate

Runs in FastAPI before the loop.

1. Read the JWT. It gives you a trusted `user_id`. The token is signed, so the client cannot forge the id.
2. Read the requested `workspace_id` from the request.
3. Look up the membership record for that `user_id` and `workspace_id` in Firestore.
4. If no record exists, reject with 403. The user is not in that workspace.
5. Read the role and the allowed project list from the record.
6. Derive the Pinecone namespace from the confirmed `workspace_id`. Never from anything the client sent.

After this gate, you hold three trusted facts: the namespace, the role, and the allowed project ids. The loop uses these and never asks the client again.

### Gate 2 — the metadata filter gate

Runs inside every Pinecone query.

Every vector carries `workspace_id` and `project_id` in its metadata. On each query you attach a filter:

```python
pinecone_filter = {
    "workspace_id": {"$eq": workspace_id},
    "project_id":   {"$in": allowed_project_ids},
}
```

Even if a vector were somehow written into the wrong namespace, this filter blocks it from the result. Gate 1 picks the namespace. Gate 2 filters within it. Two independent locks on the same door.

## Why the namespace is the real wall

A Pinecone query runs against exactly one namespace. The server chooses the namespace from the authenticated workspace. So a user in workspace A physically cannot issue a query against workspace B's namespace. There is no parameter they are able to set to cross that line, because the parameter comes from their stored membership, not their request body. This is why workspace maps to namespace and project maps to metadata. Full reasoning in [namespaces-pinecone.md](06-namespaces-pinecone.md).

## Cross-project queries within a workspace

A user often wants to compare two projects they both have access to. That is allowed, because both projects live in the same workspace namespace. You pass both project ids in the `$in` filter. The user cannot widen this set. It comes from their stored project access, intersected with any project filter they asked for.

```python
# projects the user asked to search (optional, from the request)
requested = set(request.project_ids or allowed_project_ids)

# the real search set is the intersection with what they may see
search_projects = list(requested & set(allowed_project_ids))
if not search_projects:
    raise HTTPException(403, "No accessible projects in this request")
```

The intersection is the trick. A user cannot pull in a project they lack access to by naming it in the request, because it is dropped by the intersection.

## What to log

Log every query with `user_id`, `workspace_id`, the `project_ids` searched, and the `doc_id`s returned. If access is ever questioned, you have the trail. Store these logs where the user cannot edit them.

## The test you must write first

Before any loop code, write this test and keep it green forever.

```
Given a user in workspace A
When they send a query naming workspace B or a project in workspace B
Then the API returns 403 and Pinecone is never queried against B
```

If this test fails, nothing else matters. Fix it before moving on.

## Common mistakes to avoid

- Reading `workspace_id` or `role` from the request body and trusting it. Never do this. Read from the stored membership.
- Building the namespace string from a client value. Build it from the confirmed workspace only.
- Skipping Gate 2 because Gate 1 already picked the namespace. Keep both. They cover different failure modes.
- Putting the access check inside the LangGraph loop. Put it in front, so the loop only ever runs with a resolved, trusted scope.
