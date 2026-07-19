"""Agent chat endpoint.

POST /api/chat -> verify the Firebase ID token -> load everything the user can
access across ALL their workspaces -> run the LangGraph agent -> return the answer,
the steps taken, the sources cited and the UI cards. Same JSON contract as the
frontend's existing route, so the UI needs no change.

Defined as a sync endpoint on purpose: run_agent makes blocking network calls
(Claude, Pinecone, Firestore), so FastAPI runs it in a threadpool rather than
blocking the event loop.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.data.firestore import load_user_scope
from app.models import ChatRequest, ChatResponse
from app.rag.agent import AgentMeta, run_agent
from app.rag.tools import ProjectRef, ToolContext
from app.security.auth import AuthedUser, get_current_user

router = APIRouter()

# Caps input tokens and cost; the frontend enforces the same limit on the composer.
MAX_CHAT_INPUT_CHARS = 2000


@router.post("/chat", response_model=ChatResponse)
def chat(
    body: ChatRequest,
    user: AuthedUser = Depends(get_current_user),
) -> ChatResponse:
    if not body.message:
        raise HTTPException(status_code=400, detail="message is required")

    # The agent's scope is everything the user can access, across ALL workspaces.
    # workspaceId/projectId are just the current view (defaults + prompt naming).
    workspaces, projects = load_user_scope(user.uid)
    ws_name = {w["id"]: w.get("name", "Workspace") for w in workspaces}

    ctx = ToolContext(
        uid=user.uid,
        user_name=user.name or "You",
        current_workspace_id=body.workspaceId,
        current_project_id=body.projectId,
        projects=[
            ProjectRef(
                id=p["id"],
                name=p.get("name", ""),
                rag_namespace=p.get("ragNamespace", ""),
                workspace_id=p.get("workspaceId", ""),
                member_ids=p.get("memberIds", []),
            )
            for p in projects
        ],
    )

    # Project list grouped by workspace, so the agent knows what spans where.
    grouped: dict[str, list[str]] = {}
    for p in projects:
        key = ws_name.get(p.get("workspaceId"), "Workspace")
        grouped.setdefault(key, []).append(p.get("name", ""))
    project_list = "\n".join(
        f"{ws}:\n" + "\n".join(f"  - {n}" for n in names) for ws, names in grouped.items()
    )

    meta = AgentMeta(
        workspace_name=ws_name.get(body.workspaceId, "your workspaces"),
        project_name=next((p.get("name") for p in projects if p["id"] == body.projectId), None),
        project_list=project_list,
    )

    try:
        result = run_agent(body.message[:MAX_CHAT_INPUT_CHARS], body.history, ctx, meta)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return ChatResponse(
        answer=result.answer,
        steps=result.steps,
        sources=result.sources,
        cards=result.cards,
    )
