# 13 — Glossary

Every term in the folder, in plain words. Come back here whenever a word is fuzzy.

## Core RAG

Retrieval Augmented Generation (RAG). Fetch relevant text from your own documents and give it to the model so it answers from real sources, not from memory.

Grounding. Tying an answer to the source text it came from. A grounded answer is one you are able to check against a document.

Hallucination. A model stating something as fact when the sources do not support it. The main risk RAG and the self-check node exist to reduce.

Agentic RAG. RAG with decisions and loops. The system routes, rewrites, grades its own retrieval, retries when it is weak, and checks the final answer, instead of running once in a straight line.

Context. The retrieved text placed into the prompt for the model to answer from.

Citation. A pointer from a fact in the answer back to the document and section it came from.

## Vectors and search

Embedding. A list of numbers representing the meaning of a piece of text. Similar meaning maps to nearby vectors.

Vector. The list of numbers itself. Its length is the model's dimension (for example 384 for bge-small).

Bi-encoder. A model that reads one text at a time and outputs one vector. Fast, used to embed and search at scale. Your embedding model is a bi-encoder.

Cross-encoder. A model that reads the query and one document together and outputs a relevance score. Slower but sharper. Your reranker is a cross-encoder.

Cosine similarity. A measure of how close two vectors point. Near 1 means very similar. How Pinecone judges relevance.

Dimension. The fixed length of a model's vectors. The embedder and the Pinecone index must agree on it.

Recall. Did the right chunk get retrieved at all? The job of the first search stage.

Precision. Are the top results actually the best ones? The job of the reranking stage.

## Chunking

Chunk. A piece of a document, sized to be embedded and retrieved on its own. The unit of retrieval.

Overlap. Repeating the end of one chunk at the start of the next so a fact on the boundary appears whole in at least one chunk. We use 15 percent.

Structure-aware splitting. Splitting on natural boundaries (headings, paragraphs, sentences) before falling back to raw character counts.

Metadata. Extra fields stored with each chunk (workspace id, project id, doc id, title, section). Powers the access filter and citations.

## Storage

Pinecone. The managed vector database holding chunk vectors and their metadata.

Namespace. A partition inside a Pinecone index. A query hits one namespace only. We use one per workspace, which makes it the security wall.

Index. The whole Pinecone store for the product. Split into namespaces inside.

Upsert. Insert or overwrite vectors. Used at ingestion.

Metadata filter. A condition on a query that keeps only vectors matching given fields. Our second security gate (project scope).

Firestore. The Firebase document database holding users, roles, project access, document metadata, and chat history. Not vectors.

Idempotent. Running the same operation twice has the same effect as running it once. We get this on ingestion with a content hash.

## Access control

Workspace. The top-level tenant. Maps to a Pinecone namespace. Hard isolation boundary.

Project. A grouping inside a workspace. Maps to chunk metadata. Users compare projects within their workspace.

Role. What a member is allowed to do in a workspace: owner, admin, member, viewer.

Membership. The stored record linking a user to a workspace, with their role and project access.

Gate 1 (authorisation). The server check that resolves the user's workspace, role, and allowed projects from stored records before the loop runs.

Gate 2 (metadata filter). The per-query filter on workspace and project applied inside every Pinecone search. Defence in depth.

JWT. A signed token proving who the user is. The client cannot forge the user id inside it.

## The loop

LangChain. The library of standard building blocks: loaders, splitters, embeddings, retrievers, model wrappers.

LangGraph. The framework for building the loop as a state machine with branches and retries.

LangSmith. The observability tool that records every step of every run for debugging and evaluation.

State. The shared object the loop reads and writes as it moves between nodes.

Node. One step in the loop (route, rewrite, retrieve, grade, generate, self-check).

Edge. The rule deciding which node runs next based on the state. Where branching and looping live.

Router. The first node, which classifies the message as small talk, a clarify, or a real question.

Rewrite. The node that turns a context-dependent message into a standalone search query.

Grade. The node that judges whether the retrieved chunks answer the question.

Self-check (groundedness check). The final node that confirms every claim in the answer traces to a source.

## Model and cost

Claude Haiku 4.5. The small, cheap Claude model (`claude-haiku-4-5`) running every reasoning node.

ChatAnthropic. The LangChain wrapper for calling Claude.

Token. The unit models read and bill by. Roughly three-quarters of a word.

Prompt caching. Reusing the cost of a stable prompt prefix across requests. On Haiku the cacheable prefix must be at least 4,096 tokens.

max_tokens. The cap on how many tokens a single response may produce.

## Evaluation

Evaluation set. A fixed list of questions with known good sources and answers, used to measure the system.

Hit rate (recall at k). The fraction of questions where a correct chunk appeared in the top k retrieved.

Mean reciprocal rank (MRR). How high the first correct chunk landed on average. Rewards good ranking.

Faithfulness. Whether every claim in an answer traces to the retrieved context. The anti-hallucination score.

LLM-as-judge. Using a model to score answers automatically. Good for tracking trends, not perfect truth.
