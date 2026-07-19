"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Inbox as InboxIcon, LayoutGrid, Users } from "lucide-react";
import { ShareDialog } from "@/components/shell/ShareDialog";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { computeDigest } from "@/lib/data/standup";
import { STATUS_ORDER, statusMeta } from "@/lib/constants";
import { dueState } from "@/lib/date";
import type { Project, Task } from "@/lib/types";
import { DueDateChip } from "@/components/ui/DueDateChip";
import { PriorityDot } from "@/components/ui/PriorityIndicator";
import { Logo } from "@/components/ui/Logo";
import { cn } from "@/lib/utils";

export default function OverviewPage() {
  const { currentWorkspace, projects, workspaceTasks, selectProject } = useWorkspace();
  const router = useRouter();
  const [sharing, setSharing] = useState(false);

  const digest = useMemo(() => computeDigest(workspaceTasks), [workspaceTasks]);
  const open = workspaceTasks.filter((t) => t.status !== "done").length;
  const done = workspaceTasks.filter((t) => t.status === "done").length;

  const byProject = useMemo(() => {
    const map = new Map<string, Task[]>();
    workspaceTasks.forEach((t) => {
      const list = map.get(t.projectId) ?? [];
      list.push(t);
      map.set(t.projectId, list);
    });
    return map;
  }, [workspaceTasks]);

  const openProject = (id: string) => {
    selectProject(id);
    router.push("/");
  };
  const openTask = (t: Task) => {
    selectProject(t.projectId);
    router.push(`/?task=${t.id}`);
  };

  // Inbox first, then the rest.
  const ordered = [...projects].sort((a, b) => Number(!!b.isInbox) - Number(!!a.isInbox));

  if (!currentWorkspace) {
    return (
      <div className="grid h-full place-items-center">
        <Logo size={32} className="animate-pulse-dot" />
      </div>
    );
  }

  const attention = [...digest.overdue, ...digest.dueToday, ...digest.blocked];

  return (
    <div className="h-full overflow-y-auto">
      <header className="flex items-center gap-3 border-b border-border px-5 py-4">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-2 text-xl">
          {currentWorkspace.emoji}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-[17px] font-semibold tracking-tight">{currentWorkspace.name}</h1>
          <div className="text-xs text-text-muted">Workspace overview</div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="hidden items-center gap-1.5 sm:flex">
            <Stat label="open" value={open} />
            {digest.overdue.length > 0 && <Stat label="overdue" value={digest.overdue.length} tone="danger" />}
            <Stat label="done" value={done} />
          </div>
          <button
            onClick={() => setSharing(true)}
            className="ml-1 inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 text-2xs font-medium text-text-muted transition-colors hover:border-border-strong hover:text-text"
          >
            <Users className="h-3.5 w-3.5" /> Share
          </button>
        </div>
      </header>

      <ShareDialog workspace={currentWorkspace} open={sharing} onClose={() => setSharing(false)} />

      <div className="mx-auto max-w-5xl space-y-7 px-5 py-6">
        {/* status summary */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STATUS_ORDER.map((s) => {
            const meta = statusMeta(s);
            const count = workspaceTasks.filter((t) => t.status === s).length;
            return (
              <div key={s} className="card flex items-center gap-2.5 p-3">
                <span className={cn("h-2.5 w-2.5 rounded-full", meta.dot)} />
                <div>
                  <div className="mono text-lg font-semibold leading-none">{count}</div>
                  <div className="mt-0.5 text-2xs text-text-muted">{meta.label}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* projects */}
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-faint">
            <LayoutGrid className="h-3.5 w-3.5" /> Projects
          </h2>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {ordered.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                tasks={byProject.get(p.id) ?? []}
                onOpen={() => openProject(p.id)}
              />
            ))}
          </div>
        </section>

        {/* needs attention */}
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-faint">
            <AlertTriangle className="h-3.5 w-3.5" /> Needs attention
          </h2>
          {attention.length === 0 ? (
            <div className="card p-4 text-[13px] text-text-muted">
              Nothing overdue, due today or blocked across this workspace.
            </div>
          ) : (
            <div className="card divide-y divide-border/60 overflow-hidden">
              {attention.slice(0, 12).map((t) => (
                <button
                  key={t.id}
                  onClick={() => openTask(t)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-2"
                >
                  <PriorityDot priority={t.priority} />
                  <span className="flex-1 truncate text-[13px] text-text">{t.title}</span>
                  <span className="hidden shrink-0 text-2xs text-text-faint sm:inline">
                    {projects.find((p) => p.id === t.projectId)?.name}
                  </span>
                  {t.status === "blocked" ? (
                    <span className="rounded border border-blocked/25 bg-blocked/10 px-1.5 py-0.5 text-2xs text-blocked">
                      blocked
                    </span>
                  ) : (
                    <DueDateChip date={t.dueDate} time={t.dueTime} status={t.status} icon={false} />
                  )}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ProjectCard({ project, tasks, onOpen }: { project: Project; tasks: Task[]; onOpen: () => void }) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  const open = total - done;
  const overdue = tasks.filter((t) => t.status !== "done" && dueState(t.dueDate, t.status) === "overdue").length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <button
      onClick={onOpen}
      className="card lift p-3.5 text-left hover:border-border-strong hover:shadow-card"
    >
      <div className="flex items-center gap-2">
        {project.isInbox ? (
          <InboxIcon className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        ) : (
          <span className="h-3 w-3 shrink-0 rounded-[4px]" style={{ background: project.color }} />
        )}
        <span className="truncate text-[13.5px] font-medium text-text">{project.name}</span>
      </div>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
        <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-2 flex items-center gap-3 text-2xs text-text-muted">
        <span><b className="mono text-text">{open}</b> open</span>
        <span><b className="mono text-text">{done}</b> done</span>
        {overdue > 0 && (
          <span className="ml-auto flex items-center gap-1 text-danger">
            <CalendarClock className="h-3 w-3" /> {overdue} overdue
          </span>
        )}
      </div>
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-2xs text-text-muted",
        tone === "danger" && "border-danger/25 bg-danger/10 text-danger"
      )}
    >
      <span className="mono font-semibold text-text">{value}</span>
      {label}
    </span>
  );
}
