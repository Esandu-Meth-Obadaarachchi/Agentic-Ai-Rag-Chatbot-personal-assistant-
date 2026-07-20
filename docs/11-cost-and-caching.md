# 11 — Cost and prompt caching

## The pricing

Claude Haiku 4.5, model id `claude-haiku-4-5`.

- Input: 1.00 USD per 1M tokens.
- Output: 5.00 USD per 1M tokens.
- Context window: 200K tokens.
- Max output: 64K tokens.

Haiku is the smallest and cheapest current Claude model, which is exactly why it fits this system. `CLAUDE_MODEL` (the agent + generation) and `CLAUDE_FAST_MODEL` (rewrite/grade/groundedness) are independent settings that both default to Haiku 4.5 — swap `CLAUDE_MODEL` to `claude-opus-4-8` or `claude-sonnet-5` for higher-quality generation while the cheap helper calls stay on Haiku.

## Where the tokens go

A question that triggers a knowledge search makes several Haiku calls. Most are tiny. One is the real cost.

| Call | Where | Input size | Output size | Cost weight |
|------|-------|-----------|-------------|-------------|
| agent turn (no tool) | outer ReAct loop | small (last 5 turns + message) | a short reply | the main cost, but rare to be large |
| agent turn (decides to call a tool) | outer ReAct loop | small | a tool-call, not prose | tiny |
| rewrite | retrieval subgraph | small | one query | tiny |
| assess (grade) | retrieval subgraph | medium (question + 4 chunks) | one word | small |
| agent's final answer | outer ReAct loop, after tool results return | medium (question + tool results) | a paragraph | the main cost |
| groundedness self-check | after the agent loop finishes | medium (answer + sources) | one word | small |

Only the agent's prose replies produce meaningful output tokens, and output is the expensive side at 5x input on Haiku. The tool-selection, rewrite, grade, and groundedness calls are cheap because they read a little and write almost nothing (a tool call or one word). This is the whole reason the design is affordable: many tiny decisions on a cheap model, real tokens spent once, on the answer.

## Rough cost per question

Say the retrieved context is 2,000 tokens, and the answer is 300 tokens. The final-answer call is about 2,300 input plus 300 output. Input cost is 2,300 x 1 / 1,000,000 = 0.0023 USD. Output cost is 300 x 5 / 1,000,000 = 0.0015 USD. The small calls (rewrite, grade, self-check, tool selection) add a fraction of a cent each. So a full question that triggers a search sits around half a cent, before caching. Small talk, which the agent answers with no tool call at all, costs a rounding error.

## Prompt caching — not implemented in this build

Everything below is the general Anthropic prompt-caching mechanism and is worth knowing, but `backend/app/rag/llm.py` does not set `cache_control` on any message today — every call pays full input price. The persona system prompt (`persona.py`) is a reasonable candidate to cache, since it is rebuilt per request but changes only with the current workspace/project name and the date; whether it clears the 4,096-token Haiku minimum (see below) is worth checking before wiring it up.

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

- Skip retrieval on small talk. The tool-calling agent pays for this for free — it simply does not call `search_knowledge` when a question does not need it, no separate router call to pay for.
- Keep the context tight. Reranking to 4 chunks (`KEEP` in `retrieval.py`), not 15, keeps the agent's input small. Fewer input tokens, lower cost.
- Cap the retry loop at two (`MAX_ATTEMPTS` in `retrieval.py`). Each retry is another rewrite plus retrieve plus grade.
- `max_tokens` is capped at 1024 on generation (`MAX_ANSWER_TOKENS` in `llm.py`) — plenty for a chat answer, and it bounds the expensive output side.
- Voyage embeddings and reranking are hosted, not local, so they are a real (small) per-call cost in this build, not free — see [model-hosting.md](14-model-hosting.md) for the actual trade being made and why it was chosen anyway.

## The takeaway

The system is cheap by design. It makes many tiny decisions on a cheap model (Haiku), spends real tokens only on the final answer, and keeps the reranked context small. Prompt caching is not wired up yet (see above) — enabling it on the persona prompt is the next lever if a busy day's Anthropic bill needs trimming further.
