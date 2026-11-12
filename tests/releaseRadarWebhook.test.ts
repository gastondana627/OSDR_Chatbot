import assert from "assert";
import http from "http";
import { createExpressApp } from "../server/app";
import {
  evaluateSpaceBiologyScope,
  getRadarSnapshot,
  setRadarSnapshot,
} from "../server/radar";
import {
  __resetRadarWebhookStateForTests,
  diffRadarSnapshots,
  dispatchRadarDropWebhook,
  getRadarMonitorIntervalHours,
  getRadarMonitorIntervalMs,
  signRadarWebhookPayload,
  verifyRadarWebhookSignature,
} from "../server/radarWebhook";

async function runTests() {
  console.log("=== Running 8-Hour Release Radar Monitor & Webhook Tests ===\n");

  const originalSnapshot = structuredClone(getRadarSnapshot());
  const envBackup = {
    RADAR_MONITOR_INTERVAL_HOURS: process.env.RADAR_MONITOR_INTERVAL_HOURS,
    RADAR_WEBHOOK_SECRET: process.env.RADAR_WEBHOOK_SECRET,
    RADAR_WEBHOOK_URL: process.env.RADAR_WEBHOOK_URL,
    RADAR_WEBHOOK_URLS: process.env.RADAR_WEBHOOK_URLS,
    DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL,
    SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL,
    ADMIN_USERNAME: process.env.ADMIN_USERNAME,
    ADMIN_PASSCODE: process.env.ADMIN_PASSCODE,
    ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET,
  };

  const recordedRequests: Array<{
    path: string;
    headers: http.IncomingHttpHeaders;
    body: any;
    rawBody: string;
  }> = [];

  // Local mock receiver acting as generic JSON, Discord webhook & Slack webhook targets
  const mockWebhookReceiver = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      let parsed: any = null;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        parsed = rawBody;
      }
      recordedRequests.push({
        path: req.url || "/",
        headers: req.headers,
        body: parsed,
        rawBody,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise<void>((resolve) => mockWebhookReceiver.listen(0, "127.0.0.1", resolve));
  const receiverPort = (mockWebhookReceiver.address() as any).port;
  const receiverBase = `http://127.0.0.1:${receiverPort}`;

  const app = createExpressApp();
  const apiServer = http.createServer(app);
  await new Promise<void>((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
  const apiPort = (apiServer.address() as any).port;
  const apiBase = `http://127.0.0.1:${apiPort}`;

  try {
    // 1. Default 8-hour monitoring schedule verification
    console.log("Test 1: Default 8-hour monitor cadence & env override");
    delete process.env.RADAR_MONITOR_INTERVAL_HOURS;
    assert.strictEqual(getRadarMonitorIntervalHours(), 8);
    assert.strictEqual(getRadarMonitorIntervalMs(), 8 * 60 * 60 * 1000);
    process.env.RADAR_MONITOR_INTERVAL_HOURS = "12";
    assert.strictEqual(getRadarMonitorIntervalHours(), 12);
    delete process.env.RADAR_MONITOR_INTERVAL_HOURS;
    console.log("  ✔ Default 8-hour interval (28,800,000 ms) verified");

    // 2. Bed Rest + Space Biosciences scope guardrail check
    console.log("Test 2: Bed Rest & Space Biosciences scope guardrail");
    const bedRestEval = evaluateSpaceBiologyScope({
      title: "A Feasibility Study Using Tabular Foundation Models For Health Predictions On NASA/UTMB Bed Rest Data",
      journal: "NASA NTRS (ABSTRACT)",
    });
    assert.strictEqual(bedRestEval.inScope, true);
    const nonSpaceEval = evaluateSpaceBiologyScope({
      title: "Comparison of acne vulgaris topical retinoid outcomes in outpatient dermatology",
      journal: "Dermatology Clinics",
    });
    assert.strictEqual(nonSpaceEval.inScope, false);
    console.log("  ✔ Scope filter admits NASA Bed Rest/Space Biosciences & blocks unrelated clinical junk");

    // 3. Diff detection & multi-target HMAC-signed outbound webhook dispatch
    console.log("Test 3: Snapshot diff & outbound webhook formatting (Generic HMAC, Discord, Slack)");
    const testSecret = "osdr-webhook-hmac-test-secret-001";
    const syntheticDrop = {
      ...originalSnapshot.leadSignals[0],
      id: "ryan-scott-synthetic-nov-2026-drop",
      leadId: "ryan-scott",
      leadName: "Ryan T. Scott",
      spotlight: true,
      title: "Multi-Omic Spaceflight Countermeasure Biomarkers Across NASA OSDR Murine Cohorts",
      journal: "bioRxiv",
      publishedDate: "2026-11-11",
      sourcePlatform: "ORCID + OpenAlex" as const,
      doi: "10.1101/2026.11.11.999999",
      url: "https://doi.org/10.1101/2026.11.11.999999",
      linkedOsdIds: ["OSD-255"],
    };

    const nextSnapshot = {
      ...originalSnapshot,
      leadSignals: [syntheticDrop, ...originalSnapshot.leadSignals],
    };

    const diff = diffRadarSnapshots(originalSnapshot, nextSnapshot);
    assert.strictEqual(diff.newSignals.length, 1);
    assert.strictEqual(diff.spotlightLeadDrops.length, 1);
    assert.strictEqual(diff.spotlightLeadDrops[0].id, syntheticDrop.id);

    // Repeat diff against itself must produce 0 duplicates
    const zeroDiff = diffRadarSnapshots(nextSnapshot, nextSnapshot);
    assert.strictEqual(zeroDiff.newSignals.length, 0);

    const deliveries = await dispatchRadarDropWebhook(diff, {
      triggerSource: "unit_test_dispatch",
      secretOverride: testSecret,
      targetsOverride: [
        { url: `${receiverBase}/json-hook`, type: "generic_json", host: `127.0.0.1:${receiverPort}` },
        { url: `${receiverBase}/api/webhooks/mock/discord`, type: "discord", host: `127.0.0.1:${receiverPort}` },
        { url: `${receiverBase}/services/mock/slack`, type: "slack", host: `127.0.0.1:${receiverPort}` },
      ],
    });

    assert.strictEqual(deliveries.length, 3);
    assert.ok(deliveries.every((d) => d.ok && d.statusCode === 200));
    assert.strictEqual(recordedRequests.length, 3);

    const jsonReq = recordedRequests[0];
    assert.strictEqual(jsonReq.headers["x-osdr-event"], "osdr_radar.lead_drops");
    const sigHeader = String(jsonReq.headers["x-osdr-signature-256"] || "");
    assert.strictEqual(
      verifyRadarWebhookSignature(jsonReq.rawBody, sigHeader, testSecret),
      true,
      "Generic JSON webhook must carry verifiable X-OSDR-Signature-256"
    );
    assert.strictEqual(jsonReq.body.spotlightLeadDropsCount, 1);

    const discordReq = recordedRequests[1];
    assert.ok(Array.isArray(discordReq.body.embeds) && discordReq.body.embeds.length === 1);
    assert.ok(discordReq.body.embeds[0].title.includes("Multi-Omic Spaceflight"));

    const slackReq = recordedRequests[2];
    assert.ok(typeof slackReq.body.text === "string" && slackReq.body.text.includes("Ryan T. Scott"));
    console.log("  ✔ HMAC-SHA256 signature verification, Discord embeds & Slack blocks verified");

    // 4. HTTP Webhook API Security, Scope Filtering, Inbound Push & Secret Isolation
    console.log("Test 4: HTTP /api/awg/radar/webhook* routes, auth & secret isolation");
    recordedRequests.length = 0;
    process.env.RADAR_WEBHOOK_SECRET = testSecret;
    process.env.RADAR_WEBHOOK_URL = `${receiverBase}/relay-secret-path-token-123`;
    process.env.ADMIN_USERNAME = "radar-admin";
    process.env.ADMIN_PASSCODE = "radar-admin-secret-999";
    process.env.ADMIN_SESSION_SECRET = "radar-session-signing-secret-xyz123";

    const statusResp = await fetch(`${apiBase}/api/awg/radar/webhook/status`);
    assert.strictEqual(statusResp.status, 200);
    const statusText = await statusResp.text();
    assert.ok(!statusText.includes("relay-secret-path-token-123"), "Must never leak full webhook secret path/URL");
    assert.ok(!statusText.includes(testSecret), "Must never leak RADAR_WEBHOOK_SECRET");
    const statusJson = JSON.parse(statusText);
    assert.strictEqual(statusJson.intervalHours, 8);
    assert.strictEqual(statusJson.secretArmed, true);
    assert.strictEqual(statusJson.outboundReady, true);
    assert.strictEqual(statusJson.spotlightLead.id, "ryan-scott");

    // Reject unauthenticated push
    const unauthPush = await fetch(`${apiBase}/api/awg/radar/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync_now" }),
    });
    assert.strictEqual(unauthPush.status, 401);

    // Reject forged HMAC signature
    const pushBodyStr = JSON.stringify({
      leadId: "ryan-scott",
      signals: [
        {
          leadId: "ryan-scott",
          title: "NASA OSDR Retinal Transcriptome Harmonization for Spaceflight Multi-Omics",
          journal: "bioRxiv",
          publishedDate: "2026-11-11",
          url: "https://doi.org/10.1101/2026.11.11.888888",
          doi: "10.1101/2026.11.11.888888",
          isPreprint: true,
        },
        {
          leadId: "ryan-scott",
          title: "Outpatient Cosmetic Dermatology Laser Protocol Review",
          journal: "Aesthetic Surgery Journal",
          publishedDate: "2026-11-11",
          url: "https://example.org/non-space-paper",
        },
      ],
    });

    const badSigPush = await fetch(`${apiBase}/api/awg/radar/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OSDR-Signature-256": "sha256=deadbeef",
      },
      body: pushBodyStr,
    });
    assert.strictEqual(badSigPush.status, 401);

    // Accept valid HMAC-signed inbound push, filter off-topic item, update radar & relay outbound
    const validSig = signRadarWebhookPayload(pushBodyStr, testSecret);
    const validPush = await fetch(`${apiBase}/api/awg/radar/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OSDR-Signature-256": validSig,
      },
      body: pushBodyStr,
    });
    assert.strictEqual(validPush.status, 200);
    const pushJson = await validPush.json();
    assert.strictEqual(pushJson.accepted, true);
    assert.strictEqual(pushJson.authMethod, "hmac_signature");
    assert.strictEqual(pushJson.addedSignals.length, 1);
    assert.strictEqual(pushJson.rejectedOutOfScope, 1, "Off-topic dermatology paper must be blocked");
    assert.strictEqual(pushJson.deliveries.length, 1);
    assert.strictEqual(pushJson.deliveries[0].ok, true);
    assert.strictEqual(recordedRequests.length, 1);
    assert.strictEqual(recordedRequests[0].path, "/relay-secret-path-token-123");

    // Verify GET /api/awg/radar serves the newly ingested Ryan T. Scott drop immediately
    const radarResp = await fetch(`${apiBase}/api/awg/radar?lead=ryan-scott`);
    const radarJson = await radarResp.json();
    assert.ok(
      radarJson.filteredLeadSignals.some((s: any) => s.doi === "10.1101/2026.11.11.888888"),
      "Ingested webhook signal must immediately query via GET /api/awg/radar"
    );

    // Admin session can trigger /api/awg/radar/webhook/test without raw secret
    const unauthTest = await fetch(`${apiBase}/api/awg/radar/webhook/test`, { method: "POST" });
    assert.strictEqual(unauthTest.status, 401);

    const adminLogin = await fetch(`${apiBase}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.9.9.9" },
      body: JSON.stringify({ email: "radar-admin", password: "radar-admin-secret-999" }),
    });
    assert.strictEqual(adminLogin.status, 200);
    const adminCookie = (adminLogin.headers.get("set-cookie") || "").split(";")[0];

    const adminPing = await fetch(`${apiBase}/api/awg/radar/webhook/test`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json" },
    });
    assert.strictEqual(adminPing.status, 200);
    const pingJson = await adminPing.json();
    assert.strictEqual(pingJson.authMethod, "admin_session");
    assert.strictEqual(pingJson.outboundConfigured, true);
    assert.strictEqual(pingJson.deliveries[0].ok, true);

    console.log("  ✔ Webhook auth, scope guard, live radar update & /admin test ping passed");
    console.log("\n✅ All 8-Hour Release Radar Monitor & Webhook tests passed!");
  } finally {
    setRadarSnapshot(originalSnapshot);
    __resetRadarWebhookStateForTests();
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await new Promise<void>((resolve) => apiServer.close(() => resolve()));
    await new Promise<void>((resolve) => mockWebhookReceiver.close(() => resolve()));
  }
}

runTests().catch((err) => {
  console.error("❌ Release Radar Webhook test failed:", err);
  process.exit(1);
});

