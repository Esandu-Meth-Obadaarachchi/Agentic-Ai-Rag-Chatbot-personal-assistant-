import { NextResponse } from "next/server";
import { requireUser } from "@/lib/firebase/admin";
import { isCalendarConfigured, webhookUrl } from "@/lib/google/calendar";
import { getConnection } from "@/lib/google/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  let user;
  try {
    user = await requireUser(req);
  } catch (r) {
    return r instanceof Response ? r : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const conn = await getConnection(user.uid);
  return NextResponse.json({
    configured: isCalendarConfigured(),
    connected: !!conn,
    liveSync: !!conn?.channelId,
    webhookConfigured: !!webhookUrl(),
  });
}
