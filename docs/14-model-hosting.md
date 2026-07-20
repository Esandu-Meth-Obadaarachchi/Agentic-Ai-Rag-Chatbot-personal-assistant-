# 14 — Model hosting: everything in this build is a hosted API

An earlier plan for this project (see the git history and [embeddings.md](04-embeddings.md)) considered running the embedder and cross-encoder as open-source weights in-process, free and offline. This build did not take that path. Every model it calls — generation, the embedder, and the reranker — is a hosted API reached over HTTPS with an API key. This file explains that choice and what it costs.

## The four network calls in the query path

| Step | Model | Runs where | Network call | Cost |
|------|-------|-----------|:------------:|------|
| Rewrite / grade / groundedness | Claude Haiku 4.5 | Anthropic's servers | yes | per token |
| Embed the query | Voyage `voyage-3.5` | Voyage's servers | yes | per token |
| Search vectors | — | Pinecone | yes | Pinecone usage |
| Rerank | Voyage `rerank-2.5` | Voyage's servers | yes | per rerank |
| Generate the answer | Claude (agent) | Anthropic's servers | yes | per token |

Every one of these is a real HTTP request to a service this project does not run. There is nothing loaded into the container's memory, no weights on disk, no `~/.cache/huggingface/` to manage, and no GPU or CPU inference to size for.

## Why hosted, not local

The most direct reason: this build ports the existing TypeScript app's design, which already chose Voyage for embeddings and reranking, and Claude for generation. Reusing the same hosted models means the Python backend reads the Pinecone data the TypeScript app already wrote, with no re-embedding step and no migration. That alone was decisive.

Beyond that, hosted models suit this specific deployment target. The container is built for AWS ECS Fargate (see [deploy-aws-ecs.md](15-deploy-aws-ecs.md)) — a small, cheap task with no GPU. A local embedder and cross-encoder would need to be baked into the image (to avoid a cold-start download with no guaranteed outbound internet), would add hundreds of megabytes to the image, and would need CPU headroom sized for inference load. None of that is free engineering effort, and a hosted call trades a few hundred milliseconds and a small per-call fee for skipping all of it.

The trade is real and worth being honest about in an interview: hosted models mean per-call cost (small, but not zero — see [cost-and-caching.md](11-cost-and-caching.md)), a network dependency on three external services instead of one, and no offline mode. A from-scratch build optimising purely for lowest cost at high volume might choose differently. This build optimised for matching an existing app's data and for a light, GPU-free container.

## What "hosted" means for the code

There is no model object to load once at startup and keep warm — that concern (a real one for local models, covered by "Pattern A vs Pattern B" in an earlier draft of this doc) does not apply. What this build does instead:

```python
# backend/app/rag/embeddings.py — a thin, cached client wrapper, not a loaded model
@lru_cache
def get_embeddings() -> VoyageAIEmbeddings:
    return VoyageAIEmbeddings(model="voyage-3.5", api_key=settings.voyage_api_key, batch_size=96)
```

`lru_cache` here caches the *client object* (so it is constructed once per process), not any weights — there are none. Every `.embed_query()` or `.embed_documents()` call is a real HTTPS round trip to Voyage.

## Latency and reliability implications

Because every step is a network call, the query path's latency is the sum of several external services' response times plus network round trips, not local inference time. In practice this is still fast (each Voyage or Anthropic call is well under a second), but it means:

- A slow or down external service (Voyage, Pinecone, or Anthropic) degrades or breaks the request — there is no local fallback.
- Retries and timeouts on these calls matter more than they would for an in-process model. This build does not currently set custom retry policies beyond each SDK's default; that is a reasonable hardening step if reliability under external outages becomes a concern.
- Rate limits are a real constraint during development — running many test queries back-to-back against Voyage or Anthropic in a tight loop can trip a 429, something this build hit directly while verifying the retrieval graph end-to-end during development.

## If you wanted to add a local model later

Nothing here rules it out. `embeddings.py` and `rerank.py` are the only two files that would need a different implementation behind the same function signatures (`embed_query`, `embed_documents`, `rerank`); the rest of the retrieval graph does not care where a vector or a score came from. Swapping in a HuggingFace embedder would mean picking a model with the same 1024 output dimension as the current Pinecone index, or creating a new index and re-embedding everything — the two vector spaces are not compatible (see [embeddings.md](04-embeddings.md)).
