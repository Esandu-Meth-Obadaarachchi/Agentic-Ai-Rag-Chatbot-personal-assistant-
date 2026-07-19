import { PRIORITY_ORDER } from "@/lib/constants";
import { dueState } from "@/lib/date";
import type { StandupDigest, Task } from "@/lib/types";

/** Morning digest: overdue, due today, blocked, and a suggested focus list. */
export function computeDigest(tasks: Task[]): StandupDigest {
  const open = tasks.filter((t) => t.status !== "done");

  const overdue = open.filter((t) => dueState(t.dueDate, t.status) === "overdue");
  const dueToday = open.filter((t) => dueState(t.dueDate, t.status) === "today");
  const blocked = tasks.filter((t) => t.status === "blocked");

  const alreadyListed = new Set([...overdue, ...dueToday, ...blocked].map((t) => t.id));
  const suggested = open
    .filter((t) => !alreadyListed.has(t.id))
    .sort((a, b) => {
      const pa = PRIORITY_ORDER.indexOf(a.priority);
      const pb = PRIORITY_ORDER.indexOf(b.priority);
      if (pa !== pb) return pa - pb;
      // then by nearest due date
      return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
    })
    .slice(0, 4);

  return { overdue, dueToday, blocked, suggested, generatedAt: Date.now() };
}
