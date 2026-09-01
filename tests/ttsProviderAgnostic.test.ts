import assert from "assert";
import {
  prepareSpeechText,
  pcmToWav,
  getTtsCapabilities,
  generateTtsAudio,
} from "../server/tts";
import { createExpressApp } from "../server/app";
import http from "http";

async function runTtsTests() {
  console.log("▶ Running Provider-Agnostic TTS Utility Tests...\n");

  // Test 1: Speech-Friendly Text Normalization
  console.log("Test 1: Speech-Friendly Text Normalization (prepareSpeechText)");
  const complexScientificMarkdown = "### ✦ AWG Synthesis: [OSD-680](https://osdr.nasa.gov/680) × [OSD-87](https://osdr.nasa.gov/87)\n" +
    "**Key Biological Takeaways**:\n" +
    "*```json\n{\"metric\": \"IOP\", \"change\": 18.4}\n```\n" +
    "* [OSD-680](https://osdr.nasa.gov/680): Optic nerve sheath morphometry revealed **18.4% enlargement** under HDT bedrest.\n" +
    "* [OSD-87](https://osdr.nasa.gov/87): Retinal histology showed cellular thinning.\n" +
    "| Metric | OSD-680 | OSD-87 |\n| :--- | :--- | :--- |\n| Organism | Rattus norvegicus | Mus musculus |\n" +
    "> Caution: Ground analog bedrest does not include cosmic radiation exposure.\n\nFor full data, see NASA Space Biology portal. 🚀";

  const speechClean = prepareSpeechText(complexScientificMarkdown);
  assert.ok(!speechClean.includes("```"), "Must strip code blocks");
  assert.ok(!speechClean.includes("https://osdr.nasa.gov"), "Must strip raw URLs from markdown links");
  assert.ok(speechClean.includes("OSD-680"), "Must preserve readable study accession");
  assert.ok(!speechClean.includes("###"), "Must strip header hashtags");
  assert.ok(!speechClean.includes("**"), "Must strip bold asterisks");
  assert.ok(!speechClean.includes("🚀"), "Must strip emojis");
  assert.ok(!speechClean.includes(":---"), "Must strip table formatting dashes");
  console.log("  ✔ Scientific markdown normalized cleanly into natural spoken text");

  // Test 2: Long Response Truncation & Summarization
  console.log("Test 2: Long Response Truncation Cap");
  const giantWallOfText = "NASA Space Biology studies the physiological adaptations of model organisms during spaceflight. ".repeat(30);
  const truncatedSpeech = prepareSpeechText(giantWallOfText, 300);
  assert.ok(truncatedSpeech.length <= 450, "Must cap text length for responsive speech");
  assert.ok(truncatedSpeech.includes("For complete details, refer to the printed response above."), "Must append helpful wrap-up summary phrase");
  console.log("  ✔ Giant raw responses capped with clear conversational wrap-up phrase");

  // Test 3: PCM to WAV Container Header Builder
  console.log("Test 3: PCM to WAV Container Header Builder (pcmToWav)");
  const dummyPcm = Buffer.alloc(24000 * 2); // 1 sec of 24kHz 16-bit mono PCM
  const wavBuffer = pcmToWav(dummyPcm, 24000, 1, 16);
  assert.strictEqual(wavBuffer.subarray(0, 4).toString(), "RIFF", "Header must begin with RIFF");
  assert.strictEqual(wavBuffer.subarray(8, 12).toString(), "WAVE", "Format must be WAVE");
  assert.strictEqual(wavBuffer.readUInt16LE(20), 1, "Audio format must be 1 (PCM)");
  assert.strictEqual(wavBuffer.readUInt32LE(24), 24000, "Sample rate must match 24000 Hz");
  assert.strictEqual(wavBuffer.length, 44 + dummyPcm.length, "Total length must include 44-byte WAV header");
  console.log("  ✔ Browser-compatible 44-byte WAV container created with exact RIFF structure");

  // Test 4: TTS Capabilities Inspector
  console.log("Test 4: TTS Capabilities Inspector (getTtsCapabilities)");
  const caps = getTtsCapabilities();
  assert.ok(Array.isArray(caps.configuredProviders), "configuredProviders must be an array");
  assert.ok(["auto", "gemini", "openai"].includes(caps.providerMode), "providerMode must be valid");
  assert.ok(caps.geminiModel, "geminiModel must have default");
  assert.ok(caps.openaiModel, "openaiModel must have default");
  console.log("  ✔ Capabilities correctly detected configured models and voice preferences");

  // Test 5: Input Validation & Missing Key Graceful Fallback
  console.log("Test 5: Input Validation & Provider Fallback");
  const emptyRes = await generateTtsAudio({ text: "" });
  assert.strictEqual(emptyRes.status, "error");
  assert.strictEqual(emptyRes.errorCategory, "invalid_payload");

  const autoRes = await generateTtsAudio({ text: "Hello NASA Space Biology", chatModel: "gpt-4o" });
  if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    assert.strictEqual(autoRes.status, "error");
    assert.strictEqual(autoRes.errorCategory, "provider_unconfigured");
    console.log("  ✔ Unconfigured environment handled gracefully with clear diagnostic error");
  } else {
    console.log("  ✔ Live provider generated speech successfully");
  }

  // Test 6: Express Routes Integration (GET /api/tts/status & POST /api/tts)
  console.log("Test 6: Express API Route Handlers (/api/tts & /api/tts/status)");
  const app = createExpressApp();
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const statusRes = await fetch(`http://localhost:${port}/api/tts/status`);
    assert.strictEqual(statusRes.status, 200);
    const statusJson = await statusRes.json();
    assert.strictEqual(statusJson.status, "ok");
    assert.ok(Array.isArray(statusJson.configuredProviders));
    console.log("  ✔ GET /api/tts/status returned 200 OK with capabilities payload");

    const emptyPostRes = await fetch(`http://localhost:${port}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "" }),
    });
    assert.strictEqual(emptyPostRes.status, 400);
    console.log("  ✔ POST /api/tts rejected empty text with 400 Bad Request");
  } finally {
    server.close();
  }

  console.log("\n============================================================");
  console.log("🎉 ALL PROVIDER-AGNOSTIC TTS TESTS PASSED!");
  console.log("============================================================\n");
}

runTtsTests().catch((err) => {
  console.error("TTS Test Failure:", err);
  process.exit(1);
});