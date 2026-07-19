# 03 — Data model (Firestore)

## Why Firestore and not Postgres

The earlier plan named Postgres by habit. A relational database makes membership joins clean, and it enforces foreign keys. Those are nice, not required. You already run Firestore, your team knows it, and it holds this data fine. Adding Postgres would mean a second database to deploy, back up, and reason about, for no real gain here. So we stay on Firestore.

Understand the trade-off so you are able to defend it. Firestore is a document store with no joins. You model relationships by denormalising, meaning you store a small copy of related data where you need to read it. For access control this is actually helpful, because the membership record already carries the role and the project list, so one read answers "who is this and what may they see". No join needed.

The vector data does not live in Firestore. It lives in Pinecone. Firestore holds identity, access, document metadata, and chat history. Keep that split clear.

## Collections

Below is a clean structure. Adapt names to what you already have rather than duplicating.

### workspaces

```
workspaces/{workspaceId}
  name: string
  createdAt: timestamp
  ownerId: string        // user id of the owner
```

### projects

```
projects/{projectId}
  workspaceId: string    // parent workspace
  name: string
  createdAt: timestamp
```

Storing `workspaceId` on the project lets you list a workspace's projects with one query and confirm a project belongs to the workspace before searching it.

### memberships

This is the heart of access control. One document per user per workspace.

```
memberships/{membershipId}      // id = `${userId}_${workspaceId}` for a direct lookup
  userId: string
  workspaceId: string
  role: string                  // owner | admin | member | viewer
  projectIds: array<string>     // projects this user may see in this workspace
  createdAt: timestamp
```

Using `${userId}_${workspaceId}` as the document id means Gate 1 is a single `get`, not a query. Fast and cheap.

If you already store role and project access in a different shape (for example a `members` subcollection under each workspace), keep it. The only requirement is: given a `userId` and a `workspaceId`, you are able to read the role and the allowed project ids in one cheap operation.

### documents

Metadata about each ingested file. The text and vectors live in Pinecone, not here.

```
documents/{docId}
  workspaceId: string
  projectId: string
  title: string
  source: string          // filename or url
  contentHash: string     // to detect changes and stay idempotent
  status: string          // queued | processing | ready | failed
  chunkCount: number
  createdAt: timestamp
  updatedAt: timestamp
```

The `status` field drives the UI. The `contentHash` field powers idempotent re-ingestion (see [ingestion.md](07-ingestion.md)).

### chatSessions and messages

```
chatSessions/{sessionId}
  userId: string
  workspaceId: string
  projectIds: array<string>
  createdAt: timestamp

chatSessions/{sessionId}/messages/{messageId}
  role: string            // user | assistant
  content: string
  citations: array        // [{docId, title, section}]
  createdAt: timestamp
```

LangChain has a Firestore chat history integration, so the loop reads and writes this collection through a standard interface rather than raw Firestore calls. See [langchain-langsmith.md](10-langchain-langsmith.md).

## The access-control read, in code

```python
from google.cloud import firestore

db = firestore.Client()

def resolve_scope(user_id: str, workspace_id: str):
    doc_id = f"{user_id}_{workspace_id}"
    snap = db.collection("memberships").document(doc_id).get()
    if not snap.exists:
        return None                      # user not in this workspace -> 403
    data = snap.to_dict()
    return {
        "role": data["role"],
        "allowed_project_ids": data.get("projectIds", []),
        "namespace": f"ws_{workspace_id}",
    }
```

That one function is Gate 1. Everything downstream uses its output and never re-reads the client.

## Indexing note

Firestore needs a composite index for queries that filter on more than one field, for example listing `documents` by `workspaceId` and `projectId` and `status`. Create those indexes up front. Firestore prompts you with the exact index to add the first time a query needs one.

## What not to store here

- No vectors. They go to Pinecone.
- No raw document text longer than you need for display. Pinecone chunks hold the text used for answers.
- No secrets or API keys.
