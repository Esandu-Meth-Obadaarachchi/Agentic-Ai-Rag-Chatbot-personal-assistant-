import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { exchangeCode, watchCalendar, webhookUrl } from "@/lib/google/calendar";
import { consumeOAuthState, saveConnection } from "@/lib/google/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Google redirects here with ?code&state. Exchange for tokens, store the
 *  refresh token, register a watch channel (if a public webhook URL is set),
 *  then bounce back to the app. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = process.env.NEXT_PUBLIC_APP_URL || url.origin;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const back = (status: string) => NextResponse.redirect(new URL(`/?calendar=${status}`, base));

  if (!code || !state) return back("error");

  try {
    const uid = await consumeOAuthState(state);
    if (!uid) return back("error");

    const tokens = await exchangeCode(code);
    if (!tokens.refresh_token) {
      // No refresh token means Google didn't grant offline access — usually a
      // re-consent issue. Bounce with a hint.
      return back("nooffline");
    }
    await saveConnection(uid, { refreshToken: tokens.refresh_token, connectedAt: Date.now() });

    // Register a push channel for live reverse-sync (best effort; needs public HTTPS).
    const hook = webhookUrl();
    if (hook) {
      try {
        const channelId = randomUUID();
        const w = await watchCalendar(tokens.access_token, channelId, hook, uid);
        await saveConnection(uid, {
          channelId,
          resourceId: w.resourceId,
          channelExpiration: w.expiration ? Number(w.expiration) : null,
        });
      } catch (e) {
        console.error("watch setup failed (reverse sync disabled)", e);
      }
    }

    return back("connected");
  } catch (e) {
    console.error("calendar callback error", e);
    return back("error");
  }
}
