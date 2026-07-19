import {
  differenceInCalendarDays,
  format,
  isThisYear,
  isToday,
  isTomorrow,
  isYesterday,
  parseISO,
} from "date-fns";

/** yyyy-mm-dd for today, in local time. */
export function todayISO(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function toISODate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function parseDate(iso?: string | null): Date | null {
  if (!iso) return null;
  try {
    return parseISO(iso);
  } catch {
    return null;
  }
}

export type DueState = "none" | "overdue" | "today" | "soon" | "future";

export function dueState(iso?: string | null, status?: string): DueState {
  const d = parseDate(iso);
  if (!d) return "none";
  if (status === "done") return "future"; // completed tasks never read as overdue
  const days = differenceInCalendarDays(d, new Date());
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 2) return "soon";
  return "future";
}

/** Compact chip label: Today / Tomorrow / Mon 14 / 14 Mar. */
export function dueLabel(iso?: string | null): string {
  const d = parseDate(iso);
  if (!d) return "";
  if (isToday(d)) return "Today";
  if (isTomorrow(d)) return "Tomorrow";
  if (isYesterday(d)) return "Yesterday";
  return isThisYear(d) ? format(d, "d MMM") : format(d, "d MMM yy");
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return format(ts, "d MMM");
}

/** 3725 -> "1h 2m"; under a minute -> "0:SS" live clock style. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/** Live H:MM:SS for a running timer. */
export function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
