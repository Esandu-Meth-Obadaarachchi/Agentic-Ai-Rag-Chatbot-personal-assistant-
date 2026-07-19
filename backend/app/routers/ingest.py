"""Knowledge ingestion endpoint.

Ingest a document (multipart file) or pasted text into a project's knowledge
namespace: parse -> chunk -> Voyage-embed -> Pinecone upsert. Membership is
enforced via load_project. Same JSON contract as the frontend's /api/ingest.

Sync endpoint: parsing/embedding/upsert are blocking, so FastAPI runs it in a
threadpool rather than blocking the event loop.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.data.firestore import load_project
from app.models import IngestResponse
from app.rag.ingest import ingest_document
from app.rag.parse import parse_file
from app.security.auth import AuthedUser, get_current_user

router = APIRouter()


@router.post("/ingest", response_model=IngestResponse)
def ingest(
    projectId: str = Form(...),
    title: str | None = Form(None),
    text: str | None = Form(None),
    file: UploadFile | None = File(None),
    user: AuthedUser = Depends(get_current_user),
) -> IngestResponse:
    try:
        project = load_project(user.uid, projectId)
    except KeyError:
        raise HTTPException(status_code=404, detail="Project not found") from None
    except PermissionError:
        raise HTTPException(status_code=403, detail="Forbidden") from None

    if file is not None:
        data = file.file.read()
        parsed_text, doc_type = parse_file(file.filename or "upload", file.content_type, data)
        filename = file.filename or "upload"
    else:
        parsed_text = text or ""
        filename = title or "Pasted note"
        doc_type = "text"

    if not parsed_text.strip():
        raise HTTPException(status_code=400, detail="No readable text found in the document.")

    stored = ingest_document(
        namespace=project.get("ragNamespace", ""),
        project_name=project.get("name", ""),
        filename=filename,
        text=parsed_text,
        doc_type=doc_type,
    )
    if stored == 0:
        raise HTTPException(status_code=400, detail="Nothing to index.")

    return IngestResponse(chunksStored=stored, filename=filename, project=project.get("name", ""))
