import { createExpressApp } from "../server/app";
import {
  classifyProviderError,
  detectPreferredProviderFromModel,
  getGeminiModelCandidates,
  getGroqModelCandidates,
  getOpenRouterModelCandidates,
  resolveProviderCascadeOrder,
} from "../server/textProviders";
import http from "http";

async function testDegradedStates() {
  console.log("=== Testing Degraded State & Exception Handling ===");
  const app = createExpressApp();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 1. Diagnostics endpoint degraded check
    console.log("1. Checking /api/diagnostics structure...");
    const rDiag = await fetch(`${baseUrl}/api/diagnostics`);
    if (rDiag.status !== 200) throw new Error(`/api/diagnostics returned ${rDiag.status}`);
    const dataDiag = await rDiag.json();
    if (dataDiag.routeEntered !== true) throw new Error(`routeEntered is not true in /api/diagnostics`);
    if (typeof dataDiag.providerRegistryLoaded !== "boolean") throw new Error(`providerRegistryLoaded is not boolean`);
    console.log("   ✓ /api/diagnostics returned valid structured metadata");

    // 2. OSDR Diagnostics structure check
    console.log("2. Checking /api/osdr/diagnostics structure...");
    const rOsdr = await fetch(`${baseUrl}/api/osdr/diagnostics`);
    if (rOsdr.status !== 200) throw new Error(`/api/osdr/diagnostics returned ${rOsdr.status}`);
    const dataOsdr = await rOsdr.json();
    if (dataOsdr.routeEntered !== true || dataOsdr.providerRegistryLoaded !== true) {
      throw new Error(`Invalid structured fields in /api/osdr/diagnostics`);
    }
    console.log("   ✓ /api/osdr/diagnostics returned valid structured metadata");

    // 3. POST /api/chat with empty payload (should be 400 with structured JSON, never 500)
    console.log("3. Checking /api/chat with empty message payload...");
    const rChatEmpty = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "", history: [] }),
    });
    if (rChatEmpty.status !== 400) throw new Error(`/api/chat with empty body returned status ${rChatEmpty.status} instead of 400`);
    const dataChatEmpty = await rChatEmpty.json();
    if (dataChatEmpty.routeEntered !== true || dataChatEmpty.errorCategory !== "payload_error") {
      throw new Error(`Invalid structured error for empty chat payload: ${JSON.stringify(dataChatEmpty)}`);
    }
    console.log("   ✓ /api/chat empty payload returned safe 400 with structured metadata");

    // 4. POST /api/osdr/test-connection
    console.log("4. Checking /api/osdr/test-connection structure...");
    const rTestConn = await fetch(`${baseUrl}/api/osdr/test-connection`, { method: "POST" });
    if (rTestConn.status !== 200) throw new Error(`/api/osdr/test-connection returned status ${rTestConn.status}`);
    const dataTest = await rTestConn.json();
    if (dataTest.osdrPingAttempted !== true) throw new Error(`osdrPingAttempted is not true`);
    console.log("   ✓ /api/osdr/test-connection returned structured response with osdrPingAttempted=true");

    // 5. Verify free-tier OpenRouter ':free' candidate ordering & empty-callback classification
    console.log("5. Verifying OpenRouter free-tier candidate priority & empty-callback classification...");
    const orCandidates = getOpenRouterModelCandidates("meta-llama/llama-3.3-70b-instruct");
    if (orCandidates[0] !== "meta-llama/llama-3.3-70b-instruct:free") {
      throw new Error(`Expected first OpenRouter candidate to be :free tier, got ${orCandidates[0]}`);
    }
    const geminiCandidates = getGeminiModelCandidates("gemini-4-argon");
    if (!geminiCandidates.includes("gemini-3.7-flash") || !geminiCandidates.includes("gemini-2.5-flash")) {
      throw new Error(`Expected Gemini fallback chain to include 3.7-flash & 2.5-flash: ${geminiCandidates.join(", ")}`);
    }
    const emptyErr = classifyProviderError("gemini", new Error("GEMINI (gemini-4-argon) returned an empty stream callback (0 tokens)."));
    if (emptyErr.category !== "empty_response") {
      throw new Error(`Expected empty callback to classify as empty_response, got ${emptyErr.category}`);
    }
    if (detectPreferredProviderFromModel("openrouter/free") !== "openrouter") {
      throw new Error("Expected openrouter/free to route to openrouter");
    }
    if (detectPreferredProviderFromModel("google/gemma-4-31b-it:free") !== "openrouter") {
      throw new Error("Expected google/gemma-4-31b-it:free to route to openrouter");
    }
    if (detectPreferredProviderFromModel("nvidia/nemotron-3-ultra-550b-a55b:free") !== "openrouter") {
      throw new Error("Expected nvidia/nemotron-3-ultra-550b-a55b:free to route to openrouter");
    }
    const cascadeFromGemini = getOpenRouterModelCandidates("gemini-4-argon");
    if (cascadeFromGemini[0] !== "openrouter/free") {
      throw new Error(`Expected Gemini cascade to OpenRouter to start with openrouter/free, got ${cascadeFromGemini[0]}`);
    }
    if (detectPreferredProviderFromModel("groq/llama-3.3-70b-versatile") !== "groq") {
      throw new Error("Expected groq/llama-3.3-70b-versatile to route to groq");
    }
    const orOrder = resolveProviderCascadeOrder("openrouter/free");
    if (orOrder[0] !== "openrouter" || orOrder[1] !== "gemini") {
      throw new Error(`Unexpected cascade order for OpenRouter model: ${orOrder.join(" -> ")}`);
    }
    const groqCandidates = getGroqModelCandidates("groq/llama-3.1-8b-instant");
    if (groqCandidates[0] !== "llama-3.1-8b-instant") {
      throw new Error(`Expected groq/ prefix to strip cleanly: ${groqCandidates.join(", ")}`);
    }
    console.log("   ✓ Free-tier ':free' OpenRouter ordering, openrouter/free router & empty-callback cascade verified");

    // 6. Verify Study Discovery & Evidence Search queries return grounded IOP / OSD-87 metadata (never hijacked by 'better/worse' template)
    console.log("6. Verifying Study Discovery & Evidence Search SSE chat streaming...");
    const rIop = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        message: "Which studies measured intraocular pressure during spaceflight?",
        history: [],
        model: "gemini-3.7-flash",
      }),
    });
    if (rIop.status !== 200) throw new Error(`IOP study discovery returned ${rIop.status}`);
    const iopStreamText = await rIop.text();
    if (!iopStreamText.includes("event: sources") || !iopStreamText.includes("event: done")) {
      throw new Error("IOP study discovery SSE stream missing sources or done events");
    }
    if (iopStreamText.includes("not framed as") && iopStreamText.includes("Contextual Evaluation")) {
      throw new Error("IOP 'Which studies...' query was mistakenly hijacked by the Contextual Evaluation comparison template!");
    }
    if (!iopStreamText.includes("OSD-583") && !iopStreamText.includes("OSD-679")) {
      throw new Error("IOP study discovery stream missing expected OSDR citations");
    }

    const rOsd87 = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        message: "Tell me about mouse retina gene expression in STS-135 (OSD-87).",
        history: [],
        model: "gemini-3.7-flash",
      }),
    });
    if (rOsd87.status !== 200) throw new Error(`OSD-87 study discovery returned ${rOsd87.status}`);
    const osd87Text = await rOsd87.text();
    if (!osd87Text.includes("OSD-87") || !osd87Text.includes("event: done")) {
      throw new Error("OSD-87 study discovery stream did not cite OSD-87 or complete cleanly");
    }
    console.log("   ✓ Study Discovery & Evidence Search queries (IOP & OSD-87) stream grounded OSDR citations cleanly");

    console.log("\n🎉 ALL DEGRADED STATE TESTS PASSED!\n");
  } finally {
    server.close();
  }
}

testDegradedStates().catch((err) => {
  console.error("Degraded test failure:", err);
  process.exit(1);
});
