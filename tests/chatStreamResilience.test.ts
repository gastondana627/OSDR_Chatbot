import assert from "assert";
import fs from "fs";
import path from "path";
import { generateChatStream } from "../server/gemini";
import {
  isProviderInCooldown,
  resetProviderHealthState,
  resolveRuntimeProviderOrder,
  streamTextWithFallback,
} from "../server/textProviders";
import { AWG_RESEARCH_PRESETS } from "../server/awg";

function makeOpenAiSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`)
        );
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function runChatStreamResilienceTests() {
  console.log("▶ Running Chat Stream Timeout, Cascade & UX Resilience Tests...\n");

  const origFetch = globalThis.fetch;
  const origEnv = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
  };

  try {
    // -------------------------------------------------------------------------
    // Test 1: Hung OpenRouter stream times out fast & cascades cleanly to Groq
    // -------------------------------------------------------------------------
    console.log("Test 1: Hung upstream provider aborts cleanly within firstTokenTimeoutMs & cascades to Groq");
    resetProviderHealthState();
    delete process.env.GEMINI_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-or-key";
    process.env.GROQ_API_KEY = "test-groq-key";

    let openrouterAborted = false;
    let groqCalled = false;

    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("openrouter.ai")) {
        return await new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            openrouterAborted = true;
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }
      if (url.includes("api.groq.com")) {
        groqCalled = true;
        return makeOpenAiSseResponse(["OSD-680 ", "and OSD-557 ", "ground analog synthesis."]);
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as any;

    const t0 = Date.now();
    const events1: Array<{ type: string; data: any }> = [];
    for await (const evt of streamTextWithFallback(
      {
        prompt: "Compare OSD-680 and OSD-557",
        preferredModel: "openrouter/free",
      },
      () => "Local deterministic fallback text",
      undefined,
      { firstTokenTimeoutMs: 350, totalCascadeBudgetMs: 4000, maxCandidatesPerProvider: 1 }
    )) {
      events1.push(evt);
    }
    const elapsed1 = Date.now() - t0;

    const providerEvt1 = events1.find((e) => e.type === "provider_selected");
    const tokens1 = events1.filter((e) => e.type === "token").map((e) => e.data).join("");
    const done1 = events1.some((e) => e.type === "done");

    assert.strictEqual(openrouterAborted, true, "Hung OpenRouter request must be aborted on timeout");
    assert.strictEqual(groqCalled, true, "Cascade must reach Groq after OpenRouter timeout");
    assert.strictEqual(providerEvt1?.data?.provider, "groq", `Expected groq fallback, got ${providerEvt1?.data?.provider}`);
    assert.strictEqual(providerEvt1?.data?.fallbackTriggered, true, "fallbackTriggered must be true");
    assert.ok(tokens1.includes("OSD-680"), `Expected streamed Groq tokens, got: ${tokens1}`);
    assert.strictEqual(done1, true, "Stream must emit done event");
    assert.ok(elapsed1 < 2500, `Cascade took too long: ${elapsed1}ms`);
    assert.strictEqual(isProviderInCooldown("openrouter"), true, "Timed-out OpenRouter must enter cooldown");
    console.log(`  ✔ Hung OpenRouter aborted & cascaded to Groq in ${elapsed1}ms`);

    // -------------------------------------------------------------------------
    // Test 2: Cooldown demotes failing provider so subsequent request hits Groq immediately
    // -------------------------------------------------------------------------
    console.log("Test 2: Cooldown demotion routes next request directly to healthy provider");
    const runtimeOrder = resolveRuntimeProviderOrder("openrouter/free");
    assert.strictEqual(runtimeOrder[0], "gemini", "Healthy non-cooled providers move ahead of cooled openrouter");
    assert.ok(
      runtimeOrder.indexOf("groq") < runtimeOrder.indexOf("openrouter"),
      `Expected groq before cooled openrouter, got ${runtimeOrder.join(" -> ")}`
    );
    console.log(`  ✔ Runtime order with OpenRouter in cooldown: ${runtimeOrder.join(" -> ")}`);

    // -------------------------------------------------------------------------
    // Test 3: All remote providers return 503 or stall -> guaranteed local_deterministic fallback
    // -------------------------------------------------------------------------
    console.log("Test 3: Total outage across all remote providers guarantees local_deterministic + done");
    resetProviderHealthState();
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: { message: "Upstream 503 overloaded" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;

    const events3: Array<{ type: string; data: any }> = [];
    const t3 = Date.now();
    for await (const evt of streamTextWithFallback(
      { prompt: "Summarize OSD-583", preferredModel: "groq/openai/gpt-oss-120b" },
      () => "Curated deterministic OSD-583 ocular pressure summary.",
      undefined,
      { firstTokenTimeoutMs: 350, totalCascadeBudgetMs: 3000, maxCandidatesPerProvider: 1 }
    )) {
      events3.push(evt);
    }
    const elapsed3 = Date.now() - t3;
    const providerEvt3 = events3.find((e) => e.type === "provider_selected");
    const tokens3 = events3.filter((e) => e.type === "token").map((e) => e.data).join("");
    assert.strictEqual(providerEvt3?.data?.provider, "local_deterministic");
    assert.strictEqual(providerEvt3?.data?.isLocalFallback, true);
    assert.ok(tokens3.includes("OSD-583"));
    assert.strictEqual(events3.some((e) => e.type === "done"), true);
    assert.ok(elapsed3 < 2000, `Total outage fallback took too long: ${elapsed3}ms`);
    console.log(`  ✔ Total remote outage fell back cleanly to local_deterministic in ${elapsed3}ms`);

    // -------------------------------------------------------------------------
    // Test 4: All 4 AWG Research Presets (including flight-vs-sans-analog) stream cleanly & fast
    // -------------------------------------------------------------------------
    console.log("Test 4: All 4 AWG Research Presets stream grounded studies + done cleanly");
    resetProviderHealthState();
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GROQ_API_KEY;
    globalThis.fetch = origFetch;

    for (const preset of AWG_RESEARCH_PRESETS) {
      const pStart = Date.now();
      let sourcesStudies: string[] = [];
      let text = "";
      let sawDone = false;
      for await (const evt of generateChatStream(`/awg preset ${preset.id}`, [], "gemini-4-argon")) {
        if (evt.type === "sources") sourcesStudies = evt.data.studies || [];
        if (evt.type === "token") text += evt.data;
        if (evt.type === "done") sawDone = true;
      }
      const pElapsed = Date.now() - pStart;
      assert.deepStrictEqual(sourcesStudies, preset.accessions, `Preset ${preset.id} sources mismatch`);
      assert.ok(text.length > 200, `Preset ${preset.id} output too short (${text.length} chars)`);
      for (const acc of preset.accessions) {
        assert.ok(text.includes(acc), `Preset ${preset.id} response must mention ${acc}`);
      }
      assert.strictEqual(sawDone, true, `Preset ${preset.id} must emit done`);
      assert.ok(pElapsed < 500, `Preset ${preset.id} deterministic stream took ${pElapsed}ms (>500ms)`);
      console.log(`  ✔ Preset '${preset.id}' (${preset.accessions.join("/")}) completed in ${pElapsed}ms (${text.length} chars)`);
    }

    // -------------------------------------------------------------------------
    // Test 5: /awg help streams instantaneously (<500ms, no 9.4s per-word sleep)
    // -------------------------------------------------------------------------
    console.log("Test 5: /awg help completes without artificial word-by-word delay");
    const hStart = Date.now();
    let helpText = "";
    let helpDone = false;
    for await (const evt of generateChatStream("/awg help", [])) {
      if (evt.type === "token") helpText += evt.data;
      if (evt.type === "done") helpDone = true;
    }
    const hElapsed = Date.now() - hStart;
    assert.strictEqual(helpDone, true);
    assert.ok(helpText.length > 500, "Help response must contain full command reference");
    assert.ok(hElapsed < 500, `/awg help took ${hElapsed}ms (expected <500ms)`);
    console.log(`  ✔ /awg help streamed ${helpText.length} chars in ${hElapsed}ms`);

    // -------------------------------------------------------------------------
    // Test 6: Home Launchpad scroll guard & client streamChat abort watchdog
    // -------------------------------------------------------------------------
    console.log("Test 6: Verifying Home scroll guard (src/App.jsx) & client stream watchdog (src/api.js)");
    const appSrc = fs.readFileSync(path.resolve(process.cwd(), "src/App.jsx"), "utf8");
    assert.ok(
      appSrc.includes("el.scrollTo(0, 0)") && appSrc.includes("(active?.messages?.length || 0) === 0"),
      "src/App.jsx must scroll empty Home Launchpad to top (0, 0) instead of bottom"
    );
    const apiSrc = fs.readFileSync(path.resolve(process.cwd(), "src/api.js"), "utf8");
    assert.ok(
      apiSrc.includes("AbortController") && apiSrc.includes("STREAM_INACTIVITY_TIMEOUT_MS") && apiSrc.includes("finishOnce"),
      "src/api.js streamChat must guard against stalled streams with AbortController + finishOnce"
    );
    console.log("  ✔ Home scroll guard and client-side stream watchdog verified");

    console.log("\n============================================================");
    console.log("🎉 ALL CHAT STREAM RESILIENCE TESTS PASSED!");
    console.log("============================================================\n");
  } finally {
    globalThis.fetch = origFetch;
    if (origEnv.GEMINI_API_KEY !== undefined) process.env.GEMINI_API_KEY = origEnv.GEMINI_API_KEY;
    else delete process.env.GEMINI_API_KEY;
    if (origEnv.OPENROUTER_API_KEY !== undefined) process.env.OPENROUTER_API_KEY = origEnv.OPENROUTER_API_KEY;
    else delete process.env.OPENROUTER_API_KEY;
    if (origEnv.GROQ_API_KEY !== undefined) process.env.GROQ_API_KEY = origEnv.GROQ_API_KEY;
    else delete process.env.GROQ_API_KEY;
    resetProviderHealthState();
  }
}

runChatStreamResilienceTests().catch((err) => {
  console.error("Chat Stream Resilience Test Failure:", err);
  process.exit(1);
});
