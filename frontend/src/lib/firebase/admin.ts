import { cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Firebase Admin — server only. Used by API routes to verify the caller's ID
 * token and to read/write Firestore on the user's behalf (e.g. the Claude agent
 * creating a task). Never import this into a client component.
 */
let cached: App | null = null;

function adminApp(): App {
  if (cached) return cached;
  if (getApps().length) {
    cached = getApp();
    return cached;
  }
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin is not configured. Set FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY."
    );
  }
  cached = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  return cached;
}

export const adminAuth = () => getAuth(adminApp());
export const adminDb = () => getFirestore(adminApp());

export interface AuthedUser {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
}

/** Verify the `Authorization: Bearer <idToken>` header. Throws on failure. */
export async function requireUser(req: Request): Promise<AuthedUser> {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw new Response("Unauthorized", { status: 401 });
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      picture: decoded.picture,
    };
  } catch {
    throw new Response("Unauthorized", { status: 401 });
  }
}
