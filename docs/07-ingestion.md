# 07 — Ingestion pipeline

Ingestion is the write path. It turns a raw document into searchable chunks in Pinecone.

## This build's ingestion runs synchronously, in the request

There is no background worker, no queue, no Redis, and no `documents` collection tracking a `queued` / `processing` / `ready` status. `POST /api/ingest` parses, chunks, embeds and upserts inline, then returns:

```python
# backend/app/routers/ingest.py, simplified
project = load_project(uid, project_id)          # membership check — 404/403 if not a member
text, doc_type = parse_file(filename, mime, data)  # or the pasted-text branch
stored = ingest_document(
    namespace=project.ragNamespace,
    project_name=project.name,
    filename=filename,
    text=text,
    doc_type=doc_type,
)
return {"chunksStored": stored, "filename": filename, "project": project.name}
```

This is a deliberate simplification versus a queued design, and it is worth being honest about the trade when discussing this project: for a single-file upload of the sizes this app handles (specs, notes, small PDFs), the whole pipeline finishes well inside an HTTP timeout, so a queue buys correctness for large batches at the cost of infrastructure this build does not need yet. If you were ingesting many large documents at once, or wanted a resumable/retryable job with visible progress, a background worker (arq or Celery, backed by Redis) is the right next step — the endpoint would enqueue and return immediately, a worker would run the same `ingest_document` call, and a `documents` collection would track status for the UI to poll. None of that exists in this codebase today.

## The steps that do run

```
1. verify Firebase ID token -> uid                                   [auth]
2. load_project(uid, project_id) -> enforces membership              [security gate]
3. parse the file (or take the pasted text) -> (text, doc_type)
4. chunk_text(text)                        -> RecursiveCharacterTextSplitter, 1000/200
5. embed_documents(chunks)                 -> Voyage voyage-3.5, batched
6. build one vector per chunk: {id: uuid4, values: embedding, metadata}
7. upsert_chunks(namespace, vectors)       -> Pinecone, batched 100 at a time
8. return {chunksStored, filename, project}
```

### Extraction (`backend/app/rag/parse.py`)

- PDF: `pypdf`, joining `extract_text()` per page.
- DOCX: `python-docx`, joining paragraph text.
- Everything else (md, txt, csv, json, code extensions): decoded as UTF-8, classified as `markdown` / `code` / `text` by extension.

No OCR, no table extraction, no header/footer stripping — a plain-text extraction matching what the original TypeScript app does (`pdf-parse` and `mammoth` there; `pypdf` and `python-docx` here, same shape).

### Chunk and embed

Uses the splitter and embedder from [chunking.md](05-chunking.md) and [embeddings.md](04-embeddings.md). Each chunk becomes one Pinecone vector; there is no separate content-hash or idempotency check (see the note in `chunking.md`), so re-uploading the same file adds duplicate vectors rather than replacing them.

### Upsert

```python
# backend/app/rag/vectorstore.py
def upsert_chunks(namespace, vectors):
    for i in range(0, len(vectors), 100):
        index.upsert(vectors=vectors[i:i+100], namespace=namespace)
```

Batched at 100 vectors per call, into the target project's own namespace — never a client-supplied namespace, since `load_project` resolves it server-side from the authenticated user's membership.

## Error handling

`ingest.py` raises FastAPI `HTTPException`s directly: 404 if the project does not exist, 403 if the caller is not a member, 400 if no readable text was found or nothing was left to chunk. There is no retry-with-backoff and no partial-failure recovery — a failed ingest is simply an error response to the caller, who can retry the upload from the UI.

## Deletion

Not implemented. There is no endpoint to delete a document's vectors by source or to remove a project's knowledge base. If you need this, delete by the `source` metadata field with a Pinecone metadata filter, matching the pattern `upsert_chunks` already establishes.

## What ingestion does not do

Ingestion never touches the query path — it does not call Claude, does not embed a query, and does not run the reranker. It only writes vectors. Keep that boundary; mixing query logic into ingestion is a common source of confusion.
