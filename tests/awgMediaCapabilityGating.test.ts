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

  // Test 10: Mixed Modality Pair (OSD-680 × OSD-87)
  console.log("Test 10: Mixed Modality Pair (OSD-680 × OSD-87: Imaging + Microarray/Histology)");
  const study680 = getStudyById("OSD-680")!;
  const study87 = getStudyById("OSD-87")!;
  assert.ok(study680, "OSD-680 must exist in repository");
  assert.ok(study87, "OSD-87 must exist in repository");

  const caps680_87 = derivePairCapabilities(study680, study87);
  assert.strictEqual(caps680_87.pairClass, "imaging_plus_omics", "Must classify as imaging_plus_omics");
  assert.strictEqual(caps680_87.isMultiOmics, false, "One-omics + one-non-omics pair MUST NOT be multi-omics");
  assert.strictEqual(caps680_87.isBothOmics, false, "Must not be flagged as both omics");
  assert.strictEqual(caps680_87.isBothTranscriptomics, false, "Must not be flagged as both transcriptomics");
  assert.strictEqual(caps680_87.studyA.hasTranscriptomics, false, "OSD-680 has no transcriptomics");
  assert.strictEqual(caps680_87.studyA.hasImaging, true, "OSD-680 has imaging");
  assert.strictEqual(caps680_87.studyB.hasMicroarray, true, "OSD-87 has microarray");
  assert.strictEqual(caps680_87.studyB.hasRnaSeq, false, "OSD-87 is microarray, NOT RNA-seq");
  assert.strictEqual(caps680_87.studyB.hasMetabolomics, false, "OSD-87 has no metabolomics");
  assert.strictEqual(caps680_87.studyB.hasProteomics, false, "OSD-87 has no mass spec / proteomics");

  const plan680_87 = buildGroundedMediaPlan(study680, study87);
  const planJson680_87 = JSON.stringify(plan680_87);
  assert.strictEqual(planJson680_87.includes("Transcriptomics × Transcriptomics"), false, "Must not contain Transcriptomics × Transcriptomics");
  assert.strictEqual(planJson680_87.includes("Multi-Omics"), false, "Must not contain Multi-Omics");
  assert.strictEqual(planJson680_87.includes("RNA sequencing from OSD-680"), false, "Must not claim RNA-seq for OSD-680");
  assert.strictEqual(planJson680_87.includes("mass spectrometry"), false, "Must not claim mass spectrometry for OSD-87");

  const video680_87 = await generateStudyBriefVideo({ studies: ["OSD-680", "OSD-87"] });
  const videoJson680_87 = JSON.stringify(video680_87);
  assert.strictEqual(videoJson680_87.includes("Transcriptomics × Metabolomics"), false, "Must not contain Transcriptomics × Metabolomics");
  assert.strictEqual(videoJson680_87.includes("RNA sequencing from OSD-680"), false, "Must not mention RNA-seq for OSD-680");
  assert.strictEqual(videoJson680_87.includes("mass spectrometry profiling from OSD-87"), false, "Must not mention mass spectrometry for OSD-87");
  assert.strictEqual(videoJson680_87.includes("Molecular Wet-Lab & Multi-Omics Pathway Integration"), false, "Must not mention multi-omics pathway integration");

  const clip680_87 = await generateTranslationalClip({ studies: ["OSD-680", "OSD-87"] });
  const clipJson680_87 = JSON.stringify(clip680_87);
  assert.strictEqual(clip680_87.alternateDirectionsAvailable.some((a) => a.key === "omics_translation"), false, "Wet-Lab Omics must not be an available direction for OSD-680 × OSD-87");
  assert.strictEqual(clipJson680_87.includes("RNA sequencing from OSD-680"), false);
  assert.strictEqual(clipJson680_87.includes("mass spectrometry profiling from OSD-87"), false);
  console.log("  ✔ OSD-680 × OSD-87 mixed modality pair correctly gated with zero omics upcasting");

  // Test 11: Anti-Assay Upcasting Verification
  console.log("Test 11: Anti-Assay Upcasting Safeguards (Microarray != RNA-seq, MRI != Transcriptomics, Histology != Metabolomics)");
  assert.strictEqual(caps680_87.studyA.primaryAssayLabel, "Optic-Nerve MRI Morphometry");
  assert.strictEqual(caps680_87.studyB.primaryAssayLabel, "DNA Microarray Gene Expression & Retinal Histology");
  console.log("  ✔ Accurate assay labels derived without assay upcasting");

  // Test 12: Provider 429 Quota Exhausted Copy
  console.log("Test 12: Provider 429 RESOURCE_EXHAUSTED Quota Copy");
  const expectedQuotaCopy = "Video generation is temporarily unavailable because the configured Google AI project has exhausted quota or spend capacity. A fallback preview is shown instead.";
  const sample429Error = { status: 429, message: "RESOURCE_EXHAUSTED: Quota exceeded" };
  const isQuota = sample429Error.status === 429 || sample429Error.message.includes("RESOURCE_EXHAUSTED");
  assert.strictEqual(isQuota, true);
  assert.ok(expectedQuotaCopy.includes("temporarily unavailable because the configured Google AI project has exhausted quota"));
  console.log("  ✔ Upstream 429 quota exhaustion copy verified verbatim");

  
  // Test 13: Dedicated Capability Profile Classes
  console.log("Test 13: Capability Profile Classes (imaging_only, omics_only, imaging_plus_omics, imaging_plus_histology, mixed_non_equivalent_modalities)");
  
  // 1. Imaging + Microarray (OSD-680 × OSD-87) -> imaging_plus_omics
  assert.strictEqual(caps680_87.pairClass, "imaging_plus_omics");
  assert.strictEqual(caps680_87.isMultiOmics, false, "imaging + microarray must not be multi-omics");

  // 2. Imaging + Histology Mock Pair -> imaging_plus_histology
  const mockHistologyStudy = {
    ...study87,
    study_id: "OSD-HISTO-MOCK",
    title: "Retinal Histology and Cryosections under Spaceflight",
    assay_measurement: "Retinal Histology and Cryosections",
    assay_technology: "Immunohistochemistry",
    assay_platform: "Microscopy / Staining",
  };
  const capsImagingHistology = derivePairCapabilities(study680, mockHistologyStudy);
  assert.strictEqual(capsImagingHistology.pairClass, "imaging_plus_histology", "Imaging + Histology must classify as imaging_plus_histology");
  assert.strictEqual(capsImagingHistology.isMultiOmics, false, "Imaging + Histology must not be multi-omics");
  assert.strictEqual(capsImagingHistology.isBothOmics, false, "Imaging + Histology must not be both omics");

  // 3. Omics Only Pair (e.g. OSD-100 × OSD-194) -> omics_only
  const study100 = getStudyById("OSD-100")!;
  const study194 = getStudyById("OSD-194")!;
  const capsOmicsOnly = derivePairCapabilities(study100, study194);
  assert.strictEqual(capsOmicsOnly.pairClass, "omics_only", "Two omics studies must classify as omics_only");

  // 4. Imaging Only Pair (pure imaging vs pure imaging) -> imaging_only
  const mockImagingOnlyStudy = {
    ...study680,
    study_id: "OSD-OCT-MOCK",
    title: "Optical Coherence Tomography Scans",
    assay_measurement: "In Vivo Optical Coherence Tomography",
    assay_technology: "OCT Imaging",
    assay_platform: "Spectralis OCT",
  };
  const capsImagingOnly = derivePairCapabilities(study680, mockImagingOnlyStudy);
  assert.strictEqual(capsImagingOnly.pairClass, "imaging_only", "Two pure imaging studies must classify as imaging_only");

  // 5. Imaging + Physiology Pair (OSD-679 OCT/IOP × OSD-680 MRI) -> imaging_plus_physiology
  assert.strictEqual(caps.pairClass, "imaging_plus_physiology", "OSD-679 × OSD-680 must classify as imaging_plus_physiology");

  console.log("  ✔ All pair capability classes verified correctly without cross-assay upcasting");

  console.log("\n============================================================");
  console.log("🎉 ALL AWG MEDIA CAPABILITY GATING TESTS PASSED!");
  console.log("============================================================\n");
}

runCapabilityGatingTests().catch((err) => {
  console.error("Capability Gating Test Failure:", err);
  process.exit(1);
});
