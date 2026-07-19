"""Firestore access — the agent's data layer.

Scope and reads are gated by `memberIds array-contains uid`, the same isolation
query the frontend uses, so a call only ever returns docs the user is a member of.
Per-project scope is already baked into `project.memberIds` and `task.memberIds`,
so a scoped member never sees another project's tasks or knowledge.
"""

from __future__ import annotations

from typing import Any

from google.cloud.firestore_v1.base_query import FieldFilter

from app.security.firebase import get_db


def _to_dict(snap) -> dict[str, Any]:
    data = snap.to_dict() or {}
    data["id"] = snap.id
    return data


def load_user_scope(uid: str) -> tuple[list[dict], list[dict]]:
    """Every workspace and project the user can act on, across ALL their workspaces."""
    db = get_db()
    ws = db.collection("workspaces").where(
        filter=FieldFilter("memberIds", "array_contains", uid)
    ).stream()
    pj = db.collection("projects").where(
        filter=FieldFilter("memberIds", "array_contains", uid)
    ).stream()
    return [_to_dict(s) for s in ws], [_to_dict(s) for s in pj]


def load_project(uid: str, project_id: str) -> dict:
    """Load a single project, enforcing membership."""
    snap = get_db().collection("projects").document(project_id).get()
    if not snap.exists:
        raise KeyError("Project not found")
    project = _to_dict(snap)
    member_ids = project.get("memberIds")
    if member_ids and uid not in member_ids:
        raise PermissionError("Forbidden")
    return project


def fetch_accessible_tasks(uid: str) -> list[dict]:
    """Every task the user can access, across ALL their workspaces."""
    snap = get_db().collection("tasks").where(
        filter=FieldFilter("memberIds", "array_contains", uid)
    ).stream()
    return [_to_dict(s) for s in snap]


def add_task(doc: dict) -> str:
    """Create a task document; returns the new id."""
    ref = get_db().collection("tasks").add(doc)[1]
    return ref.id


def update_task_doc(task_id: str, patch: dict) -> None:
    get_db().collection("tasks").document(task_id).update(patch)
