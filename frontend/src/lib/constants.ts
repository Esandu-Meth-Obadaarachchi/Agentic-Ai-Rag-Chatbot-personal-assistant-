import type { CustomStatus, Project, TaskPriority, TaskStatus } from "./types";

export interface StatusMeta {
  id: TaskStatus;
  label: string;
  /** Tailwind text colour token (built-ins only) */
  color: string;
  /** Tailwind bg token for column headers / dots (built-ins only) */
  dot: string;
  /** Raw hex for custom statuses (built-ins use tokens instead). */
  hex?: string;
  /** True for project-defined statuses (deletable, hex-coloured). */
  custom?: boolean;
}

/** The four built-in statuses. Always present, never editable or removable. */
export const STATUSES: StatusMeta[] = [
  { id: "todo", label: "To Do", color: "text-todo", dot: "bg-todo" },
  { id: "in_progress", label: "In Progress", color: "text-progress", dot: "bg-progress" },
  { id: "blocked", label: "Blocked", color: "text-blocked", dot: "bg-blocked" },
  { id: "done", label: "Done", color: "text-done", dot: "bg-done" },
];

export const STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];
export const BASE_STATUS_IDS = new Set(STATUS_ORDER);

/** Palette offered when creating a custom status. */
export const STATUS_COLORS = ["#22d3ee", "#a78bfa", "#fb923c", "#f472b6", "#4ade80", "#f5c518", "#60a5fa", "#f87171"];

/** Title-case a status id for display when no meta is found ("to-be-reviewed" -> "To Be Reviewed"). */
function prettify(id: string): string {
  return id.replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

/** Turn a label into a stable, collision-free status id within a project. */
export function slugStatus(label: string, existing: CustomStatus[] = []): string {
  const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "status";
  const taken = new Set([...STATUS_ORDER, ...existing.map((c) => c.id)]);
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/** The full ordered status list for a project: the four built-ins plus its custom ones. */
export function projectStatuses(project?: Pick<Project, "customStatuses"> | null): StatusMeta[] {
  const custom = (project?.customStatuses ?? []).map(
    (c): StatusMeta => ({ id: c.id, label: c.label, color: "", dot: "", hex: c.color, custom: true })
  );
  return [...STATUSES, ...custom];
}

/** Resolve a status id to its display meta. Falls back to a prettified custom
 *  chip so an unknown id (e.g. a task from another project) still renders. */
export function statusMeta(id: TaskStatus, list: StatusMeta[] = STATUSES): StatusMeta {
  return (
    list.find((s) => s.id === id) ?? {
      id,
      label: prettify(String(id)),
      color: "",
      dot: "",
      hex: "#8b8b8b",
      custom: true,
    }
  );
}

export interface PriorityMeta {
  id: TaskPriority;
  label: string;
  /** number of filled bars (1-4) for the indicator */
  level: number;
  color: string;
}

export const PRIORITIES: PriorityMeta[] = [
  { id: "low", label: "Low", level: 1, color: "text-text-faint" },
  { id: "med", label: "Medium", level: 2, color: "text-info" },
  { id: "high", label: "High", level: 3, color: "text-warn" },
  { id: "urgent", label: "Urgent", level: 4, color: "text-danger" },
];

export const PRIORITY_ORDER: TaskPriority[] = ["urgent", "high", "med", "low"];

export function priorityMeta(id: TaskPriority): PriorityMeta {
  return PRIORITIES.find((p) => p.id === id) ?? PRIORITIES[0];
}

/** Palette projects and workspaces rotate through. */
export const PROJECT_COLORS = [
  "#f5c518",
  "#60a5fa",
  "#4ade80",
  "#f472b6",
  "#a78bfa",
  "#fb923c",
  "#22d3ee",
  "#f87171",
];

export const WORKSPACE_EMOJIS = ["🏢", "💼", "🚀", "🌿", "🎓", "🏨", "⚡", "🧠"];

/** Max characters for a single agent chat message. Caps input tokens and cost;
 *  enforced on the composer and again server-side in /api/chat. */
export const MAX_CHAT_INPUT_CHARS = 2000;

/** Preset roles for the project Team tab. Free text is still allowed on top. */
export const PROJECT_ROLES = [
  "Full stack",
  "Frontend",
  "Backend",
  "DevOps",
  "Mobile",
  "ML / AI",
  "Data",
  "QA",
  "Design",
  "PM",
];

/** Max characters of a brief the AI will turn into tasks. Caps input cost. */
export const MAX_BRIEF_CHARS = 12000;
