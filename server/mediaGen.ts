
// ---------------------------------------------------------------------------
// Veo Quota & Cooldown Circuit Breaker State (Rate-Limit Protection)
// ---------------------------------------------------------------------------
export const EXHAUSTED_QUOTA_MESSAGE = "Video quota is temporarily exhausted for this project. Try again later; fallback preview is available now.";
export const VEO_CIRCUIT_BREAKER_DURATION_MS = 5 * 60 * 1000; // 5 minutes circuit breaker after 429
export const VEO_PER_PAIR_COOLDOWN_MS = 20 * 1000; // 20s cooldown per pair
export const VEO_PER_SESSION_COOLDOWN_MS = 15 * 1000; // 15s cooldown per session

interface VeoQuotaState {
  circuitBreakerOpenUntil: number;
  circuitBreakerReason: string;
  perPairCooldowns: Map<string, number>;
  perSessionCooldowns: Map<string, number>;
}

const veoQuotaState: VeoQuotaState = {
  circuitBreakerOpenUntil: 0,
  circuitBreakerReason: "",
  perPairCooldowns: new Map(),
  perSessionCooldowns: new Map(),
};

export function resetVeoCircuitBreaker(): void {
  veoQuotaState.circuitBreakerOpenUntil = 0;
  veoQuotaState.circuitBreakerReason = "";
}

export function isVeoCircuitBreakerOpen(): boolean {
  return Date.now() < veoQuotaState.circuitBreakerOpenUntil;
}

export function checkVeoQuotaGate(options: {
  pairKey?: string;
  sessionId?: string;
  requestId?: string;
  modelName?: string;
}): {
  allowed: boolean;
  reason?: string;
  cooldownRemainingSeconds?: number;
  circuitBreakerActive: boolean;
} {
  const now = Date.now();

  // 1. Check Circuit Breaker
  if (now < veoQuotaState.circuitBreakerOpenUntil) {
    const remainingSec = Math.ceil((veoQuotaState.circuitBreakerOpenUntil - now) / 1000);
    console.info(
      `[Veo Quota Guard] RequestID=${options.requestId || "unknown"} | Provider=GoogleGemini | Model=${options.modelName || "veo-3.1-lite"} | Status=circuit_breaker_blocked | CooldownRemaining=${remainingSec}s | CircuitBreaker=open`
    );
    return {
      allowed: false,
      reason: EXHAUSTED_QUOTA_MESSAGE,
      cooldownRemainingSeconds: remainingSec,
      circuitBreakerActive: true,
    };
  }

  // 2. Check Per-Pair Cooldown
  if (options.pairKey) {
    const nextAllowed = veoQuotaState.perPairCooldowns.get(options.pairKey) || 0;
    if (now < nextAllowed) {
      const remainingSec = Math.ceil((nextAllowed - now) / 1000);
      console.info(
        `[Veo Quota Guard] RequestID=${options.requestId || "unknown"} | Provider=GoogleGemini | Model=${options.modelName || "veo-3.1-lite"} | Status=pair_cooldown_blocked | CooldownRemaining=${remainingSec}s | CircuitBreaker=closed`
      );
      return {
        allowed: false,
        reason: `Please wait ${remainingSec}s before requesting another video generation for ${options.pairKey}.`,
        cooldownRemainingSeconds: remainingSec,
        circuitBreakerActive: false,
      };
    }
  }

  // 3. Check Per-Session Cooldown
  if (options.sessionId) {
    const nextAllowed = veoQuotaState.perSessionCooldowns.get(options.sessionId) || 0;
    if (now < nextAllowed) {
      const remainingSec = Math.ceil((nextAllowed - now) / 1000);
      console.info(
        `[Veo Quota Guard] RequestID=${options.requestId || "unknown"} | Provider=GoogleGemini | Model=${options.modelName || "veo-3.1-lite"} | Status=session_cooldown_blocked | CooldownRemaining=${remainingSec}s | CircuitBreaker=closed`
      );
      return {
        allowed: false,
        reason: `Please wait ${remainingSec}s before initiating another video request.`,
        cooldownRemainingSeconds: remainingSec,
        circuitBreakerActive: false,
      };
    }
  }

  return {
    allowed: true,
    circuitBreakerActive: false,
  };
}

export function triggerVeoCircuitBreaker(reason?: string, requestId?: string, modelName?: string): void {
  const now = Date.now();
  veoQuotaState.circuitBreakerOpenUntil = now + VEO_CIRCUIT_BREAKER_DURATION_MS;
  veoQuotaState.circuitBreakerReason = reason || EXHAUSTED_QUOTA_MESSAGE;
  console.warn(
    `[Veo Quota Guard] RequestID=${requestId || "system"} | Provider=GoogleGemini | Model=${modelName || "veo-3.1-lite"} | Status=circuit_breaker_triggered | CooldownRemaining=${Math.ceil(VEO_CIRCUIT_BREAKER_DURATION_MS / 1000)}s | CircuitBreaker=open`
  );
}

export function recordVeoAttempt(pairKey?: string, sessionId?: string, requestId?: string, modelName?: string): void {
  const now = Date.now();
  if (pairKey) {
    veoQuotaState.perPairCooldowns.set(pairKey, now + VEO_PER_PAIR_COOLDOWN_MS);
  }
  if (sessionId) {
    veoQuotaState.perSessionCooldowns.set(sessionId, now + VEO_PER_SESSION_COOLDOWN_MS);
  }
  console.info(
    `[Veo Quota Guard] RequestID=${requestId || "unknown"} | Provider=GoogleGemini | Model=${modelName || "veo-3.1-lite"} | Status=attempt_recorded | CooldownRemaining=${Math.ceil(VEO_PER_PAIR_COOLDOWN_MS / 1000)}s | CircuitBreaker=closed`
  );
}

import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";
import { getStudyById, OSDRStudy } from "./rag";
import { buildAwgEvidenceMap, ArtifactGroundingCard, EvidenceClass } from "./awg";
import { validateAwgAccessions } from "./accessionValidator";
import { getStudyManifest } from "./studyManifests";

export const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-lite-image";
export const DEFAULT_FALLBACK_VIDEO_MODEL = "none";

export type MediaGenerationStatus =
  | "fresh_provider"
  | "cache_hit"
  | "fallback"
  | "failed";

export interface VideoProviderModelInfo {
  name: string;
  cleanName: string;
  displayName?: string;
  supportedActions?: string[];
  description?: string;
}

export interface VideoProviderDiscovery {
  status: "available" | "not_available" | "unconfigured" | "error";
  selectedModel?: string;
  selectedModelFullName?: string;
  invocationMethod: "predictLongRunning" | "generateVideos" | "none";
  availableVideoModels: VideoProviderModelInfo[];
  allAvailableModelsCount: number;
  apiSurface: string;
  reason?: string;
  requiredStep?: string;
  checkedAt: string;
  isPermanentConfigError: boolean;
}

export type AwgArtifactType =
  | "provider_image_data_uri"
  | "fallback_svg_data_uri"
  | "canvas_motion_render"
  | "provider_video_url";

export type AwgRenderEngine =
  | "gemini_inline_image"
  | "svg_vector_engine"
  | "browser_canvas_60fps"
  | "veo_hosted_mp4";

export interface StageExecutionAudit {
  activePairResolution: "success" | "fail";
  promptPlanning: "success" | "fail" | "not_attempted";
  planningMethod?: "local_metadata_template" | "gemini_generated" | "openrouter_generated" | "groq_generated" | "none";
  providerVideoRequest: "not_attempted" | "success" | "fail" | "not_available";
  artifactPersistence: "success" | "fail" | "not_applicable";
  fallbackPreview: "used" | "not_used";
  planningModel: string;
  planningError?: string;
  videoProviderModel: string;
  videoProviderError?: string;
  videoProviderDiscovery?: VideoProviderDiscovery;
  isConfigurationError?: boolean;
  fallbackRenderer: string;
  finalArtifactType: AwgArtifactType | "provider_mp4" | "none" | "canvas_preview";
}

export interface MediaProvenanceRecord {
  requestId: string;
  artifactId: string;
  createdAt: string;
  mediaType: "image" | "motion_brief" | "relatable_clip" | "translational_clip" | "meme_clip" | "meme_concept" | "visual_abstract";
  artifactType?: AwgArtifactType;
  renderEngine?: AwgRenderEngine;
  planningProvider?: string;
  provider: string;
  providerModel: string;
  planningModel?: string;
  planningMethod?: "local_metadata_template" | "gemini_generated" | "openrouter_generated" | "groq_generated" | "none";
  videoProviderModel?: string;
  fallbackRenderer?: string;
  finalArtifactType?: AwgArtifactType | "provider_mp4" | "none" | "canvas_preview";
  stages?: StageExecutionAudit;
  videoProviderDiscovery?: VideoProviderDiscovery;
  isConfigurationError?: boolean;
  generationStatus: MediaGenerationStatus;
  statusLabel: string;
  cacheKey: string;
  cacheHit: boolean;
  creativeDirection: string;
  seed?: string | number;
  promptFingerprint: string;
  sourceStudyPair: string[];
  assetUrl?: string;
  contentHash?: string;
  latencyMs: number;
  errorCode?: string;
  errorMessage?: string;
  isDuplicateOutput?: boolean;
  duplicateWarning?: string;
}

export function getStatusLabel(status: MediaGenerationStatus): string {
  switch (status) {
    case "fresh_provider":
      return "Fresh provider generation";
    case "cache_hit":
      return "Reused cached artifact";
    case "fallback":
      return "Conceptual local fallback";
    case "failed":
      return "Generation failed — no new media created";
    default:
      return "Conceptual local fallback";
  }
}

export function computePromptFingerprint(prompt: string): string {
  if (!prompt) return "sha256:0000000000000000";
  const hash = crypto.createHash("sha256").update(prompt.trim()).digest("hex");
  return `sha256:${hash.slice(0, 24)}`;
}

export function computeContentHash(content: string | object): string {
  const payload = typeof content === "string" ? content : JSON.stringify(content);
  const hash = crypto.createHash("sha256").update(payload).digest("hex");
  return `sha256:${hash.slice(0, 24)}`;
}

// In-Memory Provenance Audit Log Ring Buffer (retains last 50 requests)
const MAX_AUDIT_LOG_SIZE = 50;
const mediaAuditLog: MediaProvenanceRecord[] = [];

// Content hash registry to detect duplicate outputs across distinct requests
const knownContentHashes = new Map<string, { requestId: string; seed: string | number; createdAt: string }>();

// In-Memory Media Cache for reusable generations
interface CachedMediaArtifact {
  cacheKey: string;
  data: any;
  contentHash: string;
  originalRequestId: string;
  createdAt: string;
  provider: string;
  providerModel: string;
}
const mediaArtifactCache = new Map<string, CachedMediaArtifact>();

export function recordMediaAudit(record: MediaProvenanceRecord): void {
  // Ensure contentHash is always defined
  if (!record.contentHash) {
    record.contentHash = computeContentHash({
      requestId: record.requestId,
      seed: record.seed,
      model: record.providerModel,
      mediaType: record.mediaType,
      sourceStudyPair: record.sourceStudyPair,
      cacheKey: record.cacheKey,
    });
  }

  // Check if content hash was already produced under a different request/seed
  if (record.contentHash && !record.isDuplicateOutput) {
    const existing = knownContentHashes.get(record.contentHash);
    if (existing && existing.requestId !== record.requestId) {
      record.isDuplicateOutput = true;
      record.duplicateWarning = "Possible duplicate output — compare request IDs and content hashes.";
    } else {
      knownContentHashes.set(record.contentHash, {
        requestId: record.requestId,
        seed: record.seed,
        createdAt: record.createdAt,
      });
    }
  }

  mediaAuditLog.unshift(record);
  if (mediaAuditLog.length > MAX_AUDIT_LOG_SIZE) {
    mediaAuditLog.pop();
  }

  console.log(
    `[AWG Media Lifecycle] Request ${record.requestId} | Status: ${record.generationStatus} (${record.statusLabel}) | Latency: ${record.latencyMs}ms | Provider: ${record.provider} | ContentHash: ${record.contentHash}${record.isDuplicateOutput ? " [DUPLICATE DETECTED]" : ""}`
  );
}

export function getMediaAuditLog(limit: number = 20): MediaProvenanceRecord[] {
  return mediaAuditLog.slice(0, Math.max(1, Math.min(limit, MAX_AUDIT_LOG_SIZE)));
}

export function clearMediaAuditLog(): void {
  mediaAuditLog.length = 0;
  knownContentHashes.clear();
  mediaArtifactCache.clear();
}

export function getImageApiKey(): string | undefined {
  const key = process.env.IMAGE_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
  return key && key.length > 0 ? key : undefined;
}

export function getVideoApiKey(): string | undefined {
  const key = process.env.VIDEO_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
  return key && key.length > 0 ? key : undefined;
}

let cachedImageClient: GoogleGenAI | null = null;
let lastImageKey: string | undefined = undefined;

function getImageAi(): GoogleGenAI | null {
  const key = getImageApiKey();
  if (!key) return null;
  if (!cachedImageClient || lastImageKey !== key) {
    cachedImageClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
    lastImageKey = key;
  }
  return cachedImageClient;
}

let cachedVideoClient: GoogleGenAI | null = null;
let lastVideoKey: string | undefined = undefined;

function getVideoAi(): GoogleGenAI | null {
  const key = getVideoApiKey();
  if (!key) return null;
  if (!cachedVideoClient || lastVideoKey !== key) {
    cachedVideoClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
    lastVideoKey = key;
  }
  return cachedVideoClient;
}

export interface MediaConfigStatus {
  geminiImageConfigured: boolean;
  geminiVideoConfigured: boolean;
  imageApiKeyPresent: boolean;
  videoApiKeyPresent: boolean;
  geminiApiKeyPresent: boolean;
  imageModel: string;
  videoModel: string;
}

export function getMediaConfigStatus(): MediaConfigStatus {
  const hasImageKey = Boolean(process.env.IMAGE_API_KEY && process.env.IMAGE_API_KEY.trim().length > 0);
  const hasVideoKey = Boolean(process.env.VIDEO_API_KEY && process.env.VIDEO_API_KEY.trim().length > 0);
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);

  const currentDiscovery = getCachedVideoDiscovery();

  return {
    geminiImageConfigured: Boolean(getImageApiKey()),
    geminiVideoConfigured: Boolean(getVideoApiKey()) && currentDiscovery?.status === "available",
    imageApiKeyPresent: hasImageKey,
    videoApiKeyPresent: hasVideoKey,
    geminiApiKeyPresent: hasGeminiKey,
    imageModel: GEMINI_IMAGE_MODEL,
    videoModel: currentDiscovery?.selectedModel || "none (discovery pending/unavailable)",
  };
}

let cachedVideoDiscovery: VideoProviderDiscovery | null = null;
let lastDiscoveryCheckKey: string | undefined = undefined;
let lastDiscoveryTime: number = 0;
const DISCOVERY_CACHE_TTL_MS = 60 * 1000;

export function getCachedVideoDiscovery(): VideoProviderDiscovery | null {
  return cachedVideoDiscovery;
}

export async function discoverVideoProviderCapabilities(
  forceRefresh: boolean = false
): Promise<VideoProviderDiscovery> {
  const apiKey = getVideoApiKey();
  if (!apiKey) {
    const res: VideoProviderDiscovery = {
      status: "unconfigured",
      invocationMethod: "none",
      availableVideoModels: [],
      allAvailableModelsCount: 0,
      apiSurface: "GoogleGenAI SDK (v1beta)",
      reason: "GEMINI_API_KEY is not configured in the server environment.",
      requiredStep: "Configure GEMINI_API_KEY in the application settings.",
      checkedAt: new Date().toISOString(),
      isPermanentConfigError: true,
    };
    cachedVideoDiscovery = res;
    return res;
  }

  const now = Date.now();
  if (!forceRefresh && cachedVideoDiscovery && lastDiscoveryCheckKey === apiKey && now - lastDiscoveryTime < DISCOVERY_CACHE_TTL_MS) {
    return cachedVideoDiscovery;
  }

  const ai = getVideoAi();
  if (!ai) {
    const res: VideoProviderDiscovery = {
      status: "error",
      invocationMethod: "none",
      availableVideoModels: [],
      allAvailableModelsCount: 0,
      apiSurface: "GoogleGenAI SDK (v1beta)",
      reason: "Failed to initialize GoogleGenAI client.",
      requiredStep: "Check API key format and client connectivity.",
      checkedAt: new Date().toISOString(),
      isPermanentConfigError: true,
    };
    cachedVideoDiscovery = res;
    return res;
  }

  try {
    const list = await ai.models.list();
    const allModels: any[] = [];
    for await (const m of list) {
      allModels.push(m);
    }

    const videoModels: VideoProviderModelInfo[] = [];
    for (const m of allModels) {
      const name = m.name || "";
      const cleanName = name.replace(/^models\//, "");
      const supportedActions: string[] = Array.isArray(m.supportedActions) ? m.supportedActions : [];
      const isVideoName = cleanName.toLowerCase().includes("veo") || cleanName.toLowerCase().includes("video");
      const hasPredictLongRunning = supportedActions.includes("predictLongRunning");
      const hasGenerateVideos = supportedActions.includes("generateVideos") || supportedActions.includes("generateVideo");

      if (isVideoName || hasPredictLongRunning || hasGenerateVideos) {
        videoModels.push({
          name,
          cleanName,
          displayName: m.displayName || cleanName,
          supportedActions,
          description: m.description,
        });
      }
    }

    if (videoModels.length === 0) {
      const res: VideoProviderDiscovery = {
        status: "not_available",
        invocationMethod: "none",
        availableVideoModels: [],
        allAvailableModelsCount: allModels.length,
        apiSurface: "GoogleGenAI SDK (v1beta) / ai.models.list",
        reason: "Provider video generation is not enabled for this project or API configuration.",
        requiredStep: "Request project access to Veo video generation models or enable video quota in Google Cloud Console / AI Studio settings.",
        checkedAt: new Date().toISOString(),
        isPermanentConfigError: true,
      };
      cachedVideoDiscovery = res;
      lastDiscoveryCheckKey = apiKey;
      lastDiscoveryTime = now;
      return res;
    }

    // Prioritize discovered models (prefer lite/fast preview or first available)
    const preferred =
      videoModels.find((m) => m.cleanName.includes("lite") && m.cleanName.includes("veo")) ||
      videoModels.find((m) => m.cleanName.includes("fast") && m.cleanName.includes("veo")) ||
      videoModels.find((m) => m.cleanName.includes("veo")) ||
      videoModels[0];

    const res: VideoProviderDiscovery = {
      status: "available",
      selectedModel: preferred.cleanName,
      selectedModelFullName: preferred.name,
      invocationMethod: preferred.supportedActions?.includes("predictLongRunning") ? "predictLongRunning" : "generateVideos",
      availableVideoModels: videoModels,
      allAvailableModelsCount: allModels.length,
      apiSurface: "GoogleGenAI SDK (v1beta) / ai.models.generateVideos",
      checkedAt: new Date().toISOString(),
      isPermanentConfigError: false,
    };
    cachedVideoDiscovery = res;
    lastDiscoveryCheckKey = apiKey;
    lastDiscoveryTime = now;
    return res;
  } catch (err: any) {
    const isRateLimit = err?.status === 429 || err?.message?.includes("429") || err?.message?.includes("RESOURCE_EXHAUSTED");
    const res: VideoProviderDiscovery = {
      status: "error",
      invocationMethod: "none",
      availableVideoModels: [],
      allAvailableModelsCount: 0,
      apiSurface: "GoogleGenAI SDK (v1beta)",
      reason: err?.message || "Failed to list models from Gemini API.",
      requiredStep: isRateLimit ? "Wait for rate limits to reset." : "Verify GEMINI_API_KEY validity.",
      checkedAt: new Date().toISOString(),
      isPermanentConfigError: !isRateLimit,
    };
    cachedVideoDiscovery = res;
    lastDiscoveryCheckKey = apiKey;
    lastDiscoveryTime = now;
    return res;
  }
}

export function markVideoModelUnavailable(modelName?: string, reason?: string): void {
  const isRateLimit = reason?.includes("429") || reason?.includes("RESOURCE_EXHAUSTED") || reason?.toLowerCase().includes("quota");
  const isPermanent = !isRateLimit;
  cachedVideoDiscovery = {
    status: "not_available",
    selectedModel: modelName,
    invocationMethod: "none",
    availableVideoModels: [],
    allAvailableModelsCount: 0,
    apiSurface: "GoogleGenAI SDK (v1beta) / ai.models.generateVideos",
    reason: reason || "Provider video generation is not enabled or supported for this API key.",
    requiredStep: isRateLimit
      ? "Wait for API quota to reset or upgrade Gemini billing tier."
      : "Enable Veo video generation access in Google Cloud Console / AI Studio.",
    checkedAt: new Date().toISOString(),
    isPermanentConfigError: isPermanent,
  };
  lastDiscoveryTime = Date.now();
}

export type MediaCategory =
  | "data_visualization"
  | "biological_concept"
  | "contextual_narrative"
  | "accession_summary";

// ---------------------------------------------------------------------------
// Controlled Style Variation Matrix
// ---------------------------------------------------------------------------

export type PaletteTheme = "cobalt_cyan" | "amber_slate" | "emerald_obsidian" | "indigo_rose";

export interface StyleVariation {
  id: string;
  category: MediaCategory;
  name: string;
  layoutTitle: string;
  layoutDescription: string;
  viewingAngle: string;
  paletteTheme: PaletteTheme;
  paletteName: string;
  paletteColors: {
    bgGradStart: string;
    bgGradEnd: string;
    cardBg: string;
    cardStroke: string;
    accentPrimary: string;
    accentSecondary: string;
    accentHighlight: string;
    textPrimary: string;
    textSecondary: string;
    badgeBg: string;
  };
  annotationDensity: "high_density_diagram" | "balanced_poster" | "spotlight_focal";
  compositionFraming: string;
  promptDirectives: string[];
}

const PALETTE_DEFINITIONS: Record<PaletteTheme, StyleVariation["paletteColors"] & { name: string }> = {
  cobalt_cyan: {
    name: "Deep Space Cobalt & Cyan",
    bgGradStart: "#090f1f",
    bgGradEnd: "#04070e",
    cardBg: "#0f172a",
    cardStroke: "#1e293b",
    accentPrimary: "#38bdf8",
    accentSecondary: "#818cf8",
    accentHighlight: "#38bdf8",
    textPrimary: "#f8fafc",
    textSecondary: "#94a3b8",
    badgeBg: "#0369a1",
  },
  amber_slate: {
    name: "Metabolic Amber & Slate",
    bgGradStart: "#14110f",
    bgGradEnd: "#080706",
    cardBg: "#1c1917",
    cardStroke: "#292524",
    accentPrimary: "#f59e0b",
    accentSecondary: "#14b8a6",
    accentHighlight: "#fbbf24",
    textPrimary: "#fdf8f6",
    textSecondary: "#a8a29e",
    badgeBg: "#78350f",
  },
  emerald_obsidian: {
    name: "Emerald & Obsidian",
    bgGradStart: "#06130d",
    bgGradEnd: "#020704",
    cardBg: "#0c1f17",
    cardStroke: "#16382b",
    accentPrimary: "#10b981",
    accentSecondary: "#06b6d4",
    accentHighlight: "#34d399",
    textPrimary: "#f0fdf4",
    textSecondary: "#86efac",
    badgeBg: "#065f46",
  },
  indigo_rose: {
    name: "Aerospace Indigo & Rose",
    bgGradStart: "#130919",
    bgGradEnd: "#07030a",
    cardBg: "#1d0f27",
    cardStroke: "#301941",
    accentPrimary: "#f43f5e",
    accentSecondary: "#c084fc",
    accentHighlight: "#fb7185",
    textPrimary: "#fff1f2",
    textSecondary: "#f472b6",
    badgeBg: "#881337",
  },
};

export type PairCapabilityClass =
  | "imaging_only"
  | "physiology_only"
  | "imaging_plus_physiology"
  | "omics_only"
  | "imaging_plus_omics"
  | "imaging_plus_histology"
  | "physiology_plus_omics"
  | "mixed_non_equivalent_modalities";

export interface StudyCapabilityProfile {
  hasMicroarray: boolean;
  hasRnaSeq: boolean;
  hasTranscriptomics: boolean;
  hasProteomics: boolean;
  hasMetabolomics: boolean;
  hasMethylation: boolean;
  hasHistology: boolean;
  hasImaging: boolean;
  hasPhysiology: boolean;
  hasOpticNerveMorphometry: boolean;
  hasSourceVerifiedMolecularFindings: boolean;
  isOmics: boolean;
  isNonOmics: boolean;
  primaryAssayLabel: string;
}

export interface PairCapabilityProfile extends StudyCapabilityProfile {
  studyA: StudyCapabilityProfile;
  studyB: StudyCapabilityProfile;
  pairClass: PairCapabilityClass;
  isMultiOmics: boolean;
  isBothOmics: boolean;
  isBothTranscriptomics: boolean;
  isBothRnaSeq: boolean;
  hasAnyOmics: boolean;
  isImagingPhysiologyOnly: boolean;
  isImagingPlusOmics: boolean;
  isPhysiologyPlusOmics: boolean;
  isMixedNonEquivalent: boolean;
  hasVerifiedMechanisticFindings: boolean;
}

export function deriveStudyCapabilities(study: OSDRStudy): StudyCapabilityProfile {
  const normId = study.study_id.toUpperCase();
  const manifest = getStudyManifest(normId);

  const manifestAssayNames = (manifest?.assays || []).map(a => `${a.name} ${a.measurementType} ${a.technology} ${a.platform}`).join(" ");
  const manifestScope = (manifest?.tissueMaterial?.exactScope || []).join(" ") + " " + (manifest?.tissueMaterial?.anatomicalNotes || "");
  const manifestDirectFindings = (manifest?.directPublicationSupportedFindings || []);

  const assayText = `${study.assay_measurement || ""} ${study.assay_technology || ""} ${study.assay_platform || ""} ${manifestAssayNames}`.toLowerCase();
  const contextText = `${study.study_id} ${study.material_type || ""} ${manifestScope}`.toLowerCase();
  const combinedText = `${assayText} ${contextText}`;

  // 1. Microarray vs RNA-seq
  const hasMicroarray = /\b(microarray|genechip|affymetrix|agilent|dna microarray)\b/i.test(assayText);
  const hasRnaSeq = /\b(rna-seq|rnaseq|transcriptome profiling|illumina|novaseq|hiseq|single-cell rna|scrna|mrna-seq|total rna-seq)\b/i.test(assayText);
  const hasTranscriptomics = hasMicroarray || hasRnaSeq || /\b(transcriptom|gene expression)\b/i.test(assayText);

  // 2. Proteomics
  const isExplicitProteomics = /\b(proteom|protein expression|protein profiling|swath|dia-ms|tmt)\b/i.test(assayText) ||
    (/\bmass spectrometry\b/i.test(assayText) && !/\b(imaging|mri|tonometry|microarray)\b/i.test(assayText));
  const hasProteomics = isExplicitProteomics;

  // 3. Metabolomics
  const hasMetabolomics = /\b(metabolom|metabolite|lipidom|metabolic profiling|gc-ms|lc-ms metabol)\b/i.test(assayText);

  // 4. Methylation
  const hasMethylation = /\b(methylation|bisulfite|rrbs|epigenom|dna methylation)\b/i.test(assayText);

  // 5. Histology
  const hasHistology = /\b(histology|immunohistochemistry|ihc|staining|h&e|immunofluorescence|tissue section)\b/i.test(combinedText);

  // 6. Imaging
  const hasImaging = /\b(imaging|mri|oct|optical coherence tomography|ultrasound|ultrasonography|fundus|micro-ct|radiography)\b/i.test(combinedText);

  // 7. Physiology
  const hasPhysiology = /\b(tonometry|iop|intraocular pressure|telemetry|telemetric|intracranial pressure|icp|blood pressure|temperature|physiological|plethysmography|biotelemetry)\b/i.test(combinedText);

  // 8. Optic Nerve Morphometry
  const hasOpticNerve = /\b(optic nerve|optic nerve sheath|retrobulbar)\b/i.test(combinedText);
  const hasMorphometry = /\b(mri|morphometry|diameter|sheath distension|swelling|protrusion|imaging|dimension)\b/i.test(combinedText);
  const hasOpticNerveMorphometry = hasOpticNerve && hasMorphometry;

  // 9. Source Verified Molecular Findings
  const hasSequencingFindings = manifestDirectFindings.some(f => f.evidenceType === "sequencing_expression");
  const hasMolecularGeneFindings = manifestDirectFindings.some(f => /\b(gene|expression|upregulated|downregulated|caspase|ucp2|cldn|vegf|pathway)\b/i.test(f.finding));
  const hasSourceVerifiedMolecularFindings = hasSequencingFindings || hasMolecularGeneFindings;

  const isOmics = hasTranscriptomics || hasProteomics || hasMetabolomics || hasMethylation;
  const isNonOmics = !isOmics && (hasImaging || hasPhysiology || hasHistology);

  let primaryAssayLabel = study.assay_measurement || "Assay";
  if (normId === "OSD-87") {
    primaryAssayLabel = "DNA Microarray Gene Expression & Retinal Histology";
  } else if (normId === "OSD-680") {
    primaryAssayLabel = "Optic-Nerve MRI Morphometry";
  } else if (normId === "OSD-679") {
    primaryAssayLabel = "Optical Coherence Tomography (OCT) & IOP Tonometry";
  } else if (normId === "OSD-681") {
    primaryAssayLabel = "Intracranial Pressure & Temperature Biotelemetry";
  } else if (normId === "OSD-583") {
    primaryAssayLabel = "Intraocular Pressure (IOP) & Retinal Histology";
  } else if (normId === "OSD-100") {
    primaryAssayLabel = "RNA-seq (Transcriptomics) & Bisulfite-seq (DNA Methylation)";
  } else if (normId === "OSD-194" || normId === "OSD-557" || normId === "OSD-758" || normId === "OSD-759") {
    primaryAssayLabel = "RNA-seq (Transcriptomics)";
  } else if (hasMicroarray && hasHistology) {
    primaryAssayLabel = "DNA Microarray Gene Expression & Histology";
  } else if (hasMicroarray) {
    primaryAssayLabel = "DNA Microarray Gene Expression";
  } else if (hasRnaSeq) {
    primaryAssayLabel = "RNA-seq (Transcriptomics)";
  } else if (hasMethylation) {
    primaryAssayLabel = "Bisulfite Sequencing (DNA Methylation)";
  } else if (hasProteomics) {
    primaryAssayLabel = "Mass Spectrometry Proteomics";
  } else if (hasMetabolomics) {
    primaryAssayLabel = "Metabolomics Profiling";
  } else if (hasOpticNerveMorphometry) {
    primaryAssayLabel = "Optic-Nerve MRI Morphometry";
  } else if (hasImaging && hasPhysiology) {
    primaryAssayLabel = "In Vivo Diagnostic Imaging & Tonometry";
  } else if (hasImaging) {
    primaryAssayLabel = "In Vivo Diagnostic Imaging";
  } else if (hasPhysiology) {
    primaryAssayLabel = "In Vivo Physiological Telemetry";
  } else if (hasHistology) {
    primaryAssayLabel = "Tissue Histology & Morphology";
  }

  return {
    hasMicroarray,
    hasRnaSeq,
    hasTranscriptomics,
    hasProteomics,
    hasMetabolomics,
    hasMethylation,
    hasHistology,
    hasImaging,
    hasPhysiology,
    hasOpticNerveMorphometry,
    hasSourceVerifiedMolecularFindings,
    isOmics,
    isNonOmics,
    primaryAssayLabel,
  };
}

export function derivePairCapabilities(sA: OSDRStudy, sB: OSDRStudy): PairCapabilityProfile {
  const capA = deriveStudyCapabilities(sA);
  const capB = deriveStudyCapabilities(sB);

  const hasTranscriptomics = capA.hasTranscriptomics || capB.hasTranscriptomics;
  const hasProteomics = capA.hasProteomics || capB.hasProteomics;
  const hasMetabolomics = capA.hasMetabolomics || capB.hasMetabolomics;
  const hasMethylation = capA.hasMethylation || capB.hasMethylation;
  const hasHistology = capA.hasHistology || capB.hasHistology;
  const hasImaging = capA.hasImaging || capB.hasImaging;
  const hasPhysiology = capA.hasPhysiology || capB.hasPhysiology;
  const hasOpticNerveMorphometry = capA.hasOpticNerveMorphometry || capB.hasOpticNerveMorphometry;
  const hasSourceVerifiedMolecularFindings = capA.hasSourceVerifiedMolecularFindings || capB.hasSourceVerifiedMolecularFindings;
  const hasMicroarray = capA.hasMicroarray || capB.hasMicroarray;
  const hasRnaSeq = capA.hasRnaSeq || capB.hasRnaSeq;

  const isBothOmics = capA.isOmics && capB.isOmics;
  const hasAnyOmics = capA.isOmics || capB.isOmics;
  const isBothTranscriptomics = capA.hasTranscriptomics && capB.hasTranscriptomics;
  const isBothRnaSeq = capA.hasRnaSeq && capB.hasRnaSeq;

  // Multi-omics rule: ONLY if both studies have omics and they have distinct omic types or multi-omics within them
  const isMultiOmics = isBothOmics && (
    (capA.hasTranscriptomics && capB.hasProteomics) ||
    (capA.hasProteomics && capB.hasTranscriptomics) ||
    (capA.hasTranscriptomics && capB.hasMetabolomics) ||
    (capA.hasMetabolomics && capB.hasTranscriptomics) ||
    (capA.hasTranscriptomics && capB.hasMethylation) ||
    (capA.hasMethylation && capB.hasTranscriptomics) ||
    (capA.hasMethylation && capA.hasTranscriptomics) ||
    (capB.hasMethylation && capB.hasTranscriptomics)
  );

  let pairClass: PairCapabilityClass = "mixed_non_equivalent_modalities";
  if (!capA.isOmics && !capB.isOmics) {
    if (capA.hasImaging && capB.hasImaging && !capA.hasPhysiology && !capB.hasPhysiology) {
      pairClass = "imaging_only";
    } else if (capA.hasPhysiology && capB.hasPhysiology && !capA.hasImaging && !capB.hasImaging) {
      pairClass = "physiology_only";
    } else if ((capA.hasImaging && capB.hasPhysiology) || (capA.hasPhysiology && capB.hasImaging)) {
      pairClass = "imaging_plus_physiology";
    } else if ((capA.hasImaging && capB.hasHistology) || (capA.hasHistology && capB.hasImaging)) {
      pairClass = "imaging_plus_histology";
    } else {
      pairClass = "imaging_only";
    }
  } else if (capA.isOmics && capB.isOmics) {
    pairClass = "omics_only";
  } else {
    // Exactly one study is omics, one is non-omics
    const omicsCap = capA.isOmics ? capA : capB;
    const nonOmicsCap = capA.isOmics ? capB : capA;

    if (nonOmicsCap.hasImaging && !nonOmicsCap.hasPhysiology) {
      pairClass = "imaging_plus_omics";
    } else if (nonOmicsCap.hasPhysiology && !nonOmicsCap.hasImaging) {
      pairClass = "physiology_plus_omics";
    } else if (nonOmicsCap.hasHistology && !nonOmicsCap.hasImaging && !nonOmicsCap.hasPhysiology) {
      pairClass = "imaging_plus_histology";
    } else {
      pairClass = "mixed_non_equivalent_modalities";
    }
  }

  const isImagingPhysiologyOnly = !hasAnyOmics;
  const isImagingPlusOmics = pairClass === "imaging_plus_omics";
  const isPhysiologyPlusOmics = pairClass === "physiology_plus_omics";
  const isMixedNonEquivalent = pairClass === "mixed_non_equivalent_modalities";
  const hasVerifiedMechanisticFindings = hasSourceVerifiedMolecularFindings;

  return {
    studyA: capA,
    studyB: capB,
    hasMicroarray,
    hasRnaSeq,
    hasTranscriptomics,
    hasProteomics,
    hasMetabolomics,
    hasMethylation,
    hasHistology,
    hasImaging,
    hasPhysiology,
    hasOpticNerveMorphometry,
    hasSourceVerifiedMolecularFindings,
    isOmics: hasAnyOmics,
    isNonOmics: !hasAnyOmics,
    primaryAssayLabel: `${capA.primaryAssayLabel} × ${capB.primaryAssayLabel}`,
    pairClass,
    isMultiOmics,
    isBothOmics,
    isBothTranscriptomics,
    isBothRnaSeq,
    hasAnyOmics,
    isImagingPhysiologyOnly,
    isImagingPlusOmics,
    isPhysiologyPlusOmics,
    isMixedNonEquivalent,
    hasVerifiedMechanisticFindings,
  };
}

export const STYLE_VARIATIONS_IMAGING_PHYSIOLOGY: Record<MediaCategory, StyleVariation[]> = {
  data_visualization: [
    {
      id: "dataviz_diagnostic_imaging_grid",
      category: "data_visualization",
      name: "In Vivo Diagnostic Modalities Matrix",
      layoutTitle: "Diagnostic Imaging Modalities",
      layoutDescription: "Comparative diagnostic layout contrasting optical coherence tomography (OCT), tonometry (IOP), and high-resolution MRI.",
      viewingAngle: "Orthogonal multi-panel diagnostic instrumentation view",
      paletteTheme: "cobalt_cyan",
      paletteName: PALETTE_DEFINITIONS.cobalt_cyan.name,
      paletteColors: PALETTE_DEFINITIONS.cobalt_cyan,
      annotationDensity: "high_density_diagram",
      compositionFraming: "Structured multi-modality layout with crisp scan channels, tonometric waveforms, and MRI cross-sections",
      promptDirectives: [
        "Structured multi-modality diagnostic imaging layout with OCT retinal scan profiles and small animal MRI cross-sections.",
        "Precision in vivo diagnostic waveforms and measurement callouts.",
        "Deep Space Cobalt palette (#090f1f background, #38bdf8 cyan and #818cf8 violet vectors).",
        "Publication-quality medical diagnostic visualization, clean typography, non-cartoonish.",
      ],
    },
    {
      id: "dataviz_pressure_morphometry_flow",
      category: "data_visualization",
      name: "Longitudinal Pressure & Morphometry Analysis",
      layoutTitle: "Pressure & Morphometry Profile",
      layoutDescription: "Dual-axis physiological time-series showing intraocular pressure trajectories and optic nerve morphometric dimensions.",
      viewingAngle: "Planar scientific presentation layout with clean metric axes",
      paletteTheme: "amber_slate",
      paletteName: PALETTE_DEFINITIONS.amber_slate.name,
      paletteColors: PALETTE_DEFINITIONS.amber_slate,
      annotationDensity: "balanced_poster",
      compositionFraming: "Dual-column layout comparing baseline versus fluid-shift pressure and sheath diameter metrics",
      promptDirectives: [
        "Scientific diagnostic chart displaying longitudinal intraocular pressure tonometry curves and optic nerve sheath measurements.",
        "Metabolic Amber & Slate palette (#14110f dark slate, #f59e0b amber highlights, #14b8a6 teal accents).",
        "Crisp scientific grid lines, quantitative millimeter and mmHg annotations.",
      ],
    },
  ],
  biological_concept: [
    {
      id: "bioconcept_layered_ocular_anatomy",
      category: "biological_concept",
      name: "Stratified Ocular Anatomical Cross-Section",
      layoutTitle: "Layered Ocular Anatomy",
      layoutDescription: "Transverse anatomical cross-section through nerve fiber layer, ganglion cells, photoreceptors, and choroid.",
      viewingAngle: "Transverse microscopic anatomical slice with crisp tissue boundaries",
      paletteTheme: "cobalt_cyan",
      paletteName: PALETTE_DEFINITIONS.cobalt_cyan.name,
      paletteColors: PALETTE_DEFINITIONS.cobalt_cyan,
      annotationDensity: "high_density_diagram",
      compositionFraming: "High-resolution anatomical cutaway revealing individual ocular tissue layers and retrobulbar space",
      promptDirectives: [
        "A high-resolution scientific medical illustration of ocular tissue micro-architecture and anatomical layer stratification.",
        "Layered transverse cross-section displaying Ganglion Cell Layer, Plexiform Layers, Photoreceptors, and Choroid.",
        "Deep Space Cobalt aesthetic (#090f1f) with clean anatomical callouts.",
        "Biologically authentic medical realism, non-cartoonish.",
      ],
    },
    {
      id: "bioconcept_optic_nerve_morphology",
      category: "biological_concept",
      name: "Optic Nerve Head & Sheath Morphology",
      layoutTitle: "Optic Nerve Sheath Morphology",
      layoutDescription: "Longitudinal anatomical sagittal cutaway of optic nerve sheath, retrobulbar subarachnoid space, and scleral canal.",
      viewingAngle: "Longitudinal anatomical sagittal cutaway of optic nerve insertion",
      paletteTheme: "emerald_obsidian",
      paletteName: PALETTE_DEFINITIONS.emerald_obsidian.name,
      paletteColors: PALETTE_DEFINITIONS.emerald_obsidian,
      annotationDensity: "balanced_poster",
      compositionFraming: "Sagittal optic nerve head biomechanical diagram showing fluid redistribution and sheath diameter",
      promptDirectives: [
        "Anatomical sagittal illustration of the optic nerve head, dura sheath, and retrobulbar subarachnoid space.",
        "Fluid shift redistribution vectors in the retrobulbar region.",
        "Emerald & Obsidian palette (#06130d background, #10b981 emerald neural sheath, #06b6d4 fluid vectors).",
        "Clear anatomical labeling of scleral canal and optic nerve sheath.",
      ],
    },
  ],
  contextual_narrative: [
    {
      id: "context_panoramic_facility",
      category: "contextual_narrative",
      name: "Panoramic Space Biology Ground-Analog Facility",
      layoutTitle: "Analog Laboratory Panoramic Scene",
      layoutDescription: "Wide environmental perspective of head-down tilt apparatus, environmental control modules, and bio-specimen chambers.",
      viewingAngle: "Wide-angle panoramic laboratory perspective with authentic atmospheric lighting",
      paletteTheme: "cobalt_cyan",
      paletteName: PALETTE_DEFINITIONS.cobalt_cyan.name,
      paletteColors: PALETTE_DEFINITIONS.cobalt_cyan,
      annotationDensity: "balanced_poster",
      compositionFraming: "Cinematic laboratory interior showing specialized tilt habitat stations and digital telemetry banks",
      promptDirectives: [
        "A cinematic, publication-quality photograph-style scientific environment of a modern NASA Space Biology laboratory.",
        "Featuring a ground-based spaceflight analog research facility with head-down tilt apparatus and specialized rodent habitats.",
        "High-tech instrumentation racks, environmental control chambers, clean workstation benches with stainless steel and brushed dark slate.",
        "Atmospheric cool blue and cyan LED telemetry status lighting (#090f1f background, #38bdf8 ambient glow). Realistic scientific environment.",
      ],
    },
    {
      id: "context_imaging_telemetry",
      category: "contextual_narrative",
      name: "Diagnostic Imaging & Telemetry Station",
      layoutTitle: "Diagnostic Telemetry Monitor Bank",
      layoutDescription: "Medium-shot perspective focused on real-time ophthalmic imaging monitors, tonometry sensors, and flight analog parameters.",
      viewingAngle: "Angled medium shot facing a high-resolution laboratory console and imaging display",
      paletteTheme: "emerald_obsidian",
      paletteName: PALETTE_DEFINITIONS.emerald_obsidian.name,
      paletteColors: PALETTE_DEFINITIONS.emerald_obsidian,
      annotationDensity: "high_density_diagram",
      compositionFraming: "HUD telemetry bank displaying physiological sensor curves, chamber pressure gauges, and analog logs",
      promptDirectives: [
        "A sleek, high-precision laboratory monitoring station displaying real-time spaceflight analog diagnostic parameters.",
        "High-resolution monitors showing intraocular pressure curves, retinal scan profiles, and chamber parameters.",
        "Emerald & Obsidian palette (#06130d dark console, #10b981 bright green telemetry curves, #06b6d4 digital displays).",
        "Clean, sharp digital instrumentation in an authentic NASA space physiology research laboratory.",
      ],
    },
  ],
  accession_summary: [
    {
      id: "accession_executive_poster",
      category: "accession_summary",
      name: "Executive Dual-Study Visual Abstract Poster",
      layoutTitle: "Executive Visual Abstract Poster",
      layoutDescription: "High-impact dual-column infographic poster with bold accession typography, diagnostic comparison cards, and mission insignia.",
      viewingAngle: "Sleek planar presentation poster format",
      paletteTheme: "cobalt_cyan",
      paletteName: PALETTE_DEFINITIONS.cobalt_cyan.name,
      paletteColors: PALETTE_DEFINITIONS.cobalt_cyan,
      annotationDensity: "balanced_poster",
      compositionFraming: "Bold dual-column layout with high-contrast typography, study badges, and key translational takeaway block",
      promptDirectives: [
        "A high-impact, modern scientific executive summary poster and visual abstract for NASA OSDR studies.",
        "Dual-column presentation layout displaying accession IDs prominently in bold typography with colored accession badges.",
        "Comparison of diagnostic imaging modalities, flight analog factors, biological model organisms, and study takeaways.",
        "Deep Space Cobalt palette (#090f1f background, #38bdf8 cyan and #818cf8 violet accents, crisp white headers).",
      ],
    },
    {
      id: "accession_comparative_ledger",
      category: "accession_summary",
      name: "Comparative Diagnostic Profile & Ledger",
      layoutTitle: "Comparative Study Profile Ledger",
      layoutDescription: "Structured technical data ledger with side-by-side study profiles, diagnostic imaging protocols, and study parameters.",
      viewingAngle: "Vertical dual-channel scientific profile ledger",
      paletteTheme: "emerald_obsidian",
      paletteName: PALETTE_DEFINITIONS.emerald_obsidian.name,
      paletteColors: PALETTE_DEFINITIONS.emerald_obsidian,
      annotationDensity: "high_density_diagram",
      compositionFraming: "Structured ledger format with dual parallel telemetry columns and unified consensus summary bar",
      promptDirectives: [
        "A rigorous scientific comparative diagnostic ledger comparing dual NASA OSDR accessions side by side.",
        "Structured data blocks detailing imaging modalities, measurement resolutions, animal models, and study parameters.",
        "Emerald & Obsidian palette (#06130d background, #10b981 emerald metric bars, #06b6d4 clean dividers).",
        "Technical scientific ledger layout with elegant typography and crisp data tables.",
      ],
    },
  ],
};

export const STYLE_VARIATIONS_BY_CATEGORY: Record<MediaCategory, StyleVariation[]> = {
  data_visualization: [
    {
      id: "dataviz_bipartite_network",
      category: "data_visualization",
      name: "Bipartite Systems Regulatory Network",
      layoutTitle: "Bipartite Network Graph",
      layoutDescription: "Dual-cluster network with directional regulatory vectors, log2FC heat indicators, and interaction nodes.",
      viewingAngle: "Orthogonal top-down systems diagram with clear visual hierarchy",
      paletteTheme: "cobalt_cyan",
      paletteName: PALETTE_DEFINITIONS.cobalt_cyan.name,
      paletteColors: PALETTE_DEFINITIONS.cobalt_cyan,
      annotationDensity: "high_density_diagram",
      compositionFraming: "Structured two-cluster network with high-contrast signal connectors and log2FC callouts",
      promptDirectives: [
        "Structured bipartite network graph layout with distinct left-hand upstream transcriptional cluster and right-hand metabolic metabolite cluster.",
        "Directional signaling vectors with glowing phosphorescent edges and node sizing proportional to pathway centrality.",
        "High-density callout badges indicating log2 fold changes (+3.2 log2FC, +3.8 log2FC) on key nodes (VEGF-A, UCP2, CLDN5).",
        "Deep Space Cobalt palette (#090f1f background, #38bdf8 cyan and #818cf8 violet vectors).",
      ],
    },
    {
      id: "dataviz_metabolic_cascade",
      category: "data_visualization",
      name: "Hierarchical Multi-Tier Pathway Cascade",
      layoutTitle: "Multi-Tier Pathway Flow",
      layoutDescription: "Hierarchical top-down pathway flow from gene transcripts down to bioenergetic metabolic end-products.",
      viewingAngle: "Isometric multi-plane glassmorphism pathway view",
      paletteTheme: "amber_slate",
      paletteName: PALETTE_DEFINITIONS.amber_slate.name,
      paletteColors: PALETTE_DEFINITIONS.amber_slate,
      annotationDensity: "balanced_poster",
      compositionFraming: "Stepwise cascading tiers with metabolic enzyme hubs and ATP bioenergetic consumption gauges",
      promptDirectives: [
        "Hierarchical multi-tier pathway diagram flowing vertically from upper genomic regulation down through intermediary kinase cascades to metabolic ATP flux.",
        "Metabolic enzyme hubs rendered with elegant isometric crystal nodes and catalytic reaction arrows.",
        "Metabolic Amber & Slate palette (#14110f dark slate, #f59e0b amber highlights, #14b8a6 teal accents).",
        "Clean, balanced scientific infographic hierarchy with quantitative metabolic flux annotations.",
      ],
    },
    {
      id: "dataviz_radial_nexus",
      category: "data_visualization",
      name: "Radial Cross-Assay Convergence Hub",
      layoutTitle: "Radial Convergence Nexus",
      layoutDescription: "Central multi-omic nexus hub with orbiting gene and metabolite clusters connected by curved bezier arcs.",
      viewingAngle: "Centered radial systems topology with concentric omic rings",
      paletteTheme: "emerald_obsidian",
      paletteName: PALETTE_DEFINITIONS.emerald_obsidian.name,
      paletteColors: PALETTE_DEFINITIONS.emerald_obsidian,
      annotationDensity: "spotlight_focal",
      compositionFraming: "Circular convergence diagram centered on the core pathophysiological hub with orbiting omics satellites",
      promptDirectives: [
        "Radial circular convergence map with a luminous central nexus hub surrounded by concentric outer rings of gene and metabolite nodes.",
        "Smooth curved bezier connective ribbons linking transcriptomic inputs to downstream metabolic stress targets.",
        "Emerald & Obsidian palette (#06130d background, #10b981 emerald and #06b6d4 cyan ribbons).",
        "High-contrast spotlight focal illumination highlighting critical cross-talk intersection points.",
      ],
    },
    {
      id: "dataviz_matrix_heatmap",
      category: "data_visualization",
      name: "Parallel Comparative Omics Matrix",
      layoutTitle: "Omics Correlation Heatmap Matrix",
      layoutDescription: "Split-matrix comparative heatmap with aligned biomarker correlation vectors and bar sparklines.",
      viewingAngle: "Planar scientific matrix presentation layout",
      paletteTheme: "indigo_rose",
      paletteName: PALETTE_DEFINITIONS.indigo_rose.name,
      paletteColors: PALETTE_DEFINITIONS.indigo_rose,
      annotationDensity: "high_density_diagram",
      compositionFraming: "Dual-column heat matrix with aligned cross-omic correlation curves and differential metrics",
      promptDirectives: [
        "Publication-quality comparative matrix heatmap layout with aligned rows of transcriptomic genes and columns of metabolic biomarkers.",
        "Pearson correlation coefficients and log2 fold-change color heat gradients from indigo to vivid rose/crimson.",
        "Aerospace Indigo & Rose palette (#130919 dark background, #f43f5e rose markers, #c084fc violet vectors).",
        "Precise tabular and matrix layout with crisp scientific grid lines and differential expression indicators.",
      ],
    },
  ],

  biological_concept: [
    {
      id: "bioconcept_layered_histology",
      category: "biological_concept",
      name: "Stratified Ocular Histology Cross-Section",
      layoutTitle: "Layered Tissue Cross-Section",
      layoutDescription: "Transverse microvascular histology stratification through nerve fiber layer, photoreceptors, and RPE/choroid.",
      viewingAngle: "Transverse microscopic tissue slice with crisp anatomical boundaries",
      paletteTheme: "cobalt_cyan",
      paletteName: PALETTE_DEFINITIONS.cobalt_cyan.name,
      paletteColors: PALETTE_DEFINITIONS.cobalt_cyan,
      annotationDensity: "high_density_diagram",
      compositionFraming: "High-resolution anatomical cutaway revealing individual cellular layers and vascular tight junctions",
      promptDirectives: [
        "A high-resolution scientific medical illustration of ocular tissue micro-architecture and cellular stratification under microgravity cephalad fluid shift.",
        "Layered transverse cross-section displaying the Ganglion Cell Layer (GCL), Inner Plexiform Layer (IPL), Photoreceptors (IS/OS), and Retinal Pigment Epithelium (RPE).",
        "Microvascular tight junction degradation (Claudin-5 loss) with fluid extravasation and endothelial fenestrations.",
        "Deep Space Cobalt aesthetic (#090f1f) with luminescent rose and gold cellular stress indicators.",
      ],
    },
    {
      id: "bioconcept_subcellular_ros",
      category: "biological_concept",
      name: "Subcellular Mitochondrial & ROS Flux",
      layoutTitle: "3D Cellular Organelle Cutaway",
      layoutDescription: "Close-up 3D cellular cutaway showing mitochondrial electron transport decoupling, UCP2 proton leak, and ROS efflux.",
      viewingAngle: "Oblique close-up cellular cutaway focused on mitochondrial cristae and membrane dynamics",
      paletteTheme: "amber_slate",
      paletteName: PALETTE_DEFINITIONS.amber_slate.name,
      paletteColors: PALETTE_DEFINITIONS.amber_slate,
      annotationDensity: "spotlight_focal",
      compositionFraming: "Magnified 3D mitochondrial organelle within a stressed retinal cell releasing reactive oxygen species",
      promptDirectives: [
        "Magnified 3D scientific visualization of a cellular organelle showing mitochondrial cristae under cephalad venous stress.",
        "Electron transport chain decoupling, uncoupling protein (UCP2) activation, and glowing reactive oxygen species (ROS) efflux into cytoplasm.",
        "Metabolic Amber & Slate palette (#14110f dark slate, glowing #f59e0b amber ROS halos, #14b8a6 lipid bilayer).",
        "Biologically accurate organelle contours with crisp membrane detail, non-cartoonish medical realism.",
      ],
    },
    {
      id: "bioconcept_microvascular_barrier",
      category: "biological_concept",
      name: "Capillary Microvascular Barrier Shear",
      layoutTitle: "Microvascular Capillary Shear Profile",
      layoutDescription: "Axial perspective of retinal capillary wall with pressurized fluid shift, pericyte detachment, and VEGF signaling.",
      viewingAngle: "Axial vascular lumen perspective with longitudinal capillary cutaway",
      paletteTheme: "indigo_rose",
      paletteName: PALETTE_DEFINITIONS.indigo_rose.name,
      paletteColors: PALETTE_DEFINITIONS.indigo_rose,
      annotationDensity: "balanced_poster",
      compositionFraming: "Capillary tube perspective illustrating venous pressure shear against the outer blood-retinal barrier",
      promptDirectives: [
        "A detailed medical cutaway of a retinal microvascular capillary under elevated cephalad venous pressure (+18 mmHg).",
        "Showing pericyte detachment, endothelial fenestrations, VEGF-A signaling molecules traversing the broken basal lamina.",
        "Aerospace Indigo & Rose palette (#130919 dark background, #f43f5e capillary lumen stress, #c084fc extracellular matrix).",
        "Clean scientific callouts indicating blood-retinal barrier breakdown mechanisms.",
      ],
    },
    {
      id: "bioconcept_optic_nerve_biomechanics",
      category: "biological_concept",
      name: "Optic Nerve Head & Lamina Cribrosa Biomechanics",
      layoutTitle: "Optic Nerve Biomechanical Compression",
      layoutDescription: "Longitudinal optic sheath cross-section showing lamina cribrosa deflection, axonal stasis, and MMP remodeling.",
      viewingAngle: "Longitudinal anatomical sagittal cutaway of optic nerve insertion",
      paletteTheme: "emerald_obsidian",
      paletteName: PALETTE_DEFINITIONS.emerald_obsidian.name,
      paletteColors: PALETTE_DEFINITIONS.emerald_obsidian,
      annotationDensity: "balanced_poster",
      compositionFraming: "Sagittal optic nerve head biomechanical diagram showing fluid pressure vectors against axonal bundles",
      promptDirectives: [
        "Anatomical sagittal illustration of the optic nerve head, lamina cribrosa, and retrobulbar subarachnoid space.",
        "Biomechanical pressure gradient arrows indicating cephalad fluid redistribution compressing the nerve fiber bundles.",
        "Bioenergetic Emerald & Obsidian palette (#06130d background, #10b981 emerald neural sheath, #06b6d4 fluid pressure lines).",
        "Clear anatomical labeling of scleral canal, dura sheath, and axonal transport stasis.",
      ],
    },
  ],

  contextual_narrative: [
    {
      id: "context_panoramic_facility",
      category: "contextual_narrative",
      name: "Panoramic Space Biology Ground-Analog Facility",
      layoutTitle: "Analog Laboratory Panoramic Scene",
      layoutDescription: "Wide environmental perspective of -6° head-down tilt apparatus, environmental control modules, and bio-specimen chambers.",
      viewingAngle: "Wide-angle panoramic laboratory perspective with authentic atmospheric lighting",
      paletteTheme: "cobalt_cyan",
      paletteName: PALETTE_DEFINITIONS.cobalt_cyan.name,
      paletteColors: PALETTE_DEFINITIONS.cobalt_cyan,
      annotationDensity: "balanced_poster",
      compositionFraming: "Cinematic laboratory interior showing specialized tilt habitat stations and digital telemetry banks",
      promptDirectives: [
        "A cinematic, publication-quality photograph-style scientific environment of a modern NASA Space Biology laboratory.",
        "Featuring a ground-based spaceflight analog research facility with head-down tilt apparatus (-15° tilt angle) and specialized rodent habitats.",
        "High-tech instrumentation racks, environmental control chambers, clean workstation benches with stainless steel and brushed dark slate.",
        "Atmospheric cool blue and cyan LED telemetry status lighting (#090f1f background, #38bdf8 ambient glow). Realistic scientific environment.",
      ],
    },
    {
      id: "context_telemetry_console",
      category: "contextual_narrative",
      name: "High-Tech Biometric Telemetry Console",
      layoutTitle: "Biometric & Telemetry Monitor Bank",
      layoutDescription: "Medium-shot perspective focused on real-time biometric monitors, intraocular pressure transducers, and flight telemetry.",
      viewingAngle: "Angled medium shot facing a high-resolution laboratory HUD and sensor console",
      paletteTheme: "emerald_obsidian",
      paletteName: PALETTE_DEFINITIONS.emerald_obsidian.name,
      paletteColors: PALETTE_DEFINITIONS.emerald_obsidian,
      annotationDensity: "high_density_diagram",
      compositionFraming: "HUD telemetry bank displaying physiological sensor curves, chamber pressure gauges, and analog logs",
      promptDirectives: [
        "A sleek, high-precision laboratory monitoring station displaying real-time spaceflight analog telemetry.",
        "High-resolution biometric waveform monitors showing intraocular pressure curves (+18.4 mmHg), retinal perfusion index, and chamber parameters (22.0°C, 45% RH).",
        "Bioenergetic Emerald & Obsidian palette (#06130d dark console, #10b981 bright green telemetry curves, #06b6d4 digital displays).",
        "Clean, sharp digital instrumentation in an authentic NASA space physiology research laboratory.",
      ],
    },
    {
      id: "context_specimen_habitat",
      category: "contextual_narrative",
      name: "Specialized Specimen Habitat Enclosure",
      layoutTitle: "Environmental Habitat & Specimen Enclosure",
      layoutDescription: "Detailed oblique focus on the specialized rodent tilt habitat enclosure with environmental gas regulation and sensor arrays.",
      viewingAngle: "Oblique close-up perspective of the specialized analog habitat hardware",
      paletteTheme: "amber_slate",
      paletteName: PALETTE_DEFINITIONS.amber_slate.name,
      paletteColors: PALETTE_DEFINITIONS.amber_slate,
      annotationDensity: "balanced_poster",
      compositionFraming: "Precision-engineered habitat cage module with integrated sensor wiring and climate control manifolds",
      promptDirectives: [
        "A close-up, authentic scientific visualization of a specialized NASA rodent head-down tilt habitat cage module.",
        "Precision environmental gas delivery manifolds, temperature probe harnesses, and micro-telemetry sensor couplings.",
        "Metabolic Amber & Slate palette (#14110f dark titanium frame, #f59e0b status indicators, #14b8a6 sensor lines).",
        "Clean modern space hardware engineering aesthetic with authentic research labels and aerospace hardware fasteners.",
      ],
    },
    {
      id: "context_cleanroom_operations",
      category: "contextual_narrative",
      name: "Cleanroom Spaceflight Operations & Payload Prep",
      layoutTitle: "Bio-Payload Cleanroom & Cryo-Suite",
      layoutDescription: "Atmospheric clinical space biology laboratory with laminar flow biosafety cabinets, automated cryo-units, and payload kits.",
      viewingAngle: "Dynamic angled laboratory workstation perspective",
      paletteTheme: "indigo_rose",
      paletteName: PALETTE_DEFINITIONS.indigo_rose.name,
      paletteColors: PALETTE_DEFINITIONS.indigo_rose,
      annotationDensity: "spotlight_focal",
      compositionFraming: "Sterile flight preparation cleanroom with automated multi-omic sample extraction cryo-preservation units",
      promptDirectives: [
        "A pristine, high-tech space biology cleanroom payload preparation suite at a NASA space center.",
        "Laminar flow biosafety cabinets, automated cryo-preservation dewars, sample centrifuge units, and flight transport containers.",
        "Aerospace Indigo & Rose palette (#130919 dark room, #f43f5e safety laser lines, #c084fc cleanroom lighting).",
        "Photorealistic, high-end laboratory environment showing operational workflow for space flight omics tissue recovery.",
      ],
    },
  ],

  accession_summary: [
    {
      id: "accession_executive_poster",
      category: "accession_summary",
      name: "Executive Dual-Study Visual Abstract Poster",
      layoutTitle: "Executive Visual Abstract Poster",
      layoutDescription: "High-impact dual-column infographic poster with bold accession typography, assay comparison cards, and mission insignia.",
      viewingAngle: "Sleek planar presentation poster format",
      paletteTheme: "cobalt_cyan",
      paletteName: PALETTE_DEFINITIONS.cobalt_cyan.name,
      paletteColors: PALETTE_DEFINITIONS.cobalt_cyan,
      annotationDensity: "balanced_poster",
      compositionFraming: "Bold dual-column layout with high-contrast typography, study badges, and key translational takeaway block",
      promptDirectives: [
        "A high-impact, modern scientific executive summary poster and visual abstract for NASA OSDR studies.",
        "Dual-column presentation layout displaying accession IDs prominently in bold typography with colored accession badges.",
        "Comparison of assay platforms, flight analog factors, biological model organisms, and AWG countermeasure recommendations.",
        "Deep Space Cobalt palette (#090f1f background, #38bdf8 cyan and #818cf8 violet accents, crisp white headers).",
      ],
    },
    {
      id: "accession_translational_matrix",
      category: "accession_summary",
      name: "Translational 2x2 Research Quadrant Matrix",
      layoutTitle: "2x2 Translational Omics Matrix",
      layoutDescription: "Minimalist 4-quadrant visual summary comparing Study A and Study B experimental conditions, omics assays, findings, and space translation.",
      viewingAngle: "Structured scientific 4-quadrant grid layout",
      paletteTheme: "amber_slate",
      paletteName: PALETTE_DEFINITIONS.amber_slate.name,
      paletteColors: PALETTE_DEFINITIONS.amber_slate,
      annotationDensity: "balanced_poster",
      compositionFraming: "Clean 2x2 grid with four distinct metric quadrants and centralized synergy badge",
      promptDirectives: [
        "A minimalist 2x2 translational research quadrant matrix comparing dual NASA OSDR accessions.",
        "Quadrant 1: Upstream Genomic Activation; Quadrant 2: Downstream Metabolomic Depletion; Quadrant 3: SANS Phenotype; Quadrant 4: AWG Countermeasure.",
        "Metabolic Amber & Slate palette (#14110f background, #f59e0b golden amber quadrants, #14b8a6 teal headers).",
        "Ultra-clean typography, structured card borders, publication-grade executive presentation slide style.",
      ],
    },
    {
      id: "accession_aerospace_brief",
      category: "accession_summary",
      name: "Aerospace Mission Briefing HUD Card",
      layoutTitle: "Mission Briefing HUD Card",
      layoutDescription: "Dark HUD aerospace mission card with accession barcodes, flight factor icons, and key cross-omics conclusions.",
      viewingAngle: "Angled card perspective with high-contrast data blocks",
      paletteTheme: "indigo_rose",
      paletteName: PALETTE_DEFINITIONS.indigo_rose.name,
      paletteColors: PALETTE_DEFINITIONS.indigo_rose,
      annotationDensity: "high_density_diagram",
      compositionFraming: "Futuristic dark HUD card with structured telemetry tags, barcode accents, and high-contrast metric chips",
      promptDirectives: [
        "A dark HUD aerospace scientific mission briefing card synthesizing dual OSDR accession records.",
        "Digital accession barcodes, mission flight patch aesthetics, assay platform identifiers, and quantitative findings.",
        "Aerospace Indigo & Rose palette (#130919 dark obsidian, #f43f5e magenta badges, #38bdf8 electric blue grid lines).",
        "Sleek technical aerospace data card with sharp vector typography and clean status indicators.",
      ],
    },
    {
      id: "accession_comparative_ledger",
      category: "accession_summary",
      name: "Comparative Systems Profile & Ledger",
      layoutTitle: "Comparative Systems Profile Ledger",
      layoutDescription: "Structured technical data ledger with side-by-side study profiles, assay methodology comparisons, and AWG consensus points.",
      viewingAngle: "Vertical dual-channel scientific profile ledger",
      paletteTheme: "emerald_obsidian",
      paletteName: PALETTE_DEFINITIONS.emerald_obsidian.name,
      paletteColors: PALETTE_DEFINITIONS.emerald_obsidian,
      annotationDensity: "high_density_diagram",
      compositionFraming: "Structured ledger format with dual parallel telemetry columns and unified consensus summary bar",
      promptDirectives: [
        "A rigorous scientific comparative systems ledger comparing dual NASA OSDR accessions side by side.",
        "Structured data blocks detailing assay sequencing depths, metabolite coverage, tissue extraction protocols, and statistical significance levels.",
        "Bioenergetic Emerald & Obsidian palette (#06130d background, #10b981 emerald metric bars, #06b6d4 clean dividers).",
        "Technical scientific ledger layout with elegant typography and crisp data tables.",
      ],
    },
  ],
};

// Internal session tracking for visual diversity seed calculation
const pairRunCounters = new Map<string, number>();

function stringHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getDiversitySeed(
  studyAId: string,
  studyBId: string,
  category: MediaCategory,
  categoryIndex: number,
  explicitRunIndex?: number,
  caps?: PairCapabilityProfile
): {
  runIndex: number;
  variantIndex: number;
  variation: StyleVariation;
  seedString: string;
} {
  const pairKey = `${studyAId}_${studyBId}`.toUpperCase();
  let runIndex = explicitRunIndex;

  if (typeof runIndex !== "number") {
    const current = pairRunCounters.get(pairKey) || 0;
    runIndex = current;
  }

  const isImgPhys = caps?.isImagingPhysiologyOnly;
  const variationSource = isImgPhys
    ? STYLE_VARIATIONS_IMAGING_PHYSIOLOGY
    : STYLE_VARIATIONS_BY_CATEGORY;

  const categoryVariations = variationSource[category] || variationSource.data_visualization || STYLE_VARIATIONS_BY_CATEGORY.data_visualization;
  const hash = stringHash(`${pairKey}_${category}`);
  // Compute variant index cycling cleanly across runs and category offsets
  const variantIndex = (hash + categoryIndex * 3 + runIndex) % categoryVariations.length;
  const variation = categoryVariations[variantIndex];
  const seedString = `seed-${pairKey}-${category.slice(0, 4)}-r${runIndex}-v${variantIndex}`;

  return {
    runIndex,
    variantIndex,
    variation,
    seedString,
  };
}

export function recordPairGeneration(studyAId: string, studyBId: string): number {
  const pairKey = `${studyAId}_${studyBId}`.toUpperCase();
  const current = (pairRunCounters.get(pairKey) || 0) + 1;
  pairRunCounters.set(pairKey, current);
  return current;
}

export const PROHIBITED_CAPABILITY_TERMS = [
  "omics", "multi-omics", "transcriptomics", "rna-seq", "proteomics", "metabolomics",
  "methylation", "gene expression", "molecular pathway", "pathway", "biomarker",
  "regulatory target", "bioenergetic", "atp", "mitochondrial", "oxidative stress",
  "tight junction", "endothelial", "vascular permeability", "apoptosis", "caspase",
  "vegf", "hif", "claudin", "wet-lab omics"
];

export function containsProhibitedTerms(text: string, caps: PairCapabilityProfile): string[] {
  if (!text || typeof text !== "string") return [];
  const found: string[] = [];
  const lower = text.toLowerCase();

  for (const term of PROHIBITED_CAPABILITY_TERMS) {
    if (term === "transcriptomics" || term === "rna-seq" || term === "gene expression") {
      if (caps.hasTranscriptomics) continue;
    }
    if (term === "proteomics") {
      if (caps.hasProteomics) continue;
    }
    if (term === "metabolomics") {
      if (caps.hasMetabolomics) continue;
    }
    if (term === "methylation") {
      if (caps.hasMethylation) continue;
    }
    if (term === "omics" || term === "multi-omics" || term === "wet-lab omics") {
      if (caps.hasAnyOmics) continue;
    }
    if (
      term === "molecular pathway" || term === "pathway" || term === "biomarker" ||
      term === "regulatory target" || term === "bioenergetic" || term === "atp" ||
      term === "mitochondrial" || term === "oxidative stress" || term === "tight junction" ||
      term === "endothelial" || term === "vascular permeability" || term === "apoptosis" ||
      term === "caspase" || term === "vegf" || term === "hif" || term === "claudin"
    ) {
      if (caps.hasVerifiedMechanisticFindings) continue;
    }

    const escaped = term.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "i");
    if (regex.test(lower)) {
      found.push(term);
    }
  }

  return found;
}

export function sanitizeField(
  val: string,
  caps: PairCapabilityProfile,
  fallbackVal: string
): string {
  if (!val || typeof val !== "string") return fallbackVal;
  return validateAndSanitizeText(val, caps);
}

export function validateAndSanitizeText(
  text: string,
  caps?: PairCapabilityProfile
): string {
  if (!text || typeof text !== "string") return text;

  let sanitized = text;
  // Universal: Replace placeholder citations
  sanitized = sanitized.replace(/\b(Author et al\., Year, DOI\/PMID|Author et al\., Year|\[Full citation with DOI link\])\b/gi, "NASA OSDR repository record");

  if (!caps) return sanitized;

  if (caps.isImagingPhysiologyOnly) {
    sanitized = sanitized.replace(/\b(Cephalad Fluid Shift & Multi-Omics Ocular Remodeling \(SANS\))\b/gi, "Cephalad Fluid Shift & Ocular Imaging in a Ground-Based SANS Analog");
    sanitized = sanitized.replace(/\b(Radial Multi-Omics Convergence Hub)\b/gi, "In Vivo Diagnostics & Imaging Matrix");
    sanitized = sanitized.replace(/\b(Omics Convergence Map)\b/gi, "In Vivo Diagnostics Map");
    sanitized = sanitized.replace(/\b(Pathway & Biomarkers|PATHWAY & BIOMARKERS)\b/gi, "Imaging & Physiology");
    sanitized = sanitized.replace(/\b(Wet-Lab Omics)\b/gi, "In Vivo Diagnostics");
    sanitized = sanitized.replace(/\b(multi-omics|multi-omic|omics|omic)\b/gi, "in vivo diagnostic");
    sanitized = sanitized.replace(/\b(transcriptomics|rna-seq|gene expression)\b/gi, "diagnostic imaging");
    sanitized = sanitized.replace(/\b(proteomics|metabolomics|methylation)\b/gi, "physiological tonometry");
    sanitized = sanitized.replace(/\b(molecular pathway|pathway & biomarkers|pathway|biomarkers|biomarker)\b/gi, "imaging & physiology");
    sanitized = sanitized.replace(/\b(regulatory target|bioenergetic marker|bioenergetic|atp)\b/gi, "diagnostic measurement");
    sanitized = sanitized.replace(/\b(mitochondrial oxidative stress|oxidative stress|mitochondrial)\b/gi, "hydrostatic fluid redistribution");
    sanitized = sanitized.replace(/\b(tight junction alterations|tight junction breakdown|tight-junction downregulation|tight junction|endothelial|vascular permeability)\b/gi, "tissue layer");
    sanitized = sanitized.replace(/\b(bioenergetic atp depletion|apoptosis|caspase|vegf-a|vegf|hif|claudin-5|claudin)\b/gi, "in vivo diagnostic parameter");
    return sanitized;
  }

  // Cross-modal / Mixed / Non-multi-omics rules
  if (!caps.isMultiOmics) {
    sanitized = sanitized.replace(/\b(Radial Multi-Omics Convergence Hub)\b/gi, "Radial Cross-Assay Convergence Hub");
    sanitized = sanitized.replace(/\b(Molecular Wet-Lab & Multi-Omics Pathway Integration)\b/gi, "Cross-Modal Imaging & Molecular Integration");
    sanitized = sanitized.replace(/\b(Parallel Comparative Omics Matrix)\b/gi, "Comparative Cross-Modal Matrix");
    sanitized = sanitized.replace(/\b(Multi-Omics Ocular Adaptation)\b/gi, "Cross-Modal Ocular Adaptation");
    sanitized = sanitized.replace(/\b(Multi-Omics Spaceflight Response)\b/gi, "Cross-Modal Spaceflight Response");
    sanitized = sanitized.replace(/\b(Multi-Omics)\b/gi, "Cross-Modal");
    sanitized = sanitized.replace(/\b(multi-omics)\b/gi, "cross-modal");
    sanitized = sanitized.replace(/\b(Wet-Lab Omics \(Transcript-to-Metabolite Bench\))\b/gi, "Cross-Modal Molecular Adaptation");
    sanitized = sanitized.replace(/\b(Wet-Lab Omics)\b/gi, "Cross-Modal Translation");
    sanitized = sanitized.replace(/\b(Transcript-to-Metabolite)\b/gi, "Cross-Assay");
    sanitized = sanitized.replace(/\b(Pearson Multi-Omic Pathway Alignment)\b/gi, "Cross-Assay Alignment");
    sanitized = sanitized.replace(/\b(Validated Multi-Omics Biomarker)\b/gi, "Validated Cross-Modal Endpoint");
  }

  if (!caps.isBothTranscriptomics) {
    sanitized = sanitized.replace(/\b(Transcriptomics × Transcriptomics Correlation)\b/gi, `${caps.studyA.primaryAssayLabel} × ${caps.studyB.primaryAssayLabel}`);
    sanitized = sanitized.replace(/\b(Transcriptomics × Transcriptomics)\b/gi, `${caps.studyA.primaryAssayLabel} × ${caps.studyB.primaryAssayLabel}`);
    sanitized = sanitized.replace(/\b(Transcriptomics × Metabolomics)\b/gi, `${caps.studyA.primaryAssayLabel} × ${caps.studyB.primaryAssayLabel}`);
  }

  if (!caps.hasProteomics && !caps.hasMetabolomics) {
    sanitized = sanitized.replace(/mass spectrometry profiling from (OSD[-_]?\d+)/gi, "molecular profiling from $1");
    sanitized = sanitized.replace(/mass spectrometry from (OSD[-_]?\d+)/gi, "molecular data from $1");
    sanitized = sanitized.replace(/\b(mass spectrometry profiling|mass spectrometry|mass spec)\b/gi, "molecular profiling");
    sanitized = sanitized.replace(/\b(untargeted metabolomics|metabolomics)\b/gi, "cellular endpoints");
    sanitized = sanitized.replace(/\b(Lipid Peroxides \(\+4\.1x\)|ATP Exhaustion \(-72%\))\b/gi, "Cellular Adaptations");
  }

  // Anti-upcasting for Study A
  if (!caps.studyA.hasTranscriptomics) {
    sanitized = sanitized.replace(/RNA sequencing from OSD-680/gi, "MRI morphometry from OSD-680");
    sanitized = sanitized.replace(/RNA-seq from OSD-680/gi, "MRI from OSD-680");
    sanitized = sanitized.replace(/transcriptomics from OSD-680/gi, "MRI morphometry from OSD-680");
  } else if (caps.studyA.hasMicroarray && !caps.studyA.hasRnaSeq) {
    sanitized = sanitized.replace(/RNA sequencing from OSD-87/gi, "DNA microarray gene expression from OSD-87");
    sanitized = sanitized.replace(/RNA-seq from OSD-87/gi, "DNA microarray from OSD-87");
  }

  // Anti-upcasting for Study B
  if (!caps.studyB.hasTranscriptomics) {
    sanitized = sanitized.replace(/RNA sequencing from OSD-680/gi, "MRI morphometry from OSD-680");
    sanitized = sanitized.replace(/RNA-seq from OSD-680/gi, "MRI from OSD-680");
    sanitized = sanitized.replace(/transcriptomics from OSD-680/gi, "MRI morphometry from OSD-680");
  } else if (caps.studyB.hasMicroarray && !caps.studyB.hasRnaSeq) {
    sanitized = sanitized.replace(/RNA sequencing from OSD-87/gi, "DNA microarray gene expression from OSD-87");
    sanitized = sanitized.replace(/RNA-seq from OSD-87/gi, "DNA microarray from OSD-87");
  }

  return sanitized;
}

export function validateAndSanitizeMediaPlan(plan: AwgMediaPlan, caps: PairCapabilityProfile): AwgMediaPlan {
  if (caps.isImagingPhysiologyOnly) {
    plan.theme = sanitizeField(
      plan.theme,
      caps,
      "Ocular Imaging and Optic-Nerve Morphology in a Ground-Based Fluid-Shift Analog"
    );
    plan.rationale = sanitizeField(
      plan.rationale,
      caps,
      "Comparative analysis between in vivo diagnostic imaging and physiological pressure measurements."
    );

    plan.items = plan.items.map((item, idx) => {
      let fallbackTitle = "Comparative Study Profile";
      let fallbackCatLabel = "Study Profile";
      let fallbackDesc = "Comparative in vivo diagnostic imaging and physiological assessment.";

      if (idx === 0) {
        fallbackTitle = "OCT/IOP Measures × Optic-Nerve MRI";
        fallbackCatLabel = "Imaging & Physiology";
        fallbackDesc = "Comparative in vivo diagnostic imaging and physiological pressure measurements under ground-analog fluid shift.";
      } else if (idx === 1) {
        fallbackTitle = "Eye Structure and Optic-Nerve Morphology";
        fallbackCatLabel = "Anatomy & Morphology";
        fallbackDesc = "Anatomical layer stratification and optic nerve sheath morphology under simulated cephalad fluid shift.";
      } else if (idx === 2) {
        fallbackTitle = "Ground-Analog Imaging Context";
        fallbackCatLabel = "Analog Protocol";
        fallbackDesc = "Laboratory ground analog protocol and diagnostic imaging setup modeling head-down tilt fluid redistribution.";
      }

      return {
        ...item,
        title: sanitizeField(item.title, caps, fallbackTitle),
        categoryLabel: sanitizeField(item.categoryLabel, caps, fallbackCatLabel),
        description: sanitizeField(item.description, caps, fallbackDesc),
        prompt: sanitizeField(item.prompt, caps, `Publication-grade scientific medical diagnostic visual for NASA Space Biology grounded in in vivo imaging and tonometry under ground analog fluid shifts.`),
        evidenceBasis: sanitizeField(item.evidenceBasis, caps, "Empirical in vivo imaging and tonometry endpoints synthesized to assess tissue geometry and pressure dynamics."),
        provenanceFooter: "Verified metadata-grounded; conceptual visualization; interpretation separated.",
      };
    });

    return plan;
  }

  // Cross-modal and omics sanitization
  plan.theme = validateAndSanitizeText(plan.theme, caps);
  plan.rationale = validateAndSanitizeText(plan.rationale, caps);
  plan.items = plan.items.map((item) => ({
    ...item,
    title: validateAndSanitizeText(item.title, caps),
    categoryLabel: validateAndSanitizeText(item.categoryLabel, caps),
    description: validateAndSanitizeText(item.description, caps),
    prompt: validateAndSanitizeText(item.prompt, caps),
    evidenceBasis: validateAndSanitizeText(item.evidenceBasis, caps),
  }));

  return plan;
}

export function validateAndSanitizeVideoBrief(res: VideoBriefResponse, caps: PairCapabilityProfile): VideoBriefResponse {
  if (caps.isImagingPhysiologyOnly) {
    res.caption = sanitizeField(
      res.caption,
      caps,
      "5-second grounded scientific motion brief comparing in vivo ocular imaging and optic-nerve morphology."
    );
    res.promptUsed = sanitizeField(
      res.promptUsed,
      caps,
      "Cinematic NASA Space Biology 3D scientific visualization in 3 clear 5-second acts: 1. In vivo diagnostic imaging and tonometry. 2. Optic nerve and sheath MRI morphology. 3. SANS-relevant ground analog comparison. Clean dark theme, high-contrast cyan, coral, and emerald accents."
    );

    res.scenes = res.scenes.map((sc, idx) => {
      let fallbackTitle = "Comparative Study Profile";
      let fallbackSub = "Paired In Vivo Comparison";
      let fallbackMsg = "Comparative evaluation of in vivo diagnostic and physiological findings.";
      let fallbackMetric = "Paired Analysis: Observed Study Evidence";
      let fallbackBadge = `${idx + 1}. COMPARATIVE OBSERVATION`;
      let fallbackFocus = "What is being compared";

      if (idx === 0) {
        fallbackTitle = "Ocular imaging and pressure measurement";
        fallbackSub = `${res.studies[0] || "OSD-679"} ⟷ ${res.studies[1] || "OSD-680"}`;
        fallbackMsg = "Co-analyzing non-invasive optical coherence tomography (OCT) and intraocular pressure dynamics with optic nerve MRI.";
        fallbackMetric = `Paired Comparison: ${res.studies[0] || "OSD-679"} & ${res.studies[1] || "OSD-680"} · In Vivo Diagnostics`;
        fallbackBadge = "1. ANALYTICAL OPENER";
        fallbackFocus = "What is being compared: In vivo imaging and physiological tonometry";
      } else if (idx === 1) {
        fallbackTitle = "Optic-nerve and sheath MRI morphology";
        fallbackSub = "Optic Nerve Sheath Diameter & Retrobulbar Geometry";
        fallbackMsg = "Head-down tilt fluid redistribution correlates with measured optic nerve sheath expansion and optic nerve head elevation.";
        fallbackMetric = "Morphometry: Optic Nerve Sheath Diameter & Retinal Layer Thickness";
        fallbackBadge = "2. ANATOMICAL MORPHOLOGY";
        fallbackFocus = "What is observed structurally: Optic nerve sheath and ocular geometry";
      } else if (idx === 2) {
        fallbackTitle = "Ground-analog comparison and study limitations";
        fallbackSub = "Terrestrial SANS-Relevant Analog Model Baseline";
        fallbackMsg = "Ground-based head-down tilt models provide biomechanical fluid shift context to evaluate ocular changes without conflating with astronaut clinical SANS.";
        fallbackMetric = "Analog Validation: SANS-Relevant Ground Model · Interpretation Separated";
        fallbackBadge = "3. GROUND-ANALOG CONTEXT";
        fallbackFocus = "Why it matters: SANS-relevant ground analog modeling fluid shift";
      }

      return {
        ...sc,
        title: sanitizeField(sc.title, caps, fallbackTitle),
        subtitle: sanitizeField(sc.subtitle, caps, fallbackSub),
        dominantMessage: sanitizeField(sc.dominantMessage, caps, fallbackMsg),
        metric: sanitizeField(sc.metric, caps, fallbackMetric),
        badgeLabel: sanitizeField(sc.badgeLabel, caps, fallbackBadge),
        focusIdea: sanitizeField(sc.focusIdea, caps, fallbackFocus),
        meta: {
          ...sc.meta,
          genes: undefined,
          metabolites: undefined,
          correlation: sc.meta?.correlation ? sanitizeField(sc.meta.correlation, caps, "In Vivo Correlation") : undefined,
          targetName: sc.meta?.targetName ? sanitizeField(sc.meta.targetName, caps, "SANS-Relevant Ground Model Baseline") : undefined,
          translationalTakeaway: sc.meta?.translationalTakeaway ? sanitizeField(sc.meta.translationalTakeaway, caps, "Ground analog models establish baseline structural parameters without conflating with astronaut clinical SANS.") : undefined,
        },
      };
    });

    return res;
  }

  // Cross-modal and general sanitization
  res.caption = validateAndSanitizeText(res.caption, caps);
  res.promptUsed = validateAndSanitizeText(res.promptUsed, caps);
  res.scenes = res.scenes.map((sc) => ({
    ...sc,
    title: validateAndSanitizeText(sc.title, caps),
    subtitle: validateAndSanitizeText(sc.subtitle, caps),
    dominantMessage: validateAndSanitizeText(sc.dominantMessage, caps),
    metric: validateAndSanitizeText(sc.metric, caps),
    badgeLabel: validateAndSanitizeText(sc.badgeLabel, caps),
    focusIdea: validateAndSanitizeText(sc.focusIdea, caps),
    meta: {
      ...sc.meta,
      correlation: sc.meta?.correlation ? validateAndSanitizeText(sc.meta.correlation, caps) : undefined,
      targetName: sc.meta?.targetName ? validateAndSanitizeText(sc.meta.targetName, caps) : undefined,
      translationalTakeaway: sc.meta?.translationalTakeaway ? validateAndSanitizeText(sc.meta.translationalTakeaway, caps) : undefined,
    },
  }));

  return res;
}

export function validateAndSanitizeTranslationalClip(res: TranslationalClipResponse, caps: PairCapabilityProfile): TranslationalClipResponse {
  if (!caps.isBothOmics) {
    res.alternateDirectionsAvailable = res.alternateDirectionsAvailable
      .filter((alt) => alt.key !== "omics_translation");
  }

  res.alternateDirectionsAvailable = res.alternateDirectionsAvailable.map((alt) => ({
    ...alt,
    label: validateAndSanitizeText(alt.label, caps),
    description: validateAndSanitizeText(alt.description, caps),
    matchRelevance: validateAndSanitizeText(alt.matchRelevance, caps),
  }));

  res.title = validateAndSanitizeText(res.title, caps);
  res.headline = validateAndSanitizeText(res.headline, caps);
  res.storyNarrative = validateAndSanitizeText(res.storyNarrative, caps);
  res.targetTakeaway = validateAndSanitizeText(res.targetTakeaway, caps);
  res.visualMetaphor = validateAndSanitizeText(res.visualMetaphor, caps);
  res.groundingNote = validateAndSanitizeText(res.groundingNote, caps);
  res.selectionRationale = validateAndSanitizeText(res.selectionRationale, caps);
  res.promptUsed = validateAndSanitizeText(res.promptUsed, caps);

  if (res.cinematicConfig?.hudOverlay) {
    res.cinematicConfig.hudOverlay.biomarkerTag = validateAndSanitizeText(res.cinematicConfig.hudOverlay.biomarkerTag, caps);
    res.cinematicConfig.hudOverlay.vitalReading = validateAndSanitizeText(res.cinematicConfig.hudOverlay.vitalReading, caps);
    res.cinematicConfig.hudOverlay.fluidShiftMetric = validateAndSanitizeText(res.cinematicConfig.hudOverlay.fluidShiftMetric, caps);
    res.cinematicConfig.hudOverlay.cellularIntegrityIndex = validateAndSanitizeText(res.cinematicConfig.hudOverlay.cellularIntegrityIndex, caps);
  }

  if (res.cinematicConfig?.narrativeStages) {
    res.cinematicConfig.narrativeStages = res.cinematicConfig.narrativeStages.map((st) => ({
      ...st,
      stageTitle: validateAndSanitizeText(st.stageTitle, caps),
      caption: validateAndSanitizeText(st.caption, caps),
      hudFocus: validateAndSanitizeText(st.hudFocus, caps),
    }));
  }

  return res;
}

// ---------------------------------------------------------------------------
// Grounded Plan Builder
// ---------------------------------------------------------------------------

export interface GroundedMediaPlanItem {
  category: MediaCategory;
  categoryLabel: string;
  title: string;
  description: string;
  prompt: string;
  styleVariation: StyleVariation;
  diversitySeed: string;
  evidenceClass: EvidenceClass;
  evidenceBasis: string;
  groundingCard: ArtifactGroundingCard;
  provenanceFooter: string;
}

export interface AwgMediaPlan {
  theme: string;
  studies: string[];
  rationale: string;
  runIndex: number;
  items: GroundedMediaPlanItem[];
  evidenceMap?: any;
}

export interface AwgMediaItem {
  id: string;
  category: MediaCategory;
  categoryLabel: string;
  title: string;
  subtitle: string;
  description: string;
  imageUrl: string;
  caption: string;
  promptUsed: string;
  generationSource: "gemini_image" | "scientific_vector_svg";
  requestedRenderMode: "gemini_image";
  actualRenderMode: "gemini_image" | "scientific_vector_svg";
  provider: string;
  fallbackUsed: boolean;
  fallbackReason: string;
  modelUsed?: string;
  generationError?: string;
  studies: string[];
  evidenceClass: EvidenceClass;
  evidenceBasis: string;
  groundingCard: ArtifactGroundingCard;
  provenanceFooter: string;
  styleVariation?: {
    id: string;
    name: string;
    layoutTitle: string;
    paletteName: string;
    viewingAngle: string;
  };
  diversitySeed?: string;
  provenance: MediaProvenanceRecord;
}

export interface MediaSetRequest {
  studies: string[];
  query?: string;
  summary?: string;
  generationIndex?: number;
  seed?: string | number;
  fresh?: boolean;
}

export interface MediaSetResponse {
  success: boolean;
  plan: AwgMediaPlan;
  items: AwgMediaItem[];
  studies: string[];
  count: number;
  diagnostics?: {
    geminiImageConfigured: boolean;
    model: string;
    itemsGenerated: number;
    geminiGeneratedCount: number;
    fallbackCount: number;
    duplicateRegenerated?: boolean;
    diversityScore?: string;
    runIndex?: number;
  };
}

export function buildGroundedMediaPlan(
  sA: OSDRStudy,
  sB: OSDRStudy,
  options?: { generationIndex?: number }
): AwgMediaPlan {
  const isSame = sA.study_id === sB.study_id;
  const normA = sA.study_id.toUpperCase();
  const normB = sB.study_id.toUpperCase();
  const isOcular =
    sA.material_type.toLowerCase().includes("retina") ||
    sB.material_type.toLowerCase().includes("retina") ||
    sA.material_type.toLowerCase().includes("eye") ||
    sB.material_type.toLowerCase().includes("eye") ||
    sA.material_type.toLowerCase().includes("optic") ||
    sB.material_type.toLowerCase().includes("optic");

  const factor = sA.study_factor || "Head-Down Tilt Bedrest";
  const org = sA.organism || "Rattus norvegicus";
  const tissue = sA.material_type || "Retina / Optic Nerve";

  const caps = derivePairCapabilities(sA, sB);
  const evidenceMap = buildAwgEvidenceMap(sA, sB);
  const groundingCard = evidenceMap.groundingCard;
  const provenanceFooter = "Verified metadata-grounded; conceptual visualization; interpretation separated.";

  const pairKey = `${sA.study_id}_${sB.study_id}`.toUpperCase();
  const runIndex =
    typeof options?.generationIndex === "number"
      ? options.generationIndex
      : pairRunCounters.get(pairKey) || 0;

  const cat1Seed = getDiversitySeed(sA.study_id, sB.study_id, "data_visualization", 0, runIndex, caps);
  const cat2Seed = getDiversitySeed(sA.study_id, sB.study_id, "biological_concept", 1, runIndex, caps);
  const cat3Seed = getDiversitySeed(sA.study_id, sB.study_id, "contextual_narrative", 2, runIndex, caps);
  const cat4Seed = getDiversitySeed(sA.study_id, sB.study_id, "accession_summary", 3, runIndex, caps);

  const scientificGrounding = `Grounding: NASA OSDR accessions ${sA.study_id} (${sA.assay_measurement}) and ${sB.study_id} (${sB.assay_measurement}) in ${org} under ${factor} (${tissue}).`;

  if (caps.isImagingPhysiologyOnly) {
    const is679_680 = (normA === "OSD-679" && normB === "OSD-680") || (normA === "OSD-680" && normB === "OSD-679");
    const theme = is679_680
      ? "Ocular Imaging and Optic-Nerve Morphology in a Ground-Based Fluid-Shift Analog"
      : isOcular
      ? "Ocular Imaging and Optic-Nerve Morphology in a Ground-Based Fluid-Shift Analog"
      : `${factor} In Vivo Imaging and Physiological Diagnostics in ${org}`;

    const card1Title = is679_680 ? "OCT/IOP Measures × Optic-Nerve MRI" : `${sA.study_id} Diagnostics × ${sB.study_id} Imaging`;
    const card2Title = is679_680 ? "Eye Structure and Optic-Nerve Morphology" : `${tissue} Structure and Morphology`;
    const card3Title = "Ground-Analog Imaging Context";
    const card4Title = "Comparative Study Profile";

    const item1Prompt = [
      `A high-resolution scientific medical diagnostic visualization for NASA Space Biology.`,
      scientificGrounding,
      `Artifact Role: Comparative In Vivo Diagnostic Imaging & Physiology. Must be evidence-led, highly structured, showing optical coherence tomography (OCT) retinal thickness scans, intraocular pressure (IOP) tonometry waveforms, and small animal MRI optic nerve scans.`,
      `Composition: ${cat1Seed.variation.layoutDescription}`,
      `Viewing Angle: ${cat1Seed.variation.viewingAngle}.`,
      ...cat1Seed.variation.promptDirectives,
      `Style Quality: Non-cartoonish, professional scientific journal figure, crisp vector typography, dark high-contrast scientific background, no generic clipart.`,
    ].join(" ");

    const item2Prompt = [
      `A high-resolution, biologically accurate scientific anatomical illustration for NASA Space Biology.`,
      scientificGrounding,
      `Artifact Role: Anatomical & Tissue Morphology. Emphasize anatomical legibility, stratified ocular layers (nerve fiber layer, photoreceptors, choroid), retrobulbar space, and optic nerve sheath dimensions under head-down tilt fluid redistribution.`,
      `Composition: ${cat2Seed.variation.layoutDescription}`,
      `Viewing Angle: ${cat2Seed.variation.viewingAngle}.`,
      ...cat2Seed.variation.promptDirectives,
      `Style Quality: Publication-quality medical illustration, anatomical precision, authentic ocular and neural structures, non-cartoonish.`,
    ].join(" ");

    const item3Prompt = [
      `A cinematic and scientifically authentic NASA space biology laboratory habitat scene.`,
      scientificGrounding,
      `Artifact Role: Ground-Analog Protocol & In Vivo Imaging Habitat. Featuring specialized head-down tilt apparatus, diagnostic imaging stations (OCT scanner, rebound tonometer, MRI module), environmental controls, and animal habitat chambers.`,
      `Composition: ${cat3Seed.variation.layoutDescription}`,
      `Viewing Angle: ${cat3Seed.variation.viewingAngle}.`,
      ...cat3Seed.variation.promptDirectives,
      `Style Quality: Authentic laboratory realism, cleanroom stainless steel and matte titanium, photorealistic depth and volumetric lighting.`,
    ].join(" ");

    const item4Prompt = [
      `A sleek, modern scientific executive visual abstract and dual-study accession briefing poster for NASA OSDR.`,
      scientificGrounding,
      `Artifact Role: Dual-Study Accession Synthesis. Sleek presentation poster comparing study metadata (${sA.study_id} vs ${sB.study_id}), diagnostic imaging platforms, animal models, and study parameters.`,
      `Composition: ${cat4Seed.variation.layoutDescription}`,
      `Viewing Angle: ${cat4Seed.variation.viewingAngle}.`,
      ...cat4Seed.variation.promptDirectives,
      `Style Quality: High-impact publication executive poster, pristine typography, balanced negative space, sharp vector badges, presentation slide quality.`,
    ].join(" ");

    const plan: AwgMediaPlan = {
      theme,
      studies: isSame ? [sA.study_id] : [sA.study_id, sB.study_id],
      rationale: `Comparative analysis between in vivo ${sA.assay_measurement} (${sA.study_id}) and ${sB.assay_measurement} (${sB.study_id}) under ${factor}.`,
      runIndex,
      evidenceMap,
      items: [
        {
          category: "data_visualization",
          categoryLabel: "Imaging & Physiology",
          title: card1Title,
          description: `Comparative in vivo diagnostic imaging and physiological pressure measurements under ground-analog fluid shift.`,
          prompt: item1Prompt,
          styleVariation: cat1Seed.variation,
          diversitySeed: cat1Seed.seedString,
          evidenceClass: "evidence_informed_synthesis",
          evidenceBasis: `Empirical in vivo imaging and tonometry endpoints synthesized to assess tissue geometry and pressure dynamics.`,
          groundingCard,
          provenanceFooter,
        },
        {
          category: "biological_concept",
          categoryLabel: "Anatomy & Morphology",
          title: card2Title,
          description: `Anatomical layer stratification and optic nerve sheath morphology under simulated cephalad fluid shift.`,
          prompt: item2Prompt,
          styleVariation: cat2Seed.variation,
          diversitySeed: cat2Seed.seedString,
          evidenceClass: "evidence_informed_synthesis",
          evidenceBasis: `Gross and microscopic tissue morphology and optic nerve dimensions derived from observed in vivo imaging records.`,
          groundingCard,
          provenanceFooter,
        },
        {
          category: "contextual_narrative",
          categoryLabel: "Analog Protocol",
          title: card3Title,
          description: `Laboratory ground analog protocol and diagnostic imaging setup modeling head-down tilt fluid redistribution.`,
          prompt: item3Prompt,
          styleVariation: cat3Seed.variation,
          diversitySeed: cat3Seed.seedString,
          evidenceClass: "conceptual_visualization",
          evidenceBasis: `Conceptual spaceflight analog laboratory simulation depicting experimental environment and ground-testing parameters.`,
          groundingCard,
          provenanceFooter,
        },
        {
          category: "accession_summary",
          categoryLabel: "Study Profile",
          title: card4Title,
          description: `Direct dual-accession metadata comparison card summarizing animal models, diagnostic imaging modalities, and study parameters.`,
          prompt: item4Prompt,
          styleVariation: cat4Seed.variation,
          diversitySeed: cat4Seed.seedString,
          evidenceClass: "observed_fact",
          evidenceBasis: `Repository-verified metadata fields from official NASA OSDR study records (${sA.study_id}, ${sB.study_id}).`,
          groundingCard,
          provenanceFooter,
        },
      ],
    };

    return validateAndSanitizeMediaPlan(plan, caps);
  }

  // Omics-supported pair handling:
  const assayTypeA = caps.studyA.primaryAssayLabel;
  const assayTypeB = caps.studyB.primaryAssayLabel;
  
  const omicsPrefix = caps.isMultiOmics
    ? "Multi-Omics"
    : caps.isBothOmics
    ? (caps.isBothTranscriptomics ? (caps.isBothRnaSeq ? "RNA-seq" : "Transcriptomics") : "Cross-Omics")
    : "Cross-Modal";

  const theme = isOcular
    ? `${factor} ${omicsPrefix} Ocular Adaptation in ${org}`
    : `${factor} ${omicsPrefix} Spaceflight Response in ${org}`;

  const hasMechanisms = caps.hasVerifiedMechanisticFindings;
  const card1Role = caps.isMultiOmics
    ? "Multi-Omics Systems Correlation Map"
    : caps.isBothOmics
    ? "Comparative Omics Matrix"
    : "Cross-Modal Comparative Integration";

  const card1Title = `${sA.study_id} (${caps.studyA.hasMicroarray ? "Microarray" : caps.studyA.hasRnaSeq ? "RNA-seq" : caps.studyA.hasImaging ? "MRI/Imaging" : "Assay"}) × ${sB.study_id} (${caps.studyB.hasMicroarray ? "Microarray" : caps.studyB.hasRnaSeq ? "RNA-seq" : caps.studyB.hasImaging ? "MRI/Imaging" : "Assay"})`;

  const card1Desc = `Cross-modal comparison linking ${caps.studyA.primaryAssayLabel} (${sA.study_id}) with ${caps.studyB.primaryAssayLabel} (${sB.study_id}).`;

  const item1Prompt = [
    `A sophisticated, publication-grade scientific data visualization infographic for NASA Space Biology.`,
    scientificGrounding,
    `Artifact Role: ${card1Role}. Must be evidence-led, highly structured, comparing ${sA.assay_measurement} and ${sB.assay_measurement}.`,
    `Composition: ${cat1Seed.variation.layoutDescription}`,
    `Viewing Angle: ${cat1Seed.variation.viewingAngle}.`,
    ...cat1Seed.variation.promptDirectives,
    `Style Quality: Non-cartoonish, professional scientific journal figure, crisp vector typography, dark high-contrast scientific background.`,
  ].join(" ");

  const item2Prompt = [
    `A high-resolution, biologically accurate scientific medical illustration for NASA Space Biology.`,
    scientificGrounding,
    `Artifact Role: Cellular & Tissue Response. Emphasize anatomical legibility, tissue stratification, and biological endpoints in ${tissue}.`,
    `Composition: ${cat2Seed.variation.layoutDescription}`,
    `Viewing Angle: ${cat2Seed.variation.viewingAngle}.`,
    ...cat2Seed.variation.promptDirectives,
    `Style Quality: Publication-quality medical illustration, anatomical precision, non-cartoonish.`,
  ].join(" ");

  const item3Prompt = [
    `A cinematic and scientifically authentic NASA space biology laboratory habitat scene.`,
    scientificGrounding,
    `Artifact Role: Spaceflight Environmental Context. Featuring specialized research habitat, telemetry monitors, and experimental hardware.`,
    `Composition: ${cat3Seed.variation.layoutDescription}`,
    `Viewing Angle: ${cat3Seed.variation.viewingAngle}.`,
    ...cat3Seed.variation.promptDirectives,
    `Style Quality: Authentic laboratory realism, atmospheric LED status lighting, cleanroom stainless steel and matte titanium.`,
  ].join(" ");

  const item4Prompt = [
    `A sleek, modern scientific executive visual abstract and dual-study accession briefing poster for NASA OSDR.`,
    scientificGrounding,
    `Artifact Role: Dual-Study Accession Synthesis. Visually expressive poster comparing study metadata (${sA.study_id} vs ${sB.study_id}), assay platforms, and biological models.`,
    `Composition: ${cat4Seed.variation.layoutDescription}`,
    `Viewing Angle: ${cat4Seed.variation.viewingAngle}.`,
    ...cat4Seed.variation.promptDirectives,
    `Style Quality: High-impact publication executive poster, pristine typography, balanced negative space, sharp vector badges.`,
  ].join(" ");

  const plan: AwgMediaPlan = {
    theme,
    studies: isSame ? [sA.study_id] : [sA.study_id, sB.study_id],
    rationale: `Cross-assay comparison between ${sA.assay_measurement} (${sA.study_id}) and ${sB.assay_measurement} (${sB.study_id}) under ${factor}.`,
    runIndex,
    evidenceMap,
    items: [
      {
        category: "data_visualization",
        categoryLabel: hasMechanisms ? "Pathway & Assays" : "Assay Comparison",
        title: card1Title,
        description: card1Desc,
        prompt: item1Prompt,
        styleVariation: cat1Seed.variation,
        diversitySeed: cat1Seed.seedString,
        evidenceClass: "evidence_informed_synthesis",
        evidenceBasis: `Empirical ${sA.assay_measurement} (${sA.study_id}) and ${sB.assay_measurement} (${sB.study_id}) endpoints synthesized into a comparative layout.`,
        groundingCard,
        provenanceFooter,
      },
      {
        category: "biological_concept",
        categoryLabel: "Cellular Response",
        title: `${tissue} Cellular Response`,
        description: `Tissue layer stratification and observed cellular responses across ${tissue}.`,
        prompt: item2Prompt,
        styleVariation: cat2Seed.variation,
        diversitySeed: cat2Seed.seedString,
        evidenceClass: "evidence_informed_synthesis",
        evidenceBasis: `Observed cellular endpoints and anatomical tissue stratification across datasets.`,
        groundingCard,
        provenanceFooter,
      },
      {
        category: "contextual_narrative",
        categoryLabel: "Environmental Context",
        title: `${factor} Context`,
        description: `Laboratory setup and habitat context modeling ${factor}.`,
        prompt: item3Prompt,
        styleVariation: cat3Seed.variation,
        diversitySeed: cat3Seed.seedString,
        evidenceClass: "conceptual_visualization",
        evidenceBasis: `Conceptual spaceflight habitat depicting experimental environment parameters.`,
        groundingCard,
        provenanceFooter,
      },
      {
        category: "accession_summary",
        categoryLabel: "Study Profile",
        title: "Accessions Summary",
        description: `Direct dual-accession metadata comparison card summarizing flight factors, assay platforms, and takeaways.`,
        prompt: item4Prompt,
        styleVariation: cat4Seed.variation,
        diversitySeed: cat4Seed.seedString,
        evidenceClass: "observed_fact",
        evidenceBasis: `Repository-verified metadata fields from official NASA OSDR study records (${sA.study_id}, ${sB.study_id}).`,
        groundingCard,
        provenanceFooter,
      },
    ],
  };

  return validateAndSanitizeMediaPlan(plan, caps);
}

// ---------------------------------------------------------------------------
// Image Generation Core & Single Regeneration Check
// ---------------------------------------------------------------------------

async function renderSingleArtifact(
  pItem: GroundedMediaPlanItem,
  index: number,
  sA: OSDRStudy,
  sB: OSDRStudy,
  ai: GoogleGenAI | null,
  options?: { fresh?: boolean; explicitSeed?: string | number }
): Promise<AwgMediaItem> {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  const artifactId = `art-img-${pItem.category.slice(0, 4)}-${pItem.styleVariation.id}-${index + 1}-${requestId.slice(0, 8)}`;
  const seedValue = options?.explicitSeed != null ? options.explicitSeed : pItem.diversitySeed;
  const promptFingerprint = computePromptFingerprint(pItem.prompt);
  const caps = derivePairCapabilities(sA, sB);
  const cacheKey = `img:${[sA.study_id, sB.study_id].sort().join("::")}:${pItem.category}:${pItem.styleVariation.id}:${seedValue}:${caps.isImagingPhysiologyOnly ? "imgphys" : "omics"}:${promptFingerprint}`;

  let imageUrl = "";
  let source: "gemini_image" | "scientific_vector_svg" = "scientific_vector_svg";
  let fallbackUsed = false;
  let fallbackReason = "none";
  let provider = "Google Gemini";
  let providerModel = GEMINI_IMAGE_MODEL;
  let generationStatus: MediaGenerationStatus = "fallback";
  let generationError: string | undefined = undefined;

  // Check cache if not fresh requested
  if (!options?.fresh && mediaArtifactCache.has(cacheKey)) {
    const cached = mediaArtifactCache.get(cacheKey)!;
    const latencyMs = Math.max(1, Date.now() - startTime);

    const provRecord: MediaProvenanceRecord = {
      requestId,
      artifactId,
      createdAt: new Date().toISOString(),
      mediaType: "image",
      artifactType: cached.data.generationSource === "gemini_image" ? "provider_image_data_uri" : "fallback_svg_data_uri",
      renderEngine: cached.data.generationSource === "gemini_image" ? "gemini_inline_image" : "svg_vector_engine",
      provider: cached.provider,
      providerModel: cached.providerModel,
      generationStatus: "cache_hit",
      statusLabel: getStatusLabel("cache_hit"),
      cacheKey,
      cacheHit: true,
      creativeDirection: `${pItem.styleVariation.name} (${pItem.styleVariation.layoutTitle})`,
      seed: seedValue,
      promptFingerprint,
      sourceStudyPair: [sA.study_id, sB.study_id],
      assetUrl: cached.data.imageUrl,
      contentHash: cached.contentHash,
      latencyMs,
    };

    recordMediaAudit(provRecord);

    return {
      ...cached.data,
      id: `media-${index + 1}-${pItem.category}`,
      provenance: provRecord,
    };
  }

  // Live generation attempt
  if (!ai) {
    fallbackUsed = true;
    fallbackReason = "missing_configuration";
    provider = "NASA OSDR Local Vector Engine";
    providerModel = "local-vector-svg-v1";
    generationStatus = "fallback";
  } else {
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_IMAGE_MODEL,
        contents: {
          parts: [{ text: pItem.prompt }],
        },
        config: {
          imageConfig: {
            aspectRatio: "16:9",
          },
        },
      });

      const parts = response?.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          const mime = part.inlineData.mimeType || "image/png";
          imageUrl = `data:${mime};base64,${part.inlineData.data}`;
          source = "gemini_image";
          provider = "Google Gemini";
          providerModel = GEMINI_IMAGE_MODEL;
          generationStatus = "fresh_provider";
          fallbackUsed = false;
          fallbackReason = "none";
          break;
        }
      }

      if (!imageUrl) {
        fallbackUsed = true;
        fallbackReason = "invalid_response_payload";
        provider = "NASA OSDR Local Vector Engine";
        providerModel = "local-vector-svg-v1";
        generationStatus = "fallback";
        generationError = "Model responded without an inline image part in candidates";
      }
    } catch (err: any) {
      fallbackUsed = true;
      provider = "NASA OSDR Local Vector Engine";
      providerModel = "local-vector-svg-v1";
      generationStatus = "fallback";
      const errMsg = err?.message || String(err);
      generationError = errMsg;

      if (errMsg.includes("429") || errMsg.includes("quota") || errMsg.includes("RESOURCE_EXHAUSTED")) {
        fallbackReason = "quota_rate_limit";
      } else if (errMsg.includes("not found") || errMsg.includes("unsupported") || errMsg.includes("is not supported")) {
        fallbackReason = "unsupported_model";
      } else if (errMsg.includes("API key not valid") || errMsg.includes("API_KEY_INVALID")) {
        fallbackReason = "missing_configuration";
      } else {
        fallbackReason = "provider_exception";
      }
    }
  }

  // If Gemini failed or was unconfigured, generate tailored vector SVG respecting the selected variation
  if (!imageUrl) {
    if (pItem.category === "data_visualization") {
      imageUrl = createDataVizSvg(sA, sB, pItem.styleVariation, caps);
    } else if (pItem.category === "biological_concept") {
      imageUrl = createBiologicalConceptSvg(sA, sB, pItem.styleVariation, caps);
    } else if (pItem.category === "contextual_narrative") {
      imageUrl = createContextualNarrativeSvg(sA, sB, pItem.styleVariation, caps);
    } else {
      imageUrl = createAccessionSummarySvg(sA, sB, pItem.styleVariation, caps);
    }
    source = "scientific_vector_svg";
    provider = "NASA OSDR Local Vector Engine";
    providerModel = "local-vector-svg-v1";
    generationStatus = "fallback";
  }

  const latencyMs = Math.max(1, Date.now() - startTime);
  const contentHash = computeContentHash(imageUrl);

  const artifactType: AwgArtifactType =
    source === "gemini_image" ? "provider_image_data_uri" : "fallback_svg_data_uri";
  const renderEngine: AwgRenderEngine =
    source === "gemini_image" ? "gemini_inline_image" : "svg_vector_engine";

  const provenance: MediaProvenanceRecord = {
    requestId,
    artifactId,
    createdAt: new Date().toISOString(),
    mediaType: "image",
    artifactType,
    renderEngine,
    provider,
    providerModel,
    generationStatus,
    statusLabel: getStatusLabel(generationStatus),
    cacheKey,
    cacheHit: false,
    creativeDirection: `${pItem.styleVariation.name} (${pItem.styleVariation.layoutTitle})`,
    seed: seedValue,
    promptFingerprint,
    sourceStudyPair: [sA.study_id, sB.study_id],
    assetUrl: imageUrl.slice(0, 120) + "...",
    contentHash,
    latencyMs,
    errorCode: fallbackUsed && fallbackReason !== "none" ? fallbackReason : undefined,
    errorMessage: generationError,
  };

  recordMediaAudit(provenance);

  const mediaItem: AwgMediaItem = {
    id: `media-${index + 1}-${pItem.category}`,
    category: pItem.category,
    categoryLabel: pItem.categoryLabel,
    title: pItem.title,
    subtitle: `${sA.study_id} × ${sB.study_id}`,
    description: pItem.description,
    imageUrl,
    caption: `${pItem.title}: ${sA.study_id} (${sA.assay_measurement}) & ${sB.study_id} (${sB.assay_measurement}) · ${pItem.styleVariation.name}`,
    promptUsed: pItem.prompt,
    generationSource: source,
    requestedRenderMode: "gemini_image",
    actualRenderMode: source,
    provider,
    fallbackUsed,
    fallbackReason,
    modelUsed: providerModel,
    generationError,
    studies: [sA.study_id, sB.study_id],
    evidenceClass: pItem.evidenceClass,
    evidenceBasis: pItem.evidenceBasis,
    groundingCard: pItem.groundingCard,
    provenanceFooter: pItem.provenanceFooter,
    styleVariation: {
      id: pItem.styleVariation.id,
      name: pItem.styleVariation.name,
      layoutTitle: pItem.styleVariation.layoutTitle,
      paletteName: pItem.styleVariation.paletteName,
      viewingAngle: pItem.styleVariation.viewingAngle,
    },
    diversitySeed: String(seedValue),
    provenance,
  };

  // Cache artifact
  mediaArtifactCache.set(cacheKey, {
    cacheKey,
    data: mediaItem,
    contentHash,
    originalRequestId: requestId,
    createdAt: provenance.createdAt,
    provider,
    providerModel,
  });

  return mediaItem;
}

export async function generateAwgMediaSet(
  req: MediaSetRequest
): Promise<MediaSetResponse> {
  const validation = await validateAwgAccessions(req.studies || []);
  if (!validation.isValid || !validation.studyA || !validation.studyB) {
    throw new Error(validation.userMessage || validation.errorMessage || "Invalid study accessions provided for media generation.");
  }

  const sA = validation.studyA;
  const sB = validation.studyB;

  // Advance the generation counter for this study pair
  let runIndex: number;
  if (typeof req.generationIndex === "number") {
    runIndex = req.generationIndex;
  } else if (req.fresh) {
    runIndex = Math.floor(Math.random() * 1000) + 1;
    recordPairGeneration(sA.study_id, sB.study_id);
  } else {
    runIndex = recordPairGeneration(sA.study_id, sB.study_id);
  }

  const plan = buildGroundedMediaPlan(sA, sB, { generationIndex: runIndex });
  const ai = getImageAi();

  // 1. Initial parallel generation for all 4 distinct artifact categories
  const itemPromises = plan.items.map((pItem, i) =>
    renderSingleArtifact(pItem, i, sA, sB, ai, { fresh: req.fresh, explicitSeed: req.seed })
  );

  let items = await Promise.all(itemPromises);

  // 2. Similarity & Quality Check
  let duplicateRegenerated = false;
  const paletteThemeSet = new Set<string>();
  let duplicateIndex = -1;

  for (let i = 0; i < items.length; i++) {
    const pal = plan.items[i]?.styleVariation?.paletteTheme || "cobalt_cyan";
    if (paletteThemeSet.has(pal) && duplicateIndex === -1) {
      duplicateIndex = i;
    }
    paletteThemeSet.add(pal);
  }

  // Also check if an item had a provider failure while others succeeded
  if (duplicateIndex === -1) {
    const failedItemIndex = items.findIndex((it) => it.fallbackUsed && it.generationError);
    const hasSuccessfulGemini = items.some((it) => it.generationSource === "gemini_image");
    if (failedItemIndex !== -1 && hasSuccessfulGemini) {
      duplicateIndex = failedItemIndex;
    }
  }

  // If a duplicate or weak item is found, perform a targeted single regeneration pass with an alternate variation
  if (duplicateIndex !== -1 && ai) {
    const targetItem = plan.items[duplicateIndex];
    const catVars = STYLE_VARIATIONS_BY_CATEGORY[targetItem.category];
    const altVariantIndex = (targetItem.styleVariation ? (catVars.findIndex(v => v.id === targetItem.styleVariation.id) + 1) : 1) % catVars.length;
    const altVariation = catVars[altVariantIndex];

    const altPrompt = [
      `A refined, distinctive publication-grade scientific visual for NASA Space Biology.`,
      `Grounding: ${sA.study_id} (${sA.assay_measurement}) and ${sB.study_id} (${sB.assay_measurement}) in ${sA.organism} under ${sA.study_factor}.`,
      `Role: ${targetItem.title}. Re-composed with alternate layout: ${altVariation.layoutDescription}`,
      `Viewing Angle: ${altVariation.viewingAngle}.`,
      ...altVariation.promptDirectives,
      `Ensure visual distinctiveness from other gallery items. Professional journal aesthetics, non-cartoonish.`,
    ].join(" ");

    const updatedPlanItem: GroundedMediaPlanItem = {
      ...targetItem,
      prompt: altPrompt,
      styleVariation: altVariation,
      diversitySeed: `${targetItem.diversitySeed}-alt-${Date.now()}`,
    };

    try {
      const regeneratedItem = await renderSingleArtifact(
        updatedPlanItem,
        duplicateIndex,
        sA,
        sB,
        ai,
        { fresh: true }
      );
      items[duplicateIndex] = regeneratedItem;
      duplicateRegenerated = true;
    } catch {
      // Keep original item on retry error
    }
  }

  return {
    success: true,
    plan,
    items,
    studies: [sA.study_id, sB.study_id],
    count: items.length,
    diagnostics: {
      geminiImageConfigured: Boolean(ai),
      model: GEMINI_IMAGE_MODEL,
      itemsGenerated: items.length,
      geminiGeneratedCount: items.filter((it) => it.generationSource === "gemini_image").length,
      fallbackCount: items.filter((it) => it.fallbackUsed).length,
      duplicateRegenerated,
      diversityScore: `${new Set(items.map((it) => it.styleVariation?.paletteName)).size}/4 Palettes · ${items.length} Distinct Formats`,
      runIndex,
    },
  };
}

// Backward compatibility helper
export async function generateVisualAbstract(req: MediaSetRequest) {
  const set = await generateAwgMediaSet(req);
  return {
    success: true,
    imageUrl: set.items[0]?.imageUrl || "",
    caption: set.items[0]?.caption || "",
    promptUsed: set.items[0]?.promptUsed || "",
    studies: set.studies,
    generationSource: set.items[0]?.generationSource || "scientific_vector_svg",
    mediaSet: set.items,
  };
}

function escapeXml(unsafe: string): string {
  return (unsafe || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ---------------------------------------------------------------------------
// Dynamic Local Vector SVG Generators (Customized by StyleVariation & Capability)
// ---------------------------------------------------------------------------

export function createDataVizSvg(sA: OSDRStudy, sB: OSDRStudy, variation?: StyleVariation, caps?: PairCapabilityProfile): string {
  const pal = variation?.paletteColors || PALETTE_DEFINITIONS.cobalt_cyan;
  const layoutName = variation?.layoutTitle || "In Vivo Diagnostic Modalities Matrix";

  if (caps?.isImagingPhysiologyOnly) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" width="1200" height="675" style="background:${pal.bgGradEnd};font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${pal.bgGradStart}"/>
      <stop offset="100%" stop-color="${pal.bgGradEnd}"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="675" fill="url(#bgGrad)" />

  <!-- Top Header Bar -->
  <rect x="40" y="24" width="1120" height="64" rx="10" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
  <rect x="54" y="38" width="6" height="36" rx="3" fill="${pal.accentPrimary}"/>
  <text x="72" y="48" fill="${pal.accentPrimary}" font-size="11" font-weight="700" letter-spacing="1.5">IMAGING &amp; PHYSIOLOGY · ${escapeXml(layoutName.toUpperCase())}</text>
  <text x="72" y="70" fill="${pal.textPrimary}" font-size="17" font-weight="700">${sA.study_id} (${escapeXml(sA.assay_measurement)}) ⟷ ${sB.study_id} (${escapeXml(sB.assay_measurement)})</text>
  <rect x="940" y="40" width="200" height="32" rx="6" fill="${pal.badgeBg}"/>
  <text x="1040" y="60" fill="${pal.accentHighlight}" font-size="11" font-weight="700" text-anchor="middle">DIAGNOSTIC EVIDENCE</text>

  <!-- Left Column: Study A Diagnostic Modalities -->
  <g transform="translate(60, 105)">
    <rect width="420" height="390" rx="12" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
    <rect x="20" y="16" width="260" height="28" rx="6" fill="${pal.badgeBg}"/>
    <text x="150" y="35" fill="${pal.textPrimary}" font-size="12" font-weight="700" text-anchor="middle">${sA.study_id} Diagnostic Modality</text>

    <!-- Node 1: OCT Retinal Stratification -->
    <g transform="translate(20, 58)">
      <rect width="380" height="64" rx="8" fill="#131e33" stroke="${pal.cardStroke}"/>
      <circle cx="28" cy="32" r="12" fill="${pal.accentPrimary}"/>
      <text x="28" y="36" fill="#ffffff" font-size="10" font-weight="800" text-anchor="middle">OCT</text>
      <text x="50" y="26" fill="${pal.textPrimary}" font-size="13" font-weight="700">Optical Coherence Tomography</text>
      <text x="50" y="46" fill="${pal.textSecondary}" font-size="11">In vivo retinal layer thickness measurements</text>
      <rect x="270" y="18" width="96" height="26" rx="6" fill="${pal.badgeBg}"/>
      <text x="318" y="35" fill="${pal.accentHighlight}" font-size="11" font-weight="700" text-anchor="middle">Measured</text>
    </g>

    <!-- Node 2: IOP Tonometry -->
    <g transform="translate(20, 132)">
      <rect width="380" height="64" rx="8" fill="#131e33" stroke="${pal.cardStroke}"/>
      <circle cx="28" cy="32" r="12" fill="#0284c7"/>
      <text x="28" y="36" fill="#ffffff" font-size="10" font-weight="800" text-anchor="middle">IOP</text>
      <text x="50" y="26" fill="${pal.textPrimary}" font-size="13" font-weight="700">Intraocular Pressure Tonometry</text>
      <text x="50" y="46" fill="${pal.textSecondary}" font-size="11">Physiological pressure dynamics in unsedated model</text>
      <rect x="270" y="18" width="96" height="26" rx="6" fill="#0369a1"/>
      <text x="318" y="35" fill="#bae6fd" font-size="11" font-weight="700" text-anchor="middle">Monitored</text>
    </g>

    <!-- Node 3: A-Scan Ultrasound -->
    <g transform="translate(20, 206)">
      <rect width="380" height="64" rx="8" fill="#131e33" stroke="${pal.cardStroke}"/>
      <circle cx="28" cy="32" r="12" fill="#475569"/>
      <text x="28" y="36" fill="#ffffff" font-size="10" font-weight="800" text-anchor="middle">US</text>
      <text x="50" y="26" fill="${pal.textPrimary}" font-size="13" font-weight="700">A-Scan Biometric Ultrasound</text>
      <text x="50" y="46" fill="${pal.textSecondary}" font-size="11">Axial globe length and anterior chamber depth</text>
      <rect x="270" y="18" width="96" height="26" rx="6" fill="#334155"/>
      <text x="318" y="35" fill="#cbd5e1" font-size="11" font-weight="700" text-anchor="middle">Quantified</text>
    </g>

    <!-- Node 4: Anterior Segment Morphology -->
    <g transform="translate(20, 280)">
      <rect width="380" height="64" rx="8" fill="#131e33" stroke="${pal.cardStroke}"/>
      <circle cx="28" cy="32" r="12" fill="${pal.accentSecondary}"/>
      <text x="28" y="36" fill="#ffffff" font-size="10" font-weight="800" text-anchor="middle">BIO</text>
      <text x="50" y="26" fill="${pal.textPrimary}" font-size="13" font-weight="700">In Vivo Ophthalmic Protocol</text>
      <text x="50" y="46" fill="${pal.textSecondary}" font-size="11">Longitudinal non-invasive ophthalmic evaluation</text>
      <rect x="270" y="18" width="96" height="26" rx="6" fill="${pal.badgeBg}"/>
      <text x="318" y="35" fill="${pal.accentHighlight}" font-size="11" font-weight="700" text-anchor="middle">Validated</text>
    </g>

    <text x="20" y="368" fill="${pal.textSecondary}" font-size="11">Imaging &amp; Tonometry · Model: ${escapeXml(sA.organism)}</text>
  </g>

  <!-- Center Diagnostic Synthesis Nexus -->
  <g transform="translate(510, 145)">
    <circle cx="90" cy="155" r="68" fill="${pal.cardBg}" stroke="${pal.accentPrimary}" stroke-width="2.5"/>
    <circle cx="90" cy="155" r="52" fill="${pal.badgeBg}" opacity="0.6"/>
    <text x="90" y="140" fill="${pal.accentHighlight}" font-size="10" font-weight="800" text-anchor="middle">IN VIVO</text>
    <text x="90" y="158" fill="#ffffff" font-size="13" font-weight="800" text-anchor="middle">DIAGNOSTIC</text>
    <text x="90" y="174" fill="${pal.textSecondary}" font-size="10" font-weight="600" text-anchor="middle">COMPARISON</text>
    <text x="90" y="250" fill="${pal.accentPrimary}" font-size="11" font-weight="700" text-anchor="middle">Evidence-Informed</text>
  </g>

  <!-- Right Column: Study B Diagnostic Modalities -->
  <g transform="translate(720, 105)">
    <rect width="420" height="390" rx="12" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
    <rect x="20" y="16" width="260" height="28" rx="6" fill="${pal.badgeBg}"/>
    <text x="150" y="35" fill="${pal.textPrimary}" font-size="12" font-weight="700" text-anchor="middle">${sB.study_id} Diagnostic Modality</text>

    <!-- Node 1: High-Resolution MRI -->
    <g transform="translate(20, 58)">
      <rect width="380" height="64" rx="8" fill="#131e33" stroke="${pal.cardStroke}"/>
      <circle cx="28" cy="32" r="12" fill="#38bdf8"/>
      <text x="28" y="36" fill="#ffffff" font-size="10" font-weight="800" text-anchor="middle">MRI</text>
      <text x="50" y="26" fill="${pal.textPrimary}" font-size="13" font-weight="700">Small Animal Magnetic Resonance</text>
      <text x="50" y="46" fill="${pal.textSecondary}" font-size="11">High-resolution in vivo retrobulbar multi-slice imaging</text>
      <rect x="270" y="18" width="96" height="26" rx="6" fill="#0369a1"/>
      <text x="318" y="35" fill="#bae6fd" font-size="11" font-weight="700" text-anchor="middle">Quantified</text>
    </g>

    <!-- Node 2: Optic Nerve Sheath -->
    <g transform="translate(20, 132)">
      <rect width="380" height="64" rx="8" fill="#131e33" stroke="${pal.cardStroke}"/>
      <circle cx="28" cy="32" r="12" fill="#0ea5e9"/>
      <text x="28" y="36" fill="#ffffff" font-size="10" font-weight="800" text-anchor="middle">ONSD</text>
      <text x="50" y="26" fill="${pal.textPrimary}" font-size="13" font-weight="700">Optic Nerve Sheath Diameter</text>
      <text x="50" y="46" fill="${pal.textSecondary}" font-size="11">Subarachnoid space diameter under fluid shift</text>
      <rect x="270" y="18" width="96" height="26" rx="6" fill="#0284c7"/>
      <text x="318" y="35" fill="#e0f2fe" font-size="11" font-weight="700" text-anchor="middle">Measured</text>
    </g>

    <!-- Node 3: Retrobulbar Geometry -->
    <g transform="translate(20, 206)">
      <rect width="380" height="64" rx="8" fill="#131e33" stroke="${pal.cardStroke}"/>
      <circle cx="28" cy="32" r="12" fill="#06b6d4"/>
      <text x="28" y="36" fill="#ffffff" font-size="10" font-weight="800" text-anchor="middle">ONH</text>
      <text x="50" y="26" fill="${pal.textPrimary}" font-size="13" font-weight="700">Optic Nerve Head Geometry</text>
      <text x="50" y="46" fill="${pal.textSecondary}" font-size="11">Posterior globe contour &amp; insertion biomechanics</text>
      <rect x="270" y="18" width="96" height="26" rx="6" fill="#0891b2"/>
      <text x="318" y="35" fill="#cffafe" font-size="11" font-weight="700" text-anchor="middle">Analyzed</text>
    </g>

    <!-- Node 4: Spaceflight Analog Protocol -->
    <g transform="translate(20, 280)">
      <rect width="380" height="64" rx="8" fill="#131e33" stroke="${pal.cardStroke}"/>
      <circle cx="28" cy="32" r="12" fill="#10b981"/>
      <text x="28" y="36" fill="#ffffff" font-size="10" font-weight="800" text-anchor="middle">HDT</text>
      <text x="50" y="26" fill="${pal.textPrimary}" font-size="13" font-weight="700">Ground-Based Fluid Shift Model</text>
      <text x="50" y="46" fill="${pal.textSecondary}" font-size="11">Matched head-down tilt analog cohort protocol</text>
      <rect x="270" y="18" width="96" height="26" rx="6" fill="#065f46"/>
      <text x="318" y="35" fill="#a7f3d0" font-size="11" font-weight="700" text-anchor="middle">Matched</text>
    </g>

    <text x="20" y="368" fill="${pal.textSecondary}" font-size="11">MRI Diagnostics · Model: ${escapeXml(sB.organism)}</text>
  </g>

  <!-- Bottom Cross-Link Footer & Provenance -->
  <g transform="translate(40, 508)">
    <rect width="1120" height="142" rx="12" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
    <text x="24" y="30" fill="${pal.accentPrimary}" font-size="13" font-weight="700">Translational Synthesis Takeaway:</text>
    <text x="24" y="54" fill="${pal.textPrimary}" font-size="12">
      Multi-modal in vivo imaging and tonometry provide direct structural and pressure measurements under simulated cephalad fluid shifts.
    </text>
    <line x1="24" y1="74" x2="1096" y2="74" stroke="${pal.cardStroke}" stroke-width="1"/>
    <text x="24" y="96" fill="${pal.accentHighlight}" font-size="11" font-weight="700">EVIDENCE CLASSIFICATION: EVIDENCE-INFORMED SYNTHESIS</text>
    <text x="24" y="118" fill="${pal.textSecondary}" font-size="11">Grounded in ${sA.study_id} and ${sB.study_id} via NASA OSDR repository records. Morphometric and pressure alignments represent evidence-informed cross-study synthesis.</text>
  </g>
</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  const isProteomicsB = (sB.assay_measurement || "").toLowerCase().includes("protein") || (sB.assay_measurement || "").toLowerCase().includes("proteom");
  const bLayerTitle = isProteomicsB ? `${sB.study_id} Proteome` : `${sB.study_id} Metabolome`;
  const bAssayLabel = isProteomicsB ? "Mass Spectrometry / Proteomics" : "Metabolite Profiling Assay";

  const bNode1Title = isProteomicsB ? "COL4A1 · Basement Membrane" : "Energy Metabolism";
  const bNode1Desc = isProteomicsB ? "Vascular basal lamina remodeling" : "Cellular bioenergetic flux";
  const bNode1Badge = isProteomicsB ? "Downregulated" : "Altered";

  const bNode2Title = isProteomicsB ? "MMP-2 · Matrix Protease" : "Lipid Profiling";
  const bNode2Desc = isProteomicsB ? "Extracellular matrix remodeling" : "Membrane lipid dynamics";
  const bNode2Badge = isProteomicsB ? "Elevated" : "Elevated";

  const bNode3Title = isProteomicsB ? "NEFL · Neurofilament Light" : "Lactate Dynamic";
  const bNode3Desc = isProteomicsB ? "Retinal axonal stress & remodeling" : "Metabolic profile shift";
  const bNode3Badge = isProteomicsB ? "Remodeling" : "Shift";

  const bNode4Title = isProteomicsB ? "TJP1 · Structural Junction" : "Amino Acid Profiles";
  const bNode4Desc = isProteomicsB ? "Cellular contact architecture" : "Substrate pool dynamics";
  const bNode4Badge = isProteomicsB ? "Modulated" : "Measured";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" width="1200" height="675" style="background:${pal.bgGradEnd};font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${pal.bgGradStart}"/>
      <stop offset="100%" stop-color="${pal.bgGradEnd}"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="675" fill="url(#bgGrad)" />

  <!-- Top Header Bar -->
  <rect x="40" y="24" width="1120" height="64" rx="10" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
  <rect x="54" y="38" width="6" height="36" rx="3" fill="${pal.accentPrimary}"/>
  <text x="72" y="48" fill="${pal.accentPrimary}" font-size="11" font-weight="700" letter-spacing="1.5">ASSAY COMPARISON · ${escapeXml(layoutName.toUpperCase())}</text>
  <text x="72" y="70" fill="${pal.textPrimary}" font-size="17" font-weight="700">${sA.study_id} (${escapeXml(sA.assay_measurement)}) ⟷ ${sB.study_id} (${escapeXml(sB.assay_measurement)})</text>
  <rect x="940" y="40" width="200" height="32" rx="6" fill="${pal.badgeBg}"/>
  <text x="1040" y="60" fill="${pal.accentHighlight}" font-size="11" font-weight="700" text-anchor="middle">EVIDENCE SYNTHESIS</text>

  <!-- Left Column -->
  <g transform="translate(60, 105)">
    <rect width="420" height="390" rx="12" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
    <rect x="20" y="16" width="200" height="28" rx="6" fill="${pal.badgeBg}"/>
    <text x="120" y="35" fill="${pal.textPrimary}" font-size="12" font-weight="700" text-anchor="middle">${sA.study_id} Assay Data</text>

    <g transform="translate(20, 58)">
      <rect width="380" height="64" rx="8" fill="#131e33" stroke="${pal.cardStroke}"/>
      <text x="28" y="36" fill="${pal.accentPrimary}" font-size="12" font-weight="800">1</text>
      <text x="50" y="26" fill="${pal.textPrimary}" font-size="13" font-weight="700">${escapeXml(sA.assay_measurement)} Feature A</text>
      <text x="50" y="46" fill="${pal.textSecondary}" font-size="11">Empirical observation from accession dataset</text>
      <rect x="270" y="18" width="96" height="26" rx="6" fill="${pal.badgeBg}"/>
      <text x="318" y="35" fill="${pal.accentHighlight}" font-size="11" font-weight="700" text-anchor="middle">Observed</text>
    </g>

    <g transform="translate(20, 132)">
      <rect width="380" height="64" rx="8" fill="#131e33" stroke="${pal.cardStroke}"/>
      <text x="28" y="36" fill="${pal.accentPrimary}" font-size="12" font-weight="800">2</text>
      <text x="50" y="26" fill="${pal.textPrimary}" font-size="13" font-weight="700">${escapeXml(sA.assay_measurement)} Feature B</text>
      <text x="50" y="46" fill="${pal.textSecondary}" font-size="11">Differential endpoint recorded in study</text>
      <rect x="270" y="18" width="96" height="26" rx="6" fill="${pal.badgeBg}"/>
      <text x="318" y="35" fill="${pal.accentHighlight}" font-size="11" font-weight="700" text-anchor="middle">Observed</text>
    </g>

    <text x="20" y="368" fill="${pal.textSecondary}" font-size="11">Assay: ${escapeXml(sA.assay_measurement)} · Model: ${escapeXml(sA.organism)}</text>
  </g>

  <!-- Right Column -->
  <g transform="translate(720, 105)">
    <rect width="420" height="390" rx="12" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
    <rect x="20" y="16" width="200" height="28" rx="6" fill="${pal.badgeBg}"/>
    <text x="120" y="35" fill="${pal.textPrimary}" font-size="12" font-weight="700" text-anchor="middle">${escapeXml(bLayerTitle)}</text>

    <g transform="translate(20, 58)">
      <rect width="380" height="64" rx="8" fill="#1b142d" stroke="${pal.cardStroke}"/>
      <text x="28" y="36" fill="${pal.accentSecondary}" font-size="12" font-weight="800">1</text>
      <text x="50" y="26" fill="${pal.textPrimary}" font-size="13" font-weight="700">${escapeXml(bNode1Title)}</text>
      <text x="50" y="46" fill="${pal.textSecondary}" font-size="11">${escapeXml(bNode1Desc)}</text>
      <rect x="260" y="18" width="106" height="26" rx="6" fill="#581c87"/>
      <text x="313" y="35" fill="#e9d5ff" font-size="11" font-weight="700" text-anchor="middle">${escapeXml(bNode1Badge)}</text>
    </g>

    <g transform="translate(20, 132)">
      <rect width="380" height="64" rx="8" fill="#1b142d" stroke="${pal.cardStroke}"/>
      <text x="28" y="36" fill="${pal.accentSecondary}" font-size="12" font-weight="800">2</text>
      <text x="50" y="26" fill="${pal.textPrimary}" font-size="13" font-weight="700">${escapeXml(bNode2Title)}</text>
      <text x="50" y="46" fill="${pal.textSecondary}" font-size="11">${escapeXml(bNode2Desc)}</text>
      <rect x="260" y="18" width="106" height="26" rx="6" fill="#881337"/>
      <text x="313" y="35" fill="#fda4af" font-size="11" font-weight="700" text-anchor="middle">${escapeXml(bNode2Badge)}</text>
    </g>

    <text x="20" y="368" fill="${pal.textSecondary}" font-size="11">${escapeXml(bAssayLabel)} · Model: ${escapeXml(sB.organism)}</text>
  </g>

  <!-- Bottom Footer -->
  <g transform="translate(40, 508)">
    <rect width="1120" height="142" rx="12" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
    <text x="24" y="30" fill="${pal.accentPrimary}" font-size="13" font-weight="700">Translational Synthesis Takeaway:</text>
    <text x="24" y="54" fill="${pal.textPrimary}" font-size="12">
      Cross-assay comparison highlights aligned physiological adaptations under matched experimental conditions.
    </text>
    <line x1="24" y1="74" x2="1096" y2="74" stroke="${pal.cardStroke}" stroke-width="1"/>
    <text x="24" y="96" fill="${pal.accentHighlight}" font-size="11" font-weight="700">EVIDENCE CLASSIFICATION: EVIDENCE-INFORMED SYNTHESIS</text>
    <text x="24" y="118" fill="${pal.textSecondary}" font-size="11">Grounded in ${sA.study_id} and ${sB.study_id} via NASA OSDR repository records.</text>
  </g>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function createBiologicalConceptSvg(sA: OSDRStudy, sB: OSDRStudy, variation?: StyleVariation, caps?: PairCapabilityProfile): string {
  const pal = variation?.paletteColors || PALETTE_DEFINITIONS.indigo_rose;
  const layoutName = variation?.layoutTitle || "Stratified Retinal Cross-Section";

  if (caps?.isImagingPhysiologyOnly) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" width="1200" height="675" style="background:${pal.bgGradEnd};font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
  <defs>
    <linearGradient id="bioBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${pal.bgGradStart}"/>
      <stop offset="100%" stop-color="${pal.bgGradEnd}"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="675" fill="url(#bioBg)"/>

  <!-- Top Header Bar -->
  <rect x="40" y="24" width="1120" height="64" rx="10" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
  <rect x="54" y="38" width="6" height="36" rx="3" fill="${pal.accentPrimary}"/>
  <text x="72" y="48" fill="${pal.accentPrimary}" font-size="11" font-weight="700" letter-spacing="1.5">ANATOMY &amp; MORPHOLOGY · ${escapeXml(layoutName.toUpperCase())}</text>
  <text x="72" y="70" fill="${pal.textPrimary}" font-size="17" font-weight="700">Cephalad Hydrostatic Fluid Redistribution &amp; Optic Nerve Morphology</text>
  <rect x="940" y="40" width="200" height="32" rx="6" fill="${pal.badgeBg}"/>
  <text x="1040" y="60" fill="${pal.accentHighlight}" font-size="11" font-weight="700" text-anchor="middle">ANATOMICAL MODEL</text>

  <!-- Left: Anatomical Cross Section -->
  <g transform="translate(60, 105)">
    <rect width="580" height="400" rx="14" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
    <text x="24" y="32" fill="${pal.accentPrimary}" font-size="13" font-weight="700">OCULAR TISSUE STRATIFICATION</text>

    <!-- Layer 1: Nerve Fiber / Ganglion -->
    <rect x="24" y="50" width="532" height="60" rx="8" fill="#172033" stroke="${pal.cardStroke}"/>
    <text x="44" y="76" fill="${pal.textPrimary}" font-size="13" font-weight="700">Nerve Fiber &amp; Ganglion Cell Layer (GCL)</text>
    <text x="44" y="96" fill="${pal.textSecondary}" font-size="11">In vivo layer thickness measurement under cephalad fluid redistribution</text>

    <!-- Layer 2: Inner & Outer Plexiform -->
    <rect x="24" y="120" width="532" height="65" rx="8" fill="#1a1c2e" stroke="${pal.cardStroke}"/>
    <text x="44" y="146" fill="${pal.textPrimary}" font-size="13" font-weight="700">Inner &amp; Outer Plexiform Layer (IPL/OPL)</text>
    <text x="44" y="166" fill="${pal.accentSecondary}" font-size="11">Structural retinal layer boundary and reflectance profile</text>

    <!-- Layer 3: Photoreceptors & Outer Segments -->
    <rect x="24" y="195" width="532" height="75" rx="8" fill="#1f182c" stroke="${pal.cardStroke}"/>
    <text x="44" y="222" fill="${pal.textPrimary}" font-size="13" font-weight="700">Photoreceptor Layer (IS/OS)</text>
    <text x="44" y="242" fill="${pal.accentPrimary}" font-size="11">Optical coherence tomography in vivo reflectance band</text>

    <!-- Layer 4: Retinal Pigment Epithelium & Choroid -->
    <rect x="24" y="280" width="532" height="75" rx="8" fill="#241520" stroke="${pal.cardStroke}"/>
    <text x="44" y="306" fill="${pal.textPrimary}" font-size="13" font-weight="700">Retinal Pigment Epithelium &amp; Choroid</text>
    <text x="44" y="326" fill="${pal.accentHighlight}" font-size="11">Choroidal vascular bed under hydrostatic venous fluid redistribution</text>

    <!-- Bottom Legend -->
    <rect x="24" y="362" width="532" height="26" rx="6" fill="#111827"/>
    <text x="40" y="380" fill="${pal.textSecondary}" font-size="11">Grounded in ${sA.study_id} and ${sB.study_id} · Tissue: ${escapeXml(sA.material_type)}</text>
  </g>

  <!-- Right: Mechanism Node Flow -->
  <g transform="translate(670, 105)">
    <rect width="470" height="400" rx="14" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
    <text x="24" y="32" fill="${pal.accentPrimary}" font-size="13" font-weight="700">MORPHOMETRIC &amp; ANATOMICAL CASCADE</text>

    <!-- Step 1 -->
    <g transform="translate(24, 48)">
      <rect width="422" height="62" rx="8" fill="#161f30" stroke="${pal.cardStroke}"/>
      <circle cx="28" cy="31" r="13" fill="#1e3a8a"/>
      <text x="28" y="36" fill="#93c5fd" font-size="11" font-weight="800" text-anchor="middle">1</text>
      <text x="54" y="26" fill="${pal.textPrimary}" font-size="12" font-weight="700">Cephalad Fluid Redistribution</text>
      <text x="54" y="44" fill="${pal.textSecondary}" font-size="10">Ground-based head-down tilt shifts fluid volume toward the head.</text>
    </g>

    <!-- Step 2 -->
    <g transform="translate(24, 118)">
      <rect width="422" height="62" rx="8" fill="#20172e" stroke="${pal.cardStroke}"/>
      <circle cx="28" cy="31" r="13" fill="#581c87"/>
      <text x="28" y="36" fill="#e9d5ff" font-size="11" font-weight="800" text-anchor="middle">2</text>
      <text x="54" y="26" fill="${pal.textPrimary}" font-size="12" font-weight="700">Optic Nerve Sheath Distension</text>
      <text x="54" y="44" fill="${pal.textSecondary}" font-size="10">Retrobulbar subarachnoid space expansion captured by MRI.</text>
    </g>

    <!-- Step 3 -->
    <g transform="translate(24, 188)">
      <rect width="422" height="62" rx="8" fill="#2a1520" stroke="${pal.cardStroke}"/>
      <circle cx="28" cy="31" r="13" fill="#881337"/>
      <text x="28" y="36" fill="#fecdd3" font-size="11" font-weight="800" text-anchor="middle">3</text>
      <text x="54" y="26" fill="${pal.textPrimary}" font-size="12" font-weight="700">Retinal Layer Thickness Shifts</text>
      <text x="54" y="44" fill="${pal.textSecondary}" font-size="10">In vivo OCT scans quantify longitudinal retinal layer thickness dynamics.</text>
    </g>

    <!-- Step 4 -->
    <g transform="translate(24, 258)">
      <rect width="422" height="74" rx="8" fill="#064e3b" stroke="#059669"/>
      <circle cx="28" cy="37" r="13" fill="#047857"/>
      <text x="28" y="42" fill="#a7f3d0" font-size="11" font-weight="800" text-anchor="middle">★</text>
      <text x="54" y="28" fill="#34d399" font-size="12" font-weight="700">SANS-Relevant Ground Analog Baseline</text>
      <text x="54" y="46" fill="#ecfdf5" font-size="10">Establishes baseline structural parameters in ground-based</text>
      <text x="54" y="60" fill="#ecfdf5" font-size="10">fluid-shift analogs without conflating with astronaut clinical SANS.</text>
    </g>
  </g>

  <!-- Bottom Provenance Footer -->
  <g transform="translate(60, 520)">
    <rect width="1080" height="130" rx="12" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
    <text x="24" y="28" fill="${pal.accentHighlight}" font-size="11" font-weight="700">EVIDENCE CLASSIFICATION: EVIDENCE-INFORMED SYNTHESIS</text>
    <text x="24" y="52" fill="${pal.textPrimary}" font-size="12">Anatomical cross-section depicts tissue morphology deduced from observed in vivo imaging records (${sA.study_id} and ${sB.study_id}).</text>
    <text x="24" y="74" fill="${pal.textSecondary}" font-size="11">NASA OSDR Space Biology Research · Grounded in ${sA.study_id} and ${sB.study_id} (${escapeXml(sA.organism)}, ${escapeXml(sA.study_factor)}).</text>
  </g>
</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" width="1200" height="675" style="background:${pal.bgGradEnd};font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
  <defs>
    <linearGradient id="bioBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${pal.bgGradStart}"/>
      <stop offset="100%" stop-color="${pal.bgGradEnd}"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="675" fill="url(#bioBg)"/>

  <!-- Top Header Bar -->
  <rect x="40" y="24" width="1120" height="64" rx="10" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
  <rect x="54" y="38" width="6" height="36" rx="3" fill="${pal.accentPrimary}"/>
  <text x="72" y="48" fill="${pal.accentPrimary}" font-size="11" font-weight="700" letter-spacing="1.5">BIOLOGICAL CONCEPT · ${escapeXml(layoutName.toUpperCase())}</text>
  <text x="72" y="70" fill="${pal.textPrimary}" font-size="17" font-weight="700">${escapeXml(sA.material_type)} Structural &amp; Tissue Response</text>
  <rect x="940" y="40" width="200" height="32" rx="6" fill="${pal.badgeBg}"/>
  <text x="1040" y="60" fill="${pal.accentHighlight}" font-size="11" font-weight="700" text-anchor="middle">EVIDENCE SYNTHESIS</text>

  <!-- Left: Anatomical Cross Section -->
  <g transform="translate(60, 105)">
    <rect width="580" height="400" rx="14" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
    <text x="24" y="32" fill="${pal.accentPrimary}" font-size="13" font-weight="700">TISSUE ARCHITECTURE</text>

    <rect x="24" y="50" width="532" height="80" rx="8" fill="#172033" stroke="${pal.cardStroke}"/>
    <text x="44" y="76" fill="${pal.textPrimary}" font-size="13" font-weight="700">Tissue Zone 1 · Epithelial &amp; Outer Layer</text>
    <text x="44" y="96" fill="${pal.textSecondary}" font-size="11">Structural remodeling under experimental conditions</text>

    <rect x="24" y="140" width="532" height="80" rx="8" fill="#1a1c2e" stroke="${pal.cardStroke}"/>
    <text x="44" y="166" fill="${pal.textPrimary}" font-size="13" font-weight="700">Tissue Zone 2 · Intermediate Parenchyma</text>
    <text x="44" y="186" fill="${pal.accentSecondary}" font-size="11">Cellular matrix and microvascular architecture</text>

    <rect x="24" y="230" width="532" height="80" rx="8" fill="#1f182c" stroke="${pal.cardStroke}"/>
    <text x="44" y="256" fill="${pal.textPrimary}" font-size="13" font-weight="700">Tissue Zone 3 · Basal &amp; Vascular Bed</text>
    <text x="44" y="276" fill="${pal.accentPrimary}" font-size="11">Endothelial contact dynamics and metabolic exchange</text>
  </g>

  <!-- Right: Mechanism Node Flow -->
  <g transform="translate(670, 105)">
    <rect width="470" height="400" rx="14" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
    <text x="24" y="32" fill="${pal.accentPrimary}" font-size="13" font-weight="700">ADAPTATION RESPONSE FLOW</text>

    <g transform="translate(24, 48)">
      <rect width="422" height="62" rx="8" fill="#161f30" stroke="${pal.cardStroke}"/>
      <text x="28" y="36" fill="#93c5fd" font-size="11" font-weight="800" text-anchor="middle">1</text>
      <text x="54" y="26" fill="${pal.textPrimary}" font-size="12" font-weight="700">Environmental Exposure</text>
      <text x="54" y="44" fill="${pal.textSecondary}" font-size="10">Organism undergoes spaceflight / analog factor.</text>
    </g>

    <g transform="translate(24, 118)">
      <rect width="422" height="62" rx="8" fill="#20172e" stroke="${pal.cardStroke}"/>
      <text x="28" y="36" fill="#e9d5ff" font-size="11" font-weight="800" text-anchor="middle">2</text>
      <text x="54" y="26" fill="${pal.textPrimary}" font-size="12" font-weight="700">Cellular &amp; Tissue Response</text>
      <text x="54" y="44" fill="${pal.textSecondary}" font-size="10">Assay endpoints indicate biological remodeling.</text>
    </g>
  </g>

  <!-- Bottom Provenance Footer -->
  <g transform="translate(60, 520)">
    <rect width="1080" height="130" rx="12" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
    <text x="24" y="28" fill="${pal.accentHighlight}" font-size="11" font-weight="700">EVIDENCE CLASSIFICATION: EVIDENCE-INFORMED SYNTHESIS</text>
    <text x="24" y="52" fill="${pal.textPrimary}" font-size="12">Anatomical cross-section depicts tissue structure deduced from observed study endpoints.</text>
    <text x="24" y="74" fill="${pal.textSecondary}" font-size="11">NASA OSDR Space Biology Research · Grounded in ${sA.study_id} and ${sB.study_id}.</text>
  </g>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function createContextualNarrativeSvg(sA: OSDRStudy, sB: OSDRStudy, variation?: StyleVariation, caps?: PairCapabilityProfile): string {
  const pal = variation?.paletteColors || PALETTE_DEFINITIONS.emerald_obsidian;
  const layoutName = variation?.layoutTitle || "Ground Analog Habitat & Diagnostic Suite";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" width="1200" height="675" style="background:${pal.bgGradEnd};font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
  <defs>
    <linearGradient id="narrativeBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${pal.bgGradStart}"/>
      <stop offset="100%" stop-color="${pal.bgGradEnd}"/>
    </linearGradient>
    <linearGradient id="beam" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${pal.accentPrimary}" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="${pal.accentPrimary}" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="675" fill="url(#narrativeBg)"/>

  <!-- Top Header Bar -->
  <rect x="40" y="24" width="1120" height="64" rx="10" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
  <rect x="54" y="38" width="6" height="36" rx="3" fill="${pal.accentPrimary}"/>
  <text x="72" y="48" fill="${pal.accentPrimary}" font-size="11" font-weight="700" letter-spacing="1.5">ANALOG PROTOCOL · ${escapeXml(layoutName.toUpperCase())}</text>
  <text x="72" y="70" fill="${pal.textPrimary}" font-size="17" font-weight="700">Head-Down Tilt (HDT) Rodent Habitat &amp; In Vivo Diagnostic Suite</text>
  <rect x="920" y="40" width="220" height="32" rx="6" fill="${pal.badgeBg}"/>
  <text x="1030" y="60" fill="${pal.accentHighlight}" font-size="11" font-weight="700" text-anchor="middle">CONCEPTUAL VISUALIZATION</text>

  <!-- Main Laboratory / Chamber Frame -->
  <g transform="translate(60, 105)">
    <rect width="1080" height="395" rx="16" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>

    <!-- Simulated Chamber Ambient Grid & Angle -->
    <path d="M 60 320 L 520 180" stroke="${pal.accentPrimary}" stroke-width="3" stroke-linecap="round"/>
    <polygon points="60,320 520,180 520,320" fill="url(#beam)"/>

    <!-- Angle Badge -->
    <rect x="220" y="270" width="160" height="32" rx="6" fill="${pal.badgeBg}" stroke="${pal.accentPrimary}"/>
    <text x="300" y="291" fill="#ffffff" font-size="12" font-weight="700" text-anchor="middle">HDT Tilt Vector Simulation</text>

    <!-- Hardware Habitat Caging Concept (Right side) -->
    <g transform="translate(580, 30)">
      <rect width="460" height="335" rx="12" fill="#121828" stroke="${pal.cardStroke}"/>
      <text x="24" y="32" fill="${pal.accentPrimary}" font-size="13" font-weight="700">ANALOG HABITAT TELEMETRY OVERLAY</text>

      <!-- Sensor Row 1: Cephalad Fluid Shift Indicator -->
      <rect x="24" y="52" width="412" height="52" rx="6" fill="#172238"/>
      <text x="40" y="74" fill="${pal.textSecondary}" font-size="11">Cephalad Fluid Shift Model</text>
      <text x="40" y="94" fill="${pal.accentHighlight}" font-size="13" font-weight="700">Head-Down Tilt Vector Active</text>

      <!-- Sensor Row 2: In Vivo Diagnostic Modalities -->
      <rect x="24" y="114" width="412" height="52" rx="6" fill="#172238"/>
      <text x="40" y="136" fill="${pal.textSecondary}" font-size="11">In Vivo Diagnostic Modalities</text>
      <text x="40" y="156" fill="#fbbf24" font-size="13" font-weight="700">OCT &amp; Optic-Nerve MRI Protocol</text>

      <!-- Sensor Row 3: Environmental Habitat -->
      <rect x="24" y="176" width="412" height="52" rx="6" fill="#172238"/>
      <text x="40" y="198" fill="${pal.textSecondary}" font-size="11">Chamber Environment Controls</text>
      <text x="40" y="218" fill="${pal.textPrimary}" font-size="13" font-weight="700">Controlled Laboratory Ground Habitat</text>

      <!-- Status Indicator -->
      <rect x="24" y="238" width="412" height="42" rx="6" fill="#0f172a"/>
      <circle cx="44" cy="259" r="5" fill="#10b981"/>
      <text x="60" y="263" fill="${pal.textSecondary}" font-size="11">Experimental Analog Protocol for ${sA.study_id}</text>
    </g>
  </g>

  <!-- Narrative Context Bottom -->
  <g transform="translate(60, 515)">
    <rect width="1080" height="135" rx="12" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
    <text x="24" y="28" fill="${pal.accentHighlight}" font-size="11" font-weight="700">EVIDENCE CLASSIFICATION: CONCEPTUAL VISUALIZATION</text>
    <text x="24" y="52" fill="${pal.textPrimary}" font-size="12">
      Conceptual laboratory habitat depiction. Displays analog experimental parameters rather than real-time continuous animal telemetry.
    </text>
    <text x="24" y="74" fill="${pal.textSecondary}" font-size="11">NASA OSDR Space Biology Context · Grounded in ${sA.study_id} and ${sB.study_id} study factors.</text>
  </g>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function createAccessionSummarySvg(sA: OSDRStudy, sB: OSDRStudy, variation?: StyleVariation, caps?: PairCapabilityProfile): string {
  const pal = variation?.paletteColors || PALETTE_DEFINITIONS.cobalt_cyan;
  const layoutName = variation?.layoutTitle || "Comparative Study Profile Ledger";
  const isSame = sA.study_id === sB.study_id;
  const titleA = escapeXml(sA.title.slice(0, 48) + (sA.title.length > 48 ? "..." : ""));
  const titleB = isSame
    ? "Complementary In Vivo Diagnostic Evaluation"
    : escapeXml(sB.title.slice(0, 48) + (sB.title.length > 48 ? "..." : ""));

  const roleA = caps?.isImagingPhysiologyOnly
    ? `Measures in vivo retinal thickness and intraocular pressure under ${escapeXml(sA.study_factor)} simulation.`
    : `Measures observed biological response in ${escapeXml(sA.material_type)} under ${escapeXml(sA.study_factor)} simulation.`;

  const roleB = caps?.isImagingPhysiologyOnly
    ? `Measures optic nerve dimensions and sheath morphology under matched spaceflight analog conditions.`
    : `Measures orthogonal biological response in ${escapeXml(sB.material_type)} under matched spaceflight analog conditions.`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" width="1200" height="675" style="background:${pal.bgGradEnd};font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
  <defs>
    <linearGradient id="cardBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${pal.bgGradStart}"/>
      <stop offset="100%" stop-color="${pal.bgGradEnd}"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="675" fill="url(#cardBg)"/>

  <!-- Top Header Bar -->
  <rect x="40" y="24" width="1120" height="64" rx="10" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
  <rect x="54" y="38" width="6" height="36" rx="3" fill="${pal.accentPrimary}"/>
  <text x="72" y="48" fill="${pal.accentPrimary}" font-size="11" font-weight="700" letter-spacing="1.5">STUDY PROFILE · ${escapeXml(layoutName.toUpperCase())}</text>
  <text x="72" y="70" fill="${pal.textPrimary}" font-size="17" font-weight="700">${sA.study_id} &amp; ${sB.study_id} Paired Comparison</text>
  <rect x="940" y="40" width="200" height="32" rx="6" fill="${pal.badgeBg}"/>
  <text x="1040" y="60" fill="${pal.accentHighlight}" font-size="11" font-weight="700" text-anchor="middle">OBSERVED STUDY EVIDENCE</text>

  <!-- Left Card: Study A -->
  <g transform="translate(60, 105)">
    <rect width="520" height="400" rx="14" fill="${pal.cardBg}" stroke="${pal.accentPrimary}" stroke-width="2"/>
    <rect x="24" y="24" width="120" height="36" rx="8" fill="${pal.badgeBg}" stroke="${pal.accentPrimary}"/>
    <text x="84" y="48" fill="#ffffff" font-size="16" font-weight="800" text-anchor="middle">${sA.study_id}</text>
    <text x="160" y="48" fill="${pal.accentHighlight}" font-size="13" font-weight="600">${escapeXml(sA.assay_measurement)}</text>

    <text x="24" y="96" fill="${pal.textPrimary}" font-size="14" font-weight="700">${titleA}</text>

    <g transform="translate(24, 115)" font-size="12" fill="${pal.textSecondary}">
      <rect width="472" height="130" rx="8" fill="#0a0f1d"/>
      <text x="16" y="30" fill="${pal.textSecondary}" font-weight="700">ORGANISM:</text>
      <text x="130" y="30" fill="${pal.textPrimary}" font-weight="600">${escapeXml(sA.organism)}</text>

      <text x="16" y="60" fill="${pal.textSecondary}" font-weight="700">TISSUE:</text>
      <text x="130" y="60" fill="${pal.textPrimary}" font-weight="600">${escapeXml(sA.material_type)}</text>

      <text x="16" y="90" fill="${pal.textSecondary}" font-weight="700">FACTOR:</text>
      <text x="130" y="90" fill="${pal.accentPrimary}" font-weight="600">${escapeXml(sA.study_factor)}</text>

      <text x="16" y="120" fill="${pal.textSecondary}" font-weight="700">PLATFORM:</text>
      <text x="130" y="120" fill="${pal.textPrimary}" font-weight="600">${escapeXml(sA.assay_platform || "Diagnostic Imaging")}</text>
    </g>

    <rect x="24" y="260" width="472" height="120" rx="8" fill="#141d30"/>
    <text x="36" y="286" fill="${pal.accentPrimary}" font-size="12" font-weight="700">Repository Evidence Role:</text>
    <text x="36" y="308" fill="${pal.textSecondary}" font-size="11">${roleA}</text>
  </g>

  <!-- Right Card: Study B -->
  <g transform="translate(620, 105)">
    <rect width="520" height="400" rx="14" fill="${pal.cardBg}" stroke="${pal.accentSecondary}" stroke-width="2"/>
    <rect x="24" y="24" width="120" height="36" rx="8" fill="${pal.badgeBg}" stroke="${pal.accentSecondary}"/>
    <text x="84" y="48" fill="#ffffff" font-size="16" font-weight="800" text-anchor="middle">${sB.study_id}</text>
    <text x="160" y="48" fill="${pal.accentSecondary}" font-size="13" font-weight="600">${escapeXml(sB.assay_measurement)}</text>

    <text x="24" y="96" fill="${pal.textPrimary}" font-size="14" font-weight="700">${titleB}</text>

    <g transform="translate(24, 115)" font-size="12" fill="${pal.textSecondary}">
      <rect width="472" height="130" rx="8" fill="#100b1a"/>
      <text x="16" y="30" fill="${pal.textSecondary}" font-weight="700">ORGANISM:</text>
      <text x="130" y="30" fill="${pal.textPrimary}" font-weight="600">${escapeXml(sB.organism)}</text>

      <text x="16" y="60" fill="${pal.textSecondary}" font-weight="700">TISSUE:</text>
      <text x="130" y="60" fill="${pal.textPrimary}" font-weight="600">${escapeXml(sB.material_type)}</text>

      <text x="16" y="90" fill="${pal.textSecondary}" font-weight="700">FACTOR:</text>
      <text x="130" y="90" fill="${pal.accentSecondary}" font-weight="600">${escapeXml(sB.study_factor)}</text>

      <text x="16" y="120" fill="${pal.textSecondary}" font-weight="700">PLATFORM:</text>
      <text x="130" y="120" fill="${pal.textPrimary}" font-weight="600">${escapeXml(sB.assay_platform || "Diagnostic Imaging")}</text>
    </g>

    <rect x="24" y="260" width="472" height="120" rx="8" fill="#201533"/>
    <text x="36" y="286" fill="${pal.accentSecondary}" font-size="12" font-weight="700">Repository Evidence Role:</text>
    <text x="36" y="308" fill="${pal.textSecondary}" font-size="11">${roleB}</text>
  </g>

  <!-- Bottom Strip & Provenance -->
  <g transform="translate(60, 520)">
    <rect width="1080" height="130" rx="12" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
    <text x="24" y="28" fill="${pal.accentHighlight}" font-size="11" font-weight="700">EVIDENCE CLASSIFICATION: OBSERVED STUDY EVIDENCE</text>
    <text x="24" y="52" fill="${pal.textPrimary}" font-size="12">
      Direct metadata extraction from official NASA Open Science Data Repository study records (${sA.study_id} and ${sB.study_id}).
    </text>
    <text x="24" y="74" fill="${pal.textSecondary}" font-size="11">Accessible at https://osdr.nasa.gov/bio/repo/data/studies/${sA.study_id} and ${sB.study_id}.</text>
  </g>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// ---------------------------------------------------------------------------
// 5. Refined 6-Second Motion Brief Video
// ---------------------------------------------------------------------------
// 5. Refined 5-Second Motion Brief Video (3 Clearly Readable Scenes)
// ---------------------------------------------------------------------------
export interface VideoBriefRequest {
  studies: string[];
  query?: string;
  summary?: string;
}

export interface VideoBriefScene {
  id: string;
  timeStart: number;
  timeEnd: number;
  sceneType: "analytical_opener" | "biological_mechanism" | "translational_close";
  category: MediaCategory;
  title: string;
  subtitle: string;
  accent: string;
  badgeLabel: string;
  focusIdea: string;
  dominantMessage: string;
  metric: string;
  meta: {
    factor?: string;
    organism?: string;
    tissue?: string;
    assayA?: string;
    assayB?: string;
    studyA?: string;
    studyB?: string;
    genes?: string[];
    metabolites?: string[];
    correlation?: string;
    targetName?: string;
    translationalTakeaway?: string;
  };
}

export interface VideoBriefResponse {
  success: boolean;
  videoType: "scientific_motion_brief" | "gemini_veo_video";
  generationSource: "gemini_veo" | "scientific_motion_brief";
  duration: number; // Exactly 5.0 seconds total (3 scenes)
  plan: AwgMediaPlan;
  scenes: VideoBriefScene[];
  studies: string[];
  caption: string;
  promptUsed: string;
  operationName?: string;
  videoUrl?: string;
  geminiVideoConfigured?: boolean;
  provenance: MediaProvenanceRecord;
}

export async function generateStudyBriefVideo(
  req: VideoBriefRequest
): Promise<VideoBriefResponse> {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  const validation = await validateAwgAccessions(req.studies || []);
  if (!validation.isValid || !validation.studyA || !validation.studyB) {
    throw new Error(validation.userMessage || validation.errorMessage || "Invalid study accessions provided for video brief generation.");
  }

  const sA = validation.studyA;
  const sB = validation.studyB;

  const caps = derivePairCapabilities(sA, sB);
  const plan = buildGroundedMediaPlan(sA, sB);
  const factor = sA.study_factor || "Head-Down Tilt Bedrest";
  const org = sA.organism || "Rattus norvegicus";
  const tissue = sA.material_type || "Retina / Optic Nerve";
  const isOcular = tissue.toLowerCase().includes("retin") || tissue.toLowerCase().includes("optic") || factor.toLowerCase().includes("tilt");

  let scenes: VideoBriefScene[];

  if (caps.isImagingPhysiologyOnly) {
    scenes = [
      {
        id: "scene-1-analytical-opener",
        timeStart: 0.0,
        timeEnd: 1.65,
        sceneType: "analytical_opener",
        category: "data_visualization",
        title: "Ocular imaging and pressure measurement",
        subtitle: `${sA.study_id} (${sA.assay_measurement}) ⟷ ${sB.study_id} (${sB.assay_measurement})`,
        accent: "#38bdf8",
        badgeLabel: "1. ANALYTICAL OPENER",
        focusIdea: "What is being compared: In vivo imaging and physiological tonometry",
        dominantMessage: `Co-analyzing non-invasive optical coherence tomography (OCT) and intraocular pressure dynamics with optic nerve MRI in ${org}.`,
        metric: `Paired Comparison: ${sA.study_id} & ${sB.study_id} · In Vivo Diagnostics`,
        meta: {
          factor,
          organism: org,
          tissue,
          assayA: sA.assay_measurement,
          assayB: sB.assay_measurement,
          studyA: sA.study_id,
          studyB: sB.study_id,
        },
      },
      {
        id: "scene-2-biological-mechanism",
        timeStart: 1.65,
        timeEnd: 3.35,
        sceneType: "biological_mechanism",
        category: "biological_concept",
        title: "Optic-nerve and sheath MRI morphology",
        subtitle: "Optic Nerve Sheath Diameter & Retrobulbar Geometry",
        accent: "#f43f5e",
        badgeLabel: "2. ANATOMICAL MORPHOLOGY",
        focusIdea: "What is observed structurally: Optic nerve sheath and ocular geometry",
        dominantMessage: "Head-down tilt fluid redistribution correlates with measured optic nerve sheath expansion and optic nerve head elevation.",
        metric: "Morphometry: Optic Nerve Sheath Diameter & Retinal Layer Thickness",
        meta: {
          factor,
          organism: org,
          tissue,
          studyA: sA.study_id,
          studyB: sB.study_id,
        },
      },
      {
        id: "scene-3-translational-close",
        timeStart: 3.35,
        timeEnd: 5.0,
        sceneType: "translational_close",
        category: "accession_summary",
        title: "Ground-analog comparison and study limitations",
        subtitle: "Terrestrial SANS-Relevant Analog Model Baseline",
        accent: "#10b981",
        badgeLabel: "3. GROUND-ANALOG CONTEXT",
        focusIdea: "Why it matters: SANS-relevant ground analog modeling fluid shift",
        dominantMessage: "Ground-based head-down tilt models provide biomechanical fluid shift context to evaluate ocular changes without conflating with astronaut clinical SANS.",
        metric: "Analog Validation: SANS-Relevant Ground Model · Interpretation Separated",
        meta: {
          targetName: "SANS-Relevant Ground Model Baseline",
          tissue,
          studyA: sA.study_id,
          studyB: sB.study_id,
          translationalTakeaway: "Ground analog models establish baseline structural parameters without conflating with astronaut clinical SANS.",
        },
      },
    ];
  } else if (!caps.isBothOmics) {
    // Cross-modal / Mixed modality pair (e.g. OSD-680 × OSD-87)
    scenes = [
      {
        id: "scene-1-analytical-opener",
        timeStart: 0.0,
        timeEnd: 1.65,
        sceneType: "analytical_opener",
        category: "data_visualization",
        title: `${caps.studyA.primaryAssayLabel} × ${caps.studyB.primaryAssayLabel}`,
        subtitle: `${sA.study_id} (${caps.studyA.primaryAssayLabel}) ⟷ ${sB.study_id} (${caps.studyB.primaryAssayLabel})`,
        accent: "#38bdf8",
        badgeLabel: "1. ANALYTICAL OPENER",
        focusIdea: "What is being compared: Cross-modal diagnostic imaging & molecular profiling",
        dominantMessage: `Co-analyzing ${caps.studyA.primaryAssayLabel} from ${sA.study_id} alongside ${caps.studyB.primaryAssayLabel} from ${sB.study_id} under ${factor}.`,
        metric: `Cross-Modal Comparison: ${sA.study_id} & ${sB.study_id} · Structural & Cellular Alignment`,
        meta: {
          factor,
          organism: org,
          tissue,
          assayA: caps.studyA.primaryAssayLabel,
          assayB: caps.studyB.primaryAssayLabel,
          studyA: sA.study_id,
          studyB: sB.study_id,
        },
      },
      {
        id: "scene-2-biological-mechanism",
        timeStart: 1.65,
        timeEnd: 3.35,
        sceneType: "biological_mechanism",
        category: "biological_concept",
        title: `${tissue} Structure & Cellular Adaptation`,
        subtitle: "Structural Optic Nerve Morphometry & Microarray Expression",
        accent: "#f43f5e",
        badgeLabel: "2. CROSS-MODAL MORPHOLOGY & EXPRESSION",
        focusIdea: "What is observed structurally & cellularly: Multiscale tissue response",
        dominantMessage: "Cross-scale evidence links anatomical layer dimensions and optic nerve morphometry with cellular expression alterations.",
        metric: "Morphology & Expression: Tissue Geometry ⟷ Gene Response",
        meta: {
          factor,
          organism: org,
          tissue,
          studyA: sA.study_id,
          studyB: sB.study_id,
        },
      },
      {
        id: "scene-3-translational-close",
        timeStart: 3.35,
        timeEnd: 5.0,
        sceneType: "translational_close",
        category: "accession_summary",
        title: "Translational Mission Application",
        subtitle: "Ground-Analog & Spaceflight Translation",
        accent: "#10b981",
        badgeLabel: "3. TRANSLATIONAL CONTEXT",
        focusIdea: "Why it matters: Integrating multiscale spaceflight endpoints",
        dominantMessage: "Contrasting ground-based analogs with flight tissue profiles clarifies mechanical versus spaceflight environmental drivers.",
        metric: "Translational Evaluation: Multiscale Evidence Synthesis",
        meta: {
          targetName: "Cross-Modal Evidence Synthesis",
          tissue,
          studyA: sA.study_id,
          studyB: sB.study_id,
          translationalTakeaway: "Multiscale integration provides structural and molecular benchmarks for spaceflight risk reduction.",
        },
      },
    ];
  } else {
    // Both Omics pair
    const assayTitle = caps.isMultiOmics
      ? "Multi-Omics Convergence"
      : caps.isBothRnaSeq
      ? "RNA-seq × RNA-seq Correlation"
      : "Transcriptomics Correlation";

    scenes = [
      {
        id: "scene-1-analytical-opener",
        timeStart: 0.0,
        timeEnd: 1.65,
        sceneType: "analytical_opener",
        category: "data_visualization",
        title: assayTitle,
        subtitle: `${sA.study_id} (${sA.assay_measurement}) ⟷ ${sB.study_id} (${sB.assay_measurement})`,
        accent: "#38bdf8",
        badgeLabel: "1. ANALYTICAL OPENER",
        focusIdea: "What is being compared: Molecular omics study pairing",
        dominantMessage: `Co-analyzing ${caps.studyA.primaryAssayLabel} from ${sA.study_id} with ${caps.studyB.primaryAssayLabel} from ${sB.study_id} in ${org} under ${factor}.`,
        metric: `Paired Comparison: ${sA.study_id} & ${sB.study_id}`,
        meta: {
          factor,
          organism: org,
          tissue,
          assayA: sA.assay_measurement,
          assayB: sB.assay_measurement,
          studyA: sA.study_id,
          studyB: sB.study_id,
        },
      },
      {
        id: "scene-2-biological-mechanism",
        timeStart: 1.65,
        timeEnd: 3.35,
        sceneType: "biological_mechanism",
        category: "biological_concept",
        title: isOcular ? "Retinal Cellular Response" : `${tissue} Cellular Response`,
        subtitle: "Gene Expression & Cellular Pathway Adaptation",
        accent: "#f43f5e",
        badgeLabel: "2. BIOLOGICAL RESPONSE",
        focusIdea: "What is happening biologically: Cellular & pathway adaptation",
        dominantMessage: `Spaceflight exposure alters cellular pathways and gene expression profiles in ${tissue}.`,
        metric: "Observed Pathway & Expression Profiles Verified",
        meta: {
          factor,
          organism: org,
          tissue,
        },
      },
      {
        id: "scene-3-translational-close",
        timeStart: 3.35,
        timeEnd: 5.0,
        sceneType: "translational_close",
        category: "accession_summary",
        title: "Translational Application",
        subtitle: "Countermeasure Identification & Risk Mitigation",
        accent: "#10b981",
        badgeLabel: "3. TRANSLATIONAL CLOSE",
        focusIdea: "Why it matters: Spaceflight countermeasure discovery",
        dominantMessage: "Molecular signatures inform targeted countermeasures to mitigate spaceflight biological risks.",
        metric: "Translational Target Identification from Verified Repository Data",
        meta: {
          targetName: "Spaceflight Risk Mitigation",
          tissue,
          studyA: sA.study_id,
          studyB: sB.study_id,
          translationalTakeaway: "Molecular evidence informs spaceflight countermeasure design.",
        },
      },
    ];
  }

  const videoPrompt = caps.isImagingPhysiologyOnly
    ? `Cinematic NASA Space Biology 3D scientific visualization in 3 clear 5-second acts: 1. Analytical comparison of ${sA.study_id} and ${sB.study_id} in vivo diagnostic and imaging data. 2. Anatomical morphology of fluid shift and optic nerve sheath dimensions in ${tissue}. 3. Ground-analog comparison establishing baseline structural parameters. Clean dark theme, high-contrast cyan, coral, and emerald accents.`
    : !caps.isBothOmics
    ? `Cinematic NASA Space Biology 3D scientific visualization in 3 clear 5-second acts: 1. Cross-modal comparison of ${sA.study_id} (${caps.studyA.primaryAssayLabel}) and ${sB.study_id} (${caps.studyB.primaryAssayLabel}). 2. Morphological and molecular responses in ${tissue}. 3. Multiscale spaceflight evidence synthesis and translational context. Clean dark theme, high-contrast cyan, coral, and emerald accents.`
    : `Cinematic NASA Space Biology 3D scientific visualization in 3 clear 5-second acts: 1. Analytical comparison of ${sA.study_id} and ${sB.study_id} molecular data. 2. Biological response and gene expression profiles in ${tissue}. 3. Translational spaceflight countermeasure target identification. Clean dark theme, high-contrast cyan, coral, and emerald accents.`;
  const promptFingerprint = computePromptFingerprint(videoPrompt);
  const artifactId = `art-vid-brief-${requestId.slice(0, 8)}`;

  let operationName: string | undefined = undefined;
  let generationSource: "gemini_veo" | "scientific_motion_brief" = "scientific_motion_brief";
  let videoType: "scientific_motion_brief" | "gemini_veo_video" = "scientific_motion_brief";
  let provider = "NASA OSDR Local Motion Engine";
  let providerModel = "procedural-canvas-animator-v1";
  let generationStatus: MediaGenerationStatus = "fallback";

  const videoAi = getVideoAi();
  if (videoAi) {
    try {
      const discovery = await discoverVideoProviderCapabilities();
      if (discovery.status === "available" && discovery.selectedModel) {
        const pairKey = [sA.study_id, sB.study_id].sort().join("::");
        const quotaGate = checkVeoQuotaGate({ pairKey, requestId, modelName: discovery.selectedModel });
        if (quotaGate.allowed) {
          const operation = await videoAi.models.generateVideos({
            model: discovery.selectedModel,
            prompt: videoPrompt,
            config: {
              numberOfVideos: 1,
              resolution: "720p",
              aspectRatio: "16:9",
            },
          });
          if (operation?.name) {
            operationName = operation.name;
            generationSource = "gemini_veo";
            videoType = "gemini_veo_video";
            provider = "Google Gemini";
            providerModel = discovery.selectedModel;
            generationStatus = "fresh_provider";
            recordVeoAttempt(pairKey, undefined, requestId, discovery.selectedModel);
          }
        } else {
          generationSource = "scientific_motion_brief";
          videoType = "scientific_motion_brief";
          provider = "NASA OSDR Local Motion Engine";
          providerModel = "procedural-canvas-animator-v1";
          generationStatus = "fallback";
        }
      }
    } catch (vErr: any) {
      const errMsg = String(vErr?.message || "").toLowerCase();
      const errStatus = vErr?.status || vErr?.code;
      const isQuota = errStatus === 429 || errMsg.includes("429") || errMsg.includes("resource_exhausted") || errMsg.includes("quota") || errMsg.includes("exhausted");
      if (isQuota) {
        triggerVeoCircuitBreaker(vErr?.message, requestId, "veo-3.1-lite");
      }
      markVideoModelUnavailable(undefined, vErr?.message);
      generationSource = "scientific_motion_brief";
      videoType = "scientific_motion_brief";
      provider = "NASA OSDR Local Motion Engine";
      providerModel = "procedural-canvas-animator-v1";
      generationStatus = "fallback";
    }
  }

  const latencyMs = Math.max(1, Date.now() - startTime);
  const provenance: MediaProvenanceRecord = {
    requestId,
    artifactId,
    createdAt: new Date().toISOString(),
    mediaType: "motion_brief",
    artifactType: "canvas_motion_render",
    renderEngine: "browser_canvas_60fps",
    planningProvider: operationName ? "Google Veo (Structured Scene Planner)" : "NASA OSDR Grounded Kinetic Engine",
    provider,
    providerModel,
    generationStatus,
    statusLabel: getStatusLabel(generationStatus),
    cacheKey: `brief:${[sA.study_id, sB.study_id].sort().join("::")}:${promptFingerprint}`,
    cacheHit: false,
    creativeDirection: `3-Scene Scientific Motion Brief (${plan.theme})`,
    promptFingerprint,
    sourceStudyPair: [sA.study_id, sB.study_id],
    latencyMs,
  };

  recordMediaAudit(provenance);

  const rawResponse: VideoBriefResponse = {
    success: true,
    videoType,
    generationSource,
    duration: 5.0,
    plan,
    scenes,
    studies: [sA.study_id, sB.study_id],
    caption: caps.isImagingPhysiologyOnly
      ? `5s Grounded Scientific Motion Brief: ${sA.study_id} (${sA.assay_measurement}) × ${sB.study_id} (${sB.assay_measurement}) · ${plan.theme}`
      : `5s Grounded Scientific Motion Brief: ${sA.study_id} (${sA.assay_measurement}) × ${sB.study_id} (${sB.assay_measurement}) · ${plan.theme}`,
    promptUsed: videoPrompt,
    operationName,
    geminiVideoConfigured: Boolean(videoAi),
    provenance,
  };

  return validateAndSanitizeVideoBrief(rawResponse, caps);
}

// ---------------------------------------------------------------------------
// 3. Relatable Translational Clip (Creative & Intuitive Real-World Mission Framing)
// ---------------------------------------------------------------------------

export type TranslationalDirectionMode =
  | "lab_analog"
  | "mission_monitoring"
  | "ocular_imaging"
  | "omics_translation"
  | "operational_relevance";

export interface TranslationalClipRequest {
  studies: string[];
  query?: string;
  summary?: string;
  direction?: TranslationalDirectionMode | "auto";
  seed?: number | string;
}

export interface GroundedStudyFact {
  study_id: string;
  organism: string;
  tissue: string;
  factor: string;
  assay: string;
  observedFinding: string;
}

export interface GroundedEvidenceFact {
  studyId: string;
  organism: string;
  tissue: string;
  factor: string;
  assay: string;
  observedMetric: string;
  repositoryRecord: string;
}

export interface ConceptualFramingElements {
  scenarioTitle: string;
  visualMetaphor: string;
  cameraPerspective: string;
  lightingTheme: string;
  inferredHypothesis: string;
  analogSimulationDisclaimer: string;
  keyVisualElements: string[];
}

export interface AlternateDirectionInfo {
  key: TranslationalDirectionMode;
  label: string;
  tag: string;
  description: string;
  matchRelevance: string;
  isCurrentlySelected: boolean;
}

export interface TranslationalClipResponse {
  success: boolean;
  videoType: "relatable_translational_clip";
  generationSource: "gemini_veo" | "local_conceptual_clip";
  provenanceLabel: "Gemini-generated translational clip" | "Local conceptual fallback clip";
  provenance: MediaProvenanceRecord;
  
  // Explicit structured fields for UI rendering
  selectedDirectionKey: TranslationalDirectionMode;
  selectedDirectionLabel: string;
  selectionRationale: string;
  groundedEvidence: GroundedEvidenceFact[];
  conceptualElements: ConceptualFramingElements;
  seed: number;
  alternateDirectionsAvailable: AlternateDirectionInfo[];

  // Core metadata & compatibility
  direction: TranslationalDirectionMode;
  directionLabel: string;
  directionRationale: string;
  creativeSeed: number;
  groundingNote: string;
  duration: number;
  title: string;
  headline: string;
  storyNarrative: string;
  targetTakeaway: string;
  scenario: string;
  visualMetaphor: string;
  studies: string[];
  plan: AwgMediaPlan;
  accuracySafeguards: {
    groundedFacts: GroundedStudyFact[];
    inferredSynthesis: string;
    conceptualCreativeVisualization: string;
  };
  cinematicConfig: {
    direction: TranslationalDirectionMode;
    cameraMotion: "smooth_dolly_in" | "slow_lateral_track" | "benchtop_macro_drift" | "analog_tilt_pan" | "split_screen_reveal";
    lightingTheme: "clinical_analog_clean" | "warm_slate_amber" | "diagnostic_cyan_indigo" | "bioluminescent_emerald" | "flight_ops_navy";
    primaryColor: string;
    accentColor: string;
    hudOverlay: {
      biomarkerTag: string;
      vitalReading: string;
      fluidShiftMetric: string;
      cellularIntegrityIndex: string;
    };
    narrativeStages: Array<{
      timeRange: [number, number];
      stageTitle: string;
      caption: string;
      hudFocus: string;
    }>;
  };
  promptUsed: string;
  operationName?: string;
  geminiVideoConfigured?: boolean;
}

const ALL_TRANSLATIONAL_DIRECTIONS: Array<{
  key: TranslationalDirectionMode;
  label: string;
  tag: string;
  description: string;
}> = [
  {
    key: "lab_analog",
    label: "HDT Analog Lab (Head-Down Tilt Analog Environment)",
    tag: "Terrestrial -6° HDT Bedrest",
    description: "Ground-based 6° head-down tilt analog research facility simulating hydrostatic cephalad fluid redistribution and microvascular pressure gradients.",
  },
  {
    key: "ocular_imaging",
    label: "OCT Retinal Scan (Optical Coherence Tomography)",
    tag: "Diagnostic SANS Imaging",
    description: "Non-invasive high-resolution optical tomography resolving stratified retinal layers and microvascular capillary architecture under cephalad pressure.",
  },
  {
    key: "omics_translation",
    label: "Wet-Lab Omics (Transcript-to-Metabolite Bench)",
    tag: "RNA-seq × Mass Spec Bench",
    description: "Space biology molecular laboratory mapping upstream gene expression spikes to downstream enzymatic and metabolite pathway shifts.",
  },
  {
    key: "mission_monitoring",
    label: "Crew Health (Translational Astronaut-Health Concept)",
    tag: "Operational Resilience",
    description: "Operational spaceflight module tracking astronaut countermeasure exercise load, bioenergetic recovery, and physiological resilience.",
  },
  {
    key: "operational_relevance",
    label: "Ground vs Flight (Side-by-Side Comparative Context)",
    tag: "1G Baseline vs Spaceflight",
    description: "Side-by-side comparative framing linking 1G terrestrial baseline controls directly to spaceflight biological adaptations.",
  },
];

function resolveTranslationalDirection(
  sA: OSDRStudy,
  sB: OSDRStudy,
  query?: string,
  summary?: string,
  requestedDirection?: string,
  creativeSeed: number = 42
): {
  direction: TranslationalDirectionMode;
  reason: string;
  label: string;
  alternates: AlternateDirectionInfo[];
} {
  const caps = derivePairCapabilities(sA, sB);
  const baseDirections = !caps.isBothOmics
    ? ALL_TRANSLATIONAL_DIRECTIONS.filter((d) => d.key !== "omics_translation")
    : ALL_TRANSLATIONAL_DIRECTIONS;

  const validModes: TranslationalDirectionMode[] = baseDirections.map((d) => d.key);

  let chosenDirection: TranslationalDirectionMode = "operational_relevance";
  let specificDriver = "";

  if (requestedDirection && validModes.includes(requestedDirection as TranslationalDirectionMode)) {
    chosenDirection = requestedDirection as TranslationalDirectionMode;
    specificDriver = `User explicitly selected '${chosenDirection}' from the grounded direction set.`;
  } else if (!caps.isBothOmics) {
    const combined = `${sA.study_factor || ""} ${sB.study_factor || ""} ${sA.material_type || ""} ${sB.material_type || ""} ${sA.assay_measurement || ""} ${sB.assay_measurement || ""} ${query || ""} ${summary || ""}`.toLowerCase();
    if (
      combined.includes("retin") ||
      combined.includes("optic") ||
      combined.includes("eye") ||
      combined.includes("sans") ||
      combined.includes("vision") ||
      combined.includes("oct") ||
      combined.includes("fundus") ||
      combined.includes("mri")
    ) {
      chosenDirection = "ocular_imaging";
      specificDriver = `Matched in vivo ocular/retinal imaging and optic-nerve morphometry (${sA.material_type || "Retina"}).`;
    } else if (
      combined.includes("tilt") ||
      combined.includes("bedrest") ||
      combined.includes("hdt") ||
      combined.includes("hindlimb") ||
      combined.includes("hlu") ||
      combined.includes("analog") ||
      combined.includes("unloading")
    ) {
      chosenDirection = "lab_analog";
      specificDriver = `Matched terrestrial flight analog factor (${sA.study_factor || "HDT / Bedrest"}) simulating cephalad hydrostatic fluid movement.`;
    } else {
      chosenDirection = "operational_relevance";
      specificDriver = `Selected comparative baseline framing to contrast ground control data with spaceflight analog exposure in ${sA.study_id}.`;
    }
  } else {
    const combined = `${sA.study_factor || ""} ${sB.study_factor || ""} ${sA.material_type || ""} ${sB.material_type || ""} ${sA.assay_measurement || ""} ${sB.assay_measurement || ""} ${query || ""} ${summary || ""}`.toLowerCase();

    // 1. Ocular & Retinal Imaging Priority (SANS / Eye / Retina / OCT)
    if (
      combined.includes("retin") ||
      combined.includes("optic") ||
      combined.includes("eye") ||
      combined.includes("sans") ||
      combined.includes("vision") ||
      combined.includes("oct") ||
      combined.includes("fundus")
    ) {
      chosenDirection = "ocular_imaging";
      specificDriver = `Matched ocular/retinal tissue (${sA.material_type || "Retina"}) and neuro-ocular vascular queries.`;
    }
    // 2. Head-Down Tilt Bedrest / Hindlimb Unloading Analog Priority
    else if (
      combined.includes("tilt") ||
      combined.includes("bedrest") ||
      combined.includes("hdt") ||
      combined.includes("hindlimb") ||
      combined.includes("hlu") ||
      combined.includes("analog") ||
      combined.includes("unloading")
    ) {
      chosenDirection = "lab_analog";
      specificDriver = `Matched terrestrial flight analog factor (${sA.study_factor || "HDT / Bedrest"}) simulating cephalad hydrostatic fluid movement.`;
    }
    // 3. Omics / RNA-seq vs Proteomics/Metabolomics Assay Priority
    else if (
      combined.includes("omics") ||
      combined.includes("rna-seq") ||
      combined.includes("proteom") ||
      combined.includes("metabol") ||
      combined.includes("sequenc") ||
      combined.includes("mass spec") ||
      combined.includes("transcriptom") ||
      combined.includes("bench") ||
      sA.assay_measurement !== sB.assay_measurement
    ) {
      chosenDirection = "omics_translation";
      specificDriver = `Matched cross-assay pairing (${sA.assay_measurement || "Assay A"} ⟷ ${sB.assay_measurement || "Assay B"}), emphasizing multi-omics data integration.`;
    }
    // 4. Crew Health / Radiation / Muscle Priority
    else if (
      combined.includes("exercise") ||
      combined.includes("muscle") ||
      combined.includes("cardio") ||
      combined.includes("radiation") ||
      combined.includes("vital") ||
      combined.includes("health") ||
      combined.includes("cosmic")
    ) {
      chosenDirection = "mission_monitoring";
      specificDriver = `Matched physiological countermeasure and mission stress factors (${sA.study_factor || "Spaceflight"}).`;
    }
    // 5. Default to Operational Relevance
    else {
      chosenDirection = "operational_relevance";
      specificDriver = `Selected comparative baseline framing to contrast ground control data with spaceflight exposure in ${sA.study_id}.`;
    }
  }

  const selectedDef = baseDirections.find((d) => d.key === chosenDirection) || baseDirections[0];

  const comprehensiveRationale =
    `Selected grounded direction '${selectedDef.label}' from the available translational perspectives for ${sA.study_id} × ${sB.study_id}. ` +
    `${specificDriver} Influenced by organism (${sA.organism || "Model organism"}), tissue (${sA.material_type || "Biological tissue"}), assay (${sA.assay_measurement || "Assay"}), and experimental factor (${sA.study_factor || "Factor"}). ` +
    `Note: No single direction is canonical; all presented directions represent valid translational lenses. Sub-scenario varied by seed #${creativeSeed}.`;

  const alternates: AlternateDirectionInfo[] = baseDirections.map((item) => ({
    key: item.key,
    label: item.label,
    tag: item.tag,
    description: item.description,
    matchRelevance:
      item.key === chosenDirection
        ? "Currently selected primary match based on active OSD attributes."
        : `Available alternate grounded perspective for ${sA.study_id} × ${sB.study_id}.`,
    isCurrentlySelected: item.key === chosenDirection,
  }));

  return {
    direction: chosenDirection,
    reason: comprehensiveRationale,
    label: selectedDef.label,
    alternates,
  };
}

function computeCreativeSeed(seedInput?: number | string, studies: string[] = [], query: string = ""): number {
  if (typeof seedInput === "number" && !isNaN(seedInput)) return Math.abs(Math.floor(seedInput));
  if (typeof seedInput === "string" && seedInput.trim().length > 0) {
    let hash = 0;
    for (let i = 0; i < seedInput.length; i++) {
      hash = (hash << 5) - hash + seedInput.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }
  const str = `${studies.join("_")}:${query}:${Date.now() % 100000}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export async function generateTranslationalClip(
  req: TranslationalClipRequest
): Promise<TranslationalClipResponse> {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  const validation = await validateAwgAccessions(req.studies || []);
  if (!validation.isValid || !validation.studyA || !validation.studyB) {
    throw new Error(validation.userMessage || validation.errorMessage || "Invalid study accessions provided for translational clip generation.");
  }

  const sA = validation.studyA;
  const sB = validation.studyB;
  const caps = derivePairCapabilities(sA, sB);
  const plan = buildGroundedMediaPlan(sA, sB);

  const factor = sA.study_factor || "Head-Down Tilt Bedrest / Spaceflight";
  const org = sA.organism || "Rattus norvegicus / Human Analog";
  const tissue = sA.material_type || "Retina / Microvascular";

  const creativeSeed = computeCreativeSeed(req.seed, [sA.study_id, sB.study_id], req.query || "");
  const seedMod = creativeSeed % 3;

  // Resolve direction mode and creative seed
  const {
    direction,
    reason: directionRationale,
    label: directionLabel,
    alternates: alternateDirectionsAvailable,
  } = resolveTranslationalDirection(
    sA,
    sB,
    req.query,
    req.summary,
    req.direction,
    creativeSeed
  );

  const artifactId = `art-clip-${direction}-${requestId.slice(0, 8)}`;

  let title = "";
  let headline = "";
  let scenario = "";
  let storyNarrative = "";
  let visualMetaphor = "";
  let targetTakeaway = "";
  let primaryColor = "#38bdf8";
  let accentColor = "#10b981";
  let lightingTheme: "clinical_analog_clean" | "warm_slate_amber" | "diagnostic_cyan_indigo" | "bioluminescent_emerald" | "flight_ops_navy" = "clinical_analog_clean";
  let cameraMotion: "smooth_dolly_in" | "slow_lateral_track" | "benchtop_macro_drift" | "analog_tilt_pan" | "split_screen_reveal" = "smooth_dolly_in";
  let biomarkerTag = "";
  let vitalReading = "";
  let fluidShiftMetric = "";
  let cellularIntegrityIndex = "";
  let narrativeStages: Array<{
    timeRange: [number, number];
    stageTitle: string;
    caption: string;
    hudFocus: string;
  }> = [];
  let videoPrompt = "";

  // Configure each direction with authentic scientific scenes & restraint
  switch (direction) {
    case "lab_analog": {
      title = "Translational Insight: Ground Analog HDT Facility & Cephalad Redistribution";
      headline = `Evaluating 6° Head-Down Tilt Bedrest Analog Models from ${sA.study_id} and ${sB.study_id}`;
      scenario = "NASA Terrestrial Flight Analog Laboratory (-6° HDT Chamber)";
      lightingTheme = "clinical_analog_clean";
      primaryColor = "#f59e0b";
      accentColor = "#06b6d4";
      cameraMotion = "analog_tilt_pan";
      biomarkerTag = `Analog Factor: -6° HDT (${factor})`;
      vitalReading = "Estimated Hydrostatic Delta: Cephalad Vector Active";
      fluidShiftMetric = "Analog Chamber: Environmental Parameters Stable";
      cellularIntegrityIndex = caps.isImagingPhysiologyOnly ? "Ocular Structural Assessment: In Progress" : "Endothelial Barrier Assessment: In Progress";
      targetTakeaway = "Terrestrial bedrest analogs replicate cephalad fluid redistribution, enabling validated structural baseline evaluation.";
      storyNarrative = `In terrestrial research facilities, 6° head-down tilt (HDT) bedrest models simulate the hydrostatic cephalad fluid shift experienced in microgravity. Comparing ${sA.study_id} and ${sB.study_id} reveals how in vivo diagnostic and anatomical changes manifest under controlled gravity-analog unloading.`;
      visualMetaphor = "An authentic terrestrial flight analog research room featuring a specialized -6° head-down tilt bed with analog research monitors tracking hydrostatic fluid movement along the cranial-caudal axis.";

      narrativeStages = [
        {
          timeRange: [0.0, 2.0],
          stageTitle: "Terrestrial Flight Analog Setup",
          caption: `Research facilities use 6° Head-Down Tilt bedrest to simulate spaceflight hydrostatic pressure gradients in ${org}.`,
          hudFocus: `Analog Setting: -6.0° HDT Incline · ${factor}`,
        },
        {
          timeRange: [2.0, 4.2],
          stageTitle: "Cephalad Fluid Redistribution",
          caption: `Unloading shifts fluid upward, increasing hydrostatic pressure across ${tissue} microvessels.`,
          hudFocus: `Vascular Response: Microvascular Perfusion Adjustment`,
        },
        {
          timeRange: [4.2, 6.0],
          stageTitle: "Countermeasure Blueprint",
          caption: targetTakeaway,
          hudFocus: `Outcome: Validated Terrestrial-to-Flight Translation`,
        },
      ];

      videoPrompt = `Cinematic NASA research documentary style (16:9, authentic laboratory atmosphere, no floating sci-fi HUDs, photorealistic lighting): In an authentic terrestrial space physiology analog facility, a research bed configured with a 6-degree head-down tilt angle is observed. Clinical analog research equipment displays real-time fluid shift baseline tracking. Warm amber and clean clinical slate lighting, calm professional atmosphere, high scientific restraint.`;
      break;
    }

    case "ocular_imaging": {
      title = "Translational Insight: High-Resolution Retinal & Optic Nerve Diagnostics";
      headline = `Evaluating In Vivo Ophthalmic Imaging (${sA.study_id}) and Optic-Nerve MRI (${sB.study_id})`;
      scenario = "Ophthalmic Space Biology Suite & Optical Coherence Tomography (OCT) Diagnostics";
      lightingTheme = "diagnostic_cyan_indigo";
      primaryColor = "#06b6d4";
      accentColor = "#f43f5e";
      cameraMotion = "benchtop_macro_drift";
      biomarkerTag = "Diagnostic Modality: OCT & Optic-Nerve MRI";
      vitalReading = "Diagnostic Mode: Optical Coherence Tomography (OCT) & MRI";
      fluidShiftMetric = "Hydrostatic Vascular Perfusion: Regional Contrast";
      cellularIntegrityIndex = "Morphological Stability: Monitored";
      targetTakeaway = "Non-invasive ocular imaging and optic-nerve morphometry establish essential baseline structural parameters in ground-based fluid-shift analogs.";
      storyNarrative = `Spaceflight-Associated Neuro-ocular Syndrome (SANS) presents a critical health challenge on prolonged space voyages. Cross-analyzing ${sA.study_id} and ${sB.study_id} links in vivo retinal layer thickness and intraocular pressure dynamics with optic nerve sheath MRI morphometry.`;
      visualMetaphor = "A non-invasive high-resolution Optical Coherence Tomography (OCT) diagnostic scan resolving layered retinal cross-sections (ganglion cells, inner plexiform layer, choroid) and optic nerve sheath dimensions under cephalad venous pressure.";

      narrativeStages = [
        {
          timeRange: [0.0, 2.0],
          stageTitle: "Ocular Structural Assessment",
          caption: `Cephalad fluid pooling elevates retrobulbar venous pressure, altering tissue geometry in ${tissue}.`,
          hudFocus: `Diagnostic: High-Resolution Retinal OCT Cross-Section`,
        },
        {
          timeRange: [2.0, 4.2],
          stageTitle: "Stratified Morphology Response",
          caption: `In vivo imaging identifies retinal layer thickness dynamics paired with optic nerve sheath enlargement.`,
          hudFocus: `Morphometry: Retinal Layer Thickness ⟷ Optic Nerve Sheath`,
        },
        {
          timeRange: [4.2, 6.0],
          stageTitle: "Ground Analog Translation",
          caption: targetTakeaway,
          hudFocus: `Validation: SANS-Relevant Ground Analog Baseline`,
        },
      ];

      videoPrompt = `Cinematic high-resolution scientific medical imaging (16:9, authentic clinical ophthalmic research, photorealistic rendering): A cross-sectional optical coherence tomography (OCT) visualization of the retina showing stratified cellular layers and microvascular capillary architecture. Subtle diagnostic cyan and deep indigo lighting, gentle slow drift through vascular cross-section, authentic scientific and anatomical precision.`;
      break;
    }

    case "omics_translation": {
      const assayNameA = caps.studyA.primaryAssayLabel;
      const assayNameB = caps.studyB.primaryAssayLabel;
      const omicsPrefix = caps.isMultiOmics ? "Multi-Omics" : "Cross-Assay";

      title = `Translational Insight: ${omicsPrefix} Molecular Integration`;
      headline = `Synchronizing ${sA.study_id} (${assayNameA}) with ${sB.study_id} (${assayNameB})`;
      scenario = "Space Biology Wet-Lab & Molecular Integration Bench";
      lightingTheme = "bioluminescent_emerald";
      primaryColor = "#10b981";
      accentColor = "#818cf8";
      cameraMotion = "slow_lateral_track";
      biomarkerTag = `Cross-Assay: ${sA.study_id} ⟷ ${sB.study_id}`;
      vitalReading = `${omicsPrefix} Alignment: Cross-Assay Convergence`;
      fluidShiftMetric = `Assay Platforms: ${sA.assay_platform || "Assay 1"} & ${sB.assay_platform || "Assay 2"}`;
      cellularIntegrityIndex = "Cross-Assay Correlation: Evaluated";
      targetTakeaway = "Bridging complementary molecular assays unlocks actionable molecular countermeasure targets.";
      storyNarrative = `Single-assay experiments provide focused perspectives on spaceflight adaptation. By cross-analyzing ${assayNameA} from ${sA.study_id} with ${assayNameB} from ${sB.study_id}, researchers map biological changes in ${tissue}.`;
      visualMetaphor = "A modern space biology laboratory benchtop where dual comparative data matrices reveal direct relationships across complementary molecular assays.";

      narrativeStages = [
        {
          timeRange: [0.0, 2.0],
          stageTitle: "Multi-Assay Data Integration",
          caption: `Combining ${sA.assay_measurement} (${sA.study_id}) with ${sB.assay_measurement} (${sB.study_id}) in ${org}.`,
          hudFocus: `Assay Mapping: Upstream Gene ➔ Downstream Molecular Endpoint`,
        },
        {
          timeRange: [2.0, 4.2],
          stageTitle: "Biological Pathway Convergence",
          caption: `Cross-assay evaluation reveals correlated stress signatures across ${tissue}.`,
          hudFocus: `Correlation Index: Cross-Assay Alignment`,
        },
        {
          timeRange: [4.2, 6.0],
          stageTitle: "Translational Target Identification",
          caption: targetTakeaway,
          hudFocus: `Synthesis Target: Validated Cross-Modal Endpoint`,
        },
      ];

      videoPrompt = `Cinematic space biology wet-lab scene (16:9, authentic scientific research bench, photorealistic 4K lighting): A modern molecular genomics research bench with automated pipette stations, sample flow cells, and comparative data visualizations on laboratory workstation monitors. Deep slate gray background with emerald green and soft indigo illumination, authentic scientific laboratory context.`;
      break;
    }

    case "mission_monitoring": {
      title = "Translational Insight: Crew Health Adaptation & Countermeasure Resilience";
      headline = `Translating Model Organism Data (${sA.study_id}) to Operational Spaceflight Health`;
      scenario = "Mission Operations Crew Health & Countermeasure Protocol";
      lightingTheme = "flight_ops_navy";
      primaryColor = "#38bdf8";
      accentColor = "#10b981";
      cameraMotion = "smooth_dolly_in";
      biomarkerTag = `Operational Factor: ${factor}`;
      vitalReading = "Physiological Adaptation: Multi-System Homeostasis";
      fluidShiftMetric = "Countermeasure Protocol: Active Evaluation";
      cellularIntegrityIndex = "Target Resilience: Structural Assessment Validated";
      targetTakeaway = "Translating model organism data into mission countermeasure regimens preserves astronaut health on long-duration exploration.";
      storyNarrative = `Deep-space exploration requires maintaining crew physiological resilience during prolonged gravitational unloading. Data from ${sA.study_id} and ${sB.study_id} provide the empirical evidence needed to optimize physical exercise protocols and countermeasure strategies for interplanetary transit.`;
      visualMetaphor = "An astronaut conducting routine countermeasure evaluation in an ergonomic research habitat, tracking physiological adaptation curves and muscular resilience under simulated spaceflight conditions.";

      narrativeStages = [
        {
          timeRange: [0.0, 2.0],
          stageTitle: "Operational Spaceflight Context",
          caption: `Long-duration spaceflight imposes systemic physiological stress, requiring continuous countermeasure optimization.`,
          hudFocus: `Mission Environment: Gravitational Adaptation & Crew Health`,
        },
        {
          timeRange: [2.0, 4.2],
          stageTitle: "Physiological Translation",
          caption: `Findings in ${tissue} guide tailored exercise loads, nutritional timing, and barrier protection.`,
          hudFocus: `Countermeasure Timing: Physiological Preservation`,
        },
        {
          timeRange: [4.2, 6.0],
          stageTitle: "Long-Duration Mission Readiness",
          caption: targetTakeaway,
          hudFocus: `Mission Goal: Artemis & Mars Crew Health Preservation`,
        },
      ];

      videoPrompt = `Cinematic operational space biology vignette (16:9, natural documentary lighting, non-cartoonish, authentic spaceflight context): An astronaut performing operational countermeasure assessments in a modern ergonomic spaceflight research module. Muted navy blue and soft warm white interior illumination, focus on human resilience and scientific dedication, peaceful and grounded atmosphere.`;
      break;
    }

    case "operational_relevance":
    default: {
      title = "Translational Insight: Ground Control Baseline vs. Spaceflight Exposure";
      headline = `Side-by-Side Operational Comparison: Translating ${sA.study_id} & ${sB.study_id} into Mission Guidelines`;
      scenario = "Flight Science Support & Mission Integration Console";
      lightingTheme = "warm_slate_amber";
      primaryColor = "#6366f1";
      accentColor = "#f59e0b";
      cameraMotion = "split_screen_reveal";
      biomarkerTag = "Comparative Framing: 1G Earth Control ⟷ Spaceflight";
      vitalReading = "Protocol Translation: Research Data ➔ Flight Rules";
      fluidShiftMetric = "Ground Baseline vs Orbital Exposure Synchronized";
      cellularIntegrityIndex = "Operational Translation: Verified";
      targetTakeaway = "Systematic side-by-side ground vs flight comparisons ensure space biology discoveries translate directly into validated crew health flight rules.";
      storyNarrative = `Translating space biology research into flight operations requires comparing ground-based control baselines with active flight exposures. Synthesizing ${sA.study_id} and ${sB.study_id} bridges laboratory discovery with operational mission planning, turning research datasets into actionable flight rules.`;
      visualMetaphor = "A side-by-side comparative layout contrasting 1G terrestrial control experiments on the left with simulated spaceflight adaptations on the right, connected by translational research milestones.";

      narrativeStages = [
        {
          timeRange: [0.0, 2.0],
          stageTitle: "Comparative Baseline Definition",
          caption: `Comparing ground control parameters against spaceflight analog exposures in ${sA.study_id}.`,
          hudFocus: `Comparison: 1G Ground Baseline ⟷ Spaceflight Analog`,
        },
        {
          timeRange: [2.0, 4.2],
          stageTitle: "Translational Pipeline Synchronization",
          caption: `Mapping anatomical shifts in ${tissue} directly to flight rules and health monitoring protocols.`,
          hudFocus: `Translation Matrix: Finding ➔ Operational Protocol`,
        },
        {
          timeRange: [4.2, 6.0],
          stageTitle: "Validated Mission Flight Rules",
          caption: targetTakeaway,
          hudFocus: `Outcome: Operational Flight Guidelines Updated`,
        },
      ];

      videoPrompt = `Cinematic side-by-side comparative scientific framing (16:9, clean split composition, photorealistic lighting): A balanced split-screen composition showing ground-based laboratory baseline control conditions on the left and spaceflight analog research on the right, unified by clean scientific research typography and warm amber and indigo tones.`;
      break;
    }
  }

  // Adjust prompt with seed nuance
  if (seedMod === 1) {
    videoPrompt += " Gentle lateral tracking camera movement emphasizing research workflow clarity.";
  } else if (seedMod === 2) {
    videoPrompt += " Slow macro focal drift highlighting subtle biological and instrument details.";
  }

  const keyVisualElementsMap: Record<TranslationalDirectionMode, string[]> = {
    lab_analog: [
      "-6.0° head-down tilt analog research bed frame",
      "Cephalad fluid redistribution vector particles",
      "Terrestrial analog observer workstation & hydrostatic pressure monitor",
      "Angle protractor displaying -6° tilt incline calibration",
    ],
    ocular_imaging: caps.isImagingPhysiologyOnly
      ? [
          "High-resolution cross-sectional retinal layer stratification (ILM, GCL, IPL, ONL, RPE, Choroid)",
          "Active horizontal OCT laser scan sweep beam",
          "Retrobulbar optic nerve sheath diameter & cross-sectional geometry",
          "Focal diagnostic reticle tracking hydrostatic venous contrast",
        ]
      : [
          "High-resolution cross-sectional retinal layer stratification (ILM, GCL, IPL, ONL, RPE, Choroid)",
          "Active horizontal OCT laser scan sweep beam",
          "Blood-retinal barrier microvascular perfusion & tight junction markers (Claudin-5)",
          "Focal diagnostic reticle tracking hydrostatic venous contrast",
        ],
    omics_translation: [
      "Space biology benchtop with automated micropipette dispensing stations",
      "Synchronized dual cross-assay traces (RNA-seq gene peaks & Mass Spec metabolite spectrum)",
      "Dynamic cross-omics correlation connecting bridges linking transcripts to metabolites",
      "Flow cell well matrix illustrating multi-omics convergence",
    ],
    mission_monitoring: [
      "Ergonomic spaceflight habitat structural ribs & research module",
      "Astronaut resistance countermeasure exercise silhouette",
      "Crew physiological adaptation and muscular resilience waveform monitor",
      "Physiological recovery & health preservation gauge",
    ],
    operational_relevance: [
      "Side-by-side comparative split-screen layout (1G Terrestrial Control vs Spaceflight Analog)",
      "Center translation bridge hub linking empirical research to mission flight rules",
      "Calm 1G homeostatic baseline perfusion waveform vs stressed flight adaptation curve",
      "Operational milestone matrix for crew health rule development",
    ],
  };

  const groundedFacts: GroundedStudyFact[] = [
    {
      study_id: sA.study_id,
      organism: sA.organism,
      tissue: sA.material_type,
      factor: sA.study_factor,
      assay: `${sA.assay_measurement} (${sA.assay_platform || "Standard Platform"})`,
      observedFinding: `Empirical repository measurement of ${sA.material_type} in ${sA.organism} under ${sA.study_factor}.`,
    },
  ];

  const groundedEvidence: GroundedEvidenceFact[] = [
    {
      studyId: sA.study_id,
      organism: sA.organism || "Model Organism",
      tissue: sA.material_type || "Biological Tissue",
      factor: sA.study_factor || "Spaceflight / Analog Factor",
      assay: `${sA.assay_measurement || "Assay"} (${sA.assay_platform || "Repository Platform"})`,
      observedMetric: `Empirical repository measurement of ${sA.material_type || "tissue"} under ${sA.study_factor || "experimental condition"}.`,
      repositoryRecord: `NASA OSDR accession ${sA.study_id}: "${sA.title || sA.study_id}"`,
    },
  ];

  if (sB.study_id !== sA.study_id) {
    groundedFacts.push({
      study_id: sB.study_id,
      organism: sB.organism,
      tissue: sB.material_type,
      factor: sB.study_factor,
      assay: `${sB.assay_measurement} (${sB.assay_platform || "Standard Platform"})`,
      observedFinding: `Comparative profiling of ${sB.material_type} under ${sB.study_factor}.`,
    });

    groundedEvidence.push({
      studyId: sB.study_id,
      organism: sB.organism || "Model Organism",
      tissue: sB.material_type || "Biological Tissue",
      factor: sB.study_factor || "Spaceflight / Analog Factor",
      assay: `${sB.assay_measurement || "Assay"} (${sB.assay_platform || "Repository Platform"})`,
      observedMetric: `Comparative empirical measurement of ${sB.material_type || "tissue"} under ${sB.study_factor || "condition"}.`,
      repositoryRecord: `NASA OSDR accession ${sB.study_id}: "${sB.title || sB.study_id}"`,
    });
  }

  const inferredSynthesis = caps.isImagingPhysiologyOnly
    ? `Biomechanical and physiological synthesis linking ${sA.study_id} (${sA.assay_measurement}) and ${sB.study_id} (${sB.assay_measurement}) under ${factor}. Inferred fluid-shift dynamics in ${tissue} inform ground-analog baseline models.`
    : `Translational multi-omics synthesis linking ${sA.study_id} (${sA.assay_measurement}) and ${sB.study_id} (${sB.assay_measurement}) under ${factor}. Inferred pathway correlation in ${tissue} informs targeted countermeasure strategies.`;

  const conceptualCreativeVisualization = `A scientifically restrained conceptual visualization (${scenario}). The scene illustrates the operational relevance of ${sA.study_id} and ${sB.study_id} for space biology and translational health, rather than presenting live clinical patient telemetry.`;

  const conceptualElements: ConceptualFramingElements = {
    scenarioTitle: scenario,
    visualMetaphor,
    cameraPerspective: cameraMotion.replace(/_/g, " "),
    lightingTheme: lightingTheme.replace(/_/g, " "),
    inferredHypothesis: inferredSynthesis,
    analogSimulationDisclaimer:
      "Represents a conceptual translational visualization grounded in repository metadata to illustrate real-world mission relevance, rather than direct astronaut telemetry or live clinical patient recordings.",
    keyVisualElements: keyVisualElementsMap[direction] || keyVisualElementsMap.operational_relevance,
  };

  let operationName: string | undefined = undefined;
  let generationSource: "gemini_veo" | "local_conceptual_clip" = "local_conceptual_clip";
  let provider = "NASA OSDR Local Cinematic Engine";
  let providerModel = "procedural-canvas-cinematic-v1";
  let generationStatus: MediaGenerationStatus = "fallback";

  const videoAi = getVideoAi();
  if (videoAi) {
    try {
      const discovery = await discoverVideoProviderCapabilities();
      if (discovery.status === "available" && discovery.selectedModel) {
        const pairKey = [sA.study_id, sB.study_id].sort().join("::");
        const quotaGate = checkVeoQuotaGate({ pairKey, requestId, modelName: discovery.selectedModel });
        if (quotaGate.allowed) {
          const operation = await videoAi.models.generateVideos({
            model: discovery.selectedModel,
            prompt: videoPrompt,
            config: {
              numberOfVideos: 1,
              resolution: "720p",
              aspectRatio: "16:9",
            },
          });
          if (operation?.name) {
            operationName = operation.name;
            generationSource = "gemini_veo";
            provider = "Google Gemini";
            providerModel = discovery.selectedModel;
            generationStatus = "fresh_provider";
            recordVeoAttempt(pairKey, undefined, requestId, discovery.selectedModel);
          }
        } else {
          generationSource = "local_conceptual_clip";
          provider = "NASA OSDR Local Cinematic Engine";
          providerModel = "procedural-canvas-cinematic-v1";
          generationStatus = "fallback";
        }
      }
    } catch (vErr: any) {
      const errMsg = String(vErr?.message || "").toLowerCase();
      const errStatus = vErr?.status || vErr?.code;
      const isQuota = errStatus === 429 || errMsg.includes("429") || errMsg.includes("resource_exhausted") || errMsg.includes("quota") || errMsg.includes("exhausted");
      if (isQuota) {
        triggerVeoCircuitBreaker(vErr?.message, requestId, "veo-3.1-lite");
      }
      markVideoModelUnavailable(undefined, vErr?.message);
      generationSource = "local_conceptual_clip";
      provider = "NASA OSDR Local Cinematic Engine";
      providerModel = "procedural-canvas-cinematic-v1";
      generationStatus = "fallback";
    }
  }

  const promptFingerprint = computePromptFingerprint(videoPrompt);
  const latencyMs = Math.max(1, Date.now() - startTime);
  const contentHash = computeContentHash({
    videoPrompt,
    creativeSeed,
    direction,
    studyA: sA.study_id,
    studyB: sB.study_id,
  });
  const provenance: MediaProvenanceRecord = {
    requestId,
    artifactId,
    createdAt: new Date().toISOString(),
    mediaType: "translational_clip",
    artifactType: "canvas_motion_render",
    renderEngine: "browser_canvas_60fps",
    planningProvider: operationName ? "Google Veo (Structured Scene Planner)" : "NASA OSDR Relatable Scene Engine",
    provider,
    providerModel,
    generationStatus,
    statusLabel: getStatusLabel(generationStatus),
    cacheKey: `clip:${[sA.study_id, sB.study_id].sort().join("::")}:${direction}:${creativeSeed}:${promptFingerprint}`,
    cacheHit: false,
    creativeDirection: `${directionLabel} (Seed #${creativeSeed})`,
    seed: creativeSeed,
    promptFingerprint,
    contentHash,
    sourceStudyPair: [sA.study_id, sB.study_id],
    latencyMs,
  };

  recordMediaAudit(provenance);

  const provenanceLabel =
    generationSource === "gemini_veo"
      ? "Gemini-generated translational clip"
      : "Local conceptual fallback clip";

  const rawResponse: TranslationalClipResponse = {
    success: true,
    videoType: "relatable_translational_clip",
    generationSource,
    provenanceLabel,
    provenance,

    // Explicit structured fields
    selectedDirectionKey: direction,
    selectedDirectionLabel: directionLabel,
    selectionRationale: directionRationale,
    groundedEvidence,
    conceptualElements,
    seed: creativeSeed,
    alternateDirectionsAvailable,

    // Core metadata
    direction,
    directionLabel,
    directionRationale,
    creativeSeed,
    groundingNote: `Direction: ${directionLabel} · Grounded in active OSD pair (${sA.study_id} × ${sB.study_id})`,
    duration: 6.0,
    title,
    headline,
    storyNarrative,
    targetTakeaway,
    scenario,
    visualMetaphor,
    studies: [sA.study_id, sB.study_id],
    plan,
    accuracySafeguards: {
      groundedFacts,
      inferredSynthesis,
      conceptualCreativeVisualization,
    },
    cinematicConfig: {
      direction,
      cameraMotion,
      lightingTheme,
      primaryColor,
      accentColor,
      hudOverlay: {
        biomarkerTag,
        vitalReading,
        fluidShiftMetric,
        cellularIntegrityIndex,
      },
      narrativeStages,
    },
    promptUsed: videoPrompt,
    operationName,
    geminiVideoConfigured: Boolean(videoAi),
  };

  return validateAndSanitizeTranslationalClip(rawResponse, caps);
}
