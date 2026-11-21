import crypto from "crypto";
import type express from "express";
import { getFirebasePublicClientConfig } from "./env";

export const ADMIN_SESSION_COOKIE = "osdr_admin_session";
const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours
const SECURETOKEN_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FIREBASE_CUSTOM_TOKEN_AUDIENCE =
  "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit";

// Ephemeral fallback HMAC secret per runtime process if ADMIN_SESSION_SECRET isn't configured in .env.
// Never uses a static hardcoded string in source code.
const PROCESS_EPHEMERAL_HMAC_KEY = crypto.randomBytes(32);

export interface VerifiedFirebaseUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  signInProvider: string | null;
  adminClaim: boolean;
  roleClaim: string | null;
  verificationMode: "firebase_admin_sdk" | "google_x509_jwt" | "firebase_auth_emulator";
  claims: Record<string, unknown>;
}

export interface AdminSessionPayload {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: "admin";
  authMethod: "firebase_custom_claim" | "firebase_allowlist" | "server_credentials" | "firebase_passcode";
  iat: number;
  exp: number;
}

export interface AdminAccessConfig {
  projectId: string;
  adminEmails: string[];
  adminUids: string[];
  adminUsername: string;
  adminPasscodeConfigured: boolean;
  directAdminCredentialsConfigured: boolean;
  hasServiceAccount: boolean;
  authEmulatorHost: string;
}

interface CertCacheState {
  certs: Record<string, string>;
  expiresAtMs: number;
}

let certCache: CertCacheState | null = null;
let cachedOAuthToken: { accessToken: string; expiresAtMs: number; fingerprint: string } | null = null;

// Sliding-window rate limiter state for failed /admin authentication attempts
const failedAdminAttempts = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 8;

function cleanStr(v: string | undefined): string {
  if (typeof v !== "string") return "";
  const trimmed = v.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null") return "";
  return trimmed;
}

function parseListEnv(raw: string | undefined, lowercase = false): string[] {
  const val = cleanStr(raw);
  if (!val) return [];
  const items = val
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (lowercase ? s.toLowerCase() : s));
  return Array.from(new Set(items));
}

interface ParsedServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

function parseServiceAccountFromEnv(): ParsedServiceAccount | null {
  const rawJson = cleanStr(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      const projectId = cleanStr(parsed.project_id || parsed.projectId || process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID);
      const clientEmail = cleanStr(parsed.client_email || parsed.clientEmail);
      const privateKey = cleanStr(parsed.private_key || parsed.privateKey).replace(/\\n/g, "\n");
      if (projectId && clientEmail && privateKey) {
        return { projectId, clientEmail, privateKey };
      }
    } catch {
      // Invalid FIREBASE_SERVICE_ACCOUNT_JSON; fall through to discrete fields
    }
  }

  const projectId = cleanStr(
    process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID
  );
  const clientEmail = cleanStr(process.env.FIREBASE_CLIENT_EMAIL);
  const privateKey = cleanStr(process.env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, "\n");
  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey };
  }

  return null;
}

export function getAdminAccessConfig(): AdminAccessConfig {
  const publicCfg = getFirebasePublicClientConfig();
  const sa = parseServiceAccountFromEnv();
  const projectId = sa?.projectId || publicCfg.projectId;
  const adminEmails = parseListEnv(process.env.ADMIN_EMAILS, true);
  const adminUids = parseListEnv(process.env.ADMIN_UIDS, false);
  const adminUsername = cleanStr(process.env.ADMIN_USERNAME) || adminEmails[0] || "";
  const adminPasscode = cleanStr(process.env.ADMIN_PASSCODE || process.env.ADMIN_PASSWORD);
  const authEmulatorHost = cleanStr(process.env.FIREBASE_AUTH_EMULATOR_HOST);

  if (cleanStr(process.env.ADMIN_USERNAME).includes("@")) {
    const lowerUser = cleanStr(process.env.ADMIN_USERNAME).toLowerCase();
    if (!adminEmails.includes(lowerUser)) {
      adminEmails.push(lowerUser);
    }
  }

  return {
    projectId,
    adminEmails,
    adminUids,
    adminUsername,
    adminPasscodeConfigured: Boolean(adminPasscode),
    directAdminCredentialsConfigured: Boolean(adminUsername && adminPasscode),
    hasServiceAccount: Boolean(sa),
    authEmulatorHost,
  };
}

function signServiceAccountJwtRs256(
  payload: Record<string, unknown>,
  privateKeyPem: string
): string {
  const headerB64 = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" }), "utf8").toString(
    "base64url"
  );
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${headerB64}.${payloadB64}`);
  signer.end();
  const sigB64 = signer.sign(privateKeyPem).toString("base64url");
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

async function getServiceAccountAccessToken(sa: ParsedServiceAccount): Promise<string> {
  const nowMs = Date.now();
  const fingerprint = `${sa.projectId}:${sa.clientEmail}`;
  if (
    cachedOAuthToken &&
    cachedOAuthToken.fingerprint === fingerprint &&
    cachedOAuthToken.expiresAtMs > nowMs + 60_000
  ) {
    return cachedOAuthToken.accessToken;
  }

  const nowSec = Math.floor(nowMs / 1000);
  const assertion = signServiceAccountJwtRs256(
    {
      iss: sa.clientEmail,
      sub: sa.clientEmail,
      aud: GOOGLE_OAUTH_TOKEN_URL,
      iat: nowSec,
      exp: nowSec + 3600,
      scope:
        "https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform",
    },
    sa.privateKey
  );

  const resp = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Failed to obtain Firebase Service Account OAuth token (${resp.status}): ${errText.slice(0, 180)}`);
  }

  const data = (await resp.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error("OAuth token response missing access_token.");
  }

  cachedOAuthToken = {
    accessToken: data.access_token,
    expiresAtMs: nowMs + (Number(data.expires_in) || 3600) * 1000,
    fingerprint,
  };
  return data.access_token;
}

/**
 * Constant-time credential verification supporting plaintext .env values,
 * sha256:<hex>, or scrypt:<salt>:<hex> digests.
 */
export function constantTimeCredentialMatch(candidate: string, expectedSpec: string): boolean {
  if (!candidate || !expectedSpec) return false;

  if (expectedSpec.startsWith("scrypt$")) {
    const parts = expectedSpec.split("$");
    if (parts.length !== 3) return false;
    const [, salt, hexDigest] = parts;
    try {
      const expectedBuf = Buffer.from(hexDigest, "hex");
      const candidateBuf = crypto.scryptSync(candidate, salt, expectedBuf.length);
      if (candidateBuf.length !== expectedBuf.length) return false;
      return crypto.timingSafeEqual(candidateBuf, expectedBuf);
    } catch {
      return false;
    }
  }

  if (expectedSpec.startsWith("sha256$")) {
    const expectedHex = expectedSpec.slice("sha256$".length);
    try {
      const expectedBuf = Buffer.from(expectedHex, "hex");
      const candidateBuf = crypto.createHash("sha256").update(candidate, "utf8").digest();
      if (candidateBuf.length !== expectedBuf.length) return false;
      return crypto.timingSafeEqual(candidateBuf, expectedBuf);
    } catch {
      return false;
    }
  }

  const a = crypto.createHash("sha256").update(candidate, "utf8").digest();
  const b = crypto.createHash("sha256").update(expectedSpec, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

function getSessionSigningKey(): Buffer {
  const explicit = cleanStr(process.env.ADMIN_SESSION_SECRET);
  if (explicit) {
    return crypto.createHash("sha256").update(`osdr-admin-cookie:${explicit}`).digest();
  }
  const sa = parseServiceAccountFromEnv();
  if (sa) {
    return crypto.createHash("sha256").update(`osdr-admin-cookie:${sa.privateKey}`).digest();
  }
  const passcode = cleanStr(process.env.ADMIN_PASSCODE || process.env.ADMIN_PASSWORD);
  if (passcode) {
    return crypto
      .createHash("sha256")
      .update(`osdr-admin-cookie:${passcode}:${process.env.FIREBASE_PROJECT_ID || "local"}`)
      .digest();
  }
  return PROCESS_EPHEMERAL_HMAC_KEY;
}

export function signAdminSessionToken(
  input: Omit<AdminSessionPayload, "iat" | "exp" | "role">
): { token: string; payload: AdminSessionPayload } {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: AdminSessionPayload = {
    uid: input.uid,
    email: input.email,
    displayName: input.displayName,
    role: "admin",
    authMethod: input.authMethod,
    iat: nowSec,
    exp: nowSec + ADMIN_SESSION_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto
    .createHmac("sha256", getSessionSigningKey())
    .update(body)
    .digest("base64url");
  return { token: `${body}.${sig}`, payload };
}

export function verifyAdminSessionToken(token: string | undefined): AdminSessionPayload | null {
  if (!token || typeof token !== "string") return null;
  const dotIdx = token.indexOf(".");
  if (dotIdx <= 0) return null;

  const body = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!body || !sig) return null;

  const expectedSig = crypto
    .createHmac("sha256", getSessionSigningKey())
    .update(body)
    .digest();
  let actualSig: Buffer;
  try {
    actualSig = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }

  if (actualSig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(actualSig, expectedSig)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AdminSessionPayload;
    if (!parsed || parsed.role !== "admin" || !parsed.uid) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof parsed.exp !== "number" || parsed.exp <= nowSec) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

export function buildAdminCookieHeader(
  token: string,
  req: express.Request,
  maxAgeSeconds = ADMIN_SESSION_TTL_SECONDS
): string {
  const isHttps =
    req.secure ||
    String(req.headers["x-forwarded-proto"] || "")
      .toLowerCase()
      .includes("https");
  const parts = [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (isHttps) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function parseMaxAgeSeconds(cacheControl: string | null): number {
  if (!cacheControl) return 3600;
  const m = cacheControl.match(/max-age=(\d+)/i);
  return m ? Math.max(60, Number(m[1])) : 3600;
}

async function fetchGoogleSecureTokenCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (certCache && certCache.expiresAtMs > now + 5000) {
    return certCache.certs;
  }
  const resp = await fetch(SECURETOKEN_CERTS_URL);
  if (!resp.ok) {
    throw new Error(`Failed to fetch Google Firebase public keys (${resp.status})`);
  }
  const certs = (await resp.json()) as Record<string, string>;
  const ttlSec = parseMaxAgeSeconds(resp.headers.get("cache-control"));
  certCache = {
    certs,
    expiresAtMs: now + ttlSec * 1000,
  };
  return certs;
}

export async function verifyFirebaseJwtWithCerts(
  idToken: string,
  expectedProjectId: string,
  certsProvider: () => Promise<Record<string, string>> = fetchGoogleSecureTokenCerts,
  nowSec: number = Math.floor(Date.now() / 1000)
): Promise<VerifiedFirebaseUser> {
  if (!expectedProjectId) {
    throw new Error("FIREBASE_PROJECT_ID is not configured on the server.");
  }

  const segments = idToken.split(".");
  if (segments.length !== 3) {
    throw new Error("Malformed Firebase ID token.");
  }

  const [headerB64, payloadB64, sigB64] = segments;
  let header: Record<string, any>;
  let payload: Record<string, any>;
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    throw new Error("Unparseable Firebase ID token.");
  }

  if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) {
    throw new Error("Unsupported Firebase token algorithm or missing key ID.");
  }

  const expectedIssuer = `https://securetoken.google.com/${expectedProjectId}`;
  if (payload.aud !== expectedProjectId) {
    throw new Error("Firebase token audience mismatch.");
  }
  if (payload.iss !== expectedIssuer) {
    throw new Error("Firebase token issuer mismatch.");
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0 || payload.sub.length > 128) {
    throw new Error("Firebase token missing valid subject (uid).");
  }
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) {
    throw new Error("Firebase token has expired.");
  }
  if (typeof payload.iat !== "number" || payload.iat > nowSec + 300) {
    throw new Error("Firebase token issued-at timestamp is invalid.");
  }
  if (typeof payload.auth_time !== "number" || payload.auth_time > nowSec + 300) {
    throw new Error("Firebase token auth_time timestamp is invalid.");
  }

  const certs = await certsProvider();
  const pem = certs[header.kid];
  if (!pem) {
    throw new Error("Firebase signing certificate not found for key ID.");
  }

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const validSig = verifier.verify(pem, Buffer.from(sigB64, "base64url"));
  if (!validSig) {
    throw new Error("Invalid Firebase token cryptographic signature.");
  }

  return {
    uid: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    emailVerified: Boolean(payload.email_verified),
    name: typeof payload.name === "string" ? payload.name : null,
    picture: typeof payload.picture === "string" ? payload.picture : null,
    signInProvider:
      typeof payload.firebase?.sign_in_provider === "string"
        ? payload.firebase.sign_in_provider
        : null,
    adminClaim: payload.admin === true || payload.role === "admin",
    roleClaim: typeof payload.role === "string" ? payload.role : null,
    verificationMode: "google_x509_jwt",
    claims: payload,
  };
}

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseUser> {
  const token = cleanStr(idToken);
  if (!token) {
    throw new Error("Missing Bearer ID token.");
  }

  const cfg = getAdminAccessConfig();
  const emulatorHost = cleanStr(process.env.FIREBASE_AUTH_EMULATOR_HOST);

  if (emulatorHost && cfg.projectId) {
    const segments = token.split(".");
    if (segments.length >= 2) {
      try {
        const header = JSON.parse(Buffer.from(segments[0], "base64url").toString("utf8"));
        const payload = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
        const nowSec = Math.floor(Date.now() / 1000);
        if (
          header.alg === "none" &&
          payload.aud === cfg.projectId &&
          typeof payload.sub === "string" &&
          payload.sub.length > 0 &&
          typeof payload.exp === "number" &&
          payload.exp > nowSec
        ) {
          return {
            uid: payload.sub,
            email: typeof payload.email === "string" ? payload.email : null,
            emailVerified: Boolean(payload.email_verified),
            name: typeof payload.name === "string" ? payload.name : null,
            picture: typeof payload.picture === "string" ? payload.picture : null,
            signInProvider:
              typeof payload.firebase?.sign_in_provider === "string"
                ? payload.firebase.sign_in_provider
                : null,
            adminClaim: payload.admin === true || payload.role === "admin",
            roleClaim: typeof payload.role === "string" ? payload.role : null,
            verificationMode: "firebase_auth_emulator",
            claims: payload,
          };
        }
      } catch {
        // Fall through to standard X.509 cert verification
      }
    }
  }

  const verified = await verifyFirebaseJwtWithCerts(token, cfg.projectId);
  if (cfg.hasServiceAccount) {
    return {
      ...verified,
      verificationMode: "firebase_admin_sdk",
    };
  }
  return verified;
}

export function evaluateFirebaseAdminAccess(
  user: VerifiedFirebaseUser,
  providedPasscode?: string
): {
  authorized: boolean;
  reason: string;
  authMethod?: AdminSessionPayload["authMethod"];
  passcodeRequired: boolean;
} {
  const cfg = getAdminAccessConfig();
  const configuredPasscode = cleanStr(process.env.ADMIN_PASSCODE || process.env.ADMIN_PASSWORD);
  const candidatePasscode = cleanStr(providedPasscode);
  const passcodeValid =
    Boolean(configuredPasscode) &&
    Boolean(candidatePasscode) &&
    constantTimeCredentialMatch(candidatePasscode, configuredPasscode);

  const emailLower = user.email ? user.email.toLowerCase() : "";
  const inEmailAllowlist = Boolean(emailLower && cfg.adminEmails.includes(emailLower));
  const inUidAllowlist = Boolean(user.uid && cfg.adminUids.includes(user.uid));

  // If user already holds cryptographic Firebase custom admin claim
  if (user.adminClaim) {
    if (configuredPasscode && candidatePasscode && !passcodeValid) {
      return {
        authorized: false,
        reason: "Invalid admin passcode provided.",
        passcodeRequired: true,
      };
    }
    return {
      authorized: true,
      reason: "Verified Firebase custom admin claim.",
      authMethod: "firebase_custom_claim",
      passcodeRequired: false,
    };
  }

  // UID allowlist check
  if (inUidAllowlist) {
    if (configuredPasscode && !passcodeValid) {
      return {
        authorized: false,
        reason: "Admin UID matched, but valid ADMIN_PASSCODE confirmation is required.",
        passcodeRequired: true,
      };
    }
    return {
      authorized: true,
      reason: "Verified via server ADMIN_UIDS allowlist.",
      authMethod: "firebase_allowlist",
      passcodeRequired: Boolean(configuredPasscode),
    };
  }

  // Email allowlist check (must be verified email unless passcode is explicitly validated)
  if (inEmailAllowlist) {
    if (!user.emailVerified && !passcodeValid) {
      return {
        authorized: false,
        reason:
          "Email matches ADMIN_EMAILS, but the email address is not verified yet (verify email or supply ADMIN_PASSCODE).",
        passcodeRequired: Boolean(configuredPasscode),
      };
    }
    if (configuredPasscode && !passcodeValid) {
      return {
        authorized: false,
        reason: "Email matches ADMIN_EMAILS; enter your server ADMIN_PASSCODE to unlock /admin.",
        passcodeRequired: true,
      };
    }
    return {
      authorized: true,
      reason: "Verified via server ADMIN_EMAILS allowlist.",
      authMethod: "firebase_allowlist",
      passcodeRequired: Boolean(configuredPasscode),
    };
  }

  // Passcode-only elevation when no allowlist restricts accounts, OR email mismatch
  if (configuredPasscode && passcodeValid) {
    if (cfg.adminEmails.length > 0 || cfg.adminUids.length > 0) {
      return {
        authorized: false,
        reason: "Your signed-in Firebase account is not listed in ADMIN_EMAILS / ADMIN_UIDS.",
        passcodeRequired: true,
      };
    }
    return {
      authorized: true,
      reason: "Verified via Firebase session + server ADMIN_PASSCODE.",
      authMethod: "firebase_passcode",
      passcodeRequired: true,
    };
  }

  return {
    authorized: false,
    reason:
      cfg.adminEmails.length || cfg.adminUids.length || configuredPasscode
        ? "Account does not have admin privileges. Use an authorized admin account or valid admin credentials."
        : "No server admin credentials or allowlist configured yet (set ADMIN_EMAILS and/or ADMIN_PASSCODE in .env).",
    passcodeRequired: Boolean(configuredPasscode),
  };
}

export function extractBearerToken(req: express.Request): string {
  const authHeader = cleanStr(String(req.headers.authorization || ""));
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return cleanStr(authHeader.slice(7));
  }
  return "";
}

export function checkAdminRateLimit(req: express.Request): { allowed: boolean; retryAfterSec: number } {
  const ip = cleanStr(String(req.headers["x-forwarded-for"] || req.ip || "local")).split(",")[0].trim();
  const now = Date.now();
  const prev = (failedAdminAttempts.get(ip) || []).filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  failedAdminAttempts.set(ip, prev);

  if (prev.length >= RATE_LIMIT_MAX_ATTEMPTS) {
    const oldest = prev[0];
    const retryAfterSec = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - oldest)) / 1000));
    return { allowed: false, retryAfterSec };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function recordAdminAuthFailure(req: express.Request): void {
  const ip = cleanStr(String(req.headers["x-forwarded-for"] || req.ip || "local")).split(",")[0].trim();
  const now = Date.now();
  const prev = (failedAdminAttempts.get(ip) || []).filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  prev.push(now);
  failedAdminAttempts.set(ip, prev);
}

export function clearAdminAuthFailures(req: express.Request): void {
  const ip = cleanStr(String(req.headers["x-forwarded-for"] || req.ip || "local")).split(",")[0].trim();
  failedAdminAttempts.delete(ip);
}

export function resolveAdminSessionFromRequest(req: express.Request): AdminSessionPayload | null {
  const cookies = parseCookies(req.headers.cookie);
  return verifyAdminSessionToken(cookies[ADMIN_SESSION_COOKIE]);
}

export function getAuthDiagnosticsStatus() {
  const publicCfg = getFirebasePublicClientConfig();
  const adminCfg = getAdminAccessConfig();
  return {
    firebaseClientConfigured: publicCfg.configured,
    projectIdConfigured: Boolean(adminCfg.projectId),
    missingClientFields: publicCfg.missingFields,
    firebaseAdminSdkReady: adminCfg.hasServiceAccount,
    adminAllowlistCount: adminCfg.adminEmails.length + adminCfg.adminUids.length,
    adminPasscodeConfigured: adminCfg.adminPasscodeConfigured,
    directAdminCredentialsConfigured: adminCfg.directAdminCredentialsConfigured,
    authEmulatorActive: Boolean(adminCfg.authEmulatorHost),
  };
}

export function getAdminCredentialsForServerLogin() {
  const cfg = getAdminAccessConfig();
  const expectedSecret = cleanStr(process.env.ADMIN_PASSCODE || process.env.ADMIN_PASSWORD);
  return {
    configured: cfg.directAdminCredentialsConfigured,
    expectedUsername: cfg.adminUsername,
    expectedEmails: cfg.adminEmails,
    expectedSecret,
  };
}

export async function verifyRequestAdminOrCookie(
  req: express.Request
): Promise<AdminSessionPayload | null> {
  const cookieSession = resolveAdminSessionFromRequest(req);
  if (cookieSession) return cookieSession;

  const bearer = extractBearerToken(req);
  if (!bearer) return null;

  try {
    const user = await verifyFirebaseIdToken(bearer);
    const cfg = getAdminAccessConfig();
    if (user.adminClaim || (user.emailVerified && user.email && cfg.adminEmails.includes(user.email.toLowerCase()) && !cfg.adminPasscodeConfigured)) {
      return {
        uid: user.uid,
        email: user.email,
        displayName: user.name,
        role: "admin",
        authMethod: user.adminClaim ? "firebase_custom_claim" : "firebase_allowlist",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export async function mintAdminCustomTokenIfPossible(
  uid: string,
  extraClaims: Record<string, unknown> = { admin: true, role: "admin" }
): Promise<string | null> {
  const sa = parseServiceAccountFromEnv();
  if (!sa) return null;
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    return signServiceAccountJwtRs256(
      {
        iss: sa.clientEmail,
        sub: sa.clientEmail,
        aud: FIREBASE_CUSTOM_TOKEN_AUDIENCE,
        iat: nowSec,
        exp: nowSec + 3600,
        uid,
        claims: extraClaims,
      },
      sa.privateKey
    );
  } catch {
    return null;
  }
}

export async function setFirebaseAdminClaimIfPossible(
  targetUidOrEmail: string,
  grantAdmin: boolean
): Promise<{
  updated: boolean;
  uid?: string;
  email?: string | null;
  admin: boolean;
  reason: string;
}> {
  const sa = parseServiceAccountFromEnv();
  if (!sa) {
    return {
      updated: false,
      admin: grantAdmin,
      reason:
        "Firebase Admin SDK Service Account is not configured (set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY to mutate Firebase Custom Claims).",
    };
  }

  const trimmed = cleanStr(targetUidOrEmail);
  if (!trimmed) {
    throw new Error("Target email or UID is required.");
  }

  const accessToken = await getServiceAccountAccessToken(sa);
  const emulatorHost = cleanStr(process.env.FIREBASE_AUTH_EMULATOR_HOST);
  const baseUrl = emulatorHost
    ? `http://${emulatorHost.replace(/^https?:\/\//, "")}/identitytoolkit.googleapis.com/v1`
    : "https://identitytoolkit.googleapis.com/v1";

  const lookupResp = await fetch(
    `${baseUrl}/projects/${encodeURIComponent(sa.projectId)}/accounts:lookup`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        trimmed.includes("@") ? { email: [trimmed] } : { localId: [trimmed] }
      ),
    }
  );

  if (!lookupResp.ok) {
    const errText = await lookupResp.text().catch(() => "");
    throw new Error(`Firebase user lookup failed (${lookupResp.status}): ${errText.slice(0, 180)}`);
  }

  const lookupData = (await lookupResp.json()) as {
    users?: Array<{ localId: string; email?: string; customAttributes?: string }>;
  };
  const userRecord = lookupData.users?.[0];
  if (!userRecord || !userRecord.localId) {
    throw new Error(`No Firebase user found matching '${trimmed}'.`);
  }

  let existingClaims: Record<string, unknown> = {};
  if (userRecord.customAttributes) {
    try {
      existingClaims = JSON.parse(userRecord.customAttributes);
    } catch {
      existingClaims = {};
    }
  }

  const nextClaims: Record<string, unknown> = {
    ...existingClaims,
    admin: grantAdmin,
    role: grantAdmin ? "admin" : "user",
  };
  if (!grantAdmin) {
    delete nextClaims.admin;
  }

  const updateResp = await fetch(
    `${baseUrl}/projects/${encodeURIComponent(sa.projectId)}/accounts:update`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        localId: userRecord.localId,
        customAttributes: JSON.stringify(nextClaims),
      }),
    }
  );

  if (!updateResp.ok) {
    const errText = await updateResp.text().catch(() => "");
    throw new Error(`Firebase custom claims update failed (${updateResp.status}): ${errText.slice(0, 180)}`);
  }

  return {
    updated: true,
    uid: userRecord.localId,
    email: userRecord.email || null,
    admin: grantAdmin,
    reason: grantAdmin
      ? `Granted persistent Firebase admin claim to ${userRecord.email || userRecord.localId}.`
      : `Revoked Firebase admin claim from ${userRecord.email || userRecord.localId}.`,
  };
}

