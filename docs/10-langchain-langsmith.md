# 10 — LangChain, LangGraph, and LangSmith

Three tools with three jobs. People blur them together. Keep them apart.

## LangChain — the building blocks

LangChain is a library of standard interfaces for the parts of an LLM app: loaders, splitters, embedding wrappers, vector store wrappers, retrievers, and model wrappers. Its value is that each part has one interface, so you swap implementations without rewriting the rest. Switch the embedder or the vector store and the code around it barely changes.

What you use from LangChain here:

- Document loaders. Read PDF, Word, text into a common `Document` shape.
- Text splitters. `RecursiveCharacterTextSplitter` for chunking (see [chunking.md](05-chunking.md)).
- Embeddings wrapper. `HuggingFaceEmbeddings` around the bge model (see [embeddings.md](04-embeddings.md)).
- Vector store wrapper. `PineconeVectorStore` around your index, exposed as a retriever.
- Reranker. `CrossEncoderReranker` as a compression step (see [retrieval-reranking.md](08-retrieval-reranking.md)).
- Model wrapper. `ChatAnthropic` for Haiku.
- Chat history. `FirestoreChatMessageHistory` to read and write turns.

```python
from langchain_anthropic import ChatAnthropic

haiku = ChatAnthropic(
    model="claude-haiku-4-5",
    max_tokens=1024,
    temperature=0,          # deterministic routing/grading; raise a little for generation if wanted
)
```

Think of LangChain as the socket set. Standard sockets, many tools fit.

## LangGraph — the control flow

LangChain runs pipes. LangGraph runs state machines with branches and loops. The agentic loop needs to decide (small talk vs answer) and repeat (retry on weak retrieval), so LangGraph holds the loop. It sits on top of LangChain: the nodes call LangChain objects (the retriever, the reranker, `ChatAnthropic`), and LangGraph decides the order and the branching.

The full graph is in [agentic-loop.md](09-agentic-loop.md). The one-line summary: LangChain gives you the parts, LangGraph wires them into a loop with decisions.

## LangSmith — the observability

LangSmith records every step of every run: the inputs, the outputs, the tokens, the latency, and the exact prompt sent to Haiku at each node. It is the camera in the control room. Without it, a wrong answer is a mystery. With it, you open the run, see that the rewrite produced a bad query, and fix the rewrite prompt.

### Why you need it

An agentic loop has many steps. When an answer is wrong, the fault could be in routing, rewriting, retrieval, reranking, grading, or generation. LangSmith shows each step's input and output, so you find the guilty node in seconds instead of guessing. This is the difference between debugging by evidence and debugging by hope.

### Turning it on

It is mostly environment variables. LangChain and LangGraph send traces automatically once these are set.

```bash
export LANGCHAIN_TRACING_V2=true
export LANGCHAIN_API_KEY=your_langsmith_key
export LANGCHAIN_PROJECT=agentic-rag
```

With those set, every LangGraph run appears in the LangSmith project as a trace tree: one node per step, each expandable to show the prompt and the response.

### What to look at in a trace

- The rewritten query. Is it a clean, standalone question? Bad answers often start here.
- The retrieved chunks. Did the right chunk come back at all? If not, the problem is retrieval or chunking, not the model.
- The rerank order. Did the cross-encoder put the best chunk on top?
- The grade. Did the system correctly judge the chunks good or weak?
- Token counts. Which node costs the most? Usually generation.

### Evaluation with LangSmith

LangSmith also runs evaluations. You build a dataset of questions with known good answers, run the graph over it, and LangSmith scores the outputs. This turns "it feels better" into a number you are able to track across changes. Full method in [evaluation.md](12-evaluation.md).

## How they fit together

```
LangSmith  ── watches everything ──▶ traces + evals
    ▲
    │ (automatic tracing)
LangGraph  ── the loop: route → rewrite → retrieve → grade → generate → check
    │ calls
    ▼
LangChain  ── the parts: loaders, splitter, embeddings, retriever, reranker, ChatAnthropic
```

One sentence each: LangChain is the parts, LangGraph is the wiring, LangSmith is the camera. You need all three, and they are built to work together.
