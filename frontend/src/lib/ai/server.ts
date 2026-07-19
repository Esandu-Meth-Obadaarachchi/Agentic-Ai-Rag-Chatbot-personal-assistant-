import { adminDb } from "@/lib/firebase/admin";
import type { Project, Workspace } from "@/lib/types";

/** Load a workspace + its projects, enforcing membership (admin bypasses rules). */
export async function loadWorkspace(uid: string, workspaceId: string) {
  const wsDoc = await adminDb().collection("workspaces").doc(workspaceId).get();
  if (!wsDoc.exists) throw new Response("Workspace not found", { status: 404 });
  const ws = { id: wsDoc.id, ...(wsDoc.data() as Omit<Workspace, "id">) };
  if (!ws.memberIds.includes(uid)) throw new Response("Forbidden", { status: 403 });

  const projSnap = await adminDb().collection("projects").where("workspaceId", "==", workspaceId).get();
  // Enforce per-project scope, not just workspace membership. A member scoped to
  // specific projects must never see another project's knowledge or tasks through
  // the agent. project.memberIds is the denormalised access list (full-access
  // members + members scoped to this project); a project without it is legacy and
  // open to any workspace member. Full-access members keep every project, so
  // cross-project questions still work.
  const projects = projSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Project, "id">) }))
    .filter((p) => !p.memberIds || p.memberIds.includes(uid));
  return { ws, projects };
}

/**
 * Load everything a user can act on, across ALL their workspaces: every workspace
 * and every project where their uid is in `memberIds`. This is the agent's scope —
 * so "what are my tasks today" spans all workspaces, and knowledge search reaches
 * every project the user belongs to. `memberIds` still gates everything (per-project
 * scope is already baked into `project.memberIds`), so nothing they can't access
 * ever loads.
 */
export async function loadUserScope(uid: string) {
  const [wsSnap, projSnap] = await Promise.all([
    adminDb().collection("workspaces").where("memberIds", "array-contains", uid).get(),
    adminDb().collection("projects").where("memberIds", "array-contains", uid).get(),
  ]);
  const workspaces = wsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Workspace, "id">) }));
  const projects = projSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Project, "id">) }));
  return { workspaces, projects };
}

/** Load a single project, enforcing membership. */
export async function loadProject(uid: string, projectId: string) {
  const doc = await adminDb().collection("projects").doc(projectId).get();
  if (!doc.exists) throw new Response("Project not found", { status: 404 });
  const project = { id: doc.id, ...(doc.data() as Omit<Project, "id">) } as Project & { memberIds?: string[] };
  if (project.memberIds && !project.memberIds.includes(uid)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return project;
}
