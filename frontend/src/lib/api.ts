import { auth } from "@/lib/firebase/client";

/** fetch() with the current user's Firebase ID token attached. */
export async function authedFetch(input: string, init: RequestInit = {}) {
  const token = await auth?.currentUser?.getIdToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

/** Fire-and-forget: push a task's state to Google Calendar. No-ops server-side
 *  if the user hasn't connected a calendar. Never blocks the UI. */
/** The browser's IANA timezone. Sent with calendar writes so a timed task can
 *  never silently degrade to an all-day event when the server can't resolve one. */
export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export function syncTaskToCalendar(taskId: string) {
  void authedFetch("/api/calendar/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId, tz: browserTimeZone() }),
  }).catch(() => {});
}

/** Fire-and-forget: delete a calendar event for a task being removed. */
export function deleteCalendarEvent(eventId: string) {
  void authedFetch("/api/calendar/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deleteEventId: eventId }),
  }).catch(() => {});
}

/** POST a JSON body with auth; returns parsed JSON or throws with the server message. */
export async function postJSON<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await authedFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res.json();
}
