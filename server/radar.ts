import { INITIAL_STUDIES, OSDRStudy } from "./studiesData";
import { CANONICAL_STUDY_MANIFESTS } from "./studyManifests";
import {
  OSDR_ENDPOINTS,
  osdrSourceToStudy,
  upsertOsdrStudies,
  getStudyById,
  asCleanText,
} from "./osdrClient";
import { scoreStudyCompatibility } from "./awg";
import bundledSnapshotRaw from "./radarSnapshot.json";

export type RadarSubgroupId =
  | "SANS / Ocular"
  | "AI/ML"
  | "Multi-Omics"
  | "Animal"
  | "Plant"
  | "Microbes"
  | "Human"
  | "RadLab"
  | "ALSDA"
  | "Female Reproduction";

export type RadarWindowId = "month" | "current_quarter" | "prev_quarter" | "archive";

export interface AwgLeadProfile {
  id: string;
  name: string;
  orcid: string;
  subgroup: string;
  role: string;
  focusTags: string[];
  europePmcAuth: string[];
  spotlight?: boolean;
}

export interface RadarConceptAction {
  kind: "use_now" | "roadmap";
  title: string;
  detail: string;
  command?: string;
  prompt?: string;
  extensionTarget?: string;
}

export interface RadarAnchorMatch {
  studyId: string;
  title: string;
  totalScore: number;
  comparisonReadiness: string;
  commonScientificAxis: string;
  whyChosen: string;
  comparabilityTier: "direct_retinal_sans" | "translational_mammalian";
  comparabilityLabel: string;
}

export interface RadarOsdrRelease {
  studyId: string;
  title: string;
  organism: string;
  materialType: string;
  assayMeasurement: string;
  assayPlatform: string;
  studyFactor: string;
  mission: string;
  sourceSystem: "cgene" | "alsda";
  releaseDate: string;
  quarterLabel: string;
  windowBucket: RadarWindowId;
  isRecentMonth: boolean;
  subgroup: RadarSubgroupId;
  sansRelevant: boolean;
  doi?: string;
  osdrUrl: string;
  scopeVerified: boolean;
  scopeMatchedBy: string[];
  bestAnchor?: RadarAnchorMatch;
  concepts: RadarConceptAction[];
  studyRecord: OSDRStudy;
}

export interface RadarLeadSignal {
  id: string;
  leadId: string;
  leadName: string;
  leadRole: string;
  leadSubgroup: string;
  leadOrcid: string;
  spotlight: boolean;
  status: "pre_osdr_signal" | "live_on_osdr";
  sourcePlatform:
    | "ORCID + OpenAlex + Europe PMC"
    | "ORCID + OpenAlex"
    | "OpenAlex (Preprint)"
    | "OpenAlex"
    | "ORCID + Europe PMC"
    | "ORCID"
    | "Europe PMC (Preprint)"
    | "Europe PMC"
    | "Crossref"
    | "PubMed"
    | "NASA NTRS"
    | "Multi-Source"
    | "Webhook Push"
    | "NASA OSDR";
  title: string;
  journal: string;
  publishedDate: string;
  quarterLabel: string;
  windowBucket: RadarWindowId;
  isRecentMonth: boolean;
  isPreprint: boolean;
  doi?: string;
  pmid?: string;
  pmcid?: string;
  url: string;
  externalAccessions: string[];
  linkedOsdIds: string[];
  scopeMatchedBy: string[];
  summarySnippet?: string;
  concepts: RadarConceptAction[];
}

export interface RadarLeadSummary extends AwgLeadProfile {
  inScopeCount: number;
  preOsdrCount: number;
  liveOsdrCount: number;
  filteredOutNonSpaceCount: number;
}

export interface RadarSnapshot {
  schemaVersion: string;
  generatedAt: string;
  currentMonthLabel: string;
  currentQuarterLabel: string;
  previousQuarterLabel: string;
  sourceStatus: {
    osdrMode: "live_api" | "bundled_snapshot";
    orcidMode: "live_api" | "bundled_snapshot";
    openalexMode: "live_api" | "bundled_snapshot";
    europePmcMode: "live_api" | "bundled_snapshot";
    ntrsMode?: "live_api" | "bundled_snapshot";
    crossrefMode?: "live_api" | "bundled_snapshot";
    pubmedMode?: "live_api" | "bundled_snapshot";
    googleScholarNote: string;
    lastError?: string | null;
  };
  leads: RadarLeadSummary[];
  osdrReleases: RadarOsdrRelease[];
  leadSignals: RadarLeadSignal[];
  scopeAudit: {
    totalWorksScanned: number;
    inScopeCount: number;
    filteredOutNonSpaceCount: number;
    filterDescription: string;
  };
}

/**
 * Verified NASA OSDR / GeneLab AWG Subgroup Chairs + Ryan T. Scott.
 * Every ORCID below has been verified directly against pub.orcid.org/v3.0/{orcid}/works.
 */
export const AWG_LEAD_WATCHLIST: AwgLeadProfile[] = [
  {
    id: "ryan-scott",
    name: "Ryan T. Scott",
    orcid: "0000-0003-0654-5661",
    subgroup: "ALSDA & OSDR",
    role: "OSDR Science Lead & ALSDA AWG Chair",
    focusTags: ["ALSDA", "OSDR", "CNS", "Neuro-Immune", "Data Curation"],
    europePmcAuth: ['AUTH:"Scott RT"', 'AUTH:"Ryan T Scott"'],
    spotlight: true,
  },
  {
    id: "lauren-sanders",
    name: "Lauren M. Sanders",
    orcid: "0000-0001-9393-0861",
    subgroup: "AI/ML",
    role: "AI/ML AWG Chair",
    focusTags: ["AI/ML", "Foundation Models", "Knowledge Graphs", "Multi-Omics"],
    europePmcAuth: ['AUTH:"Sanders LM"', 'AUTH:"Lauren M Sanders"'],
  },
  {
    id: "afshin-beheshti",
    name: "Afshin Beheshti",
    orcid: "0000-0003-4643-531X",
    subgroup: "Multi-Omics",
    role: "Multi-Omics AWG Chair",
    focusTags: ["Multi-Omics", "miRNA", "Mitochondria", "SOMA"],
    europePmcAuth: ['AUTH:"Beheshti A"'],
  },
  {
    id: "amber-paul",
    name: "Amber M. Paul",
    orcid: "0000-0002-1657-3618",
    subgroup: "Animal",
    role: "Animal AWG Chair",
    focusTags: ["Animal", "Neuro-Immune", "Rodent Research", "Retina"],
    europePmcAuth: ['AUTH:"Paul AM"', 'AUTH:"Amber M Paul"'],
  },
  {
    id: "richard-barker",
    name: "Richard J. Barker",
    orcid: "0000-0001-5681-9857",
    subgroup: "Plant",
    role: "Plant AWG Chair",
    focusTags: ["Plant", "TOAST", "Arabidopsis", "Spaceflight Transcriptomics"],
    europePmcAuth: ['AUTH:"Barker RJ"', 'AUTH:"Richard J Barker"'],
  },
  {
    id: "daniela-bezdan",
    name: "Daniela Bezdan",
    orcid: "0000-0002-1203-8239",
    subgroup: "Microbes",
    role: "Microbes AWG Chair",
    focusTags: ["Microbes", "Metagenomics", "SOMA", "ISS Microbiome"],
    europePmcAuth: ['AUTH:"Bezdan D"', 'AUTH:"Daniela Bezdan"'],
  },
  {
    id: "eliah-overbey",
    name: "Eliah G. Overbey",
    orcid: "0000-0002-2866-8294",
    subgroup: "Human",
    role: "Human AWG Chair",
    focusTags: ["Human", "SOMA", "Spatial Transcriptomics", "RR-9 Retina"],
    europePmcAuth: ['AUTH:"Overbey EG"', 'AUTH:"Eliah G Overbey"'],
  },
  {
    id: "kirill-grigorev",
    name: "Kirill Grigorev",
    orcid: "0000-0003-3628-0123",
    subgroup: "RadLab",
    role: "RadLab AWG Chair",
    focusTags: ["RadLab", "Space Radiation", "SOMA", "Long-Read Sequencing"],
    europePmcAuth: ['AUTH:"Grigorev K"', 'AUTH:"Kirill Grigorev"'],
  },
  {
    id: "begum-mathyk",
    name: "Begum Aydogan Mathyk",
    orcid: "0000-0001-9832-6284",
    subgroup: "Female Reproduction",
    role: "Female Reproduction & Health AWG Chair",
    focusTags: ["Female Reproduction", "SOMA", "Endocrine", "Spaceflight Health"],
    europePmcAuth: ['AUTH:"Mathyk BA"', 'AUTH:"Aydogan Mathyk B"'],
  },
];

const BENCHMARK_ANCHOR_IDS = ["OSD-255", "OSD-583", "OSD-685", "OSD-679"];

// Strict Space Biology / OSDR domain rules so unrelated clinical papers never leak into the radar.
const SPACE_BIOLOGY_PATTERNS: Array<{ label: string; regex: RegExp; caseSensitive?: boolean }> = [
  { label: "spaceflight", regex: /\bspace[- ]?(?:flight|flown|faring)\b/i },
  { label: "microgravity / hypogravity", regex: /\b(?:micro[- ]?gravity|hypogravity|weightlessness|simulated microgravity|clinostat)\b/i },
  { label: "NASA OSDR / GeneLab / ALSDA", regex: /\b(?:osdr|genelab|alsda|radlab|nasa)\b/i },
  { label: "space biology / life sciences", regex: /\bspace\s+(?:life\s+sciences?|biosciences?|biology|biomedical|medicine|health|omics|hazards?|exploration|mission|environment|analog)\b/i },
  { label: "SOMA / Inspiration4 / Polaris", regex: /\b(?:inspiration\s*4|polaris\s+dawn|space\s+omics\s+and\s+medical\s+atlas)\b/i },
  { label: "SOMA (acronym)", regex: /\bSOMA\b/, caseSensitive: true },
  { label: "astronaut / crewed orbital", regex: /\b(?:astronauts?|cosmonauts?|orbital\s+(?:flight|spaceflight)|low[- ]earth\s+orbit|commercial\s+space|deep[- ]space)\b/i },
  { label: "ISS", regex: /\bISS\b|international\s+space\s+station/ },
  { label: "Rodent Research / Shuttle / Bion", regex: /\b(?:rodent\s+research|rr-?\d+|sts-?\d+|spacex-?\d+|bion-m\d*|artemis)\b/i },
  { label: "SANS / Ocular Space", regex: /\bSANS\b|neuro-ocular|translaminar\s+autonomous|optic\s+nerve\s+sheath/i },
  { label: "HDT / Hindlimb Unloading / Parabolic", regex: /\b(?:head[- ]down\s+tilt|hindlimb\s+unload(?:ed|ing)|artificial\s+gravity|hypergravity|parabolic\s+flight)\b/i },
  { label: "Bed Rest Analog", regex: /\bbed[- ]?rest\b/i },
  { label: "Space Radiation", regex: /\b(?:space\s+radiation|galactic\s+cosmic|cosmic\s+radiation|solar\s+particle|\bGCR\b|heavy[- ]ion\s+irradiation)\b/i },
  { label: "Gravitropism / TOAST / Astrobiology", regex: /\b(?:gravitrop\w*|test\s+of\s+arabidopsis\s+space\s+transcriptome|\bTOAST\b|astroimmunolog\w*|astrobiolog\w*)\b/i },
  { label: "OSDR Accession", regex: /\b(?:osd|glds|lsds)-\d+\b/i },
];

export interface ScopeEvaluation {
  inScope: boolean;
  matchedTerms: string[];
  excludedReason?: string;
}

export function evaluateSpaceBiologyScope(input: {
  title?: string;
  journal?: string;
  summary?: string;
  accessions?: string[];
  isNativeOsdrRecord?: boolean;
}): ScopeEvaluation {
  if (input.isNativeOsdrRecord) {
    return {
      inScope: true,
      matchedTerms: ["NASA OSDR Repository"],
    };
  }

  const combined = `${input.title || ""} ${input.journal || ""} ${input.summary || ""} ${(input.accessions || []).join(" ")}`;
  const matchedTerms: string[] = [];

  for (const rule of SPACE_BIOLOGY_PATTERNS) {
    // Handle case-sensitive rules directly without /i flag
    if (rule.label === "SOMA (acronym)") {
      if (/\bSOMA\b/.test(combined) && /space|omics|astronaut|nasa|osdr|atlas|biobank|flight/i.test(combined)) {
        matchedTerms.push("SOMA");
      }
      continue;
    }
    if (rule.label === "ISS") {
      if (/\bISS\b/.test(combined) || /international\s+space\s+station/i.test(combined)) {
        matchedTerms.push("ISS");
      }
      continue;
    }
    if (rule.label === "SANS / Ocular Space") {
      if (/\bSANS\b/.test(combined) || /neuro[- ]ocular\s+syndrome|translaminar\s+autonomous/i.test(combined)) {
        matchedTerms.push("SANS / Ocular Space");
      }
      continue;
    }
    if (rule.regex.test(combined)) {
      matchedTerms.push(rule.label);
    }
  }

  if (matchedTerms.length > 0) {
    return {
      inScope: true,
      matchedTerms: Array.from(new Set(matchedTerms)),
    };
  }

  return {
    inScope: false,
    matchedTerms: [],
    excludedReason: "No NASA OSDR, GeneLab, AWG, spaceflight, microgravity, or space-radiation domain match",
  };
}

export function parseFlexibleDateMs(raw?: string): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const t = Date.parse(`${s}T12:00:00Z`);
    return Number.isNaN(t) ? null : t;
  }
  if (/^\d{4}-\d{2}$/.test(s)) {
    const t = Date.parse(`${s}-15T12:00:00Z`);
    return Number.isNaN(t) ? null : t;
  }
  if (/^\d{4}$/.test(s)) {
    const t = Date.parse(`${s}-06-15T12:00:00Z`);
    return Number.isNaN(t) ? null : t;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

export function getQuarterInfo(dateMs: number): { year: number; quarter: number; label: string } {
  const d = new Date(dateMs);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0-11
  const quarter = Math.floor(month / 3) + 1;
  return { year, quarter, label: `${year}-Q${quarter}` };
}

export function getPreviousQuarterLabel(refMs: number): string {
  const { year, quarter } = getQuarterInfo(refMs);
  if (quarter === 1) return `${year - 1}-Q4`;
  return `${year}-Q${quarter - 1}`;
}

export function classifyTimeWindow(
  dateStr: string | undefined,
  referenceMs: number = Date.now()
): { quarterLabel: string; windowBucket: RadarWindowId; isRecentMonth: boolean } {
  const currentQ = getQuarterInfo(referenceMs).label;
  const prevQ = getPreviousQuarterLabel(referenceMs);
  const refDate = new Date(referenceMs);
  const refYm = refDate.toISOString().slice(0, 7);

  if (!dateStr) {
    return { quarterLabel: "Unspecified", windowBucket: "archive", isRecentMonth: false };
  }

  const trimmed = dateStr.trim();
  if (/^\d{4}$/.test(trimmed)) {
    const yr = Number(trimmed);
    const refYr = refDate.getUTCFullYear();
    return {
      quarterLabel: `${yr}`,
      windowBucket: yr >= refYr ? "archive" : "archive",
      isRecentMonth: false,
    };
  }

  const parsedMs = parseFlexibleDateMs(trimmed);
  if (!parsedMs) {
    return { quarterLabel: "Unspecified", windowBucket: "archive", isRecentMonth: false };
  }

  const qInfo = getQuarterInfo(parsedMs);
  const diffDays = (referenceMs - parsedMs) / (1000 * 60 * 60 * 24);
  const isRecentMonth = trimmed.startsWith(refYm) || (diffDays >= -2 && diffDays <= 35);

  let windowBucket: RadarWindowId = "archive";
  if (qInfo.label === currentQ) {
    windowBucket = isRecentMonth ? "month" : "current_quarter";
  } else if (qInfo.label === prevQ) {
    windowBucket = "prev_quarter";
  }

  return {
    quarterLabel: qInfo.label,
    windowBucket,
    isRecentMonth,
  };
}

export function isMammalianOrganism(organism?: string): boolean {
  const org = (organism || "").toLowerCase();
  return /\b(?:mus\s+musculus|rattus|homo\s+sapiens|mouse|mice|rat|human|macaca|sus\s+scrofa)\b/.test(org);
}

export function classifyOsdrSubgroup(study: OSDRStudy, sourceSystem: "cgene" | "alsda"): {
  subgroup: RadarSubgroupId;
  sansRelevant: boolean;
} {
  const organism = (study.organism || "").toLowerCase();
  const titleMaterial = `${study.title} ${study.material_type} ${study.assay_measurement}`.toLowerCase();
  const factorTitle = `${study.title} ${study.study_factor}`.toLowerCase();
  const fullText = `${study.title} ${study.description} ${study.material_type} ${study.organism} ${study.assay_measurement}`.toLowerCase();

  // Check SANS / Ocular strictly against anatomical title/material or unambiguous SANS acronyms so non-ocular studies never false-trigger
  const sansRelevant =
    /\b(?:retina|retinal|ocular|eye|eyes|optic\s+nerve|intraocular|iop|translaminar|choroid|photoreceptor|head[- ]down\s+tilt|intracranial\s+pressure|sans|neuro-ocular)\b/.test(
      titleMaterial
    );

  if (sansRelevant) {
    return { subgroup: "SANS / Ocular", sansRelevant: true };
  }

  // Classify taxonomy primarily from `study.organism` + title BEFORE scanning background prose in descriptions
  if (
    /\b(?:arabidopsis|lactuca|solanum|brassica|triticum|oryza|zea\s+mays|glycine|plant|seedling)\b/.test(organism) ||
    /\b(?:greenhouse|tomato\s+crop|space\s+crop|aeroponic|xroots|arabidopsis|plant\s+growth)\b/.test(titleMaterial)
  ) {
    return { subgroup: "Plant", sansRelevant: false };
  }

  if (
    /\b(?:streptococcus|staphylococcus|burkholderia|saccharomyces|escherichia|bacillus|lactobacillus|lacticaseibacillus|pseudomonas|salmonella|aspergillus|fungi|yeast|bacteria|euprymna)\b/.test(
      organism
    ) ||
    /\b(?:bioburden|biofilm|biosensor|yeast|microbiome|microbial)\b/.test(titleMaterial)
  ) {
    return { subgroup: "Microbes", sansRelevant: false };
  }

  if (
    /\bhomo\s+sapiens\b|\bhuman\b/.test(organism) ||
    /\b(?:astronaut|inspiration4|polaris\s+dawn|human\s+brain\s+organoid|human\s+gut-on-chip|iih|patient)\b/.test(
      titleMaterial
    )
  ) {
    return { subgroup: "Human", sansRelevant: false };
  }

  if (/\b(?:radiation|cosmic|proton|heavy[- ]ion|gamma|\bhze\b|ionizing\s+radiation|gcr)\b/.test(factorTitle)) {
    return { subgroup: "RadLab", sansRelevant: false };
  }

  if (sourceSystem === "alsda") {
    return { subgroup: "ALSDA", sansRelevant: false };
  }

  if (
    /\b(?:mus\s+musculus|rattus|mouse|mice|rat|drosophila|caenorhabditis|danio)\b/.test(organism) ||
    /\b(?:mouse|mice|rat|murine|rodent)\b/.test(titleMaterial)
  ) {
    return { subgroup: "Animal", sansRelevant: false };
  }

  if (/arabidopsis|seedling/.test(fullText)) return { subgroup: "Plant", sansRelevant: false };
  if (/mus\s+musculus|rattus/.test(fullText)) return { subgroup: "Animal", sansRelevant: false };

  return { subgroup: "Multi-Omics", sansRelevant: false };
}

export function scoreAgainstAnchors(
  study: OSDRStudy,
  sansRelevant: boolean = false
): RadarAnchorMatch | undefined {
  // Never imply clinical/SANS compatibility scores for Plant, Yeast, Bacteria, or Squid datasets
  if (!isMammalianOrganism(study.organism) && !sansRelevant) {
    return undefined;
  }

  const neuroVisualText = `${study.title} ${study.material_type} ${study.study_factor}`.toLowerCase();
  const isDirectRetinalOrSans =
    sansRelevant || /\b(?:eye|retina|ocular|optic|iih|translaminar|intraocular|head[- ]down)\b/.test(neuroVisualText);
  const isCnsNeuro = /\b(?:brain|hippocamp|cortex|neuro|alzheimer)\b/.test(neuroVisualText);

  let best: RadarAnchorMatch | undefined;

  for (const anchorId of BENCHMARK_ANCHOR_IDS) {
    if (anchorId === study.study_id) continue;
    const anchor = getStudyById(anchorId);
    if (!anchor) continue;

    const breakdown = scoreStudyCompatibility(study, anchor);
    if (!best || breakdown.totalScore > best.totalScore) {
      best = {
        studyId: anchor.study_id,
        title: anchor.title,
        totalScore: breakdown.totalScore,
        comparisonReadiness: isDirectRetinalOrSans
          ? breakdown.comparisonReadiness
          : isCnsNeuro
          ? "neuro-systemic comparator"
          : "systemic spaceflight comparator",
        commonScientificAxis: breakdown.commonScientificAxis,
        whyChosen: breakdown.whyChosen,
        comparabilityTier: isDirectRetinalOrSans ? "direct_retinal_sans" : "translational_mammalian",
        comparabilityLabel: isDirectRetinalOrSans
          ? "Direct Retinal / SANS Candidate"
          : isCnsNeuro
          ? "Mammalian CNS Comparator (Non-Ocular Tissue)"
          : "Mammalian Spaceflight Comparator (Non-Ocular Tissue)",
      };
    }
  }

  return best;
}

export function buildOsdrReleaseConcepts(
  study: OSDRStudy,
  sourceSystem: "cgene" | "alsda",
  subgroup: RadarSubgroupId,
  bestAnchor?: RadarAnchorMatch
): RadarConceptAction[] {
  const concepts: RadarConceptAction[] = [];

  if (bestAnchor) {
    const compareLabel =
      bestAnchor.comparabilityTier === "direct_retinal_sans"
        ? `Compare ${study.study_id} × ${bestAnchor.studyId} in AWG Mode`
        : `Cross-Tissue Contrast: ${study.study_id} × ${bestAnchor.studyId}`;
    concepts.push({
      kind: "use_now",
      title: compareLabel,
      detail: `${bestAnchor.comparabilityLabel}: run 4-tab Evidence Audit, zero-shared-animals guardrail check, and Schema Contract JSON export against anchor ${bestAnchor.studyId} (rubric ${bestAnchor.totalScore}/100).`,
      command: `/awg compare ${study.study_id} ${bestAnchor.studyId}`,
    });
  } else {
    concepts.push({
      kind: "use_now",
      title: `Inspect Non-Mammalian / ${subgroup} Release (${study.study_id})`,
      detail: `Review assay architecture and factor schema directly (non-mammalian studies are intentionally excluded from retinal SANS compatibility scoring).`,
      command: `/awg analyze ${study.study_id}`,
    });
  }

  concepts.push({
    kind: "use_now",
    title: `Inspect Metadata & Experimental Factors for ${study.study_id}`,
    detail: `Ask the RAG assistant to summarize organism, tissue scope, assay platform, and sample constraints grounded strictly in ${study.study_id}.`,
    prompt: `Summarize the verified metadata, organism, tissues, assays, and experimental design for ${study.study_id}, and note whether it relates to retinal or SANS spaceflight mechanisms.`,
  });

  const lower = `${study.title} ${study.assay_measurement} ${study.material_type}`.toLowerCase();

  if (subgroup === "SANS / Ocular" || lower.includes("translaminar") || lower.includes("iop")) {
    concepts.push({
      kind: "roadmap",
      title: "[ROADMAP] Register SANS & Translaminar Pressure Manifest",
      detail: `Add ${study.study_id} (${study.material_type}) to canonical SANS manifests & IOP/OCT schema contracts alongside OSD-583 and OSD-679.`,
      extensionTarget: "server/studyManifests.ts + server/awg.ts",
    });
  } else if (lower.includes("spatial") || lower.includes("geomx") || lower.includes("single-cell") || lower.includes("snrna")) {
    concepts.push({
      kind: "roadmap",
      title: "[ROADMAP] Extend Spatial / Single-Cell Harmonizer",
      detail: `Adapt the GeoMx ROI coordinate & batch stratification checks used on OSD-685/OSD-698 to cover ${study.study_id}'s assay layout.`,
      extensionTarget: "server/awg.ts (IngestionSchemaContract)",
    });
  } else if (sourceSystem === "alsda") {
    concepts.push({
      kind: "roadmap",
      title: "[ROADMAP] Add ALSDA Physiological Telemetry Adapter",
      detail: `Map ALSDA behavioral/physiological assay columns from ${study.study_id} into typed ingestion contracts beyond bulk RNA-seq.`,
      extensionTarget: "server/osdrClient.ts + server/awg.ts",
    });
  } else {
    concepts.push({
      kind: "roadmap",
      title: `[ROADMAP] Curate ${subgroup} Cross-Study Prior Hook`,
      detail: `Register ${study.study_id} ortholog / pathway tags in the animal-disjoint CV schema contract builder for multi-mission validation.`,
      extensionTarget: "server/awg.ts + server/studyManifests.ts",
    });
  }

  return concepts;
}

export function buildLeadSignalConcepts(
  lead: AwgLeadProfile,
  signal: {
    title: string;
    status: "pre_osdr_signal" | "live_on_osdr";
    linkedOsdIds: string[];
    externalAccessions: string[];
    doi?: string;
    isPreprint: boolean;
  }
): RadarConceptAction[] {
  const concepts: RadarConceptAction[] = [];

  if (signal.linkedOsdIds.length > 0) {
    const primaryOsd = signal.linkedOsdIds[0];
    const anchor = primaryOsd === "OSD-255" ? "OSD-583" : "OSD-255";
    concepts.push({
      kind: "use_now",
      title: `Compare Linked Dataset ${primaryOsd} vs ${anchor}`,
      detail: `This publication references ${primaryOsd}. Launch a grounded AWG comparison and Schema Contract export immediately.`,
      command: `/awg compare ${primaryOsd} ${anchor}`,
    });
  }

  const shortTitle = signal.title.length > 90 ? `${signal.title.slice(0, 87)}...` : signal.title;
  concepts.push({
    kind: "use_now",
    title: "Bridge Pre-OSDR Topic to Indexed Studies",
    detail: `Query OSDR_Chatbot for existing datasets sharing mechanisms or assays with ${lead.name}'s release.`,
    prompt: `Which indexed NASA OSDR studies share biological pathways, tissues, or analytical methods with "${shortTitle}" (${lead.subgroup})?`,
  });

  if (signal.externalAccessions.length > 0) {
    concepts.push({
      kind: "roadmap",
      title: `[ROADMAP] Pre-OSDR Accession Bridge (${signal.externalAccessions.slice(0, 2).join(", ")})`,
      detail: `Preview raw external repository metadata (${signal.externalAccessions.join(", ")}) inside AWG validation cards before formal NASA OSD-* curation completes.`,
      extensionTarget: "server/osdrClient.ts + server/accessionValidator.ts",
    });
  } else if (lead.subgroup === "AI/ML" || /machine learning|foundation|tabpfn|knowledge graph|imput/i.test(signal.title)) {
    concepts.push({
      kind: "roadmap",
      title: "[ROADMAP] AI/ML AWG Benchmark & Schema Contract Hook",
      detail: `Align ChatBot's Copy Schema Contract JSON (animal-disjoint folds & inner-fold scaling) with ${lead.name}'s latest AI/ML methodology.`,
      extensionTarget: "server/awg.ts (recommendedCvStrategy)",
    });
  } else {
    concepts.push({
      kind: "roadmap",
      title: `[ROADMAP] ${lead.subgroup} Pre-OSDR Watch Alert Hook`,
      detail: `Auto-watch ${lead.name}'s ORCID / bioRxiv DOI${signal.doi ? ` (${signal.doi})` : ""} for new OSD-* deposition links in future weekly syncs.`,
      extensionTarget: ".github/workflows/radar-sync.yml + scripts/syncRadarSnapshot.ts",
    });
  }

  return concepts;
}

// =========================================================================
// Runtime Store, Filtering & Live Refresh (Graceful Offline Fallback)
// =========================================================================

let currentSnapshot: RadarSnapshot = normalizeSnapshotDates(bundledSnapshotRaw as RadarSnapshot);
registerSnapshotStudiesIntoIndex(currentSnapshot);

let lastLiveRefreshAttemptMs = 0;
const REFRESH_COOLDOWN_MS = 60_000;

export function registerSnapshotStudiesIntoIndex(snap: RadarSnapshot) {
  const records = (snap.osdrReleases || [])
    .map((r) => r.studyRecord)
    .filter((s): s is OSDRStudy => Boolean(s && s.study_id));
  if (records.length > 0) {
    upsertOsdrStudies(records);
  }
}

export function normalizeSnapshotDates(snap: RadarSnapshot): RadarSnapshot {
  const refMs = parseFlexibleDateMs(snap.generatedAt) || Date.now();
  return {
    ...snap,
    currentQuarterLabel: snap.currentQuarterLabel || getQuarterInfo(refMs).label,
    previousQuarterLabel: snap.previousQuarterLabel || getPreviousQuarterLabel(refMs),
  };
}

export function getRadarSnapshot(): RadarSnapshot {
  return currentSnapshot;
}

export function setRadarSnapshot(next: RadarSnapshot): RadarSnapshot {
  currentSnapshot = normalizeSnapshotDates(next);
  registerSnapshotStudiesIntoIndex(currentSnapshot);
  return currentSnapshot;
}

export function upsertLeadSignalsIntoSnapshot(
  inputs: Array<{
    leadId?: string;
    title: string;
    journal?: string;
    publishedDate?: string;
    url: string;
    doi?: string;
    pmid?: string;
    pmcid?: string;
    isPreprint?: boolean;
    summarySnippet?: string;
    sourcePlatform?: RadarLeadSignal["sourcePlatform"];
    scopeMatchedBy?: string[];
  }>,
  options: { referenceDateIso?: string; skipScopeFilter?: boolean } = {}
): {
  snapshot: RadarSnapshot;
  addedSignals: RadarLeadSignal[];
  rejectedOutOfScope: number;
} {
  const refMs = Date.parse(options.referenceDateIso || new Date().toISOString()) || Date.now();
  const existingSignals = [...(currentSnapshot.leadSignals || [])];
  const addedSignals: RadarLeadSignal[] = [];
  let rejectedOutOfScope = 0;

  const existingKeys = new Set<string>();
  for (const sig of existingSignals) {
    if (sig.doi) existingKeys.add(`doi:${sig.doi.toLowerCase().trim()}`);
    if (sig.id) existingKeys.add(`id:${sig.id.toLowerCase()}`);
    existingKeys.add(`t:${sig.leadId}:${normalizeTitleKey(sig.title)}`);
  }

  for (const item of inputs) {
    const cleanTitle = String(item.title || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const cleanUrl = String(item.url || "").trim();
    if (!cleanTitle || !cleanUrl) continue;

    const lead =
      AWG_LEAD_WATCHLIST.find((l) => l.id === item.leadId) ||
      AWG_LEAD_WATCHLIST.find((l) => l.spotlight) ||
      AWG_LEAD_WATCHLIST[0];

    const rawText = `${cleanTitle} ${item.journal || ""} ${item.summarySnippet || ""}`;
    const { osdIds, externalIds } = extractAccessionsFromText(rawText);
    const scopeEval = evaluateSpaceBiologyScope({
      title: cleanTitle,
      journal: item.journal,
      summary: item.summarySnippet || cleanTitle,
      accessions: [...osdIds, ...externalIds],
    });

    if (!scopeEval.inScope && !options.skipScopeFilter) {
      rejectedOutOfScope++;
      continue;
    }

    const doiClean = item.doi
      ? String(item.doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim()
      : undefined;
    const doiKey = doiClean ? `doi:${doiClean.toLowerCase()}` : "";
    const titleKey = `t:${lead.id}:${normalizeTitleKey(cleanTitle)}`;
    const idSlug = `${lead.id}-${(doiClean || normalizeTitleKey(cleanTitle)).replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 48)}`;

    if ((doiKey && existingKeys.has(doiKey)) || existingKeys.has(titleKey) || existingKeys.has(`id:${idSlug.toLowerCase()}`)) {
      continue;
    }

    const publishedDate = String(item.publishedDate || new Date(refMs).toISOString().slice(0, 10)).trim();
    const winInfo = classifyTimeWindow(publishedDate, refMs);
    const status: "pre_osdr_signal" | "live_on_osdr" =
      osdIds.length > 0 ? "live_on_osdr" : "pre_osdr_signal";

    const newSig: RadarLeadSignal = {
      id: idSlug,
      leadId: lead.id,
      leadName: lead.name,
      leadRole: lead.role,
      leadSubgroup: lead.subgroup,
      leadOrcid: lead.orcid,
      spotlight: Boolean(lead.spotlight),
      status,
      sourcePlatform: item.sourcePlatform || "Webhook Push",
      title: cleanTitle,
      journal: String(item.journal || (item.isPreprint ? "Preprint Server" : "Webhook Feed")).trim(),
      publishedDate,
      quarterLabel: winInfo.quarterLabel,
      windowBucket: winInfo.windowBucket,
      isRecentMonth: winInfo.isRecentMonth,
      isPreprint: Boolean(item.isPreprint || /biorxiv|medrxiv|arxiv|preprint/i.test(item.journal || "")),
      ...(doiClean ? { doi: doiClean } : {}),
      ...(item.pmid ? { pmid: String(item.pmid).trim() } : {}),
      ...(item.pmcid ? { pmcid: String(item.pmcid).trim() } : {}),
      url: cleanUrl,
      externalAccessions: externalIds,
      linkedOsdIds: osdIds,
      scopeMatchedBy:
        item.scopeMatchedBy && item.scopeMatchedBy.length > 0
          ? item.scopeMatchedBy
          : scopeEval.matchedTerms.length > 0
          ? scopeEval.matchedTerms
          : ["Webhook Curated Drop"],
      ...(item.summarySnippet ? { summarySnippet: String(item.summarySnippet).slice(0, 320) } : {}),
      concepts: buildLeadSignalConcepts(lead, {
        title: cleanTitle,
        status,
        linkedOsdIds: osdIds,
        externalAccessions: externalIds,
        doi: doiClean,
        isPreprint: Boolean(item.isPreprint),
      }),
    };

    existingKeys.add(titleKey);
    if (doiKey) existingKeys.add(doiKey);
    existingKeys.add(`id:${idSlug.toLowerCase()}`);
    existingSignals.push(newSig);
    addedSignals.push(newSig);
  }

  if (addedSignals.length > 0) {
    existingSignals.sort((a, b) => {
      const da = a.publishedDate || "0000";
      const db = b.publishedDate || "0000";
      if (db !== da) return db.localeCompare(da);
      if (a.spotlight !== b.spotlight) return a.spotlight ? -1 : 1;
      return a.title.localeCompare(b.title);
    });

    const updatedLeads = (currentSnapshot.leads || []).map((l) => {
      const matches = existingSignals.filter((s) => s.leadId === l.id);
      return {
        ...l,
        inScopeCount: matches.length,
        preOsdrCount: matches.filter((s) => s.status === "pre_osdr_signal").length,
        liveOsdrCount: matches.filter((s) => s.status === "live_on_osdr").length,
      };
    });

    currentSnapshot = normalizeSnapshotDates({
      ...currentSnapshot,
      generatedAt: new Date(refMs).toISOString(),
      leads: updatedLeads,
      leadSignals: existingSignals,
      scopeAudit: {
        ...currentSnapshot.scopeAudit,
        inScopeCount: existingSignals.length,
      },
    });
  }

  return {
    snapshot: currentSnapshot,
    addedSignals,
    rejectedOutOfScope,
  };
}

export function queryRadarSnapshot(params: {
  tab?: string;
  window?: string;
  subgroup?: string;
  lead?: string;
  search?: string;
}): RadarSnapshot & {
  filteredReleases: RadarOsdrRelease[];
  filteredLeadSignals: RadarLeadSignal[];
} {
  const snap = currentSnapshot;
  const win = (params.window || "all").toLowerCase();
  const sub = (params.subgroup || "all").toLowerCase();
  const leadFilter = (params.lead || "all").toLowerCase();
  const q = (params.search || "").trim().toLowerCase();

  const matchesWindow = (w: RadarWindowId, isRecentMonth: boolean) => {
    if (win === "all") return true;
    if (win === "month") return isRecentMonth || w === "month";
    if (win === "current_quarter" || win === "quarter") {
      return w === "month" || w === "current_quarter";
    }
    if (win === "prev_quarter") return w === "prev_quarter";
    if (win === "recent_quarters" || win === "q3_q4") {
      return w === "month" || w === "current_quarter" || w === "prev_quarter";
    }
    return true;
  };

  const filteredReleases = (snap.osdrReleases || []).filter((item) => {
    if (!matchesWindow(item.windowBucket, item.isRecentMonth)) return false;
    if (sub !== "all") {
      if (sub === "sans") {
        if (!item.sansRelevant && item.subgroup !== "SANS / Ocular") return false;
      } else if (item.subgroup.toLowerCase() !== sub && item.sourceSystem.toLowerCase() !== sub) {
        return false;
      }
    }
    if (q) {
      const hay = `${item.studyId} ${item.title} ${item.organism} ${item.materialType} ${item.assayMeasurement} ${item.subgroup}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const filteredLeadSignals = (snap.leadSignals || []).filter((sig) => {
    if (!matchesWindow(sig.windowBucket, sig.isRecentMonth)) {
      // For leads, allow quarter filter to keep current + prev quarter or matching window
      return false;
    }
    if (leadFilter !== "all") {
      if (
        sig.leadId.toLowerCase() !== leadFilter &&
        sig.leadSubgroup.toLowerCase() !== leadFilter
      ) {
        return false;
      }
    }
    if (sub !== "all") {
      if (sub === "pre_osdr" && sig.status !== "pre_osdr_signal") return false;
      if (sub === "live_osdr" && sig.status !== "live_on_osdr") return false;
    }
    if (q) {
      const hay = `${sig.title} ${sig.leadName} ${sig.leadSubgroup} ${sig.journal} ${sig.doi || ""} ${sig.linkedOsdIds.join(" ")} ${sig.externalAccessions.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return {
    ...snap,
    filteredReleases,
    filteredLeadSignals,
  };
}

export function formatRadarDigestMarkdown(snap: RadarSnapshot = currentSnapshot): string {
  const monthReleases = snap.osdrReleases.filter((r) => r.isRecentMonth || r.windowBucket === "month");
  const quarterReleases = snap.osdrReleases.filter(
    (r) => r.windowBucket === "month" || r.windowBucket === "current_quarter"
  );
  const sansHighlights = snap.osdrReleases.filter((r) => r.sansRelevant);
  const preOsdrSignals = snap.leadSignals.filter((s) => s.status === "pre_osdr_signal").slice(0, 8);

  const lines: string[] = [
    `### NASA OSDR & AWG Release Radar Digest (${snap.currentQuarterLabel})`,
    `Generated: ${snap.generatedAt.slice(0, 10)} | Scope: Verified NASA OSDR (\`cgene\` + \`alsda\`) & ${snap.leads.length} GeneLab AWG Subgroup Chairs + Ryan T. Scott`,
    "",
    `#### 1. Highlights — ${snap.currentMonthLabel} (${monthReleases.length}) & ${snap.currentQuarterLabel} (${quarterReleases.length})`,
  ];

  for (const r of (monthReleases.length > 0 ? monthReleases : quarterReleases).slice(0, 8)) {
    const anchorNote = r.bestAnchor ? ` · Best anchor: \`${r.bestAnchor.studyId}\` (${r.bestAnchor.totalScore}/100)` : "";
    lines.push(
      `- **${r.studyId}** (\`${r.releaseDate || r.quarterLabel}\` · ${r.subgroup}): ${r.title} [${r.organism}]${anchorNote} — [OSDR](${r.osdrUrl})`
    );
  }

  if (sansHighlights.length > 0) {
    lines.push("", `#### 2. Recent SANS / Ocular & Neuro-Visual Signals (${sansHighlights.length})`);
    for (const r of sansHighlights.slice(0, 5)) {
      lines.push(`- **${r.studyId}** (\`${r.releaseDate || r.quarterLabel}\`): ${r.title} — [OSDR](${r.osdrUrl})`);
    }
  }

  if (preOsdrSignals.length > 0) {
    lines.push("", `#### 3. AWG Leads — Early Pre-OSDR Signals (${preOsdrSignals.length})`);
    for (const s of preOsdrSignals) {
      const linkLabel = s.doi ? `DOI: ${s.doi}` : s.sourcePlatform;
      const ext = s.externalAccessions.length > 0 ? ` · Accessions: ${s.externalAccessions.join(", ")}` : "";
      lines.push(
        `- **${s.leadName}** (${s.leadSubgroup} · \`${s.publishedDate}\` · ${s.isPreprint ? "Preprint" : "Paper"}): ${s.title} (${linkLabel}${ext}) — [Source](${s.url})`
      );
    }
  }

  lines.push(
    "",
    `> Scope audit: ${snap.scopeAudit.inScopeCount} space-biology works retained; ${snap.scopeAudit.filteredOutNonSpaceCount} off-topic clinical/terrestrial works filtered out.`
  );

  return lines.join("\n");
}

// =========================================================================
// Live Collector Shared by syncRadarSnapshot.ts AND On-Demand Refresh
// =========================================================================

async function fetchJsonSafe(url: string, headers: Record<string, string> = {}, timeoutMs: number = 8500): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "OSDR-ChatBot-Radar/1.0 (mailto:osdr-chatbot@users.noreply.github.com; +https://github.com/gastondana627/OSDR_Chatbot)",
        ...headers,
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function reconstructOpenAlexAbstract(inv: Record<string, number[]> | null | undefined): string {
  if (!inv || typeof inv !== "object") return "";
  const entries: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(inv)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (typeof pos === "number") entries.push([pos, word]);
    }
  }
  if (entries.length === 0) return "";
  entries.sort((a, b) => a[0] - b[0]);
  return entries.map((e) => e[1]).join(" ").replace(/\s+/g, " ").trim();
}

function isErratumOrParatextTitle(title: string, oaType?: string): boolean {
  const t = (oaType || "").toLowerCase();
  if (t === "erratum" || t === "paratext") return true;
  return /^(?:author correction|corrigendum|correction:|erratum|retraction|front cover|inside front cover|back cover|featured cover|list of contributors|reply to:|editorial board)/i.test(
    title.trim()
  );
}

function normalizeOrcidWorkDate(pubDate: any): string {
  const y = pubDate?.year?.value;
  if (!y) return "";
  const m = pubDate?.month?.value ? String(pubDate.month.value).padStart(2, "0") : "";
  const d = pubDate?.day?.value ? String(pubDate.day.value).padStart(2, "0") : "";
  if (m && d) return `${y}-${m}-${d}`;
  if (m) return `${y}-${m}`;
  return String(y);
}

function extractAccessionsFromText(text: string): { osdIds: string[]; externalIds: string[] } {
  const osdSet = new Set<string>();
  const extSet = new Set<string>();

  const osdMatches = text.match(/\b(?:OSD|GLDS)-(\d+)\b/gi) || [];
  for (const m of osdMatches) {
    const num = m.replace(/[^0-9]/g, "");
    if (num) osdSet.add(`OSD-${num}`);
  }

  const extMatches = text.match(/\b(?:GSE\d{4,}|PRJNA\d{4,}|PXD\d{5,}|SRR\d{5,})\b/g) || [];
  for (const m of extMatches) extSet.add(m);

  return {
    osdIds: Array.from(osdSet),
    externalIds: Array.from(extSet),
  };
}

function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 96);
}

function strictAuthorMatchesLead(authorText: string, leadName: string): boolean {
  const clean = authorText.toLowerCase();
  const parts = leadName.toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return false;
  const first = parts[0];
  const last = parts[parts.length - 1];
  const fi = first[0];
  if (!clean.includes(last)) return false;
  // Require either first name presence OR PubMed-style "Last FI" / "Last F"
  const pubmedInitial = new RegExp(`\\b${last}\\s+${fi}[a-z]?\\b`, "i");
  return clean.includes(first) || pubmedInitial.test(authorText);
}

export async function collectLiveRadarSnapshot(options: {
  referenceDateIso?: string;
} = {}): Promise<RadarSnapshot> {
  const referenceDateIso = options.referenceDateIso || new Date().toISOString();
  const refMs = Date.parse(referenceDateIso) || Date.now();
  const currentQuarterLabel = getQuarterInfo(refMs).label;
  const previousQuarterLabel = getPreviousQuarterLabel(refMs);

  let osdrLiveOk = false;
  let orcidLiveCount = 0;
  let openalexLiveCount = 0;
  let epmcLiveCount = 0;
  let ntrsLiveCount = 0;
  let crossrefLiveCount = 0;
  let pubmedLiveCount = 0;
  const errors: string[] = [];

  // 1. Fetch Recent OSDR Datasets (cgene + alsda sorted DESC + SANS/ocular recent query)
  const rawStudyMap = new Map<string, { study: OSDRStudy; sourceSystem: "cgene" | "alsda" }>();
  const osdrDoiToId = new Map<string, string>();
  const osdrTitleToIds = new Map<string, Set<string>>();
  const leadDirectOsdrStudies = new Map<string, Map<string, { study: OSDRStudy; sourceSystem: "cgene" | "alsda" }>>();

  const indexOsdrTitle = (title: string | undefined, studyId: string) => {
    if (!title) return;
    const key = normalizeTitleKey(title);
    if (key.length < 24) return;
    if (!osdrTitleToIds.has(key)) osdrTitleToIds.set(key, new Set());
    osdrTitleToIds.get(key)!.add(studyId);
  };

  // Seed DOI & publication title maps from built-in curated studies & manifests
  for (const s of INITIAL_STUDIES) {
    if (s.doi) osdrDoiToId.set(s.doi.toLowerCase(), s.study_id);
    indexOsdrTitle(s.title, s.study_id);
    indexOsdrTitle(s.publication_title, s.study_id);
  }
  for (const m of Object.values(CANONICAL_STUDY_MANIFESTS)) {
    indexOsdrTitle(m.canonicalTitle, m.accession);
    for (const p of m.linkedPublications || []) {
      if (p.doi) osdrDoiToId.set(p.doi.toLowerCase(), m.accession);
      indexOsdrTitle(p.title, m.accession);
    }
  }

  const recordOsdrHit = (src: Record<string, any>, fallbackSys: "cgene" | "alsda") => {
    const dsType = asCleanText(src["Data Source Type"]).toLowerCase();
    const sys: "cgene" | "alsda" = dsType === "alsda" ? "alsda" : fallbackSys;
    const study = osdrSourceToStudy(src, { sourceType: "cached_snapshot" });
    if (!study) return null;
    if (!rawStudyMap.has(study.study_id)) {
      rawStudyMap.set(study.study_id, { study, sourceSystem: sys });
    }
    if (study.doi) {
      osdrDoiToId.set(study.doi.toLowerCase(), study.study_id);
    }
    indexOsdrTitle(study.title, study.study_id);
    indexOsdrTitle(study.publication_title, study.study_id);

    const authStr = `${study.publication_authors || ""} ${asCleanText(src["Study Person"])}`;
    for (const lead of AWG_LEAD_WATCHLIST) {
      if (strictAuthorMatchesLead(authStr, lead.name)) {
        if (!leadDirectOsdrStudies.has(lead.id)) leadDirectOsdrStudies.set(lead.id, new Map());
        leadDirectOsdrStudies.get(lead.id)!.set(study.study_id, { study, sourceSystem: sys });
      }
    }
    return { study, sys };
  };

  const osdrQueries: Array<{ url: string; fallbackSys: "cgene" | "alsda" }> = [
    {
      url: `${OSDR_ENDPOINTS.search}?ffield=Data%20Source%20Type&fvalue=cgene&sort=Study%20Public%20Release%20Date&order=DESC&size=24&from=0`,
      fallbackSys: "cgene",
    },
    {
      url: `${OSDR_ENDPOINTS.search}?ffield=Data%20Source%20Type&fvalue=alsda&sort=Study%20Public%20Release%20Date&order=DESC&size=24&from=0`,
      fallbackSys: "alsda",
    },
    {
      url: `${OSDR_ENDPOINTS.search}?term=retina%20OR%20ocular%20OR%20translaminar%20OR%20SANS&sort=Study%20Public%20Release%20Date&order=DESC&size=15&from=0`,
      fallbackSys: "cgene",
    },
  ];

  for (const q of osdrQueries) {
    try {
      const json = await fetchJsonSafe(q.url);
      const hits = json?.hits?.hits || [];
      if (hits.length > 0) osdrLiveOk = true;
      for (const h of hits) {
        recordOsdrHit(h._source || {}, q.fallbackSys);
      }
    } catch (err: any) {
      errors.push(`OSDR query failed: ${err?.message || err}`);
    }
  }

  // Also check curated/initial studies for strict AWG lead authorship (e.g. Overbey on OSD-255 / OSD-557 / OSD-570)
  for (const s of INITIAL_STUDIES) {
    for (const lead of AWG_LEAD_WATCHLIST) {
      if (strictAuthorMatchesLead(s.publication_authors || "", lead.name)) {
        if (!leadDirectOsdrStudies.has(lead.id)) leadDirectOsdrStudies.set(lead.id, new Map());
        leadDirectOsdrStudies.get(lead.id)!.set(s.study_id, { study: s, sourceSystem: "cgene" });
      }
    }
  }

  // Query OSDR per AWG lead (only linking strict full-name / First-Last matches)
  for (const lead of AWG_LEAD_WATCHLIST) {
    try {
      const url = `${OSDR_ENDPOINTS.search}?term=${encodeURIComponent(`"${lead.name}"`)}&sort=Study%20Public%20Release%20Date&order=DESC&size=10&from=0`;
      const json = await fetchJsonSafe(url, {}, 6500);
      const hits = json?.hits?.hits || [];
      for (const h of hits) {
        recordOsdrHit(h._source || {}, "cgene");
      }
    } catch {
      // Non-fatal fallback if quoted search returns nothing or times out
    }
  }

  // Register newly discovered studies in index before scoring against anchors
  upsertOsdrStudies(Array.from(rawStudyMap.values()).map((v) => v.study));

  const osdrReleases: RadarOsdrRelease[] = [];
  for (const { study, sourceSystem } of rawStudyMap.values()) {
    const winInfo = classifyTimeWindow(study.release_date, refMs);
    const { subgroup, sansRelevant } = classifyOsdrSubgroup(study, sourceSystem);
    const bestAnchor = scoreAgainstAnchors(study, sansRelevant);
    const releaseMs = parseFlexibleDateMs(study.release_date) || 0;
    // Keep recent 2024–2026 releases (focus radar on quarterly/monthly currency rather than 2019 archive entries)
    if (releaseMs === 0 && !sansRelevant) continue;
    if (!study.release_date || study.release_date < "2024-01-01") continue;

    osdrReleases.push({
      studyId: study.study_id,
      title: study.title,
      organism: study.organism,
      materialType: study.material_type,
      assayMeasurement: study.assay_measurement,
      assayPlatform: study.assay_platform,
      studyFactor: study.study_factor,
      mission: study.mission || study.flight_program,
      sourceSystem,
      releaseDate: study.release_date,
      quarterLabel: winInfo.quarterLabel,
      windowBucket: winInfo.windowBucket,
      isRecentMonth: winInfo.isRecentMonth,
      subgroup,
      sansRelevant,
      doi: study.doi,
      osdrUrl: `https://osdr.nasa.gov/bio/repo/data/studies/${study.study_id}`,
      scopeVerified: true,
      scopeMatchedBy: [
        `NASA OSDR (${sourceSystem})`,
        ...(sansRelevant ? ["SANS / Ocular"] : []),
      ],
      bestAnchor,
      concepts: buildOsdrReleaseConcepts(study, sourceSystem, subgroup, bestAnchor),
      studyRecord: study,
    });
  }

  osdrReleases.sort((a, b) => {
    const da = a.releaseDate || "0000-00-00";
    const db = b.releaseDate || "0000-00-00";
    if (db !== da) return db.localeCompare(da);
    return b.studyId.localeCompare(a.studyId);
  });

  // Cap radar list cleanly at 36 most recent verified studies
  const cappedReleases = osdrReleases.slice(0, 36);

  // 2. Fetch AWG Lead Pre-OSDR & Publication Signals via ORCID + OpenAlex ORCID + Europe PMC + OSDR
  const SPACE_QUERY =
    '(spaceflight OR "space flight" OR microgravity OR OSDR OR GeneLab OR ALSDA OR "space biology" OR "Space Omics" OR SANS)';

  const leadSummaries: RadarLeadSummary[] = [];
  const allLeadSignals: RadarLeadSignal[] = [];
  let totalWorksScanned = 0;
  let totalFilteredOut = 0;

  for (const lead of AWG_LEAD_WATCHLIST) {
    let leadScanned = 0;
    let leadFilteredOut = 0;

    interface DraftSignal {
      title: string;
      journal: string;
      publishedDate: string;
      doi?: string;
      pmid?: string;
      pmcid?: string;
      url: string;
      isPreprint: boolean;
      summarySnippet?: string;
      fromOrcid: boolean;
      fromOpenAlex: boolean;
      fromEpmc: boolean;
      fromNtrs?: boolean;
      fromCrossref?: boolean;
      fromPubmed?: boolean;
      epmcSourceTag?: string;
      rawTextForScope: string;
    }

    const byKey = new Map<string, DraftSignal>();

    const upsertDraft = (d: DraftSignal) => {
      const doiKey = d.doi ? `doi:${d.doi.toLowerCase().trim()}` : "";
      const titleKey = `t:${normalizeTitleKey(d.title)}`;
      const existing = (doiKey && byKey.get(doiKey)) || byKey.get(titleKey);

      if (existing) {
        existing.fromOrcid = existing.fromOrcid || d.fromOrcid;
        existing.fromOpenAlex = existing.fromOpenAlex || d.fromOpenAlex;
        existing.fromEpmc = existing.fromEpmc || d.fromEpmc;
        existing.fromNtrs = Boolean(existing.fromNtrs || d.fromNtrs);
        existing.fromCrossref = Boolean(existing.fromCrossref || d.fromCrossref);
        existing.fromPubmed = Boolean(existing.fromPubmed || d.fromPubmed);
        // Prefer fuller YYYY-MM-DD date from scholarly databases rather than later NTRS reprint stamps
        if (!d.fromNtrs && (d.publishedDate || "").length > (existing.publishedDate || "").length) {
          existing.publishedDate = d.publishedDate;
        }
        if (
          d.journal &&
          (!existing.journal ||
            existing.journal === "ORCID Record" ||
            existing.journal === "Preprint")
        ) {
          existing.journal = d.journal;
        }
        existing.doi = existing.doi || d.doi;
        existing.pmid = existing.pmid || d.pmid;
        existing.pmcid = existing.pmcid || d.pmcid;
        existing.isPreprint = existing.isPreprint || d.isPreprint;
        if (d.summarySnippet && (!existing.summarySnippet || d.summarySnippet.length > existing.summarySnippet.length)) {
          existing.summarySnippet = d.summarySnippet;
        }
        existing.rawTextForScope = `${existing.rawTextForScope} ${d.rawTextForScope}`;
        if (d.doi && d.url.includes("doi.org")) existing.url = d.url;
        if (doiKey) byKey.set(doiKey, existing);
        byKey.set(titleKey, existing);
      } else {
        if (doiKey) byKey.set(doiKey, d);
        byKey.set(titleKey, d);
      }
    };

    // 2a. ORCID Public Works
    try {
      const orcidData = await fetchJsonSafe(`https://pub.orcid.org/v3.0/${lead.orcid}/works`, {
        Accept: "application/json",
      });
      const groups = orcidData?.group || [];
      orcidLiveCount++;

      const sortedGroups = [...groups].sort((ga, gb) => {
        const wa = ga?.["work-summary"]?.[0];
        const wb = gb?.["work-summary"]?.[0];
        const da = normalizeOrcidWorkDate(wa?.["publication-date"]);
        const db = normalizeOrcidWorkDate(wb?.["publication-date"]);
        return db.localeCompare(da);
      });

      for (const g of sortedGroups.slice(0, 30)) {
        const ws = g?.["work-summary"]?.[0];
        if (!ws) continue;
        const title = String(ws?.title?.title?.value || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        if (!title || isErratumOrParatextTitle(title)) continue;

        const pubDate = normalizeOrcidWorkDate(ws["publication-date"]);
        const yr = Number(pubDate.slice(0, 4) || "0");
        if (yr > 0 && yr < 2023) continue;

        leadScanned++;

        const extIds = ws?.["external-ids"]?.["external-id"] || [];
        let doi: string | undefined;
        let pmid: string | undefined;
        let pmcid: string | undefined;
        for (const eid of extIds) {
          const t = String(eid?.["external-id-type"] || "").toLowerCase();
          const v = String(eid?.["external-id-value"] || "").trim();
          if (t === "doi" && !doi) doi = v.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
          if (t === "pmid" && !pmid) pmid = v;
          if (t === "pmc" && !pmcid) pmcid = v;
        }

        const journal = String(ws?.["journal-title"]?.value || "").trim() || (ws?.type === "preprint" ? "Preprint" : "ORCID Record");
        const isPreprint =
          String(ws?.type || "").toLowerCase() === "preprint" ||
          /biorxiv|medrxiv|research square|preprints\.org|arxiv|ssrn/i.test(journal);
        const url = doi
          ? `https://doi.org/${doi}`
          : String(ws?.url?.value || `https://orcid.org/${lead.orcid}`);

        upsertDraft({
          title,
          journal,
          publishedDate: pubDate,
          doi,
          pmid,
          pmcid,
          url,
          isPreprint,
          fromOrcid: true,
          fromOpenAlex: false,
          fromEpmc: false,
          rawTextForScope: `${title} ${journal}`,
        });
      }
    } catch (err: any) {
      errors.push(`ORCID ${lead.name} failed: ${err?.message || err}`);
    }

    // 2b. OpenAlex Verified ORCID Query (enriches 2025-2026 preprints, dates, venues & abstracts)
    try {
      await new Promise((r) => setTimeout(r, 120));
      const oaUrl = `https://api.openalex.org/works?filter=author.orcid:${lead.orcid},from_publication_date:2024-01-01&sort=publication_date:desc&per-page=20&select=id,doi,title,publication_date,type,primary_location,abstract_inverted_index&mailto=osdr-chatbot@users.noreply.github.com`;
      const oaData = await fetchJsonSafe(oaUrl, {}, 8000);
      const oaResults = oaData?.results || [];
      if (oaResults.length > 0) openalexLiveCount++;

      for (const w of oaResults) {
        const title = String(w?.title || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        if (!title || isErratumOrParatextTitle(title, w?.type)) continue;
        const pubDate = String(w?.publication_date || "").trim();
        leadScanned++;

        const doi = w?.doi ? String(w.doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim() : undefined;
        const srcObj = w?.primary_location?.source;
        const venue = String(srcObj?.display_name || "").trim();
        const isPreprint =
          String(w?.type || "").toLowerCase() === "preprint" ||
          /biorxiv|medrxiv|arxiv|research square|preprints\.org|ssrn/i.test(venue);
        const journal = venue || (isPreprint ? "Preprint Server" : "OpenAlex");
        const abs = reconstructOpenAlexAbstract(w?.abstract_inverted_index).replace(/^Abstract\s+/i, "");
        const landingUrl = doi
          ? `https://doi.org/${doi}`
          : String(w?.primary_location?.landing_page_url || w?.id || `https://orcid.org/${lead.orcid}`);

        upsertDraft({
          title,
          journal,
          publishedDate: pubDate,
          doi,
          url: landingUrl,
          isPreprint,
          summarySnippet: abs ? abs.slice(0, 290).trim() + (abs.length > 290 ? "…" : "") : undefined,
          fromOrcid: false,
          fromOpenAlex: true,
          fromEpmc: false,
          rawTextForScope: `${title} ${journal} ${abs}`,
        });
      }
    } catch (err: any) {
      errors.push(`OpenAlex ${lead.name} failed: ${err?.message || err}`);
    }

    // 2c. Europe PMC Scoped Query (sorted newest-first to catch same-day bioRxiv/PubMed drops)
    try {
      const authExpr = lead.europePmcAuth.join(" OR ");
      const query = `(${authExpr}) AND ${SPACE_QUERY}`;
      const epmcUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&sort=FIRST_PDATE%20desc&resultType=lite&pageSize=12&format=json`;
      const epmcData = await fetchJsonSafe(epmcUrl, {}, 5500);
      const hits = epmcData?.resultList?.result || [];
      epmcLiveCount++;

      for (const h of hits) {
        const title = String(h?.title || "").replace(/<[^>]+>/g, "").replace(/\.$/, "").trim();
        if (!title || isErratumOrParatextTitle(title)) continue;
        const pubDate = String(h?.firstPublicationDate || h?.pubYear || "").trim();
        const yr = Number(pubDate.slice(0, 4) || "0");
        if (yr > 0 && yr < 2023) continue;

        leadScanned++;
        const sourceTag = String(h?.source || "").toUpperCase();
        const isPreprint = sourceTag === "PPR" || /biorxiv|medrxiv/i.test(String(h?.bookOrReportDetails?.publisher || h?.journalTitle || ""));
        const doi = h?.doi ? String(h.doi).trim() : undefined;
        const pmid = h?.pmid ? String(h.pmid).trim() : undefined;
        const pmcid = h?.pmcid ? String(h.pmcid).trim() : undefined;
        const journal =
          String(h?.journalInfo?.journal?.title || h?.journalTitle || h?.bookOrReportDetails?.publisher || (isPreprint ? "bioRxiv / medRxiv Preprint" : "Europe PMC")).trim();
        const url = doi
          ? `https://doi.org/${doi}`
          : pmcid
          ? `https://europepmc.org/article/PMC/${pmcid}`
          : pmid
          ? `https://europepmc.org/article/MED/${pmid}`
          : `https://europepmc.org/article/${sourceTag}/${h?.id}`;

        upsertDraft({
          title,
          journal,
          publishedDate: pubDate,
          doi,
          pmid,
          pmcid,
          url,
          isPreprint,
          fromOrcid: false,
          fromOpenAlex: false,
          fromEpmc: true,
          epmcSourceTag: sourceTag,
          rawTextForScope: `${title} ${journal}`,
        });
      }
    } catch {
      // Non-fatal: Europe PMC can be slow/rate-limited; ORCID + OpenAlex already cover works
    }

    // 2c-2. Crossref ORCID Query (catches newly minted DOIs before OpenAlex re-indexes)
    try {
      const crUrl = `https://api.crossref.org/works?filter=orcid:${lead.orcid}&sort=created&order=desc&rows=12&mailto=osdr-chatbot@users.noreply.github.com`;
      const crData = await fetchJsonSafe(crUrl, {}, 6500);
      const crItems = crData?.message?.items || [];
      if (crItems.length > 0) crossrefLiveCount++;

      for (const it of crItems) {
        const rawTitle = Array.isArray(it?.title) ? it.title[0] : it?.title;
        const title = String(rawTitle || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        if (!title || isErratumOrParatextTitle(title, it?.type)) continue;
        const dateParts =
          it?.published?.["date-parts"]?.[0] ||
          it?.["published-online"]?.["date-parts"]?.[0] ||
          it?.created?.["date-parts"]?.[0];
        let pubDate = "";
        if (Array.isArray(dateParts) && dateParts[0]) {
          const y = String(dateParts[0]);
          const m = dateParts[1] ? String(dateParts[1]).padStart(2, "0") : "";
          const d = dateParts[2] ? String(dateParts[2]).padStart(2, "0") : "";
          pubDate = d ? `${y}-${m}-${d}` : m ? `${y}-${m}` : y;
        }
        const yr = Number(pubDate.slice(0, 4) || "0");
        if (yr > 0 && yr < 2024) continue;

        leadScanned++;
        const doi = it?.DOI ? String(it.DOI).trim() : undefined;
        const venue = Array.isArray(it?.["container-title"]) ? String(it["container-title"][0] || "").trim() : "";
        const isPreprint =
          String(it?.type || "").toLowerCase() === "posted-content" ||
          /biorxiv|medrxiv|arxiv|research square|preprints\.org/i.test(venue || doi || "");
        const journal = venue || (isPreprint ? "Preprint Server" : "Crossref");
        const url = doi ? `https://doi.org/${doi}` : String(it?.URL || `https://orcid.org/${lead.orcid}`);

        upsertDraft({
          title,
          journal,
          publishedDate: pubDate,
          doi,
          url,
          isPreprint,
          fromOrcid: false,
          fromOpenAlex: false,
          fromEpmc: false,
          fromCrossref: true,
          rawTextForScope: `${title} ${journal}`,
        });
      }
    } catch {
      // Non-fatal Crossref fallback
    }

    // 2c-3. NASA NTRS (captures recent NASA presentations, abstracts & technical memos by OSDR/AWG leads)
    try {
      const ntrsUrl = `https://ntrs.nasa.gov/api/citations/search?q=${encodeURIComponent(`"${lead.name}"`)}&page[size]=30`;
      const ntrsData = await fetchJsonSafe(ntrsUrl, {}, 6500);
      const ntrsResults = ntrsData?.results || [];
      if (ntrsResults.length > 0) ntrsLiveCount++;

      const resolveNtrsDate = (r: any): string => {
        const pub = r?.publications?.[0]?.publicationDate;
        const dist = r?.distributionDate;
        const created = r?.created;
        const raw = String(pub || dist || created || "").trim();
        return raw ? raw.slice(0, 10) : "";
      };

      const sortedNtrs = [...ntrsResults].sort((a, b) =>
        resolveNtrsDate(b).localeCompare(resolveNtrsDate(a))
      );

      for (const r of sortedNtrs.slice(0, 15)) {
        const stiType = String(r?.stiType || "").toUpperCase();
        // Skip mirrored REPRINT / ACCEPTED_MANUSCRIPT bulk PubSpace imports whose later ingest distributionDate masks older journal articles
        if (stiType === "REPRINT" || stiType === "ACCEPTED_MANUSCRIPT") continue;

        const authNames = (r?.authorAffiliations || [])
          .map((a: any) => a?.meta?.author?.name || "")
          .filter(Boolean)
          .join(", ");
        if (authNames && !strictAuthorMatchesLead(authNames, lead.name)) continue;

        const title = String(r?.title || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        if (!title || isErratumOrParatextTitle(title)) continue;

        const idStr = String(r?.id || "");
        const hasExplicitPubDate = Boolean(r?.publications?.[0]?.publicationDate);
        if (idStr.length > 12 && !hasExplicitPubDate) continue;

        const pubDate = resolveNtrsDate(r);
        if (!pubDate || pubDate < "2025-01-01") continue;

        leadScanned++;
        const abs = String(r?.abstract || "").replace(/\s+/g, " ").trim();
        const stiLabel = stiType ? `NASA NTRS (${stiType.replace(/_/g, " ")})` : "NASA NTRS";

        upsertDraft({
          title,
          journal: stiLabel,
          publishedDate: pubDate,
          url: `https://ntrs.nasa.gov/citations/${r.id}`,
          isPreprint: stiType === "PREPRINT" || stiType === "ABSTRACT" || stiType === "PRESENTATION",
          summarySnippet: abs ? abs.slice(0, 290).trim() + (abs.length > 290 ? "…" : "") : undefined,
          fromOrcid: false,
          fromOpenAlex: false,
          fromEpmc: false,
          fromNtrs: true,
          rawTextForScope: `${title} ${abs}`,
        });
      }
    } catch {
      // Non-fatal NTRS fallback
    }

    // 2c-4. Spotlight Lead PubMed Recent Drops (avoids NCBI 3 req/s throttling on all 9 leads)
    if (lead.spotlight) {
      try {
        const pmQuery = `("Ryan T Scott"[Author] OR "Scott, Ryan T"[Author] OR ("Scott RT"[Author] AND (OSDR[All Fields] OR GeneLab[All Fields] OR ALSDA[All Fields] OR "Ames Research Center"[Affiliation] OR "space biology"[All Fields])))`;
        const esearchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(pmQuery)}&sort=date&retmax=12&retmode=json`;
        const esearchData = await fetchJsonSafe(esearchUrl, {}, 6000);
        const pmids: string[] = esearchData?.esearchresult?.idlist || [];
        if (pmids.length > 0) {
          const esumUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmids.join(",")}&retmode=json`;
          const esumData = await fetchJsonSafe(esumUrl, {}, 6000);
          pubmedLiveCount++;
          for (const pid of pmids) {
            const doc = esumData?.result?.[pid];
            if (!doc) continue;
            const pmAuthors = Array.isArray(doc?.authors)
              ? doc.authors.map((a: any) => a?.name || "").filter(Boolean).join(", ")
              : "";
            if (pmAuthors && !/\bScott\s+R(?:T|yan)?\b/i.test(pmAuthors)) continue;

            const title = String(doc?.title || "").replace(/<[^>]+>/g, "").replace(/\.$/, "").trim();
            if (!title || isErratumOrParatextTitle(title)) continue;
            const rawDateStr = String(doc?.epubdate || doc?.pubdate || "").trim();
            const parsedMs = parseFlexibleDateMs(rawDateStr);
            const pubDate = parsedMs ? new Date(parsedMs).toISOString().slice(0, 10) : rawDateStr.slice(0, 10);
            if (!pubDate || pubDate < "2024-01-01") continue;

            leadScanned++;
            const articleIds: any[] = doc?.articleids || [];
            const doiObj = articleIds.find((x) => x?.idtype === "doi");
            const pmcObj = articleIds.find((x) => x?.idtype === "pmc");
            const doi = doiObj?.value ? String(doiObj.value).trim() : undefined;
            const pmcid = pmcObj?.value ? String(pmcObj.value).trim() : undefined;
            const journal = String(doc?.fulljournalname || doc?.source || "PubMed").trim();
            const isPreprint = /biorxiv|medrxiv/i.test(journal);

            upsertDraft({
              title,
              journal,
              publishedDate: pubDate,
              doi,
              pmid: pid,
              pmcid,
              url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${pid}/`,
              isPreprint,
              fromOrcid: false,
              fromOpenAlex: false,
              fromEpmc: false,
              fromPubmed: true,
              rawTextForScope: `${title} ${journal}`,
            });
          }
        }
      } catch {
        // Non-fatal PubMed fallback
      }
    }

    // Deduplicate drafts, enforce Space Biology scope guardrail, classify OSDR status & window
    const uniqueDrafts = Array.from(new Set(byKey.values()));
    let leadInScope = 0;
    let leadPreOsdr = 0;
    let leadLiveOsdr = 0;
    const seenOsdIdsForLead = new Set<string>();

    const leadCandidates: RadarLeadSignal[] = [];

    for (const draft of uniqueDrafts) {
      const { osdIds, externalIds } = extractAccessionsFromText(draft.rawTextForScope);
      const scopeEval = evaluateSpaceBiologyScope({
        title: draft.title,
        journal: draft.journal,
        summary: draft.summarySnippet || draft.rawTextForScope,
        accessions: [...osdIds, ...externalIds],
      });

      if (!scopeEval.inScope) {
        leadFilteredOut++;
        continue;
      }

      const linkedOsdSet = new Set<string>(osdIds);
      if (draft.doi && osdrDoiToId.has(draft.doi.toLowerCase())) {
        linkedOsdSet.add(osdrDoiToId.get(draft.doi.toLowerCase())!);
      }
      const normDraftTitle = normalizeTitleKey(draft.title);
      if (normDraftTitle.length >= 24 && osdrTitleToIds.has(normDraftTitle)) {
        for (const oid of osdrTitleToIds.get(normDraftTitle)!) {
          linkedOsdSet.add(oid);
        }
      }

      const linkedOsdIds = Array.from(linkedOsdSet);
      for (const oid of linkedOsdIds) seenOsdIdsForLead.add(oid);

      const status: "pre_osdr_signal" | "live_on_osdr" =
        linkedOsdIds.length > 0 ? "live_on_osdr" : "pre_osdr_signal";

      if (status === "pre_osdr_signal") leadPreOsdr++;
      else leadLiveOsdr++;
      leadInScope++;

      const sourcePlatform: RadarLeadSignal["sourcePlatform"] =
        draft.fromNtrs && !draft.fromOrcid && !draft.fromOpenAlex && !draft.fromEpmc && !draft.fromCrossref && !draft.fromPubmed
          ? "NASA NTRS"
          : draft.fromPubmed && !draft.fromOrcid && !draft.fromOpenAlex && !draft.fromEpmc
          ? "PubMed"
          : draft.fromCrossref && !draft.fromOrcid && !draft.fromOpenAlex && !draft.fromEpmc
          ? "Crossref"
          : draft.fromOrcid && draft.fromOpenAlex && draft.fromEpmc
          ? "ORCID + OpenAlex + Europe PMC"
          : draft.fromOrcid && draft.fromOpenAlex
          ? "ORCID + OpenAlex"
          : draft.fromOpenAlex && draft.isPreprint
          ? "OpenAlex (Preprint)"
          : draft.fromOpenAlex
          ? "OpenAlex"
          : draft.fromOrcid && draft.fromEpmc
          ? "ORCID + Europe PMC"
          : draft.fromEpmc && draft.isPreprint
          ? "Europe PMC (Preprint)"
          : draft.fromEpmc
          ? "Europe PMC"
          : draft.fromOrcid
          ? "ORCID"
          : "Multi-Source";

      const winInfo = classifyTimeWindow(draft.publishedDate, refMs);
      const idSlug = `${lead.id}-${(draft.doi || normalizeTitleKey(draft.title)).replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 48)}`;

      leadCandidates.push({
        id: idSlug,
        leadId: lead.id,
        leadName: lead.name,
        leadRole: lead.role,
        leadSubgroup: lead.subgroup,
        leadOrcid: lead.orcid,
        spotlight: Boolean(lead.spotlight),
        status,
        sourcePlatform,
        title: draft.title,
        journal: draft.journal,
        publishedDate: draft.publishedDate || "Recent",
        quarterLabel: winInfo.quarterLabel,
        windowBucket: winInfo.windowBucket,
        isRecentMonth: winInfo.isRecentMonth,
        isPreprint: draft.isPreprint,
        doi: draft.doi,
        pmid: draft.pmid,
        pmcid: draft.pmcid,
        url: draft.url,
        externalAccessions: externalIds,
        linkedOsdIds,
        scopeMatchedBy: scopeEval.matchedTerms,
        summarySnippet: draft.summarySnippet,
        concepts: buildLeadSignalConcepts(lead, {
          title: draft.title,
          status,
          linkedOsdIds,
          externalAccessions: externalIds,
          doi: draft.doi,
          isPreprint: draft.isPreprint,
        }),
      });
    }

    // 2d. Add direct OSDR repository datasets authored by this lead (where not already represented by a paper link)
    const directStudies = leadDirectOsdrStudies.get(lead.id);
    if (directStudies) {
      const sortedDirect = Array.from(directStudies.values())
        .filter(({ study }) => !seenOsdIdsForLead.has(study.study_id) && (!study.release_date || study.release_date >= "2023-01-01"))
        .sort((a, b) => (b.study.release_date || "").localeCompare(a.study.release_date || ""))
        .slice(0, 3);

      for (const { study, sourceSystem } of sortedDirect) {
        seenOsdIdsForLead.add(study.study_id);
        leadInScope++;
        leadLiveOsdr++;
        const winInfo = classifyTimeWindow(study.release_date, refMs);
        leadCandidates.push({
          id: `${lead.id}-osdr-${study.study_id.toLowerCase()}`,
          leadId: lead.id,
          leadName: lead.name,
          leadRole: lead.role,
          leadSubgroup: lead.subgroup,
          leadOrcid: lead.orcid,
          spotlight: Boolean(lead.spotlight),
          status: "live_on_osdr",
          sourcePlatform: "NASA OSDR",
          title: `${study.study_id}: ${study.title}`,
          journal: `NASA OSDR (${sourceSystem.toUpperCase()}) · ${study.organism}`,
          publishedDate: study.release_date || "Curated",
          quarterLabel: winInfo.quarterLabel,
          windowBucket: winInfo.windowBucket,
          isRecentMonth: winInfo.isRecentMonth,
          isPreprint: false,
          doi: study.doi,
          url: `https://osdr.nasa.gov/bio/repo/data/studies/${study.study_id}`,
          externalAccessions: [],
          linkedOsdIds: [study.study_id],
          scopeMatchedBy: [`NASA OSDR (${study.study_id})`, "Lead Authorship"],
          summarySnippet: `${study.material_type} · ${study.assay_measurement} (${study.assay_platform})`,
          concepts: buildLeadSignalConcepts(lead, {
            title: study.title,
            status: "live_on_osdr",
            linkedOsdIds: [study.study_id],
            externalAccessions: [],
            doi: study.doi,
            isPreprint: false,
          }),
        });
      }
    }

    // Keep top chronological signals per lead (15 for spotlight lead, 12 per subgroup chair)
    const perLeadLimit = lead.spotlight ? 15 : 12;
    leadCandidates.sort((a, b) => (b.publishedDate || "0000").localeCompare(a.publishedDate || "0000"));
    allLeadSignals.push(...leadCandidates.slice(0, perLeadLimit));

    totalWorksScanned += leadScanned;
    totalFilteredOut += leadFilteredOut;

    leadSummaries.push({
      ...lead,
      inScopeCount: Math.min(leadInScope, perLeadLimit),
      preOsdrCount: leadCandidates.slice(0, perLeadLimit).filter((s) => s.status === "pre_osdr_signal").length,
      liveOsdrCount: leadCandidates.slice(0, perLeadLimit).filter((s) => s.status === "live_on_osdr").length,
      filteredOutNonSpaceCount: leadFilteredOut,
    });
  }

  allLeadSignals.sort((a, b) => {
    const da = a.publishedDate || "0000";
    const db = b.publishedDate || "0000";
    if (db !== da) return db.localeCompare(da);
    if (a.spotlight !== b.spotlight) return a.spotlight ? -1 : 1;
    return a.title.localeCompare(b.title);
  });

  const snapshot: RadarSnapshot = {
    schemaVersion: "1.2.0",
    generatedAt: referenceDateIso,
    currentMonthLabel: "Last 30 Days",
    currentQuarterLabel,
    previousQuarterLabel,
    sourceStatus: {
      osdrMode: osdrLiveOk ? "live_api" : "bundled_snapshot",
      orcidMode: orcidLiveCount > 0 ? "live_api" : "bundled_snapshot",
      openalexMode: openalexLiveCount > 0 ? "live_api" : "bundled_snapshot",
      europePmcMode: epmcLiveCount > 0 ? "live_api" : "bundled_snapshot",
      ntrsMode: ntrsLiveCount > 0 ? "live_api" : "bundled_snapshot",
      crossrefMode: crossrefLiveCount > 0 ? "live_api" : "bundled_snapshot",
      pubmedMode: pubmedLiveCount > 0 ? "live_api" : "bundled_snapshot",
      googleScholarNote:
        "Powered by ORCID Public API, OpenAlex Verified-ORCID Works, Crossref ORCID, PubMed E-utilities, NASA NTRS, Europe PMC, and NASA OSDR Search API.",
      lastError: errors.length > 0 ? errors.slice(0, 2).join("; ") : null,
    },
    leads: leadSummaries,
    osdrReleases: cappedReleases,
    leadSignals: allLeadSignals,
    scopeAudit: {
      totalWorksScanned,
      inScopeCount: allLeadSignals.length,
      filteredOutNonSpaceCount: totalFilteredOut,
      filterDescription:
        "Strictly scoped to NASA OSDR, GeneLab AWG, Space Biology, microgravity, space radiation, SOMA, and SANS domains.",
    },
  };

  return snapshot;
}

export async function refreshRadarLive(force: boolean = false): Promise<{
  snapshot: RadarSnapshot;
  refreshed: boolean;
  reason: string;
}> {
  const now = Date.now();
  if (!force && now - lastLiveRefreshAttemptMs < REFRESH_COOLDOWN_MS && currentSnapshot.osdrReleases.length > 0) {
    return {
      snapshot: currentSnapshot,
      refreshed: false,
      reason: "cooldown_cached",
    };
  }
  lastLiveRefreshAttemptMs = now;

  try {
    const live = await collectLiveRadarSnapshot({ referenceDateIso: new Date(now).toISOString() });
    if (live.osdrReleases.length > 0 && live.leadSignals.length > 0) {
      currentSnapshot = live;
      registerSnapshotStudiesIntoIndex(currentSnapshot);
      return {
        snapshot: currentSnapshot,
        refreshed: true,
        reason: "live_synced",
      };
    }
    // Partial failure offline -> keep bundled snapshot safely
    return {
      snapshot: currentSnapshot,
      refreshed: false,
      reason: "live_incomplete_fallback_snapshot",
    };
  } catch (err: any) {
    return {
      snapshot: currentSnapshot,
      refreshed: false,
      reason: `offline_fallback: ${err?.message || err}`,
    };
  }
}
