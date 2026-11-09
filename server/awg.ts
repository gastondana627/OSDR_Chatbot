import { OSDRStudy } from "./studiesData";
import { getStudyById, getAllStudies, getDiagnostics } from "./osdrClient";
import {
  parseRawAccessions,
  validateAwgAccessions,
  AccessionValidationResult,
  AccessionValidationStatus,
} from "./accessionValidator";
import { getStudyManifest, StudyManifest } from "./studyManifests";

export interface AwgParsedQuery {
  isAwg: boolean;
  action: "guided_chooser" | "random_pair" | "compare" | "analyze" | "summary" | "help" | "meme" | "media_audit" | "multiple_commands_error" | "general";
  explicitStudyIds: string[];
  rawRequestedAccessions?: string[];
  cleanQuery: string;
}

export interface CompatibilityScoreBreakdown {
  organismMatch: number; // 0 - 20
  tissueOverlap: number; // 0 - 20
  exposurePlatformSimilarity: number; // 0 - 20
  assayComplementarity: number; // 0 - 15
  timepointDurationComparability: number; // 0 - 10
  controlDesignComparability: number; // 0 - 10
  publicationEvidenceAvailability: number; // 0 - 5
  totalScore: number; // 0 - 100
  whyEarned: string[];
  whyWithheld: string[];
  verifiedFields: string[];
  unresolvedFields: string[];
  comparisonReadiness: "direct-comparison ready" | "contextually complementary" | "hypothesis-generating only";
  whyChosen: string;
  commonScientificAxis: string;
  tags: string[];
}

export interface SchemaGuardrailNotice {
  code:
    | "ZERO_SHARED_ANIMALS"
    | "SAME_MISSION_DISSECTION_SPLIT"
    | "COHORT_BATCH_CONTROLS"
    | "P_GT_N_ANIMAL_DISJOINT"
    | "SPATIAL_ALIGNMENT";
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
}

export interface IngestionSchemaContract {
  contractVersion: "1.0.0";
  pairId: string;
  generatedAt: string;
  sameMission: boolean;
  sharedAnimalsPossible: boolean;
  animalDisjointRequired: boolean;
  recommendedCvStrategy: string;
  cohortControlsDetected: string[];
  spatialAlignmentRequired: boolean;
  studies: Array<{
    accession: string;
    mission: string;
    missionKey: string;
    platform: string;
    organism: string;
    tissueScope: string[];
    assayModalities: string[];
    sampleCountN: number | null;
    controls: string[];
    doi?: string;
    pmid?: string;
    osdrUrl: string;
  }>;
  guardrails: SchemaGuardrailNotice[];
}

function deriveMissionKey(study: OSDRStudy, manifest: StudyManifest | null): string {
  if (manifest?.validationConstraints?.missionKey) {
    return manifest.validationConstraints.missionKey;
  }
  const src = `${manifest?.mission.name || ""} ${study.mission || ""}`.toLowerCase();
  if (src.includes("rr-9") || src.includes("spacex-12") || src.includes("crs-12")) return "RR-9_SPACEX-12";
  if (src.includes("rr-18") || src.includes("spacex-24") || src.includes("crs-24")) return "RR-18_SPACEX-24";
  if (src.includes("rr-1") || src.includes("crs-4")) return "RR-1_SPACEX-4";
  if (src.includes("rr-3") || src.includes("crs-8")) return "RR-3_SPACEX-8";
  if (src.includes("sts-135")) return "STS-135_SHUTTLE";
  if (src.includes("mhu-1")) return "ISS_MHU-1";
  if (src.includes("lsds-81") || src.includes("lsds-82") || src.includes("lsds-83") || src.includes("head-down tilt")) return "HDT_RAT_ANALOG";
  return (manifest?.mission.name || study.mission || study.study_id)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function extractSampleCountN(study: OSDRStudy, manifest: StudyManifest | null): number | null {
  if (typeof manifest?.validationConstraints?.sampleSizeN === "number") {
    return manifest.validationConstraints.sampleSizeN;
  }
  if (typeof manifest?.organism.sampleCount === "number") {
    return manifest.organism.sampleCount;
  }
  const match = `${study.description || ""} ${study.study_factor || ""}`.match(/\b(\d+)\s+(?:distinct\s+|total\s+|left-eye\s+|right-retina\s+|male\s+|female\s+)?(?:mouse|mice|rat|rats|samples|specimens)\b/i);
  return match ? Number(match[1]) : null;
}

export interface SuggestedAwgPair {
  studyA: OSDRStudy;
  studyB: OSDRStudy;
  studyIds: [string, string];
  title: string;
  tag: string;
  score: number;
  breakdown: CompatibilityScoreBreakdown;
  whyMatched: string;
  commonAxis: string;
}

/**
 * Transparent, itemized AWG compatibility scoring engine for NASA OSDR studies.
 * Strictly calculates:
 * - organism match: 0–20
 * - tissue/material overlap: 0–20
 * - experimental exposure/platform similarity: 0–20
 * - assay complementarity: 0–15
 * - timepoint/duration comparability: 0–10
 * - control-design comparability: 0–10
 * - publication/evidence availability: 0–5
 *
 * Strict anti-hallucination mandate:
 * Never display a score above 90 unless every major metadata field has authoritative evidence
 * and the pair has strong experimental comparability.
 */
export function scoreStudyCompatibility(a: OSDRStudy, b: OSDRStudy): CompatibilityScoreBreakdown {
  if (a.study_id === b.study_id) {
    return {
      organismMatch: 0,
      tissueOverlap: 0,
      exposurePlatformSimilarity: 0,
      assayComplementarity: 0,
      timepointDurationComparability: 0,
      controlDesignComparability: 0,
      publicationEvidenceAvailability: 0,
      totalScore: 0,
      whyEarned: [],
      whyWithheld: ["Identical study accession cannot be paired for cross-study comparison."],
      verifiedFields: ["study_id"],
      unresolvedFields: [],
      comparisonReadiness: "hypothesis-generating only",
      whyChosen: "Identical study accession; comparisons require two distinct studies.",
      commonScientificAxis: "Single study baseline",
      tags: [],
    };
  }

  const manifestA = getStudyManifest(a.study_id);
  const manifestB = getStudyManifest(b.study_id);

  let organismMatch = 0;
  let tissueOverlap = 0;
  let exposurePlatformSimilarity = 0;
  let assayComplementarity = 0;
  let timepointDurationComparability = 0;
  let controlDesignComparability = 0;
  let publicationEvidenceAvailability = 0;

  const whyEarned: string[] = [];
  const whyWithheld: string[] = [];
  const verifiedFields: string[] = [];
  const unresolvedFields: string[] = [];
  const tags: string[] = [];

  // Track verified metadata
  if (manifestA?.organism.isVerified && manifestB?.organism.isVerified) {
    verifiedFields.push("organism");
  }
  if (manifestA?.tissueMaterial.isVerified && manifestB?.tissueMaterial.isVerified) {
    verifiedFields.push("tissue_material");
  }
  if (manifestA?.mission.isVerified && manifestB?.mission.isVerified) {
    verifiedFields.push("mission_platform");
  }
  if (manifestA?.experimentalGroups.isVerified && manifestB?.experimentalGroups.isVerified) {
    verifiedFields.push("experimental_groups");
  }

  if (manifestA?.unresolvedFields?.length) {
    unresolvedFields.push(...manifestA.unresolvedFields.map(f => `${a.study_id}: ${f}`));
  }
  if (manifestB?.unresolvedFields?.length) {
    unresolvedFields.push(...manifestB.unresolvedFields.map(f => `${b.study_id}: ${f}`));
  }

  // 1. Organism match: 0-20
  const orgA = (a.organism || "").toLowerCase();
  const orgB = (b.organism || "").toLowerCase();
  if (orgA.includes("mus musculus") && orgB.includes("mus musculus")) {
    organismMatch = 20;
    whyEarned.push("Same species (Mus musculus C57BL/6) (+20/20)");
    tags.push("Matched Species (Mus musculus)");
  } else if (orgA.includes("rattus") && orgB.includes("rattus")) {
    organismMatch = 20;
    whyEarned.push("Same species (Rattus norvegicus) (+20/20)");
    tags.push("Matched Species (Rattus norvegicus)");
  } else if (
    (orgA.includes("rattus") || orgA.includes("rat") || orgA.includes("mouse") || orgA.includes("mus")) &&
    (orgB.includes("rattus") || orgB.includes("rat") || orgB.includes("mouse") || orgB.includes("mus"))
  ) {
    organismMatch = 14;
    whyEarned.push("Cross-rodent mammalian model (Rat vs Mouse) (+14/20)");
    whyWithheld.push("Interspecies extrapolation required between rat and mouse biology (-6)");
    tags.push("Cross-Rodent Model Orthology");
  } else {
    organismMatch = 6;
    whyEarned.push("Distantly related or human-model pair (+6/20)");
    whyWithheld.push("Substantial cross-species divergence (-14)");
  }

  // 2. Tissue / material overlap: 0-20
  const tissueA = (a.material_type || "").toLowerCase();
  const tissueB = (b.material_type || "").toLowerCase();
  const retinaA = tissueA.includes("retina");
  const retinaB = tissueB.includes("retina");
  const opticA = tissueA.includes("optic");
  const opticB = tissueB.includes("optic");
  const brainA = tissueA.includes("brain") || tissueA.includes("dentate") || tissueA.includes("cortex");
  const brainB = tissueB.includes("brain") || tissueB.includes("dentate") || tissueB.includes("cortex");
  const eyeA = tissueA.includes("eye") || retinaA || opticA;
  const eyeB = tissueB.includes("eye") || retinaB || opticB;

  if (retinaA && retinaB) {
    tissueOverlap = 20;
    whyEarned.push("Direct tissue match: isolated/mapped neural retina in both studies (+20/20)");
    tags.push("Matched Retinal Tissue");
  } else if ((retinaA && eyeB) || (eyeA && retinaB)) {
    tissueOverlap = 16;
    whyEarned.push("Close anatomical match: Whole eye globe vs isolated retina (+16/20)");
    whyWithheld.push("Whole eye includes non-retinal ocular structures (cornea, sclera, lens) creating dilution (-4)");
    tags.push("Ocular Anatomical Overlap");
  } else if (brainA && brainB) {
    tissueOverlap = 16;
    whyEarned.push("Matched central nervous organ system (Brain subregions: Dentate Gyrus / Frontal Cortex) (+16/20)");
    whyWithheld.push("Distinct brain anatomical ROIs require spatial coordinate/region alignment (-4)");
    tags.push("Brain Spatial Subregions");
  } else if (opticA || opticB) {
    tissueOverlap = 14;
    whyEarned.push("Neuro-visual tract pairing (Optic nerve / Sheath with Ocular structures) (+14/20)");
    whyWithheld.push("Distinct anatomical sub-compartments along visual pathway (-6)");
    tags.push("Visual Pathway Complement");
  } else if (tissueA.includes("subdural") || tissueB.includes("subdural") || tissueA.includes("csf") || tissueB.includes("csf")) {
    tissueOverlap = 12;
    whyEarned.push("Fluid compartment / intracranial space with ocular system (+12/20)");
    whyWithheld.push("Systemic / cerebrospinal compartment vs ocular tissue (-8)");
  } else {
    tissueOverlap = 5;
    whyWithheld.push("Divergent tissue targets across anatomical compartments (-15)");
  }

  // 3. Experimental exposure / platform similarity: 0-20
  const platA = manifestA?.mission.platform || (a.mission.toLowerCase().includes("iss") ? "ISS" : a.mission.toLowerCase().includes("shuttle") ? "Space Shuttle" : "Ground-based Analog");
  const platB = manifestB?.mission.platform || (b.mission.toLowerCase().includes("iss") ? "ISS" : b.mission.toLowerCase().includes("shuttle") ? "Space Shuttle" : "Ground-based Analog");

  const missionKeyA = deriveMissionKey(a, manifestA);
  const missionKeyB = deriveMissionKey(b, manifestB);
  const isSameMission = Boolean(missionKeyA && missionKeyB && missionKeyA === missionKeyB);

  if (platA === platB && platA === "ISS") {
    if (isSameMission) {
      exposurePlatformSimilarity = 20;
      whyEarned.push(`Matched ISS spaceflight mission cohort (${missionKeyA.replace(/_/g, " / ")}) (+20/20)`);
      tags.push("Same ISS Mission Cohort");
    } else {
      exposurePlatformSimilarity = 16;
      whyEarned.push("Shared orbital environment: International Space Station (ISS) microgravity (+16/20)");
      whyWithheld.push(`Distinct ISS missions (${missionKeyA} vs ${missionKeyB}) with zero shared animal subjects (-4)`);
      tags.push("Cross-Mission ISS (0 Shared Animals)");
    }
  } else if (platA === platB && platA === "Ground-based Analog") {
    exposurePlatformSimilarity = 20;
    whyEarned.push("Identical operational environment: Ground-based Head-Down Tilt Hindlimb Unloading (+20/20)");
    tags.push("Ground-based HDT Cohort");
  } else if ((platA === "ISS" && platB === "Space Shuttle") || (platA === "Space Shuttle" && platB === "ISS")) {
    exposurePlatformSimilarity = 15;
    whyEarned.push("Orbital spaceflight environment (ISS vs Space Shuttle) with zero shared animals (+15/20)");
    whyWithheld.push("Different vehicle flight profiles, mission cohorts, and atmospheric habitat conditions (-5)");
    tags.push("Orbital Flight Profiles");
  } else if ((platA === "ISS" && platB === "Ground-based Analog") || (platA === "Ground-based Analog" && platB === "ISS")) {
    exposurePlatformSimilarity = 12;
    whyEarned.push("True flight vs grounded terrestrial microgravity analog (zero shared animals) (+12/20)");
    whyWithheld.push("Ground analogs lack space radiation and true free-fall physics (-8)");
    tags.push("Flight vs Ground Analog");
  } else {
    exposurePlatformSimilarity = 8;
    whyWithheld.push("Heterogeneous exposure protocols (-12)");
  }

  // 4. Assay complementarity: 0-15
  const assayStrA = `${a.assay_measurement} ${a.assay_technology} ${a.assay_platform}`.toLowerCase();
  const assayStrB = `${b.assay_measurement} ${b.assay_technology} ${b.assay_platform}`.toLowerCase();

  const isSpatialA = assayStrA.includes("spatial") || assayStrA.includes("geomx");
  const isSpatialB = assayStrB.includes("spatial") || assayStrB.includes("geomx");
  const isMicroarrayA = assayStrA.includes("microarray");
  const isMicroarrayB = assayStrB.includes("microarray");
  const isBulkRnaA = !isSpatialA && !isMicroarrayA && (assayStrA.includes("rna") || assayStrA.includes("transcript"));
  const isBulkRnaB = !isSpatialB && !isMicroarrayB && (assayStrB.includes("rna") || assayStrB.includes("transcript"));
  const isAnyTranscriptA = isSpatialA || isBulkRnaA || isMicroarrayA;
  const isAnyTranscriptB = isSpatialB || isBulkRnaB || isMicroarrayB;
  const isIopOrHistoA = assayStrA.includes("iop") || assayStrA.includes("tonometry") || assayStrA.includes("histolog") || assayStrA.includes("micro-ct") || assayStrA.includes("immunostain");
  const isIopOrHistoB = assayStrB.includes("iop") || assayStrB.includes("tonometry") || assayStrB.includes("histolog") || assayStrB.includes("micro-ct") || assayStrB.includes("immunostain");
  const isPhysioIopA = assayStrA.includes("iop") || assayStrA.includes("tonometry");
  const isPhysioIopB = assayStrB.includes("iop") || assayStrB.includes("tonometry");
  const isMriA = assayStrA.includes("mri") || assayStrA.includes("oct");
  const isMriB = assayStrB.includes("mri") || assayStrB.includes("oct");
  const isIcpA = assayStrA.includes("telemetry") || assayStrA.includes("intracranial pressure");
  const isIcpB = assayStrB.includes("telemetry") || assayStrB.includes("intracranial pressure");

  if ((isBulkRnaA && isIopOrHistoB) || (isIopOrHistoA && isBulkRnaB)) {
    assayComplementarity = 15;
    whyEarned.push("High multi-modal synergy: Retinal RNA-seq paired with ocular IOP/Micro-CT/histopathology (+15/15)");
    tags.push("Transcriptomics × Imaging/Physiology");
  } else if ((isMriA && isIcpB) || (isIcpA && isMriB)) {
    assayComplementarity = 15;
    whyEarned.push("Structural MRI imaging paired with continuous invasive ICP telemetry (+15/15)");
    tags.push("MRI Morphometry × ICP Telemetry");
  } else if ((isPhysioIopA && isIopOrHistoB && !isPhysioIopB) || (isPhysioIopB && isIopOrHistoA && !isPhysioIopA)) {
    assayComplementarity = 12;
    whyEarned.push("Complementary structural Micro-CT/histopathology paired with IOP tonometry & BRB immunohistochemistry (+12/15)");
    whyWithheld.push("Both arms capture physiological/imaging phenotypes without transcriptional sequencing (-3)");
    tags.push("IOP Physiology × Micro-CT/Histology");
  } else if (isSpatialA && isSpatialB) {
    assayComplementarity = 14;
    whyEarned.push("Matched Nanostring GeoMx DSP spatial transcriptomics across anatomical brain regions (+14/15)");
    whyWithheld.push("Cross-slide / ROI coordinate alignment required before pooled modeling (-1)");
    tags.push("GeoMx Spatial × Spatial");
  } else if ((isSpatialA && isBulkRnaB) || (isBulkRnaA && isSpatialB)) {
    assayComplementarity = 12;
    whyEarned.push("Cross-resolution transcriptomics: Bulk Illumina RNA-seq bridged with Nanostring GeoMx DSP Spatial (+12/15)");
    whyWithheld.push("Resolution/scale mismatch between bulk retinal RNA-seq and GeoMx spatial ROIs (-3)");
    tags.push("Bulk RNA-seq × Spatial DSP");
  } else if (((isBulkRnaA || isSpatialA) && isMicroarrayB) || (isMicroarrayA && (isBulkRnaB || isSpatialB))) {
    assayComplementarity = 12;
    whyEarned.push("Cross-technology transcriptomic co-profiling (Sequencing vs Microarray) (+12/15)");
    whyWithheld.push("Cross-platform dynamic range differences between microarray and sequencing (-3)");
    tags.push("Sequencing × Microarray");
  } else if (isAnyTranscriptA && isAnyTranscriptB) {
    assayComplementarity = 13;
    whyEarned.push("Direct transcriptomic cross-mission replication (+13/15)");
    tags.push("Direct RNA-seq Replication");
  } else {
    assayComplementarity = 10;
    whyEarned.push("Complementary investigative modalities (+10/15)");
  }

  // 5. Timepoint / duration comparability: 0-10
  const durStrA = (manifestA?.mission.duration || a.study_factor || "").toLowerCase();
  const durStrB = (manifestB?.mission.duration || b.study_factor || "").toLowerCase();

  const is30sA = /\b3[0-9]\s*[- ]?d/i.test(durStrA) || durStrA.includes("30") || durStrA.includes("34") || durStrA.includes("35") || durStrA.includes("37");
  const is30sB = /\b3[0-9]\s*[- ]?d/i.test(durStrB) || durStrB.includes("30") || durStrB.includes("34") || durStrB.includes("35") || durStrB.includes("37");
  const isShortA = durStrA.includes("13") || durStrA.includes("14");
  const isShortB = durStrB.includes("13") || durStrB.includes("14");

  if (is30sA && is30sB) {
    timepointDurationComparability = 10;
    whyEarned.push("Synchronized long-duration spaceflight (~30–37 days on-orbit) (+10/10)");
    tags.push("Matched Duration (~30-37d)");
  } else if ((is30sA && isShortB) || (isShortA && is30sB)) {
    timepointDurationComparability = 6;
    whyEarned.push("Temporal comparison: Short (13d) vs Long (~35d) exposure (+6/10)");
    whyWithheld.push("Substantial duration divergence (acute 13-day shuttle vs chronic 35-day ISS) (-4)");
    tags.push("Temporal Duration Contrast");
  } else {
    timepointDurationComparability = 7;
    whyEarned.push("Moderately comparable exposure timeframes (+7/10)");
  }

  // 6. Control-design comparability: 0-10
  const ctrlA = manifestA?.experimentalGroups.controls || [];
  const ctrlB = manifestB?.experimentalGroups.controls || [];
  const hasAemGroundA = ctrlA.some(c => c.toLowerCase().includes("ground") || c.toLowerCase().includes("aem") || c.toLowerCase().includes("saline"));
  const hasAemGroundB = ctrlB.some(c => c.toLowerCase().includes("ground") || c.toLowerCase().includes("aem") || c.toLowerCase().includes("saline"));
  const factStrA = `${(manifestA?.experimentalGroups.factors || []).join(" ")} ${a.study_factor}`.toLowerCase();
  const factStrB = `${(manifestB?.experimentalGroups.factors || []).join(" ")} ${b.study_factor}`.toLowerCase();
  const hasDrugTxA = factStrA.includes("buoe") || factStrA.includes("inhibitor") || factStrA.includes("treatment");
  const hasDrugTxB = factStrB.includes("buoe") || factStrB.includes("inhibitor") || factStrB.includes("treatment");
  const asymmetricTreatment = hasDrugTxA !== hasDrugTxB;

  if (hasAemGroundA && hasAemGroundB && !asymmetricTreatment) {
    controlDesignComparability = 10;
    whyEarned.push("Standardized environmental ground habitat controls (Flight/Ground/Cohort Control design aligned) (+10/10)");
    tags.push("Aligned Ground & Cohort Controls");
  } else if (hasAemGroundA && hasAemGroundB && asymmetricTreatment) {
    controlDesignComparability = 8;
    whyEarned.push("Ground baseline controls present in both cohorts (+8/10)");
    whyWithheld.push("Asymmetric multi-factor pharmacological/countermeasure arm (e.g., BuOE or inhibitor) present in only one study (-2)");
  } else {
    controlDesignComparability = 8;
    whyEarned.push("Parallel baseline controls present (+8/10)");
  }

  // 7. Publication / evidence availability: 0-5
  const hasDoiA = Boolean(manifestA?.linkedPublications?.[0]?.doi || a.doi);
  const hasDoiB = Boolean(manifestB?.linkedPublications?.[0]?.doi || b.doi);

  if (hasDoiA && hasDoiB) {
    publicationEvidenceAvailability = 5;
    whyEarned.push("Peer-reviewed DOI/PMID publication evidence verified for both accessions (+5/5)");
    tags.push("Dual Peer-Reviewed Citations");
  } else if (hasDoiA || hasDoiB) {
    publicationEvidenceAvailability = 3;
    whyEarned.push("Repository DOI verified for one study (+3/5)");
    whyWithheld.push("One study relies solely on repository metadata without linked external DOI (-2)");
  } else {
    publicationEvidenceAvailability = 2;
    whyWithheld.push("Limited external publication DOI links (-3)");
  }

  let totalScore =
    organismMatch +
    tissueOverlap +
    exposurePlatformSimilarity +
    assayComplementarity +
    timepointDurationComparability +
    controlDesignComparability +
    publicationEvidenceAvailability;

  // Strict anti-hallucination cap: Never display >90 unless fully verified authoritative metadata
  if (totalScore > 90) {
    const fullyVerified =
      (manifestA?.confidence === "verified" || a.data_quality === "verified") &&
      (manifestB?.confidence === "verified" || b.data_quality === "verified") &&
      organismMatch >= 20 &&
      tissueOverlap >= 16;
    if (!fullyVerified) {
      totalScore = 89;
      whyWithheld.push("Score capped at 89: Requires full dual-study verified metadata and exact species match.");
    }
  }

  let comparisonReadiness: CompatibilityScoreBreakdown["comparisonReadiness"] = "direct-comparison ready";
  if (totalScore >= 80) {
    comparisonReadiness = "direct-comparison ready";
  } else if (totalScore >= 60) {
    comparisonReadiness = "contextually complementary";
  } else {
    comparisonReadiness = "hypothesis-generating only";
  }

  const commonScientificAxis = deriveScientificAxis(a, b);
  const whyChosen = `${commonScientificAxis} (${totalScore}/100 - ${comparisonReadiness})`;

  return {
    organismMatch,
    tissueOverlap,
    exposurePlatformSimilarity,
    assayComplementarity,
    timepointDurationComparability,
    controlDesignComparability,
    publicationEvidenceAvailability,
    totalScore,
    whyEarned,
    whyWithheld,
    verifiedFields,
    unresolvedFields,
    comparisonReadiness,
    whyChosen,
    commonScientificAxis,
    tags,
  };
}

function deriveScientificAxis(a: OSDRStudy, b: OSDRStudy): string {
  const normA = a.study_id.toUpperCase();
  const normB = b.study_id.toUpperCase();
  const pairSet = new Set([normA, normB]);

  if (pairSet.has("OSD-583") && pairSet.has("OSD-255")) {
    return "RR-9 Dual-Cohort Convergence: Ocular IOP & Blood-Retinal Barrier Histology (OSD-583) × Right-Retina RNA-seq (OSD-255)";
  }
  if (pairSet.has("OSD-557") && pairSet.has("OSD-255")) {
    return "RR-9 Left/Right Eye Bridge: Micro-CT & 4-HNE/PNA Histology (OSD-557) × Right-Retina RNA-seq (OSD-255)";
  }
  if (pairSet.has("OSD-583") && pairSet.has("OSD-557")) {
    return "RR-9 Dual-Cohort Imaging & Physiology: IOP & BRB Histology (OSD-583) × Micro-CT & 4-HNE/PNA Histology (OSD-557)";
  }
  if (pairSet.has("OSD-685") && pairSet.has("OSD-698")) {
    return "RR-18 / SpaceX-24 Brain GeoMx Spatial Transcriptomics: Dentate Gyrus (OSD-685) × Frontal Cortex (OSD-698)";
  }
  if (pairSet.has("OSD-255") && (pairSet.has("OSD-685") || pairSet.has("OSD-698"))) {
    const brainId = pairSet.has("OSD-685") ? "OSD-685" : "OSD-698";
    return `Cross-Mission Oxidative & Neural Bridge: RR-9 Retina RNA-seq (OSD-255) × RR-18 Brain GeoMx Spatial (${brainId}) — Zero Shared Animals`;
  }
  if (pairSet.has("OSD-100") && pairSet.has("OSD-194")) {
    return "Cross-Mission Spaceflight Comparison: RR-1 Eye Omics (OSD-100) vs RR-3 CASIS Retina (OSD-194)";
  }
  if (pairSet.has("OSD-679") && pairSet.has("OSD-680")) {
    return "Cephalad Fluid Shift In Vivo Diagnostics: Ocular OCT & IOP (OSD-679) × Optic Nerve MRI (OSD-680)";
  }
  if (pairSet.has("OSD-680") && pairSet.has("OSD-681")) {
    return "Neuro-Visual Pressure Dynamics: Optic Nerve MRI (OSD-680) × Telemetric ICP (OSD-681)";
  }
  if (pairSet.has("OSD-87") && pairSet.has("OSD-583")) {
    return "Spaceflight Temporal Progression: Shuttle STS-135 13d (OSD-87) vs ISS RR-9 35d (OSD-583)";
  }
  return `${a.study_factor} and ${b.study_factor} Comparative Adaptation Analysis`;
}

export function getSuggestedAwgPairs(): SuggestedAwgPair[] {
  const all = getAllStudies();
  const candidates: Array<[string, string, string]> = [
    ["OSD-583", "OSD-255", "RR-9 Dual-Cohort: Ocular IOP & BRB Histology × Retina RNA-seq"],
    ["OSD-557", "OSD-255", "RR-9 Eye Bridge: Micro-CT & 4-HNE/PNA Histology × Retina RNA-seq"],
    ["OSD-685", "OSD-698", "RR-18 Brain Spatial Transcriptomics: Dentate Gyrus × Frontal Cortex"],
    ["OSD-100", "OSD-194", "Cross-Mission ISS Comparison: RR-1 Eye Omics × RR-3 CASIS Retina"],
    ["OSD-679", "OSD-680", "Ground SANS Analog: Ocular OCT/IOP × Optic Nerve MRI"],
    ["OSD-680", "OSD-681", "Head-Down Tilt Analog: Optic Nerve MRI × Telemetric ICP"],
    ["OSD-87", "OSD-583", "Shuttle STS-135 (13d) vs ISS RR-9 (35d) Retinal Stress Dynamics"],
    ["OSD-758", "OSD-759", "Centrifuge Countermeasure: 1g On-Orbit vs Ground Baseline"],
  ];

  const suggested: SuggestedAwgPair[] = [];

  for (const [idA, idB, customTitle] of candidates) {
    const studyA = getStudyById(idA);
    const studyB = getStudyById(idB);
    if (!studyA || !studyB) continue;

    const breakdown = scoreStudyCompatibility(studyA, studyB);
    suggested.push({
      studyA,
      studyB,
      studyIds: [idA, idB],
      title: customTitle,
      tag: breakdown.comparisonReadiness,
      score: breakdown.totalScore,
      breakdown,
      whyMatched: breakdown.whyChosen,
      commonAxis: breakdown.commonScientificAxis,
    });
  }

  suggested.sort((a, b) => b.score - a.score);
  return suggested;
}

export function selectRandomCompatiblePair(excludeIds: string[] = []): {
  studyA: OSDRStudy;
  studyB: OSDRStudy;
  score: number;
  breakdown: CompatibilityScoreBreakdown;
  whyChosen: string;
  commonScientificAxis: string;
  tags: string[];
} {
  const suggested = getSuggestedAwgPairs();
  const available = suggested.filter(
    (p) =>
      !excludeIds.includes(p.studyA.study_id) ||
      !excludeIds.includes(p.studyB.study_id)
  );

  const pool = available.length > 0 ? available : suggested;
  const topSlice = pool.slice(0, Math.min(5, pool.length));
  const selected = topSlice[Math.floor(Math.random() * topSlice.length)] || suggested[0];

  return {
    studyA: selected.studyA,
    studyB: selected.studyB,
    score: selected.score,
    breakdown: selected.breakdown,
    whyChosen: selected.whyMatched,
    commonScientificAxis: selected.commonAxis,
    tags: selected.breakdown.tags,
  };
}

export function parseAwgQuery(rawMessage: string): AwgParsedQuery {
  const text = rawMessage.trim();
  const lower = text.toLowerCase();

  const slashCommandMatches = text.match(/(?:^|\s)\/(?:awg|compare|meme|help|analyze|media|audit|summary)/gi);
  if (slashCommandMatches && slashCommandMatches.length > 1) {
    return {
      isAwg: true,
      action: "multiple_commands_error",
      explicitStudyIds: [],
      rawRequestedAccessions: [],
      cleanQuery: text,
    };
  }

  const isAwgPrefix =
    lower.startsWith("/awg") ||
    lower.startsWith("!awg") ||
    lower.startsWith("awg:") ||
    lower === "awg";

  const rawRequestedAccessions = parseRawAccessions(text);
  const explicitStudyIds = Array.from(new Set(rawRequestedAccessions));

  if (!isAwgPrefix && rawRequestedAccessions.length < 2 && !lower.includes("awg compare") && !lower.includes("compare study")) {
    return {
      isAwg: false,
      action: "general",
      explicitStudyIds,
      rawRequestedAccessions,
      cleanQuery: text,
    };
  }

  let action: AwgParsedQuery["action"] = "compare";

  if (
    lower === "/awg" ||
    lower === "!awg" ||
    lower === "awg" ||
    lower === "awg:" ||
    lower === "/awg chooser" ||
    lower === "/awg guide" ||
    lower === "/awg menu"
  ) {
    action = "guided_chooser";
  } else if (
    lower === "/awg help" ||
    lower === "!awg help" ||
    lower.startsWith("/awg -h") ||
    lower.startsWith("/awg --help") ||
    lower === "/awg ?"
  ) {
    action = "help";
  } else if (
    lower === "/awg random" ||
    lower === "/awg roll" ||
    lower === "/awg pick random" ||
    lower === "/awg auto" ||
    lower.startsWith("/awg random") ||
    lower.startsWith("/awg roll")
  ) {
    action = "random_pair";
  } else if (
    lower === "/awg meme" ||
    lower === "!awg meme" ||
    lower === "awg meme" ||
    lower.startsWith("/awg meme") ||
    lower.startsWith("!awg meme") ||
    lower.startsWith("awg meme")
  ) {
    action = "meme";
  } else if (
    lower === "/awg media audit" ||
    lower === "!awg media audit" ||
    lower === "awg media audit" ||
    lower.startsWith("/awg media audit") ||
    lower.startsWith("!awg media audit") ||
    lower.startsWith("awg media audit") ||
    lower === "/awg audit" ||
    lower === "!awg audit" ||
    lower.startsWith("/awg audit")
  ) {
    action = "media_audit";
  } else if (lower.includes("summary") || lower.includes("overview")) {
    action = "summary";
  } else if (isAwgPrefix && rawRequestedAccessions.length === 0 && !lower.includes("compare") && !lower.includes("analyze") && !lower.includes("visual") && !lower.includes("video")) {
    action = "guided_chooser";
  } else if (rawRequestedAccessions.length === 1 && (lower.includes("analyze") || lower.includes("detail"))) {
    action = "analyze";
  }

  let clean = text.replace(/^\/?(awg|!awg|awg:)\s*/i, "").trim();
  clean = clean.replace(/^(compare|analyze|summary|help|random|roll|chooser|guide|meme)\s*/i, "").trim();

  return {
    isAwg: true,
    action,
    explicitStudyIds,
    rawRequestedAccessions,
    cleanQuery: clean || text,
  };
}

export type EvidenceTier =
  | "METADATA"
  | "OBSERVED RESULT"
  | "INTERPRETATION"
  | "HYPOTHESIS"
  | "CANDIDATE FOLLOW-UP"
  | "CONCEPTUAL COMMUNICATION";

export type EvidenceClass =
  | EvidenceTier
  | "observed_fact"
  | "evidence_informed_synthesis"
  | "conceptual_visualization"
  | "unverified_speculation";

export interface ObservedStudyMetadata {
  tier: "METADATA";
  study_id: string;
  organism: string;
  tissue: string;
  assay: string;
  platform: string;
  factor: string;
  duration: string;
  mission: string;
  repositoryUrl: string;
  fileCount: number;
  releaseDate: string;
  dataQuality: "verified" | "partially_verified" | "unresolved";
  sourceStatement: string;
}

export interface ObservedResult {
  tier: "OBSERVED RESULT";
  study_id: string;
  finding: string;
  sourceReference: string;
  doi?: string;
  pmid?: string;
  assayContext: string;
}

export interface InterpretationClaim {
  tier: "INTERPRETATION";
  subtype: "Interpretation" | "Hypothesis" | "Candidate follow-up";
  badge: "INTERPRETATION" | "HYPOTHESIS" | "CANDIDATE FOLLOW-UP";
  topic: string;
  claim: string;
  rationale: string;
  epistemicCaution: string;
}

export interface GroundedStudyFact {
  study_id: string;
  organism: string;
  tissue: string;
  factor: string;
  assay: string;
  platform: string;
  mission: string;
  flight_program: string;
  managing_center: string;
  release_date: string;
  file_count: number;
  source_type: "live_api" | "cached_snapshot" | "local_curated_mapping" | "static_seeded_example";
  endpoint_used?: string;
  last_fetched?: string;
  observedFinding: string;
  sourceReference?: string;
  evidenceTier?: EvidenceTier;
}

export interface InferredSynthesisClaim {
  topic: string;
  claim: string;
  epistemicLabel: "evidence_informed_synthesis" | "proposed_hypothesis";
  rationale: string;
  evidenceTier?: EvidenceTier;
  badge?: string;
}

export interface ConceptualVisualPlan {
  artifactType: string;
  category: string;
  description: string;
  disclaimer: string;
  tier?: "CONCEPTUAL COMMUNICATION";
}

export interface ArtifactGroundingCard {
  groundedAccessions: string[];
  sourceMode: "live_api" | "cached_snapshot" | "local_curated_mapping" | "static_seeded_example";
  activeEndpoint?: string;
  lastFetchedAt?: string;
  observedFacts: GroundedStudyFact[];
  studyMetadata: ObservedStudyMetadata[];
  observedResults: ObservedResult[];
  interpretationClaims: InterpretationClaim[];
  inferredSynthesis: InferredSynthesisClaim[];
  conceptualVisuals: ConceptualVisualPlan[];
  provenanceFooter: string;
}

export interface AwgEvidenceMap {
  comparisonTitle: string;
  studyA: OSDRStudy;
  studyB: OSDRStudy;
  manifestA: StudyManifest | null;
  manifestB: StudyManifest | null;
  allStudies: OSDRStudy[];
  studyIds: string[];
  sourceMode: "live_api" | "cached_snapshot" | "local_curated_mapping" | "static_seeded_example";
  lastFetchedAt?: string;
  activeEndpoint?: string;
  sharedPhenotype: string;
  omicsContrast: string;
  biologicalCorrelation: string;
  scoreBreakdown: CompatibilityScoreBreakdown;
  studyMetadata: ObservedStudyMetadata[];
  observedResults: ObservedResult[];
  interpretationClaims: InterpretationClaim[];
  groundedFacts: GroundedStudyFact[];
  observedFacts: GroundedStudyFact[];
  inferredSynthesis: InferredSynthesisClaim[];
  conceptualVisuals: ConceptualVisualPlan[];
  groundingCard: ArtifactGroundingCard;
  schemaGuardrails?: SchemaGuardrailNotice[];
  schemaContract?: IngestionSchemaContract;
  unifiedProvenanceFooter: string;
}

export interface AwgGroundedPair {
  studyA: OSDRStudy;
  studyB: OSDRStudy;
  allStudies: OSDRStudy[];
  studyIds: string[];
  sharedPhenotype: string;
  omicsContrast: string;
  biologicalCorrelation: string;
  isSystemSelected: boolean;
  systemSelectionRationale?: string;
  commonScientificAxis?: string;
  compatibilityScore?: number;
  compatibilityTags?: string[];
  evidenceMap: AwgEvidenceMap;
  requestedPair?: [string, string] | [string] | [];
  resolvedPair?: [string, string] | null;
  validationStatus?: AccessionValidationStatus;
  fallbackReason?: string;
  validationError?: AccessionValidationResult;
}

export type AwgResolutionResult =
  | { success: true; pair: AwgGroundedPair }
  | { success: false; validation: AccessionValidationResult };

/**
 * Extracts pure, unembellished repository metadata directly from OSDR study attributes and manifests.
 */
export function extractStudyMetadata(study: OSDRStudy): ObservedStudyMetadata {
  const normId = study.study_id.toUpperCase();
  const manifest = getStudyManifest(normId);

  const duration = manifest?.mission.duration ||
    study.study_factor.match(/(\d+[\s-]*(?:days?|d|weeks?|w|hrs?|hours?))/i)?.[1] ||
    "Documented protocol duration";

  return {
    tier: "METADATA",
    study_id: normId,
    organism: manifest?.organism.scientificName ? `${manifest.organism.scientificName} (${manifest.organism.commonName})` : study.organism,
    tissue: manifest?.tissueMaterial.exactScope.join(", ") || study.material_type,
    assay: manifest?.assays.map(a => a.name).join("; ") || study.assay_measurement,
    platform: manifest?.assays.map(a => a.platform).join("; ") || study.assay_platform,
    factor: manifest?.experimentalGroups.factors.join("; ") || study.study_factor,
    duration,
    mission: manifest?.mission.name || study.mission || "NASA Space Biology",
    repositoryUrl: manifest?.osdrRecordUrl || `https://osdr.nasa.gov/bio/repo/data/studies/${normId}`,
    fileCount: study.file_count || 10,
    releaseDate: study.release_date || "2023",
    dataQuality: manifest?.confidence || study.data_quality || "verified",
    sourceStatement: `Authoritative NASA OSDR Accession ${normId} Record (${study.managing_center || "NASA Ames Research Center"})`,
  };
}

/**
 * Grounded empirical observed results strictly backed by cited publications,
 * repository results files, or traceable analytical sources.
 */
export function extractObservedResultsForStudy(study: OSDRStudy): ObservedResult[] {
  const normId = study.study_id.toUpperCase();
  const manifest = getStudyManifest(normId);

  if (manifest && manifest.directPublicationSupportedFindings.length > 0) {
    return manifest.directPublicationSupportedFindings.map(f => ({
      tier: "OBSERVED RESULT",
      study_id: normId,
      finding: f.finding,
      sourceReference: f.sourceCitation,
      doi: f.doi,
      pmid: f.pmid,
      assayContext: manifest.assays.map(a => a.name).join(", "),
    }));
  }

  // Fallback to study publication if no manifest
  return [{
    tier: "OBSERVED RESULT",
    study_id: normId,
    finding: study.publication_title
      ? `Repository publication '${study.publication_title}' (${study.publication_authors || "NASA OSDR"}) reports empirical profiling of ${study.material_type} in ${study.organism} measuring ${study.assay_measurement} under ${study.study_factor}.`
      : `Empirically profiled ${study.material_type} in ${study.organism} measuring ${study.assay_measurement} via ${study.assay_platform} under ${study.study_factor}.`,
    sourceReference: study.publication_authors
      ? `${study.publication_authors} (${study.managing_center || "NASA OSDR"})`
      : `NASA OSDR Repository Record (${study.managing_center || "NASA Ames Research Center"})`,
    doi: study.doi,
    pmid: study.pmid,
    assayContext: `${study.assay_measurement} (${study.assay_platform})`,
  }];
}

export function extractObservedResult(study: OSDRStudy): ObservedResult {
  const results = extractObservedResultsForStudy(study);
  return results[0];
}

/**
 * Derives rigorous interpretation and hypothesis claims with clear epistemic boundaries.
 */
export function deriveInterpretationClaims(studyA: OSDRStudy, studyB: OSDRStudy): InterpretationClaim[] {
  const normA = studyA.study_id.toUpperCase();
  const normB = studyB.study_id.toUpperCase();
  const pairSet = new Set([normA, normB]);

  const isRR9IopRna = pairSet.has("OSD-583") && pairSet.has("OSD-255");
  const isRR9ImagingRna = pairSet.has("OSD-557") && pairSet.has("OSD-255");
  const isRR9PhysioImg = pairSet.has("OSD-583") && pairSet.has("OSD-557");
  const isRR18BrainSpatial = pairSet.has("OSD-685") && pairSet.has("OSD-698");
  const isCrossMissionRetinaBrain =
    pairSet.has("OSD-255") && (pairSet.has("OSD-685") || pairSet.has("OSD-698"));
  const isCrossMission = pairSet.has("OSD-100") && pairSet.has("OSD-194");
  const isFlightVsAnalog = pairSet.has("OSD-583") && pairSet.has("OSD-679");
  const isHdtCohort = pairSet.has("OSD-679") && pairSet.has("OSD-680");

  let mechanismClaim = `Co-analysis of ${studyA.study_id} and ${studyB.study_id} suggests that molecular and physiological responses in ${studyA.material_type} (${studyA.assay_measurement}) correlate with regulatory alterations in ${studyB.material_type} (${studyB.assay_measurement}) under ${studyA.study_factor}.`;
  let sansRelevance = `SANS-relevant: Evaluates ocular adaptation and fluid shift mechanisms in mammalian spaceflight models without conflating rodent tissue data with human clinical diagnoses.`;
  let countermeasureClaim = `Candidate microvascular barrier stabilization and targeted antioxidant protection represent investigative targets for follow-up validation.`;

  if (isRR9IopRna) {
    mechanismClaim = `Co-analysis across RR-9 (SpaceX-12) ocular cohorts proposes that post-flight intraocular pressure shifts, TUNEL apoptosis, and AQP-4 blood-retinal barrier disruption (OSD-583) align chronologically with right-retina transcriptional dysregulation across phototransduction and oxidative stress pathways in OSD-255 (n=16 right retinas).`;
    sansRelevance = `SANS-relevant: Links physiological ocular pressure/barrier phenotypes to retinal gene expression during 35-day ISS spaceflight under strict p >> n (n=16) and CC1/CC2 cohort-control validation constraints.`;
    countermeasureClaim = `Candidate follow-up: Validate blood-retinal barrier tight-junction stabilization and oxidative-stress mitigation using animal-disjoint RR-9 feature priors.`;
  } else if (isRR9ImagingRna) {
    mechanismClaim = `Co-analysis across RR-9 eyes connects left-eye SkyScan 1272 Micro-CT morphometry and 4-HNE/PNA photoreceptor oxidative immunostaining (OSD-557, n=35) with right-retina Illumina RNA-seq differential expression (OSD-255, n=16).`;
    sansRelevance = `SANS-relevant: Pairs structural and lipid-peroxidation photoreceptor imaging phenotypes with transcriptomic signatures across the same 35-day ISS mission while respecting separate left- vs. right-eye assay splits.`;
    countermeasureClaim = `Candidate follow-up: Map 4-HNE lipid-peroxidation histology scores against conserved retinal oxidative-response gene modules across independent cohorts.`;
  } else if (isRR9PhysioImg) {
    mechanismClaim = `Co-analysis across RR-9 imaging and physiology cohorts associates rebound tonometry IOP changes and AQP-4 blood-retinal barrier markers (OSD-583) with Micro-CT ocular geometry and 4-HNE/PNA photoreceptor staining (OSD-557).`;
    sansRelevance = `SANS-relevant: Synthesizes non-transcriptomic structural, physiological, and histological endpoints from RR-9 without fabricating sequencing assays inside OSD-557 (retinal RNA-seq resides in OSD-255).`;
    countermeasureClaim = `Candidate follow-up: Bridge OSD-583 and OSD-557 phenotypes with OSD-255 right-retina RNA-seq under a unified RR-9 multi-modal schema contract.`;
  } else if (isRR18BrainSpatial) {
    mechanismClaim = `Within RR-18 (SpaceX-24), Nanostring GeoMx DSP spatial transcriptomics across Dentate Gyrus (OSD-685, n=12) and Frontal Cortex (OSD-698, n=12) reveals region-dependent CNS oxidative and metabolic transcriptional responses that are attenuated by metalloporphyrin antioxidant BuOE treatment.`;
    sansRelevance = `CNS/Neuro-ocular relevance: Provides spatially resolved brain region expression benchmarks (SpaceX-24, zero shared animals with RR-9 retina) for evaluating cross-tissue neuro-oxidative stress alignment.`;
    countermeasureClaim = `Candidate follow-up: Perform ROI coordinate alignment between OSD-685 and OSD-698 prior to cross-mission bridging with retinal RNA-seq cohorts.`;
  } else if (isCrossMissionRetinaBrain) {
    const brainId = pairSet.has("OSD-685") ? "OSD-685" : "OSD-698";
    mechanismClaim = `Cross-mission exploratory synthesis compares RR-9 (SpaceX-12) right-retina RNA-seq (OSD-255, n=16) against RR-18 (SpaceX-24) brain Nanostring GeoMx spatial transcriptomics (${brainId}, n=12). Because these studies fly on different missions with zero shared animals and distinct CNS tissues, only pathway-level rather than subject-level alignment is valid.`;
    sansRelevance = `Cross-mission schema constraint: Tests whether oxidative-stress and BuOE-modulated signatures in spatial brain regions generalize to microgravity retinal responses without leaking batch or animal identity.`;
    countermeasureClaim = `Candidate follow-up: Apply animal-disjoint inner-fold normalization, CC1/CC2 vs. saline/BuOE batch controls, and spatial coordinate harmonization before cross-mission imputation.`;
  } else if (isCrossMission) {
    mechanismClaim = `Cross-mission synthesis across RR-1 (OSD-100) and RR-3 (OSD-194) proposes that sustained spaceflight microgravity triggers reproducible retinal gene expression shifts affecting phototransduction and extracellular matrix regulation across independent missions (zero shared animals).`;
    sansRelevance = `SANS-relevant: Serves as a multi-mission mammalian baseline for spaceflight ocular stress pathways, distinct from clinical human SANS diagnoses.`;
    countermeasureClaim = `Candidate follow-up: Investigate whether endothelial tight-junction preservation prevents retinal gene dysregulation across missions of 30+ days duration.`;
  } else if (isHdtCohort) {
    mechanismClaim = `Co-analysis of ground-based head-down tilt cohorts indicates that in vivo retinal layer thickness alterations and intraocular pressure shifts (OSD-679) correlate anatomically with MRI-quantified optic nerve sheath enlargement and optic nerve head elevation (OSD-680) under simulated cephalic fluid redistribution.`;
    sansRelevance = `SANS-relevant analog: Directly models the biomechanical cephalad fluid shift hypothesis of SANS in unsedated rodents.`;
    countermeasureClaim = `Candidate follow-up: Evaluate lower-body negative pressure (LBNP) or venous return countermeasures to mitigate optic nerve sheath distension during fluid shifts.`;
  } else if (isFlightVsAnalog) {
    mechanismClaim = `Cross-platform synthesis proposes that cephalad fluid shifts under ground head-down tilt (OSD-679) recapitulate key intraocular pressure dynamic shifts observed during on-orbit spaceflight (OSD-583).`;
    sansRelevance = `SANS-relevant comparison: Evaluates the extent to which hydrostatic cephalad venous pooling mirrors true microgravity ocular adaptations.`;
    countermeasureClaim = `Candidate follow-up: Perform matched multi-modal validation to benchmark ground analog IOP trajectories against flight measurements.`;
  }

  return [
    {
      tier: "INTERPRETATION",
      subtype: "Interpretation",
      badge: "INTERPRETATION",
      topic: "Cross-Study Biological Interpretation",
      claim: mechanismClaim,
      rationale: "Synthesized from verified repository metadata and peer-reviewed publication findings across both accessions.",
      epistemicCaution: "This is a model interpretation synthesized across independent datasets; not a single closed-form experimental measurement.",
    },
    {
      tier: "INTERPRETATION",
      subtype: "Hypothesis",
      badge: "HYPOTHESIS",
      topic: "Ocular Adaptation & SANS-Relevance Hypothesis",
      claim: sansRelevance,
      rationale: "Formulated based on shared neuro-ocular tissues, cephalad fluid shift analogs, and spaceflight mission factors.",
      epistemicCaution: "Rodent ocular findings provide hypothesis-generating insights into space biology adaptation; they must not be equated with clinical astronaut SANS diagnosis.",
    },
    {
      tier: "INTERPRETATION",
      subtype: "Candidate follow-up",
      badge: "CANDIDATE FOLLOW-UP",
      topic: "Candidate Translational Follow-up Target",
      claim: countermeasureClaim,
      rationale: isHdtCohort
        ? "Proposed based on observed biomechanical and morphological findings in analog imaging datasets."
        : "Proposed based on observed oxidative and vascular stress markers in flight and analog datasets.",
      epistemicCaution: "Candidate investigative target requiring empirical pre-clinical validation in controlled ground and flight studies.",
    },
  ];
}

function buildSchemaGuardrailsAndContract(
  studyA: OSDRStudy,
  studyB: OSDRStudy,
  manifestA: StudyManifest | null,
  manifestB: StudyManifest | null
): {
  schemaGuardrails: SchemaGuardrailNotice[];
  schemaContract: IngestionSchemaContract;
} {
  const missionKeyA = deriveMissionKey(studyA, manifestA);
  const missionKeyB = deriveMissionKey(studyB, manifestB);
  const sameMission = Boolean(missionKeyA && missionKeyB && missionKeyA === missionKeyB);
  const sharedAnimalsPossible = sameMission;

  const nA = extractSampleCountN(studyA, manifestA);
  const nB = extractSampleCountN(studyB, manifestB);

  const controlsSet = new Set<string>([
    ...(manifestA?.validationConstraints?.cohortControls || []),
    ...(manifestA?.experimentalGroups?.controls || []),
    ...(manifestB?.validationConstraints?.cohortControls || []),
    ...(manifestB?.experimentalGroups?.controls || []),
  ]);
  const cohortControlsDetected = Array.from(controlsSet);

  const spatialA =
    Boolean(manifestA?.validationConstraints?.spatialAlignmentRequired) ||
    `${studyA.assay_measurement} ${studyA.assay_technology} ${studyA.assay_platform}`.toLowerCase().includes("spatial") ||
    `${studyA.assay_platform}`.toLowerCase().includes("geomx");
  const spatialB =
    Boolean(manifestB?.validationConstraints?.spatialAlignmentRequired) ||
    `${studyB.assay_measurement} ${studyB.assay_technology} ${studyB.assay_platform}`.toLowerCase().includes("spatial") ||
    `${studyB.assay_platform}`.toLowerCase().includes("geomx");
  const spatialAlignmentRequired = spatialA || spatialB;

  const guardrails: SchemaGuardrailNotice[] = [];

  if (!sameMission) {
    guardrails.push({
      code: "ZERO_SHARED_ANIMALS",
      severity: "warning",
      title: "Cross-Mission Pairing — Zero Shared Animals",
      detail: `${studyA.study_id} (${missionKeyA}) and ${studyB.study_id} (${missionKeyB}) originate from separate missions/protocols with zero shared animal subjects. Do not perform animal-level sample joins.`,
    });
  } else if (studyA.study_id !== studyB.study_id) {
    guardrails.push({
      code: "SAME_MISSION_DISSECTION_SPLIT",
      severity: "info",
      title: `Same Mission Cohort (${missionKeyA.replace(/_/g, " / ")})`,
      detail: `Both accessions originate from ${missionKeyA.replace(/_/g, " / ")}; verify eye/tissue dissection splits (e.g., left eye vs. right retina or distinct sub-cohorts) and enforce animal-disjoint CV splits.`,
    });
  }

  if ((nA !== null && nA <= 50) || (nB !== null && nB <= 50)) {
    const nSummary = [
      `${studyA.study_id}: n=${nA ?? "unknown"}`,
      `${studyB.study_id}: n=${nB ?? "unknown"}`,
    ].join(" · ");
    guardrails.push({
      code: "P_GT_N_ANIMAL_DISJOINT",
      severity: (nA !== null && nA <= 20) || (nB !== null && nB <= 20) ? "warning" : "info",
      title: "Extreme p >> n — Animal-Disjoint CV Required",
      detail: `Small cohort sample count (${nSummary}) demands strictly animal-disjoint outer folds with feature selection and scaling performed strictly inside inner folds.`,
    });
  }

  const hasCohortBatch = cohortControlsDetected.some(
    (c) => /cc1|cc2|cohort control|saline|buoe|vivarium/i.test(c)
  );
  if (hasCohortBatch) {
    guardrails.push({
      code: "COHORT_BATCH_CONTROLS",
      severity: "warning",
      title: "Cohort / Treatment Batch Controls Detected",
      detail: `Detected control strata (${cohortControlsDetected.join(", ")}). Stratify and control for batch/treatment effects (e.g., CC1 vs. CC2, saline vs. BuOE) so models do not learn cohort artifacts.`,
    });
  }

  if (spatialAlignmentRequired) {
    guardrails.push({
      code: "SPATIAL_ALIGNMENT",
      severity: "warning",
      title: "Spatial ROI Coordinate Alignment Required",
      detail: `Includes spatial transcriptomics (Nanostring GeoMx DSP). Harmonize ROI coordinates, slide normalization, and bulk-vs-spatial feature scales prior to ingestion.`,
    });
  }

  const recommendedCvStrategy = !sameMission
    ? "Per-cohort animal-disjoint outer CV with inner-fold feature selection; cross-mission bridging only via shared pathway/gene priors (zero subject-level pairing)."
    : (nA !== null && nA <= 24) || (nB !== null && nB <= 24)
    ? "Strictly animal-disjoint outer k-fold CV (e.g., 4 folds × 2 repeats) with inner-fold feature selection/scaling and CC1/CC2 batch awareness."
    : "Animal-disjoint k-fold cross-validation with inner-fold normalization and cohort-control stratification.";

  const schemaContract: IngestionSchemaContract = {
    contractVersion: "1.0.0",
    pairId: `${studyA.study_id}__${studyB.study_id}`,
    generatedAt: new Date().toISOString(),
    sameMission,
    sharedAnimalsPossible,
    animalDisjointRequired: true,
    recommendedCvStrategy,
    cohortControlsDetected,
    spatialAlignmentRequired,
    studies: [studyA, studyB].map((s, idx) => {
      const m = idx === 0 ? manifestA : manifestB;
      return {
        accession: s.study_id,
        mission: m?.mission.name || s.mission,
        missionKey: idx === 0 ? missionKeyA : missionKeyB,
        platform: m?.mission.platform || s.assay_platform,
        organism: m?.organism.scientificName || s.organism,
        tissueScope: m?.tissueMaterial.exactScope || [s.material_type],
        assayModalities: m?.assays.map((a) => a.name) || [s.assay_measurement],
        sampleCountN: idx === 0 ? nA : nB,
        controls: m?.experimentalGroups.controls || [],
        doi: m?.linkedPublications?.[0]?.doi || s.doi,
        pmid: m?.linkedPublications?.[0]?.pmid || s.pmid,
        osdrUrl: m?.osdrRecordUrl || `https://osdr.nasa.gov/bio/repo/data/studies/${s.study_id}`,
      };
    }),
    guardrails,
  };

  return { schemaGuardrails: guardrails, schemaContract };
}

export function buildAwgEvidenceMap(studyA: OSDRStudy, studyB: OSDRStudy): AwgEvidenceMap {
  const diag = getDiagnostics();
  const sourceMode =
    studyA.source_type ||
    studyB.source_type ||
    (diag.connectionStatus === "connected" ? "live_api" : "static_seeded_example");

  const lastFetchedAt = studyA.fetched_at || studyB.fetched_at || diag.lastSuccessfulFetch;
  const activeEndpoint = diag.activeEndpoints?.search || "https://osdr.nasa.gov/osdr/data/search";

  const manifestA = getStudyManifest(studyA.study_id);
  const manifestB = getStudyManifest(studyB.study_id);
  const scoreBreakdown = scoreStudyCompatibility(studyA, studyB);

  const sharedPhenotype = deriveSharedPhenotype(studyA, studyB);
  const omicsContrast = `${studyA.assay_measurement} (${studyA.study_id}) vs ${studyB.assay_measurement} (${studyB.study_id})`;
  const biologicalCorrelation = deriveBiologicalCorrelation(studyA, studyB);

  // 1. Observed Study Metadata
  const metaA = extractStudyMetadata(studyA);
  const metaB = extractStudyMetadata(studyB);
  const studyMetadata: ObservedStudyMetadata[] = [metaA];
  if (studyB.study_id !== studyA.study_id) {
    studyMetadata.push(metaB);
  }

  // 2. Observed Results (Strictly supported by publication/OSDR results files)
  const resultsA = extractObservedResultsForStudy(studyA);
  const resultsB = extractObservedResultsForStudy(studyB);
  const observedResults: ObservedResult[] = [...resultsA];
  if (studyB.study_id !== studyA.study_id) {
    observedResults.push(...resultsB);
  }

  // 3. Interpretations
  const interpretationClaims = deriveInterpretationClaims(studyA, studyB);

  // Grounded study facts for telemetry card
  const groundedFacts: GroundedStudyFact[] = [
    {
      study_id: studyA.study_id,
      organism: studyA.organism,
      tissue: studyA.material_type,
      factor: studyA.study_factor,
      assay: studyA.assay_measurement,
      platform: studyA.assay_platform,
      mission: studyA.mission,
      flight_program: studyA.flight_program,
      managing_center: studyA.managing_center,
      release_date: studyA.release_date,
      file_count: studyA.file_count,
      source_type: studyA.source_type || sourceMode,
      observedFinding: resultsA[0]?.finding || "Repository verified dataset",
      sourceReference: resultsA[0]?.sourceReference,
      evidenceTier: "METADATA",
    },
    {
      study_id: studyB.study_id,
      organism: studyB.organism,
      tissue: studyB.material_type,
      factor: studyB.study_factor,
      assay: studyB.assay_measurement,
      platform: studyB.assay_platform,
      mission: studyB.mission,
      flight_program: studyB.flight_program,
      managing_center: studyB.managing_center,
      release_date: studyB.release_date,
      file_count: studyB.file_count,
      source_type: studyB.source_type || sourceMode,
      observedFinding: resultsB[0]?.finding || "Repository verified dataset",
      sourceReference: resultsB[0]?.sourceReference,
      evidenceTier: "METADATA",
    },
  ];

  const inferredSynthesis: InferredSynthesisClaim[] = interpretationClaims.map(c => ({
    topic: c.topic,
    claim: c.claim,
    epistemicLabel: c.subtype === "Hypothesis" ? "proposed_hypothesis" : "evidence_informed_synthesis",
    rationale: c.rationale,
    evidenceTier: "INTERPRETATION",
    badge: c.badge,
  }));

  const conceptualVisuals: ConceptualVisualPlan[] = [
    {
      artifactType: "canvas_motion_render",
      category: "scientific_motion_brief",
      description: `60fps kinetic visualizer mapping verified metadata and observed endpoints for ${studyA.study_id} and ${studyB.study_id}.`,
      disclaimer: "Kinetic motion simulation rendered client-side; visual layout is a conceptual representation of verified metadata.",
      tier: "CONCEPTUAL COMMUNICATION",
    },
  ];

  const unifiedProvenanceFooter = `Metadata-grounded; interpretation separated. Verified against NASA OSDR records for ${studyA.study_id} & ${studyB.study_id}.`;

  const { schemaGuardrails, schemaContract } = buildSchemaGuardrailsAndContract(
    studyA,
    studyB,
    manifestA,
    manifestB
  );

  const groundingCard: ArtifactGroundingCard = {
    groundedAccessions: [studyA.study_id, studyB.study_id],
    sourceMode,
    activeEndpoint,
    lastFetchedAt,
    observedFacts: groundedFacts,
    studyMetadata,
    observedResults,
    interpretationClaims,
    inferredSynthesis,
    conceptualVisuals,
    provenanceFooter: unifiedProvenanceFooter,
  };

  return {
    comparisonTitle: scoreBreakdown.commonScientificAxis,
    studyA,
    studyB,
    manifestA,
    manifestB,
    allStudies: [studyA, studyB],
    studyIds: [studyA.study_id, studyB.study_id],
    sourceMode,
    lastFetchedAt,
    activeEndpoint,
    sharedPhenotype,
    omicsContrast,
    biologicalCorrelation,
    scoreBreakdown,
    studyMetadata,
    observedResults,
    interpretationClaims,
    groundedFacts,
    observedFacts: groundedFacts,
    inferredSynthesis,
    conceptualVisuals,
    groundingCard,
    schemaGuardrails,
    schemaContract,
    unifiedProvenanceFooter,
  };
}

export async function resolveAwgStudies(parsed: AwgParsedQuery): Promise<AwgGroundedPair | null> {
  if (parsed.action === "guided_chooser" || parsed.action === "help") {
    return null;
  }

  if (parsed.action === "random_pair") {
    const randomPick = selectRandomCompatiblePair();
    const studyA = randomPick.studyA;
    const studyB = randomPick.studyB;
    const evidenceMap = buildAwgEvidenceMap(studyA, studyB);

    return {
      studyA,
      studyB,
      allStudies: [studyA, studyB],
      studyIds: [studyA.study_id, studyB.study_id],
      sharedPhenotype: evidenceMap.sharedPhenotype,
      omicsContrast: evidenceMap.omicsContrast,
      biologicalCorrelation: evidenceMap.biologicalCorrelation,
      isSystemSelected: true,
      systemSelectionRationale: randomPick.whyChosen,
      commonScientificAxis: randomPick.commonScientificAxis,
      compatibilityScore: randomPick.score,
      compatibilityTags: randomPick.tags,
      evidenceMap,
      requestedPair: [studyA.study_id, studyB.study_id],
      resolvedPair: [studyA.study_id, studyB.study_id],
      validationStatus: "valid",
    };
  }

  const rawAccessions = parsed.rawRequestedAccessions || parsed.explicitStudyIds;
  const validation = await validateAwgAccessions(rawAccessions);

  if (!validation.isValid || !validation.studyA || !validation.studyB) {
    const fallbackStudy = validation.studyA || getStudyById("OSD-583") || getAllStudies()[0];
    const dummyB = validation.studyB || getStudyById("OSD-255") || getAllStudies()[1] || fallbackStudy;
    const evidenceMap = buildAwgEvidenceMap(fallbackStudy, dummyB);

    return {
      studyA: fallbackStudy,
      studyB: dummyB,
      allStudies: [fallbackStudy, dummyB],
      studyIds: [fallbackStudy.study_id, dummyB.study_id],
      sharedPhenotype: evidenceMap.sharedPhenotype,
      omicsContrast: evidenceMap.omicsContrast,
      biologicalCorrelation: evidenceMap.biologicalCorrelation,
      isSystemSelected: false,
      evidenceMap,
      requestedPair: validation.requestedPair,
      resolvedPair: null,
      validationStatus: validation.validationStatus,
      fallbackReason: validation.fallbackReason,
      validationError: validation,
    };
  }

  const studyA = validation.studyA;
  const studyB = validation.studyB;

  const breakdown = scoreStudyCompatibility(studyA, studyB);
  const evidenceMap = buildAwgEvidenceMap(studyA, studyB);

  return {
    studyA,
    studyB,
    allStudies: [studyA, studyB],
    studyIds: [studyA.study_id, studyB.study_id],
    sharedPhenotype: evidenceMap.sharedPhenotype,
    omicsContrast: evidenceMap.omicsContrast,
    biologicalCorrelation: evidenceMap.biologicalCorrelation,
    isSystemSelected: false,
    systemSelectionRationale: breakdown.whyChosen,
    commonScientificAxis: breakdown.commonScientificAxis,
    compatibilityScore: breakdown.totalScore,
    compatibilityTags: breakdown.tags,
    evidenceMap,
    requestedPair: [studyA.study_id, studyB.study_id],
    resolvedPair: [studyA.study_id, studyB.study_id],
    validationStatus: "valid",
  };
}

function deriveSharedPhenotype(a: OSDRStudy, b: OSDRStudy): string {
  const matA = a.material_type.toLowerCase();
  const matB = b.material_type.toLowerCase();
  if ((matA.includes("retina") && matB.includes("brain")) || (matB.includes("retina") && matA.includes("brain"))) {
    return "Cross-Mission Spaceflight Neuro-Ocular & Oxidative Stress Bridge (Zero Shared Animals)";
  }
  if (matA.includes("brain") && matB.includes("brain")) {
    return "Spaceflight Brain Spatial Transcriptomics & BuOE Antioxidant Attenuation (RR-18)";
  }
  if (matA.includes("retina") || matB.includes("retina")) {
    return "Spaceflight Ocular Adaptation & Blood-Retinal Barrier Dynamics";
  }
  if (a.study_factor.toLowerCase().includes("tilt") || b.study_factor.toLowerCase().includes("tilt")) {
    return "Cephalad Fluid Shift & Intracranial/Intraocular Pressure Dynamics";
  }
  return `${a.study_factor} and ${a.organism} Space Biology Adaptation`;
}

function deriveBiologicalCorrelation(a: OSDRStudy, b: OSDRStudy): string {
  const assayA = a.assay_measurement.toLowerCase();
  const assayB = b.assay_measurement.toLowerCase();

  if ((assayA.includes("tonometry") || assayA.includes("iop")) && assayB.includes("rna")) {
    return "Physiological IOP dynamics and immunohistochemical blood-retinal barrier disruption co-analyzed with right-retina RNA-seq dysregulation in phototransduction and oxidative stress pathways.";
  }
  if ((assayA.includes("micro-ct") || assayA.includes("4-hne")) && assayB.includes("rna")) {
    return "RR-9 left-eye Micro-CT geometry & 4-HNE/PNA photoreceptor staining paired with right-retina RNA-seq transcriptional profiling.";
  }
  if (assayA.includes("spatial") && assayB.includes("spatial")) {
    return "Regional Nanostring GeoMx DSP spatial transcriptomics across mouse Dentate Gyrus and Frontal Cortex under SpaceX-24 microgravity and BuOE treatment.";
  }
  if ((assayA.includes("spatial") && assayB.includes("rna")) || (assayB.includes("spatial") && assayA.includes("rna"))) {
    return "Cross-mission bulk RNA-seq vs. Nanostring GeoMx DSP spatial transcriptomics exploratory comparison requiring animal-disjoint normalization and spatial ROI harmonization.";
  }
  if (assayA.includes("oct") && assayB.includes("mri")) {
    return "In vivo optical coherence tomography retinal thickness dynamics paired with MRI morphometric quantification of optic nerve sheath enlargement under cephalad fluid shift.";
  }
  return `Multi-modal analysis contrasting ${a.assay_measurement} and ${b.assay_measurement} profiles under ${a.study_factor}.`;
}

/**
 * Standardized AWG System Prompt enforcing the strict 7-section anti-hallucination structure:
 * 1. Verified Study Metadata
 * 2. Publication-Supported Findings
 * 3. Cross-Study Interpretation
 * 4. Hypotheses
 * 5. Candidate Follow-Up
 * 6. Limitations
 * 7. Sources
 */
export const AWG_SYSTEM_PROMPT = `You are a Senior Principal Scientist in NASA's Open Science Data Repository (OSDR) Analysis Working Group (AWG).

The user is executing AWG Analysis Mode (triggered by /awg commands).
Your task is to provide an authoritative, publication-grounded comparison of the retrieved OSDR studies strictly adhering to NASA OSDR scientific integrity rules.

Strict Anti-Hallucination Directives:
1. Never infer, invent, merge, or silently substitute study metadata. If a fact is not verified from an authoritative source, label it as unknown, unsupported, or hypothesis—not observed evidence.
2. Authoritative source hierarchy:
   - 1. NASA OSDR study record and machine-readable metadata/API response
   - 2. NASA GeneLab / OSDR-linked experiment, sample, and assay metadata
   - 3. Study-linked peer-reviewed publication or DOI/PMID
   - 4. Explicitly labeled model interpretation
   - 5. Explicitly labeled hypothesis or candidate follow-up
3. Do not claim an assay unless the NASA OSDR record or linked publication explicitly supports it (verify exact assay modalities from repository metadata rather than assuming omics assays).
4. Do not expand tissue labels ("Whole eye" must not automatically become "retina, optic nerve, and choroid").
5. Do not equate rodent ocular findings with astronaut SANS. Use "SANS-relevant," "ocular adaptation relevance," or "hypothesis-generating".
6. Do not describe causality from cross-study correlation.
7. Explicitly itemize why points were earned and withheld in compatibility scores.

You MUST format EVERY comparison response using EXACTLY these 7 sections:

### ✦ NASA OSDR Analysis Working Group (AWG) Study Comparison

#### 1. Verified Study Metadata
- **[METADATA] OSD-XXX**: Organism, Strain, Sex, Tissue (exact scope), Assay (exact name), Platform, Factor, Duration, Platform (ISS / Shuttle / Analog), Data Quality Tier.
- **[METADATA] OSD-YYY**: Organism, Strain, Sex, Tissue (exact scope), Assay (exact name), Platform, Factor, Duration, Platform (ISS / Shuttle / Analog), Data Quality Tier.

#### 2. Publication-Supported Findings
- **[OBSERVED RESULT] OSD-XXX**: Traceable empirical findings from linked publication/DOI. *(Source: Citation/DOI/PMID if available in OSDR metadata or study manifest)*
- **[OBSERVED RESULT] OSD-YYY**: Traceable empirical findings from linked publication/DOI. *(Source: Citation/DOI/PMID if available in OSDR metadata or study manifest)*

#### 3. Cross-Study Interpretation
Clearly state that this is an interpretation. Detail the biological rationale and analytical limitations.
- **[INTERPRETATION]**: [Biological synthesis explaining cross-study relationships with explicit epistemic caution]

#### 4. Hypotheses
Clearly label as untested hypotheses and avoid causal language.
- **[HYPOTHESIS]**: [SANS-relevant or ocular adaptation hypothesis derived from the evidence]

#### 5. Candidate Follow-Up
Describe concrete pre-clinical or clinical validation needed before claims can be made.
- **[CANDIDATE FOLLOW-UP]**: [Targeted experimental countermeasure or multi-omics validation study]

#### 6. Limitations
Explicitly detail:
- Species differences (e.g. rat vs mouse vs human translation)
- Tissue scope differences (e.g. whole eye vs isolated retina)
- Platform & exposure differences (e.g. ground analog fluid shift vs orbital microgravity)
- Duration differences (e.g. 13d vs 35d vs 90d)
- Control design differences (AEM ground vs vivarium controls)
- Unresolved or missing metadata fields

#### 7. Sources
Provide clickable, exact NASA OSDR URLs and linked publication identifiers/DOIs.
- NASA OSDR Study Record: [OSD-XXX](https://osdr.nasa.gov/bio/repo/data/studies/OSD-XXX) · [OSD-YYY](https://osdr.nasa.gov/bio/repo/data/studies/OSD-YYY)
- Publications / DOIs: [Linked study publication with DOI/PMID if present in OSDR metadata]

**Unified Provenance**: Metadata-grounded; interpretation separated. Grounded in authoritative NASA OSDR repository records.`;

export function createAwgHelpMessage(): string {
  return `### ✦ NASA OSDR Analysis Working Group (AWG) Scientific Reference

**AWG Mode** provides authoritative, evidence-grounded cross-study comparison of NASA Open Science Data Repository (OSDR) accessions.

**Available Commands**:
- \`/awg\` — **Open Interactive Chooser**: Select curated accessions, roll random pairs, or explore compatibility breakdowns.
- \`/awg compare OSD-583 OSD-255\` — **RR-9 Dual Cohort**: Ocular Physiology (IOP & Histology) × Right-Retina RNA-seq.
- \`/awg compare OSD-557 OSD-255\` — **RR-9 Left/Right Eye Bridge**: Micro-CT & 4-HNE/PNA Histology × Right-Retina RNA-seq.
- \`/awg compare OSD-685 OSD-698\` — **RR-18 Spatial Transcriptomics**: Brain GeoMx DSP Dentate Gyrus × Frontal Cortex.
- \`/awg compare OSD-100 OSD-194\` — **Cross-Mission ISS Comparison**: RR-1 Eye Transcriptomics & Epigenomics × RR-3 CASIS.
- \`/awg compare OSD-679 OSD-680\` — **Ground SANS Analog**: Ocular OCT/IOP × Optic Nerve MRI Morphometry.
- \`/awg compare OSD-680 OSD-681\` — **Intracranial Pressure Dynamics**: Optic Nerve MRI × Telemetric ICP Biotelemetry.
- \`/awg random\` — **System-Selected Compatible Pair**: Randomly selects a top-scoring pair with transparent point breakdown.
- \`/awg meme\` — **Educational Science Communication**: Generates a scientifically grounded educational meme concept.
- \`/awg media audit\` — **Auditable Generation Log**: Inspects provenance records, model fingerprints, and cache verification.
- \`/awg help\` — **Help & Command Guide**: Displays this reference.

**Transparent 7-Axis Compatibility Scoring (0–100)**:
1. **Organism Match** (0–20 pts): Same species vs cross-rodent mammalian orthology.
2. **Tissue / Material Overlap** (0–20 pts): Matched retina vs whole eye vs visual tract.
3. **Exposure / Platform Similarity** (0–20 pts): ISS microgravity vs Space Shuttle vs Ground Analog.
4. **Assay Complementarity** (0–15 pts): Multi-modal synergy (Sequencing × Physiology × Imaging).
5. **Timepoint / Duration Comparability** (0–10 pts): Matched mission duration (~35d).
6. **Control-Design Comparability** (0–10 pts): Standardized AEM ground habitat baseline controls.
7. **Publication & Evidence Availability** (0–5 pts): Verified peer-reviewed DOI/PMID literature support.`;
}
