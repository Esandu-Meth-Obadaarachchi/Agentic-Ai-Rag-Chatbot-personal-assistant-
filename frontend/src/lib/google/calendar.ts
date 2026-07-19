/**
 * Google Calendar helpers (server only). Raw fetch against Google's OAuth +
 * Calendar v3 REST — no googleapis dependency. Tasks map to all-day events on
 * their due date; the task id is stored in the event's private extended
 * properties so the reverse sync can find its task.
 */
import type { Task } from "@/lib/types";

const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const CAL = "https://www.googleapis.com/calendar/v3";

export function oauthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI || "http://localhost:3000/api/calendar/callback";
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth is not configured (GOOGLE_OAUTH_CLIENT_ID / _SECRET).");
  }
  return { clientId, clientSecret, redirectUri };
}

export function isCalendarConfigured() {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

export function webhookUrl(): string | null {
  return process.env.CALENDAR_WEBHOOK_URL || null;
}

export function authUrl(state: string): string {
  const { clientId, redirectUri } = oauthConfig();
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function exchangeCode(code: string) {
  const { clientId, clientSecret, redirectUri } = oauthConfig();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  return (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
}

export async function getAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = oauthConfig();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function calFetch(accessToken: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${CAL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...init.headers },
  });
  return res;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Event body for a task. Timed (start.dateTime + timeZone) when the task has a
 *  dueTime, otherwise an all-day event (end.date is exclusive, +1 day). */
export function taskToEvent(task: Task, timeZone?: string) {
  const base = {
    summary: task.title,
    description: task.notes || "",
    extendedProperties: { private: { sbTaskId: task.id } },
  };

  if (task.dueTime && timeZone) {
    const nextDay = (iso: string) => {
      const d = new Date(`${iso}T00:00:00`);
      d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    };
    const toMins = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    };
    const fromMins = (mins: number) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;

    const startMins = toMins(task.dueTime);
    // Explicit end time wins; if it's not after the start it's treated as
    // spilling into the next day. Otherwise default to a one-hour block.
    const rawEnd = task.dueEndTime ? toMins(task.dueEndTime) : startMins + 60;
    const endMins = rawEnd > startMins ? rawEnd : rawEnd + 24 * 60;
    const endDate = endMins >= 24 * 60 ? nextDay(task.dueDate as string) : (task.dueDate as string);

    // `date: null` is required: when an event was first created all-day and is
    // now getting a time, a PATCH that only sets dateTime leaves the old
    // start.date/end.date in place, so Google keeps it all-day (or 400s on the
    // date+dateTime clash). Explicitly clearing date converts it to timed.
    return {
      ...base,
      start: { dateTime: `${task.dueDate}T${fromMins(startMins)}:00`, timeZone, date: null },
      end: { dateTime: `${endDate}T${fromMins(endMins)}:00`, timeZone, date: null },
    };
  }

  const end = new Date(`${task.dueDate}T00:00:00`);
  end.setDate(end.getDate() + 1);
  // Symmetrically clear dateTime/timeZone so a timed -> all-day change sticks.
  return {
    ...base,
    start: { date: task.dueDate, dateTime: null, timeZone: null },
    end: { date: end.toISOString().slice(0, 10), dateTime: null, timeZone: null },
  };
}

/** The primary calendar's timezone (needed for timed events). */
export async function getCalendarTimeZone(accessToken: string): Promise<string | null> {
  const res = await calFetch(accessToken, `/calendars/primary`);
  if (!res.ok) return null;
  return ((await res.json()) as { timeZone?: string }).timeZone ?? null;
}

export async function createEvent(accessToken: string, task: Task, timeZone?: string): Promise<string> {
  const res = await calFetch(accessToken, `/calendars/primary/events`, {
    method: "POST",
    body: JSON.stringify(taskToEvent(task, timeZone)),
  });
  if (!res.ok) throw new Error(`createEvent failed: ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

export async function updateEvent(accessToken: string, eventId: string, task: Task, timeZone?: string) {
  const res = await calFetch(accessToken, `/calendars/primary/events/${eventId}`, {
    method: "PATCH",
    body: JSON.stringify(taskToEvent(task, timeZone)),
  });
  // 404/410 => event was deleted in Google; caller should recreate
  if (res.status === 404 || res.status === 410) return false;
  if (!res.ok) throw new Error(`updateEvent failed: ${await res.text()}`);
  return true;
}

export async function deleteEvent(accessToken: string, eventId: string) {
  const res = await calFetch(accessToken, `/calendars/primary/events/${eventId}`, { method: "DELETE" });
  return res.ok || res.status === 404 || res.status === 410;
}

export interface CalEvent {
  id: string;
  status?: string;
  summary?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  extendedProperties?: { private?: { sbTaskId?: string } };
}

/** Incremental (or initial) sync of primary calendar events. */
export async function listEvents(
  accessToken: string,
  syncToken?: string
): Promise<{ items: CalEvent[]; nextSyncToken?: string; expired?: boolean }> {
  const items: CalEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  do {
    const p = new URLSearchParams();
    if (syncToken) p.set("syncToken", syncToken);
    else p.set("timeMin", new Date(Date.now() - 30 * 864e5).toISOString());
    if (pageToken) p.set("pageToken", pageToken);
    p.set("showDeleted", "true");
    p.set("maxResults", "250");
    const res = await calFetch(accessToken, `/calendars/primary/events?${p}`);
    if (res.status === 410) return { items: [], expired: true }; // syncToken invalid -> full resync
    if (!res.ok) throw new Error(`listEvents failed: ${await res.text()}`);
    const j = (await res.json()) as { items?: CalEvent[]; nextPageToken?: string; nextSyncToken?: string };
    items.push(...(j.items ?? []));
    pageToken = j.nextPageToken;
    nextSyncToken = j.nextSyncToken;
  } while (pageToken);
  return { items, nextSyncToken };
}

/** Fetch events in a date range for read-only display (expands recurring events). */
export async function listRange(
  accessToken: string,
  timeMin: string,
  timeMax: string
): Promise<CalEvent[]> {
  const items: CalEvent[] = [];
  let pageToken: string | undefined;
  do {
    const p = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      timeMin,
      timeMax,
      maxResults: "250",
    });
    if (pageToken) p.set("pageToken", pageToken);
    const res = await calFetch(accessToken, `/calendars/primary/events?${p}`);
    if (!res.ok) throw new Error(`listRange failed: ${await res.text()}`);
    const j = (await res.json()) as { items?: CalEvent[]; nextPageToken?: string };
    items.push(...(j.items ?? []).filter((e) => e.status !== "cancelled"));
    pageToken = j.nextPageToken;
  } while (pageToken);
  return items;
}

export async function watchCalendar(accessToken: string, channelId: string, address: string, token: string) {
  const res = await calFetch(accessToken, `/calendars/primary/events/watch`, {
    method: "POST",
    body: JSON.stringify({ id: channelId, type: "web_hook", address, token }),
  });
  if (!res.ok) throw new Error(`watch failed: ${await res.text()}`);
  return (await res.json()) as { resourceId: string; expiration?: string };
}

export async function stopChannel(accessToken: string, channelId: string, resourceId: string) {
  await calFetch(accessToken, `/channels/stop`, {
    method: "POST",
    body: JSON.stringify({ id: channelId, resourceId }),
  }).catch(() => {});
}
