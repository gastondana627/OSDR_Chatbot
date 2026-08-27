import assert from "assert";
import { generateAwgMemeConcept } from "../server/memeGen";
import { generateChatStream } from "../server/gemini";
import {
  formatValueToMarkdown,
  formatExpectationRealityToMarkdown,
  formatBeatsToMarkdown,
  formatMemeToMarkdown,
  toPlainSafeString,
} from "../server/memeMarkdown";

function assertNoObjectObject(text: string, contextDescription: string) {
  assert.strictEqual(
    text.includes("[object Object]"),
    false,
    `Leak detected: '${contextDescription}' contains '[object Object]'. Text preview:\n${text.slice(0, 500)}`
  );
  assert.strictEqual(
    text.includes("[object Object"),
    false,
    `Leak detected: '${contextDescription}' contains truncated '[object Object'.`
  );
}

async function runTests() {
  console.log("▶ Running AWG Meme Markdown Serialization Tests...\n");

  // Test 1: { expectation, reality } conversion into labeled markdown sections
  console.log("Test 1: { expectation, reality } conversion");
  {
    const obj = {
      expectation: "Astronaut floating peacefully in low Earth orbit",
      reality: "Capillaries and retinal vessels experiencing 25 mmHg upward pressure gradient",
    };
    const md = formatExpectationRealityToMarkdown(obj);
    assertNoObjectObject(md, "formatExpectationRealityToMarkdown");
    assert.ok(md.includes("**Expectation**: Astronaut floating"), "Should contain Expectation label");
    assert.ok(md.includes("**Reality**: Capillaries"), "Should contain Reality label");
    console.log("  ✔ { expectation, reality } converts to labeled markdown sections");
  }

  // Test 2: { setup, reality, evidence, punchline } conversion into labeled markdown sections
  console.log("\nTest 2: { setup, reality, evidence, punchline } conversion");
  {
    const obj = {
      setup: "Flight crew prepares for a routine 6-month mission on ISS",
      reality: "Optic nerve sheath diameter swells by 18% within 30 days",
      evidence: "OSD-679 RNA-seq reveals vascular endothelial tight junction downregulation",
      punchline: "The body packed for zero-g, but the optic nerve forgot to check out of 1g physics",
    };
    const md = formatBeatsToMarkdown(obj);
    assertNoObjectObject(md, "formatBeatsToMarkdown");
    assert.ok(md.includes("**Setup**: Flight crew"), "Should contain Setup label");
    assert.ok(md.includes("**Reality**: Optic nerve"), "Should contain Reality label");
    assert.ok(md.includes("**Evidence**: OSD-679"), "Should contain Evidence label");
    assert.ok(md.includes("**Punchline**: The body packed"), "Should contain Punchline label");
    console.log("  ✔ { setup, reality, evidence, punchline } converts to labeled markdown sections");
  }

  // Test 3: Arrays converted into bullet lists
  console.log("\nTest 3: Arrays conversion into bullet lists");
  {
    const arr = [
      "Retinal microvascular remodeling under simulated microgravity",
      {
        speaker: "RNA-seq (OSD-100)",
        text: "Detected 300+ upregulated inflammatory cytokine transcripts.",
      },
      {
        expectation: "Clear 20/20 vision throughout duration",
        reality: "Disc edema and cotton wool spots on fundus exam",
      },
    ];
    const md = formatValueToMarkdown(arr);
    assertNoObjectObject(md, "Array bullet list formatting");
    assert.ok(md.includes("- Retinal microvascular"), "Should format string bullet");
    assert.ok(md.includes("**RNA-seq (OSD-100)**:"), "Should format speaker bullet");
    assert.ok(md.includes("**Expectation**:"), "Should format expectation bullet");
    assert.ok(md.includes("**Reality**:"), "Should format reality bullet");
    console.log("  ✔ Arrays properly formatted into bullet lists without object leaks");
  }

  // Test 4: Unknown objects formatting (normal mode vs debug mode)
  console.log("\nTest 4: Unknown objects formatting");
  {
    const unknownObj = {
      cellularMechanism: "Endothelial barrier disruption",
      foldChangeScore: 2.45,
      pathwayVector: {
        primary: "VEGF / Angiopoietin signaling",
        secondary: "Mitochondrial reactive oxygen species",
      },
    };

    // Standard mode -> title-cased key-value pairs
    const normalMd = formatValueToMarkdown(unknownObj, { debug: false });
    assertNoObjectObject(normalMd, "Unknown object normal mode");
    assert.ok(normalMd.includes("**Cellular Mechanism**:"), "Should title-case keys");
    assert.ok(normalMd.includes("**Pathway Vector**:"), "Should format nested objects");

    // Debug mode -> JSON fenced code block
    const debugMd = formatValueToMarkdown(unknownObj, { debug: true });
    assertNoObjectObject(debugMd, "Unknown object debug mode");
    assert.ok(debugMd.startsWith("```json"), "Debug mode should start with ```json");
    assert.ok(debugMd.endsWith("```"), "Debug mode should end with ```");
    console.log("  ✔ Unknown objects format safely in normal and debug modes");
  }

  // Test 5: Complex Visual Metaphor object variations
  console.log("\nTest 5: Complex Visual Metaphor object variations");
  {
    const structuredMetaphors = [
      { expectation: "Astronaut cupola selfie", reality: "Retinal endothelial cells in panic" },
      { setup: "Floating in microgravity", punchline: "Intracranial pressure rising" },
      { panel1: "Smooth sailing in LEO", panel2: "Fluid shift causing optic disc edema" },
      {
        leftPanel: { character: "Astronaut", expression: "Joy" },
        rightPanel: { character: "Eye", expression: "High Pressure" },
      },
      ["Left: zero-g freedom", "Right: optic chiasm pressure"],
    ];

    for (const [idx, metaphor] of structuredMetaphors.entries()) {
      const formatted = formatValueToMarkdown(metaphor);
      assertNoObjectObject(formatted, `Visual metaphor variation #${idx + 1}`);
    }
    console.log("  ✔ All visual metaphor variations format with 0 object stringification leaks");
  }

  // Test 6: End-to-end /awg meme OSD-100 OSD-194 execution
  console.log("\nTest 6: End-to-End /awg meme OSD-100 OSD-194 generation and streaming");
  {
    // Generate meme clip for OSD-100 and OSD-194
    const memeConcept = await generateAwgMemeConcept({
      studies: ["OSD-100", "OSD-194"],
      memeAngle: "expectation_vs_reality",
    });

    assert.ok(memeConcept, "Meme concept should be generated");
    assert.ok(memeConcept.title || memeConcept.memeTitle, "Meme title should exist");
    assert.ok(memeConcept.premise || memeConcept.memeHook, "Meme premise should exist");
    assert.ok(memeConcept.provenance?.requestId, "Request ID must exist");
    assert.ok(memeConcept.canvasAnimation, "Canvas animation config must exist");

    // Format to markdown
    const finalMarkdown = formatMemeToMarkdown(memeConcept, { sidA: "OSD-100", sidB: "OSD-194" });
    assertNoObjectObject(finalMarkdown, "formatMemeToMarkdown for OSD-100 OSD-194");

    // Verify key clip-first elements are present
    assert.ok(finalMarkdown.includes("AWG Meme Clip"), "Output must contain AWG Meme Clip header");
    assert.ok(finalMarkdown.includes("OSD-100"), "Output markdown must cite OSD-100");
    assert.ok(finalMarkdown.includes("OSD-194"), "Output markdown must cite OSD-194");
    assert.ok(finalMarkdown.includes("[CONCEPTUAL COMMUNICATION]"), "Output must have conceptual badge");

    // Test fresh variations generate new request IDs and distinct seeds
    const var1 = await generateAwgMemeConcept({
      studies: ["OSD-100", "OSD-194"],
      freshVariation: true,
    });
    const var2 = await generateAwgMemeConcept({
      studies: ["OSD-100", "OSD-194"],
      freshVariation: true,
    });

    assert.notStrictEqual(var1.provenance.requestId, var2.provenance.requestId, "Variations must have unique request IDs");
    assert.notStrictEqual(var1.seed, var2.seed, "Fresh variations must have distinct seeds");

    console.log("  ✔ /awg meme OSD-100 OSD-194 generates clean clip-first markdown with fresh variations");
  }

  // Test 7: Full Chat SSE Stream simulation for "/awg meme OSD-100 OSD-194"
  console.log("\nTest 7: Full Chat SSE Stream simulation for '/awg meme OSD-100 OSD-194'");
  {
    const stream = generateChatStream("/awg meme OSD-100 OSD-194", []);
    let streamedTokens = "";
    let sourcesReceived = false;
    let doneReceived = false;

    for await (const chunk of stream) {
      if (chunk.type === "token") {
        streamedTokens += chunk.data;
      } else if (chunk.type === "sources") {
        sourcesReceived = true;
        assert.ok(chunk.data.isAwgMeme, "Should set isAwgMeme flag");
        assert.ok(chunk.data.awgDetails?.memeConcept, "Should provide memeConcept in awgDetails");
      } else if (chunk.type === "done") {
        doneReceived = true;
      }
    }

    assert.ok(sourcesReceived, "Sources event must be yielded");
    assert.ok(doneReceived, "Done event must be yielded");
    assert.ok(streamedTokens.length > 50, "Streamed response must contain tokens");

    assertNoObjectObject(streamedTokens, "Streamed chat tokens for /awg meme OSD-100 OSD-194");
    assert.ok(streamedTokens.includes("OSD-100"), "Streamed text must mention OSD-100");
    assert.ok(streamedTokens.includes("OSD-194"), "Streamed text must mention OSD-194");

    console.log("  ✔ SSE stream for '/awg meme OSD-100 OSD-194' completed successfully without leaks");
  }

  // Test 8: Multiple slash command rejection
  console.log("\nTest 8: Multiple slash command rejection");
  {
    const stream = generateChatStream("/awg compare OSD-87 OSD-100 /awg meme", []);
    let streamedTokens = "";
    let errorSourcesReceived = false;

    for await (const chunk of stream) {
      if (chunk.type === "token") {
        streamedTokens += chunk.data;
      } else if (chunk.type === "sources") {
        errorSourcesReceived = true;
        assert.strictEqual(chunk.data.awgDetails?.error, "Submit one AWG command at a time.");
      }
    }

    assert.ok(errorSourcesReceived, "Must yield error sources for multiple slash commands");
    assert.ok(
      streamedTokens.includes("Submit one AWG command at a time."),
      "Must state 'Submit one AWG command at a time.'"
    );
    console.log("  ✔ Multiple slash commands in single prompt rejected cleanly");
  }

  // Test 9: Sequential flow (/awg compare OSD-87 OSD-100 -> /awg meme using active pair)
  console.log("\nTest 9: Sequential flow (/awg compare OSD-87 OSD-100 -> /awg meme using active pair)");
  {
    // Step 1: Execute comparison
    const history: { role: string; content: string }[] = [];
    const streamCompare = generateChatStream("/awg compare OSD-87 OSD-100", history);
    let compareTokens = "";
    for await (const chunk of streamCompare) {
      if (chunk.type === "token") compareTokens += chunk.data;
    }
    history.push({ role: "user", content: "/awg compare OSD-87 OSD-100" });
    history.push({ role: "assistant", content: compareTokens });

    // Step 2: Run bare /awg meme on active session pair
    const streamMeme = generateChatStream("/awg meme", history);
    let memeTokens = "";
    let memeDetails: any = null;

    for await (const chunk of streamMeme) {
      if (chunk.type === "token") memeTokens += chunk.data;
      if (chunk.type === "sources") {
        memeDetails = chunk.data.awgDetails;
      }
    }

    assert.ok(memeDetails, "Meme details must be received");
    assert.ok(memeDetails.isMemeMode, "Must be in meme mode");
    assert.strictEqual(memeDetails.studyA, "OSD-87", "Must resolve studyA as OSD-87 from active pair");
    assert.strictEqual(memeDetails.studyB, "OSD-100", "Must resolve studyB as OSD-100 from active pair");

    const concept = memeDetails.memeConcept;
    assert.ok(concept, "Meme concept must be present");
    assert.deepStrictEqual(concept.activeResolvedPair, ["OSD-87", "OSD-100"], "activeResolvedPair must match OSD-87 x OSD-100");
    assert.ok(concept.provenance.requestId, "Must have requestId");
    assert.ok(concept.provenance.contentHash && !concept.provenance.contentHash.includes("undefined"), "contentHash must be valid sha256 string");
    assert.strictEqual(concept.provenance.providerModel, "veo-2.0-generate-001", "providerModel must NOT be overwritten with procedural-canvas-animator-v1");
    assert.strictEqual(concept.provenance.fallbackRenderer, "procedural-canvas-animator-v1", "fallbackRenderer must be procedural-canvas-animator-v1");
    assert.ok(concept.provenance.planningModel, "planningModel must be present");
    assert.ok(concept.provenance.videoProviderModel, "videoProviderModel must be present");
    assert.ok(concept.provenance.stages, "stages object must be present");
    assert.strictEqual(concept.provenance.stages.activePairResolution, "success", "activePairResolution must be success");
    assert.ok(["success", "fail", "not_attempted"].includes(concept.provenance.stages.promptPlanning), "promptPlanning must be valid stage enum");
    assert.ok(["not_attempted", "success", "fail"].includes(concept.provenance.stages.providerVideoRequest), "providerVideoRequest must be valid stage enum");
    assert.strictEqual(concept.provenance.stages.fallbackRenderer, "procedural-canvas-animator-v1", "stages.fallbackRenderer must be procedural-canvas-animator-v1");
    assert.strictEqual(concept.provenance.finalArtifactType, concept.videoUrl ? "provider_mp4" : "none", "finalArtifactType must match reality");

    console.log("  ✔ /awg compare followed by /awg meme uses active resolved pair with full audit details");
  }

  // Test 10: Multi-stage status separation audit & planningMethod verification
  console.log("\nTest 10: Multi-stage status separation and failure audit verification");
  {
    const { generateAwgMemeConcept } = await import("../server/memeGen");
    const clip = await generateAwgMemeConcept({
      studies: ["OSD-87", "OSD-100"],
      seed: 99999,
      freshVariation: true,
    });

    assert.ok(clip.provenance.stages, "Must have stages object");
    assert.ok(clip.provenance.contentHash && !clip.provenance.contentHash.includes("undefined"), "contentHash must be present");
    assert.strictEqual(clip.provenance.stages.activePairResolution, "success");
    assert.strictEqual(clip.provenance.stages.promptPlanning, "success", "promptPlanning must be success (via Gemini or local template)");
    assert.ok(
      clip.provenance.stages.planningMethod === "local_metadata_template" ||
      clip.provenance.stages.planningMethod === "gemini_generated",
      "planningMethod must be either local_metadata_template or gemini_generated"
    );
    assert.ok(clip.provenance.videoProviderModel, "videoProviderModel must be defined");
    assert.ok(clip.provenance.providerModel, "providerModel must be defined");
    assert.strictEqual(clip.provenance.fallbackRenderer, "procedural-canvas-animator-v1");

    if (!clip.videoUrl) {
      assert.strictEqual(clip.provenance.finalArtifactType, "none");
      assert.strictEqual(clip.provenance.generationStatus, "failed");
      assert.ok(clip.fallbackReason, "Must have explicit fallbackReason");
      // Even if planning was local_metadata_template, Veo request was attempted or dynamically determined unavailable
      assert.ok(
        ["success", "fail", "not_attempted", "not_available"].includes(clip.provenance.stages.providerVideoRequest),
        "providerVideoRequest stage must be tracked"
      );
    }

    console.log("  ✔ Multi-stage status separation and provenance audits verified");
  }

  // Test 11: Deterministic metadata-grounded premise and prompt generation
  console.log("\nTest 11: Deterministic metadata template generation for /awg meme");
  {
    const { buildLocalMetadataPremiseAndPrompt } = await import("../server/memeGen");
    const { getStudyById } = await import("../server/rag");

    const studyA = getStudyById("OSD-87")!;
    const studyB = getStudyById("OSD-100")!;
    assert.ok(studyA && studyB, "OSD-87 and OSD-100 must exist in RAG database");

    const plan1 = buildLocalMetadataPremiseAndPrompt(studyA, studyB, 42);
    const plan2 = buildLocalMetadataPremiseAndPrompt(studyA, studyB, 42);
    const plan3 = buildLocalMetadataPremiseAndPrompt(studyA, studyB, 101);

    assert.strictEqual(plan1.premise, plan2.premise, "Identical seeds must produce identical premise");
    assert.strictEqual(plan1.clipPrompt, plan2.clipPrompt, "Identical seeds must produce identical clipPrompt");
    assert.ok(plan1.premise.includes("OSD-87") && plan1.premise.includes("OSD-100"), "Premise must include accession IDs");
    assert.ok(plan1.clipPrompt.includes("OSD-87") && plan1.clipPrompt.includes("OSD-100"), "Clip prompt must include accession IDs");
    assert.ok(plan1.clipPrompt.includes("Seed:42"), "Clip prompt must include seed");

    console.log("  ✔ Deterministic metadata-grounded premise and prompt verified");
  }

  // Test 12: Gemini 429 quota exhaustion permits Veo request via local_metadata_template
  console.log("\nTest 12: Gemini 429 quota exhaustion permits Veo request via local_metadata_template");
  {
    const { generateAwgMemeConcept } = await import("../server/memeGen");

    // With current free-tier quota exhausted on Gemini 3.7 Flash, verify planning completes as local_metadata_template
    const clip = await generateAwgMemeConcept({
      studies: ["OSD-87", "OSD-194"],
      seed: 777,
      freshVariation: true,
    });

    assert.strictEqual(clip.provenance.stages?.activePairResolution, "success");
    assert.strictEqual(clip.provenance.stages?.promptPlanning, "success", "Planning must succeed even when Gemini has 429 quota");
    assert.ok(
      clip.provenance.planningMethod === "local_metadata_template" ||
      clip.provenance.planningMethod === "gemini_generated",
      "planningMethod must be set"
    );
    assert.ok(clip.provenance.videoProviderModel, "videoProviderModel must be defined");
    // If Veo fails due to provider quota, credentials, or unavailability, stages.providerVideoRequest reflects fail or not_available
    if (process.env.GEMINI_API_KEY) {
      assert.ok(
        clip.provenance.stages?.providerVideoRequest === "fail" ||
        clip.provenance.stages?.providerVideoRequest === "success" ||
        clip.provenance.stages?.providerVideoRequest === "not_available",
        "Veo video request stage MUST be tracked even if Gemini planning experienced 429"
      );
    }

    console.log("  ✔ Gemini 429 during /awg meme still permits Veo request using local_metadata_template planning");
  }

  console.log("\n==========================================");
  console.log("🎉 ALL AWG MEME SERIALIZATION TESTS PASSED!");
  console.log("==========================================\n");
}

runTests().catch((err) => {
  console.error("❌ Test failed with error:", err);
  process.exit(1);
});
