import fs from "fs";
import path from "path";
import crypto from "crypto";

let envLoaded = false;

/**
 * Automatically loads .env and .env.local files at startup if not already loaded by the runtime.
 * Explicitly prioritizes .env.local and GEMINI_API_KEY to prevent stale shell GOOGLE_API_KEY shadowing.
 */
export function loadEnvironment(): void {
  if (envLoaded) return;
  envLoaded = true;

  const cwd = process.cwd();
  const envFiles = [".env.local", ".env", ".env.development", ".env.production"];

  const fileEnv: Record<string, string> = {};

  for (const file of envFiles) {
    const filePath = path.join(cwd, file);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf8");
        const lines = content.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith(String.fromCharCode(34)) && val.endsWith(String.fromCharCode(34))) ||
                (val.startsWith(String.fromCharCode(39)) && val.endsWith(String.fromCharCode(39)))) {
              val = val.slice(1, -1);
            }
            if (!fileEnv[key] && val) {
              fileEnv[key] = val;
            }
          }
        }
      } catch (err) {
        console.warn("[Env Loader] Could not read " + file + ":", err);
      }
    }
  }

  // File-defined keys take precedence over stale shell inherited keys
  for (const [k, v] of Object.entries(fileEnv)) {
    process.env[k] = v;
  }

  // Unified resolution: ensure GEMINI_API_KEY, GOOGLE_API_KEY, and GOOGLE_GENAI_API_KEY are synchronized
  const geminiKey = fileEnv.GEMINI_API_KEY || process.env.GEMINI_API_KEY || fileEnv.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY;
  if (geminiKey && geminiKey.trim()) {
    const trimmed = geminiKey.trim();
    process.env.GEMINI_API_KEY = trimmed;
    process.env.GOOGLE_API_KEY = trimmed;
    process.env.GOOGLE_GENAI_API_KEY = trimmed;
  }
}

export function getGeminiKeySourceInfo(): { key: string | undefined; source: string } {
  const candidatePairs: [string, string | undefined][] = [
    ["GEMINI_API_KEY", process.env.GEMINI_API_KEY],
    ["GOOGLE_GENAI_API_KEY", process.env.GOOGLE_GENAI_API_KEY],
    ["GOOGLE_API_KEY", process.env.GOOGLE_API_KEY],
    ["IMAGE_API_KEY", process.env.IMAGE_API_KEY],
    ["VIDEO_API_KEY", process.env.VIDEO_API_KEY],
    ["VITE_GEMINI_API_KEY", process.env.VITE_GEMINI_API_KEY],
    ["VITE_GOOGLE_API_KEY", process.env.VITE_GOOGLE_API_KEY],
  ];
  for (const [sourceName, val] of candidatePairs) {
    if (typeof val === "string" && val.trim().length > 0 && val.trim() !== "undefined" && val.trim() !== "null") {
      return { key: val.trim(), source: sourceName };
    }
  }
  return { key: undefined, source: "none" };
}

export function getGeminiApiKey(): string | undefined {
  return getGeminiKeySourceInfo().key;
}

export function getSafeKeyDiagnostics() {
  const { key, source } = getGeminiKeySourceInfo();
  if (!key) {
    return {
      geminiConfigured: false,
      keySource: "none",
      keyFingerprint: "none",
      keyPrefix: "none",
      keyLength: 0,
    };
  }
  const hash = crypto.createHash("sha256").update(key).digest("hex").slice(0, 8);
  return {
    geminiConfigured: true,
    keySource: source,
    keyFingerprint: "sha256:" + hash,
    keyPrefix: key.slice(0, 4) + "..." + key.slice(-4),
    keyLength: key.length,
  };
}

export function getOpenAiApiKey(): string | undefined {
  const candidates = [
    process.env.OPENAI_API_KEY,
    process.env.VITE_OPENAI_API_KEY,
  ];
  for (const cand of candidates) {
    if (typeof cand === "string" && cand.trim().length > 0 && cand.trim() !== "undefined" && cand.trim() !== "null") {
      return cand.trim();
    }
  }
  return undefined;
}

function cleanEnvValue(val: string | undefined): string {
  if (typeof val !== "string") return "";
  const trimmed = val.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null") return "";
  return trimmed;
}

export interface FirebasePublicClientConfig {
  configured: boolean;
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId: string;
  authEmulatorUrl: string;
  missingFields: string[];
}

export function getFirebasePublicClientConfig(): FirebasePublicClientConfig {
  const apiKey = cleanEnvValue(process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_WEB_API_KEY);
  const projectId = cleanEnvValue(
    process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID
  );
  const authDomain =
    cleanEnvValue(process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN) ||
    (projectId ? `${projectId}.firebaseapp.com` : "");
  const storageBucket =
    cleanEnvValue(process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET) ||
    (projectId ? `${projectId}.firebasestorage.app` : "");
  const messagingSenderId = cleanEnvValue(
    process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID
  );
  const appId = cleanEnvValue(process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID);
  const measurementId = cleanEnvValue(
    process.env.VITE_FIREBASE_MEASUREMENT_ID || process.env.FIREBASE_MEASUREMENT_ID
  );
  const authEmulatorUrl = cleanEnvValue(
    process.env.VITE_FIREBASE_AUTH_EMULATOR_URL || process.env.FIREBASE_AUTH_EMULATOR_URL
  );

  const missingFields: string[] = [];
  if (!apiKey) missingFields.push("VITE_FIREBASE_API_KEY");
  if (!authDomain) missingFields.push("VITE_FIREBASE_AUTH_DOMAIN");
  if (!projectId) missingFields.push("VITE_FIREBASE_PROJECT_ID");
  if (!appId) missingFields.push("VITE_FIREBASE_APP_ID");

  const configured = Boolean(apiKey && authDomain && projectId && appId);

  return {
    configured,
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
    measurementId,
    authEmulatorUrl,
    missingFields,
  };
}

loadEnvironment();
