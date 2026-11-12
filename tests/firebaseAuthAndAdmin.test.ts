import crypto from "crypto";
import http from "http";
import { createExpressApp } from "../server/app";
import {
  constantTimeCredentialMatch,
  evaluateFirebaseAdminAccess,
  signAdminSessionToken,
  verifyAdminSessionToken,
  verifyFirebaseJwtWithCerts,
  type VerifiedFirebaseUser,
} from "../server/auth";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

function signTestRs256Jwt(
  payload: Record<string, unknown>,
  privateKeyPem: string,
  kid = "test-key-1"
): string {
  const header = { alg: "RS256", typ: "JWT", kid };
  const headerB64 = Buffer.from(JSON.stringify(header), "utf8").toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${headerB64}.${payloadB64}`);
  signer.end();
  const sigB64 = signer.sign(privateKeyPem).toString("base64url");
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

async function runTests() {
  console.log("=== Running Firebase Auth & Dedicated /admin Security Tests ===");

  const envBackup = {
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
    ADMIN_USERNAME: process.env.ADMIN_USERNAME,
    ADMIN_PASSCODE: process.env.ADMIN_PASSCODE,
    ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET,
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  };

  // Start test server with clean initial env
  delete process.env.ADMIN_EMAILS;
  delete process.env.ADMIN_USERNAME;
  delete process.env.ADMIN_PASSCODE;
  delete process.env.ADMIN_SESSION_SECRET;

  const app = createExpressApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 1. Verify /api/auth/config exposes non-secret config & never leaks admin secrets
    console.log("\n1. Verifying GET /api/auth/config (public metadata & secret isolation)...");
    process.env.ADMIN_PASSCODE = "super-secret-admin-passcode-xyz";
    process.env.ADMIN_EMAILS = "lead-admin@osdr-test.org";
    const cfgResp = await fetch(`${baseUrl}/api/auth/config`);
    assert(cfgResp.status === 200, `/api/auth/config expected 200, got ${cfgResp.status}`);
    const cfgText = await cfgResp.text();
    assert(!cfgText.includes("super-secret-admin-passcode-xyz"), "/api/auth/config leaked ADMIN_PASSCODE!");
    assert(!cfgText.includes("lead-admin@osdr-test.org"), "/api/auth/config leaked ADMIN_EMAILS!");
    const cfgJson = JSON.parse(cfgText);
    assert(cfgJson.status === "ok", "config status ok");
    assert(cfgJson.providers?.emailPassword === true && cfgJson.providers?.google === true, "providers listed");
    assert(cfgJson.adminStatus?.adminPasscodeRequired === true, "adminPasscodeRequired reported safely");
    assert(cfgJson.adminStatus?.adminAllowlistConfigured === true, "adminAllowlistConfigured reported safely");
    console.log("   ✓ /api/auth/config exposes safe client metadata without leaking server secrets");

    // 2. Verify /api/admin/overview and /api/admin/claims reject unauthenticated requests
    console.log("\n2. Verifying unauthenticated rejection on protected /api/admin/* endpoints...");
    const ovUnauth = await fetch(`${baseUrl}/api/admin/overview`);
    assert(ovUnauth.status === 401, `/api/admin/overview unauth expected 401, got ${ovUnauth.status}`);
    const claimsUnauth = await fetch(`${baseUrl}/api/admin/claims`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "user@example.org", grantAdmin: true }),
    });
    assert(claimsUnauth.status === 401, `/api/admin/claims unauth expected 401, got ${claimsUnauth.status}`);
    console.log("   ✓ Protected /api/admin/overview & /api/admin/claims enforce 401 Unauthorized");

    // 3. Verify server-side admin login, HttpOnly cookie lifecycle & overview access
    console.log("\n3. Testing server-side /api/admin/login -> HttpOnly cookie -> /api/admin/overview -> logout...");
    process.env.ADMIN_USERNAME = "osdr-root-admin";
    process.env.ADMIN_SESSION_SECRET = "unit-test-hmac-secret-32bytes-minimum";

    const badLogin = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "10.0.0.10",
      },
      body: JSON.stringify({ email: "osdr-root-admin", password: "wrong-password" }),
    });
    assert(badLogin.status === 401, `bad password expected 401, got ${badLogin.status}`);

    const goodLogin = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "10.0.0.10",
      },
      body: JSON.stringify({ email: "osdr-root-admin", password: "super-secret-admin-passcode-xyz" }),
    });
    assert(goodLogin.status === 200, `valid admin login expected 200, got ${goodLogin.status}`);
    const setCookieHeader = goodLogin.headers.get("set-cookie") || "";
    assert(setCookieHeader.includes("osdr_admin_session="), "Set-Cookie header present");
    assert(setCookieHeader.includes("HttpOnly"), "Cookie marked HttpOnly");
    assert(setCookieHeader.includes("SameSite=Lax"), "Cookie marked SameSite=Lax");
    const cookiePair = setCookieHeader.split(";")[0];

    const sessionResp = await fetch(`${baseUrl}/api/admin/session`, {
      headers: { Cookie: cookiePair },
    });
    const sessionJson = await sessionResp.json();
    assert(sessionJson.authenticated === true && sessionJson.session?.role === "admin", "Admin cookie session recognized");

    const ovAuth = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { Cookie: cookiePair },
    });
    assert(ovAuth.status === 200, `Authenticated /api/admin/overview expected 200, got ${ovAuth.status}`);
    const ovJson = await ovAuth.json();
    assert(ovJson.communitySummary?.contributorsCount >= 2, "Overview returned community summary");
    assert(Boolean(ovJson.osdrDiagnostics?.sourceMode), "Overview returned OSDR diagnostics");

    const claimsNoSa = await fetch(`${baseUrl}/api/admin/claims`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookiePair,
      },
      body: JSON.stringify({ target: "someone@nasa-awg.org", grantAdmin: true }),
    });
    assert(claimsNoSa.status === 503, `Expected 503 when FIREBASE_SERVICE_ACCOUNT_JSON absent, got ${claimsNoSa.status}`);

    const logoutResp = await fetch(`${baseUrl}/api/admin/logout`, {
      method: "POST",
      headers: { Cookie: cookiePair },
    });
    assert(logoutResp.status === 200, "Admin logout returned 200");
    const logoutCookie = logoutResp.headers.get("set-cookie") || "";
    assert(logoutCookie.includes("Max-Age=0"), "Admin logout cleared cookie with Max-Age=0");
    console.log("   ✓ Full /admin login, cookie session, overview telemetry & logout verified cleanly");

    // 4. Verify cryptographic Firebase RS256 ID Token verification & forged token rejection
    console.log("\n4. Testing cryptographic Firebase RS256 JWT signature & claim validation...");
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const projectId = "osdr-test-project";
    const nowSec = Math.floor(Date.now() / 1000);
    const validJwt = signTestRs256Jwt(
      {
        aud: projectId,
        iss: `https://securetoken.google.com/${projectId}`,
        sub: "uid-researcher-42",
        email: "lead-admin@osdr-test.org",
        email_verified: true,
        admin: true,
        role: "admin",
        iat: nowSec - 10,
        auth_time: nowSec - 10,
        exp: nowSec + 3600,
        firebase: { sign_in_provider: "google.com" },
      },
      privateKey
    );

    const verifiedUser = await verifyFirebaseJwtWithCerts(
      validJwt,
      projectId,
      async () => ({ "test-key-1": publicKey }),
      nowSec
    );
    assert(verifiedUser.uid === "uid-researcher-42", "Verified Firebase UID");
    assert(verifiedUser.adminClaim === true, "Detected admin claim");
    assert(verifiedUser.verificationMode === "google_x509_jwt", "Correct verificationMode");

    // Tampered payload
    const [h, p, s] = validJwt.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        aud: projectId,
        iss: `https://securetoken.google.com/${projectId}`,
        sub: "attacker-uid",
        iat: nowSec - 10,
        auth_time: nowSec - 10,
        exp: nowSec + 3600,
      }),
      "utf8"
    ).toString("base64url");
    let rejectedTamper = false;
    try {
      await verifyFirebaseJwtWithCerts(`${h}.${tamperedPayload}.${s}`, projectId, async () => ({ "test-key-1": publicKey }), nowSec);
    } catch {
      rejectedTamper = true;
    }
    assert(rejectedTamper, "Tampered RS256 payload MUST fail verification");

    // alg: none attack
    const algNoneHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT", kid: "test-key-1" }), "utf8").toString("base64url");
    let rejectedAlgNone = false;
    try {
      await verifyFirebaseJwtWithCerts(`${algNoneHeader}.${p}.`, projectId, async () => ({ "test-key-1": publicKey }), nowSec);
    } catch {
      rejectedAlgNone = true;
    }
    assert(rejectedAlgNone, "Unsigned alg:none token MUST be rejected");

    // Expired token
    const expiredJwt = signTestRs256Jwt(
      {
        aud: projectId,
        iss: `https://securetoken.google.com/${projectId}`,
        sub: "uid-expired",
        iat: nowSec - 7200,
        auth_time: nowSec - 7200,
        exp: nowSec - 60,
      },
      privateKey
    );
    let rejectedExpired = false;
    try {
      await verifyFirebaseJwtWithCerts(expiredJwt, projectId, async () => ({ "test-key-1": publicKey }), nowSec);
    } catch {
      rejectedExpired = true;
    }
    assert(rejectedExpired, "Expired Firebase JWT MUST be rejected");
    console.log("   ✓ RS256 verification, tamper rejection, alg:none rejection & expiry enforcement passed");

    // 5. Verify unverified email cannot bypass ADMIN_EMAILS without ADMIN_PASSCODE
    console.log("\n5. Testing evaluateFirebaseAdminAccess & constant-time hashed credential matching...");
    const unverifiedAdminCandidate: VerifiedFirebaseUser = {
      uid: "uid-unverified",
      email: "lead-admin@osdr-test.org",
      emailVerified: false,
      name: "Unverified Account",
      picture: null,
      signInProvider: "password",
      adminClaim: false,
      roleClaim: null,
      verificationMode: "google_x509_jwt",
      claims: {},
    };

    const unverifiedDenied = evaluateFirebaseAdminAccess(unverifiedAdminCandidate);
    assert(unverifiedDenied.authorized === false, "Unverified email without passcode MUST NOT grant admin access");

    const verifiedWithPasscode = evaluateFirebaseAdminAccess(
      { ...unverifiedAdminCandidate, emailVerified: true },
      "super-secret-admin-passcode-xyz"
    );
    assert(verifiedWithPasscode.authorized === true && verifiedWithPasscode.authMethod === "firebase_allowlist", "Verified email + passcode succeeds");

    // Test scrypt$ and sha256$ hashed password specs
    const scryptSalt = "test_salt_123";
    const scryptHex = crypto.scryptSync("strong-pass", scryptSalt, 32).toString("hex");
    assert(constantTimeCredentialMatch("strong-pass", `scrypt$${scryptSalt}$${scryptHex}`), "scrypt$ credential match");
    assert(!constantTimeCredentialMatch("wrong-pass", `scrypt$${scryptSalt}$${scryptHex}`), "scrypt$ mismatch rejected");

    const shaHex = crypto.createHash("sha256").update("strong-pass", "utf8").digest("hex");
    assert(constantTimeCredentialMatch("strong-pass", `sha256$${shaHex}`), "sha256$ credential match");

    // Sign/verify HMAC session token directly
    const signed = signAdminSessionToken({
      uid: "admin-unit",
      email: "lead-admin@osdr-test.org",
      displayName: "Lead Admin",
      authMethod: "server_credentials",
    });
    const decoded = verifyAdminSessionToken(signed.token);
    assert(decoded?.uid === "admin-unit" && decoded?.role === "admin", "HMAC admin cookie round-trip valid");
    assert(verifyAdminSessionToken(`${signed.token}tamper`) === null, "Tampered HMAC cookie rejected");
    console.log("   ✓ Admin allowlist verification, hashed secret specs & HMAC cookies verified");

    // 6. Verify sliding-window rate limiting after 8 consecutive failures on an isolated IP
    console.log("\n6. Verifying /api/admin/login brute-force rate limiter (HTTP 429)...");
    for (let i = 0; i < 8; i++) {
      const r = await fetch(`${baseUrl}/api/admin/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "203.0.113.77",
        },
        body: JSON.stringify({ email: "osdr-root-admin", password: "bad" }),
      });
      assert(r.status === 401, `Attempt ${i + 1} expected 401, got ${r.status}`);
    }
    const blocked = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.77",
      },
      body: JSON.stringify({ email: "osdr-root-admin", password: "super-secret-admin-passcode-xyz" }),
    });
    assert(blocked.status === 429, `9th attempt expected 429 rate_limited, got ${blocked.status}`);
    assert(Boolean(blocked.headers.get("retry-after")), "Retry-After header set on 429 response");
    console.log("   ✓ Admin rate limiter enforces HTTP 429 + Retry-After after 8 failures");

    console.log("\n=======================================================");
    console.log("🎉 ALL FIREBASE AUTH & DEDICATED /ADMIN SECURITY TESTS PASSED!");
    console.log("=======================================================\n");
  } finally {
    // Restore original process env
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    server.close();
  }
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

