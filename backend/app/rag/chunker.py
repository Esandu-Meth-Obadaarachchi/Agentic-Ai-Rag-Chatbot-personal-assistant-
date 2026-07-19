"""Chunking for ingestion.

LangChain's RecursiveCharacterTextSplitter, configured to match the TypeScript
app: ~1000 characters per chunk with 200 overlap, breaking on the nicest
separator available (paragraph, line, sentence, word). Overlap keeps a fact that
straddles a boundary retrievable from either chunk.
"""

from __future__ import annotations

import re

from langchain_text_splitters import RecursiveCharacterTextSplitter

_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,
    separators=["\n\n", "\n", ". ", " ", ""],
    keep_separator=True,
)


def chunk_text(text: str) -> list[str]:
    clean = re.sub(r"\n{3,}", "\n\n", text.replace("\r\n", "\n")).strip()
    if not clean:
        return []
    return [c for c in _splitter.split_text(clean) if c.strip()]
