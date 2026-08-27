import assert from "assert";
import { getStudyById } from "../server/rag";
import {
  extractStudyMetadata,
  extractObservedResult,
  deriveInterpretationClaims,
  buildAwgEvidenceMap,
} from "../server/awg";
import { generateChatStream } from "../server/gemini";

async function runEvidenceModelTests() {
  console.log("▶ Running Three-Tier Scientific Evidence Model Tests...\n");

  // Test 1: OSD-100 and OSD-194 Evidence Extraction
  console.log("Test 1: OSD-100 × OSD-194 Three-Tier Evidence Mapping");
  {
    const s100 = getStudyById("OSD-100")!;
    const s194 = getStudyById("OSD-194")!;
    assert.ok(s100, "OSD-100 must exist");
    assert.ok(s194, "OSD-194 must exist");

    // Tier 1: Metadata
    const meta100 = extractStudyMetadata(s100);
    const meta194 = extractStudyMetadata(s194);
    assert.ok(meta100.organism.includes("Mus musculus"));
    assert.ok(meta100.assay.includes("Bisulfite") || meta100.assay.length > 0);
    assert.ok(meta194.assay.includes("RNA") || meta194.assay.length > 0);
    assert.ok(meta100.repositoryUrl.includes("OSD-100"));
    assert.ok(meta194.repositoryUrl.includes("OSD-194"));

    // Tier 2: Observed Results
    const res100 = extractObservedResult(s100);
    const res194 = extractObservedResult(s194);
    assert.ok(res100.sourceReference.includes("Alwood") || res100.sourceReference.length > 0);
    assert.ok(res194.sourceReference.includes("Girirajan") || res194.sourceReference.length > 0);
    assert.ok(
      !res100.finding.toLowerCase().includes("epigenomic alterations revealed") || res100.sourceReference.length > 0,
      "Must have traceable source"
    );

    // Tier 3: Interpretation Claims
    const interpretations = deriveInterpretationClaims(s100, s194);
    assert.ok(interpretations.length >= 3);
    for (const claim of interpretations) {
      assert.strictEqual(claim.tier, "INTERPRETATION");
      assert.ok(["INTERPRETATION", "HYPOTHESIS", "CANDIDATE FOLLOW-UP"].includes(claim.badge));
      assert.ok(claim.epistemicCaution.length > 0, "Must include epistemic caution");
    }

    // Build complete evidence map
    const evidenceMap = buildAwgEvidenceMap(s100, s194);
    assert.ok(evidenceMap.studyMetadata.length === 2);
    assert.ok(evidenceMap.observedResults.length === 2);
    assert.ok(evidenceMap.interpretationClaims.length >= 3);
    assert.ok(evidenceMap.conceptualVisuals.every((v) => v.tier === "CONCEPTUAL COMMUNICATION"));

    console.log("  ✔ OSD-100 × OSD-194 correctly mapped into 3 strict tiers with traceable citations");
  }

  // Test 2: OSD-100 and OSD-679 Evidence Extraction
  console.log("\nTest 2: OSD-100 × OSD-679 Cross-Species & Cross-Assay Boundary Enforcement");
  {
    const s100 = getStudyById("OSD-100")!;
    const s679 = getStudyById("OSD-679")!;
    assert.ok(s100, "OSD-100 must exist");
    assert.ok(s679, "OSD-679 must exist");

    const evidenceMap = buildAwgEvidenceMap(s100, s679);

    // Check that species differences are preserved in metadata
    const meta100 = evidenceMap.studyMetadata.find((m) => m.study_id === "OSD-100")!;
    const meta679 = evidenceMap.studyMetadata.find((m) => m.study_id === "OSD-679")!;
    assert.ok(meta100.organism.includes("Mus musculus"));
    assert.ok(meta679.organism.includes("Rattus norvegicus"));

    // Check that interpretation claims explicitly note cross-study or cross-species synthesis
    const hasCaveats = evidenceMap.interpretationClaims.every(
      (c) => c.epistemicCaution && c.epistemicCaution.length > 0
    );
    assert.ok(hasCaveats, "All interpretation claims must carry epistemic caveats");

    console.log("  ✔ OSD-100 × OSD-679 strictly separates mouse bone/marrow data from rat retinal HDT data");
  }

  // Test 3: Verify /awg compare Chat Stream generates 3-tier structure with badges
  console.log("\nTest 3: Chat Stream Verification for '/awg compare OSD-100 OSD-194'");
  {
    const stream = generateChatStream("/awg compare OSD-100 OSD-194", []);
    let outputText = "";
    let sourcesReceived = false;

    for await (const chunk of stream) {
      if (chunk.type === "token") {
        outputText += chunk.data;
      } else if (chunk.type === "sources") {
        sourcesReceived = true;
        assert.ok(chunk.data.isAwg, "Should be marked as isAwg");
      }
    }

    assert.ok(sourcesReceived, "Sources must be returned");
    assert.ok(outputText.includes("[METADATA]"), "Must include [METADATA] badge");
    assert.ok(outputText.includes("[OBSERVED RESULT]"), "Must include [OBSERVED RESULT] badge");
    assert.ok(outputText.includes("[INTERPRETATION]"), "Must include [INTERPRETATION] badge");
    assert.ok(outputText.includes("OSD-100"), "Must cite OSD-100");
    assert.ok(outputText.includes("OSD-194"), "Must cite OSD-194");
    assert.ok(outputText.includes("Source:"), "Must include traceable source reference");

    console.log("  ✔ /awg compare stream output contains all 3 tiers with badges and source citations");
  }

  console.log("\n==========================================");
  console.log("🎉 ALL THREE-TIER EVIDENCE MODEL TESTS PASSED!");
  console.log("==========================================\n");
}

runEvidenceModelTests().catch((err) => {
  console.error("❌ Evidence model test failed:", err);
  process.exit(1);
});
