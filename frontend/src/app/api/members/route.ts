import { NextResponse } from "next/server";
import { requireUser } from "@/lib/firebase/admin";
import {
  acceptInvite,
  acceptInvites,
  createInvite,
  declineInvite,
  listMyInvites,
  listShare,
  removeMember,
  revokeInvite,
  updateMember,
} from "@/lib/share/server";
import type { MemberRole } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function auth(req: Request) {
  try {
    return await requireUser(req);
  } catch (r) {
    throw r instanceof Response ? r : new Response("Unauthorized", { status: 401 });
  }
}

/** GET /api/members?workspaceId=... — members + pending invites for a workspace.
 *  Endpoint is /api/members, not /api/share: ad-blockers block "share" URLs. */
export async function GET(req: Request) {
  try {
    const user = await auth(req);
    const url = new URL(req.url);
    // ?mine=1 -> the caller's own pending invites (their invite mailbox).
    if (url.searchParams.get("mine")) {
      return NextResponse.json({ invites: await listMyInvites(user) });
    }
    const workspaceId = url.searchParams.get("workspaceId");
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    return NextResponse.json(await listShare(user, workspaceId));
  } catch (err) {
    return err instanceof Response ? err : NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

/** POST /api/members — dispatch on `action`. */
export async function POST(req: Request) {
  try {
    const user = await auth(req);
    const body = (await req.json()) as {
      action:
        | "invite"
        | "accept"
        | "acceptOne"
        | "declineOne"
        | "update"
        | "removeMember"
        | "revokeInvite";
      workspaceId?: string;
      email?: string;
      role?: MemberRole;
      scope?: string[] | null;
      uid?: string;
      inviteId?: string;
    };

    switch (body.action) {
      case "accept":
        return NextResponse.json({ claimed: await acceptInvites(user) });
      case "acceptOne":
        await acceptInvite(user, body.inviteId!);
        return NextResponse.json({ ok: true });
      case "declineOne":
        await declineInvite(user, body.inviteId!);
        return NextResponse.json({ ok: true });
      case "invite":
        await createInvite(user, {
          workspaceId: body.workspaceId!,
          email: body.email ?? "",
          role: body.role ?? "member",
          scope: body.scope ?? null,
        });
        return NextResponse.json({ ok: true });
      case "update":
        await updateMember(user, {
          workspaceId: body.workspaceId!,
          uid: body.uid!,
          role: body.role,
          scope: body.scope,
        });
        return NextResponse.json({ ok: true });
      case "removeMember":
        await removeMember(user, { workspaceId: body.workspaceId!, uid: body.uid! });
        return NextResponse.json({ ok: true });
      case "revokeInvite":
        await revokeInvite(user, { workspaceId: body.workspaceId!, inviteId: body.inviteId! });
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof Response) {
      const text = await err.text().catch(() => "Failed");
      return NextResponse.json({ error: text }, { status: err.status });
    }
    console.error("share error", err);
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
