import { adminDb } from "@/lib/firebase/admin";

/**
 * Server-only storage for calendar OAuth. These collections are never listed in
 * firestore.rules, so clients cannot read them (rules v2 denies unlisted paths).
 * The refresh token lives here and never reaches the browser.
 */
export interface CalendarConnection {
  uid: string;
  email?: string;
  refreshToken: string;
  syncToken?: string | null;
  channelId?: string | null;
  resourceId?: string | null;
  channelExpiration?: number | null;
  timeZone?: string | null;
  connectedAt: number;
}

const CONN = "calendarConnections";
const STATE = "calendarOAuthStates";

export async function saveOAuthState(state: string, uid: string) {
  await adminDb().collection(STATE).doc(state).set({ uid, createdAt: Date.now() });
}

/** Read + delete the state doc; returns the uid or null. */
export async function consumeOAuthState(state: string): Promise<string | null> {
  const ref = adminDb().collection(STATE).doc(state);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.delete();
  const { uid, createdAt } = snap.data() as { uid: string; createdAt: number };
  if (Date.now() - createdAt > 10 * 60 * 1000) return null; // 10 min TTL
  return uid;
}

export async function getConnection(uid: string): Promise<CalendarConnection | null> {
  const snap = await adminDb().collection(CONN).doc(uid).get();
  return snap.exists ? (snap.data() as CalendarConnection) : null;
}

export async function saveConnection(uid: string, patch: Partial<CalendarConnection>) {
  await adminDb().collection(CONN).doc(uid).set({ uid, ...patch }, { merge: true });
}

export async function deleteConnection(uid: string) {
  await adminDb().collection(CONN).doc(uid).delete();
}

/** Find a user's task by its Firestore id (admin, membership already implied by uid ownership). */
export async function getTask(taskId: string) {
  const snap = await adminDb().collection("tasks").doc(taskId).get();
  return snap.exists ? { id: snap.id, ...(snap.data() as Record<string, unknown>) } : null;
}

/** Find a task by the Google event id (for reverse sync), scoped to the user.
 *  Single-field query (auto-indexed); membership checked in code. */
export async function findTaskByEventId(uid: string, eventId: string) {
  const q = await adminDb().collection("tasks").where("googleEventId", "==", eventId).limit(5).get();
  const doc = q.docs.find((d) => (d.data().memberIds as string[] | undefined)?.includes(uid));
  return doc ? { id: doc.id, ...(doc.data() as Record<string, unknown>) } : null;
}
