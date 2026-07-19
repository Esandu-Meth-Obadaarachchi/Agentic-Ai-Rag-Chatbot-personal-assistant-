import { NextResponse } from "next/server";
import { requireUser } from "@/lib/firebase/admin";
import { deleteTaskEvent, pushTask } from "@/lib/google/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Push one task to Google (create/update/delete), or delete an orphaned event.
 *  Called fire-and-forget by the client after a task edit; no-ops if the user
 *  hasn't connected a calendar. */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser(req);
  } catch (r) {
    return r instanceof Response ? r : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { taskId, deleteEventId, tz } = (await req.json()) as {
      taskId?: string;
      deleteEventId?: string;
      tz?: string;
    };
    if (deleteEventId) {
      await deleteTaskEvent(user.uid, deleteEventId);
      return NextResponse.json({ status: "deleted" });
    }
    if (!taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });
    const result = await pushTask(user.uid, taskId, tz);
    return NextResponse.json(result);
  } catch (e) {
    console.error("calendar push error", e);
    return NextResponse.json({ status: "error" }, { status: 200 }); // don't surface to the UI mid-edit
  }
}
