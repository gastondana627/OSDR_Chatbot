import { getApp, getApps, initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  connectAuthEmulator,
  getAuth,
} from "firebase/auth";

let cachedState = null;
let emulatorConnected = false;

function cleanConfigValue(val) {
  if (typeof val !== "string") return "";
  const trimmed = val.trim();
  if (
    !trimmed ||
    trimmed === "undefined" ||
    trimmed === "null" ||
    trimmed.startsWith("YOUR_") ||
    trimmed.includes("REPLACE_WITH")
  ) {
    return "";
  }
  return trimmed;
}

/**
 * Resolve build-time Vite environment config (safe public Firebase client keys).
 */
export function resolveViteFirebaseConfig() {
  const apiKey = cleanConfigValue(import.meta.env.VITE_FIREBASE_API_KEY);
  const projectId = cleanConfigValue(import.meta.env.VITE_FIREBASE_PROJECT_ID);
  const authDomain =
    cleanConfigValue(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN) ||
    (projectId ? `${projectId}.firebaseapp.com` : "");
  const storageBucket =
    cleanConfigValue(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET) ||
    (projectId ? `${projectId}.firebasestorage.app` : "");
  const messagingSenderId = cleanConfigValue(
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID
  );
  const appId = cleanConfigValue(import.meta.env.VITE_FIREBASE_APP_ID);
  const measurementId = cleanConfigValue(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID);
  const authEmulatorUrl = cleanConfigValue(import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL);

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
    measurementId,
    authEmulatorUrl,
  };
}

/**
 * Merge build-time Vite env vars with runtime config hydrated from /api/auth/config.
 */
export function mergeFirebaseConfig(serverConfig = {}) {
  const viteCfg = resolveViteFirebaseConfig();
  const s = serverConfig || {};
  const projectId = viteCfg.projectId || cleanConfigValue(s.projectId);
  const merged = {
    apiKey: viteCfg.apiKey || cleanConfigValue(s.apiKey),
    authDomain:
      viteCfg.authDomain ||
      cleanConfigValue(s.authDomain) ||
      (projectId ? `${projectId}.firebaseapp.com` : ""),
    projectId,
    storageBucket:
      viteCfg.storageBucket ||
      cleanConfigValue(s.storageBucket) ||
      (projectId ? `${projectId}.firebasestorage.app` : ""),
    messagingSenderId:
      viteCfg.messagingSenderId || cleanConfigValue(s.messagingSenderId),
    appId: viteCfg.appId || cleanConfigValue(s.appId),
    measurementId: viteCfg.measurementId || cleanConfigValue(s.measurementId),
    authEmulatorUrl: viteCfg.authEmulatorUrl || cleanConfigValue(s.authEmulatorUrl),
  };

  const missingFields = [];
  if (!merged.apiKey) missingFields.push("VITE_FIREBASE_API_KEY");
  if (!merged.authDomain) missingFields.push("VITE_FIREBASE_AUTH_DOMAIN");
  if (!merged.projectId) missingFields.push("VITE_FIREBASE_PROJECT_ID");
  if (!merged.appId) missingFields.push("VITE_FIREBASE_APP_ID");

  return {
    config: merged,
    configured: Boolean(merged.apiKey && merged.authDomain && merged.projectId && merged.appId),
    missingFields,
  };
}

/**
 * Safely initialize Firebase Client App & Auth without crashing when .env keys are absent.
 */
export function initFirebaseClient(serverConfig = {}) {
  const { config, configured, missingFields } = mergeFirebaseConfig(serverConfig);

  if (!configured) {
    cachedState = {
      configured: false,
      app: null,
      auth: null,
      googleProvider: null,
      config,
      missingFields,
    };
    return cachedState;
  }

  if (cachedState?.configured && cachedState?.config?.apiKey === config.apiKey) {
    return cachedState;
  }

  const sdkConfig = {
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    ...(config.storageBucket ? { storageBucket: config.storageBucket } : {}),
    ...(config.messagingSenderId ? { messagingSenderId: config.messagingSenderId } : {}),
    appId: config.appId,
    ...(config.measurementId ? { measurementId: config.measurementId } : {}),
  };

  const app = getApps().length > 0 ? getApp() : initializeApp(sdkConfig);
  const auth = getAuth(app);

  if (config.authEmulatorUrl && !emulatorConnected) {
    try {
      connectAuthEmulator(auth, config.authEmulatorUrl, { disableWarnings: true });
      emulatorConnected = true;
    } catch {
      // Ignore duplicate emulator connection calls during HMR
    }
  }

  const googleProvider = new GoogleAuthProvider();
  googleProvider.setCustomParameters({ prompt: "select_account" });

  cachedState = {
    configured: true,
    app,
    auth,
    googleProvider,
    config,
    missingFields: [],
  };
  return cachedState;
}

export function getFirebaseClientState() {
  return cachedState || initFirebaseClient();
}

/**
 * Convert raw Firebase Auth SDK error codes into clear, actionable UI messages.
 */
export function mapFirebaseAuthError(error) {
  const code = String(error?.code || "");
  const fallbackMsg = error?.message || "Authentication failed. Please try again.";

  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Invalid email or password. Double-check your credentials or reset your password.";
    case "auth/email-already-in-use":
      return "An account with this email already exists. Try signing in instead.";
    case "auth/weak-password":
      return "Password is too weak. Choose at least 6 characters (longer recommended).";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/too-many-requests":
      return "Too many failed attempts from this session. Wait a few minutes or reset your password.";
    case "auth/popup-closed-by-user":
      return "Sign-in popup was closed before finishing. Click Continue with Google to try again.";
    case "auth/popup-blocked":
      return "Your browser blocked the Google sign-in popup. Allow popups for this site and try again.";
    case "auth/unauthorized-domain":
      return "This hostname is not listed in Firebase Console -> Authentication -> Settings -> Authorized domains (add localhost and your production domain without http:// or ports).";
    case "auth/operation-not-allowed":
      return "This sign-in provider is disabled in Firebase Console. Enable Email/Password and Google under Authentication -> Sign-in method.";
    case "auth/network-request-failed":
      return "Network error while contacting Firebase Authentication. Check your connection and try again.";
    default:
      return fallbackMsg.replace(/^Firebase:\s*/i, "");
  }
}

