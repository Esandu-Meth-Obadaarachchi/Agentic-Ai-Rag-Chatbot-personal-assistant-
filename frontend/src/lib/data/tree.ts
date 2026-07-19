import type { Task, TaskNode } from "@/lib/types";
import { taskAssignees } from "@/lib/utils";

export function slugifyNamespace(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Build the Project -> Task -> Subtask forest from a flat task list.
 * When `myUid` is given, tasks the current user is assigned to float to the top
 * of each sibling group so they are easy to spot in a big shared project.
 */
export function buildTree(tasks: Task[], myUid?: string): TaskNode[] {
  const byId = new Map<string, TaskNode>();
  tasks.forEach((t) => byId.set(t.id, { ...t, children: [], depth: 0 }));

  const roots: TaskNode[] = [];
  byId.forEach((node) => {
    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });

  const mine = (t: Task) => !!myUid && taskAssignees(t).some((a) => a.id === myUid);

  // Completed tasks sink to the bottom; among the rest, mine float to the top;
  // ties keep their manual order.
  const sortRec = (nodes: TaskNode[], depth: number) => {
    nodes.sort((a, b) => {
      const ad = a.status === "done" ? 1 : 0;
      const bd = b.status === "done" ? 1 : 0;
      if (ad !== bd) return ad - bd;
      const am = mine(a) ? 0 : 1;
      const bm = mine(b) ? 0 : 1;
      if (am !== bm) return am - bm;
      return a.order - b.order;
    });
    nodes.forEach((n) => {
      n.depth = depth;
      sortRec(n.children, depth + 1);
    });
  };
  sortRec(roots, 0);
  return roots;
}

/** Depth-first flatten, skipping the children of collapsed nodes. */
export function flattenVisible(roots: TaskNode[]): TaskNode[] {
  const out: TaskNode[] = [];
  const walk = (nodes: TaskNode[]) => {
    for (const n of nodes) {
      out.push(n);
      if (!n.collapsed && n.children.length) walk(n.children);
    }
  };
  walk(roots);
  return out;
}

/** id + every descendant id — used for cascade delete and move-guards. */
export function collectSubtreeIds(tasks: Task[], id: string): string[] {
  const childrenOf = new Map<string | null, Task[]>();
  tasks.forEach((t) => {
    const list = childrenOf.get(t.parentId) ?? [];
    list.push(t);
    childrenOf.set(t.parentId, list);
  });
  const ids: string[] = [];
  const walk = (cur: string) => {
    ids.push(cur);
    (childrenOf.get(cur) ?? []).forEach((c) => walk(c.id));
  };
  walk(id);
  return ids;
}

/** Direct-child progress for the "2/5" chip. */
export function childProgress(tasks: Task[], id: string): { done: number; total: number } {
  const children = tasks.filter((t) => t.parentId === id);
  return { done: children.filter((c) => c.status === "done").length, total: children.length };
}

/** Would moving `dragId` under `targetId` create a cycle? */
export function isDescendant(tasks: Task[], dragId: string, targetId: string): boolean {
  return collectSubtreeIds(tasks, dragId).includes(targetId);
}
