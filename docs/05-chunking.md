# 05 — Chunking

## Why we chunk at all

A whole document is too big to embed as one vector and too big to hand the model. So you split it into chunks, embed each chunk, and retrieve only the chunks relevant to a question. Chunking is the step where you decide the unit of retrieval. It sets a ceiling on answer quality, because the model only ever sees the chunks you retrieved.

Two failure modes bound the choice.

- Chunks too big. You retrieve a lot of irrelevant text around the one relevant sentence. The signal is diluted, and you waste tokens.
- Chunks too small. The relevant sentence loses its surrounding context, so it no longer makes sense on its own, and the embedding is weaker.

The craft of chunking is finding the middle.

## Size and overlap

This build uses characters, not tokens, and these sizes (matching the original TypeScript app exactly, so both read the same Pinecone data with the same chunk boundaries):

- Chunk size: 1000 characters.
- Overlap: 200 characters (20%).

See `backend/app/rag/chunker.py`.

### Why overlap

A fact often sits on the boundary between two chunks. Without overlap, a hard split cuts a sentence or an idea in half, and neither chunk holds the whole thought. Overlap repeats the last slice of one chunk at the start of the next, so a boundary fact appears complete in at least one chunk.

```
Chunk A:  [.................... chars 0-1000 ....................]
Chunk B:              [.......... chars 800-1800 ..........]
                       ^-- the 800-1000 overlap repeats here
```

## Structure-aware splitting

Do not split blindly on character count. Respect the shape of the document. Split on the largest natural boundary first, then fall back to smaller ones only when a piece is still too big.

Order of preference:

1. Headings and sections.
2. Paragraphs (double newline).
3. Sentences.
4. Words, only as a last resort.

LangChain's `RecursiveCharacterTextSplitter` does exactly this. You give it a list of separators from coarse to fine, and it tries each in turn.

```python
from langchain_text_splitters import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,
    separators=["\n\n", "\n", ". ", " ", ""],
    keep_separator=True,
)
chunks = [c for c in splitter.split_text(document_text) if c.strip()]
```

This is the actual code in `chunker.py`, character-based rather than token-based — simple, and it matches the TypeScript app's own hand-rolled splitter exactly, so a chunk boundary computed by either side lands in the same place.

For markdown or code, use the structure-aware variants (`MarkdownHeaderTextSplitter`, or a language-aware splitter) so you never cut through the middle of a code block or a table. A half a table is worse than useless.

## The metadata this build stores

Every chunk carries metadata, attached at upsert time (`backend/app/rag/ingest.py`):

```python
metadata = {
    "text": chunk,             # the chunk itself — retrieval returns this directly, no second lookup
    "source": filename,        # provenance, shown as the citation
    "project": project_name,   # which project this came from (shown when merging cross-project hits)
    "type": doc_type,          # pdf | docx | markdown | code | text
    "uploadedAt": iso_timestamp,
}
```

There is no `workspace_id`, `doc_id` or `chunk_index` on the vector, because the namespace itself already is the project (see [namespaces-pinecone.md](06-namespaces-pinecone.md)) — the wall is structural, not a metadata field. Citations here are at the file level (`source`, `project`), not a section or heading; the original app does not track headings per chunk either.

## The other good practices

- Clean the text before splitting. Strip boilerplate, repeated headers and footers, and navigation junk. Garbage in the chunk becomes garbage in the vector.
- Keep tables and lists intact where you can. Splitting a table row from its header destroys meaning.
- Store the section heading with the chunk. A chunk that starts mid-topic is much clearer to the model when it knows the section it came from.
- Size by tokens, not characters, when you can. The model and the embedder count tokens, so token-based sizing gives you predictable limits. Use the embedder's tokenizer or a `tiktoken`-style counter as the `length_function`.
- Normalise whitespace. Collapse runs of blank lines. It makes overlaps cleaner.

## Chunking and re-ingestion

When a document changes, the right approach is to re-chunk the whole document and delete the old chunks before writing the new ones — patching individual chunks is fragile, because a small edit near the top shifts every boundary below it. This build does not implement that yet: `ingest_document` always inserts fresh vectors under new UUIDs, so re-uploading the same file twice adds a second copy rather than replacing the first. Worth knowing before you rely on re-ingestion in a demo. See [ingestion.md](07-ingestion.md) for what the endpoint does today.

## A note on advanced chunking

Two upgrades exist if you later want more accuracy.

- Semantic chunking. Split where the topic shifts, detected by embedding sentences and cutting where similarity drops. More accurate, more compute.
- Parent-child (small-to-big). Embed small chunks for precise matching, but hand the model the larger parent chunk they came from for context. LangChain has a `ParentDocumentRetriever` for this.

Start with recursive splitting and 15 percent overlap. Move to these only if evaluation shows chunking is your weak link. Do not add complexity before the numbers ask for it.
