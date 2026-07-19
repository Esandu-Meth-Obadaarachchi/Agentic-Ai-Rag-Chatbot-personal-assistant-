# 07 — Ingestion pipeline

Ingestion is the write path. It turns a raw document into searchable chunks in Pinecone. It runs offline, so a user never waits on it. Correctness matters more than speed here.

## When ingestion runs

Three triggers, all landing on the same endpoint.

1. A user uploads a document through the app.
2. A user edits or replaces a document.
3. An external event (an N8n webhook, a file dropped in storage) calls the endpoint.

The endpoint accepts the request, writes a `documents` record with status `queued`, hands the job to a background worker, and returns immediately. The user sees "processing" in the UI.

## Why a background worker

Ingestion involves extraction, chunking, and embedding many pieces. Doing it inside the HTTP request would block the request for seconds or minutes and time out. So the API enqueues a job and a worker processes it. Use arq (async, light) or Celery, both backed by Redis. The worker loads the embedder once at startup and reuses it.

## The steps

```
1. mark documents/{docId} status = "processing"
2. extract text from the file
3. clean and normalise the text
4. compute contentHash; if unchanged since last ingest, stop (idempotency)
5. split into chunks with 15% overlap and metadata
6. embed each chunk
7. delete any existing vectors for this docId (handles re-ingest)
8. upsert the new vectors into ws_{workspaceId}
9. mark documents/{docId} status = "ready", write chunkCount
   on any failure, mark status = "failed" with the error
```

### 2. Extraction

Match the extractor to the file type. `pypdf` or `pdfplumber` for PDF, `python-docx` for Word, plain read for text and markdown. LangChain document loaders wrap most of these behind one interface, which keeps the worker tidy.

### 3. Cleaning

Strip repeated headers and footers, page numbers, and navigation cruft. This text becomes the vector, so noise here weakens every future search. Collapse excess whitespace.

### 4. Idempotency

Idempotent means running the same ingest twice has the same effect as running it once. You get this with a content hash.

```python
import hashlib

content_hash = hashlib.sha256(clean_text.encode()).hexdigest()

existing = db.collection("documents").document(doc_id).get().to_dict()
if existing and existing.get("contentHash") == content_hash:
    return   # nothing changed, skip the work
```

Without this, a retried job or a duplicate webhook writes the same chunks twice, and search returns duplicates. The hash makes re-ingestion safe.

### 5 and 6. Chunk and embed

Use the splitter and embedder from [chunking.md](05-chunking.md) and [embeddings.md](04-embeddings.md). Attach the full metadata to every chunk.

### 7. Delete before upsert

On a re-ingest, the old chunks must go first, or you end up with a mix of old and new. Delete by `doc_id` filter, then upsert. Stable vector ids (`{doc_id}::{chunk_index}`) also mean an upsert overwrites the same ids cleanly.

### 8. Upsert

Write into the workspace namespace. Batch the upserts (Pinecone accepts many vectors per call) so you are not making one network call per chunk.

```python
vectors = [
    {
        "id": f"{doc_id}::{i}",
        "values": embedding,
        "metadata": {**chunk_metadata, "text": chunk_text},
    }
    for i, (chunk_text, embedding, chunk_metadata) in enumerate(prepared)
]
index.upsert(vectors=vectors, namespace=f"ws_{workspace_id}", batch_size=100)
```

Store the chunk text in metadata so retrieval returns the text directly, no second lookup.

## Status and error handling

The `documents.status` field is the contract with the UI: `queued`, `processing`, `ready`, `failed`. On failure, record the error message so a human is able to see what broke. Do not silently drop failed jobs. Retry transient failures (network) with backoff. Do not retry a bad file forever.

## Deletion

When a user deletes a document, delete its vectors by `doc_id` filter and delete or archive the `documents` record. Orphaned vectors would keep showing up in answers for a document the user thinks is gone, which is both confusing and a possible data-retention problem.

## What ingestion does not do

Ingestion does not touch the query path, does not call Haiku, and does not run the cross-encoder. It only prepares the ground. Keep it that way. Mixing query logic into ingestion is a common source of confusion.

## Throughput note

Embedding is the slow step, and it is CPU or GPU bound, not network bound. Batch the embedding calls (the model embeds a list at once) and the worker keeps up with normal upload volumes on a single M1. If you ever need more, run several worker processes off the same Redis queue.
