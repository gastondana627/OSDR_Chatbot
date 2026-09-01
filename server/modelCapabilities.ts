/**
 * Centralized Gemini Capability Registry & Router
 *
 * Normalizes model capability families across:
 * - Image (Nano Banana family)
 * - Video (Veo family)
 * - Computer Use (Computer Use Preview)
 * - Text & TTS
 */

export type CapabilityType = "text" | "image" | "video" | "tts" | "live" | "computer_use";
export type QuotaSensitivity = "low" | "medium" | "high";

export interface ModelCapabilityRecord {
  canonicalId: string;
  displayLabel: string;
  provider: "gemini";
  apiModelName: string;
  capabilityType: CapabilityType;
  familyLabel: string;
  preferredUseCase: string;
  priorityRank: number; // 1 = highest priority / default
  quotaSensitivity: QuotaSensitivity;
  enabled: boolean;
  experimental: boolean;
  fallbackIds: string[];
  notes?: string;
}

// ---------------------------------------------------------------------------
// 1. Centralized Capability Registry
// ---------------------------------------------------------------------------
export const GEMINI_CAPABILITY_REGISTRY: Record<string, ModelCapabilityRecord> = {
  // --- IMAGE FAMILY (Nano Banana) ---
  "nano-banana-2-lite": {
    canonicalId: "nano-banana-2-lite",
    displayLabel: "Nano Banana 2 Lite — Gemini 3.1 Flash Lite Image",
    provider: "gemini",
    apiModelName: "gemini-3.1-flash-lite-image",
    capabilityType: "image",
    familyLabel: "Nano Banana 2 Lite",
    preferredUseCase: "Default balanced image generation for AWG visual abstracts, diagram cards, and quick visual synthesis",
    priorityRank: 1,
    quotaSensitivity: "low",
    enabled: true,
    experimental: false,
    fallbackIds: ["imagen-3.0-generate-002", "gemini-2.5-flash-preview-image", "nano-banana-2"],
    notes: "Primary balanced default for automated study visual abstract creation",
  },
  "nano-banana": {
    canonicalId: "nano-banana",
    displayLabel: "Nano Banana — Gemini 2.5 Flash Preview Image",
    provider: "gemini",
    apiModelName: "gemini-2.5-flash-preview-image",
    capabilityType: "image",
    familyLabel: "Nano Banana",
    preferredUseCase: "Fast conceptual scientific illustrations and low-latency diagram generation",
    priorityRank: 2,
    quotaSensitivity: "low",
    enabled: true,
    experimental: true,
    fallbackIds: ["imagen-3.0-generate-002", "gemini-3.1-flash-lite-image"],
    notes: "High-speed conceptual preview generation",
  },
  "nano-banana-2": {
    canonicalId: "nano-banana-2",
    displayLabel: "Nano Banana 2 — Gemini 3.1 Flash Image",
    provider: "gemini",
    apiModelName: "gemini-3.1-flash-image",
    capabilityType: "image",
    familyLabel: "Nano Banana 2",
    preferredUseCase: "High-fidelity scientific data visualization and publication-grade comparative abstracts",
    priorityRank: 3,
    quotaSensitivity: "medium",
    enabled: true,
    experimental: false,
    fallbackIds: ["nano-banana-2-lite", "nano-banana-pro"],
    notes: "Elevated quality for complex multi-study comparisons",
  },
  "nano-banana-pro": {
    canonicalId: "nano-banana-pro",
    displayLabel: "Nano Banana Pro — Gemini 3 Pro Image",
    provider: "gemini",
    apiModelName: "gemini-3-pro-image",
    capabilityType: "image",
    familyLabel: "Nano Banana Pro",
    preferredUseCase: "Complex multi-panel figures and intricate biological ultrastructure renders",
    priorityRank: 4,
    quotaSensitivity: "high",
    enabled: true,
    experimental: false,
    fallbackIds: ["nano-banana-2", "nano-banana-2-lite"],
    notes: "Maximum detail image generation",
  },

  // --- VIDEO FAMILY (Veo) ---
  "veo-3-lite-generate-preview": {
    canonicalId: "veo-3-lite-generate-preview",
    displayLabel: "Veo 3 Lite Generate",
    provider: "gemini",
    apiModelName: "veo-3.1-lite-generate-preview",
    capabilityType: "video",
    familyLabel: "Veo 3 Lite",
    preferredUseCase: "Default cost-effective scientific video briefs and AWG meme clips under strict quota protection (2 RPM / 10 RPD)",
    priorityRank: 1,
    quotaSensitivity: "high",
    enabled: true,
    experimental: true,
    fallbackIds: ["veo-3-fast-generate", "veo-3-generate"],
    notes: "Default Veo model selected for AI Studio tier limits",
  },
  "veo-3-fast-generate": {
    canonicalId: "veo-3-fast-generate",
    displayLabel: "Veo 3 Fast Generate",
    provider: "gemini",
    apiModelName: "veo-3.0-fast-generate-001",
    capabilityType: "video",
    familyLabel: "Veo 3 Fast",
    preferredUseCase: "Rapid turnaround scientific kinetic briefs and fluid dynamic previews",
    priorityRank: 2,
    quotaSensitivity: "high",
    enabled: true,
    experimental: false,
    fallbackIds: ["veo-3-lite-generate-preview", "veo-3-generate"],
    notes: "Fast motion generation with standard 720p output",
  },
  "veo-3-generate": {
    canonicalId: "veo-3-generate",
    displayLabel: "Veo 3 Generate",
    provider: "gemini",
    apiModelName: "veo-3.0-generate-001",
    capabilityType: "video",
    familyLabel: "Veo 3 Standard / Pro",
    preferredUseCase: "Maximum-fidelity 1080p motion briefs and cinematic outreach renders",
    priorityRank: 3,
    quotaSensitivity: "high",
    enabled: true,
    experimental: false,
    fallbackIds: ["veo-3-fast-generate", "veo-3-lite-generate-preview"],
    notes: "High fidelity video model",
  },

  // --- COMPUTER USE FAMILY ---
  "computer-use-preview": {
    canonicalId: "computer-use-preview",
    displayLabel: "Computer Use Preview",
    provider: "gemini",
    apiModelName: "gemini-2.5-flash",
    capabilityType: "computer_use",
    familyLabel: "Computer Use Preview",
    preferredUseCase: "Scoped UI inspection, OSDR repository portal navigation, and structured metadata extraction",
    priorityRank: 1,
    quotaSensitivity: "medium",
    enabled: true,
    experimental: true,
    fallbackIds: [],
    notes: "Project quota: 150 RPM, 2M TPM, 10K RPD. Operates strictly within guarded domain bounds.",
  },

  // --- TEXT FAMILY ---
  "gemini-3.7-flash": {
    canonicalId: "gemini-3.7-flash",
    displayLabel: "Gemini 3.7 Flash — Primary Reasoning Engine",
    provider: "gemini",
    apiModelName: "gemini-3.7-flash",
    capabilityType: "text",
    familyLabel: "Gemini 3.7",
    preferredUseCase: "Primary AWG evidence synthesis, deep RAG reasoning, and streaming chat",
    priorityRank: 1,
    quotaSensitivity: "low",
    enabled: true,
    experimental: false,
    fallbackIds: ["gemini-2.5-flash"],
    notes: "Primary text and analytical model",
  },
  "gemini-2.5-flash": {
    canonicalId: "gemini-2.5-flash",
    displayLabel: "Gemini 2.5 Flash — Fast Synthesis & Routing",
    provider: "gemini",
    apiModelName: "gemini-2.5-flash",
    capabilityType: "text",
    familyLabel: "Gemini 2.5",
    preferredUseCase: "Low-latency JSON formatting, plan parsing, and fallback chat",
    priorityRank: 2,
    quotaSensitivity: "low",
    enabled: true,
    experimental: false,
    fallbackIds: ["gemini-3.7-flash"],
    notes: "High-speed text model",
  },

  // --- TTS FAMILY ---
  "gemini-2.5-flash-tts": {
    canonicalId: "gemini-2.5-flash-tts",
    displayLabel: "Gemini 2.5 Flash Audio — Multimodal Speech Engine",
    provider: "gemini",
    apiModelName: "gemini-2.5-flash",
    capabilityType: "tts",
    familyLabel: "Gemini Speech",
    preferredUseCase: "Natural speech generation for assistant answers with browser WAV output",
    priorityRank: 1,
    quotaSensitivity: "low",
    enabled: true,
    experimental: false,
    fallbackIds: [],
    notes: "Uses responseModalities=[AUDIO] with Aoede voice",
  },
};

// ---------------------------------------------------------------------------
// 2. Router Helper Functions
// ---------------------------------------------------------------------------

export function getAllCapabilityRecords(): ModelCapabilityRecord[] {
  return Object.values(GEMINI_CAPABILITY_REGISTRY);
}

export function getModelsByCapability(capability: CapabilityType): ModelCapabilityRecord[] {
  return Object.values(GEMINI_CAPABILITY_REGISTRY)
    .filter((m) => m.capabilityType === capability && m.enabled)
    .sort((a, b) => a.priorityRank - b.priorityRank);
}

export function getCapabilityLabelMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const record of Object.values(GEMINI_CAPABILITY_REGISTRY)) {
    map[record.canonicalId] = record.displayLabel;
    map[record.apiModelName] = record.displayLabel;
  }
  return map;
}

export function getPreferredImageModel(options?: {
  preference?: "balanced" | "speed" | "quality" | "pro";
  discoveredModels?: string[];
}): ModelCapabilityRecord {
  const availableImageModels = getModelsByCapability("image");
  const pref = options?.preference || "balanced";

  if (pref === "speed") {
    const fast = availableImageModels.find((m) => m.canonicalId === "nano-banana");
    if (fast) return fast;
  } else if (pref === "quality") {
    const qual = availableImageModels.find((m) => m.canonicalId === "nano-banana-2");
    if (qual) return qual;
  } else if (pref === "pro") {
    const pro = availableImageModels.find((m) => m.canonicalId === "nano-banana-pro");
    if (pro) return pro;
  }

  // Default: balanced (nano-banana-2-lite)
  const defaultBalanced = availableImageModels.find((m) => m.canonicalId === "nano-banana-2-lite");
  return defaultBalanced || availableImageModels[0] || GEMINI_CAPABILITY_REGISTRY["nano-banana-2-lite"];
}

export function getPreferredVideoModel(options?: {
  preference?: "lowest_quota" | "fast" | "quality";
  discoveredModels?: string[];
}): ModelCapabilityRecord {
  const availableVideoModels = getModelsByCapability("video");
  const pref = options?.preference || "lowest_quota";

  // If live discovered models are provided, find matching entry
  if (Array.isArray(options?.discoveredModels) && options.discoveredModels.length > 0) {
    const match = availableVideoModels.find((rec) =>
      options.discoveredModels!.some((disc) => disc.includes(rec.canonicalId) || disc.includes(rec.apiModelName))
    );
    if (match) return match;
  }

  if (pref === "fast") {
    const fast = availableVideoModels.find((m) => m.canonicalId === "veo-3-fast-generate");
    if (fast) return fast;
  } else if (pref === "quality") {
    const qual = availableVideoModels.find((m) => m.canonicalId === "veo-3-generate");
    if (qual) return qual;
  }

  // Default: lowest_quota (veo-3-lite-generate-preview)
  const defaultVeo = availableVideoModels.find((m) => m.canonicalId === "veo-3-lite-generate-preview");
  return defaultVeo || availableVideoModels[0] || GEMINI_CAPABILITY_REGISTRY["veo-3-lite-generate-preview"];
}

export function getPreferredComputerUseModel(): ModelCapabilityRecord {
  return GEMINI_CAPABILITY_REGISTRY["computer-use-preview"];
}

export function resolveBestModelForTask(
  task: "image_generation" | "video_generation" | "computer_use" | "text_chat" | "tts" | string,
  options?: { preference?: string; discoveredModels?: string[] }
): ModelCapabilityRecord {
  switch (task) {
    case "image_generation":
    case "image":
    case "visual_abstract":
      return getPreferredImageModel({
        preference: options?.preference as any,
        discoveredModels: options?.discoveredModels,
      });

    case "video_generation":
    case "video":
    case "motion_brief":
    case "meme_clip":
      return getPreferredVideoModel({
        preference: options?.preference as any,
        discoveredModels: options?.discoveredModels,
      });

    case "computer_use":
    case "ui_analysis":
    case "metadata_extraction":
      return getPreferredComputerUseModel();

    case "tts":
    case "speech":
      return GEMINI_CAPABILITY_REGISTRY["gemini-2.5-flash-tts"];

    case "text_chat":
    default:
      return GEMINI_CAPABILITY_REGISTRY["gemini-3.7-flash"];
  }
}
