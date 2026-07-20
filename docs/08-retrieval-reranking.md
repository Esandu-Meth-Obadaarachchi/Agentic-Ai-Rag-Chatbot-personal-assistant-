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
2. Reranking (cross-encoder). Score each of the 20 candidates against the query with the cross-encoder. Keep the top 4. This is precision: put the truly relevant chunks at the top.

Wide net, then sharp sort. The bi-encoder finds candidates cheaply. The cross-encoder orders them accurately. Together they beat either alone.

```
query
  -> bi-encoder search in Pinecone  -> 20 candidate chunks (recall)
  -> cross-encoder scores each pair -> reorder            (precision)
  -> keep top 4                     -> feed to Claude
```

The constants live in `backend/app/rag/retrieval.py`: `CANDIDATES = 20`, `KEEP = 4`.

## The reranker this build uses: Voyage rerank-2.5

This build uses Voyage's `rerank-2.5`, a hosted cross-encoder reached over the same API as the embeddings. Same choice as the original TypeScript app. It reads the query and each candidate together and returns a relevance score per candidate.

| Property | Value |
|----------|-------|
| Model | `rerank-2.5` |
| Access | hosted API, `VOYAGE_API_KEY` |
| Input | the query plus the list of candidate texts |
| Output | a relevance score per candidate, best first |

## Using it

Through LangChain's `VoyageAIRerank`, which scores a list of documents against the query:

```python
from langchain_core.documents import Document
from langchain_voyageai import VoyageAIRerank

reranker = VoyageAIRerank(
    model="rerank-2.5",
    voyage_api_key=settings.voyage_api_key,   # NB: this field has no api_key alias
    top_k=4,
)

def rerank(query, texts):
    docs = [Document(page_content=t, metadata={"_i": i}) for i, t in enumerate(texts)]
    ranked = reranker.compress_documents(docs, query)
    return [(d.metadata["_i"], d.metadata["relevance_score"]) for d in ranked]
```

See `backend/app/rag/rerank.py`. One gotcha the build hit: `VoyageAIRerank` names its key field `voyage_api_key` with no `api_key` alias, unlike `VoyageAIEmbeddings`. Passing `api_key=` there is silently dropped and the client raises `AuthenticationError`.

The candidate list handed to the reranker must already be scoped — it comes from the project namespaces the user is allowed to search (see [access-control.md](02-access-control.md)). Reranking never widens the result set, it only reorders and trims.

## Why not skip the bi-encoder and only use the cross-encoder

Because the cross-encoder cannot search. It scores pairs you already have. You still need the bi-encoder to fetch the candidate 20 from a corpus of thousands. The cross-encoder only sharpens a short list. No first stage means nothing to rank.

## Why not skip the cross-encoder

You can, and plain vector search returns something. But the top vector-search result is often not the best answer, because the bi-encoder judged relevance from vectors made in isolation. The cross-encoder routinely promotes a better chunk from position 8 to position 1. For a small cost in latency you get a real jump in answer quality. This is the highest-value accuracy lever after chunking.

## Tuning the numbers

- `CANDIDATES` at retrieval: 20 is a good start. Higher recall, more reranking cost. Raise if evaluation shows the right chunk is sometimes missing from the 20.
- `KEEP` after rerank: 4. Enough context for the model, few enough to keep the prompt tight and cheap.

Measure these with the evaluation set in [evaluation.md](12-evaluation.md). Do not guess.

## Why a hosted reranker, not a local one

A local cross-encoder (a `ms-marco-MiniLM` or `bge-reranker` through HuggingFace) is free and a fine from-scratch choice. This build uses Voyage `rerank-2.5` to match the TypeScript app and to keep the container light — no model weights in the process. The trade is a network hop and a small fee per rerank, both minor next to generation.
