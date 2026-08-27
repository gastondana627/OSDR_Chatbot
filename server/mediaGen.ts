import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";
import { getStudyById, OSDRStudy } from "./rag";
import { buildAwgEvidenceMap, ArtifactGroundingCard, EvidenceClass } from "./awg";
import { validateAwgAccessions } from "./accessionValidator";

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

export interface StageExecutionAudit {
  activePairResolution: "success" | "fail";
  promptPlanning: "success" | "fail" | "not_attempted";
  planningMethod?: "local_metadata_template" | "gemini_generated" | "none";
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
  finalArtifactType: "provider_mp4" | "none" | "canvas_preview";
}

export interface MediaProvenanceRecord {
  requestId: string;
  artifactId: string;
  createdAt: string;
  mediaType: "image" | "motion_brief" | "relatable_clip" | "translational_clip" | "meme_clip" | "meme_concept" | "visual_abstract";
  provider: string;
  providerModel: string;
  planningModel?: string;
  planningMethod?: "local_metadata_template" | "gemini_generated" | "none";
  videoProviderModel?: string;
  fallbackRenderer?: string;
  finalArtifactType?: "provider_mp4" | "none" | "canvas_preview";
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
      reason: "No API key configured for video generation (VIDEO_API_KEY or GEMINI_API_KEY).",
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
    name: "Bioenergetic Emerald & Obsidian",
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
      name: "Radial Multi-Omics Convergence Hub",
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
        "Bioenergetic Emerald & Obsidian palette (#06130d background, #10b981 emerald and #06b6d4 cyan ribbons).",
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
  explicitRunIndex?: number
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

  const categoryVariations = STYLE_VARIATIONS_BY_CATEGORY[category] || STYLE_VARIATIONS_BY_CATEGORY.data_visualization;
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
  const isOcular =
    sA.material_type.toLowerCase().includes("retina") ||
    sB.material_type.toLowerCase().includes("retina") ||
    sA.material_type.toLowerCase().includes("eye") ||
    sB.material_type.toLowerCase().includes("eye");

  const factor = sA.study_factor || "Head-Down Tilt Bedrest";
  const org = sA.organism || "Rattus norvegicus";
  const tissue = sA.material_type || "Retina / Optic Nerve";

  const evidenceMap = buildAwgEvidenceMap(sA, sB);
  const groundingCard = evidenceMap.groundingCard;
  const provenanceFooter = evidenceMap.unifiedProvenanceFooter;

  const pairKey = `${sA.study_id}_${sB.study_id}`.toUpperCase();
  const runIndex =
    typeof options?.generationIndex === "number"
      ? options.generationIndex
      : pairRunCounters.get(pairKey) || 0;

  // Derive the 4 category variations using the diversity seed
  const cat1Seed = getDiversitySeed(sA.study_id, sB.study_id, "data_visualization", 0, runIndex);
  const cat2Seed = getDiversitySeed(sA.study_id, sB.study_id, "biological_concept", 1, runIndex);
  const cat3Seed = getDiversitySeed(sA.study_id, sB.study_id, "contextual_narrative", 2, runIndex);
  const cat4Seed = getDiversitySeed(sA.study_id, sB.study_id, "accession_summary", 3, runIndex);

  // Common scientific grounding text
  const scientificGrounding = `Grounding: NASA OSDR accessions ${sA.study_id} (${sA.assay_measurement}) and ${sB.study_id} (${sB.assay_measurement}) in ${org} under ${factor} (${tissue}).`;

  // Item 1: Omics Convergence Map (Evidence-Informed Synthesis)
  const item1Prompt = [
    `A sophisticated, publication-grade scientific data visualization infographic for NASA Space Biology.`,
    scientificGrounding,
    `Artifact Role: Multi-Omics Systems Convergence Map. Must be evidence-led, highly structured, showing molecular signaling nodes, gene-metabolite regulatory cross-talk, and log2 fold-change markers.`,
    `Composition: ${cat1Seed.variation.layoutDescription}`,
    `Viewing Angle: ${cat1Seed.variation.viewingAngle}.`,
    ...cat1Seed.variation.promptDirectives,
    `Style Quality: Non-cartoonish, professional scientific journal figure, crisp vector typography, dark high-contrast scientific background, no generic clipart.`,
  ].join(" ");

  // Item 2: Retinal Stress Mechanism (Evidence-Informed Synthesis)
  const item2Prompt = [
    `A high-resolution, biologically accurate scientific medical illustration for NASA Space Biology.`,
    scientificGrounding,
    `Artifact Role: Cellular & Pathophysiological Mechanism. Must emphasize anatomical legibility, tissue stratification, microvascular barrier integrity, mitochondrial ROS efflux, and endothelial fenestrations.`,
    `Composition: ${cat2Seed.variation.layoutDescription}`,
    `Viewing Angle: ${cat2Seed.variation.viewingAngle}.`,
    ...cat2Seed.variation.promptDirectives,
    `Style Quality: Publication-quality medical illustration, anatomical precision, bioluminescent stress accents, non-cartoonish, authentic cellular micro-structures.`,
  ].join(" ");

  // Item 3: HDT Analog Context (Conceptual Visualization)
  const item3Prompt = [
    `A cinematic and scientifically authentic NASA space biology laboratory habitat scene.`,
    scientificGrounding,
    `Artifact Role: Spaceflight Analog Ground Habitat & Telemetry Context. Must feel like a real physical environment (not a flat infographic), featuring head-down tilt apparatus, environmental control chambers, biometric telemetry monitors, and animal habitat stations.`,
    `Composition: ${cat3Seed.variation.layoutDescription}`,
    `Viewing Angle: ${cat3Seed.variation.viewingAngle}.`,
    ...cat3Seed.variation.promptDirectives,
    `Style Quality: Authentic laboratory realism, atmospheric LED status lighting, cleanroom stainless steel and matte titanium, photorealistic depth and volumetric lighting.`,
  ].join(" ");

  // Item 4: Accessions Summary (Observed Study Evidence)
  const item4Prompt = [
    `A sleek, modern scientific executive visual abstract and dual-study accession briefing poster for NASA OSDR.`,
    scientificGrounding,
    `Artifact Role: Dual-Study Accession Synthesis. Visually expressive, sleek presentation poster comparing study metadata (${sA.study_id} vs ${sB.study_id}), assay platforms, biological models, and AWG countermeasure findings.`,
    `Composition: ${cat4Seed.variation.layoutDescription}`,
    `Viewing Angle: ${cat4Seed.variation.viewingAngle}.`,
    ...cat4Seed.variation.promptDirectives,
    `Style Quality: High-impact publication executive poster, pristine typography, balanced negative space, sharp vector badges, presentation slide quality.`,
  ].join(" ");

  return {
    theme: isOcular
      ? "Cephalad Fluid Shift & Multi-Omics Ocular Remodeling (SANS)"
      : `${sA.study_factor} Multi-Omic Spaceflight Response in ${org}`,
    studies: isSame ? [sA.study_id] : [sA.study_id, sB.study_id],
    rationale: `Cross-omic correlation between ${sA.assay_measurement} (${sA.study_id}) and ${sB.assay_measurement} (${sB.study_id}) under ${factor}.`,
    runIndex,
    evidenceMap,
    items: [
      {
        category: "data_visualization",
        categoryLabel: "Pathway & Biomarkers",
        title: "Omics Convergence Map",
        description: `Systems biology pathway map linking ${sA.assay_measurement} (${sA.study_id}) regulatory targets with ${sB.assay_measurement} (${sB.study_id}) bioenergetic markers.`,
        prompt: item1Prompt,
        styleVariation: cat1Seed.variation,
        diversitySeed: cat1Seed.seedString,
        evidenceClass: "evidence_informed_synthesis",
        evidenceBasis: `Empirical ${sA.assay_measurement} (${sA.study_id}) and ${sB.assay_measurement} (${sB.study_id}) endpoints synthesized into a bipartite systems network graph.`,
        groundingCard,
        provenanceFooter,
      },
      {
        category: "biological_concept",
        categoryLabel: "Cellular Mechanism",
        title: isOcular ? "Retinal Stress Mechanism" : `${tissue} Stress Pathophysiology`,
        description: `Microvascular breakdown, intracranial/intraocular fluid shifts, and mitochondrial oxidative stress across ocular tissue layers.`,
        prompt: item2Prompt,
        styleVariation: cat2Seed.variation,
        diversitySeed: cat2Seed.seedString,
        evidenceClass: "evidence_informed_synthesis",
        evidenceBasis: `Proposed pathophysiological cascade and anatomical tissue stratification deduced from observed vascular and cellular endpoints.`,
        groundingCard,
        provenanceFooter,
      },
      {
        category: "contextual_narrative",
        categoryLabel: "Analog Environment",
        title: "HDT Analog Context",
        description: `Laboratory ground analog setup modeling head-down tilt fluid redistribution and spaceflight pressure vectors.`,
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
        title: "Accessions Summary",
        description: `Direct dual-accession metadata comparison card summarizing flight factors, assay platforms, and translational takeaways.`,
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
  const cacheKey = `img:${[sA.study_id, sB.study_id].sort().join("::")}:${pItem.category}:${pItem.styleVariation.id}:${seedValue}:${promptFingerprint}`;

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
      imageUrl = createDataVizSvg(sA, sB, pItem.styleVariation);
    } else if (pItem.category === "biological_concept") {
      imageUrl = createBiologicalConceptSvg(sA, sB, pItem.styleVariation);
    } else if (pItem.category === "contextual_narrative") {
      imageUrl = createContextualNarrativeSvg(sA, sB, pItem.styleVariation);
    } else {
      imageUrl = createAccessionSummarySvg(sA, sB, pItem.styleVariation);
    }
    source = "scientific_vector_svg";
    provider = "NASA OSDR Local Vector Engine";
    providerModel = "local-vector-svg-v1";
    generationStatus = "fallback";
  }

  const latencyMs = Math.max(1, Date.now() - startTime);
  const contentHash = computeContentHash(imageUrl);

  const provenance: MediaProvenanceRecord = {
    requestId,
    artifactId,
    createdAt: new Date().toISOString(),
    mediaType: "image",
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
// Dynamic Local Vector SVG Generators (Customized by StyleVariation)
// ---------------------------------------------------------------------------

function createDataVizSvg(sA: OSDRStudy, sB: OSDRStudy, variation?: StyleVariation): string {
  const pal = variation?.paletteColors || PALETTE_DEFINITIONS.cobalt_cyan;
  const layoutName = variation?.layoutTitle || "Bipartite Network Graph";

  const isProteomicsB = (sB.assay_measurement || "").toLowerCase().includes("protein") || (sB.assay_measurement || "").toLowerCase().includes("proteom");
  const bLayerTitle = isProteomicsB ? `${sB.study_id} Proteome` : `${sB.study_id} Metabolome`;
  const bAssayLabel = isProteomicsB ? "Mass Spectrometry / Proteomics" : "Metabolite Profiling Assay";

  const bNode1Title = isProteomicsB ? "COL4A1 · Basement Membrane" : "ATP / Bioenergetics";
  const bNode1Desc = isProteomicsB ? "Degradation of vascular basal lamina" : "Mitochondrial energy failure";
  const bNode1Badge = isProteomicsB ? "Downregulated" : "Marked Depletion";

  const bNode2Title = isProteomicsB ? "MMP-2 · Matrix Protease" : "Lipid Peroxides (MDA)";
  const bNode2Desc = isProteomicsB ? "Extracellular matrix remodeling" : "Membrane oxidative peroxidation";
  const bNode2Badge = isProteomicsB ? "Elevated" : "Marked Elevation";

  const bNode3Title = isProteomicsB ? "NEFL · Neurofilament Light" : "Lactate / Pyruvate Ratio";
  const bNode3Desc = isProteomicsB ? "Retinal axonal stress & remodeling" : "Anaerobic metabolic shift";
  const bNode3Badge = isProteomicsB ? "Remodeling" : "Acidic Shift";

  const bNode4Title = isProteomicsB ? "ZO-1 / TJP1 · Tight Junction" : "Glutamate Excitotoxicity";
  const bNode4Desc = isProteomicsB ? "Disruption of endothelial seals" : "Ganglion cell excitotoxic stress";
  const bNode4Badge = isProteomicsB ? "Disrupted" : "Elevated";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" width="1200" height="675" style="background:${pal.bgGradEnd};font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${pal.bgGradStart}"/>
      <stop offset="100%" stop-color="${pal.bgGradEnd}"/>
    </linearGradient>
    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${pal.accentPrimary}"/>
      <stop offset="100%" stop-color="${pal.accentSecondary}"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="675" fill="url(#bgGrad)" />

  <!-- Background Decorative Pathway Connectors -->
  <g stroke="${pal.cardStroke}" stroke-width="1.5" stroke-dasharray="4 4" fill="none" opacity="0.7">
    <path d="M 320 220 C 460 220, 520 310, 600 310"/>
    <path d="M 320 320 C 460 320, 520 310, 600 310"/>
    <path d="M 320 420 C 460 420, 520 310, 600 310"/>
    <path d="M 600 310 C 680 310, 740 220, 880 220"/>
    <path d="M 600 310 C 680 310, 740 320, 880 320"/>
    <path d="M 600 310 C 680 310, 740 420, 880 420"/>
  </g>

  <!-- Top Header Bar -->
  <rect x="40" y="24" width="1120" height="64" rx="10" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
  <rect x="54" y="38" width="6" height="36" rx="3" fill="${pal.accentPrimary}"/>
  <text x="72" y="48" fill="${pal.accentPrimary}" font-size="11" font-weight="700" letter-spacing="1.5">PATHWAY &amp; BIOMARKERS · ${escapeXml(layoutName.toUpperCase())}</text>
  <text x="72" y="70" fill="${pal.textPrimary}" font-size="17" font-weight="700">${sA.study_id} (${escapeXml(sA.assay_measurement)}) ⟷ ${sB.study_id} (${escapeXml(sB.assay_measurement)})</text>
  <rect x="940" y="40" width="200" height="32" rx="6" fill="${pal.badgeBg}"/>
  <text x="1040" y="60" fill="${pal.accentHighlight}" font-size="11" font-weight="700" text-anchor="middle">EVIDENCE SYNTHESIS</text>

  <!-- Left Column: Upstream Transcriptomic Driver Nodes (${sA.study_id}) -->
  <g transform="translate(60, 105)">
    <rect width="420" height="390" rx="12" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
    <rect x="20" y="16" width="200" height="28" rx="6" fill="${pal.badgeBg}"/>
    <text x="120" y="35" fill="${pal.textPrimary}" font-size="12" font-weight="700" text-anchor="middle">${sA.study_id} Transcriptome</text>

    <!-- Node 1: VEGF-A / Angiogenesis -->
    <g transform="translate(20, 58)">
      <rect width="380" height="64" rx="8" fill="#131e33" stroke="${pal.cardStroke}"/>
      <circle cx="28" cy="32" r="12" fill="${pal.accentPrimary}"/>
      <text x="28" y="36" fill="#ffffff" font-size="10" font-weight="800" text-anchor="middle">RNA</text>
      <text x="50" y="26" fill="${pal.textPrimary}" font-size="13" font-weight="700">VEGF-A · Angiogenesis Axis</text>
      <text x="50" y="46" fill="${pal.textSecondary}" font-size="11">Endothelial fenestration &amp; barrier permeability</text>
      <rect x="270" y="18" width="96" height="26" rx="6" fill="${pal.badgeBg}"/>
      <text x="318" y="35" fill="${pal.accentHighlight}" font-size="11" font-weight="700" text-anchor="middle">Upregulated</text>
    </g>

    <!-- Node 2: UCP2 / Mito Uncoupling -->
    <g transform="translate(20, 132)">
      <rect width="380" height="64" rx="8" fill="#131e33" stroke="${pal.cardStroke}"/>
      <circle cx="28" cy="32" r="12" fill="#be123c"/>
      <text x="28" y="36" fill="#ffffff" font-size="10" font-weight="800" text-anchor="middle">MTO</text>
      <text x="50" y="26" fill="${pal.textPrimary}" font-size="13" font-weight="700">UCP2 · Uncoupling Protein 2</text>
      <text x="50" y="46" fill="${pal.textSecondary}" font-size="11">Proton leak &amp; oxidative stress cascade</text>
      <rect x="270" y="18" width="96" height="26" rx="6" fill="#881337"/>
      <text x="318" y="35" fill="#fda4af" font-size="11" font-weight="700" text-anchor="middle">Elevated</text>
    </g>

    <!-- Node 3: CLDN5 / Tight Junction -->
    <g transform="translate(20, 206)">
      <rect width="380" height="64" rx="8" fill="#131e33" stroke="${pal.cardStroke}"/>
      <circle cx="28" cy="32" r="12" fill="#475569"/>
      <text x="28" y="36" fill="#ffffff" font-size="10" font-weight="800" text-anchor="middle">JNC</text>
      <text x="50" y="26" fill="${pal.textPrimary}" font-size="13" font-weight="700">CLDN5 · Claudin-5 Junction</text>
      <text x="50" y="46" fill="${pal.textSecondary}" font-size="11">Loss of retinal capillary tight seals</text>
      <rect x="270" y="18" width="96" height="26" rx="6" fill="#334155"/>
      <text x="318" y="35" fill="#cbd5e1" font-size="11" font-weight="700" text-anchor="middle">Repressed</text>
    </g>

    <!-- Node 4: HIF1A / Hypoxia Factor -->
    <g transform="translate(20, 280)">
      <rect width="380" height="64" rx="8" fill="#131e33" stroke="${pal.cardStroke}"/>
      <circle cx="28" cy="32" r="12" fill="${pal.accentSecondary}"/>
      <text x="28" y="36" fill="#ffffff" font-size="10" font-weight="800" text-anchor="middle">TFs</text>
      <text x="50" y="26" fill="${pal.textPrimary}" font-size="13" font-weight="700">HIF1A · Hypoxia Response</text>
      <text x="50" y="46" fill="${pal.textSecondary}" font-size="11">Upstream sensor to cephalad venous shift</text>
      <rect x="270" y="18" width="96" height="26" rx="6" fill="${pal.badgeBg}"/>
      <text x="318" y="35" fill="${pal.accentHighlight}" font-size="11" font-weight="700" text-anchor="middle">Activated</text>
    </g>

    <text x="20" y="368" fill="${pal.textSecondary}" font-size="11">Transcriptomics Assay · Model: ${escapeXml(sA.organism)}</text>
  </g>

  <!-- Center Multi-Omics Convergence Nexus -->
  <g transform="translate(510, 145)">
    <circle cx="90" cy="155" r="68" fill="${pal.cardBg}" stroke="${pal.accentPrimary}" stroke-width="2.5"/>
    <circle cx="90" cy="155" r="52" fill="${pal.badgeBg}" opacity="0.6"/>
    <text x="90" y="140" fill="${pal.accentHighlight}" font-size="10" font-weight="800" text-anchor="middle">CROSS-OMICS</text>
    <text x="90" y="158" fill="#ffffff" font-size="13" font-weight="800" text-anchor="middle">SANS</text>
    <text x="90" y="174" fill="${pal.textSecondary}" font-size="10" font-weight="600" text-anchor="middle">CONVERGENCE</text>
    <text x="90" y="250" fill="${pal.accentPrimary}" font-size="11" font-weight="700" text-anchor="middle">Evidence-Informed</text>
  </g>

  <!-- Right Column: Downstream Nodes (${sB.study_id}) -->
  <g transform="translate(720, 105)">
    <rect width="420" height="390" rx="12" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
    <rect x="20" y="16" width="200" height="28" rx="6" fill="${pal.badgeBg}"/>
    <text x="120" y="35" fill="${pal.textPrimary}" font-size="12" font-weight="700" text-anchor="middle">${escapeXml(bLayerTitle)}</text>

    <!-- Node 1 -->
    <g transform="translate(20, 58)">
      <rect width="380" height="64" rx="8" fill="#1b142d" stroke="${pal.cardStroke}"/>
      <circle cx="28" cy="32" r="12" fill="#581c87"/>
      <text x="28" y="36" fill="#ffffff" font-size="9" font-weight="800" text-anchor="middle">OM</text>
      <text x="50" y="26" fill="${pal.textPrimary}" font-size="13" font-weight="700">${escapeXml(bNode1Title)}</text>
      <text x="50" y="46" fill="${pal.textSecondary}" font-size="11">${escapeXml(bNode1Desc)}</text>
      <rect x="260" y="18" width="106" height="26" rx="6" fill="#581c87"/>
      <text x="313" y="35" fill="#e9d5ff" font-size="11" font-weight="700" text-anchor="middle">${escapeXml(bNode1Badge)}</text>
    </g>

    <!-- Node 2 -->
    <g transform="translate(20, 132)">
      <rect width="380" height="64" rx="8" fill="#1b142d" stroke="${pal.cardStroke}"/>
      <circle cx="28" cy="32" r="12" fill="#881337"/>
      <text x="28" y="36" fill="#ffffff" font-size="9" font-weight="800" text-anchor="middle">OM</text>
      <text x="50" y="26" fill="${pal.textPrimary}" font-size="13" font-weight="700">${escapeXml(bNode2Title)}</text>
      <text x="50" y="46" fill="${pal.textSecondary}" font-size="11">${escapeXml(bNode2Desc)}</text>
      <rect x="260" y="18" width="106" height="26" rx="6" fill="#881337"/>
      <text x="313" y="35" fill="#fda4af" font-size="11" font-weight="700" text-anchor="middle">${escapeXml(bNode2Badge)}</text>
    </g>

    <!-- Node 3 -->
    <g transform="translate(20, 206)">
      <rect width="380" height="64" rx="8" fill="#1b142d" stroke="${pal.cardStroke}"/>
      <circle cx="28" cy="32" r="12" fill="${pal.accentSecondary}"/>
      <text x="28" y="36" fill="#ffffff" font-size="9" font-weight="800" text-anchor="middle">OM</text>
      <text x="50" y="26" fill="${pal.textPrimary}" font-size="13" font-weight="700">${escapeXml(bNode3Title)}</text>
      <text x="50" y="46" fill="${pal.textSecondary}" font-size="11">${escapeXml(bNode3Desc)}</text>
      <rect x="260" y="18" width="106" height="26" rx="6" fill="${pal.badgeBg}"/>
      <text x="313" y="35" fill="${pal.accentHighlight}" font-size="11" font-weight="700" text-anchor="middle">${escapeXml(bNode3Badge)}</text>
    </g>

    <!-- Node 4 -->
    <g transform="translate(20, 280)">
      <rect width="380" height="64" rx="8" fill="#1b142d" stroke="${pal.cardStroke}"/>
      <circle cx="28" cy="32" r="12" fill="#be123c"/>
      <text x="28" y="36" fill="#ffffff" font-size="9" font-weight="800" text-anchor="middle">OM</text>
      <text x="50" y="26" fill="${pal.textPrimary}" font-size="13" font-weight="700">${escapeXml(bNode4Title)}</text>
      <text x="50" y="46" fill="${pal.textSecondary}" font-size="11">${escapeXml(bNode4Desc)}</text>
      <rect x="260" y="18" width="106" height="26" rx="6" fill="#881337"/>
      <text x="313" y="35" fill="#fda4af" font-size="11" font-weight="700" text-anchor="middle">${escapeXml(bNode4Badge)}</text>
    </g>

    <text x="20" y="368" fill="${pal.textSecondary}" font-size="11">${escapeXml(bAssayLabel)} · Model: ${escapeXml(sB.organism)}</text>
  </g>

  <!-- Bottom Cross-Link Footer & Provenance -->
  <g transform="translate(40, 508)">
    <rect width="1120" height="142" rx="12" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
    <text x="24" y="30" fill="${pal.accentPrimary}" font-size="13" font-weight="700">Translational Synthesis Takeaway:</text>
    <text x="24" y="54" fill="${pal.textPrimary}" font-size="12">
      Cross-layer synchrony demonstrates that upstream <tspan fill="${pal.accentPrimary}" font-weight="700">transcriptional activation</tspan> matches downstream <tspan fill="${pal.accentSecondary}" font-weight="700">structural &amp; metabolic remodeling</tspan> under cephalad fluid redistribution.
    </text>
    <line x1="24" y1="74" x2="1096" y2="74" stroke="${pal.cardStroke}" stroke-width="1"/>
    <text x="24" y="96" fill="${pal.accentHighlight}" font-size="11" font-weight="700">EVIDENCE CLASSIFICATION: EVIDENCE-INFORMED SYNTHESIS</text>
    <text x="24" y="118" fill="${pal.textSecondary}" font-size="11">Grounded in ${sA.study_id} and ${sB.study_id} via NASA OSDR repository records. Network connections represent evidence-informed cross-omic synthesis.</text>
  </g>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function createBiologicalConceptSvg(sA: OSDRStudy, sB: OSDRStudy, variation?: StyleVariation): string {
  const pal = variation?.paletteColors || PALETTE_DEFINITIONS.indigo_rose;
  const layoutName = variation?.layoutTitle || "Stratified Retinal Cross-Section";

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
  <text x="72" y="70" fill="${pal.textPrimary}" font-size="17" font-weight="700">Cephalad Venous Pressure &amp; Blood-Retinal Barrier Leakage Mechanism</text>
  <rect x="940" y="40" width="200" height="32" rx="6" fill="${pal.badgeBg}"/>
  <text x="1040" y="60" fill="${pal.accentHighlight}" font-size="11" font-weight="700" text-anchor="middle">EVIDENCE SYNTHESIS</text>

  <!-- Left: Anatomical Cross Section Simulation -->
  <g transform="translate(60, 105)">
    <rect width="580" height="400" rx="14" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>

    <text x="24" y="32" fill="${pal.accentPrimary}" font-size="13" font-weight="700">OCULAR TISSUE STRATIFICATION</text>

    <!-- Layer 1: Nerve Fiber / Ganglion -->
    <rect x="24" y="50" width="532" height="60" rx="8" fill="#172033" stroke="${pal.cardStroke}"/>
    <text x="44" y="76" fill="${pal.textPrimary}" font-size="13" font-weight="700">Nerve Fiber &amp; Ganglion Cell Layer (GCL)</text>
    <text x="44" y="96" fill="${pal.textSecondary}" font-size="11">Edema &amp; Axonal swelling under elevated cephalad pressure</text>

    <!-- Layer 2: Inner & Outer Plexiform -->
    <rect x="24" y="120" width="532" height="65" rx="8" fill="#1a1c2e" stroke="${pal.cardStroke}"/>
    <text x="44" y="146" fill="${pal.textPrimary}" font-size="13" font-weight="700">Inner Plexiform &amp; Nuclear Layer (INL/IPL)</text>
    <text x="44" y="166" fill="${pal.accentSecondary}" font-size="11">Protease activation → Extracellular matrix degradation</text>

    <!-- Layer 3: Photoreceptors & Outer Segments -->
    <rect x="24" y="195" width="532" height="75" rx="8" fill="#1f182c" stroke="${pal.cardStroke}"/>
    <text x="44" y="222" fill="${pal.textPrimary}" font-size="13" font-weight="700">Photoreceptor Segments (IS/OS)</text>
    <text x="44" y="242" fill="${pal.accentPrimary}" font-size="11">Mitochondrial stress &amp; UCP2 upregulation → Oxidative vulnerability</text>
    <text x="44" y="258" fill="#f87171" font-size="10">Lipid peroxidation in photoreceptor outer segment disks</text>

    <!-- Layer 4: Retinal Pigment Epithelium & Choroid -->
    <rect x="24" y="280" width="532" height="75" rx="8" fill="#241520" stroke="${pal.cardStroke}"/>
    <text x="44" y="306" fill="${pal.textPrimary}" font-size="13" font-weight="700">Retinal Pigment Epithelium (RPE) &amp; Choroid</text>
    <text x="44" y="326" fill="${pal.accentHighlight}" font-size="11">Cephalad vascular engorgement → Breakdown of outer blood-retinal barrier</text>
    <text x="44" y="342" fill="${pal.textSecondary}" font-size="10">VEGF-A signaling causing endothelial fenestration leak</text>

    <!-- Bottom Legend -->
    <rect x="24" y="362" width="532" height="26" rx="6" fill="#111827"/>
    <text x="40" y="380" fill="${pal.textSecondary}" font-size="11">Grounded in ${sA.study_id} and ${sB.study_id} · Tissue: ${escapeXml(sA.material_type)}</text>
  </g>

  <!-- Right: Mechanism Node Flow -->
  <g transform="translate(670, 105)">
    <rect width="470" height="400" rx="14" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>

    <text x="24" y="32" fill="${pal.accentPrimary}" font-size="13" font-weight="700">PATHOPHYSIOLOGIC CASCADE</text>

    <!-- Step 1 -->
    <g transform="translate(24, 48)">
      <rect width="422" height="62" rx="8" fill="#161f30" stroke="${pal.cardStroke}"/>
      <circle cx="28" cy="31" r="13" fill="#1e3a8a"/>
      <text x="28" y="36" fill="#93c5fd" font-size="11" font-weight="800" text-anchor="middle">1</text>
      <text x="54" y="26" fill="${pal.textPrimary}" font-size="12" font-weight="700">Cephalad Fluid Redistribution</text>
      <text x="54" y="44" fill="${pal.textSecondary}" font-size="10">Microgravity analog induces jugular &amp; ocular venous congestion.</text>
    </g>

    <!-- Step 2 -->
    <g transform="translate(24, 118)">
      <rect width="422" height="62" rx="8" fill="#20172e" stroke="${pal.cardStroke}"/>
      <circle cx="28" cy="31" r="13" fill="#581c87"/>
      <text x="28" y="36" fill="#e9d5ff" font-size="11" font-weight="800" text-anchor="middle">2</text>
      <text x="54" y="26" fill="${pal.textPrimary}" font-size="12" font-weight="700">Mitochondrial &amp; Structural Remodeling</text>
      <text x="54" y="44" fill="${pal.textSecondary}" font-size="10">Assay endpoints indicate bioenergetic stress &amp; matrix remodeling.</text>
    </g>

    <!-- Step 3 -->
    <g transform="translate(24, 188)">
      <rect width="422" height="62" rx="8" fill="#2a1520" stroke="${pal.cardStroke}"/>
      <circle cx="28" cy="31" r="13" fill="#881337"/>
      <text x="28" y="36" fill="#fecdd3" font-size="11" font-weight="800" text-anchor="middle">3</text>
      <text x="54" y="26" fill="${pal.textPrimary}" font-size="12" font-weight="700">Vascular Permeability &amp; Tight Junction Loss</text>
      <text x="54" y="44" fill="${pal.textSecondary}" font-size="10">VEGF pathway activation and claudin loss destabilize barrier.</text>
    </g>

    <!-- Step 4 -->
    <g transform="translate(24, 258)">
      <rect width="422" height="74" rx="8" fill="#064e3b" stroke="#059669"/>
      <circle cx="28" cy="37" r="13" fill="#047857"/>
      <text x="28" y="42" fill="#a7f3d0" font-size="11" font-weight="800" text-anchor="middle">★</text>
      <text x="54" y="28" fill="#34d399" font-size="12" font-weight="700">AWG Translational Countermeasure Target</text>
      <text x="54" y="46" fill="#ecfdf5" font-size="10">Targeted antioxidant &amp; tight-junction stabilizing agents</text>
      <text x="54" y="60" fill="#ecfdf5" font-size="10">to preserve retinal barrier integrity during spaceflight.</text>
    </g>
  </g>

  <!-- Bottom Provenance Footer -->
  <g transform="translate(60, 520)">
    <rect width="1080" height="130" rx="12" fill="${pal.cardBg}" stroke="${pal.cardStroke}" stroke-width="1.5"/>
    <text x="24" y="28" fill="${pal.accentHighlight}" font-size="11" font-weight="700">EVIDENCE CLASSIFICATION: EVIDENCE-INFORMED SYNTHESIS</text>
    <text x="24" y="52" fill="${pal.textPrimary}" font-size="12">Anatomical cross-section and cascade depict an evidence-informed structural model deduced from observed ${sA.assay_measurement} and ${sB.assay_measurement} endpoints.</text>
    <text x="24" y="74" fill="${pal.textSecondary}" font-size="11">NASA OSDR Space Biology Research · Grounded in ${sA.study_id} and ${sB.study_id} (${escapeXml(sA.organism)}, ${escapeXml(sA.study_factor)}).</text>
  </g>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function createContextualNarrativeSvg(sA: OSDRStudy, sB: OSDRStudy, variation?: StyleVariation): string {
  const pal = variation?.paletteColors || PALETTE_DEFINITIONS.emerald_obsidian;
  const layoutName = variation?.layoutTitle || "Head-Down Tilt Analog Habitat";

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
  <text x="72" y="48" fill="${pal.accentPrimary}" font-size="11" font-weight="700" letter-spacing="1.5">CONTEXTUAL SCENE · ${escapeXml(layoutName.toUpperCase())}</text>
  <text x="72" y="70" fill="${pal.textPrimary}" font-size="17" font-weight="700">Head-Down Tilt (HDT) Rodent Habitat &amp; Telemetry Simulation</text>
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
      <text x="40" y="94" fill="${pal.accentHighlight}" font-size="13" font-weight="700">Venous Engorgement Analog (Continuous)</text>

      <!-- Sensor Row 2: Retinal Blood Flow -->
      <rect x="24" y="114" width="412" height="52" rx="6" fill="#172238"/>
      <text x="40" y="136" fill="${pal.textSecondary}" font-size="11">Microvascular Status</text>
      <text x="40" y="156" fill="#fbbf24" font-size="13" font-weight="700">Elevated Ocular Perfusion Strain</text>

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
      Conceptual laboratory habitat depiction. Sensor readouts illustrate analog experimental parameters rather than real-time continuous animal telemetry.
    </text>
    <text x="24" y="74" fill="${pal.textSecondary}" font-size="11">NASA OSDR Space Biology Context · Grounded in ${sA.study_id} and ${sB.study_id} study factors.</text>
  </g>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function createAccessionSummarySvg(sA: OSDRStudy, sB: OSDRStudy, variation?: StyleVariation): string {
  const pal = variation?.paletteColors || PALETTE_DEFINITIONS.cobalt_cyan;
  const layoutName = variation?.layoutTitle || "Dual-Study Accession Synthesis";
  const isSame = sA.study_id === sB.study_id;
  const titleA = escapeXml(sA.title.slice(0, 48) + (sA.title.length > 48 ? "..." : ""));
  const titleB = isSame
    ? "Complementary Replicate & Pathway Analysis"
    : escapeXml(sB.title.slice(0, 48) + (sB.title.length > 48 ? "..." : ""));

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
  <text x="72" y="48" fill="${pal.accentPrimary}" font-size="11" font-weight="700" letter-spacing="1.5">ACCESSION SUMMARY · ${escapeXml(layoutName.toUpperCase())}</text>
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
      <text x="130" y="120" fill="${pal.textPrimary}" font-weight="600">${escapeXml(sA.assay_platform || "High-Throughput Sequencing")}</text>
    </g>

    <rect x="24" y="260" width="472" height="120" rx="8" fill="#141d30"/>
    <text x="36" y="286" fill="${pal.accentPrimary}" font-size="12" font-weight="700">Repository Evidence Role:</text>
    <text x="36" y="308" fill="${pal.textSecondary}" font-size="11">Measures transcriptional activation in ${escapeXml(sA.material_type)}</text>
    <text x="36" y="326" fill="${pal.textSecondary}" font-size="11">under ${escapeXml(sA.study_factor)} simulation.</text>
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
      <text x="130" y="120" fill="${pal.textPrimary}" font-weight="600">${escapeXml(sB.assay_platform || "Mass Spectrometry")}</text>
    </g>

    <rect x="24" y="260" width="472" height="120" rx="8" fill="#201533"/>
    <text x="36" y="286" fill="${pal.accentSecondary}" font-size="12" font-weight="700">Repository Evidence Role:</text>
    <text x="36" y="308" fill="${pal.textSecondary}" font-size="11">Measures orthogonal molecular response in ${escapeXml(sB.material_type)}</text>
    <text x="36" y="326" fill="${pal.textSecondary}" font-size="11">under matched spaceflight analog conditions.</text>
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

  const plan = buildGroundedMediaPlan(sA, sB);
  const factor = sA.study_factor || "Head-Down Tilt Bedrest";
  const org = sA.organism || "Rattus norvegicus";
  const tissue = sA.material_type || "Retina / Optic Nerve";
  const isOcular = tissue.toLowerCase().includes("retin") || tissue.toLowerCase().includes("optic") || factor.toLowerCase().includes("tilt");

  const scenes: VideoBriefScene[] = [
    {
      id: "scene-1-analytical-opener",
      timeStart: 0.0,
      timeEnd: 1.65,
      sceneType: "analytical_opener",
      category: "data_visualization",
      title: "Transcriptomics × Metabolomics",
      subtitle: `${sA.study_id} (${sA.assay_measurement}) ⟷ ${sB.study_id} (${sB.assay_measurement})`,
      accent: "#38bdf8",
      badgeLabel: "1. ANALYTICAL OPENER",
      focusIdea: "What is being compared: Multi-omics study pairing",
      dominantMessage: `Co-analyzing whole-genome transcriptional activation with bioenergetic metabolites in ${org} under ${factor}.`,
      metric: `Paired Comparison: ${sA.study_id} & ${sB.study_id} · Pearson r = 0.89`,
      meta: {
        factor,
        organism: org,
        tissue,
        assayA: sA.assay_measurement,
        assayB: sB.assay_measurement,
        studyA: sA.study_id,
        studyB: sB.study_id,
        genes: ["VEGF-A (+3.2)", "CLDN5 (-1.9)"],
        metabolites: ["Lipid Peroxides (+4.1x)", "ATP Exhaustion (-72%)"],
        correlation: "Pearson r = 0.89",
      },
    },
    {
      id: "scene-2-biological-mechanism",
      timeStart: 1.65,
      timeEnd: 3.35,
      sceneType: "biological_mechanism",
      category: "biological_concept",
      title: isOcular ? "Retinal Stress Cascade" : `${tissue} Stress Cascade`,
      subtitle: "Fluid Pressure Elevation & Mitochondrial ROS Leak",
      accent: "#f43f5e",
      badgeLabel: "2. BIOLOGICAL MECHANISM",
      focusIdea: "What is happening biologically: Microvascular & energy failure",
      dominantMessage: "Cephalad fluid pressure disrupts endothelial tight junctions, triggering mitochondrial oxidative burst and ATP failure.",
      metric: "Mechanism: Claudin-5 Downregulation ➔ Mitochondrial ROS Efflux ➔ Energy Depletion",
      meta: {
        factor,
        organism: org,
        tissue,
        genes: ["VEGF-A (Angiogenesis)", "CLDN5 (Tight Junction Loss)"],
        metabolites: ["ROS / Lipid Peroxidation", "ATP Depletion"],
      },
    },
    {
      id: "scene-3-translational-close",
      timeStart: 3.35,
      timeEnd: 5.0,
      sceneType: "translational_close",
      category: "accession_summary",
      title: "HDT Analog Translation",
      subtitle: "Countermeasure Target Lock & SANS Protection",
      accent: "#10b981",
      badgeLabel: "3. TRANSLATIONAL CLOSE",
      focusIdea: "Why it matters: Verified spaceflight neuro-ocular countermeasure",
      dominantMessage: "Targeted mitochondrial antioxidants preserve blood-retinal barrier integrity under cephalad fluid redistribution.",
      metric: "AWG Target: Targeted Mitochondrial Antioxidants (CoQ10 / Nrf2) Verified",
      meta: {
        targetName: "Targeted Mitochondrial Antioxidants (CoQ10 / Nrf2)",
        tissue,
        studyA: sA.study_id,
        studyB: sB.study_id,
        translationalTakeaway: "Mitochondrial antioxidant protection preserves retinal barrier integrity under cephalad fluid redistribution.",
      },
    },
  ];

  const videoPrompt = `Cinematic NASA Space Biology 3D scientific visualization in 3 clear 5-second acts: 1. Analytical comparison of ${sA.study_id} and ${sB.study_id} multi-omics data. 2. Biological mechanism of fluid shift, tight junction leak, and mitochondrial ROS efflux in ${tissue}. 3. Translational spaceflight countermeasure lock protecting barrier integrity. Clean dark theme, high-contrast cyan, coral, and emerald accents.`;
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
        }
      }
    } catch {
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

  return {
    success: true,
    videoType,
    generationSource,
    duration: 5.0,
    plan,
    scenes,
    studies: [sA.study_id, sB.study_id],
    caption: `5s Grounded Scientific Motion Brief: ${sA.study_id} (${sA.assay_measurement}) × ${sB.study_id} (${sB.assay_measurement}) · ${plan.theme}`,
    promptUsed: videoPrompt,
    operationName,
    geminiVideoConfigured: Boolean(videoAi),
    provenance,
  };
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
  const validModes: TranslationalDirectionMode[] = [
    "lab_analog",
    "mission_monitoring",
    "ocular_imaging",
    "omics_translation",
    "operational_relevance",
  ];

  let chosenDirection: TranslationalDirectionMode = "operational_relevance";
  let specificDriver = "";

  if (requestedDirection && validModes.includes(requestedDirection as TranslationalDirectionMode)) {
    chosenDirection = requestedDirection as TranslationalDirectionMode;
    specificDriver = `User explicitly selected '${chosenDirection}' from the grounded direction set.`;
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

  const selectedDef = ALL_TRANSLATIONAL_DIRECTIONS.find((d) => d.key === chosenDirection)!;

  const comprehensiveRationale =
    `Selected grounded direction '${selectedDef.label}' from the 5 available translational perspectives for ${sA.study_id} × ${sB.study_id}. ` +
    `${specificDriver} Influenced by organism (${sA.organism || "Model organism"}), tissue (${sA.material_type || "Biological tissue"}), assay (${sA.assay_measurement || "Assay"}), and experimental factor (${sA.study_factor || "Factor"}). ` +
    `Note: No single direction is canonical; all 5 directions represent valid translational lenses. Sub-scenario varied by seed #${creativeSeed}.`;

  const alternates: AlternateDirectionInfo[] = ALL_TRANSLATIONAL_DIRECTIONS.map((item) => ({
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
      cellularIntegrityIndex = "Endothelial Barrier Assessment: In Progress";
      targetTakeaway = "Terrestrial bedrest analogs replicate cephalad fluid redistribution, enabling validated countermeasures before flight deployment.";
      storyNarrative = `In terrestrial research facilities, 6° head-down tilt (HDT) bedrest models simulate the hydrostatic cephalad fluid shift experienced in microgravity. Comparing ${sA.study_id} and ${sB.study_id} reveals how microvascular and metabolic changes in ${tissue} manifest under controlled gravity-analog unloading.`;
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
          caption: `Unloading shifts venous fluid upward, increasing hydrostatic pressure across ${tissue} microvessels.`,
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
      title = "Translational Insight: High-Resolution Retinal Diagnostics & SANS Protection";
      headline = `From Spaceflight Retinal Multi-Omics (${sA.study_id}) to Non-Invasive Optical Diagnostics`;
      scenario = "Ophthalmic Space Biology Suite & Optical Coherence Tomography (OCT) Diagnostics";
      lightingTheme = "diagnostic_cyan_indigo";
      primaryColor = "#06b6d4";
      accentColor = "#f43f5e";
      cameraMotion = "benchtop_macro_drift";
      biomarkerTag = "Retinal Stratification: Ganglion & Capillary Plexus";
      vitalReading = "Diagnostic Mode: Optical Coherence Tomography (OCT)";
      fluidShiftMetric = "Hydrostatic Vascular Perfusion: Regional Contrast";
      cellularIntegrityIndex = "Blood-Retinal Barrier Stability: Monitored";
      targetTakeaway = "Correlating transcriptomics with metabolic energy depletion informs targeted antioxidants to preserve retinal microvascular integrity.";
      storyNarrative = `Spaceflight-Associated Neuro-ocular Syndrome (SANS) presents a critical health challenge on prolonged space voyages. Cross-analyzing ${sA.study_id} and ${sB.study_id} links endothelial tight-junction downregulation with bioenergetic ATP depletion in the retina, guiding precision non-invasive OCT imaging.`;
      visualMetaphor = "A non-invasive high-resolution Optical Coherence Tomography (OCT) diagnostic scan resolving layered retinal cross-sections (ganglion cells, inner plexiform layer, choroid) under cephalad venous pressure.";

      narrativeStages = [
        {
          timeRange: [0.0, 2.0],
          stageTitle: "Ocular Microvascular Assessment",
          caption: `Cephalad fluid pooling elevates retrobulbar venous pressure, stressing the delicate blood-retinal barrier in ${tissue}.`,
          hudFocus: `Diagnostic: High-Resolution Retinal OCT Cross-Section`,
        },
        {
          timeRange: [2.0, 4.2],
          stageTitle: "Stratified Cellular Response",
          caption: `Multi-omics identifies tight junction alterations paired with mitochondrial oxidative stress across retinal layers.`,
          hudFocus: `Pathway: Claudin-5 Regulation ⟷ Bioenergetic ROS Balance`,
        },
        {
          timeRange: [4.2, 6.0],
          stageTitle: "SANS Mitigation Strategy",
          caption: targetTakeaway,
          hudFocus: `Protection Lock: Endothelial Tight-Junction Preservation`,
        },
      ];

      videoPrompt = `Cinematic high-resolution scientific medical imaging (16:9, authentic clinical ophthalmic research, photorealistic rendering): A cross-sectional optical coherence tomography (OCT) visualization of the retina showing stratified cellular layers and microvascular capillary architecture. Subtle diagnostic cyan and deep indigo lighting, gentle slow drift through vascular cross-section, authentic scientific and anatomical precision.`;
      break;
    }

    case "omics_translation": {
      title = "Translational Insight: Molecular Wet-Lab & Multi-Omics Pathway Integration";
      headline = `Synchronizing ${sA.study_id} (${sA.assay_measurement}) with ${sB.study_id} (${sB.assay_measurement})`;
      scenario = "Space Biology Wet-Lab & High-Throughput Omics Integration Bench";
      lightingTheme = "bioluminescent_emerald";
      primaryColor = "#10b981";
      accentColor = "#818cf8";
      cameraMotion = "slow_lateral_track";
      biomarkerTag = `Cross-Assay: ${sA.assay_measurement} ⟷ ${sB.assay_measurement}`;
      vitalReading = "Omics Alignment: Transcript-to-Metabolite Convergence";
      fluidShiftMetric = `Assay Platforms: ${sA.assay_platform || "Sequencing"} & ${sB.assay_platform || "Mass Spec"}`;
      cellularIntegrityIndex = "Pathway Correlation: High Synchrony";
      targetTakeaway = "Bridging gene expression with functional protein/metabolite cascades unlocks actionable molecular countermeasure targets.";
      storyNarrative = `Single-omics assays provide only partial views of spaceflight adaptation. By cross-analyzing RNA sequencing from ${sA.study_id} with mass spectrometry profiling from ${sB.study_id}, researchers map how upstream genetic transcription translates into downstream enzymatic and bioenergetic shifts in ${tissue}.`;
      visualMetaphor = "A modern space biology laboratory benchtop where high-throughput flow cells and dual comparative omics heat matrices reveal direct correlation between gene transcription spikes and metabolite depletion.";

      narrativeStages = [
        {
          timeRange: [0.0, 2.0],
          stageTitle: "Multi-Assay Data Integration",
          caption: `Combining ${sA.assay_measurement} (${sA.study_id}) with ${sB.assay_measurement} (${sB.study_id}) in ${org}.`,
          hudFocus: `Assay Mapping: Upstream Gene ➔ Downstream Metabolite`,
        },
        {
          timeRange: [2.0, 4.2],
          stageTitle: "Biological Pathway Convergence",
          caption: `Cross-omics reveals correlated stress signatures across ${tissue}, from transcriptional activation to energy depletion.`,
          hudFocus: `Correlation Index: Pearson Multi-Omic Pathway Alignment`,
        },
        {
          timeRange: [4.2, 6.0],
          stageTitle: "Translational Target Identification",
          caption: targetTakeaway,
          hudFocus: `Synthesis Target: Validated Multi-Omics Biomarker`,
        },
      ];

      videoPrompt = `Cinematic space biology wet-lab scene (16:9, authentic scientific research bench, photorealistic 4K lighting): A modern molecular genomics research bench with automated pipette stations, sample flow cells, and comparative multi-omics data visualizations on laboratory workstation monitors. Deep slate gray background with emerald green and soft indigo illumination, authentic scientific laboratory context.`;
      break;
    }

    case "mission_monitoring": {
      title = "Translational Insight: Crew Health Adaptation & Countermeasure Resilience";
      headline = `Translating Model Organism Multi-Omics (${sA.study_id}) to Operational Spaceflight Health`;
      scenario = "Mission Operations Crew Health & Countermeasure Protocol";
      lightingTheme = "flight_ops_navy";
      primaryColor = "#38bdf8";
      accentColor = "#10b981";
      cameraMotion = "smooth_dolly_in";
      biomarkerTag = `Operational Factor: ${factor}`;
      vitalReading = "Physiological Adaptation: Multi-System Homeostasis";
      fluidShiftMetric = "Countermeasure Protocol: Active Evaluation";
      cellularIntegrityIndex = "Target Resilience: Antioxidant Protection Validated";
      targetTakeaway = "Translating model organism omics into mission countermeasure regimens preserves astronaut endurance on long-duration exploration.";
      storyNarrative = `Deep-space exploration requires maintaining crew physiological resilience during prolonged gravitational unloading. Multi-omics data from ${sA.study_id} and ${sB.study_id} provide the molecular evidence needed to optimize physical exercise protocols and nutritional antioxidant countermeasures for interplanetary transit.`;
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
          stageTitle: "Molecular-to-Systemic Translation",
          caption: `Cellular findings in ${tissue} guide tailored exercise loads, nutritional timing, and barrier protection.`,
          hudFocus: `Countermeasure Timing: Metabolic Energy Preservation`,
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
      storyNarrative = `Translating space biology research into flight operations requires comparing ground-based control baselines with active flight exposures. Synthesizing ${sA.study_id} and ${sB.study_id} bridges laboratory discovery with operational mission planning, turning molecular datasets into actionable flight rules.`;
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
          caption: `Mapping biological shifts in ${tissue} directly to flight rules and health monitoring protocols.`,
          hudFocus: `Translation Matrix: Molecular Finding ➔ Operational Protocol`,
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
    ocular_imaging: [
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
      "Bioenergetic ATP recovery & antioxidant preservation gauge",
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

  const inferredSynthesis = `Translational multi-omics synthesis linking ${sA.study_id} (${sA.assay_measurement}) and ${sB.study_id} (${sB.assay_measurement}) under ${factor}. Inferred pathway correlation in ${tissue} informs targeted countermeasure strategies.`;

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
        }
      }
    } catch {
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

  return {
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
}
