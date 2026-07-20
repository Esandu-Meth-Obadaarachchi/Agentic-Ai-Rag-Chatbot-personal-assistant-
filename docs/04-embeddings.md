# 04 — Embeddings

## What an embedding is

An embedding is a list of numbers, a vector, that represents the meaning of a piece of text. Text with similar meaning maps to vectors that sit close together in space. "How do I cancel a booking" and "steps to void a reservation" land near each other even though they share few words. This is why RAG search beats keyword search. It matches meaning, not spelling.

The model that produces these vectors is an embedding model. It is a bi-encoder, meaning it reads one text at a time and outputs one vector. It never sees the query and the document together. That independence is what makes it fast enough to run over your whole corpus. Contrast this with the cross-encoder in [retrieval-reranking.md](08-retrieval-reranking.md), which reads pairs together and is slower but sharper.

## Distance and similarity

Once text is a vector, "relevant" becomes "close". You measure closeness with cosine similarity, which compares the angle between two vectors. A score near 1 means very similar. Pinecone does this comparison for you at query time. You give it the query vector, it returns the nearest stored vectors.

The key point: search quality is capped by embedding quality. If the embedder maps two related sentences far apart, no reranker or model downstream will recover them, because they never got retrieved. Choose a decent embedder.

## The model this build uses: Voyage voyage-3.5

This build uses Voyage AI's `voyage-3.5`, a hosted embedding model, reached over an API with a key. It is the same choice the original TypeScript app made, and it is the reason the two share a Pinecone index: the vectors already stored were written by `voyage-3.5`, so the Python service must embed with the same model to read them.

| Property | Value |
|----------|-------|
| Model | `voyage-3.5` |
| Dimensions | 1024 (its default) |
| Access | hosted API, `VOYAGE_API_KEY` |
| Input type | `query` for searches, `document` for ingestion |

Voyage is Anthropic's recommended embedding partner. Claude has no embedding model of its own, so pairing Claude (generation) with Voyage (retrieval) is the standard combination.

One detail worth knowing: Voyage embeds queries and documents with a different `input_type`. LangChain's `VoyageAIEmbeddings` sets this for you — `embed_query` uses `query`, `embed_documents` uses `document`. Getting this right costs a few points of accuracy if you skip it.

## Using it through LangChain

```python
from langchain_voyageai import VoyageAIEmbeddings

embeddings = VoyageAIEmbeddings(
    model="voyage-3.5",        # 1024-dim by default
    api_key=settings.voyage_api_key,
    batch_size=96,             # documents per request at ingest time
)
```

See `backend/app/rag/embeddings.py`. Build this object once (it is cached with `lru_cache`) and reuse it. Each call is an HTTPS request to Voyage, so batch the document side at ingest time.

## Dimensions must match everywhere

The dimension is fixed. `voyage-3.5` outputs 1024 numbers. The Pinecone index must be created with dimension 1024 and metric cosine. If you ever switch embedders to one with a different dimension, you must create a new index and re-embed everything — the old vectors are not compatible. Decide the embedder before you create the index.

## Query vector and passage vector

At ingestion you embed each chunk (a passage) and store the vector. At query time you embed the user's search query with the same model, then ask Pinecone for the nearest passage vectors. Same model on both sides. Mixing two embedders across the two sides gives nonsense, because their vector spaces do not line up.

## Why a hosted model, not a local one

A local open-source embedder (bge, e5, MiniLM through HuggingFace) is free and private, and is a fine choice for a from-scratch build. This project chose the hosted Voyage model for two concrete reasons: it matches the existing TypeScript app exactly, so the Python service reads the data already in Pinecone with no re-embedding; and it keeps the container small and CPU-light, since no model weights load into the process — everything heavy runs on Voyage's side. The trade is a small per-call cost and a network hop, both minor next to the generation calls.

## Cost and speed

Voyage embedding calls are cheap relative to generation. Ingestion batches documents (up to 96 per request) so a normal upload finishes in a second or two. The budget concern is the Claude calls at query time, covered in [cost-and-caching.md](11-cost-and-caching.md), not embedding.
