# 04 — Embeddings

## What an embedding is

An embedding is a list of numbers, a vector, that represents the meaning of a piece of text. Text with similar meaning maps to vectors that sit close together in space. "How do I cancel a booking" and "steps to void a reservation" land near each other even though they share few words. This is why RAG search beats keyword search. It matches meaning, not spelling.

The model that produces these vectors is an embedding model. It is a bi-encoder, meaning it reads one text at a time and outputs one vector. It never sees the query and the document together. That independence is what makes it fast enough to run over your whole corpus. Contrast this with the cross-encoder in [retrieval-reranking.md](08-retrieval-reranking.md), which reads pairs together and is slower but sharper.

## Distance and similarity

Once text is a vector, "relevant" becomes "close". You measure closeness with cosine similarity, which compares the angle between two vectors. A score near 1 means very similar. Pinecone does this comparison for you at query time. You give it the query vector, it returns the nearest stored vectors.

The key point: search quality is capped by embedding quality. If the embedder maps two related sentences far apart, no reranker or model downstream will recover them, because they never got retrieved. Choose a decent embedder.

## The free model to use

You said use a free model. Good choices, all free and all run locally through HuggingFace:

| Model | Dimensions | Notes |
|-------|:----------:|-------|
| `BAAI/bge-small-en-v1.5` | 384 | Strong quality for its size. Recommended default. |
| `BAAI/bge-base-en-v1.5` | 768 | Better quality, heavier. Use if 8GB RAM allows. |
| `sentence-transformers/all-MiniLM-L6-v2` | 384 | Lighter, slightly weaker. Fine fallback. |
| `intfloat/e5-small-v2` | 384 | Similar tier to bge-small. |

Recommendation: `BAAI/bge-small-en-v1.5`. It is small enough for an M1 with 8GB RAM, fast, and good. Free, no API key, runs on your machine.

One detail with bge and e5 models: they expect a short instruction prefix. For bge, prefix stored passages as they are and prefix queries with a retrieval instruction. The sentence-transformers wrapper and LangChain handle this if you set it, but know it exists, because forgetting it costs you a few points of accuracy.

## Using it through LangChain

```python
from langchain_huggingface import HuggingFaceEmbeddings

embeddings = HuggingFaceEmbeddings(
    model_name="BAAI/bge-small-en-v1.5",
    model_kwargs={"device": "cpu"},          # or "mps" for Apple Silicon acceleration
    encode_kwargs={"normalize_embeddings": True},  # needed for cosine similarity
)
```

`normalize_embeddings=True` scales every vector to length 1. Cosine similarity assumes this, so do not skip it.

Load this object once at startup and reuse it. Creating it downloads the model the first time, then caches it locally.

## Dimensions must match everywhere

The dimension of your embedding model is fixed. `bge-small` outputs 384 numbers. Your Pinecone index must be created with dimension 384 and metric cosine. If you ever switch embedders to one with a different dimension, you must create a new index and re-embed everything. The old vectors are not compatible. Decide the embedder before you create the index.

```python
# Pinecone index config must match the embedder
# dimension = 384, metric = "cosine"  for bge-small-en-v1.5
```

## Query vector and passage vector

At ingestion you embed each chunk (a passage) and store the vector. At query time you embed the user's search query with the same model, then ask Pinecone for the nearest passage vectors. Same model on both sides. Mixing two embedders across the two sides gives nonsense, because their vector spaces do not line up.

## Why not a paid embedding API

Paid APIs like OpenAI or Voyage are a little stronger and save you from running a model. You do not need them. A local bge model is free, private (text never leaves your machine to be embedded), and good enough that the cross-encoder reranker downstream closes most of the quality gap. Keep the money for the generation calls.

## Cost and speed

Embedding is cheap. On an M1 you embed hundreds of chunks per second for a small model. The cost is CPU or GPU time, not dollars. This is why ingestion is not a budget concern. The budget concern is the Haiku calls at query time, covered in [cost-and-caching.md](11-cost-and-caching.md).
