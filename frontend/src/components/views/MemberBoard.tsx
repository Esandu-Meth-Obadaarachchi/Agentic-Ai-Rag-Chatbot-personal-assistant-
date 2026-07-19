"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { useTaskActions } from "@/lib/data/useTaskActions";
import type { Task, WorkspaceMember } from "@/lib/types";
import { TaskCard } from "@/components/task/TaskCard";
import { Avatar, AvatarEmpty } from "@/components/ui/Avatar";
import { cn } from "@/lib/utils";

const UNASSIGNED = "unassigned";
type Columns = Record<string, string[]>;

const boardCollision: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  if (pointer.length) return pointer;
  const rect = rectIntersection(args);
  if (rect.length) return rect;
  return closestCorners(args);
};

/**
 * Kanban grouped by person: one column per project member plus Unassigned, so
 * anyone can see each person's tasks and how many they have. Dragging a card to a
 * different column reassigns the task to that member (or clears it in Unassigned).
 */
export function MemberBoard({ onOpenTask }: { onOpenTask: (t: Task) => void }) {
  const { tasks, currentProject, currentWorkspace } = useWorkspace();
  const actions = useTaskActions();
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  // Members who can access this project, then an Unassigned bucket.
  const members: WorkspaceMember[] = useMemo(() => {
    const all = currentWorkspace?.members ?? [];
    return all.filter((m) => !currentProject?.memberIds || currentProject.memberIds.includes(m.uid));
  }, [currentWorkspace, currentProject]);
  const memberById = useMemo(() => new Map(members.map((m) => [m.uid, m])), [members]);
  const columnIds = useMemo(() => [...members.map((m) => m.uid), UNASSIGNED], [members]);
  const columnsKey = columnIds.join(",");

  // Group top-level tasks by assignee; an assignee no longer on the project falls
  // into Unassigned so nothing is hidden.
  const derived = useMemo<Columns>(() => {
    const cols: Columns = {};
    columnIds.forEach((id) => (cols[id] = []));
    tasks
      .filter((t) => !t.parentId)
      .sort((a, b) => a.order - b.order)
      .forEach((t) => {
        const uid = t.assigneeId && cols[t.assigneeId] ? t.assigneeId : UNASSIGNED;
        cols[uid].push(t.id);
      });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, columnsKey]);

  const [cols, setCols] = useState<Columns>(derived);
  const [activeId, setActiveId] = useState<string | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    if (!dragging.current) setCols(derived);
  }, [derived]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const colOf = (id: string, source: Columns = cols): string | null => {
    if (id.startsWith("col:")) return id.slice(4);
    return columnIds.find((c) => source[c]?.includes(id)) ?? null;
  };

  const onDragStart = (e: DragStartEvent) => {
    dragging.current = true;
    setActiveId(String(e.active.id));
  };

  const onDragOver = (e: DragOverEvent) => {
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId) return;
    const activeIdStr = String(e.active.id);
    setCols((prev) => {
      const from = colOf(activeIdStr, prev);
      const to = colOf(overId, prev);
      if (!from || !to || from === to) return prev;
      const next = { ...prev, [from]: [...prev[from]], [to]: [...prev[to]] };
      next[from] = next[from].filter((id) => id !== activeIdStr);
      const overIdx = next[to].indexOf(overId);
      next[to].splice(overIdx >= 0 ? overIdx : next[to].length, 0, activeIdStr);
      return next;
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const activeIdStr = String(e.active.id);
    const overId = e.over?.id ? String(e.over.id) : null;
    dragging.current = false;
    setActiveId(null);
    if (!overId) {
      setCols(derived);
      return;
    }
    const to = colOf(overId);
    const from = colOf(activeIdStr, derived);
    const task = byId.get(activeIdStr);
    if (!to || !task || from === to) {
      setCols(derived);
      return;
    }
    // Persist the reassignment; the optimistic move already happened in onDragOver.
    const m = to === UNASSIGNED ? null : memberById.get(to);
    Promise.resolve(
      actions.setAssignees(task.id, m ? [{ id: m.uid, name: m.name, avatar: m.photoURL }] : [])
    ).catch(() => setCols(derived));
  };

  const onDragCancel = () => {
    dragging.current = false;
    setActiveId(null);
    setCols(derived);
  };

  const active = activeId ? byId.get(activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={boardCollision}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="flex h-full gap-3 overflow-x-auto px-4 py-4">
        {members.map((m) => (
          <Column
            key={m.uid}
            member={m}
            ids={cols[m.uid] ?? []}
            byId={byId}
            onOpenTask={onOpenTask}
          />
        ))}
        <Column member={null} ids={cols[UNASSIGNED] ?? []} byId={byId} onOpenTask={onOpenTask} />
      </div>
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div className="w-[272px]">
            <TaskCard task={active} dragging />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  member,
  ids,
  byId,
  onOpenTask,
}: {
  member: WorkspaceMember | null;
  ids: string[];
  byId: Map<string, Task>;
  onOpenTask: (t: Task) => void;
}) {
  const colId = member?.uid ?? UNASSIGNED;
  const { setNodeRef, isOver } = useDroppable({ id: `col:${colId}` });

  return (
    <div ref={setNodeRef} className="flex w-[288px] shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        {member ? (
          <Avatar name={member.name} src={member.photoURL} size={20} />
        ) : (
          <AvatarEmpty size={20} />
        )}
        <span className="truncate text-[13px] font-medium text-text">
          {member?.name ?? "Unassigned"}
        </span>
        <span className="mono text-2xs text-text-faint">{ids.length}</span>
        {member?.role && (
          <span className="ml-auto rounded border border-border bg-surface-2 px-1.5 py-0.5 text-2xs capitalize text-text-muted">
            {member.role}
          </span>
        )}
      </div>
      <div
        className={cn(
          "min-h-[120px] flex-1 space-y-2 rounded-lg border border-transparent p-1.5 transition-colors",
          isOver && "border-accent/25 bg-accent/[0.04]"
        )}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {ids.map((id) => {
            const t = byId.get(id);
            return t ? <SortableCard key={id} task={t} onOpen={() => onOpenTask(t)} /> : null;
          })}
        </SortableContext>
        {ids.length === 0 && (
          <div className="grid place-items-center rounded-lg border border-dashed border-border/60 py-6 text-2xs text-text-faint">
            Drop tasks here
          </div>
        )}
      </div>
    </div>
  );
}

function SortableCard({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
    >
      <TaskCard task={task} onOpen={onOpen} />
    </div>
  );
}
