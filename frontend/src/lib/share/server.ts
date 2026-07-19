import { adminDb, type AuthedUser } from "@/lib/firebase/admin";
import type { Invite, MemberRole, Workspace, WorkspaceMember } from "@/lib/types";

/**
 * Server-side sharing logic. All membership writes happen here through the
 * Admin SDK so security rules stay a simple `memberIds array-contains uid`
 * check while still supporting per-project scoping.
 *
 * The source of truth is `workspace.members` (each carries a `scope`). Every
 * project/task `memberIds` list is *recomputed* from those scopes so a scoped
 * teammate sees only their projects and never leaks into new ones.
 */

/** uids of members with access to a given project (full-access or scoped-in). */
export function projectMemberIds(members: WorkspaceMember[], projectId: string): string[] {
  return members
    .filter((m) => m.scope == null || m.scope.includes(projectId))
    .map((m) => m.uid);
}

interface LoadedWorkspace {
  ref: FirebaseFirestore.DocumentReference;
  data: Workspace;
}

/** Load a workspace and assert the caller is a member. */
export async function loadWorkspace(uid: string, workspaceId: string): Promise<LoadedWorkspace> {
  const ref = adminDb().collection("workspaces").doc(workspaceId);
  const snap = await ref.get();
  if (!snap.exists) throw new Response("Workspace not found", { status: 404 });
  const data = { id: snap.id, ...(snap.data() as Omit<Workspace, "id">) };
  if (!data.memberIds?.includes(uid)) throw new Response("Forbidden", { status: 403 });
  return { ref, data };
}

export function isManager(members: WorkspaceMember[], uid: string): boolean {
  const me = members.find((m) => m.uid === uid);
  return me?.role === "owner" || me?.role === "admin";
}

export function assertManager(members: WorkspaceMember[], uid: string) {
  if (!isManager(members, uid)) throw new Response("Only owners and admins can manage sharing", { status: 403 });
}

/**
 * Rewrite workspace.members + memberIds, then push the derived memberIds down to
 * every project and task in the workspace. Idempotent; safe to re-run.
 */
export async function recomputeMembership(workspaceId: string, members: WorkspaceMember[]) {
  const db = adminDb();
  const memberIds = members.map((m) => m.uid);

  await db.collection("workspaces").doc(workspaceId).update({ members, memberIds });

  const [projSnap, taskSnap] = await Promise.all([
    db.collection("projects").where("workspaceId", "==", workspaceId).get(),
    db.collection("tasks").where("workspaceId", "==", workspaceId).get(),
  ]);

  const tasksByProject = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
  taskSnap.docs.forEach((d) => {
    const pid = d.get("projectId") as string;
    const arr = tasksByProject.get(pid) ?? [];
    arr.push(d);
    tasksByProject.set(pid, arr);
  });

  const writes: { ref: FirebaseFirestore.DocumentReference; ids: string[] }[] = [];
  projSnap.docs.forEach((p) => {
    const ids = projectMemberIds(members, p.id);
    writes.push({ ref: p.ref, ids });
    (tasksByProject.get(p.id) ?? []).forEach((t) => writes.push({ ref: t.ref, ids }));
  });

  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    writes.slice(i, i + 400).forEach((w) => batch.update(w.ref, { memberIds: w.ids }));
    await batch.commit();
  }
}

/* -------------------------------- actions -------------------------------- */

export async function createInvite(
  caller: AuthedUser,
  input: { workspaceId: string; email: string; role: MemberRole; scope: string[] | null }
) {
  const { data: ws } = await loadWorkspace(caller.uid, input.workspaceId);
  assertManager(ws.members, caller.uid);

  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Response("Enter a valid email", { status: 400 });
  if (ws.members.some((m) => m.email.toLowerCase() === email)) {
    throw new Response("That person is already a member", { status: 409 });
  }

  // Single-field query + in-memory filter so no composite index is ever needed.
  const db = adminDb();
  const wsInvites = await db.collection("invites").where("workspaceId", "==", input.workspaceId).get();
  const existingDoc = wsInvites.docs.find(
    (d) => (d.get("email") ?? "").toLowerCase() === email && d.get("status") === "pending"
  );

  const payload: Omit<Invite, "id"> = {
    workspaceId: ws.id,
    workspaceName: ws.name,
    workspaceEmoji: ws.emoji,
    email,
    role: input.role,
    scope: input.scope && input.scope.length ? input.scope : null,
    invitedByUid: caller.uid,
    invitedByName: caller.name ?? "A teammate",
    createdAt: Date.now(),
    status: "pending",
  };

  if (existingDoc) {
    await existingDoc.ref.update({ ...payload });
  } else {
    await db.collection("invites").add(payload);
  }
}

/** Called by an invitee after sign-in: claim every pending invite for their email. */
export async function acceptInvites(caller: AuthedUser): Promise<number> {
  const email = caller.email?.toLowerCase();
  if (!email) return 0;
  const db = adminDb();
  const snap = await db.collection("invites").where("email", "==", email).get();
  const pending = snap.docs.filter((d) => d.get("status") === "pending");
  if (pending.length === 0) return 0;

  let claimed = 0;
  for (const inviteDoc of pending) {
    const invite = inviteDoc.data() as Omit<Invite, "id">;
    try {
      const { data: ws } = await loadWorkspaceUnchecked(invite.workspaceId);
      if (!ws) {
        await inviteDoc.ref.update({ status: "accepted" });
        continue;
      }
      if (!ws.members.some((m) => m.uid === caller.uid)) {
        const member: WorkspaceMember = {
          uid: caller.uid,
          name: caller.name ?? "Teammate",
          email,
          photoURL: caller.picture ?? null,
          role: invite.role,
          scope: invite.scope,
        };
        await recomputeMembership(invite.workspaceId, [...ws.members, member]);
      }
      await inviteDoc.ref.update({ status: "accepted" });
      claimed += 1;
    } catch (e) {
      console.error("acceptInvite failed for", invite.workspaceId, e);
    }
  }
  return claimed;
}

/** Pending invites addressed to the caller's email (their invite mailbox). */
export async function listMyInvites(caller: AuthedUser): Promise<Invite[]> {
  const email = caller.email?.toLowerCase();
  if (!email) return [];
  const snap = await adminDb().collection("invites").where("email", "==", email).get();
  return snap.docs
    .filter((d) => d.get("status") === "pending")
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Invite, "id">) }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Accept ONE invite, explicitly. Invites are never auto-claimed. */
export async function acceptInvite(caller: AuthedUser, inviteId: string): Promise<void> {
  const email = caller.email?.toLowerCase();
  if (!email) throw new Response("No email on account", { status: 400 });

  const ref = adminDb().collection("invites").doc(inviteId);
  const doc = await ref.get();
  if (!doc.exists) throw new Response("Invite not found", { status: 404 });

  const invite = doc.data() as Omit<Invite, "id">;
  // An invite may only be claimed by the person it was addressed to.
  if (invite.email?.toLowerCase() !== email) throw new Response("Forbidden", { status: 403 });
  if (invite.status !== "pending") return;

  const { data: ws } = await loadWorkspaceUnchecked(invite.workspaceId);
  if (!ws) {
    await ref.update({ status: "declined" });
    return;
  }
  if (!ws.members.some((m) => m.uid === caller.uid)) {
    const member: WorkspaceMember = {
      uid: caller.uid,
      name: caller.name ?? "Teammate",
      email,
      photoURL: caller.picture ?? null,
      role: invite.role,
      scope: invite.scope,
    };
    await recomputeMembership(invite.workspaceId, [...ws.members, member]);
  }
  await ref.update({ status: "accepted" });
}

/** Decline ONE invite. The user never joins the workspace. */
export async function declineInvite(caller: AuthedUser, inviteId: string): Promise<void> {
  const email = caller.email?.toLowerCase();
  if (!email) throw new Response("No email on account", { status: 400 });
  const ref = adminDb().collection("invites").doc(inviteId);
  const doc = await ref.get();
  if (!doc.exists) return;
  const invite = doc.data() as Omit<Invite, "id">;
  if (invite.email?.toLowerCase() !== email) throw new Response("Forbidden", { status: 403 });
  if (invite.status === "pending") await ref.update({ status: "declined" });
}

async function loadWorkspaceUnchecked(workspaceId: string): Promise<{ data: Workspace | null }> {
  const snap = await adminDb().collection("workspaces").doc(workspaceId).get();
  if (!snap.exists) return { data: null };
  return { data: { id: snap.id, ...(snap.data() as Omit<Workspace, "id">) } };
}

export async function updateMember(
  caller: AuthedUser,
  input: { workspaceId: string; uid: string; role?: MemberRole; scope?: string[] | null }
) {
  const { data: ws } = await loadWorkspace(caller.uid, input.workspaceId);
  assertManager(ws.members, caller.uid);
  const target = ws.members.find((m) => m.uid === input.uid);
  if (!target) throw new Response("Not a member", { status: 404 });
  if (target.role === "owner") throw new Response("The owner cannot be changed", { status: 400 });

  const members = ws.members.map((m) =>
    m.uid === input.uid
      ? {
          ...m,
          role: input.role ?? m.role,
          scope: input.scope === undefined ? m.scope : input.scope && input.scope.length ? input.scope : null,
        }
      : m
  );
  await recomputeMembership(input.workspaceId, members);
}

export async function removeMember(caller: AuthedUser, input: { workspaceId: string; uid: string }) {
  const { data: ws } = await loadWorkspace(caller.uid, input.workspaceId);
  // A member may remove themselves; otherwise a manager is required.
  if (input.uid !== caller.uid) assertManager(ws.members, caller.uid);
  const target = ws.members.find((m) => m.uid === input.uid);
  if (!target) return;
  if (target.role === "owner") throw new Response("The owner cannot be removed", { status: 400 });
  await recomputeMembership(
    input.workspaceId,
    ws.members.filter((m) => m.uid !== input.uid)
  );
}

export async function revokeInvite(caller: AuthedUser, input: { workspaceId: string; inviteId: string }) {
  const { data: ws } = await loadWorkspace(caller.uid, input.workspaceId);
  assertManager(ws.members, caller.uid);
  const ref = adminDb().collection("invites").doc(input.inviteId);
  const snap = await ref.get();
  if (snap.exists && snap.get("workspaceId") === input.workspaceId) await ref.delete();
}

export async function listShare(caller: AuthedUser, workspaceId: string) {
  const { data: ws } = await loadWorkspace(caller.uid, workspaceId);
  const snap = await adminDb().collection("invites").where("workspaceId", "==", workspaceId).get();
  const invites: Invite[] = snap.docs
    .filter((d) => d.get("status") === "pending")
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Invite, "id">) }));
  return { members: ws.members, invites, isManager: isManager(ws.members, caller.uid), ownerId: ws.ownerId };
}
