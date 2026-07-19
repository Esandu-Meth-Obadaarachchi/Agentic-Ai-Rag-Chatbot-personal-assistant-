"use client";

import { useEffect, useState } from "react";
import { FolderPlus } from "lucide-react";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import type { Task } from "@/lib/types";
import { ProjectHeader, type ViewTab } from "@/components/project/ProjectHeader";
import { TreeView } from "@/components/views/TreeView";
import { KanbanBoard } from "@/components/views/KanbanBoard";
import { ListView } from "@/components/views/ListView";
import { CalendarView } from "@/components/views/CalendarView";
import { MindMapView } from "@/components/views/MindMapView";
import { MemberBoard } from "@/components/views/MemberBoard";
import { WhiteboardView } from "@/components/views/WhiteboardView";
import { ProjectPages } from "@/components/pages/ProjectPages";
import { TeamView } from "@/components/project/TeamView";
import { TaskDrawer } from "@/components/task/TaskDrawer";
import { RowSkeleton } from "@/components/ui/Skeleton";
import { Logo } from "@/components/ui/Logo";
import { cn } from "@/lib/utils";

export default function ProjectViewPage() {
  const { currentProject, tasks, tasksLoading, loading } = useWorkspace();
  const [tab, setTab] = useState<ViewTab>("tree");
  const [selected, setSelected] = useState<Task | null>(null);

  // Remember the last tab.
  useEffect(() => {
    const saved = localStorage.getItem("sb-tab") as ViewTab | null;
    if (saved) setTab(saved);
  }, []);
  const changeTab = (t: ViewTab) => {
    setTab(t);
    localStorage.setItem("sb-tab", t);
  };

  // Deep-link support: /?task=<id> opens that task's drawer once it loads
  // (used by the agent standup to jump to a task).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("task");
    if (!id) return;
    const found = tasks.find((t) => t.id === id);
    if (found) {
      setSelected(found);
      window.history.replaceState(null, "", "/");
    }
  }, [tasks]);

  if (loading) {
    return (
      <div className="grid h-full place-items-center">
        <Logo size={32} className="animate-pulse-dot" />
      </div>
    );
  }

  if (!currentProject) {
    return (
      <div className="grid h-full place-items-center px-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-surface-2 text-text-muted">
            <FolderPlus className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-medium text-text">No project selected</div>
            <div className="mt-1 text-xs text-text-muted">
              Create a project from the sidebar to start capturing tasks and
              knowledge for this workspace.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <ProjectHeader project={currentProject} tasks={tasks} tab={tab} onTab={changeTab} />

      <div className={cn("min-h-0 flex-1", tab === "map" || tab === "draw" ? "overflow-hidden" : "overflow-auto")}>
        {tasksLoading && tab !== "docs" && tab !== "team" ? (
          <div className="mx-auto max-w-4xl py-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <RowSkeleton key={i} i={i} />
            ))}
          </div>
        ) : tab === "tree" ? (
          <TreeView onOpenTask={setSelected} selectedId={selected?.id} />
        ) : tab === "board" ? (
          <KanbanBoard onOpenTask={setSelected} />
        ) : tab === "list" ? (
          <ListView onOpenTask={setSelected} />
        ) : tab === "calendar" ? (
          <CalendarView onOpenTask={setSelected} />
        ) : tab === "map" ? (
          <MindMapView onOpenTask={setSelected} />
        ) : tab === "members" ? (
          <MemberBoard onOpenTask={setSelected} />
        ) : tab === "docs" ? (
          <ProjectPages project={currentProject} />
        ) : tab === "team" ? (
          <TeamView project={currentProject} />
        ) : (
          <WhiteboardView />
        )}
      </div>

      {selected && <TaskDrawer task={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
