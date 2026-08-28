import { OSDRStudy } from "./studiesData";
import { getStudyById, getAllStudies, fetchLiveOSDRStudy } from "./osdrClient";

export type AccessionValidationStatus =
  | "valid"
  | "identical_accessions"
  | "single_accession"
  | "missing_accession"
  | "unresolved_accession"
  | "malformed_accession";

export interface ContextualMatch {
  study_id: string;
  title: string;
  organism: string;
  assay: string;
  tissue: string;
  factor: string;
}

export interface AccessionValidationResult {
  isValid: boolean;
  validationStatus: AccessionValidationStatus;
  requestedPair: [string, string] | [string] | [];
  resolvedPair: [string, string] | null;
  studyA: OSDRStudy | null;
  studyB: OSDRStudy | null;
  errorMessage?: string;
  userMessage?: string;
  failedAccession?: string;
  fallbackReason?: string;
  contextualMatches?: ContextualMatch[];
  suggestedPairs?: Array<{
    studyIds: [string, string];
    title: string;
    tag: string;
    score: number;
    whyMatched: string;
  }>;
}

/**
 * Normalizes an accession string:
 * - strips surrounding whitespace, quotes, punctuation
 * - standardizes prefix to OSD-XXX
 */
export function normalizeAccession(raw: string): string {
  if (!raw) return "";
  const cleaned = raw.trim().replace(/^["'`([{<]+|["'`)}\]>.,;:]+$/g, "").trim();
  const match = cleaned.match(/^OSD[-_]?(\d+)$/i);
  if (match) {
    return `OSD-${match[1]}`;
  }
  return cleaned.toUpperCase();
}

/**
 * Parses accession tokens from an AWG command input text.
 * Normalizes punctuation and connectors only:
 * - "and", "with", "&", "vs", "versus", "x", "×", commas, extra whitespace
 * Preserves the exact sequence of accessions entered by the user.
 */
export function parseRawAccessions(rawMessage: string): string[] {
  let text = rawMessage.trim();
  const lower = text.toLowerCase();
  const isExplicitAwgCommand =
    lower.startsWith("/awg") ||
    lower.startsWith("!awg") ||
    lower.startsWith("awg:") ||
    lower.startsWith("/compare") ||
    lower.startsWith("awg compare");

  // First pass: find explicit OSD matches in order
  const osdRegex = /OSD[-_]?\d+/gi;
  const matches = text.match(osdRegex);
  if (matches && matches.length > 0) {
    return matches.map((m) => normalizeAccession(m));
  }

  // If not an explicit AWG command, do not turn normal conversational words into accession tokens!
  if (!isExplicitAwgCommand) {
    return [];
  }

  // Strip AWG command prefix
  text = text.replace(/^\/?(awg|!awg|awg:)\s*/i, "").trim();
  text = text.replace(/^(compare|analyze|summary|meme|video|clip|relatable-clip|translational-clip)\s*/i, "").trim();

  // Normalize connectors & delimiters into standard spaces
  // Connectors: "and", "with", "&", "vs", "versus", "x", "×", ",", "+", ";"
  const normalizedSeparators = text
    .replace(/\s+and\s+/gi, " ")
    .replace(/\s+with\s+/gi, " ")
    .replace(/\s+vs\.?\s+/gi, " ")
    .replace(/\s+versus\s+/gi, " ")
    .replace(/\s*[&,;+×x]\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Match all potential study accession tokens
  const tokens = normalizedSeparators.split(" ").filter((t) => t.length > 0);
  const accessions: string[] = [];
  for (const t of tokens) {
    if (t.length > 0 && accessions.length < 2) {
      accessions.push(normalizeAccession(t));
    }
  }

  return accessions;
}

/**
 * Retrieves contextual matching studies from the local OSDR store
 * to display when an accession fails to resolve or when suggesting alternatives.
 */
export function getContextualMatches(limit: number = 6): ContextualMatch[] {
  const all = getAllStudies();
  return all.slice(0, limit).map((s) => ({
    study_id: s.study_id,
    title: s.title,
    organism: s.organism,
    assay: s.assay_measurement,
    tissue: s.material_type,
    factor: s.study_factor,
  }));
}

/**
 * Validates a pair of study accessions requested for AWG comparison.
 * Strictly enforces:
 * 1. Parse both accession values exactly as entered.
 * 2. If both normalized accessions are identical:
 *    - do NOT call RAG fallback
 *    - do NOT substitute a compatible study
 *    - return validation state: "Choose two distinct OSDR studies. You selected OSD-XXX twice."
 * 3. If either accession cannot be resolved:
 *    - state which accession failed
 *    - show available contextual matches
 *    - never replace it silently.
 * 4. resolvedPair must equal requestedPair unless explicitly confirmed.
 */
export async function validateAwgAccessions(
  requestedAccessions: string[],
  options: {
    allowSystemFallback?: boolean; // Only true for explicit /awg random or unparameterized chooser
  } = {}
): Promise<AccessionValidationResult> {
  const normalized = requestedAccessions.map(normalizeAccession);

  // Case 0: No accessions provided
  if (normalized.length === 0) {
    return {
      isValid: false,
      validationStatus: "missing_accession",
      requestedPair: [],
      resolvedPair: null,
      studyA: null,
      studyB: null,
      errorMessage: "No study accessions provided.",
      userMessage: "Please specify two OSDR study accessions to compare (e.g., `/awg compare OSD-679 OSD-680`).",
      contextualMatches: getContextualMatches(),
    };
  }

  // Case 1: Identical accessions entered (e.g. /awg compare OSD-681 OSD-681 or OSD-681 & OSD-681)
  if (normalized.length >= 2 && normalized[0] === normalized[1]) {
    const duplicateId = normalized[0];
    return {
      isValid: false,
      validationStatus: "identical_accessions",
      requestedPair: [duplicateId, duplicateId],
      resolvedPair: null,
      studyA: null,
      studyB: null,
      errorMessage: `Choose two distinct OSDR studies. You selected ${duplicateId} twice.`,
      userMessage: `Choose two distinct OSDR studies. You selected ${duplicateId} twice.`,
      failedAccession: duplicateId,
      fallbackReason: "identical_accessions_rejected",
      contextualMatches: getContextualMatches().filter((s) => s.study_id !== duplicateId),
    };
  }

  // Case 2: Only 1 accession provided
  if (normalized.length === 1) {
    const singleId = normalized[0];
    return {
      isValid: false,
      validationStatus: "single_accession",
      requestedPair: [singleId],
      resolvedPair: null,
      studyA: null,
      studyB: null,
      errorMessage: `Comparison requires two distinct studies. Only ${singleId} was provided.`,
      userMessage: `Please select a second study to compare with ${singleId}.`,
      failedAccession: undefined,
      fallbackReason: "single_accession_provided",
      contextualMatches: getContextualMatches().filter((s) => s.study_id !== singleId),
    };
  }

  const rawA = normalized[0];
  const rawB = normalized[1];
  const requestedPair: [string, string] = [rawA, rawB];

  // Validate format of accessions
  const isValidFormat = (id: string) => /^OSD-\d+$/i.test(id);
  if (!isValidFormat(rawA)) {
    return {
      isValid: false,
      validationStatus: "malformed_accession",
      requestedPair,
      resolvedPair: null,
      studyA: null,
      studyB: null,
      failedAccession: rawA,
      errorMessage: `Accession '${rawA}' is not a valid OSDR study format. Expected format: OSD-XXX.`,
      userMessage: `Study accession '${rawA}' is malformed. NASA OSDR accessions follow the format 'OSD-XXX' (e.g. OSD-679).`,
      contextualMatches: getContextualMatches(),
    };
  }
  if (!isValidFormat(rawB)) {
    return {
      isValid: false,
      validationStatus: "malformed_accession",
      requestedPair,
      resolvedPair: null,
      studyA: null,
      studyB: null,
      failedAccession: rawB,
      errorMessage: `Accession '${rawB}' is not a valid OSDR study format. Expected format: OSD-XXX.`,
      userMessage: `Study accession '${rawB}' is malformed. NASA OSDR accessions follow the format 'OSD-XXX' (e.g. OSD-680).`,
      contextualMatches: getContextualMatches(),
    };
  }

  // Resolve Study A
  let studyA = getStudyById(rawA);
  if (!studyA) {
    studyA = (await fetchLiveOSDRStudy(rawA)) || null;
  }
  if (!studyA) {
    return {
      isValid: false,
      validationStatus: "unresolved_accession",
      requestedPair,
      resolvedPair: null,
      studyA: null,
      studyB: null,
      failedAccession: rawA,
      errorMessage: `Study accession ${rawA} could not be resolved in the NASA OSDR repository.`,
      userMessage: `Study ${rawA} was not found in NASA OSDR. Never substituting studies silently.`,
      fallbackReason: `study_${rawA}_unresolved`,
      contextualMatches: getContextualMatches().filter((s) => s.study_id !== rawB),
    };
  }

  // Resolve Study B
  let studyB = getStudyById(rawB);
  if (!studyB) {
    studyB = (await fetchLiveOSDRStudy(rawB)) || null;
  }
  if (!studyB) {
    return {
      isValid: false,
      validationStatus: "unresolved_accession",
      requestedPair,
      resolvedPair: null,
      studyA,
      studyB: null,
      failedAccession: rawB,
      errorMessage: `Study accession ${rawB} could not be resolved in the NASA OSDR repository.`,
      userMessage: `Study ${rawB} was not found in NASA OSDR. Never substituting studies silently.`,
      fallbackReason: `study_${rawB}_unresolved`,
      contextualMatches: getContextualMatches().filter((s) => s.study_id !== rawA),
    };
  }

  // Both studies resolved exactly matching requested pair!
  return {
    isValid: true,
    validationStatus: "valid",
    requestedPair,
    resolvedPair: [studyA.study_id, studyB.study_id],
    studyA,
    studyB,
  };
}
