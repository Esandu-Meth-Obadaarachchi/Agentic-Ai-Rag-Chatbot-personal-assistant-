import { NextResponse } from "next/server";
import { requireUser } from "@/lib/firebase/admin";
import { pullForUser, pushAllForUser } from "@/lib/google/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Full manual sync: push all dated tasks to Google, then pull Google changes back. */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser(req);
  } catch (r) {
    return r instanceof Response ? r : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { tz } = (await req.json().catch(() => ({}))) as { tz?: string };
    const pushed = await pushAllForUser(user.uid, tz);
    const pulled = await pullForUser(user.uid);
    return NextResponse.json({ pushed: pushed.pushed, pulled: pulled.changed, status: pushed.status });
  } catch (e) {
    console.error("calendar sync error", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sync failed" }, { status: 500 });
  }
}
