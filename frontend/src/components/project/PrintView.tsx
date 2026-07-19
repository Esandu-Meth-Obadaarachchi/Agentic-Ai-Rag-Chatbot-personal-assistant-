"use client";

import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import type { Project, Task, TaskNode } from "@/lib/types";
import { buildTree } from "@/lib/data/tree";
import { statusMeta } from "@/lib/constants";
import { dueLabel, formatDuration } from "@/lib/date";
import { taskSeconds } from "@/lib/export";
import { taskAssignees } from "@/lib/utils";

/**
 * Single-page, print-friendly render of a project + its full task tree.
 * Rendered as a white sheet overlay; global @media print rules (globals.css)
 * hide the app chrome so "Print / Save as PDF" produces a clean document.
 */
export function PrintView({
  project,
  tasks,
  onClose,
}: {
  project: Project;
  tasks: Task[];
  onClose: () => void;
}) {
  const roots = buildTree(tasks);
  const done = tasks.filter((t) => t.status === "done").length;
  const totalSecs = tasks.reduce((s, t) => s + taskSeconds(t), 0);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="print-root fixed inset-0 z-[300] overflow-y-auto bg-black/40">
      {/* toolbar (hidden when printing) */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-200 bg-white px-5 py-3 shadow-sm print:hidden">
        <span className="text-sm font-medium text-neutral-700">Export preview</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
          >
            <Printer className="h-4 w-4" /> Print / Save as PDF
          </button>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-neutral-500 hover:bg-neutral-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* the sheet */}
      <div className="mx-auto my-6 max-w-[820px] bg-white px-12 py-10 text-neutral-900 shadow-xl print:my-0 print:max-w-none print:shadow-none">
        <div className="flex items-start justify-between border-b border-neutral-200 pb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
            {project.description && (
              <p className="mt-1 text-sm text-neutral-500">{project.description}</p>
            )}
          </div>
          <div className="text-right text-xs text-neutral-400">
            <div>{new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}</div>
            <div className="mt-1">Lune AI</div>
          </div>
        </div>

        <div className="mt-3 flex gap-5 text-xs text-neutral-500">
          <span><b className="text-neutral-900">{tasks.length}</b> tasks</span>
          <span><b className="text-neutral-900">{done}</b> done</span>
          <span><b className="text-neutral-900">{tasks.length - done}</b> open</span>
          {totalSecs > 0 && <span><b className="text-neutral-900">{formatDuration(totalSecs)}</b> tracked</span>}
        </div>

        <div className="mt-6 space-y-1">
          {roots.map((n) => (
            <Row key={n.id} node={n} />
          ))}
          {tasks.length === 0 && <p className="text-sm text-neutral-400">No tasks.</p>}
        </div>
      </div>
    </div>,
    document.body
  );
}

function Row({ node }: { node: TaskNode }) {
  const meta = statusMeta(node.status);
  const secs = taskSeconds(node);
  return (
    <div style={{ breakInside: "avoid" }}>
      <div
        className="flex items-baseline gap-2 border-b border-neutral-100 py-1.5"
        style={{ paddingLeft: node.depth * 22 }}
      >
        <span
          className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ background: statusColor(node.status) }}
          title={meta.label}
        />
        <span className={node.status === "done" ? "text-neutral-400 line-through" : "font-medium"}>
          {node.title}
        </span>
        <span className="ml-auto flex shrink-0 items-baseline gap-3 text-xs text-neutral-400">
          {node.tags.length > 0 && <span>{node.tags.map((t) => `#${t}`).join(" ")}</span>}
          {secs > 0 && <span>{formatDuration(secs)}</span>}
          {node.dueDate && <span>{dueLabel(node.dueDate)}</span>}
          {taskAssignees(node).length > 0 && (
            <span>{taskAssignees(node).map((a) => a.name).join(", ")}</span>
          )}
          <span className="uppercase tracking-wide">{meta.label}</span>
        </span>
      </div>
      {node.children.map((c) => (
        <Row key={c.id} node={c} />
      ))}
    </div>
  );
}

function statusColor(s: Task["status"]): string {
  const map: Record<string, string> = {
    todo: "#9aa0ab",
    in_progress: "#2563eb",
    blocked: "#dc2626",
    done: "#16a34a",
  };
  return map[s] ?? "#6b7280";
}
