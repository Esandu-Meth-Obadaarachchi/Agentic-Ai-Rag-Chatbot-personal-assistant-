# 06 — Namespaces and Pinecone

## What a namespace is

A Pinecone index is split into namespaces. A namespace is a partition inside the index. A query runs against exactly one namespace at a time and never sees vectors in another namespace. This one-namespace-per-query rule is the property we build security on.

## The design

One namespace per workspace. Project lives in metadata.

```
namespace = f"ws_{workspace_id}"

vector metadata = {
    "workspace_id": workspace_id,
    "project_id": project_id,
    ...
}
```

So a workspace is a hard wall (the namespace) and a project is a soft filter (metadata) inside that wall.

## Why workspace is the namespace

Two reasons, both important.

First, security. A query targets one namespace, and the server picks that namespace from the authenticated workspace (Gate 1 in [access-control.md](02-access-control.md)). A user in workspace A has no way to name workspace B's namespace, because the namespace string is built from their stored membership, not their request. The wall is structural, not a filter you might forget to apply.

Second, cross-project comparison. You asked for users to compare projects. Projects in the same workspace live in the same namespace, so a single query reaches all of them, and a metadata filter narrows to the chosen projects. If project were the namespace instead, comparing two projects would need two separate queries and a manual merge, which is slower and clumsier.

## Why not project as the namespace

If you made `ws_{id}__proj_{id}` the namespace, you would get physical project isolation, but you would lose easy cross-project search, because each query hits one namespace. For your requirement (compare projects within a workspace) that is the wrong trade. Workspace-as-namespace with project-as-metadata gives hard isolation where it matters (between workspaces) and flexibility where you want it (between projects in a workspace).

Keep the composite-namespace option in your back pocket for a future case where a workspace has projects that must never be searched together, for example projects belonging to different end clients under one agency workspace. You are not there yet.

## Querying with the filter

Every query pairs the workspace namespace with a metadata filter for the allowed projects.

```python
results = index.query(
    namespace=f"ws_{workspace_id}",         # Gate 1: the wall
    vector=query_vector,
    top_k=20,
    include_metadata=True,
    filter={                                # Gate 2: the filter
        "workspace_id": {"$eq": workspace_id},
        "project_id": {"$in": search_project_ids},
    },
)
```

`search_project_ids` is the intersection of what the user asked for and what they are allowed to see, computed in [access-control.md](02-access-control.md). The user cannot widen it.

## Cross-project comparison in practice

To compare two projects, pass both ids in the filter and let the reranker and model sort out the pieces.

```python
# user wants to compare project X and project Y, and has access to both
search_project_ids = ["projX", "projY"]

# one query returns chunks from both projects, ranked by relevance
# the model then compares them in the answer, citing which project each fact came from
```

Because each chunk carries its `project_id` in metadata, the model is able to attribute every fact to the right project in its answer. That attribution is what makes a comparison trustworthy.

## Index configuration

- Dimension: match your embedder. `bge-small-en-v1.5` gives 384.
- Metric: cosine (with normalised embeddings, see [embeddings.md](04-embeddings.md)).
- One index for the whole product. Split workspaces by namespace inside it, not by separate indexes. Separate indexes per workspace would be wasteful and hard to manage.

## Upsert, update, delete

- Upsert. Write chunk vectors with an id like `{doc_id}::{chunk_index}` so ids are stable and predictable.
- Update. On a document change, delete the document's old chunks by filter, then upsert the new ones.
- Delete. On document delete, delete by metadata filter on `doc_id`.

```python
# delete all chunks for a document (used on update and on delete)
index.delete(
    namespace=f"ws_{workspace_id}",
    filter={"doc_id": {"$eq": doc_id}},
)
```

## Serverless vs pod

Pinecone serverless bills by usage and scales to zero-ish, which suits a product with many small workspaces. Start serverless. Move to pods only if you hit a scale or latency need you can measure.

## The mental model to keep

- Namespace = workspace = the wall you cannot climb.
- Metadata filter = project = the door you open only for allowed projects.
- One query, one namespace, many allowed projects. That is how compare-projects works while cross-workspace leakage stays impossible.
