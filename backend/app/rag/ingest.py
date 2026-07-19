"""Ingestion pipeline: parse -> chunk -> Voyage-embed -> Pinecone upsert.

The write path of the RAG system. Offline and asynchronous relative to a query —
a user is not waiting on retrieval while this runs. Each chunk becomes a vector in
the project's namespace, carrying the metadata retrieval reads back.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.rag.chunker import chunk_text
from app.rag.embeddings import embed_documents
from app.rag.vectorstore import upsert_chunks


def ingest_document(
    *, namespace: str, project_name: str, filename: str, text: str, doc_type: str
) -> int:
    """Chunk, embed and upsert a document. Returns the number of chunks stored."""
    chunks = chunk_text(text)
    if not chunks:
        return 0
    embeddings = embed_documents(chunks)
    uploaded_at = datetime.now(timezone.utc).isoformat()
    vectors = [
        {
            "id": str(uuid.uuid4()),
            "values": embeddings[i],
            "metadata": {
                "text": chunk,
                "source": filename,
                "project": project_name,
                "type": doc_type,
                "uploadedAt": uploaded_at,
            },
        }
        for i, chunk in enumerate(chunks)
    ]
    upsert_chunks(namespace, vectors)
    return len(chunks)
