import { NextResponse } from "next/server";
import { requireUser } from "@/lib/firebase/admin";
import { getAccessToken, stopChannel } from "@/lib/google/calendar";
import { deleteConnection, getConnection } from "@/lib/google/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser(req);
  } catch (r) {
    return r instanceof Response ? r : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const conn = await getConnection(user.uid);
  if (conn?.channelId && conn.resourceId) {
    try {
      const at = await getAccessToken(conn.refreshToken);
      await stopChannel(at, conn.channelId, conn.resourceId);
    } catch {
      /* channel may already be gone */
    }
  }
  await deleteConnection(user.uid);
  return NextResponse.json({ ok: true });
}
