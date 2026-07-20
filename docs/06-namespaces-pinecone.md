# 06 — Namespaces and Pinecone

## What a namespace is

A Pinecone index is split into namespaces. A namespace is a partition inside the index. A query runs against exactly one namespace at a time (or, as shown below, several named namespaces merged client-side) and never sees vectors in a namespace it did not name. This one-namespace-per-query property is what this build's isolation rests on.

## The design: one namespace per project

```
namespace = project.ragNamespace     # e.g. "slt-powerprox", "hotel-odon-booking-com-airbnb-sites"

vector metadata = {
    "text": chunk,
    "source": filename,
    "project": project_name,
    "type": doc_type,
    "uploadedAt": iso_timestamp,
}
```

This is the same design the original TypeScript app uses, and it is why the Python backend reads the same index unchanged: every project's chunks already live in a namespace named after that project.

## Why project is the namespace, not workspace

A workspace can hold many projects, and access is often scoped per project — a member might see two of a workspace's five projects, not all five (see [access-control.md](02-access-control.md)). If the namespace were the workspace, a single Pinecone query could not exclude the three projects that member cannot see; you would need a metadata filter to do the real work, and a filter is something you could forget to apply. Making the project the namespace turns "which projects can this user search" into "which namespaces does the query even name" — the access list is enforced by which namespaces are queried, not by a filter layered on top.

## Cross-project search: query several namespaces, merge by score

A user's knowledge search often spans several projects at once — search runs across every project namespace they belong to, not one. Pinecone has no native multi-namespace query, so the backend queries each accessible namespace and merges the results by score:

```python
# backend/app/rag/vectorstore.py -> query_namespaces
def query_namespaces(namespaces, vector, top_k=6):
    per = max(2, ceil(top_k / len(namespaces)))
    merged = []
    for ns in namespaces:
        merged.extend(query_namespace(ns, vector, per))   # a missing/empty ns must not fail the search
    merged.sort(key=lambda c: c.score, reverse=True)
    return merged[:top_k]
```

The namespace list passed in is never wider than the user's resolved project scope (see [access-control.md](02-access-control.md)), so no amount of cross-project searching can reach a project the user is not a member of — there is no namespace string for it to query. Each returned chunk carries its `project` in metadata, so the model can attribute a fact to the right project when comparing two.

## Index configuration

- Dimension: 1024, matching `voyage-3.5` (see [embeddings.md](04-embeddings.md)).
- Metric: cosine.
- One index for the whole product (`second-brain` by default, `PINECONE_INDEX_NAME`). Every project gets its own namespace inside it, not a separate index — many small namespaces in one index is the efficient shape; a separate index per project would be wasteful and hard to manage.

## Upsert, update, delete

- Upsert. `backend/app/rag/ingest.py` writes each chunk with a fresh UUID as its vector id, batched 100 at a time (`upsert_chunks`).
- Namespace choice on upsert is the project being ingested into — resolved server-side from `load_project(uid, project_id)`, which itself enforces membership, so a user cannot ingest into a project they do not belong to.

```python
index.upsert(vectors=batch, namespace=project.rag_namespace)
```

## Serverless vs pod

Pinecone serverless bills by usage and scales to zero-ish, which suits a product with many small project namespaces, most holding a modest number of chunks. Start serverless. Move to pods only if you hit a scale or latency need you can measure.

## The mental model to keep

- Namespace = project = the wall. A query only ever reaches the namespaces it explicitly names.
- The namespace list handed to a query is never wider than the caller's resolved `memberIds` scope.
- Cross-project search means querying several namespaces and merging by score client-side, not one query with a filter.
