"use client";

import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { auth, googleProvider, isFirebaseConfigured } from "@/lib/firebase/client";

interface AuthState {
  user: User | null;
  loading: boolean;
  configured: boolean;
  signIn: () => Promise<void>;
  signOutUser: () => Promise<void>;
}

const AuthCtx = createContext<AuthState>({
  user: null,
  loading: true,
  configured: false,
  signIn: async () => {},
  signOutUser: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const signIn = useCallback(async () => {
    if (!auth) return;
    await signInWithPopup(auth, googleProvider);
  }, []);

  const signOutUser = useCallback(async () => {
    if (!auth) return;
    await firebaseSignOut(auth);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, configured: isFirebaseConfigured, signIn, signOutUser }),
    [user, loading, signIn, signOutUser]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
