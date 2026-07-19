import { cn } from "@/lib/utils";

/** Compact "2/5" subtask progress with a thin bar — reused on cards + rows. */
export function SubtaskProgress({
  done,
  total,
  className,
}: {
  done: number;
  total: number;
  className?: string;
}) {
  if (total === 0) return null;
  const pct = Math.round((done / total) * 100);
  const complete = done === total;
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-2xs text-text-muted", className)}
      title={`${done} of ${total} subtasks done`}
    >
      <span className="relative h-1 w-8 overflow-hidden rounded-full bg-surface-3">
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-all",
            complete ? "bg-done" : "bg-accent"
          )}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="mono tabular-nums">
        {done}/{total}
      </span>
    </span>
  );
}
