"""Agent tools.

A faithful port of the TypeScript agent's tools, exposed as LangChain
StructuredTools so the LangGraph agent can call them. Each tool reads/writes
Firestore through the admin client, scoped to the authenticated user, and
accumulates sources / cards / steps on the ToolContext for the UI.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from app.data.firestore import (
    add_task,
    fetch_accessible_tasks,
    update_task_doc,
)
from app.models import RetrievedChunk
from app.rag.retrieval import agentic_retrieve, retrieve_and_rerank


@dataclass
class ProjectRef:
    id: str
    name: str
    rag_namespace: str
    workspace_id: str
    member_ids: list[str] = field(default_factory=list)


@dataclass
class ToolContext:
    uid: str
    user_name: str
    current_workspace_id: str | None
    current_project_id: str | None
    projects: list[ProjectRef]
    sources: list[RetrievedChunk] = field(default_factory=list)
    cards: list[dict] = field(default_factory=list)
    steps: list[str] = field(default_factory=list)


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _now_ms() -> int:
    return int(time.time() * 1000)


# --------------------------------- helpers --------------------------------- #


def _resolve_project(ctx: ToolContext, name: str | None) -> ProjectRef | None:
    if not name:
        by_current = next((p for p in ctx.projects if p.id == ctx.current_project_id), None)
        by_ws = next((p for p in ctx.projects if p.workspace_id == ctx.current_workspace_id), None)
        return by_current or by_ws or (ctx.projects[0] if ctx.projects else None)
    n = name.lower()
    exact = next((p for p in ctx.projects if p.name.lower() == n), None)
    if exact:
        return exact
    return next(
        (p for p in ctx.projects if n in p.name.lower() or p.name.lower() in n), None
    )


def _is_overdue(t: dict) -> bool:
    due = t.get("dueDate")
    return bool(due) and t.get("status") != "done" and due < _today()


def _is_due_today(t: dict) -> bool:
    return t.get("dueDate") == _today() and t.get("status") != "done"


def _assignee_names(t: dict) -> list[str]:
    names = [t.get("assigneeName")] + [a.get("name") for a in (t.get("assignees") or [])]
    return [n for n in names if n]


def _compact(t: dict, proj_name: str | None = None, parent_title: str | None = None, subtasks: int = 0) -> dict:
    return {
        "id": t.get("id"),
        "title": t.get("title"),
        "status": t.get("status"),
        "priority": t.get("priority"),
        "due": t.get("dueDate"),
        "project": proj_name,
        "assignee": ", ".join(_assignee_names(t)) or None,
        "parent": parent_title,   # None => a top-level task
        "subtasks": subtasks,     # number of direct children
    }


def _base_task_doc(ctx: ToolContext, target: ProjectRef, *, title: str, parent_id: str | None,
                   status: str | None, priority: str | None, due_date: str | None, order: int) -> dict:
    now = _now_ms()
    return {
        "workspaceId": target.workspace_id,
        "projectId": target.id,
        "parentId": parent_id,
        "title": title,
        "notes": "",
        "status": status or "todo",
        "priority": priority or "med",
        "assignees": [{"id": ctx.uid, "name": ctx.user_name, "avatar": None}],
        "assigneeId": ctx.uid,
        "assigneeName": ctx.user_name,
        "assigneeAvatar": None,
        "dueDate": due_date or None,
        "startDate": None,
        "tags": [],
        "dependencies": [],
        "linkedDocs": [],
        "order": order,
        "createdAt": now,
        "updatedAt": now,
        "createdBy": ctx.uid,
        "memberIds": target.member_ids,
    }


# ------------------------------ tool arg schemas ------------------------------ #


class SearchKnowledgeArgs(BaseModel):
    query: str = Field(description="What to search for")
    project: str | None = Field(default=None, description="Optional project name to scope the search to")


class ListTasksArgs(BaseModel):
    project: str | None = Field(default=None, description="Optional project name to scope to")
    assignee: str | None = Field(default=None, description="Optional person's name — only tasks assigned to them")
    under: str | None = Field(default=None, description="Optional parent task title — return that task's direct subtasks")
    status: str | None = Field(default=None, description='One of "todo", "in_progress", "blocked", "done"')
    filter: str | None = Field(default=None, description='Time filter: "overdue", "due_today" or "all"')


class CreateTaskArgs(BaseModel):
    title: str
    project: str | None = Field(default=None, description="Project name; defaults to the current project")
    status: str | None = None
    priority: str | None = None
    due_date: str | None = Field(default=None, description="yyyy-mm-dd")
    parent_title: str | None = Field(default=None, description="If this is a subtask, the parent task's title")


class TaskNode(BaseModel):
    title: str
    status: str | None = None
    priority: str | None = None
    due_date: str | None = Field(default=None, description="yyyy-mm-dd")
    subtasks: list["TaskNode"] | None = None


TaskNode.model_rebuild()


class CreateTasksArgs(BaseModel):
    tasks: list[TaskNode] = Field(description="Top-level tasks; each may carry a nested `subtasks` array of the same shape")
    project: str | None = Field(default=None, description="Project name; defaults to the current project")


class UpdateTaskArgs(BaseModel):
    task_title: str = Field(description="Title (or close match) of the task to update")
    set_status: str | None = None
    set_priority: str | None = None
    set_due_date: str | None = Field(default=None, description="yyyy-mm-dd, or empty string to clear")
    set_title: str | None = None


class SummarizeProjectArgs(BaseModel):
    project: str | None = None


# -------------------------------- executors -------------------------------- #


def build_tools(ctx: ToolContext) -> list[StructuredTool]:
    """Build the tool set bound to one request's context."""

    def _proj_name(project_id: str) -> str | None:
        return next((p.name for p in ctx.projects if p.id == project_id), None)

    # --- search_knowledge ---
    def search_knowledge(query: str, project: str | None = None) -> str:
        target = _resolve_project(ctx, project) if project else None
        namespaces = [target.rag_namespace] if target else [p.rag_namespace for p in ctx.projects]
        result = agentic_retrieve(namespaces, query)
        chunks = result.chunks
        ctx.sources.extend(chunks)
        ctx.steps.append(
            f"retrieved {len(chunks)} chunk(s) in {result.attempts} attempt(s), graded {result.grade}"
        )
        if chunks:
            ctx.cards.append({"kind": "sources", "data": [c.model_dump() for c in chunks]})
            return _json([
                {"source": c.source, "project": c.project, "score": f"{c.score:.2f}", "text": c.text[:500]}
                for c in chunks
            ])
        return "No matching documents found in the knowledge base."

    # --- list_tasks ---
    def list_tasks(project=None, assignee=None, under=None, status=None, filter=None) -> str:
        all_tasks = fetch_accessible_tasks(ctx.uid)
        by_id = {t["id"]: t for t in all_tasks}
        child_count: dict[str, int] = {}
        for t in all_tasks:
            if t.get("parentId"):
                child_count[t["parentId"]] = child_count.get(t["parentId"], 0) + 1

        target = _resolve_project(ctx, project) if project else None
        rows = [t for t in all_tasks if t.get("projectId") == target.id] if target else list(all_tasks)

        if under:
            q = under.lower()
            parent = next((t for t in rows if t.get("title", "").lower() == q), None) or \
                next((t for t in rows if q in t.get("title", "").lower()), None)
            if not parent:
                return f'No task found matching "{under}" to list subtasks of.'
            rows = [t for t in all_tasks if t.get("parentId") == parent["id"]]

        if assignee:
            q = assignee.lower()
            rows = [t for t in rows if any(q in n.lower() or n.lower() in q for n in _assignee_names(t))]

        if status:
            rows = [t for t in rows if t.get("status") == status]
        if filter == "overdue":
            rows = [t for t in rows if _is_overdue(t)]
        if filter == "due_today":
            rows = [t for t in rows if _is_due_today(t)]

        rows.sort(key=lambda t: t.get("dueDate") or "9999")
        rows = rows[:40]
        data = [
            _compact(
                t,
                _proj_name(t.get("projectId")),
                (by_id.get(t["parentId"], {}).get("title") if t.get("parentId") else None),
                child_count.get(t["id"], 0),
            )
            for t in rows
        ]
        ctx.cards.append({"kind": "task_list", "data": data})
        return _json({"count": len(rows), "tasks": data})

    # --- create_task ---
    def create_task(title, project=None, status=None, priority=None, due_date=None, parent_title=None) -> str:
        target = _resolve_project(ctx, project)
        if not target:
            return "No project available to create the task in."
        parent_id = None
        if parent_title:
            all_tasks = fetch_accessible_tasks(ctx.uid)
            parent = next(
                (t for t in all_tasks
                 if t.get("projectId") == target.id and parent_title.lower() in t.get("title", "").lower()),
                None,
            )
            parent_id = parent["id"] if parent else None
        doc = _base_task_doc(ctx, target, title=str(title), parent_id=parent_id,
                             status=status, priority=priority, due_date=due_date, order=_now_ms())
        task_id = add_task(doc)
        ctx.cards.append({"kind": "created_task", "data": {"id": task_id, **doc, "project": target.name}})
        return f'Created task "{doc["title"]}" in {target.name}' + (f' due {doc["dueDate"]}' if doc["dueDate"] else "") + "."

    # --- create_tasks (batch + nested subtasks) ---
    def create_tasks(tasks, project=None) -> str:
        target = _resolve_project(ctx, project)
        if not target:
            return "No project available to create tasks in."
        roots = tasks or []
        if not roots:
            return "No tasks were provided to create."
        order = _now_ms()
        summary: list[dict] = []
        count = 0

        def _as_dict(node) -> dict:
            return node.model_dump() if isinstance(node, TaskNode) else dict(node)

        def create_node(node, parent_id, parent_title):
            nonlocal order, count
            node = _as_dict(node)
            title = str(node.get("title") or "").strip()
            if not title:
                return
            doc = _base_task_doc(ctx, target, title=title, parent_id=parent_id,
                                 status=node.get("status"), priority=node.get("priority"),
                                 due_date=node.get("due_date"), order=order)
            order += 1
            task_id = add_task(doc)
            count += 1
            summary.append({
                "id": task_id, "title": title, "status": doc["status"], "priority": doc["priority"],
                "due": doc["dueDate"], "project": target.name, "parent": parent_title,
            })
            for sub in (node.get("subtasks") or []):
                create_node(sub, task_id, title)

        for root in roots:
            create_node(root, None, None)
        ctx.cards.append({"kind": "task_list", "data": summary})
        return f"Created {count} task{'' if count == 1 else 's'} (with their subtasks) in {target.name}."

    # --- update_task ---
    def update_task(task_title, set_status=None, set_priority=None, set_due_date=None, set_title=None) -> str:
        all_tasks = fetch_accessible_tasks(ctx.uid)
        q = str(task_title or "").lower()
        match = next((t for t in all_tasks if t.get("title", "").lower() == q), None) or \
            next((t for t in all_tasks if q in t.get("title", "").lower()), None)
        if not match:
            return f'No task found matching "{task_title}".'
        patch: dict = {"updatedAt": _now_ms()}
        if set_status:
            patch["status"] = set_status
        if set_priority:
            patch["priority"] = set_priority
        if set_title:
            patch["title"] = set_title
        if set_due_date is not None:
            patch["dueDate"] = set_due_date or None
        update_task_doc(match["id"], patch)
        ctx.cards.append({"kind": "updated_task", "data": {"id": match["id"], "title": match["title"], **patch, "project": _proj_name(match.get("projectId"))}})
        return f'Updated "{match["title"]}".'

    # --- summarize_project ---
    def summarize_project(project=None) -> str:
        target = _resolve_project(ctx, project)
        if not target:
            return "Project not found."
        all_tasks = fetch_accessible_tasks(ctx.uid)
        tasks = [_compact(t, target.name) for t in all_tasks if t.get("projectId") == target.id]
        chunks: list[RetrievedChunk] = []
        try:
            chunks = retrieve_and_rerank([target.rag_namespace], f"{target.name} overview status", 4)
            ctx.sources.extend(chunks)
        except Exception:  # noqa: BLE001 — knowledge base may be empty
            pass
        return _json({
            "project": target.name,
            "tasks": tasks,
            "knowledge": [{"source": c.source, "text": c.text[:500]} for c in chunks],
        })

    return [
        StructuredTool.from_function(
            func=search_knowledge, name="search_knowledge", args_schema=SearchKnowledgeArgs,
            description="Search the user's uploaded documents (the knowledge base) for relevant passages. Use for any question about past decisions, specs, notes or facts that would live in a document.",
        ),
        StructuredTool.from_function(
            func=list_tasks, name="list_tasks", args_schema=ListTasksArgs,
            description="List tasks with their project, status, priority, due date, ASSIGNEE and PARENT task. Use for 'what's overdue', 'what's due today', 'what's on my plate', 'what's assigned to <person>', 'the subtasks of <task>', project status, etc.",
        ),
        StructuredTool.from_function(
            func=create_task, name="create_task", args_schema=CreateTaskArgs,
            description="Create ONE new task or subtask. For several tasks at once, or ANY task that has subtasks, use create_tasks instead. Resolve relative dates to yyyy-mm-dd before calling.",
        ),
        StructuredTool.from_function(
            func=create_tasks, name="create_tasks", args_schema=CreateTasksArgs,
            description="Create MANY tasks and/or nested subtasks in one call. Use whenever you need more than one task, or any task with subtasks — it builds the whole tree at once with exact parent-child links.",
        ),
        StructuredTool.from_function(
            func=update_task, name="update_task", args_schema=UpdateTaskArgs,
            description="Update an existing task by its title. Set any of status, priority, due date or title.",
        ),
        StructuredTool.from_function(
            func=summarize_project, name="summarize_project", args_schema=SummarizeProjectArgs,
            description="Get a project's tasks and top knowledge snippets so you can summarise its status.",
        ),
    ]


def _json(obj) -> str:
    import json
    return json.dumps(obj, default=str)
