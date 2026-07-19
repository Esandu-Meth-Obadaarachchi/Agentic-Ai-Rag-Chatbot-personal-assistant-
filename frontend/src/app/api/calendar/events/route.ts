import { NextResponse } from "next/server";
import { requireUser } from "@/lib/firebase/admin";
import { getAccessToken, listRange } from "@/lib/google/calendar";
import { getConnection } from "@/lib/google/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only Google Calendar events for a date range, for display in the calendar
 * view. Events the app itself created (they carry sbTaskId) are excluded — those
 * already render as their tasks, so this returns only "external" Google events.
 */
export async function GET(req: Request) {
  let user;
  try {
    user = await requireUser(req);
  } catch (r) {
    return r instanceof Response ? r : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const timeMin = url.searchParams.get("timeMin");
  const timeMax = url.searchParams.get("timeMax");
  if (!timeMin || !timeMax) {
    return NextResponse.json({ error: "timeMin and timeMax required" }, { status: 400 });
  }

  try {
    const conn = await getConnection(user.uid);
    if (!conn) return NextResponse.json({ events: [] });
    const accessToken = await getAccessToken(conn.refreshToken);
    const raw = await listRange(accessToken, timeMin, timeMax);

    const events = raw
      .filter((e) => !e.extendedProperties?.private?.sbTaskId) // skip our own task events
      .map((e) => {
        const dt = e.start?.dateTime;
        const date = e.start?.date ?? dt?.slice(0, 10) ?? "";
        const time = dt ? dt.slice(11, 16) : null;
        return { id: e.id, title: e.summary || "(no title)", date, time, allDay: !dt };
      })
      .filter((e) => e.date);

    return NextResponse.json({ events });
  } catch (e) {
    console.error("calendar events error", e);
    return NextResponse.json({ events: [] });
  }
}
