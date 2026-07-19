"""Request/response schemas.

These mirror the JSON contract the existing frontend already speaks, so the
Next.js UI can call this API with no changes. See the frontend's /api/chat,
/api/ingest and /api/related routes.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ChatTurn(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    message: str
    # The current view only — used to default new tasks and name the workspace in
    # the prompt. It never limits scope; the agent sees everything the user can.
    workspaceId: str | None = None
    projectId: str | None = None
    history: list[ChatTurn] = Field(default_factory=list)


class RetrievedChunk(BaseModel):
    id: str
    score: float = 0.0
    text: str = ""
    source: str = "unknown"
    project: str | None = None


class ChatResponse(BaseModel):
    answer: str
    steps: list[str] = Field(default_factory=list)
    sources: list[RetrievedChunk] = Field(default_factory=list)
    cards: list[dict] = Field(default_factory=list)


class RelatedRequest(BaseModel):
    projectId: str
    query: str


class RelatedResponse(BaseModel):
    chunks: list[RetrievedChunk] = Field(default_factory=list)


class IngestResponse(BaseModel):
    chunksStored: int
    filename: str
    project: str
