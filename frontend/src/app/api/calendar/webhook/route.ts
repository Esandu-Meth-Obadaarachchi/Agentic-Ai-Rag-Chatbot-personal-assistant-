import { NextResponse } from "next/server";
import { pullForUser } from "@/lib/google/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Google push-notification endpoint (watch channel). Google POSTs here when the
 * user's calendar changes. The channel token we set is the user's uid. We ack
 * immediately and run an incremental pull. Must be a public HTTPS URL.
 */
export async function POST(req: Request) {
  const state = req.headers.get("x-goog-resource-state");
  const uid = req.headers.get("x-goog-channel-token");

  // The initial "sync" handshake carries no data — just acknowledge.
  if (state === "sync" || !uid) return NextResponse.json({ ok: true });

  try {
    await pullForUser(uid);
  } catch (e) {
    console.error("calendar webhook pull error", e);
  }
  // Always 200 so Google doesn't retry-storm.
  return NextResponse.json({ ok: true });
}
