import assert from "assert";
import {
  GEMINI_CAPABILITY_REGISTRY,
  getAllCapabilityRecords,
  getModelsByCapability,
  getPreferredImageModel,
  getPreferredVideoModel,
  getPreferredComputerUseModel,
  resolveBestModelForTask,
  getCapabilityLabelMap,
} from "../server/modelCapabilities";
import {
  executeComputerUseTask,
  isAllowedDomain,
} from "../server/computerUse";
import { createExpressApp } from "../server/app";
import http from "http";

async function runCapabilityAndComputerUseTests() {
  console.log("▶ Running Capability Registry & Computer Use Preview Tests...\n");

  // -------------------------------------------------------------------------
  // Test 1: Central Capability Registry Verification
  // -------------------------------------------------------------------------
  console.log("Test 1: Central Capability Registry & Labels");
  const allRecords = getAllCapabilityRecords();
  assert.ok(allRecords.length >= 8, "Must contain all primary capability entries");

  // Image Family checks (Nano Banana)
  assert.strictEqual(GEMINI_CAPABILITY_REGISTRY["nano-banana"].displayLabel, "Nano Banana — Gemini 2.5 Flash Preview Image");
  assert.strictEqual(GEMINI_CAPABILITY_REGISTRY["nano-banana-2-lite"].displayLabel, "Nano Banana 2 Lite — Gemini 3.1 Flash Lite Image");
  assert.strictEqual(GEMINI_CAPABILITY_REGISTRY["nano-banana-2"].displayLabel, "Nano Banana 2 — Gemini 3.1 Flash Image");
  assert.strictEqual(GEMINI_CAPABILITY_REGISTRY["nano-banana-pro"].displayLabel, "Nano Banana Pro — Gemini 3 Pro Image");

  // Video Family checks (Veo)
  assert.strictEqual(GEMINI_CAPABILITY_REGISTRY["veo-3-lite-generate-preview"].displayLabel, "Veo 3 Lite Generate");
  assert.strictEqual(GEMINI_CAPABILITY_REGISTRY["veo-3-fast-generate"].displayLabel, "Veo 3 Fast Generate");
  assert.strictEqual(GEMINI_CAPABILITY_REGISTRY["veo-3-generate"].displayLabel, "Veo 3 Generate");

  // Computer Use Family checks
  assert.strictEqual(GEMINI_CAPABILITY_REGISTRY["computer-use-preview"].displayLabel, "Computer Use Preview");
  assert.strictEqual(GEMINI_CAPABILITY_REGISTRY["computer-use-preview"].capabilityType, "computer_use");
  console.log("  ✔ All Gemini capability families (Nano Banana, Veo, Computer Use) correctly registered and labeled");

  // -------------------------------------------------------------------------
  // Test 2: Router Helper Priorities & Defaults
  // -------------------------------------------------------------------------
  console.log("Test 2: Capability Router Resolution Logic");
  const defaultImage = getPreferredImageModel();
  assert.strictEqual(defaultImage.canonicalId, "nano-banana-2-lite", "Balanced default image must be nano-banana-2-lite");

  const speedImage = getPreferredImageModel({ preference: "speed" });
  assert.strictEqual(speedImage.canonicalId, "nano-banana");

  const defaultVideo = getPreferredVideoModel();
  assert.strictEqual(defaultVideo.canonicalId, "veo-3-lite-generate-preview", "Default video must be lowest-quota veo-3-lite-generate-preview");

  const cuModel = getPreferredComputerUseModel();
  assert.strictEqual(cuModel.canonicalId, "computer-use-preview");

  const labelMap = getCapabilityLabelMap();
  assert.ok(labelMap["nano-banana-2-lite"].includes("Nano Banana 2 Lite"));
  assert.ok(labelMap["veo-3-lite-generate-preview"].includes("Veo 3 Lite Generate"));
  assert.ok(labelMap["computer-use-preview"].includes("Computer Use Preview"));
  console.log("  ✔ Router helpers correctly select balanced image, conservative video, and scoped computer use");

  // -------------------------------------------------------------------------
  // Test 3: Domain Safety & Allowlist Guardrails
  // -------------------------------------------------------------------------
  console.log("Test 3: Computer Use Domain Allowlist Guardrails");
  assert.strictEqual(isAllowedDomain("https://osdr.nasa.gov/bio/repo/data/studies/OSD-87"), true);
  assert.strictEqual(isAllowedDomain("https://genelab-data.ndc.nasa.gov/portal"), true);
  assert.strictEqual(isAllowedDomain("https://ncbi.nlm.nih.gov/geo"), true);
  assert.strictEqual(isAllowedDomain("https://unauthorized-crawler-target.com/exploit"), false);
  assert.strictEqual(isAllowedDomain("ftp://insecure-host.xyz"), false);
  console.log("  ✔ Strict domain allowlist correctly enforces NASA OSDR safe browsing policy");

  // -------------------------------------------------------------------------
  // Test 4: Scoped Computer Use Execution (OSD-87 Analysis)
  // -------------------------------------------------------------------------
  console.log("Test 4: Scoped Computer Use Execution on OSD-87");
  const cuResult = await executeComputerUseTask({
    task: "Open the OSDR study page for OSD-87 and summarize visible metadata fields",
    startUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-87",
    mode: "analyze",
    sessionId: "test-cu-session-1",
  });

  assert.strictEqual(cuResult.success, true);
  assert.strictEqual(cuResult.capabilityId, "computer-use-preview");
  assert.strictEqual(cuResult.capabilityLabel, "Computer Use Preview");
  assert.ok(Array.isArray(cuResult.steps), "Steps must be an array");
  assert.ok(cuResult.steps.length >= 3, "Must record at least 3 discrete execution steps");
  assert.strictEqual(cuResult.steps[0].action, "validate_domain_allowlist");
  assert.strictEqual(cuResult.steps[0].status, "success");
  assert.ok(cuResult.extractedData.visibleFields, "Must extract visible metadata fields");
  assert.ok(cuResult.snapshotMetadata, "Must contain snapshot viewport metadata");
  console.log("  ✔ Scoped Computer Use successfully executed 4-step analysis with structured metadata");

  // -------------------------------------------------------------------------
  // Test 5: Computer Use Cooldown Throttle
  // -------------------------------------------------------------------------
  console.log("Test 5: Computer Use Cooldown Throttle");
  const burstResult = await executeComputerUseTask({
    task: "Repeat task",
    sessionId: "test-cu-session-1",
  });
  assert.strictEqual(burstResult.success, false);
  assert.ok(burstResult.error?.includes("cooldown"));
  console.log("  ✔ Rapid burst requests throttled with structured cooldown reason");

  // -------------------------------------------------------------------------
  // Test 6: Express Route Integration (GET /api/capabilities & POST /api/computer-use)
  // -------------------------------------------------------------------------
  console.log("Test 6: Express Route Integration (/api/capabilities & /api/computer-use)");
  const app = createExpressApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    // GET /api/capabilities
    const capRes = await fetch(`http://localhost:${port}/api/capabilities`);
    assert.strictEqual(capRes.status, 200);
    const capJson = await capRes.json();
    assert.strictEqual(capJson.status, "ok");
    assert.ok(Array.isArray(capJson.capabilities));
    assert.ok(capJson.labelMap["nano-banana-2-lite"]);
    console.log("  ✔ GET /api/capabilities returned 200 OK with full registry and label map");

    // POST /api/computer-use (empty task -> 400)
    const emptyRes = await fetch(`http://localhost:${port}/api/computer-use`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "" }),
    });
    assert.strictEqual(emptyRes.status, 400);
    console.log("  ✔ POST /api/computer-use rejected empty task with 400 Bad Request");

    // POST /api/computer-use (valid task -> 200)
    const validRes = await fetch(`http://localhost:${port}/api/computer-use`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "Inspect OSD-680 optic nerve sheath morphometry",
        startUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-680",
        mode: "analyze",
      }),
    });
    assert.strictEqual(validRes.status, 200);
    const validJson = await validRes.json();
    assert.strictEqual(validJson.success, true);
    assert.strictEqual(validJson.capabilityLabel, "Computer Use Preview");
    console.log("  ✔ POST /api/computer-use executed end-to-end with 200 OK and step telemetry");
  } finally {
    server.close();
  }

  console.log("\n============================================================");
  console.log("🎉 ALL CAPABILITY ROUTER & COMPUTER USE TESTS PASSED!");
  console.log("============================================================\n");
}

runCapabilityAndComputerUseTests().catch((err) => {
  console.error("Capability & Computer Use Test Failure:", err);
  process.exit(1);
});