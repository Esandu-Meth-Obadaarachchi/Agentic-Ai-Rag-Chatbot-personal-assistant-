# 08 — Retrieval and cross-encoder reranking

This is where accuracy is won or lost. Two stages: fast retrieval to get candidates, then a cross-encoder to reorder them precisely. Understand why two stages exist.

## Bi-encoder vs cross-encoder

This distinction is the whole point of the file. Learn it well.

### Bi-encoder (the embedder)

A bi-encoder reads one text at a time and outputs a vector. The query and each document are encoded separately, ahead of time, and compared by vector distance. Because documents are encoded once at ingest and stored, a query only has to encode itself and do fast vector maths against millions of stored vectors. This is why it scales.

The weakness: the query and the document never meet inside the model. The model guesses relevance from two vectors made in isolation. It is fast but approximate.

### Cross-encoder (the reranker)

A cross-encoder reads the query and one document together, as a pair, and outputs a single relevance score. Because the model sees both texts at once, it captures fine interactions between them: negation, precise conditions, which entity the question is about. It is far more accurate at judging relevance.

The weakness: you cannot precompute anything. Every query-document pair is a fresh forward pass through the model. Running it over a whole corpus per query is far too slow.

### The resolution: two stages

Use each for what it is good at.

1. Retrieval (bi-encoder). Search Pinecone with the query vector. Pull the top 20 candidates fast. This is recall: cast a wide net so the right chunks are somewhere in the 20.
2. Reranking (cross-encoder). Score each of the 20 candidates against the query with the cross-encoder. Keep the top 4 or 5. This is precision: put the truly relevant chunks at the top.

Wide net, then sharp sort. The bi-encoder finds candidates cheaply. The cross-encoder orders them accurately. Together they beat either alone.

```
query
  -> bi-encoder search in Pinecone  -> 20 candidate chunks (recall)
  -> cross-encoder scores each pair -> reorder            (precision)
  -> keep top 4-5                   -> feed to Haiku
```

## The free cross-encoder to use

All free, all local through HuggingFace `sentence-transformers`.

| Model | Notes |
|-------|-------|
| `cross-encoder/ms-marco-MiniLM-L-6-v2` | Small, fast, strong. Recommended default. |
| `cross-encoder/ms-marco-MiniLM-L-12-v2` | A bit stronger, a bit slower. |
| `BAAI/bge-reranker-base` | Strong reranker, heavier. Use if RAM allows. |

Recommendation: `cross-encoder/ms-marco-MiniLM-L-6-v2`. Scoring 20 short pairs takes a fraction of a second on an M1, so it fits the query path without hurting latency.

## Using it

Directly with sentence-transformers:

```python
from sentence_transformers import CrossEncoder

reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")  # load once at startup

def rerank(query, candidates, top_n=5):
    pairs = [(query, c["text"]) for c in candidates]
    scores = reranker.predict(pairs)             # one score per pair
    ranked = sorted(zip(candidates, scores), key=lambda x: x[1], reverse=True)
    return [c for c, s in ranked[:top_n]]
```

Or through LangChain, which wraps the same model as a compressor on top of the Pinecone retriever:

```python
from langchain.retrievers import ContextualCompressionRetriever
from langchain_community.cross_encoders import HuggingFaceCrossEncoder
from langchain.retrievers.document_compressors import CrossEncoderReranker

cross_encoder = HuggingFaceCrossEncoder(model_name="cross-encoder/ms-marco-MiniLM-L-6-v2")
compressor = CrossEncoderReranker(model=cross_encoder, top_n=5)

retriever = ContextualCompressionRetriever(
    base_compressor=compressor,
    base_retriever=pinecone_retriever,   # returns the top 20 with the access filter applied
)
```

The base retriever must already carry the namespace and the metadata filter, so the access rules hold before reranking. Reranking never widens the result set, it only reorders and trims.

## Why not skip the bi-encoder and only use the cross-encoder

Because the cross-encoder cannot search. It scores pairs you already have. You still need the bi-encoder to fetch the candidate 20 from a corpus of thousands or millions. The cross-encoder only sharpens a short list. No first stage means nothing to rank.

## Why not skip the cross-encoder

You can, and plain vector search returns something. But the top vector-search result is often not the best answer, because the bi-encoder judged relevance from vectors made in isolation. The cross-encoder routinely promotes a better chunk from position 8 to position 1. For a small cost in latency you get a real jump in answer quality. This is the highest-value accuracy lever after chunking, which is why you asked for it.

## Tuning the numbers

- `top_k` at retrieval: 20 is a good start. Higher recall, more reranking cost. Raise if evaluation shows the right chunk is sometimes missing from the 20.
- `top_n` after rerank: 4 or 5. Enough context for the model, few enough to keep the prompt tight and cheap.

Measure these with the evaluation set in [evaluation.md](12-evaluation.md). Do not guess.

## Optional: hybrid search

Dense vector search sometimes misses exact keywords, codes, or names. A hybrid of dense plus sparse (keyword) retrieval catches both. Pinecone supports sparse-dense vectors. Add this only if evaluation shows you are missing exact-match queries. Start dense-only plus the cross-encoder.
