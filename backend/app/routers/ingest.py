"""Knowledge ingestion endpoint.

Placeholder in Phase 1. On feature/ingestion it parses -> chunks -> Voyage-embeds
-> upserts to the project's Pinecone namespace, scoped by membership.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile

from app.models import IngestResponse
from app.security.auth import AuthedUser, get_current_user

router = APIRouter()


@router.post("/ingest", response_model=IngestResponse)
async def ingest(
    projectId: str = Form(...),
    title: str | None = Form(None),
    text: str | None = Form(None),
    file: UploadFile | None = None,
    user: AuthedUser = Depends(get_current_user),
) -> IngestResponse:
    raise HTTPException(status_code=501, detail="ingestion lands on feature/ingestion")
