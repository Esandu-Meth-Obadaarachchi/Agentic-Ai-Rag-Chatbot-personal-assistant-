# 05 — Chunking

## Why we chunk at all

A whole document is too big to embed as one vector and too big to hand the model. So you split it into chunks, embed each chunk, and retrieve only the chunks relevant to a question. Chunking is the step where you decide the unit of retrieval. It sets a ceiling on answer quality, because the model only ever sees the chunks you retrieved.

Two failure modes bound the choice.

- Chunks too big. You retrieve a lot of irrelevant text around the one relevant sentence. The signal is diluted, and you waste tokens.
- Chunks too small. The relevant sentence loses its surrounding context, so it no longer makes sense on its own, and the embedding is weaker.

The craft of chunking is finding the middle.

## Size and overlap

Use these defaults.

- Chunk size: 500 to 800 tokens.
- Overlap: 15 percent, so roughly 75 to 120 tokens.

### Why overlap

A fact often sits on the boundary between two chunks. Without overlap, a hard split cuts a sentence or an idea in half, and neither chunk holds the whole thought. Overlap repeats the last slice of one chunk at the start of the next, so a boundary fact appears complete in at least one chunk. Fifteen percent is the common sweet spot. Enough to catch boundaries, not so much that you store the same text many times.

```
Chunk A:  [.................... tokens 0-700 ....................]
Chunk B:              [.......... tokens 600-1300 ..........]
                       ^-- the 600-700 overlap repeats here
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
    chunk_size=700,
    chunk_overlap=105,          # ~15% of 700
    separators=["\n\n", "\n", ". ", " ", ""],
    length_function=len,        # swap for a token counter for token-based sizing
)
chunks = splitter.split_text(document_text)
```

For markdown or code, use the structure-aware variants (`MarkdownHeaderTextSplitter`, or a language-aware splitter) so you never cut through the middle of a code block or a table. A half a table is worse than useless.

## The metadata is not optional

Every chunk carries metadata. This is where retrieval quality and security meet. Attach at least these.

```python
metadata = {
    "workspace_id": workspace_id,   # security filter (Gate 2)
    "project_id": project_id,       # security + cross-project compare
    "doc_id": doc_id,               # ties the chunk back to its document
    "chunk_index": i,               # order within the document
    "title": document_title,        # for citations
    "section": current_heading,     # for citations
    "source": filename_or_url,      # provenance
    "created_at": iso_timestamp,
}
```

`workspace_id` and `project_id` power the access filter in [access-control.md](02-access-control.md). `doc_id`, `title`, and `section` power citations, so the answer is able to point back to a real place in a real document. Without citations the user cannot verify the answer, and trust collapses.

## The other good practices

- Clean the text before splitting. Strip boilerplate, repeated headers and footers, and navigation junk. Garbage in the chunk becomes garbage in the vector.
- Keep tables and lists intact where you can. Splitting a table row from its header destroys meaning.
- Store the section heading with the chunk. A chunk that starts mid-topic is much clearer to the model when it knows the section it came from.
- Size by tokens, not characters, when you can. The model and the embedder count tokens, so token-based sizing gives you predictable limits. Use the embedder's tokenizer or a `tiktoken`-style counter as the `length_function`.
- Normalise whitespace. Collapse runs of blank lines. It makes overlaps cleaner.

## Chunking and re-ingestion

When a document changes you re-chunk the whole document, not a diff. Delete the old chunks by `doc_id` and write the new ones. Trying to patch individual chunks is fragile, because a small edit near the top shifts every boundary below it. Full re-chunk on change is simpler and correct. Idempotency detail is in [ingestion.md](07-ingestion.md).

## A note on advanced chunking

Two upgrades exist if you later want more accuracy.

- Semantic chunking. Split where the topic shifts, detected by embedding sentences and cutting where similarity drops. More accurate, more compute.
- Parent-child (small-to-big). Embed small chunks for precise matching, but hand the model the larger parent chunk they came from for context. LangChain has a `ParentDocumentRetriever` for this.

Start with recursive splitting and 15 percent overlap. Move to these only if evaluation shows chunking is your weak link. Do not add complexity before the numbers ask for it.
