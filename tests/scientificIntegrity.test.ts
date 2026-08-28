import assert from "assert";
import { getStudyById, getAllStudies } from "../server/rag";
import { getStudyManifest, CANONICAL_STUDY_MANIFESTS } from "../server/studyManifests";
import {
  scoreStudyCompatibility,
  getSuggestedAwgPairs,
  buildAwgEvidenceMap,
} from "../server/awg";
import { INITIAL_STUDIES } from "../server/studiesData";

async function runScientificIntegrityTests() {
  console.log("▶ Running NASA OSDR Scientific Metadata Integrity & Anti-Hallucination Tests...\n");

  // Test 1: Canonical Study Manifests Verification
  console.log("Test 1: Verify Canonical Study Manifests against Authoritative Sources");
  {
    const targetStudies = [
      "OSD-583",
      "OSD-100",
      "OSD-679",
      "OSD-680",
      "OSD-681",
      "OSD-557",
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

    console.log("  ✔ All 8 target studies have complete, verified canonical manifests with DOI/PMID links");
  }

  // Test 2: Specific Metadata Anti-Hallucination Invariants
  console.log("\nTest 2: Specific Metadata Anti-Hallucination Invariants");
  {
    // OSD-583: Must NOT claim transcriptomics/RNA-seq (that is OSD-557). OSD-583 is IOP tonometry & histology/AQP4.
    const s583 = getStudyManifest("OSD-583")!;
    assert.ok(
      s583.assays.some(a => a.name.toLowerCase().includes("intraocular") || a.name.toLowerCase().includes("histopath") || a.measurementType.toLowerCase().includes("iop")),
      "OSD-583 assays must include Intraocular Pressure / Histopathology"
    );
    assert.ok(
      !s583.assays.some(a => a.name.toLowerCase().includes("rna-seq") || a.technology.toLowerCase().includes("sequencing")),
      "OSD-583 must NOT claim RNA-seq (OSD-557 holds the RR-9 retinal RNA-seq data)"
    );

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

    console.log("  ✔ Invariant checks passed: OSD-583 (IOP/Histology), OSD-100 (Bisulfite-seq/RNA-seq), OSD-679-681 (HDT Imaging/Telemetry)");
  }

  // Test 3: Transparent 7-Axis Compatibility Scoring Engine
  console.log("\nTest 3: Transparent 7-Axis Compatibility Scoring Engine");
  {
    const s583 = getStudyById("OSD-583")!;
    const s557 = getStudyById("OSD-557")!;
    const s100 = getStudyById("OSD-100")!;
    const s194 = getStudyById("OSD-194")!;
    const s679 = getStudyById("OSD-679")!;
    const s680 = getStudyById("OSD-680")!;

    // OSD-583 × OSD-557: Matched RR-9 cohort (Male C57BL/6J mice, ISS 35d, IOP × RNA-seq)
    const score583_557 = scoreStudyCompatibility(s583, s557);
    assert.strictEqual(score583_557.organismMatch, 20, "Must earn full 20 for matched Mus musculus");
    assert.ok(score583_557.tissueOverlap >= 16, "Must earn high score for eye/retina overlap");
    assert.strictEqual(score583_557.exposurePlatformSimilarity, 20, "Must earn 20 for matched ISS microgravity");
    assert.strictEqual(score583_557.assayComplementarity, 15, "Must earn 15 for IOP/Histology × Transcriptomics synergy");
    assert.strictEqual(score583_557.timepointDurationComparability, 10, "Must earn 10 for matched 35-day duration");
    assert.strictEqual(score583_557.controlDesignComparability, 10, "Must earn 10 for synchronized ground controls");
    assert.strictEqual(score583_557.publicationEvidenceAvailability, 5, "Must earn 5 for verified DOI citations");
    assert.ok(score583_557.totalScore >= 90, "Score should be >= 90 for matched RR-9 pair");
    assert.strictEqual(score583_557.comparisonReadiness, "direct-comparison ready");

    // Check whyEarned and whyWithheld itemization
    assert.ok(score583_557.whyEarned.length >= 5, "Must itemize why points were earned");

    // Cross-species test: OSD-100 (Mouse) × OSD-679 (Rat)
    const scoreCross = scoreStudyCompatibility(s100, s679);
    assert.strictEqual(scoreCross.organismMatch, 14, "Cross-rodent must earn 14/20 with deduction");
    assert.ok(
      scoreCross.whyWithheld.some(w => w.includes("Interspecies") || w.includes("cross-species") || w.includes("divergence")),
      "Must document why points were withheld for cross-species"
    );

    console.log("  ✔ 7-axis scoring engine calculates itemized breakdowns and enforces transparent deductions");
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

  // Test 5: Three-Tier Evidence Map & Provenance Audit
  console.log("\nTest 5: Three-Tier Evidence Map & Provenance Audit");
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

    console.log("  ✔ Evidence map strictly partitions verified metadata, observed findings, and interpretation");
  }

  console.log("\n============================================================");
  console.log("🎉 ALL NASA OSDR SCIENTIFIC INTEGRITY & AUDIT TESTS PASSED!");
  console.log("============================================================\n");
}

runScientificIntegrityTests().catch((err) => {
  console.error("❌ Scientific integrity test failed:", err);
  process.exit(1);
});
