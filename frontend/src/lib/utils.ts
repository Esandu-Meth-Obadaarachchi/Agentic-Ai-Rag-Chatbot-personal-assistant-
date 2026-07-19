import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Assignee, Task } from "./types";

/** Merge conditional class names and de-dupe conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** All assignees on a task, reading the new array and falling back to the
 *  legacy single-assignee fields for tasks written before multi-assignee. */
export function taskAssignees(t: Pick<Task, "assignees" | "assigneeId" | "assigneeName" | "assigneeAvatar">): Assignee[] {
  if (t.assignees?.length) return t.assignees;
  if (t.assigneeId) return [{ id: t.assigneeId, name: t.assigneeName ?? "", avatar: t.assigneeAvatar }];
  return [];
}

/** Deterministic initials for an avatar fallback. */
export function initials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/** Stable hue from a string — used to colour avatars and tag chips consistently. */
export function hueFrom(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

/** Short, human id for display (mono) — e.g. `t·4f9a`. */
export function shortId(id: string): string {
  return id.replace(/[^a-z0-9]/gi, "").slice(-4).toLowerCase();
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
