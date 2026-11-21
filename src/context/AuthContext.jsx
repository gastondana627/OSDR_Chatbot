import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from "firebase/auth";
import {
  fetchAdminSession,
  fetchAuthConfig,
  fetchAuthSession,
  loginAdminWithCredentials,
  logoutAdminSession,
  verifyAdminFirebaseSession,
} from "../api.js";
import {
  getFirebaseClientState,
  initFirebaseClient,
  mapFirebaseAuthError,
} from "../lib/firebase.js";
import {
  deleteResearcherProfile,
  loadResearcherProfile,
  parseImportedResearcherProfile,
  saveResearcherProfile,
} from "../utils/researcherProfile.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [firebaseState, setFirebaseState] = useState(() => getFirebaseClientState());
  const [serverAuthConfig, setServerAuthConfig] = useState(null);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [firebaseClaims, setFirebaseClaims] = useState({});
  const [backendSession, setBackendSession] = useState(null);
  const [adminSession, setAdminSession] = useState(null);
  const [researcherProfile, setResearcherProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // 1. Hydrate Firebase Web config & server admin session on boot
  useEffect(() => {
    let active = true;
    Promise.allSettled([fetchAuthConfig(), fetchAdminSession()])
      .then(([cfgRes, adminRes]) => {
        if (!active) return;
        if (cfgRes.status === "fulfilled" && cfgRes.value) {
          setServerAuthConfig(cfgRes.value);
          const nextFb = initFirebaseClient(cfgRes.value.firebaseConfig || {});
          setFirebaseState(nextFb);
          if (!nextFb.configured) {
            setAuthLoading(false);
          }
        } else {
          const fallbackFb = initFirebaseClient();
          setFirebaseState(fallbackFb);
          if (!fallbackFb.configured) {
            setAuthLoading(false);
          }
        }
        if (adminRes.status === "fulfilled" && adminRes.value) {
          setAdminSession(adminRes.value.session || null);
        }
      })
      .catch(() => {
        if (active) setAuthLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  // 2. Subscribe to Firebase Auth state changes whenever Firebase client is initialized
  useEffect(() => {
    if (!firebaseState?.configured || !firebaseState?.auth) {
      setFirebaseUser(null);
      setFirebaseClaims({});
      setBackendSession(null);
      setAuthLoading(false);
      return undefined;
    }

    setAuthLoading(true);
    const unsub = onAuthStateChanged(firebaseState.auth, async (user) => {
      setFirebaseUser(user || null);
      if (!user) {
        setFirebaseClaims({});
        setBackendSession(null);
        setResearcherProfile(null);
        setAuthLoading(false);
        return;
      }

      setResearcherProfile(loadResearcherProfile(user.uid, user));

      try {
        const [tokenResult, idToken] = await Promise.all([
          user.getIdTokenResult(),
          user.getIdToken(),
        ]);
        setFirebaseClaims(tokenResult?.claims || {});
        try {
          const verified = await fetchAuthSession(idToken);
          setBackendSession(verified || null);
          if (verified?.adminSession) {
            setAdminSession(verified.adminSession);
          }
        } catch {
          setBackendSession(null);
        }
      } catch {
        setFirebaseClaims({});
        setBackendSession(null);
      } finally {
        setAuthLoading(false);
      }
    });

    return () => unsub();
  }, [firebaseState]);

  const getFreshIdToken = useCallback(
    async (forceRefresh = false) => {
      const user = firebaseState?.auth?.currentUser || firebaseUser;
      if (!user) return "";
      return user.getIdToken(forceRefresh);
    },
    [firebaseState, firebaseUser]
  );

  const refreshBackendSession = useCallback(async () => {
    const token = await getFreshIdToken(true);
    const [sessionRes, adminRes] = await Promise.allSettled([
      fetchAuthSession(token),
      fetchAdminSession(token),
    ]);
    if (sessionRes.status === "fulfilled") {
      setBackendSession(sessionRes.value);
    }
    if (adminRes.status === "fulfilled") {
      setAdminSession(adminRes.value?.session || null);
    }
    if (firebaseState?.auth?.currentUser) {
      const tokenRes = await firebaseState.auth.currentUser.getIdTokenResult(true);
      setFirebaseClaims(tokenRes?.claims || {});
    }
  }, [firebaseState, getFreshIdToken]);

  const requireConfiguredAuth = () => {
    if (!firebaseState?.configured || !firebaseState?.auth) {
      throw new Error(
        "Firebase Authentication is not configured yet. Add your VITE_FIREBASE_* values in .env to enable sign-in."
      );
    }
    return firebaseState.auth;
  };

  const signInWithEmail = useCallback(
    async (email, password) => {
      const auth = requireConfiguredAuth();
      try {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        return cred.user;
      } catch (err) {
        throw new Error(mapFirebaseAuthError(err));
      }
    },
    [firebaseState]
  );

  const signUpWithEmail = useCallback(
    async ({ displayName, email, password }) => {
      const auth = requireConfiguredAuth();
      try {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        const cleanName = String(displayName || "").trim();
        if (cleanName) {
          await updateProfile(cred.user, { displayName: cleanName });
        }
        try {
          await sendEmailVerification(cred.user);
        } catch {
          // Best-effort verification email
        }
        setFirebaseUser({ ...cred.user, displayName: cleanName || cred.user.displayName });
        return cred.user;
      } catch (err) {
        throw new Error(mapFirebaseAuthError(err));
      }
    },
    [firebaseState]
  );

  const signInWithGoogle = useCallback(async () => {
    const auth = requireConfiguredAuth();
    if (!firebaseState?.googleProvider) {
      throw new Error("Google provider failed to initialize.");
    }
    try {
      const cred = await signInWithPopup(auth, firebaseState.googleProvider);
      return cred.user;
    } catch (err) {
      throw new Error(mapFirebaseAuthError(err));
    }
  }, [firebaseState]);

  const sendPasswordReset = useCallback(
    async (email) => {
      const auth = requireConfiguredAuth();
      try {
        await sendPasswordResetEmail(auth, email.trim());
        return true;
      } catch (err) {
        throw new Error(mapFirebaseAuthError(err));
      }
    },
    [firebaseState]
  );

  const resendVerificationEmail = useCallback(async () => {
    const user = firebaseState?.auth?.currentUser;
    if (!user) throw new Error("Sign in first to resend a verification email.");
    try {
      await sendEmailVerification(user);
      return true;
    } catch (err) {
      throw new Error(mapFirebaseAuthError(err));
    }
  }, [firebaseState]);

  const signOutUser = useCallback(async () => {
    if (firebaseState?.auth) {
      await signOut(firebaseState.auth);
    }
    try {
      await logoutAdminSession();
    } catch {
      // Ignore network errors during logout
    }
    setFirebaseUser(null);
    setFirebaseClaims({});
    setBackendSession(null);
    setAdminSession(null);
    setResearcherProfile(null);
  }, [firebaseState]);

  const saveProfile = useCallback(
    async (patch) => {
      const user = firebaseState?.auth?.currentUser || firebaseUser;
      if (!user?.uid) {
        throw new Error("Sign in first to customize your AWG researcher profile.");
      }
      const next = saveResearcherProfile(user.uid, patch, user);
      setResearcherProfile(next);

      const cleanName = String(next.displayName || "").trim();
      if (
        cleanName &&
        firebaseState?.auth?.currentUser &&
        cleanName !== (firebaseState.auth.currentUser.displayName || "")
      ) {
        try {
          await updateProfile(firebaseState.auth.currentUser, { displayName: cleanName });
          setFirebaseUser({ ...firebaseState.auth.currentUser, displayName: cleanName });
        } catch {
          // Best-effort Firebase displayName sync; local profile remains saved
        }
      }
      return next;
    },
    [firebaseState, firebaseUser]
  );

  const completeOnboarding = useCallback(
    async (patch) => {
      return saveProfile({
        ...(patch || {}),
        onboardingCompleted: true,
        onboardingDismissed: false,
      });
    },
    [saveProfile]
  );

  const dismissOnboarding = useCallback(() => {
    const user = firebaseState?.auth?.currentUser || firebaseUser;
    if (!user?.uid) return null;
    const next = saveResearcherProfile(
      user.uid,
      { onboardingDismissed: true },
      user
    );
    setResearcherProfile(next);
    return next;
  }, [firebaseState, firebaseUser]);

  const resetProfile = useCallback(() => {
    const user = firebaseState?.auth?.currentUser || firebaseUser;
    if (!user?.uid) return null;
    deleteResearcherProfile(user.uid);
    const fresh = loadResearcherProfile(user.uid, user);
    setResearcherProfile(fresh);
    return fresh;
  }, [firebaseState, firebaseUser]);

  const importProfileJson = useCallback(
    async (rawText) => {
      const user = firebaseState?.auth?.currentUser || firebaseUser;
      if (!user?.uid) {
        throw new Error("Sign in first to import an AWG researcher profile.");
      }
      const imported = parseImportedResearcherProfile(rawText, user.uid, user);
      return saveProfile(imported);
    },
    [firebaseState, firebaseUser, saveProfile]
  );

  const verifyAdminViaFirebase = useCallback(
    async ({ passcode = "" } = {}) => {
      const user = firebaseState?.auth?.currentUser || firebaseUser;
      if (!user) {
        throw new Error("Sign in with a Firebase Admin account first.");
      }
      const idToken = await user.getIdToken(true);
      const res = await verifyAdminFirebaseSession({ idToken, passcode });
      setAdminSession(res.session || null);
      if (res.customClaimSynced) {
        await user.getIdToken(true);
        const tokenRes = await user.getIdTokenResult(true);
        setFirebaseClaims(tokenRes?.claims || {});
      }
      return res;
    },
    [firebaseState, firebaseUser]
  );

  const loginAdminDirect = useCallback(
    async ({ email, password }) => {
      const res = await loginAdminWithCredentials({ email, password });
      setAdminSession(res.session || null);
      if (res.customToken && firebaseState?.configured && firebaseState?.auth) {
        try {
          await signInWithCustomToken(firebaseState.auth, res.customToken);
        } catch {
          // Server HttpOnly admin session cookie remains active even if custom token sign-in isn't used
        }
      }
      return res;
    },
    [firebaseState]
  );

  const logoutAdminOnly = useCallback(async () => {
    await logoutAdminSession();
    setAdminSession(null);
  }, []);

  const isAdmin = Boolean(
    adminSession?.role === "admin" ||
      firebaseClaims?.admin === true ||
      firebaseClaims?.role === "admin"
  );

  const needsOnboarding = Boolean(
    firebaseUser &&
      researcherProfile &&
      !researcherProfile.onboardingCompleted &&
      !researcherProfile.onboardingDismissed
  );

  const value = useMemo(
    () => ({
      firebaseConfigured: Boolean(firebaseState?.configured),
      firebaseConfigStatus: firebaseState,
      serverAuthConfig,
      firebaseUser,
      firebaseClaims,
      backendSession,
      adminSession,
      researcherProfile,
      needsOnboarding,
      isAdmin,
      authLoading,
      getFreshIdToken,
      refreshBackendSession,
      signInWithEmail,
      signUpWithEmail,
      signInWithGoogle,
      sendPasswordReset,
      resendVerificationEmail,
      signOutUser,
      saveProfile,
      completeOnboarding,
      dismissOnboarding,
      resetProfile,
      importProfileJson,
      verifyAdminViaFirebase,
      loginAdminDirect,
      logoutAdminOnly,
    }),
    [
      firebaseState,
      serverAuthConfig,
      firebaseUser,
      firebaseClaims,
      backendSession,
      adminSession,
      researcherProfile,
      needsOnboarding,
      isAdmin,
      authLoading,
      getFreshIdToken,
      refreshBackendSession,
      signInWithEmail,
      signUpWithEmail,
      signInWithGoogle,
      sendPasswordReset,
      resendVerificationEmail,
      signOutUser,
      saveProfile,
      completeOnboarding,
      dismissOnboarding,
      resetProfile,
      importProfileJson,
      verifyAdminViaFirebase,
      loginAdminDirect,
      logoutAdminOnly,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}

