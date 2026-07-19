# 11 — Cost and prompt caching

## The pricing

Claude Haiku 4.5, model id `claude-haiku-4-5`.

- Input: 1.00 USD per 1M tokens.
- Output: 5.00 USD per 1M tokens.
- Context window: 200K tokens.
- Max output: 64K tokens.

Haiku is the smallest and cheapest current Claude model, which is exactly why it fits this system. Every reasoning node runs on it.

## Where the tokens go

A single answered question makes up to five Haiku calls. Four are tiny. One is the real cost.

| Node | Input size | Output size | Cost weight |
|------|-----------|-------------|-------------|
| route | small (history + message) | one word | tiny |
| rewrite | small | one query | tiny |
| grade | medium (question + 5 chunks) | one word | small |
| generate | medium (question + 5 chunks) | a paragraph | the main cost |
| self-check | medium (answer + chunks) | one word | small |

Only generation produces meaningful output tokens, and output is the expensive side at 5x input. The routing, rewriting, grading, and checking calls are cheap because they read a little and write almost nothing. This is the whole reason the design is affordable: it spends model calls freely on tiny decisions and spends real tokens only once, on the answer.

## Rough cost per question

Say the retrieved context is 2,000 tokens, and the answer is 300 tokens. The generate call is about 2,300 input plus 300 output. Input cost is 2,300 x 1 / 1,000,000 = 0.0023 USD. Output cost is 300 x 5 / 1,000,000 = 0.0015 USD. The four small calls add a fraction of a cent. So a full answered question sits around half a cent, before caching. Small talk, which skips retrieval and generation, costs a rounding error.

## Prompt caching

Prompt caching lets you reuse the cost of tokens you send on every request. You mark a stable prefix of the prompt as cacheable. The first request writes it to the cache. Later requests read it at about a tenth of the input price instead of paying full price again.

### The rule that matters

Caching is a prefix match. The cached part must be byte-identical and must sit at the front of the prompt. Anything that changes per request must go after the cached part. Put stable content first, volatile content last.

- Stable (cache this): the system prompt, the task instructions, few-shot examples, the output format rules.
- Volatile (do not cache, put last): the user's question, the retrieved chunks, the chat history.

### The Haiku minimum

On Haiku, the cacheable prefix must be at least 4,096 tokens, or caching silently does nothing. So caching pays off when your fixed instructions and examples are large. If your system prompt is short, caching will not trigger, and that is fine. Do not force it.

### How to use it

`ChatAnthropic` supports cache control on message blocks. Mark the stable system block as ephemeral cache.

```python
from langchain_core.messages import SystemMessage, HumanMessage

messages = [
    SystemMessage(
        content=[{
            "type": "text",
            "text": LONG_STABLE_INSTRUCTIONS,   # >= 4096 tokens to trigger on Haiku
            "cache_control": {"type": "ephemeral"},
        }]
    ),
    HumanMessage(content=f"{retrieved_context}\n\nQuestion: {question}"),   # volatile, last
]
```

Confirm it works by reading the usage on the response. A non-zero `cache_read_input_tokens` on repeat requests means the cache is hitting. Zero across identical requests means something in the prefix is changing (a timestamp, a reordered list) and breaking the match.

## Other cost levers

- Skip retrieval on small talk. The router pays for itself on the first "hello".
- Keep the context tight. Reranking to 4 or 5 chunks, not 15, keeps the generate input small. Fewer input tokens, lower cost.
- Cap the retry loop at three. Each retry is another rewrite plus retrieve plus grade. Three is the ceiling for a reason.
- Set a sensible `max_tokens` on generation. You do not need 64K for a chat answer. A few hundred to a couple thousand is plenty, and it bounds the expensive output side.
- Run embeddings and the cross-encoder locally. They are free. Never pay an API for what a local model does well.

## The takeaway

The system is cheap by design, not by luck. It makes many tiny decisions on a cheap model, spends real tokens only on the final answer, caches the fixed instructions, and runs all the heavy relevance work on free local models. A busy day of conversations costs a few dollars, dominated by the generation calls.
