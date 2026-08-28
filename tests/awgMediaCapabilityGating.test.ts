import assert from "assert";
import { getStudyById } from "../server/rag";
import {
  derivePairCapabilities,
  buildGroundedMediaPlan,
  generateStudyBriefVideo,
  generateTranslationalClip,
  createDataVizSvg,
  createBiologicalConceptSvg,
  createContextualNarrativeSvg,
  createAccessionSummarySvg,
  containsProhibitedTerms,
  PROHIBITED_CAPABILITY_TERMS,
  getDiversitySeed,
} from "../server/mediaGen";
import { buildAwgEvidenceMap, AWG_SYSTEM_PROMPT } from "../server/awg";

async function runCapabilityGatingTests() {
  console.log("▶ Running AWG Media Capability Gating Tests for Imaging/Physiology-Only Pairs...\n");

  const studyA = getStudyById("OSD-679")!;
  const studyB = getStudyById("OSD-680")!;

  assert.ok(studyA, "OSD-679 must exist in study repository");
  assert.ok(studyB, "OSD-680 must exist in study repository");

  // Test 1: Capability Derivation
  console.log("Test 1: Derive pair capabilities for OSD-679 × OSD-680");
  const caps = derivePairCapabilities(studyA, studyB);
  assert.strictEqual(caps.isImagingPhysiologyOnly, true, "Must be flagged as isImagingPhysiologyOnly");
  assert.strictEqual(caps.hasAnyOmics, false, "Must have no omics assays");
  assert.strictEqual(caps.hasTranscriptomics, false, "Must have no transcriptomics");
  assert.strictEqual(caps.hasProteomics, false, "Must have no proteomics");
  assert.strictEqual(caps.hasMetabolomics, false, "Must have no metabolomics");
  assert.strictEqual(caps.hasMethylation, false, "Must have no methylation");
  assert.strictEqual(caps.hasImaging, true, "Must have imaging capability");
  assert.strictEqual(caps.hasPhysiology, true, "Must have physiology capability");
  assert.strictEqual(caps.hasOpticNerveMorphometry, true, "Must have optic nerve morphometry capability");
  assert.strictEqual(caps.hasVerifiedMechanisticFindings, false, "Must have no verified mechanistic findings");
  console.log("  ✔ OSD-679 × OSD-680 capabilities correctly derived as imaging/physiology-only");

  // Test 2: Grounded Media Plan Gating
  console.log("Test 2: Media Plan Gating & 4 Safe Cards");
  const plan = buildGroundedMediaPlan(studyA, studyB);
  assert.strictEqual(plan.theme, "Ocular Imaging and Optic-Nerve Morphology in a Ground-Based Fluid-Shift Analog");
  assert.strictEqual(plan.items.length, 4, "Must generate exactly 4 cards");
  assert.strictEqual(plan.items[0].title, "OCT/IOP Measures × Optic-Nerve MRI");
  assert.strictEqual(plan.items[1].title, "Eye Structure and Optic-Nerve Morphology");
  assert.strictEqual(plan.items[2].title, "Ground-Analog Imaging Context");
  assert.strictEqual(plan.items[3].title, "Comparative Study Profile");

  const planJson = JSON.stringify(plan);
  const violationsPlan = containsProhibitedTerms(planJson, caps);
  if (violationsPlan.length > 0) {
    console.log("Violations found in planJson:", violationsPlan);
    for (const v of violationsPlan) {
      const idx = planJson.toLowerCase().indexOf(v);
      console.log(`Context for '${v}':`, planJson.slice(Math.max(0, idx - 60), idx + 80));
    }
  }
  assert.deepStrictEqual(violationsPlan, [], `Plan contains prohibited terms: ${violationsPlan.join(", ")}`);
  for (const term of PROHIBITED_CAPABILITY_TERMS) {
    const regex = new RegExp(`\\b${term}\\b`, "i");
    assert.strictEqual(regex.test(planJson), false, `Plan leaked term: ${term}`);
  }
  console.log("  ✔ Grounded media plan contains zero prohibited terms and safe card titles");

  // Test 3: Procedural SVGs Gating
  console.log("Test 3: Procedural SVGs Generation & Sanitation");
  const dataVizSeed = getDiversitySeed("OSD-679", "OSD-680", "data_visualization", 0, 0, caps);
  const svg1 = decodeURIComponent(createDataVizSvg(studyA, studyB, dataVizSeed.variation, caps));
  const v1 = containsProhibitedTerms(svg1, caps);
  assert.deepStrictEqual(v1, [], `Data viz SVG contains prohibited terms: ${v1.join(", ")}`);

  const bioConceptSeed = getDiversitySeed("OSD-679", "OSD-680", "biological_concept", 1, 0, caps);
  const svg2 = decodeURIComponent(createBiologicalConceptSvg(studyA, studyB, bioConceptSeed.variation, caps));
  const v2 = containsProhibitedTerms(svg2, caps);
  assert.deepStrictEqual(v2, [], `Bio concept SVG contains prohibited terms: ${v2.join(", ")}`);

  const contextSeed = getDiversitySeed("OSD-679", "OSD-680", "contextual_narrative", 2, 0, caps);
  const svg3 = decodeURIComponent(createContextualNarrativeSvg(studyA, studyB, contextSeed.variation, caps));
  const v3 = containsProhibitedTerms(svg3, caps);
  assert.deepStrictEqual(v3, [], `Contextual narrative SVG contains prohibited terms: ${v3.join(", ")}`);

  const summarySeed = getDiversitySeed("OSD-679", "OSD-680", "accession_summary", 3, 0, caps);
  const svg4 = decodeURIComponent(createAccessionSummarySvg(studyA, studyB, summarySeed.variation, caps));
  const v4 = containsProhibitedTerms(svg4, caps);
  assert.deepStrictEqual(v4, [], `Accession summary SVG contains prohibited terms: ${v4.join(", ")}`);
  console.log("  ✔ All 4 procedural SVGs generated with zero prohibited terms");

  // Test 4: 5-Second Motion Brief Gating
  console.log("Test 4: 5-Second Motion Brief Generation");
  const video = await generateStudyBriefVideo({ studies: ["OSD-679", "OSD-680"] });
  assert.strictEqual(video.success, true);
  assert.strictEqual(video.scenes.length, 3);
  assert.strictEqual(video.scenes[0].title, "Ocular imaging and pressure measurement");
  assert.strictEqual(video.scenes[1].title, "Optic-nerve and sheath MRI morphology");
  assert.strictEqual(video.scenes[2].title, "Ground-analog comparison and study limitations");

  const videoJson = JSON.stringify(video);
  const violationsVideo = containsProhibitedTerms(videoJson, caps);
  assert.deepStrictEqual(violationsVideo, [], `Video contains prohibited terms: ${violationsVideo.join(", ")}`);
  for (const term of PROHIBITED_CAPABILITY_TERMS) {
    const regex = new RegExp(`\\b${term}\\b`, "i");
    assert.strictEqual(regex.test(videoJson), false, `Video leaked term: ${term}`);
  }
  console.log("  ✔ Motion brief generated with safe imaging/morphology scenes and zero contamination");

  // Test 5: Relatable Translational Clip Gating
  console.log("Test 5: Relatable Translational Clip Generation");
  const clip = await generateTranslationalClip({ studies: ["OSD-679", "OSD-680"] });
  assert.strictEqual(clip.success, true);
  assert.strictEqual(clip.direction, "ocular_imaging");
  const hasOmicsAlternate = clip.alternateDirectionsAvailable.some((a) => a.key === "omics_translation");
  assert.strictEqual(hasOmicsAlternate, false, "omics_translation must not be offered in alternates for non-omics pair");

  const clipJson = JSON.stringify(clip);
  const violationsClip = containsProhibitedTerms(clipJson, caps);
  assert.deepStrictEqual(violationsClip, [], `Clip contains prohibited terms: ${violationsClip.join(", ")}`);
  for (const term of PROHIBITED_CAPABILITY_TERMS) {
    const regex = new RegExp(`\\b${term}\\b`, "i");
    assert.strictEqual(regex.test(clipJson), false, `Clip leaked term: ${term}`);
  }
  console.log("  ✔ Translational clip generated with safe directions and zero contamination");

  // Test 6: Evidence Map & Interpretation Rationale
  console.log("Test 6: Evidence Map & Interpretation Rationale");
  const evidenceMap = buildAwgEvidenceMap(studyA, studyB);
  assert.ok(evidenceMap);
  const candidateFollowUp = (evidenceMap.interpretationClaims || []).find((i) => i.badge === "CANDIDATE FOLLOW-UP");
  assert.ok(candidateFollowUp);
  assert.ok(candidateFollowUp.rationale.includes("biomechanical and morphological findings"));
  assert.ok(!candidateFollowUp.rationale.includes("oxidative and vascular stress markers"));
  console.log("  ✔ Evidence map interpretation rationale cleanly updated for HDT cohort");

  // Test 7: AWG Prompt Citations Integrity
  console.log("Test 7: AWG System Prompt Placeholder Check");
  assert.strictEqual(AWG_SYSTEM_PROMPT.includes("Author et al., Year, DOI/PMID"), false);
  assert.strictEqual(AWG_SYSTEM_PROMPT.includes("[Full citation with DOI link]"), false);
  console.log("  ✔ AWG System Prompt verified free of placeholder citations");

  // Test 8: AWG Chat Stream Output Gating
  console.log("Test 8: AWG Chat Stream Output Gating for /awg compare OSD-679 OSD-680");
  const { generateChatStream } = await import("../server/gemini");
  let streamedText = "";
  for await (const chunk of generateChatStream("/awg compare OSD-679 OSD-680", [])) {
    if (chunk.type === "token") {
      streamedText += chunk.data;
    }
  }
  assert.ok(streamedText.length > 50, "Streamed text must not be empty");
  const violationsStream = containsProhibitedTerms(streamedText, caps);
  assert.deepStrictEqual(violationsStream, [], `Streamed text contains prohibited terms: ${violationsStream.join(", ")}`);
  for (const term of PROHIBITED_CAPABILITY_TERMS) {
    const regex = new RegExp(`\\b${term}\\b`, "i");
    assert.strictEqual(regex.test(streamedText), false, `Streamed text leaked term: ${term}`);
  }
  assert.strictEqual(streamedText.includes("Author et al., Year, DOI/PMID"), false);
  assert.strictEqual(streamedText.includes("[Full citation with DOI link]"), false);
  // Test 9: Contextual Follow-Up Query ('which one is better')
  console.log("Test 9: Contextual Follow-Up Query ('which one is better') after active comparison");
  const history = [
    { role: "user", content: "/awg compare OSD-679 OSD-680" },
    { role: "assistant", content: streamedText },
  ];
  let followUpText = "";
  let followUpSources: any = null;
  for await (const chunk of generateChatStream("which one is better", history)) {
    if (chunk.type === "token") {
      followUpText += chunk.data;
    } else if (chunk.type === "sources") {
      followUpSources = chunk.data;
    }
  }

  assert.ok(followUpText.length > 50, "Follow-up text must not be empty");
  assert.strictEqual(followUpText.toLowerCase().includes("which × one"), false, "Must not trigger accession validation on WHICH × ONE");
  assert.strictEqual(followUpText.toLowerCase().includes("validation error"), false, "Must not trigger validation error on conversational follow-up");
  assert.ok(followUpText.includes("OSD-679"), "Must reference OSD-679 from active session context");
  assert.ok(followUpText.includes("OSD-680"), "Must reference OSD-680 from active session context");
  assert.strictEqual(followUpSources?.awgDetails?.action, undefined, "Action must not be error or validation");
  const violationsFollowUp = containsProhibitedTerms(followUpText, caps);
  assert.deepStrictEqual(violationsFollowUp, [], `Follow-up text contains prohibited terms: ${violationsFollowUp.join(", ")}`);
  console.log("  ✔ Contextual follow-up ('which one is better') successfully evaluates OSD-679 vs OSD-680 without accession validation failure");

  console.log("\n============================================================");
  console.log("🎉 ALL AWG MEDIA CAPABILITY GATING TESTS PASSED!");
  console.log("============================================================\n");
}

runCapabilityGatingTests().catch((err) => {
  console.error("Capability Gating Test Failure:", err);
  process.exit(1);
});
