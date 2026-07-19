import type Anthropic from "@anthropic-ai/sdk";
import { adminDb } from "@/lib/firebase/admin";
import { agenticRetrieve, retrieveAndRerank } from "./retrieval";
import type { AgentCard, RetrievedChunk, Task, TaskPriority, TaskStatus } from "@/lib/types";

export interface ProjectRef {
  id: string;
  name: string;
  ragNamespace: string;
  /** The workspace this project belongs to (projects span workspaces now). */
  workspaceId: string;
  /** Access list, used when creating tasks so the new doc inherits the right members. */
  memberIds: string[];
}

export interface ToolContext {
  uid: string;
  userName: string;
  /** The workspace the user is currently viewing — used only as a default for new tasks. */
  currentWorkspaceId?: string;
  currentProjectId?: string;
  /** Every project the user can access, across ALL their workspaces. */
  projects: ProjectRef[];
  // artifacts accumulated during a run, surfaced back to the UI
  sources: RetrievedChunk[];
  cards: AgentCard[];
  steps: string[];
}

/** A node in a create_tasks tree: a task with optional nested subtasks. */
interface TaskNodeInput {
  title?: string;
  status?: string;
  priority?: string;
  due_date?: string;
  subtasks?: TaskNodeInput[];
}

/** Tool schemas advertised to Claude. */
export const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_knowledge",
    description:
      "Search the user's uploaded documents (the knowledge base) for relevant passages. Use for any question about past decisions, specs, notes or facts that would live in a document.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for" },
        project: { type: "string", description: "Optional project name to scope the search to" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_tasks",
    description:
      "List tasks with their project, status, priority, due date, ASSIGNEE and PARENT task. Use to answer 'what's overdue', 'what's due today', 'what's on my plate', 'what's assigned to <person>', 'what are the subtasks of <task>', project status, etc. Each result shows who it is assigned to and, if it is a subtask, its parent task's title.",
    input_schema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Optional project name to scope to" },
        assignee: {
          type: "string",
          description: "Optional person's name — return only tasks assigned to them (matches on assignee name)",
        },
        under: {
          type: "string",
          description: "Optional parent task title — return that task's direct subtasks (the breakdown under it)",
        },
        status: { type: "string", enum: ["todo", "in_progress", "blocked", "done"] },
        filter: { type: "string", enum: ["overdue", "due_today", "all"], description: "Time filter" },
      },
    },
  },
  {
    name: "create_task",
    description:
      "Create ONE new task or subtask. For several tasks at once, or ANY task that has subtasks, use create_tasks instead — it is far more reliable. Resolve relative dates to yyyy-mm-dd before calling.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        project: { type: "string", description: "Project name; defaults to the current project" },
        status: { type: "string", enum: ["todo", "in_progress", "blocked", "done"] },
        priority: { type: "string", enum: ["low", "med", "high", "urgent"] },
        due_date: { type: "string", description: "yyyy-mm-dd" },
        parent_title: { type: "string", description: "If this is a subtask, the parent task's title" },
      },
      required: ["title"],
    },
  },
  {
    name: "create_tasks",
    description:
      "Create MANY tasks and/or nested subtasks in one call. Use this whenever you need to create more than one task, or any task that has subtasks — it builds the whole tree at once with exact parent-child links, so it is reliable where many separate create_task calls would run out of steps. If the tree is very large, split it across a few create_tasks calls (e.g. a few top-level tasks per call).",
    input_schema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name; defaults to the current project" },
        tasks: {
          type: "array",
          description:
            "Top-level tasks to create. Each item is a task node with a `title` and an optional `subtasks` array of the same shape (nested to any depth).",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              status: { type: "string", enum: ["todo", "in_progress", "blocked", "done"] },
              priority: { type: "string", enum: ["low", "med", "high", "urgent"] },
              due_date: { type: "string", description: "yyyy-mm-dd" },
              subtasks: {
                type: "array",
                description: "Nested subtasks — same shape (title + optional subtasks).",
                items: { type: "object" },
              },
            },
            required: ["title"],
          },
        },
      },
      required: ["tasks"],
    },
  },
  {
    name: "update_task",
    description: "Update an existing task by its title. Set any of status, priority, due date or title.",
    input_schema: {
      type: "object",
      properties: {
        task_title: { type: "string", description: "Title (or close match) of the task to update" },
        set_status: { type: "string", enum: ["todo", "in_progress", "blocked", "done"] },
        set_priority: { type: "string", enum: ["low", "med", "high", "urgent"] },
        set_due_date: { type: "string", description: "yyyy-mm-dd, or empty string to clear" },
        set_title: { type: "string" },
      },
      required: ["task_title"],
    },
  },
  {
    name: "summarize_project",
    description: "Get a project's tasks and top knowledge snippets so you can summarise its status.",
    input_schema: {
      type: "object",
      properties: { project: { type: "string" } },
    },
  },
];

/* --------------------------------- helpers --------------------------------- */

function resolveProject(ctx: ToolContext, name?: string): ProjectRef | undefined {
  if (!name) {
    // No project named: default to the current one, else the current workspace's
    // first project, else anything accessible.
    return (
      ctx.projects.find((p) => p.id === ctx.currentProjectId) ??
      ctx.projects.find((p) => p.workspaceId === ctx.currentWorkspaceId) ??
      ctx.projects[0]
    );
  }
  const n = name.toLowerCase();
  return (
    ctx.projects.find((p) => p.name.toLowerCase() === n) ??
    ctx.projects.find((p) => p.name.toLowerCase().includes(n) || n.includes(p.name.toLowerCase()))
  );
}

type TaskDoc = Task & { memberIds?: string[] };

/** Every task the user can access, across ALL their workspaces. The
 *  `memberIds array-contains` query is the same isolation gate the client uses,
 *  so this only ever returns tasks the user is a member of. */
async function fetchAccessibleTasks(ctx: ToolContext): Promise<TaskDoc[]> {
  const snap = await adminDb().collection("tasks").where("memberIds", "array-contains", ctx.uid).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TaskDoc, "id">) }));
}

function isOverdue(t: Task): boolean {
  return !!t.dueDate && t.status !== "done" && t.dueDate < new Date().toISOString().slice(0, 10);
}
function isDueToday(t: Task): boolean {
  return t.dueDate === new Date().toISOString().slice(0, 10) && t.status !== "done";
}
/** The assignee name(s) on a task, tolerating the legacy single-assignee fields. */
function assigneeNames(t: TaskDoc): string[] {
  const names = [t.assigneeName, ...((t.assignees ?? []).map((a) => a.name))];
  return names.filter((n): n is string => !!n);
}

function compact(t: TaskDoc, projName?: string, parentTitle?: string | null, subtaskCount = 0) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    due: t.dueDate ?? null,
    project: projName ?? null,
    assignee: assigneeNames(t).join(", ") || null,
    parent: parentTitle ?? null, // null => a top-level task
    subtasks: subtaskCount, // number of direct children
  };
}

/* -------------------------------- executor -------------------------------- */

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  const projName = (id: string) => ctx.projects.find((p) => p.id === id)?.name;

  switch (name) {
    case "search_knowledge": {
      const query = String(input.query ?? "");
      const target = input.project ? resolveProject(ctx, String(input.project)) : undefined;
      const namespaces = target
        ? [target.ragNamespace]
        : ctx.projects.map((p) => p.ragNamespace);
      const result = await agenticRetrieve(namespaces, query);
      const chunks = result.chunks;
      ctx.sources.push(...chunks);
      ctx.steps.push(
        `retrieved ${chunks.length} chunk(s) in ${result.attempts} attempt(s), graded ${result.grade}`
      );
      if (chunks.length) ctx.cards.push({ kind: "sources", data: chunks });
      if (!chunks.length) return "No matching documents found in the knowledge base.";
      return JSON.stringify(
        chunks.map((c) => ({ source: c.source, project: c.project, score: c.score.toFixed(2), text: c.text.slice(0, 500) }))
      );
    }

    case "list_tasks": {
      const all = await fetchAccessibleTasks(ctx);
      const byId = new Map(all.map((t) => [t.id, t]));
      const childCount = new Map<string, number>();
      all.forEach((t) => {
        if (t.parentId) childCount.set(t.parentId, (childCount.get(t.parentId) ?? 0) + 1);
      });

      const target = input.project ? resolveProject(ctx, String(input.project)) : undefined;
      let rows = target ? all.filter((t) => t.projectId === target.id) : all;

      // "under": the subtasks of a specific parent task (matched by title).
      if (input.under) {
        const q = String(input.under).toLowerCase();
        const parent =
          rows.find((t) => t.title.toLowerCase() === q) ??
          rows.find((t) => t.title.toLowerCase().includes(q));
        if (!parent) return `No task found matching "${input.under}" to list subtasks of.`;
        rows = all.filter((t) => t.parentId === parent.id);
      }

      // "assignee": tasks assigned to a named person (fuzzy on assignee name).
      if (input.assignee) {
        const q = String(input.assignee).toLowerCase();
        rows = rows.filter((t) =>
          assigneeNames(t).some((n) => n.toLowerCase().includes(q) || q.includes(n.toLowerCase()))
        );
      }

      if (input.status) rows = rows.filter((t) => t.status === input.status);
      if (input.filter === "overdue") rows = rows.filter(isOverdue);
      if (input.filter === "due_today") rows = rows.filter(isDueToday);
      rows = rows.sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")).slice(0, 40);
      const data = rows.map((t) =>
        compact(t, projName(t.projectId), t.parentId ? byId.get(t.parentId)?.title ?? null : null, childCount.get(t.id) ?? 0)
      );
      ctx.cards.push({ kind: "task_list", data });
      return JSON.stringify({ count: rows.length, tasks: data });
    }

    case "create_task": {
      const target = resolveProject(ctx, input.project ? String(input.project) : undefined);
      if (!target) return "No project available to create the task in.";
      let parentId: string | null = null;
      if (input.parent_title) {
        const all = await fetchAccessibleTasks(ctx);
        const parent = all.find(
          (t) =>
            t.projectId === target.id &&
            t.title.toLowerCase().includes(String(input.parent_title).toLowerCase())
        );
        parentId = parent?.id ?? null;
      }
      const now = Date.now();
      const doc = {
        workspaceId: target.workspaceId,
        projectId: target.id,
        parentId,
        title: String(input.title),
        notes: "",
        status: (input.status as TaskStatus) ?? "todo",
        priority: (input.priority as TaskPriority) ?? "med",
        assignees: [{ id: ctx.uid, name: ctx.userName, avatar: null }],
        assigneeId: ctx.uid,
        assigneeName: ctx.userName,
        assigneeAvatar: null,
        dueDate: (input.due_date as string) || null,
        startDate: null,
        tags: [] as string[],
        dependencies: [] as string[],
        linkedDocs: [] as [],
        order: now,
        createdAt: now,
        updatedAt: now,
        createdBy: ctx.uid,
        memberIds: target.memberIds,
      };
      const ref = await adminDb().collection("tasks").add(doc);
      ctx.cards.push({ kind: "created_task", data: { id: ref.id, ...doc, project: target.name } });
      return `Created task "${doc.title}" in ${target.name}${doc.dueDate ? ` due ${doc.dueDate}` : ""}.`;
    }

    case "create_tasks": {
      const target = resolveProject(ctx, input.project ? String(input.project) : undefined);
      if (!target) return "No project available to create tasks in.";
      const roots = Array.isArray(input.tasks) ? (input.tasks as TaskNodeInput[]) : [];
      if (roots.length === 0) return "No tasks were provided to create.";

      const now = Date.now();
      let order = now;
      let count = 0;
      const summary: Array<Record<string, unknown>> = [];

      // Recursively create a node and its subtasks, threading the real parent id
      // so nesting is exact (no title matching, so identical subtask names across
      // many parents nest correctly).
      const createNode = async (node: TaskNodeInput, parentId: string | null, parentTitle: string | null) => {
        const title = String(node?.title ?? "").trim();
        if (!title) return;
        const doc = {
          workspaceId: target.workspaceId,
          projectId: target.id,
          parentId,
          title,
          notes: "",
          status: (node.status as TaskStatus) ?? "todo",
          priority: (node.priority as TaskPriority) ?? "med",
          assignees: [{ id: ctx.uid, name: ctx.userName, avatar: null }],
          assigneeId: ctx.uid,
          assigneeName: ctx.userName,
          assigneeAvatar: null,
          dueDate: (node.due_date as string) || null,
          startDate: null,
          tags: [] as string[],
          dependencies: [] as string[],
          linkedDocs: [] as [],
          order: order++,
          createdAt: now,
          updatedAt: now,
          createdBy: ctx.uid,
          memberIds: target.memberIds,
        };
        const ref = await adminDb().collection("tasks").add(doc);
        count++;
        summary.push({
          id: ref.id,
          title,
          status: doc.status,
          priority: doc.priority,
          due: doc.dueDate,
          project: target.name,
          parent: parentTitle,
        });
        const subs = Array.isArray(node.subtasks) ? node.subtasks : [];
        for (const s of subs) await createNode(s, ref.id, title);
      };

      for (const r of roots) await createNode(r, null, null);
      // One list card showing the whole tree that was created (parent shown as ↳).
      ctx.cards.push({ kind: "task_list", data: summary });
      return `Created ${count} task${count === 1 ? "" : "s"} (with their subtasks) in ${target.name}.`;
    }

    case "update_task": {
      const all = await fetchAccessibleTasks(ctx);
      const q = String(input.task_title ?? "").toLowerCase();
      const match =
        all.find((t) => t.title.toLowerCase() === q) ??
        all.find((t) => t.title.toLowerCase().includes(q));
      if (!match) return `No task found matching "${input.task_title}".`;
      const patch: Record<string, unknown> = { updatedAt: Date.now() };
      if (input.set_status) patch.status = input.set_status;
      if (input.set_priority) patch.priority = input.set_priority;
      if (input.set_title) patch.title = input.set_title;
      if (input.set_due_date !== undefined) patch.dueDate = input.set_due_date || null;
      await adminDb().collection("tasks").doc(match.id).update(patch);
      ctx.cards.push({ kind: "updated_task", data: { id: match.id, title: match.title, ...patch, project: projName(match.projectId) } });
      return `Updated "${match.title}".`;
    }

    case "summarize_project": {
      const target = resolveProject(ctx, input.project ? String(input.project) : undefined);
      if (!target) return "Project not found.";
      const all = await fetchAccessibleTasks(ctx);
      const tasks = all.filter((t) => t.projectId === target.id).map((t) => compact(t, target.name));
      let chunks: RetrievedChunk[] = [];
      try {
        chunks = await retrieveAndRerank([target.ragNamespace], `${target.name} overview status`, 4);
        ctx.sources.push(...chunks);
      } catch {
        /* knowledge base may be empty */
      }
      return JSON.stringify({
        project: target.name,
        tasks,
        knowledge: chunks.map((c) => ({ source: c.source, text: c.text.slice(0, 500) })),
      });
    }

    default:
      return `Unknown tool: ${name}`;
  }
}
