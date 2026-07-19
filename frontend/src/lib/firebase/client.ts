import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore, initializeFirestore, type Firestore } from "firebase/firestore";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** True only when the client env is fully populated — lets the UI show a
 *  friendly "configure Firebase" state instead of crashing during setup. */
export const isFirebaseConfigured = Boolean(config.apiKey && config.projectId);

const app = isFirebaseConfigured
  ? getApps().length
    ? getApp()
    : initializeApp(config)
  : null;

export const auth = app ? getAuth(app) : null;

/**
 * Use long-polling auto-detection instead of the default WebChannel transport.
 * The WebChannel watch-stream aggregator has a known internal-assertion bug
 * ("Unexpected state (ID: b815/ca9)") that React StrictMode's rapid
 * subscribe/unsubscribe in dev reliably trips. Long-polling avoids that path.
 * initializeFirestore can only run once per app, so fall back on HMR re-runs.
 */
function makeDb(a: NonNullable<typeof app>): Firestore {
  try {
    // Force (not just auto-detect) long-polling: auto-detect can still pick the
    // buggy WebChannel path on slow-mounting views like the whiteboard.
    return initializeFirestore(a, { experimentalForceLongPolling: true });
  } catch {
    return getFirestore(a);
  }
}

export const db = app ? makeDb(app) : null;

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
