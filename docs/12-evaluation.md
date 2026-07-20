# 12 — Evaluation

Not implemented in this codebase. There is no eval set, no LangSmith dataset, and no automated scoring wired up — this file is the methodology to follow when you build one, not a description of something running today. Retrieval was checked by hand during development (see the commit history: live queries against the real `slt-powerprox` Pinecone namespace, confirming the retrieval graph returns correctly reranked chunks), which is exactly the kind of ad hoc check this file argues you should not rely on long-term.

You cannot improve what you cannot measure. A RAG chatbot has many moving parts, and a change to one part often quietly breaks another. Evaluation turns "it feels better" into a number you are able to track. This file shows what to measure and how.

## The two halves to measure

Split the system in two. Measure each on its own, because a bad answer has two possible causes and you need to know which.

1. Retrieval quality. Did the system fetch the right chunks? If the answer chunk was never retrieved, no model in the world will answer correctly. This is a retrieval problem.
2. Generation quality. Given good chunks, did the model write a correct, grounded answer? This is a model or prompt problem.

Measuring them separately tells you where to spend your effort.

## Build an evaluation set

Write 30 to 50 questions about your real documents. For each, record:

- the question,
- the ids of the chunks or documents that contain the answer (the "gold" sources),
- a short reference answer.

This set is your ground truth. Keep it in version control. Grow it over time, especially by adding every question the bot got wrong in the wild.

## Retrieval metrics

Run retrieval (search plus rerank) over the eval questions and compare the returned chunks to the gold sources.

- Hit rate (recall at k). For what fraction of questions did at least one gold chunk appear in the top k retrieved? This is the most important retrieval number. If it is low, fix chunking, embeddings, or `top_k` before touching the model.
- Mean reciprocal rank (MRR). How high up the list did the first gold chunk land? Rewards putting the right chunk near the top, which is what the cross-encoder is for. Compare MRR with and without reranking to prove the reranker earns its place.

If hit rate is high but MRR is low, the right chunks are being found but ranked poorly, so improve reranking. If hit rate itself is low, the right chunks are not being found, so improve chunking or embeddings.

## Generation metrics

Given the retrieved chunks, judge the answer. Three properties matter.

- Faithfulness (groundedness). Does every claim in the answer trace to a retrieved chunk? This is the anti-hallucination score. It should be near perfect, because the self-check node exists to enforce it.
- Answer relevance. Does the answer actually address the question, not wander?
- Correctness. Does the answer match the reference answer?

## LLM-as-judge

You cannot hand-grade every run. Use a model as the judge. You give the judge the question, the retrieved context, and the answer, and ask it to score faithfulness and relevance. LangSmith has this built in, and there are ready evaluators for RAG.

A note of honesty: the judge is itself a model and is not perfect. Use it for tracking trends across changes, not as absolute truth. Spot-check its scores by hand now and then.

## Running evals in LangSmith

1. Upload the eval set as a LangSmith dataset.
2. Run the graph over the dataset.
3. Attach evaluators (faithfulness, relevance, correctness, and a retrieval hit-rate check).
4. Read the scores per run and in aggregate.

```python
from langsmith import Client
from langsmith.evaluation import evaluate

client = Client()

def run_graph(inputs):
    return app.invoke(build_state(inputs["question"]))

evaluate(
    run_graph,
    data="agentic-rag-eval",              # your dataset name
    evaluators=[faithfulness, relevance, correctness],
    experiment_prefix="rerank-top5",
)
```

Because every run is named, you compare experiments directly: "`KEEP=4` vs `KEEP=6`" (see `retrieval.py`), "with the Voyage reranker vs without", "`MAX_ATTEMPTS=2` vs `MAX_ATTEMPTS=3`". Change one thing, run the eval, read the delta. This is how you tune with evidence instead of vibes.

## The workflow

1. Set a baseline. Run the eval on the current system, record the numbers.
2. Make one change. New embedder, new chunk size, a reranker, a reworded prompt.
3. Re-run the eval. Compare to the baseline.
4. Keep the change only if the numbers improved. Revert if not.

One change at a time. Two changes at once and you cannot tell which helped.

## What good numbers look like

- Retrieval hit rate: aim high, 0.9 or above on your eval set. Below that, retrieval is your bottleneck.
- Faithfulness: near 1.0. Any hallucination on grounded questions means the self-check or the answer prompt needs work.
- Relevance and correctness: high, but these depend on your domain and question difficulty. Track the trend more than the absolute.

## When to add complexity

Only add hybrid search, semantic chunking, or parent-child retrieval when the eval says the simpler version is your weak link. Complexity you add without measurement is complexity you cannot defend. Let the numbers pull features in, do not push them in on a hunch.
