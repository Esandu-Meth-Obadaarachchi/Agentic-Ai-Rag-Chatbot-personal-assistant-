"""Related-knowledge endpoint (smart linking).

Given a task's project and a query, return the related knowledge chunks. One
retrieve+rerank pass (no grade loop), scoped to the project namespace and gated
by membership. Same contract as the frontend's /api/related.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.data.firestore import load_project
from app.models import RelatedRequest, RelatedResponse
from app.rag.retrieval import retrieve_and_rerank
from app.security.auth import AuthedUser, get_current_user

router = APIRouter()


@router.post("/related", response_model=RelatedResponse)
def related(
    body: RelatedRequest,
    user: AuthedUser = Depends(get_current_user),
) -> RelatedResponse:
    try:
        project = load_project(user.uid, body.projectId)
    except KeyError:
        raise HTTPException(status_code=404, detail="Project not found") from None
    except PermissionError:
        raise HTTPException(status_code=403, detail="Forbidden") from None

    try:
        chunks = retrieve_and_rerank([project.get("ragNamespace", "")], body.query, 3)
    except Exception:  # noqa: BLE001 — smart-linking is best-effort; never error the caller
        chunks = []

    return RelatedResponse(chunks=chunks)
