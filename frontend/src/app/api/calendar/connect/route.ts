import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/firebase/admin";
import { authUrl, isCalendarConfigured } from "@/lib/google/calendar";
import { saveOAuthState } from "@/lib/google/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start the Google OAuth flow: returns the consent URL for the client to open. */
export async function GET(req: Request) {
  let user;
  try {
    user = await requireUser(req);
  } catch (r) {
    return r instanceof Response ? r : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isCalendarConfigured()) {
    return NextResponse.json({ error: "Google Calendar is not configured on the server." }, { status: 400 });
  }
  const state = randomUUID();
  await saveOAuthState(state, user.uid);
  return NextResponse.json({ url: authUrl(state) });
}
