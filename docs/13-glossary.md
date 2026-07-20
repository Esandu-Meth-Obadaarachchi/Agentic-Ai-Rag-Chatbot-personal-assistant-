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

Vector. The list of numbers itself. Its length is the model's dimension — 1024 for this build's embedder, `voyage-3.5`.

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

Metadata. Extra fields stored with each chunk — `text`, `source`, `project`, `type`, `uploadedAt` in this build. Powers citations; the isolation itself comes from the namespace, not a metadata filter (see Namespace, below).

## Storage

Pinecone. The managed vector database holding chunk vectors and their metadata.

Namespace. A partition inside a Pinecone index. A query hits only the namespace(s) it explicitly names. This build uses one namespace per project (`project.ragNamespace`), which makes the project the security wall — see [namespaces-pinecone.md](06-namespaces-pinecone.md).

Index. The whole Pinecone store for the product. Split into namespaces inside.

Upsert. Insert or overwrite vectors. Used at ingestion.

Metadata filter. A condition on a query that keeps only vectors matching given fields. Not used as a security gate in this build — the project namespace is the whole wall; metadata (`source`, `project`, `type`) is for citations only.

Firestore. The Firebase document database holding users, roles, project access, document metadata, and chat history. Not vectors.

Idempotent. Running the same operation twice has the same effect as running it once. Not implemented on ingestion in this build — re-uploading the same file adds a second copy of its chunks rather than replacing the first (see [ingestion.md](07-ingestion.md)).

## Access control

Workspace. The top-level tenant a user belongs to. Holds projects. Not the Pinecone isolation boundary in this build — the project is (see Project, below).

Project. A grouping inside a workspace, and this build's actual isolation boundary: each project owns one Pinecone namespace. Users compare projects within their workspace by searching several accessible namespaces and merging hits by score.

`memberIds`. An array field on every workspace, project and task document listing every uid allowed to see it. The isolation mechanism this build actually uses — an `array-contains` Firestore query on this field is the entire access-control read. See [access-control.md](02-access-control.md).

Role. What a member is allowed to do in a workspace: owner, admin, member, viewer. Stored on `workspace.members[]`, not read or enforced by this backend directly — this backend trusts `memberIds` as the already-computed result of role and scope.

Firebase ID token. A signed JWT Firebase issues on sign-in. The client sends it as `Authorization: Bearer <token>`; the backend verifies it with the Firebase Admin SDK to get a trusted uid. The client cannot forge the uid inside it. This is this build's actual authentication mechanism (see `security/firebase.py`).

## The loop

LangChain. The library of standard building blocks: loaders, splitters, embeddings, retrievers, model wrappers.

LangGraph. The framework for building the loop as a state machine with branches and retries.

LangSmith. The observability tool that records every step of every run for debugging and evaluation.

State. The shared object the loop reads and writes as it moves between nodes.

Node. One step in the loop (route, rewrite, retrieve, grade, generate, self-check).

Edge. The rule deciding which node runs next based on the state. Where branching and looping live.

Router. Not a node in this build. There is no explicit classifier step — the outer ReAct agent decides per turn whether a tool call (including `search_knowledge`) is needed at all, so small talk never triggers a search without a dedicated routing prompt.

ReAct agent. The outer tool-calling loop (`langgraph.prebuilt.create_react_agent`) that reads the conversation, decides which of the six tools to call, if any, and repeats until it produces a final answer with no more tool calls.

Rewrite. The retrieval-subgraph node that turns a raw question into a standalone search query.

Assess. The retrieval-subgraph node that grades whether the retrieved chunks answer the question — named `assess`, not `grade`, because `grade` collides with the subgraph's own state key of the same name.

Self-check (groundedness check). Runs after the outer agent loop finishes producing a final answer — a plain function call (`check_grounded`), not a graph node — and confirms every claim in the answer traces to a source gathered during the turn.

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
