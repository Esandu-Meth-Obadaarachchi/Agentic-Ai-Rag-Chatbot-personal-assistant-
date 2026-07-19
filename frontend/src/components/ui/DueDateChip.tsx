import { CalendarClock } from "lucide-react";
import { dueLabel, dueState } from "@/lib/date";
import { cn } from "@/lib/utils";
import type { TaskStatus } from "@/lib/types";

/** Colour states per the brief: neutral / due-soon / overdue. */
const styles: Record<string, string> = {
  overdue: "text-danger bg-danger/10 border-danger/25",
  today: "text-warn bg-warn/10 border-warn/25",
  soon: "text-warn bg-warn/[0.07] border-warn/20",
  future: "text-text-muted bg-surface-2 border-border",
  none: "text-text-faint border-transparent",
};

export function DueDateChip({
  date,
  time,
  status,
  className,
  icon = true,
}: {
  date?: string | null;
  time?: string | null;
  status?: TaskStatus;
  className?: string;
  icon?: boolean;
}) {
  if (!date) return null;
  const state = dueState(date, status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs font-medium",
        styles[state],
        className
      )}
    >
      {icon && <CalendarClock className="h-3 w-3" strokeWidth={2} />}
      {dueLabel(date)}
      {time && <span className="mono opacity-90">{time}</span>}
    </span>
  );
}
