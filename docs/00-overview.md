# 00 — Overview: what agentic RAG is and why

## Start with the problem

A language model knows only what it saw during training. It does not know your workspace documents, your hotel bookings, or your project notes. Ask it about those and it either refuses or invents an answer. Inventing an answer is called hallucination, and it is the single biggest risk in any document chatbot.

RAG fixes this. RAG stands for Retrieval Augmented Generation. The idea is simple. Before the model answers, you retrieve the relevant text from your own documents and hand it to the model as context. The model then answers from that text, not from memory. You have grounded the answer in real sources.

## The three words, explained

- Retrieval. Find the pieces of your documents most relevant to the question.
- Augmented. Add those pieces to the prompt you send the model.
- Generation. The model writes the answer using the added context.

So a plain RAG pipeline is: question in, search documents, stuff the results into the prompt, model answers. One pass, no thinking about whether the search was any good.

## Where plain RAG breaks

Plain RAG is a straight line with no feedback. It has four common failures.

1. The user question is messy. "What about the second one?" means nothing to a search engine on its own.
2. The search returns weak or off-topic chunks, and the pipeline uses them anyway.
3. The model answers even when the retrieved text does not contain the answer, so it fills the gap by guessing.
4. The pipeline runs a full search even for "hello" or "thanks", wasting time and money.

## What "agentic" adds

Agentic RAG turns the straight line into a loop with decisions. The system is able to check its own work and act on the result. Think of it as a junior researcher who does not hand you the first thing they find. They read it, judge whether it answers the question, and search again if it does not.

Concretely, an agentic RAG system does four extra things:

1. It routes first. Is this small talk, a vague question, or a real question? It only searches when a search is needed.
2. It rewrites the question into a clean, standalone search query using the chat history.
3. It grades the retrieved chunks. Weak chunks trigger a reformulated query and another try, up to a set limit.
4. It checks the final answer against the sources before returning it, and says "I do not have that" when the sources do not support an answer.

Each of these is a small model call. Each removes one of the four failures above.

## The mental model to hold

Picture two loops around a core.

- The inner loop is retrieval. Search, rerank, grade. If the grade is poor, rewrite and search again. Cap it at three passes so it never spins forever.
- The outer step is generation with a self-check. Write the answer from the graded chunks, confirm every claim traces to a source, then return it with citations.

Everything else in this documentation is detail hanging off that model. Access control decides what the search is allowed to see. Chunking and embeddings decide what the search finds. The cross-encoder decides the final ordering. LangGraph is the framework holding the loop together. LangSmith is the camera recording every step so you are able to see what happened.

## Why this design for your case

You have workspaces, and each workspace has projects. People in one workspace must never see another workspace's data. That is a hard rule, so the retrieval step is wrapped in strict access control (see [access-control.md](02-access-control.md)). Within a workspace, people often want to compare projects, so the namespace design keeps that easy (see [namespaces-pinecone.md](06-namespaces-pinecone.md)).

You also want low cost, so every reasoning step runs on Claude Haiku, the smallest and cheapest current model. Haiku is strong enough for tool selection, query rewriting, chunk grading, and grounded generation. The heavy lifting on relevance is done by Voyage's `rerank-2.5` cross-encoder, a hosted call rather than a model running in-process — see [model-hosting.md](14-model-hosting.md) for what that trade-off actually costs.

## What good looks like

A finished agentic RAG chatbot has these properties.

- It never returns another workspace's data. Ever.
- It answers from sources and cites them.
- It says "I do not know" instead of guessing.
- It handles small talk without a pointless search.
- Every request is traceable end to end in LangSmith.
- It costs pennies per conversation.

Keep that list in mind as you read the rest. Each file moves one item from idea to implementation.
