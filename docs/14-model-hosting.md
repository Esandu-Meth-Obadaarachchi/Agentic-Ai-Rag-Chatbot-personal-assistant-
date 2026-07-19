# 14 — Model hosting: where the local models live and run

This file answers one question that trips people up. The embedding model and the cross-encoder, where are they, do you call them over an API, and how do they work once deployed.

## The key idea

The embedding model and the cross-encoder are open-source model weights that run inside your own code, on your own machine. They are not a third-party API. You do not send a request to a server you do not own, and there is no per-call fee. Compare this with Claude Haiku, which is a real network API you call over the internet and pay for.

So of the four steps in the query path, two run locally and free, two go over the network.

| Step | Runs where | Network call | Cost |
|------|-----------|:------------:|------|
| Embed the query (bge) | your process | no | free |
| Search vectors | Pinecone | yes | Pinecone usage |
| Rerank (cross-encoder) | your process | no | free |
| Generate answer | Anthropic Haiku | yes | per token |

## What a model file actually is

A model is a set of weights, meaning the trained neural network saved to disk. These weights live on the HuggingFace Hub, a public registry. `sentence-transformers` and the LangChain wrappers pull them from there.

When you construct the object:

```python
from langchain_huggingface import HuggingFaceEmbeddings
embeddings = HuggingFaceEmbeddings(model_name="BAAI/bge-small-en-v1.5")
```

three things happen.

1. First run only. The library downloads the weight files from HuggingFace (bge-small is around 130MB) into a disk cache at `~/.cache/huggingface/`.
2. It loads those weights from disk into your process memory (RAM).
3. It runs inference in your process. `embeddings.embed_query(text)` is an ordinary function call. No HTTP, no API key, no network.

Later runs skip the download and load straight from the disk cache.

So the model is in three places at once, and each answers "where is it stored" for a different moment:

- On HuggingFace's servers. The original source, used once to download.
- On your disk. The cache, `~/.cache/huggingface/`, so you never download twice.
- In your process RAM. While the service runs, ready for instant inference.

The cross-encoder works identically. Different weights, same mechanism.

## Are you calling an API? No, by default

An in-process model call is a Python function running the network on your own CPU. There is no request over the wire and nothing to authenticate. This is the default and the recommended start.

The word "API" only enters if you choose to run the model as a separate service (Pattern B below). Even then, it is an API you host on your own network, not a third party.

## The two hosting patterns

### Pattern A — in-process (start here)

The model loads inside your FastAPI process and inside your ingestion worker process, once at startup, and stays in RAM. Every embed or rerank is a local function call.

```python
# load once at startup, reuse for every request
embeddings = HuggingFaceEmbeddings(model_name="BAAI/bge-small-en-v1.5")
reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
```

Pros: simplest, no extra service, lowest latency (no network hop).
Cons: every replica of your app loads its own copy, and the weights add to startup time and RAM.

For your scale this is the right choice. Do not add complexity you do not need.

Note: both the query API and the ingestion worker use the embedder, and the query API uses the cross-encoder. In Pattern A each process loads its own copy. Two or three copies of a small model is fine.

### Pattern B — a model server (later, only if needed)

Run the model as its own service and have your app call it over HTTP on your private network. HuggingFace Text Embeddings Inference (TEI) is the standard tool for embeddings and rerankers. A small FastAPI wrapper also works.

```
FastAPI app  ──HTTP──▶  TEI service (holds the model)  ──▶  vector
```

Move to this only when one of these is true:

- Several services need the same model and you want one shared copy.
- You want the model on a single GPU box while the rest of the app runs cheaper.
- You want to scale the model up and down on its own.

Until one of those is real, Pattern A wins.

## How it works after you deploy

### On your M1 during development

The model downloads once, caches to disk, loads into RAM, and runs on CPU or on Apple MPS (Metal acceleration). Small models take tens of milliseconds per call on the M1.

### In a Docker container in production

One rule matters here. Do not let the model download at runtime.

A fresh container has an empty cache. If the model downloads on the first request, that request stalls on a 130MB download, and it fails outright if the container has no outbound internet. Bake the weights into the image at build time so the running container is fully offline.

```dockerfile
# pre-download the models into the image during build
RUN python -c "from sentence_transformers import SentenceTransformer, CrossEncoder; \
    SentenceTransformer('BAAI/bge-small-en-v1.5'); \
    CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')"
```

Build for the Linux VM target with `--platform linux/amd64`, as your infra needs.

Inference runs on CPU inside the container, which suits these small models. No GPU is required.

### Memory budget

- bge-small: around 130MB of weights, a few hundred MB in RAM once loaded.
- cross-encoder MiniLM: similar.
- Both together stay under 1GB.

Your 8GB M1 and a normal small VM both cope. If you later move to bge-base or a larger reranker, recheck the budget, since bigger weights mean more RAM.

## The clean summary

- The embedding model and cross-encoder are open-source weights, downloaded once, cached on disk, loaded into RAM, and run inside your own process. Free, local, no third-party API.
- Claude Haiku and Pinecone are the only network calls in the query path.
- Start with the models in-process (Pattern A). Move to a self-hosted model server (Pattern B) only when scale demands it.
- In Docker, bake the weights into the image so the container never downloads at runtime.
