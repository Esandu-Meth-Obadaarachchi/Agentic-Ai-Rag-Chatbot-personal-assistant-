"""Agent chat endpoint.

Phase 1 wires auth end to end and returns a placeholder. The LangGraph agent
(retrieval + tools + generation) replaces the placeholder on feature/rag-pipeline,
scoped to the authenticated user.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.models import ChatRequest, ChatResponse
from app.security.auth import AuthedUser, get_current_user

router = APIRouter()


@router.post("/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    user: AuthedUser = Depends(get_current_user),
) -> ChatResponse:
    return ChatResponse(
        answer="[agent not wired yet — lands on feature/rag-pipeline]",
        steps=[f"authenticated as {user.uid}", "scaffold placeholder"],
        sources=[],
        cards=[],
    )
