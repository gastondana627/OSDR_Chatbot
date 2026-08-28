import { GoogleGenAI } from "@google/genai";
import { getMultiProviderDiagnostics, MultiProviderDiagnostics } from "./textProviders";

export type DiscoveryStatus =
  | "live_success"
  | "key_missing"
  | "auth_error"
  | "quota_error"
  | "discovery_error"
  | "local_fallback";

export type SystemEnvironment = "vercel" | "cloud_run" | "local" | "production" | "development";

export interface DiscoveredModelInfo {
  name: string;
  cleanName: string;
  displayName: string;
  category: "text_chat" | "image_generation" | "video_generation" | "embedding" | "other";
  supportedActions?: string[];
  description?: string;
}

export interface SystemDiagnostics {
  serverBootSuccess: boolean;
  serverBootTime: string;
  uptimeSeconds: number;
  environment: SystemEnvironment;
  isVercel: boolean;
  geminiApiKeyConfigured: boolean;
  geminiApiKeyPresent: boolean;
  geminiApiKeyPrefix?: string;
  geminiClientInitialized: boolean;
  discoveryStatus: DiscoveryStatus;
  discoveryError?: string;
  discoveryDetails?: string;
  textProviders?: MultiProviderDiagnostics;
  counts: {
    allModels: number;
    textChatModels: number;
    imageModels: number;
    videoModels: number;
  };
  models: {
    textChat: string[];
    defaultTextChat: string;
    image: string[];
    defaultImage?: string;
    video: string[];
    defaultVideo?: string;
  };
  lastStartupError: string | null;
  timestamp: string;
}

const bootTime = new Date();
let lastStartupError: string | null = null;
let cachedAiClient: GoogleGenAI | null = null;
let cachedAiClientKey: string | null = null;

let cachedDiagnostics: SystemDiagnostics | null = null;
let lastDiscoveryTimestamp = 0;
const DISCOVERY_CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes

export function recordStartupError(error: string): void {
  lastStartupError = error;
}

export function detectEnvironment(): { env: SystemEnvironment; isVercel: boolean } {
  if (process.env.VERCEL === "1" || process.env.VERCEL_ENV) {
    return { env: "vercel", isVercel: true };
  }
  if (process.env.K_SERVICE || process.env.CLOUD_RUN_JOB) {
    return { env: "cloud_run", isVercel: false };
  }
  if (process.env.NODE_ENV === "production") {
    return { env: "production", isVercel: false };
  }
  if (process.env.NODE_ENV === "development") {
    return { env: "development", isVercel: false };
  }
  return { env: "local", isVercel: false };
}

export function getSafeGeminiClient(): { client: GoogleGenAI | null; error: string | null; keyPresent: boolean } {
  const rawKey = process.env.GEMINI_API_KEY;
  const apiKey = typeof rawKey === "string" ? rawKey.trim() : "";

  if (!apiKey) {
    return {
      client: null,
      error: "GEMINI_API_KEY environment variable is not configured or is empty.",
      keyPresent: false,
    };
  }

  if (cachedAiClient && cachedAiClientKey === apiKey) {
    return {
      client: cachedAiClient,
      error: null,
      keyPresent: true,
    };
  }

  try {
    const client = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
    cachedAiClient = client;
    cachedAiClientKey = apiKey;
    return {
      client,
      error: null,
      keyPresent: true,
    };
  } catch (err: any) {
    const errMsg = err?.message || "Failed to instantiate GoogleGenAI client.";
    return {
      client: null,
      error: errMsg,
      keyPresent: true,
    };
  }
}

export const FALLBACK_TEXT_MODELS = [
  "gemini-3.7-flash",
  "gemini-2.5-flash",
  "gemini-3.1-pro-preview",
  "gemma4",
];

export const FALLBACK_IMAGE_MODELS = [
  "imagen-3.0-generate-002",
];

export const FALLBACK_VIDEO_MODELS = [
  "veo-2.0-generate-001",
];

export function categorizeModelName(name: string, supportedActions: string[] = []): DiscoveredModelInfo["category"] {
  const clean = name.replace(/^models\//, "").toLowerCase();
  if (clean.includes("veo") || supportedActions.includes("generateVideos") || supportedActions.includes("predictLongRunning")) {
    return "video_generation";
  }
  if (clean.includes("imagen") || clean.includes("image") || supportedActions.includes("generateImages")) {
    return "image_generation";
  }
  if (clean.includes("embedding") || clean.includes("embed")) {
    return "embedding";
  }
  if (clean.includes("gemini") || clean.includes("gemma") || clean.includes("learnlm") || supportedActions.includes("generateContent")) {
    return "text_chat";
  }
  return "other";
}

export async function runModelDiscovery(forceRefresh = false): Promise<SystemDiagnostics> {
  const now = Date.now();
  const rawKey = process.env.GEMINI_API_KEY;
  const apiKey = typeof rawKey === "string" ? rawKey.trim() : "";
  const { env, isVercel } = detectEnvironment();

  if (
    !forceRefresh &&
    cachedDiagnostics &&
    now - lastDiscoveryTimestamp < DISCOVERY_CACHE_TTL_MS &&
    cachedAiClientKey === (apiKey || null)
  ) {
    return {
      ...cachedDiagnostics,
      uptimeSeconds: Math.floor((now - bootTime.getTime()) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  const apiKeyPresent = Boolean(apiKey);
  const apiKeyPrefix = apiKey ? `${apiKey.slice(0, 4)}...${apiKey.slice(-3)}` : undefined;
  const { client, error: clientInitError } = getSafeGeminiClient();

  if (!apiKeyPresent || !client) {
    const diag: SystemDiagnostics = {
      serverBootSuccess: true,
      serverBootTime: bootTime.toISOString(),
      uptimeSeconds: Math.floor((now - bootTime.getTime()) / 1000),
      environment: env,
      isVercel,
      geminiApiKeyConfigured: false,
      geminiApiKeyPresent: false,
      geminiClientInitialized: false,
      discoveryStatus: "key_missing",
      discoveryError: clientInitError || "GEMINI_API_KEY environment variable is not configured. Local space biology RAG engine active.",
      discoveryDetails: "Configure GEMINI_API_KEY in Vercel project environment variables or Settings menu to enable live Gemini inference.",
      textProviders: getMultiProviderDiagnostics(),
      counts: {
        allModels: 0,
        textChatModels: FALLBACK_TEXT_MODELS.length,
        imageModels: 0,
        videoModels: 0,
      },
      models: {
        textChat: FALLBACK_TEXT_MODELS,
        defaultTextChat: "gemini-3.7-flash",
        image: [],
        video: [],
      },
      lastStartupError,
      timestamp: new Date().toISOString(),
    };
    cachedDiagnostics = diag;
    lastDiscoveryTimestamp = now;
    return diag;
  }

  try {
    const listResult = await client.models.list();
    const allModels: DiscoveredModelInfo[] = [];

    for await (const m of listResult) {
      const name = m.name || "";
      const cleanName = name.replace(/^models\//, "");
      const supportedActions: string[] = Array.isArray(m.supportedActions) ? m.supportedActions : [];
      const category = categorizeModelName(name, supportedActions);

      allModels.push({
        name,
        cleanName,
        displayName: m.displayName || cleanName,
        category,
        supportedActions,
        description: m.description,
      });
    }

    const textChatModels = allModels
      .filter((m) => m.category === "text_chat" || m.supportedActions?.includes("generateContent"))
      .map((m) => m.cleanName);

    const imageModels = allModels
      .filter((m) => m.category === "image_generation" || m.supportedActions?.includes("generateImages"))
      .map((m) => m.cleanName);

    const videoModels = allModels
      .filter((m) => m.category === "video_generation" || m.supportedActions?.includes("generateVideos") || m.supportedActions?.includes("predictLongRunning"))
      .map((m) => m.cleanName);

    // Merge discovered chat models with top recommended models
    const combinedChat = Array.from(
      new Set([
        ...textChatModels.filter((m) => m.includes("gemini-3.7") || m.includes("gemini-2.5") || m.includes("gemini-3.1")),
        ...FALLBACK_TEXT_MODELS,
        ...textChatModels,
      ])
    ).filter(Boolean);

    const diag: SystemDiagnostics = {
      serverBootSuccess: true,
      serverBootTime: bootTime.toISOString(),
      uptimeSeconds: Math.floor((now - bootTime.getTime()) / 1000),
      environment: env,
      isVercel,
      geminiApiKeyConfigured: true,
      geminiApiKeyPresent: true,
      geminiApiKeyPrefix: apiKeyPrefix,
      geminiClientInitialized: true,
      discoveryStatus: "live_success",
      textProviders: getMultiProviderDiagnostics(),
      counts: {
        allModels: allModels.length,
        textChatModels: combinedChat.length,
        imageModels: imageModels.length,
        videoModels: videoModels.length,
      },
      models: {
        textChat: combinedChat,
        defaultTextChat: combinedChat.includes("gemini-3.7-flash") ? "gemini-3.7-flash" : combinedChat[0] || "gemini-3.7-flash",
        image: imageModels.length > 0 ? imageModels : FALLBACK_IMAGE_MODELS,
        defaultImage: imageModels[0] || FALLBACK_IMAGE_MODELS[0],
        video: videoModels,
        defaultVideo: videoModels[0],
      },
      lastStartupError,
      timestamp: new Date().toISOString(),
    };

    cachedDiagnostics = diag;
    lastDiscoveryTimestamp = now;
    return diag;
  } catch (err: any) {
    const errorDetails = classifyGeminiError(err);
    const diag: SystemDiagnostics = {
      serverBootSuccess: true,
      serverBootTime: bootTime.toISOString(),
      uptimeSeconds: Math.floor((now - bootTime.getTime()) / 1000),
      environment: env,
      isVercel,
      geminiApiKeyConfigured: true,
      geminiApiKeyPresent: true,
      geminiApiKeyPrefix: apiKeyPrefix,
      geminiClientInitialized: true,
      discoveryStatus: errorDetails.category === "auth_error" ? "auth_error" : errorDetails.category === "quota_error" ? "quota_error" : "discovery_error",
      discoveryError: errorDetails.userMessage,
      discoveryDetails: errorDetails.technicalMessage,
      textProviders: getMultiProviderDiagnostics(),
      counts: {
        allModels: 0,
        textChatModels: FALLBACK_TEXT_MODELS.length,
        imageModels: 0,
        videoModels: 0,
      },
      models: {
        textChat: FALLBACK_TEXT_MODELS,
        defaultTextChat: "gemini-3.7-flash",
        image: FALLBACK_IMAGE_MODELS,
        defaultImage: FALLBACK_IMAGE_MODELS[0],
        video: [],
      },
      lastStartupError: errorDetails.userMessage,
      timestamp: new Date().toISOString(),
    };

    cachedDiagnostics = diag;
    lastDiscoveryTimestamp = now;
    return diag;
  }
}

export function classifyGeminiError(err: any): {
  code: string;
  statusCode: number;
  category: "key_missing" | "auth_error" | "quota_error" | "model_error" | "network_error" | "serverless_error" | "internal_error";
  userMessage: string;
  technicalMessage: string;
  resolution: string;
} {
  if (!process.env.GEMINI_API_KEY) {
    return {
      code: "ERR_GEMINI_KEY_MISSING",
      statusCode: 401,
      category: "key_missing",
      userMessage: "GEMINI_API_KEY environment variable is not configured.",
      technicalMessage: "process.env.GEMINI_API_KEY is undefined or empty in this deployment environment.",
      resolution: "Add GEMINI_API_KEY in the Vercel dashboard / project environment settings or in AI Studio settings.",
    };
  }

  const msg = String(err?.message || err || "").toLowerCase();
  const status = err?.status || err?.code || err?.statusCode || 0;

  if (
    status === 401 ||
    status === 403 ||
    msg.includes("api_key_invalid") ||
    msg.includes("unauthorized") ||
    msg.includes("permission_denied") ||
    msg.includes("forbidden") ||
    msg.includes("invalid api key") ||
    msg.includes("api key not valid")
  ) {
    return {
      code: "ERR_GEMINI_AUTH_INVALID",
      statusCode: 401,
      category: "auth_error",
      userMessage: "GEMINI_API_KEY is invalid or unauthorized for Google Gemini models.",
      technicalMessage: err?.message || "Google API returned 401/403 authorization failure.",
      resolution: "Verify your API key in Google AI Studio / GCP Console and update the GEMINI_API_KEY environment variable.",
    };
  }

  if (
    status === 429 ||
    msg.includes("429") ||
    msg.includes("resource_exhausted") ||
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("rate_limit")
  ) {
    return {
      code: "ERR_GEMINI_QUOTA_EXCEEDED",
      statusCode: 429,
      category: "quota_error",
      userMessage: "Gemini API rate limit or quota exceeded.",
      technicalMessage: err?.message || "Google API returned 429 RESOURCE_EXHAUSTED.",
      resolution: "Wait a moment for quota to replenish, check your project billing tier, or switch to a high-capacity model (e.g., gemini-2.5-flash).",
    };
  }

  if (
    status === 404 ||
    msg.includes("not found") ||
    msg.includes("model not supported") ||
    msg.includes("unsupported model")
  ) {
    return {
      code: "ERR_MODEL_NOT_FOUND",
      statusCode: 404,
      category: "model_error",
      userMessage: "Requested Gemini model is not available or not supported on this account.",
      technicalMessage: err?.message || "Model endpoint returned 404 Not Found.",
      resolution: "Select a supported text model from the model selector (e.g. gemini-3.7-flash or gemini-2.5-flash).",
    };
  }

  if (
    msg.includes("fetch failed") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("enotfound") ||
    msg.includes("network")
  ) {
    return {
      code: "ERR_NETWORK_UNREACHABLE",
      statusCode: 502,
      category: "network_error",
      userMessage: "Failed to connect to Google Gemini API servers from backend.",
      technicalMessage: err?.message || "Outbound network connection failed.",
      resolution: "Check outbound internet connectivity or firewall rules in your serverless deployment.",
    };
  }

  if (
    msg.includes("lambda") ||
    msg.includes("vercel") ||
    msg.includes("handler") ||
    msg.includes("module not found") ||
    msg.includes("cannot find module")
  ) {
    return {
      code: "ERR_SERVERLESS_RUNTIME",
      statusCode: 500,
      category: "serverless_error",
      userMessage: "Serverless runtime module resolution or execution failure.",
      technicalMessage: err?.message || "Serverless runtime exception.",
      resolution: "Check bundle configuration in vercel.json and ensure all required dependencies are packaged.",
    };
  }

  return {
    code: "ERR_BACKEND_EXCEPTION",
    statusCode: 500,
    category: "internal_error",
    userMessage: `Backend error: ${err?.message || "Unexpected server exception"}`,
    technicalMessage: err?.stack || err?.message || String(err),
    resolution: "Inspect server logs for complete stack trace.",
  };
}
