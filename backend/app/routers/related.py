"""Related-knowledge endpoint (smart linking).

Placeholder in Phase 1. On feature/ingestion it runs retrieve+rerank against the
project namespace, scoped by membership.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.models import RelatedRequest, RelatedResponse
from app.security.auth import AuthedUser, get_current_user

router = APIRouter()


@router.post("/related", response_model=RelatedResponse)
async def related(
    body: RelatedRequest,
    user: AuthedUser = Depends(get_current_user),
) -> RelatedResponse:
    return RelatedResponse(chunks=[])
