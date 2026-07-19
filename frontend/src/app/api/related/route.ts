import { NextResponse } from "next/server";
import { requireUser } from "@/lib/firebase/admin";
import { loadProject } from "@/lib/ai/server";
import { retrieveAndRerank } from "@/lib/ai/retrieval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Smart linking: given a task's project + a query, return related knowledge chunks. */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser(req);
  } catch (r) {
    return r instanceof Response ? r : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { projectId, query } = (await req.json()) as { projectId?: string; query?: string };
    if (!projectId || !query) {
      return NextResponse.json({ error: "projectId and query are required" }, { status: 400 });
    }
    const project = await loadProject(user.uid, projectId);
    const chunks = await retrieveAndRerank([project.ragNamespace], query, 3);
    return NextResponse.json({ chunks });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("related error", err);
    return NextResponse.json({ chunks: [] });
  }
}
