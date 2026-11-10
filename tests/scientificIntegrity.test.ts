import assert from "assert";
import { getStudyById, getAllStudies } from "../server/rag";
import { getStudyManifest, CANONICAL_STUDY_MANIFESTS } from "../server/studyManifests";
import {
  scoreStudyCompatibility,
  getSuggestedAwgPairs,
  buildAwgEvidenceMap,
} from "../server/awg";
import { deriveStudyCapabilities } from "../server/mediaGen";
import { INITIAL_STUDIES } from "../server/studiesData";

async function runScientificIntegrityTests() {
  console.log("▶ Running NASA OSDR Scientific Metadata Integrity & Anti-Hallucination Tests...\n");

  // Test 1: Canonical Study Manifests Verification
  console.log("Test 1: Verify Canonical Study Manifests against Authoritative Sources");
  {
    const targetStudies = [
      "OSD-583",
      "OSD-255",
      "OSD-557",
      "OSD-568",
      "OSD-758",
      "OSD-759",
      "OSD-203",
      "OSD-685",
      "OSD-698",
      "OSD-100",
      "OSD-679",
      "OSD-680",
      "OSD-681",
      "OSD-194",
      "OSD-87",
    ];

    for (const sid of targetStudies) {
      const manifest = getStudyManifest(sid);
      assert.ok(manifest, `Manifest for ${sid} must exist in CANONICAL_STUDY_MANIFESTS`);
      assert.strictEqual(manifest.confidence, "verified", `${sid} confidence must be 'verified'`);
      assert.ok(manifest.organism.scientificName, `${sid} must have verified organism scientific name`);
      assert.ok(manifest.tissueMaterial.exactScope.length > 0, `${sid} must have exact verified tissue scope`);
      assert.ok(manifest.assays.length > 0, `${sid} must have verified assays`);
      assert.ok(manifest.experimentalGroups.factors.length > 0, `${sid} must have documented experimental groups`);
      assert.ok(manifest.linkedPublications.length > 0, `${sid} must link to peer-reviewed publication or DOI/PMID`);
      assert.ok(manifest.directPublicationSupportedFindings.length > 0, `${sid} must have empirical publication-supported findings`);
    }

    console.log("  ✔ All 15 target studies have complete, verified canonical manifests with DOI/PMID links");
  }

  // Test 2: Specific Metadata Anti-Hallucination Invariants
  console.log("\nTest 2: Specific Metadata Anti-Hallucination Invariants");
  {
    // OSD-583: Must NOT claim transcriptomics/RNA-seq (RR-9 RNA-seq resides in OSD-255). OSD-583 is IOP tonometry & histology/AQP4.
    const s583 = getStudyManifest("OSD-583")!;
    assert.ok(
      s583.assays.some(a => a.name.toLowerCase().includes("intraocular") || a.name.toLowerCase().includes("histopath") || a.measurementType.toLowerCase().includes("iop")),
      "OSD-583 assays must include Intraocular Pressure / Histopathology"
    );
    assert.ok(
      !s583.assays.some(a => a.name.toLowerCase().includes("rna-seq") || a.technology.toLowerCase().includes("sequencing")),
      "OSD-583 must NOT claim RNA-seq (OSD-255 holds the RR-9 retinal RNA-seq data)"
    );

    // OSD-557: Verified RR-9 left-eye Micro-CT (SkyScan 1272), Light Microscopy & 4-HNE/PNA Immunostaining (NO RNA-seq)
    const s557Manifest = getStudyManifest("OSD-557")!;
    const s557Study = getStudyById("OSD-557")!;
    const s557Caps = deriveStudyCapabilities(s557Study);
    assert.strictEqual(s557Manifest.organism.sampleCount, 35, "OSD-557 must have 35 verified samples");
    assert.ok(
      s557Manifest.assays.some(a => a.platform.includes("SkyScan_1272")) &&
        s557Manifest.assays.some(a => a.name.includes("4-HNE")) &&
        s557Manifest.assays.some(a => a.name.includes("PNA")),
      "OSD-557 must reflect Micro-CT SkyScan 1272, Light Microscopy, and 4-HNE/PNA Immunostaining"
    );
    assert.strictEqual(s557Caps.hasRnaSeq, false, "OSD-557 must NOT be classified as RNA-seq");
    assert.strictEqual(s557Caps.hasTranscriptomics, false, "OSD-557 must NOT be classified as transcriptomics");
    assert.strictEqual(s557Caps.hasImaging, true, "OSD-557 must be flagged as Micro-CT imaging");
    assert.strictEqual(s557Caps.hasHistology, true, "OSD-557 must be flagged as histology/immunostaining");

    // OSD-255: Verified RR-9 right-retina Illumina RNA-seq (n=16: 8 flight, 8 ground control)
    const s255Manifest = getStudyManifest("OSD-255")!;
    const s255Study = getStudyById("OSD-255")!;
    const s255Caps = deriveStudyCapabilities(s255Study);
    assert.strictEqual(s255Manifest.organism.sampleCount, 16, "OSD-255 must have 16 right-retina animals");
    assert.strictEqual(s255Caps.hasRnaSeq, true, "OSD-255 must be classified as bulk RNA-seq");
    assert.strictEqual(s255Manifest.linkedPublications[0].doi, "10.1038/s41598-019-49453-x");

    // OSD-685 & OSD-698: Verified RR-18 / SpaceX-24 brain Nanostring GeoMx DSP spatial transcriptomics (n=12 each)
    const s685Manifest = getStudyManifest("OSD-685")!;
    const s698Manifest = getStudyManifest("OSD-698")!;
    const s685Caps = deriveStudyCapabilities(getStudyById("OSD-685")!);
    const s698Caps = deriveStudyCapabilities(getStudyById("OSD-698")!);
    assert.strictEqual(s685Manifest.organism.sampleCount, 12, "OSD-685 must have 12 samples");
    assert.strictEqual(s698Manifest.organism.sampleCount, 12, "OSD-698 must have 12 samples");
    assert.strictEqual(s685Caps.hasSpatialTranscriptomics, true, "OSD-685 must be flagged as GeoMx spatial transcriptomics");
    assert.strictEqual(s698Caps.hasSpatialTranscriptomics, true, "OSD-698 must be flagged as GeoMx spatial transcriptomics");
    assert.strictEqual(s685Caps.hasRnaSeq, false, "GeoMx spatial DSP must stay distinct from bulk RNA-seq");

    // OSD-100: Bisulfite sequencing must NOT be hallucinated as hydroxymethylation
    const s100 = getStudyManifest("OSD-100")!;
    assert.ok(
      s100.assays.some(a => a.name.includes("Bisulfite")),
      "OSD-100 assays must include Bisulfite Sequencing"
    );
    assert.ok(
      !JSON.stringify(s100.assays).toLowerCase().includes("hydroxymethylation"),
      "OSD-100 must not claim hydroxymethylation without direct assay proof"
    );

    // OSD-679, 680, 681: Ground-based HDT analog studies
    const s679 = getStudyManifest("OSD-679")!;
    const s680 = getStudyManifest("OSD-680")!;
    const s681 = getStudyManifest("OSD-681")!;

    assert.strictEqual(s679.mission.platform, "Ground-based Analog");
    assert.strictEqual(s680.mission.platform, "Ground-based Analog");
    assert.strictEqual(s681.mission.platform, "Ground-based Analog");

    assert.ok(s679.assays.some(a => a.name.includes("OCT") || a.name.includes("Tonometry")));
    assert.ok(s680.assays.some(a => a.name.includes("MRI")));
    assert.ok(s681.assays.some(a => a.name.includes("Telemetry") || a.name.includes("Pressure")));

    console.log("  ✔ Invariant checks passed: OSD-583, OSD-557 (Micro-CT/4-HNE/PNA), OSD-255 (RNA-seq n=16), OSD-685/698 (GeoMx Spatial), OSD-100, OSD-679-681");
  }

  // Test 3: Transparent 7-Axis Compatibility Scoring Engine
  console.log("\nTest 3: Transparent 7-Axis Compatibility Scoring Engine");
  {
    const s583 = getStudyById("OSD-583")!;
    const s255 = getStudyById("OSD-255")!;
    const s557 = getStudyById("OSD-557")!;
    const s685 = getStudyById("OSD-685")!;
    const s698 = getStudyById("OSD-698")!;
    const s100 = getStudyById("OSD-100")!;
    const s679 = getStudyById("OSD-679")!;

    // OSD-583 × OSD-255: Matched RR-9 cohort (Male C57BL/6J mice, ISS 35d, IOP/BRB Histology × Retina RNA-seq)
    const score583_255 = scoreStudyCompatibility(s583, s255);
    assert.strictEqual(score583_255.organismMatch, 20, "Must earn full 20 for matched Mus musculus");
    assert.ok(score583_255.tissueOverlap >= 16, "Must earn high score for eye/retina overlap");
    assert.strictEqual(score583_255.exposurePlatformSimilarity, 20, "Must earn 20 for matched RR-9 SpaceX-12 mission");
    assert.strictEqual(score583_255.assayComplementarity, 15, "Must earn 15 for IOP/Histology × Retina RNA-seq synergy");
    assert.strictEqual(score583_255.timepointDurationComparability, 10, "Must earn 10 for matched 35-day duration");
    assert.strictEqual(score583_255.controlDesignComparability, 10, "Must earn 10 for synchronized ground controls");
    assert.strictEqual(score583_255.publicationEvidenceAvailability, 5, "Must earn 5 for verified DOI citations");
    assert.ok(score583_255.totalScore >= 90, "Score should be >= 90 for matched RR-9 IOP × RNA-seq pair");
    assert.strictEqual(score583_255.comparisonReadiness, "direct-comparison ready");
    assert.ok(score583_255.whyEarned.length >= 5, "Must itemize why points were earned");

    // OSD-557 × OSD-255: Matched RR-9 left-eye imaging/histology × right-retina RNA-seq
    const score557_255 = scoreStudyCompatibility(s557, s255);
    assert.ok(score557_255.totalScore >= 90, "RR-9 left-eye Micro-CT/histology × right-retina RNA-seq should score >= 90");

    // OSD-685 × OSD-698: Matched RR-18 / SpaceX-24 GeoMx spatial transcriptomics pair
    const score685_698 = scoreStudyCompatibility(s685, s698);
    assert.ok(score685_698.totalScore >= 90, "Same-mission RR-18 GeoMx brain pair should score >= 90");

    // OSD-255 × OSD-685: Cross-mission, cross-tissue (RR-9 retina vs RR-18 brain spatial, zero shared animals)
    const scoreCrossMissionRetinaBrain = scoreStudyCompatibility(s255, s685);
    assert.ok(
      scoreCrossMissionRetinaBrain.totalScore < 80,
      `Cross-mission retina vs brain pair must score < 80 (got ${scoreCrossMissionRetinaBrain.totalScore})`
    );
    assert.strictEqual(scoreCrossMissionRetinaBrain.comparisonReadiness, "contextually complementary");
    assert.ok(
      scoreCrossMissionRetinaBrain.whyWithheld.some(w => w.toLowerCase().includes("zero shared animal")),
      "Cross-mission pair must explicitly document zero shared animal subjects in whyWithheld"
    );

    // Cross-species test: OSD-100 (Mouse) × OSD-679 (Rat)
    const scoreCross = scoreStudyCompatibility(s100, s679);
    assert.strictEqual(scoreCross.organismMatch, 14, "Cross-rodent must earn 14/20 with deduction");
    assert.ok(
      scoreCross.whyWithheld.some(w => w.includes("Interspecies") || w.includes("cross-species") || w.includes("divergence")),
      "Must document why points were withheld for cross-species"
    );

    console.log("  ✔ 7-axis scoring engine calculates itemized breakdowns, cross-mission penalties, and transparent deductions");
  }

  // Test 4: Anti-Hallucination Score Cap (<90 for Unverified/Mismatched Pairs)
  console.log("\nTest 4: Anti-Hallucination Score Cap (<90 for Unverified/Mismatched Pairs)");
  {
    // Test identical study pair returns 0
    const s87 = getStudyById("OSD-87")!;
    const scoreIdentical = scoreStudyCompatibility(s87, s87);
    assert.strictEqual(scoreIdentical.totalScore, 0, "Identical study pair score must be 0");
    assert.strictEqual(scoreIdentical.comparisonReadiness, "hypothesis-generating only");

    // Test cross-species pair (OSD-87 mouse × OSD-680 rat) is capped/deducted below 90
    const s680 = getStudyById("OSD-680")!;
    const scoreCross = scoreStudyCompatibility(s87, s680);
    assert.ok(scoreCross.totalScore < 90, "Cross-species flight-vs-analog pair must score < 90");

    console.log("  ✔ Score cap properly restricts comparisons that lack full verified pairing");
  }

  // Test 5: Three-Tier Evidence Map, Provenance Audit & Schema Contract Guardrails
  console.log("\nTest 5: Three-Tier Evidence Map, Provenance Audit & Schema Contract Guardrails");
  {
    const s679 = getStudyById("OSD-679")!;
    const s680 = getStudyById("OSD-680")!;
    const evidenceMap = buildAwgEvidenceMap(s679, s680);

    assert.ok(evidenceMap.studyMetadata.length === 2, "Must contain metadata for both studies");
    assert.ok(evidenceMap.observedResults.length >= 2, "Must contain observed results for both studies");
    assert.ok(evidenceMap.interpretationClaims.length >= 3, "Must contain 3-tier interpretation claims");

    // Verify metadata quality fields
    assert.strictEqual(evidenceMap.studyMetadata[0].dataQuality, "verified");
    assert.strictEqual(evidenceMap.studyMetadata[1].dataQuality, "verified");

    // Verify DOI/PMID presence in observed results
    assert.ok(evidenceMap.observedResults.some(r => Boolean(r.doi || r.sourceReference)));

    // Verify epistemic caution on every interpretation claim
    for (const claim of evidenceMap.interpretationClaims) {
      assert.ok(claim.epistemicCaution && claim.epistemicCaution.length > 10, "Every claim must carry epistemic caution");
    }

    // Verify Schema Guardrails & Ingestion Contract on OSD-255 × OSD-685 (cross-mission retina vs spatial brain)
    const s255 = getStudyById("OSD-255")!;
    const s685 = getStudyById("OSD-685")!;
    const crossContractMap = buildAwgEvidenceMap(s255, s685);
    assert.ok(crossContractMap.schemaContract, "Must attach IngestionSchemaContract");
    assert.strictEqual(crossContractMap.schemaContract.sameMission, false, "OSD-255 vs OSD-685 are different missions");
    assert.strictEqual(crossContractMap.schemaContract.sharedAnimalsPossible, false, "Zero shared animals across RR-9 and RR-18");
    assert.strictEqual(crossContractMap.schemaContract.animalDisjointRequired, true, "Must mandate animal-disjoint splits");
    assert.strictEqual(crossContractMap.schemaContract.spatialAlignmentRequired, true, "Must require GeoMx spatial alignment");
    assert.ok(
      crossContractMap.schemaGuardrails?.some(g => g.code === "ZERO_SHARED_ANIMALS") &&
        crossContractMap.schemaGuardrails?.some(g => g.code === "P_GT_N_ANIMAL_DISJOINT") &&
        crossContractMap.schemaGuardrails?.some(g => g.code === "SPATIAL_ALIGNMENT"),
      "Must surface explicit ZERO_SHARED_ANIMALS, P_GT_N_ANIMAL_DISJOINT, and SPATIAL_ALIGNMENT guardrails"
    );

    // Verify RR-9 contract (OSD-583 × OSD-255) captures CC1/CC2 controls & n=16
    const s583 = getStudyById("OSD-583")!;
    const rr9ContractMap = buildAwgEvidenceMap(s583, s255);
    assert.strictEqual(rr9ContractMap.schemaContract?.sameMission, true, "OSD-583 & OSD-255 share RR-9 mission");
    assert.ok(
      rr9ContractMap.schemaContract?.cohortControlsDetected.some(c => c.includes("CC1")),
      "Must capture CC1/CC2 cohort controls in schema contract"
    );
    assert.strictEqual(
      rr9ContractMap.schemaContract?.studies.find(s => s.accession === "OSD-255")?.sampleCountN,
      16,
      "Must encode n=16 for OSD-255"
    );

    console.log("  ✔ Evidence map & schema contracts strictly separate verified tiers and enforce ML/ingestion guardrails");
  }

  console.log("\n============================================================");
  console.log("🎉 ALL NASA OSDR SCIENTIFIC INTEGRITY & AUDIT TESTS PASSED!");
  console.log("============================================================\n");
}

runScientificIntegrityTests().catch((err) => {
  console.error("❌ Scientific integrity test failed:", err);
  process.exit(1);
});
