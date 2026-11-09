import assert from "assert";
import {
  GEMINI_CAPABILITY_REGISTRY,
  isReasoningModel,
  getModelContextWindowTokens,
  resolveBestModelForTask,
  getAllCapabilityRecords,
} from "../server/modelCapabilities";
import {
  FALLBACK_TEXT_MODELS,
  categorizeModelName,
  runModelDiscovery,
} from "../server/modelDiscovery";
import { generateChatStream } from "../server/gemini";
import { getGeminiModelCandidates } from "../server/textProviders";
import { createExpressApp } from "../server/app";
import http from "http";

async function runArgonReasoningTests() {
  console.log("▶ Running Gemini 4 Argon Reasoning & Long-Context Capability Tests...\n");

  // ---------------------------------------------------------------------------
  // Test 1: Capability Registry Registration & Frontier Specifications
  // ---------------------------------------------------------------------------
  console.log("Test 1: Gemini 4 Argon Registration & Frontier Specs");
  const argon = GEMINI_CAPABILITY_REGISTRY["gemini-4-argon"];
  assert.ok(argon, "gemini-4-argon must be registered in GEMINI_CAPABILITY_REGISTRY");
  assert.strictEqual(argon.canonicalId, "gemini-4-argon");
  assert.strictEqual(argon.apiModelName, "gemini-4-argon");
  assert.strictEqual(argon.capabilityType, "text");
  assert.strictEqual(argon.familyLabel, "Gemini 4 Argon");
  assert.strictEqual(argon.priorityRank, 1, "Gemini 4 Argon must be priority rank 1 frontier model");
  assert.strictEqual(argon.contextWindowTokens, 1048576, "Context window must be 1,048,576 tokens (1M)");
  assert.strictEqual(argon.supportsReasoning, true, "Must declare supportsReasoning=true");
  assert.strictEqual(argon.supportsLongDecode, true, "Must declare supportsLongDecode=true");
  assert.ok(argon.displayLabel.includes("Gemini 4 Argon"));
  assert.ok(argon.displayLabel.includes("Frontier Reasoning Flagship"));
  assert.ok(Array.isArray(argon.fallbackIds));
  assert.ok(argon.fallbackIds.includes("gemini-3.7-flash"));
  console.log("  ✔ Gemini 4 Argon registered with 1M-token context window, long decode, and frontier reasoning priority");

  // ---------------------------------------------------------------------------
  // Test 2: Reasoning Model Identifier & Context Window Helpers
  // ---------------------------------------------------------------------------
  console.log("Test 2: Reasoning Model & Context Window Helpers");
  assert.strictEqual(isReasoningModel("gemini-4-argon"), true, "gemini-4-argon must be recognized as reasoning model");
  assert.strictEqual(isReasoningModel("GEMINI-4-ARGON"), true, "Case-insensitive matching for argon");
  assert.strictEqual(isReasoningModel("gemini-2.5-flash"), true, "gemini-2.5-flash has reasoning capabilities");
  assert.strictEqual(isReasoningModel("gemini-3.7-flash"), false, "gemini-3.7-flash is balanced non-thinking");
  assert.strictEqual(isReasoningModel("gpt-4o"), false);
  assert.strictEqual(isReasoningModel(undefined), false);

  assert.strictEqual(getModelContextWindowTokens("gemini-4-argon"), 1048576);
  assert.strictEqual(getModelContextWindowTokens("unknown-model"), 1048576);
  console.log("  ✔ isReasoningModel and getModelContextWindowTokens evaluate models accurately");

  // ---------------------------------------------------------------------------
  // Test 3: Router Resolution for Deep Synthesis & Reasoning Tasks
  // ---------------------------------------------------------------------------
  console.log("Test 3: Router Resolution for Deep Synthesis & Reasoning Tasks");
  const reasoningModel = resolveBestModelForTask("reasoning");
  assert.strictEqual(reasoningModel.canonicalId, "gemini-4-argon");

  const deepSynthModel = resolveBestModelForTask("deep_synthesis");
  assert.strictEqual(deepSynthModel.canonicalId, "gemini-4-argon");

  const multiOmicsModel = resolveBestModelForTask("multi_omics_co_analysis");
  assert.strictEqual(multiOmicsModel.canonicalId, "gemini-4-argon");

  const prefArgon = resolveBestModelForTask("text_chat", { preference: "argon" });
  assert.strictEqual(prefArgon.canonicalId, "gemini-4-argon");

  const prefFrontier = resolveBestModelForTask("text_chat", { preference: "frontier" });
  assert.strictEqual(prefFrontier.canonicalId, "gemini-4-argon");

  const defaultChat = resolveBestModelForTask("text_chat");
  assert.strictEqual(defaultChat.canonicalId, "gemini-3.7-flash");

  const argonCandidates = getGeminiModelCandidates("gemini-4-argon");
  assert.deepStrictEqual(
    argonCandidates.slice(0, 3),
    ["gemini-4-argon", "gemini-3.7-flash", "gemini-2.5-flash"],
    "Within-Gemini fallback candidates must cascade from Argon to 3.7 Flash and 2.5 Flash"
  );
  console.log("  ✔ Router automatically routes deep reasoning and frontier preferences to Gemini 4 Argon");

  // ---------------------------------------------------------------------------
  // Test 4: Model Discovery & Fallback List Verification
  // ---------------------------------------------------------------------------
  console.log("Test 4: Model Discovery & Fallback List Verification");
  assert.ok(FALLBACK_TEXT_MODELS.includes("gemini-4-argon"), "FALLBACK_TEXT_MODELS must include gemini-4-argon");
  assert.strictEqual(FALLBACK_TEXT_MODELS[0], "gemini-4-argon", "gemini-4-argon must be top candidate in fallback list");
  assert.strictEqual(categorizeModelName("gemini-4-argon"), "text_chat");
  assert.strictEqual(categorizeModelName("models/gemini-4-argon"), "text_chat");

  const diag = await runModelDiscovery();
  assert.ok(diag.models.textChat.includes("gemini-4-argon"), "Discovery must surface gemini-4-argon in textChat models");
  console.log("  ✔ Model discovery catalog correctly prioritizes gemini-4-argon in fallback lists and categorization");

  // ---------------------------------------------------------------------------
  // Test 5: Chat Stream Execution with Gemini 4 Argon
  // ---------------------------------------------------------------------------
  console.log("Test 5: Chat Stream Execution with Gemini 4 Argon");
  const stream = generateChatStream(
    "Perform deep cross-study reasoning comparing mouse transcriptomics (OSD-100) and rat ocular pressure (OSD-679)",
    [],
    "gemini-4-argon"
  );

  let sourcesEventReceived = false;
  let modelReportedInSources = "";
  let fullOutput = "";

  for await (const chunk of stream) {
    if (chunk.type === "sources") {
      sourcesEventReceived = true;
      modelReportedInSources = chunk.data.model;
    } else if (chunk.type === "token") {
      fullOutput += chunk.data;
    }
  }

  assert.strictEqual(sourcesEventReceived, true, "Must emit sources event");
  assert.strictEqual(modelReportedInSources, "gemini-4-argon", "Sources event must report requested gemini-4-argon model");
  assert.ok(fullOutput.length > 50, "Chat stream must generate substantial evidence response");
  console.log("  ✔ Chat stream preserves gemini-4-argon model identifier and executes streaming synthesis");

  // ---------------------------------------------------------------------------
  // Test 6: Express Route Integration (GET /api/models)
  // ---------------------------------------------------------------------------
  console.log("Test 6: Express Route Integration (GET /api/models)");
  const app = createExpressApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://localhost:${port}/api/models`);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.ok(Array.isArray(json.models), "Models must be an array");
    assert.ok(json.models.includes("gemini-4-argon"), "/api/models must include gemini-4-argon");
    console.log("  ✔ GET /api/models returns 200 OK with gemini-4-argon included in candidate list");
  } finally {
    server.close();
  }

  console.log("\n============================================================");
  console.log("🎉 ALL GEMINI 4 ARGON REASONING & CAPABILITY TESTS PASSED!");
  console.log("============================================================\n");
}

runArgonReasoningTests().catch((err) => {
  console.error("Gemini 4 Argon Test Failure:", err);
  process.exit(1);
});
