import { priorityMeta } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { TaskPriority } from "@/lib/types";

const barColor: Record<TaskPriority, string> = {
  low: "bg-text-faint",
  med: "bg-info",
  high: "bg-warn",
  urgent: "bg-danger",
};

/** Subtle 4-bar priority indicator (spec: "subtle dot or bar, 4 levels"). */
export function PriorityIndicator({
  priority,
  className,
}: {
  priority: TaskPriority;
  className?: string;
}) {
  const meta = priorityMeta(priority);
  return (
    <span
      className={cn("inline-flex items-end gap-[2px]", className)}
      title={`${meta.label} priority`}
      aria-label={`${meta.label} priority`}
    >
      {[1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={cn(
            "w-[3px] rounded-full transition-colors",
            i <= meta.level ? barColor[priority] : "bg-border-strong"
          )}
          style={{ height: 4 + i * 2 }}
        />
      ))}
    </span>
  );
}

/** Single dot variant for dense rows. */
export function PriorityDot({ priority }: { priority: TaskPriority }) {
  const meta = priorityMeta(priority);
  return (
    <span
      className={cn("inline-block h-2 w-2 rounded-full", barColor[priority])}
      title={`${meta.label} priority`}
    />
  );
}
