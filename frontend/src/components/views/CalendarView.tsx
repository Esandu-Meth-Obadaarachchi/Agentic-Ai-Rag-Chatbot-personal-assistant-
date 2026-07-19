"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { useTaskActions } from "@/lib/data/useTaskActions";
import { authedFetch } from "@/lib/api";
import { toISODate } from "@/lib/date";
import type { Project, Task } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { CalendarSync } from "@/components/project/CalendarSync";
import { DayDetail } from "./DayDetail";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface GEvent {
  id: string;
  title: string;
  time: string | null;
  allDay: boolean;
}

export function CalendarView({
  onOpenTask,
  tasks: tasksProp,
  projects: projectsProp,
}: {
  onOpenTask: (t: Task) => void;
  /** Cross-project task set (My Tasks). Defaults to the current workspace's tasks. */
  tasks?: Task[];
  /** Projects used for colour/name lookup (pass all projects for the cross-project view). */
  projects?: Project[];
}) {
  const ctx = useWorkspace();
  const tasks = tasksProp ?? ctx.workspaceTasks;
  const projects = projectsProp ?? ctx.projects;
  const actions = useTaskActions();
  const [month, setMonth] = useState(() => new Date());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const projColor = useMemo(() => new Map(projects.map((p) => [p.id, p.color])), [projects]);
  const projName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [month]);

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    tasks.forEach((t) => {
      if (!t.dueDate) return;
      const list = map.get(t.dueDate) ?? [];
      list.push(t);
      map.set(t.dueDate, list);
    });
    return map;
  }, [tasks]);

  // Read-only overlay of the user's real Google Calendar events for the visible range.
  const [gEvents, setGEvents] = useState<Record<string, GEvent[]>>({});
  useEffect(() => {
    if (days.length === 0) return;
    const min = days[0];
    const max = new Date(days[days.length - 1]);
    max.setDate(max.getDate() + 1);
    let cancelled = false;
    authedFetch(
      `/api/calendar/events?timeMin=${encodeURIComponent(min.toISOString())}&timeMax=${encodeURIComponent(max.toISOString())}`
    )
      .then((r) => r.json())
      .then(({ events }: { events?: (GEvent & { date: string })[] }) => {
        if (cancelled) return;
        const map: Record<string, GEvent[]> = {};
        (events ?? []).forEach((e) => {
          (map[e.date] ??= []).push(e);
        });
        setGEvents(map);
      })
      .catch(() => !cancelled && setGEvents({}));
    return () => {
      cancelled = true;
    };
  }, [days]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const active = activeId ? tasks.find((t) => t.id === activeId) : null;

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const iso = e.over?.id ? String(e.over.id) : null;
    if (iso && active && active.dueDate !== iso) actions.setDue(active.id, iso);
  };

  return (
    <div className="flex h-full flex-col px-4 py-4">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight">{format(month, "MMMM yyyy")}</h2>
        <div className="flex items-center gap-0.5">
          <Button size="icon-sm" variant="ghost" onClick={() => setMonth((m) => addMonths(m, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => setMonth((m) => addMonths(m, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button size="sm" variant="subtle" onClick={() => setMonth(new Date())}>
          Today
        </Button>
        <div className="ml-auto">
          <CalendarSync />
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-border pb-1.5">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 text-2xs font-medium uppercase tracking-wide text-text-faint">
            {d}
          </div>
        ))}
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragEnd={onDragEnd}
      >
        <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7">
          {days.map((day) => (
            <DayCell
              key={day.toISOString()}
              day={day}
              month={month}
              tasks={byDay.get(toISODate(day)) ?? []}
              events={gEvents[toISODate(day)] ?? []}
              projColor={projColor}
              onOpenTask={onOpenTask}
              onSelectDay={setSelectedDay}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {active ? <Chip task={active} color={projColor.get(active.projectId)} overlay /> : null}
        </DragOverlay>
      </DndContext>

      {selectedDay && (
        <DayDetail
          iso={selectedDay}
          tasks={byDay.get(selectedDay) ?? []}
          events={gEvents[selectedDay] ?? []}
          projColor={projColor}
          projName={projName}
          onOpenTask={onOpenTask}
          onSetStatus={(id, s) => actions.setStatus(id, s)}
          onAdd={(title) => actions.add(title, { dueDate: selectedDay })}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </div>
  );
}

function DayCell({
  day,
  month,
  tasks,
  events,
  projColor,
  onOpenTask,
  onSelectDay,
}: {
  day: Date;
  month: Date;
  tasks: Task[];
  events: GEvent[];
  projColor: Map<string, string>;
  onOpenTask: (t: Task) => void;
  onSelectDay: (iso: string) => void;
}) {
  const iso = toISODate(day);
  const { setNodeRef, isOver } = useDroppable({ id: iso });
  const outside = !isSameMonth(day, month);
  const today = isToday(day);

  const shownTasks = tasks.slice(0, 3);
  const shownEvents = events.slice(0, 2);
  const more = tasks.length - shownTasks.length + (events.length - shownEvents.length);

  return (
    <div
      ref={setNodeRef}
      onClick={() => onSelectDay(iso)}
      className={cn(
        "flex min-h-[92px] cursor-pointer flex-col gap-1 border-b border-r border-border/60 p-1.5 transition-colors hover:bg-surface/50",
        outside && "bg-surface/30",
        isOver && "bg-accent/[0.06] ring-1 ring-inset ring-accent/30"
      )}
    >
      <div
        className={cn(
          "grid h-5 w-5 place-items-center rounded-full text-2xs",
          today ? "bg-accent font-semibold text-accent-fg" : outside ? "text-text-faint" : "text-text-muted"
        )}
      >
        {format(day, "d")}
      </div>
      <div className="space-y-1 overflow-hidden">
        {shownTasks.map((t) => (
          <Chip key={t.id} task={t} color={projColor.get(t.projectId)} onOpen={() => onOpenTask(t)} />
        ))}
        {shownEvents.map((e) => (
          <GChip key={e.id} event={e} />
        ))}
        {more > 0 && <div className="px-1 text-2xs text-text-faint">+{more} more</div>}
      </div>
    </div>
  );
}

/** Read-only Google Calendar event chip (not a task). */
function GChip({ event }: { event: GEvent }) {
  return (
    <div
      className="flex items-center gap-1 rounded border border-info/25 bg-info/[0.08] px-1.5 py-0.5 text-2xs text-info"
      title={`${event.title} (Google Calendar)`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-info" />
      {event.time && <span className="mono shrink-0 opacity-80">{event.time}</span>}
      <span className="truncate">{event.title}</span>
    </div>
  );
}

function Chip({
  task,
  color,
  onOpen,
  overlay,
}: {
  task: Task;
  color?: string;
  onOpen?: () => void;
  overlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
      onClick={(e) => {
        e.stopPropagation();
        onOpen?.();
      }}
      title={task.title}
      className={cn(
        "flex cursor-pointer items-center gap-1 rounded border border-border bg-surface px-1.5 py-0.5 text-2xs text-text",
        overlay ? "shadow-pop" : "hover:border-border-strong",
        isDragging && "opacity-40",
        task.status === "done" && "text-text-faint line-through"
      )}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: color ?? "rgb(var(--text-faint))" }}
      />
      {task.dueTime && <span className="mono shrink-0 opacity-70">{task.dueTime}</span>}
      <span className="truncate">{task.title}</span>
    </div>
  );
}
