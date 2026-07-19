import { adminDb } from "@/lib/firebase/admin";
import type { Task } from "@/lib/types";
import {
  createEvent,
  deleteEvent,
  getAccessToken,
  getCalendarTimeZone,
  listEvents,
  updateEvent,
} from "./calendar";
import { getConnection, getTask, saveConnection, type CalendarConnection } from "./store";

type TaskDoc = Task & { memberIds?: string[] };

async function patchTask(id: string, patch: Record<string, unknown>) {
  await adminDb().collection("tasks").doc(id).update({ ...patch, updatedAt: Date.now() });
}

/**
 * Resolve a timezone for timed events. Order: the cached connection value, then
 * the caller's (browser) timezone, then Google's primary-calendar default.
 * Without one, taskToEvent falls back to an all-day event — which silently
 * dropped the user's chosen time, so we try hard to always have one.
 */
async function ensureTimeZone(
  uid: string,
  conn: CalendarConnection,
  accessToken: string,
  clientTz?: string
): Promise<string | undefined> {
  if (conn.timeZone) return conn.timeZone;
  if (clientTz) {
    await saveConnection(uid, { timeZone: clientTz });
    return clientTz;
  }
  const tz = await getCalendarTimeZone(accessToken);
  if (tz) await saveConnection(uid, { timeZone: tz });
  return tz ?? undefined;
}

/** Push a single task's state to Google Calendar (create / update / delete). */
export async function pushTask(uid: string, taskId: string, clientTz?: string): Promise<{ status: string }> {
  const conn = await getConnection(uid);
  if (!conn) return { status: "not_connected" };

  const task = (await getTask(taskId)) as TaskDoc | null;
  if (!task) return { status: "no_task" };
  if (!task.memberIds?.includes(uid)) return { status: "forbidden" };

  const accessToken = await getAccessToken(conn.refreshToken);
  const tz = task.dueTime ? await ensureTimeZone(uid, conn, accessToken, clientTz) : undefined;

  if (task.dueDate) {
    if (task.googleEventId) {
      const ok = await updateEvent(accessToken, task.googleEventId, task, tz);
      if (!ok) {
        const id = await createEvent(accessToken, task, tz);
        await patchTask(task.id, { googleEventId: id });
      }
      return { status: "updated" };
    }
    const id = await createEvent(accessToken, task, tz);
    await patchTask(task.id, { googleEventId: id });
    return { status: "created" };
  }

  // No due date: remove any existing event.
  if (task.googleEventId) {
    await deleteEvent(accessToken, task.googleEventId);
    await patchTask(task.id, { googleEventId: null });
    return { status: "unscheduled" };
  }
  return { status: "noop" };
}

/** Delete an event directly (used when a task is deleted client-side). */
export async function deleteTaskEvent(uid: string, eventId: string) {
  const conn = await getConnection(uid);
  if (!conn) return;
  const accessToken = await getAccessToken(conn.refreshToken);
  await deleteEvent(accessToken, eventId);
}

/** Push every dated task to Google (used right after connecting, and by Sync now). */
export async function pushAllForUser(uid: string, clientTz?: string): Promise<{ status: string; pushed: number }> {
  const conn = await getConnection(uid);
  if (!conn) return { status: "not_connected", pushed: 0 };
  const accessToken = await getAccessToken(conn.refreshToken);
  const tz = await ensureTimeZone(uid, conn, accessToken, clientTz);

  const snap = await adminDb().collection("tasks").where("memberIds", "array-contains", uid).get();
  const tasks = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<TaskDoc, "id">) }))
    .filter((t) => t.dueDate)
    .slice(0, 300);

  let pushed = 0;
  for (const task of tasks) {
    if (task.googleEventId) {
      const ok = await updateEvent(accessToken, task.googleEventId, task, tz);
      if (!ok) {
        const id = await createEvent(accessToken, task, tz);
        await patchTask(task.id, { googleEventId: id });
      }
    } else {
      const id = await createEvent(accessToken, task, tz);
      await patchTask(task.id, { googleEventId: id });
    }
    pushed++;
  }
  return { status: "ok", pushed };
}

/** Pull changes from Google into tasks (incremental via syncToken). Only touches
 *  events we created (they carry sbTaskId), so arbitrary Google events are ignored. */
export async function pullForUser(uid: string): Promise<{ status: string; changed: number }> {
  const conn = await getConnection(uid);
  if (!conn) return { status: "not_connected", changed: 0 };
  const accessToken = await getAccessToken(conn.refreshToken);

  let { items, nextSyncToken, expired } = await listEvents(accessToken, conn.syncToken ?? undefined);
  if (expired) ({ items, nextSyncToken } = await listEvents(accessToken));

  let changed = 0;
  for (const ev of items) {
    const sbTaskId = ev.extendedProperties?.private?.sbTaskId;
    if (!sbTaskId) continue;
    const task = (await getTask(sbTaskId)) as TaskDoc | null;
    if (!task || !task.memberIds?.includes(uid)) continue;

    if (ev.status === "cancelled") {
      // Event deleted in Google -> unschedule the task.
      if (task.dueDate || task.googleEventId) {
        await patchTask(task.id, { dueDate: null, googleEventId: null });
        changed++;
      }
      continue;
    }

    const date = ev.start?.date ?? ev.start?.dateTime?.slice(0, 10);
    const time = ev.start?.dateTime ? ev.start.dateTime.slice(11, 16) : null;
    const endTime = ev.end?.dateTime ? ev.end.dateTime.slice(11, 16) : null;
    const patch: Record<string, unknown> = {};
    if (date && date !== task.dueDate) patch.dueDate = date;
    if (time !== (task.dueTime ?? null)) patch.dueTime = time;
    if (endTime !== (task.dueEndTime ?? null)) patch.dueEndTime = endTime;
    if (ev.summary && ev.summary !== task.title) patch.title = ev.summary;
    if (task.googleEventId !== ev.id) patch.googleEventId = ev.id;
    if (Object.keys(patch).length) {
      await patchTask(task.id, patch);
      changed++;
    }
  }

  if (nextSyncToken) await saveConnection(uid, { syncToken: nextSyncToken });
  return { status: "ok", changed };
}
