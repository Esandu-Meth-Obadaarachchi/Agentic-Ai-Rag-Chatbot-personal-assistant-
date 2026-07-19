"""Document parsing for ingestion.

PDFs via pypdf, DOCX via python-docx, and everything text-like (md, code, txt,
csv, json) as raw UTF-8. Returns (text, type). Server-only.
"""

from __future__ import annotations

from io import BytesIO

import docx
from pypdf import PdfReader

_CODE_EXTS = {"md", "txt", "csv", "json", "ts", "tsx", "js", "jsx", "py", "java", "sql", "yaml", "yml"}


def parse_file(filename: str, mime: str | None, data: bytes) -> tuple[str, str]:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    mime = mime or ""

    if ext == "pdf" or mime == "application/pdf":
        reader = PdfReader(BytesIO(data))
        text = "\n".join((page.extract_text() or "") for page in reader.pages)
        return text, "pdf"

    if ext == "docx" or "wordprocessingml" in mime:
        document = docx.Document(BytesIO(data))
        text = "\n".join(p.text for p in document.paragraphs)
        return text, "docx"

    doc_type = "markdown" if ext == "md" else ("code" if ext in _CODE_EXTS else "text")
    return data.decode("utf-8", errors="replace"), doc_type
