import { getGeminiApiKey } from "./env";
import { GoogleGenAI } from "@google/genai";
import { getSafeGeminiClient } from "./modelDiscovery";
import { GEMINI_CAPABILITY_REGISTRY, isReasoningModel } from "./modelCapabilities";
import { notifyApiKeyFailure } from "./alertNotifier";

export type TextProviderName = "gemini" | "openrouter" | "groq" | "local_deterministic";

export type ProviderErrorCategory =
  | "auth_error"
  | "quota_error"
  | "network_error"
  | "model_not_found"
  | "payload_error"
  | "empty_response"
  | "provider_unavailable"
  | "timeout"
  | "unknown_error";

export interface ProviderAttemptLog {
  provider: TextProviderName;
  model: string;
  success: boolean;
  errorCategory?: ProviderErrorCategory;
  errorMessage?: string;
  statusCode?: number;
  latencyMs: number;
}

export interface TextGenerationRequest {
  prompt: string;
  systemInstruction?: string;
  history?: Array<{ role: string; content: string }>;
  temperature?: number;
  maxOutputTokens?: number;
  preferredModel?: string;
  responseMimeType?: string;
}

export interface TextGenerationResult {
  text: string;
  provider: TextProviderName;
  model: string;
  fallbackTriggered: boolean;
  fallbackDepth: number; // 0 for Gemini, 1 for OpenRouter, 2 for Groq, 3 for local
  isLocalFallback: boolean;
  attemptedProviders: ProviderAttemptLog[];
  latencyMs: number;
  status: "success" | "fallback" | "failed";
}

export interface ProviderStatusInfo {
  provider: TextProviderName;
  displayName: string;
  configured: boolean;
  available: boolean;
  priority: number;
  defaultModel: string;
  currentModel: string;
  lastErrorCategory?: ProviderErrorCategory;
  lastErrorMessage?: string;
  lastSuccessfulCall?: string;
}

export interface MultiProviderDiagnostics {
  primaryProvider: TextProviderName;
  fallbackChain: TextProviderName[];
  providers: Record<TextProviderName, ProviderStatusInfo>;
  lastSuccessfulProvider: TextProviderName | null;
  overallTextReadiness: "all_ready" | "primary_ready" | "fallback_only" | "local_only";
}

export const PROVIDER_ORDER: TextProviderName[] = [
  "gemini",
  "groq",
  "openrouter",
  "local_deterministic",
];

const PROVIDER_COOLDOWN_MS = Number(process.env.LLM_PROVIDER_COOLDOWN_MS || 90_000);
const DEFAULT_FIRST_TOKEN_TIMEOUT_MS = Number(process.env.LLM_FIRST_TOKEN_TIMEOUT_MS || 5_500);
const DEFAULT_STREAM_CHUNK_TIMEOUT_MS = Number(process.env.LLM_STREAM_CHUNK_TIMEOUT_MS || 12_000);
const DEFAULT_NON_STREAM_TIMEOUT_MS = Number(process.env.LLM_NON_STREAM_TIMEOUT_MS || 9_000);
const DEFAULT_TOTAL_CASCADE_BUDGET_MS = Number(process.env.LLM_TOTAL_CASCADE_BUDGET_MS || 14_500);

export interface TextFallbackOptions {
  firstTokenTimeoutMs?: number;
  chunkTimeoutMs?: number;
  totalCascadeBudgetMs?: number;
  maxCandidatesPerProvider?: number;
  skipCooldown?: boolean;
}

// Track runtime health of providers
const providerRuntimeState: Record<
  TextProviderName,
  {
    lastErrorCategory?: ProviderErrorCategory;
    lastErrorMessage?: string;
    lastSuccessfulCall?: string;
    consecutiveFailures: number;
    cooldownUntil?: number;
  }
> = {
  gemini: { consecutiveFailures: 0 },
  openrouter: { consecutiveFailures: 0 },
  groq: { consecutiveFailures: 0 },
  local_deterministic: { consecutiveFailures: 0 },
};

let lastGlobalSuccessfulProvider: TextProviderName | null = null;

export function resetProviderHealthState(): void {
  for (const key of Object.keys(providerRuntimeState) as TextProviderName[]) {
    providerRuntimeState[key] = { consecutiveFailures: 0 };
  }
  lastGlobalSuccessfulProvider = null;
}

export function isProviderInCooldown(provider: TextProviderName, now = Date.now()): boolean {
  if (provider === "local_deterministic") return false;
  const until = providerRuntimeState[provider]?.cooldownUntil;
  return typeof until === "number" && until > now;
}

function createTimeoutError(label: string, timeoutMs: number): Error {
  const err = new Error(`${label} timed out after ${timeoutMs}ms.`);
  (err as any).status = 504;
  (err as any).code = "ETIMEDOUT";
  return err;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  onTimeout?: () => void
): Promise<T> {
  const safeTimeout = Math.max(250, timeoutMs);
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          try {
            onTimeout?.();
          } catch {
            // ignore abort hook errors
          }
          reject(createTimeoutError(label, safeTimeout));
        }, safeTimeout);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function chunkTextForFastStream(text: string, chunkSize = 220): string[] {
  const clean = String(text || "");
  if (!clean) return [];
  const chunks: string[] = [];
  for (let i = 0; i < clean.length; i += chunkSize) {
    chunks.push(clean.slice(i, i + chunkSize));
  }
  return chunks;
}

export function classifyProviderError(
  provider: TextProviderName,
  err: any,
  statusCode?: number
): { category: ProviderErrorCategory; message: string; statusCode: number } {
  const status = statusCode || err?.status || err?.code || err?.statusCode || 0;
  const msg = String(err?.message || err || "").toLowerCase();

  if (
    status === 401 ||
    status === 403 ||
    msg.includes("unauthorized") ||
    msg.includes("invalid api key") ||
    msg.includes("api_key_invalid") ||
    msg.includes("permission_denied") ||
    msg.includes("forbidden") ||
    msg.includes("authentication")
  ) {
    return {
      category: "auth_error",
      message: `${provider.toUpperCase()} API key is unauthorized or invalid (HTTP ${status || 401}).`,
      statusCode: status || 401,
    };
  }

  if (
    status === 429 ||
    msg.includes("429") ||
    msg.includes("resource_exhausted") ||
    msg.includes("rate limit") ||
    msg.includes("rate_limit") ||
    msg.includes("quota") ||
    msg.includes("insufficient_quota") ||
    msg.includes("credits")
  ) {
    return {
      category: "quota_error",
      message: `${provider.toUpperCase()} quota or rate limit exceeded (HTTP 429).`,
      statusCode: 429,
    };
  }

  if (
    status === 404 ||
    msg.includes("not found") ||
    msg.includes("model not supported") ||
    msg.includes("unknown model") ||
    msg.includes("model_not_found")
  ) {
    return {
      category: "model_not_found",
      message: `Requested model is not found on ${provider.toUpperCase()} (HTTP 404).`,
      statusCode: 404,
    };
  }

  if (status === 400 || msg.includes("bad request") || msg.includes("invalid_request")) {
    return {
      category: "payload_error",
      message: `${provider.toUpperCase()} request validation failed (HTTP 400).`,
      statusCode: 400,
    };
  }

  if (
    msg.includes("empty stream") ||
    msg.includes("empty text") ||
    msg.includes("empty choices") ||
    msg.includes("empty callback")
  ) {
    return {
      category: "empty_response",
      message: `${provider.toUpperCase()} returned an empty callback (0 tokens).`,
      statusCode: 204,
    };
  }

  if (
    msg.includes("timeout") ||
    msg.includes("etimedout") ||
    msg.includes("timed out") ||
    status === 504
  ) {
    return {
      category: "timeout",
      message: `${provider.toUpperCase()} request timed out.`,
      statusCode: 504,
    };
  }

  if (
    status === 502 ||
    status === 503 ||
    msg.includes("fetch failed") ||
    msg.includes("econnrefused") ||
    msg.includes("network") ||
    msg.includes("enotfound")
  ) {
    return {
      category: "network_error",
      message: `Network connection to ${provider.toUpperCase()} failed (HTTP ${status || 502}).`,
      statusCode: status || 502,
    };
  }

  return {
    category: "unknown_error",
    message: err?.message || `${provider.toUpperCase()} error occurred.`,
    statusCode: typeof status === "number" && status > 0 ? status : 500,
  };
}

export function recordProviderSuccess(provider: TextProviderName): void {
  providerRuntimeState[provider].consecutiveFailures = 0;
  providerRuntimeState[provider].lastSuccessfulCall = new Date().toISOString();
  providerRuntimeState[provider].lastErrorCategory = undefined;
  providerRuntimeState[provider].lastErrorMessage = undefined;
  providerRuntimeState[provider].cooldownUntil = undefined;
  lastGlobalSuccessfulProvider = provider;
}

export function recordProviderFailure(
  provider: TextProviderName,
  category: ProviderErrorCategory,
  errorMessage: string,
  meta?: { model?: string; statusCode?: number }
): void {
  providerRuntimeState[provider].consecutiveFailures += 1;
  providerRuntimeState[provider].lastErrorCategory = category;
  providerRuntimeState[provider].lastErrorMessage = errorMessage;

  if (
    provider !== "local_deterministic" &&
    (category === "network_error" ||
      category === "timeout" ||
      category === "auth_error" ||
      category === "quota_error" ||
      providerRuntimeState[provider].consecutiveFailures >= 2)
  ) {
    providerRuntimeState[provider].cooldownUntil = Date.now() + PROVIDER_COOLDOWN_MS;
  }

  // Non-blocking reminder email/webhook whenever an upstream API key is rejected (401/403)
  if (provider !== "local_deterministic" && (category === "auth_error" || category === "quota_error")) {
    notifyApiKeyFailure({
      provider,
      model: meta?.model || "",
      errorCategory: category,
      statusCode: meta?.statusCode,
      errorMessage,
    }).catch(() => {
      // Never allow notification failures to disrupt chat fallback
    });
  }
}

export function getProviderConfig(provider: TextProviderName): {
  configured: boolean;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
} {
  switch (provider) {
    case "gemini": {
      const apiKey = (getGeminiApiKey() || "").trim();
      const defaultModel = (process.env.GEMINI_TEXT_MODEL || "gemini-3.7-flash").trim();
      return {
        configured: Boolean(apiKey),
        apiKey,
        baseUrl: "https://generativelanguage.googleapis.com",
        defaultModel,
      };
    }
    case "openrouter": {
      const apiKey = (process.env.OPENROUTER_API_KEY || "").trim();
      const baseUrl = (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").trim();
      const defaultModel = (
        process.env.OPENROUTER_MODEL ||
        "openrouter/free"
      ).trim();
      return {
        configured: Boolean(apiKey),
        apiKey,
        baseUrl,
        defaultModel,
      };
    }
    case "groq": {
      const apiKey = (process.env.GROQ_API_KEY || "").trim();
      const baseUrl = (process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").trim();
      const defaultModel = (process.env.GROQ_MODEL || "openai/gpt-oss-120b").trim();
      return {
        configured: Boolean(apiKey),
        apiKey,
        baseUrl,
        defaultModel,
      };
    }
    case "local_deterministic": {
      return {
        configured: true,
        apiKey: "local-native",
        baseUrl: "local://in-memory",
        defaultModel: "local-rag-v1",
      };
    }
  }
}

export function getMultiProviderDiagnostics(): MultiProviderDiagnostics {
  const geminiCfg = getProviderConfig("gemini");
  const openrouterCfg = getProviderConfig("openrouter");
  const groqCfg = getProviderConfig("groq");
  const localCfg = getProviderConfig("local_deterministic");

  const providers: Record<TextProviderName, ProviderStatusInfo> = {
    gemini: {
      provider: "gemini",
      displayName: "Google Gemini",
      configured: geminiCfg.configured,
      available: geminiCfg.configured && providerRuntimeState.gemini.consecutiveFailures < 5,
      priority: 1,
      defaultModel: geminiCfg.defaultModel,
      currentModel: geminiCfg.defaultModel,
      lastErrorCategory: providerRuntimeState.gemini.lastErrorCategory,
      lastErrorMessage: providerRuntimeState.gemini.lastErrorMessage,
      lastSuccessfulCall: providerRuntimeState.gemini.lastSuccessfulCall,
    },
    openrouter: {
      provider: "openrouter",
      displayName: "OpenRouter",
      configured: openrouterCfg.configured,
      available: openrouterCfg.configured && providerRuntimeState.openrouter.consecutiveFailures < 5,
      priority: 2,
      defaultModel: openrouterCfg.defaultModel,
      currentModel: openrouterCfg.defaultModel,
      lastErrorCategory: providerRuntimeState.openrouter.lastErrorCategory,
      lastErrorMessage: providerRuntimeState.openrouter.lastErrorMessage,
      lastSuccessfulCall: providerRuntimeState.openrouter.lastSuccessfulCall,
    },
    groq: {
      provider: "groq",
      displayName: "Groq",
      configured: groqCfg.configured,
      available: groqCfg.configured && providerRuntimeState.groq.consecutiveFailures < 5,
      priority: 3,
      defaultModel: groqCfg.defaultModel,
      currentModel: groqCfg.defaultModel,
      lastErrorCategory: providerRuntimeState.groq.lastErrorCategory,
      lastErrorMessage: providerRuntimeState.groq.lastErrorMessage,
      lastSuccessfulCall: providerRuntimeState.groq.lastSuccessfulCall,
    },
    local_deterministic: {
      provider: "local_deterministic",
      displayName: "Local Deterministic Synthesis",
      configured: true,
      available: true,
      priority: 4,
      defaultModel: localCfg.defaultModel,
      currentModel: localCfg.defaultModel,
      lastSuccessfulCall: providerRuntimeState.local_deterministic.lastSuccessfulCall,
    },
  };

  let readiness: MultiProviderDiagnostics["overallTextReadiness"] = "local_only";
  if (geminiCfg.configured && (openrouterCfg.configured || groqCfg.configured)) {
    readiness = "all_ready";
  } else if (geminiCfg.configured) {
    readiness = "primary_ready";
  } else if (openrouterCfg.configured || groqCfg.configured) {
    readiness = "fallback_only";
  }

  return {
    primaryProvider: "gemini",
    fallbackChain: PROVIDER_ORDER,
    providers,
    lastSuccessfulProvider: lastGlobalSuccessfulProvider,
    overallTextReadiness: readiness,
  };
}

// Format message array for OpenAI-compatible chat completion endpoints (OpenRouter & Groq)
function buildOpenAiMessages(
  prompt: string,
  systemInstruction?: string,
  history: Array<{ role: string; content: string }> = []
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];

  if (systemInstruction && systemInstruction.trim()) {
    messages.push({
      role: "system",
      content: systemInstruction.trim(),
    });
  }

  for (const h of history) {
    const role =
      h.role === "assistant" || h.role === "model" ? "assistant" : "user";
    messages.push({
      role,
      content: h.content,
    });
  }

  messages.push({
    role: "user",
    content: prompt,
  });

  return messages;
}

// -----------------------------------------------------------------------------
// Provider Execution Adapters
// -----------------------------------------------------------------------------

// 1. Gemini Single & Stream Invocation
async function executeGeminiContent(
  req: TextGenerationRequest,
  modelName: string,
  timeoutMs: number = DEFAULT_NON_STREAM_TIMEOUT_MS
): Promise<string> {
  const { client } = getSafeGeminiClient();
  if (!client) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];

  if (req.history && req.history.length > 0) {
    for (const h of req.history) {
      contents.push({
        role: h.role === "assistant" || h.role === "model" ? "model" : "user",
        parts: [{ text: h.content }],
      });
    }
  }

  contents.push({
    role: "user",
    parts: [{ text: req.prompt }],
  });

  const controller = new AbortController();
  const config: any = {
    abortSignal: controller.signal,
    httpOptions: {
      timeout: timeoutMs,
      retryOptions: { attempts: 1 },
    },
  };
  if (req.systemInstruction) {
    config.systemInstruction = req.systemInstruction;
  }
  if (req.temperature !== undefined) {
    config.temperature = req.temperature;
  }
  if (req.responseMimeType) {
    config.responseMimeType = req.responseMimeType;
  }
  if (isReasoningModel(modelName)) {
    const lowerModel = modelName.toLowerCase();
    config.thinkingConfig = {
      thinkingBudget: lowerModel.includes("argon") || lowerModel.includes("gemini-4") ? 2048 : 512,
    };
    if (req.maxOutputTokens) {
      config.maxOutputTokens = req.maxOutputTokens;
    } else {
      config.maxOutputTokens = 65536; // Long decode ceiling
    }
  } else if (req.maxOutputTokens) {
    config.maxOutputTokens = req.maxOutputTokens;
  }

  const res = await withTimeout(
    client.models.generateContent({
      model: modelName,
      contents,
      config,
    }),
    timeoutMs,
    `GEMINI (${modelName})`,
    () => controller.abort()
  );

  const text = res.text?.trim() || "";
  if (!text) {
    throw new Error("Gemini returned empty text response.");
  }
  return text;
}

async function* streamGeminiContent(
  req: TextGenerationRequest,
  modelName: string,
  timeoutMs: number = DEFAULT_FIRST_TOKEN_TIMEOUT_MS,
  externalController?: AbortController
): AsyncGenerator<string> {
  const { client } = getSafeGeminiClient();
  if (!client) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];

  if (req.history && req.history.length > 0) {
    for (const h of req.history) {
      contents.push({
        role: h.role === "assistant" || h.role === "model" ? "model" : "user",
        parts: [{ text: h.content }],
      });
    }
  }

  contents.push({
    role: "user",
    parts: [{ text: req.prompt }],
  });

  const controller = externalController || new AbortController();
  const config: any = {
    abortSignal: controller.signal,
    httpOptions: {
      timeout: timeoutMs,
      retryOptions: { attempts: 1 },
    },
  };
  if (req.systemInstruction) {
    config.systemInstruction = req.systemInstruction;
  }
  if (req.temperature !== undefined) {
    config.temperature = req.temperature;
  }
  if (isReasoningModel(modelName)) {
    const lowerModel = modelName.toLowerCase();
    config.thinkingConfig = {
      thinkingBudget: lowerModel.includes("argon") || lowerModel.includes("gemini-4") ? 2048 : 512,
    };
    if (req.maxOutputTokens) {
      config.maxOutputTokens = req.maxOutputTokens;
    } else {
      config.maxOutputTokens = 65536; // Long decode ceiling
    }
  } else if (req.maxOutputTokens) {
    config.maxOutputTokens = req.maxOutputTokens;
  }

  const stream = await withTimeout(
    client.models.generateContentStream({
      model: modelName,
      contents,
      config,
    }),
    timeoutMs,
    `GEMINI (${modelName})`,
    () => controller.abort()
  );

  for await (const chunk of stream) {
    const t = chunk.text;
    if (t) {
      yield t;
    }
  }
}

// 2. OpenRouter & Groq (OpenAI-compatible) Invocation
async function executeOpenAiCompatibleContent(
  provider: "openrouter" | "groq",
  req: TextGenerationRequest,
  modelName: string,
  timeoutMs: number = DEFAULT_NON_STREAM_TIMEOUT_MS
): Promise<string> {
  const cfg = getProviderConfig(provider);
  if (!cfg.configured) {
    throw new Error(`${provider.toUpperCase()}_API_KEY is not configured.`);
  }

  const messages = buildOpenAiMessages(req.prompt, req.systemInstruction, req.history);
  const endpoint = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
  };

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://osdr.nasa.gov";
    headers["X-Title"] = "NASA OSDR ChatBot";
  }

  const body: any = {
    model: modelName,
    messages,
    temperature: req.temperature ?? 0.2,
  };

  if (req.maxOutputTokens) {
    body.max_tokens = req.maxOutputTokens;
  }

  const controller = new AbortController();
  const resp = await withTimeout(
    fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    }),
    timeoutMs,
    `${provider.toUpperCase()} (${modelName})`,
    () => controller.abort()
  );

  if (!resp.ok) {
    let errBody = "";
    try {
      const j = await resp.json();
      errBody = j.error?.message || j.message || JSON.stringify(j);
    } catch {
      errBody = await resp.text().catch(() => "");
    }
    const err = new Error(`[HTTP ${resp.status}] ${errBody || resp.statusText}`);
    (err as any).status = resp.status;
    throw err;
  }

  const json = await withTimeout(
    resp.json(),
    timeoutMs,
    `${provider.toUpperCase()} (${modelName}) JSON parse`,
    () => controller.abort()
  );
  const choice = json.choices?.[0];
  const text = choice?.message?.content?.trim() || "";
  if (!text) {
    throw new Error(`${provider.toUpperCase()} returned empty choices.`);
  }
  return text;
}

async function* streamOpenAiCompatibleContent(
  provider: "openrouter" | "groq",
  req: TextGenerationRequest,
  modelName: string,
  timeoutMs: number = DEFAULT_FIRST_TOKEN_TIMEOUT_MS,
  externalController?: AbortController
): AsyncGenerator<string> {
  const cfg = getProviderConfig(provider);
  if (!cfg.configured) {
    throw new Error(`${provider.toUpperCase()}_API_KEY is not configured.`);
  }

  const messages = buildOpenAiMessages(req.prompt, req.systemInstruction, req.history);
  const endpoint = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
  };

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://osdr.nasa.gov";
    headers["X-Title"] = "NASA OSDR ChatBot";
  }

  const body: any = {
    model: modelName,
    messages,
    stream: true,
    temperature: req.temperature ?? 0.2,
  };

  if (req.maxOutputTokens) {
    body.max_tokens = req.maxOutputTokens;
  }

  const controller = externalController || new AbortController();
  const resp = await withTimeout(
    fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    }),
    timeoutMs,
    `${provider.toUpperCase()} (${modelName})`,
    () => controller.abort()
  );

  if (!resp.ok || !resp.body) {
    let errBody = "";
    try {
      const j = await resp.json();
      errBody = j.error?.message || j.message || JSON.stringify(j);
    } catch {
      errBody = await resp.text().catch(() => "");
    }
    const err = new Error(`[HTTP ${resp.status}] ${errBody || resp.statusText}`);
    (err as any).status = resp.status;
    throw err;
  }

  const reader = (resp.body as any).getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const clean = line.trim();
        if (!clean || !clean.startsWith("data:")) continue;
        const dataStr = clean.slice(5).trim();
        if (dataStr === "[DONE]") {
          return;
        }
        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices?.[0]?.delta?.content || "";
          if (delta) {
            yield delta;
          }
        } catch {
          // Skip malformed SSE json lines
        }
      }
    }
  } finally {
    try {
      reader.releaseLock?.();
    } catch {
      // ignore release errors
    }
  }
}

// -----------------------------------------------------------------------------
// Orchestration: Non-Streaming Fallback Chain
// -----------------------------------------------------------------------------

export function getGeminiModelCandidates(primaryModel: string): string[] {
  const cleanPrimary = (primaryModel || "gemini-3.7-flash").trim();
  const record = Object.values(GEMINI_CAPABILITY_REGISTRY).find(
    (r) =>
      r.capabilityType === "text" &&
      (r.canonicalId === cleanPrimary || r.apiModelName === cleanPrimary)
  );
  const fallbacks = record?.fallbackIds || [];
  return Array.from(
    new Set([cleanPrimary, ...fallbacks, "gemini-3.7-flash", "gemini-2.5-flash", "gemini-3-flash-preview"])
  ).filter(Boolean);
}

export function getOpenRouterModelCandidates(primaryModel: string): string[] {
  const trimmed = (primaryModel || "openrouter/free").trim();
  // Preserve OpenRouter's official `openrouter/free` auto-router verbatim; only strip `openrouter/` when wrapping an org/model slug.
  const rawClean =
    trimmed.toLowerCase() === "openrouter/free"
      ? "openrouter/free"
      : trimmed.replace(/^openrouter\/(?=.+\/)/i, "");
  const isGeminiOrGroqSlug =
    rawClean.startsWith("gemini-") || rawClean === "gemma4" || rawClean.startsWith("groq/");
  const cleanPrimary = isGeminiOrGroqSlug ? "openrouter/free" : rawClean;
  const freeTierFirst = process.env.OPENROUTER_FREE_TIER_FIRST !== "false";
  const freeOnly = process.env.OPENROUTER_FREE_ONLY === "true";

  const isFreeAutoRouter = cleanPrimary.toLowerCase() === "openrouter/free";
  const baseId = cleanPrimary.replace(/:free$/i, "");
  const freeVariant = isFreeAutoRouter ? "openrouter/free" : `${baseId}:free`;
  const candidates: string[] = [];

  if (freeTierFirst || cleanPrimary.endsWith(":free") || isFreeAutoRouter) {
    candidates.push(freeVariant);
    candidates.push("openrouter/free");
    candidates.push("google/gemma-4-31b-it:free");
    candidates.push("nvidia/nemotron-3-ultra-550b-a55b:free");
    candidates.push("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free");
    candidates.push("google/gemma-4-26b-a4b-it:free");
  }
  if (!freeOnly && !isFreeAutoRouter) {
    candidates.push(cleanPrimary);
    candidates.push(baseId);
  }
  return Array.from(new Set(candidates)).filter(Boolean);
}

export function getGroqModelCandidates(primaryModel: string): string[] {
  const rawClean = (primaryModel || "openai/gpt-oss-120b")
    .trim()
    .replace(/^groq\//i, "");
  const isGroqModel =
    rawClean.startsWith("openai/gpt-oss-") ||
    rawClean.startsWith("llama-3.3-") ||
    rawClean.startsWith("llama-3.1-") ||
    rawClean.startsWith("meta-llama/llama-4-") ||
    rawClean.startsWith("qwen/qwen3") ||
    rawClean.startsWith("mixtral-") ||
    rawClean.startsWith("gemma2-");
  const primary = isGroqModel ? rawClean : "openai/gpt-oss-120b";
  return Array.from(
    new Set([
      primary,
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "llama-3.1-8b-instant",
      "llama-3.3-70b-versatile",
    ])
  );
}

export function detectPreferredProviderFromModel(
  preferredModel?: string
): TextProviderName {
  const m = String(preferredModel || "").trim().toLowerCase();
  if (!m) return "gemini";
  if (m.startsWith("groq/") || m === "llama-3.3-70b-versatile" || m === "llama-3.1-8b-instant") {
    return "groq";
  }
  if (
    m.startsWith("openrouter/") ||
    m.endsWith(":free") ||
    m.startsWith("meta-llama/") ||
    m.startsWith("deepseek/") ||
    m.startsWith("qwen/") ||
    m.startsWith("nvidia/") ||
    m.startsWith("google/gemma-3") ||
    m.startsWith("google/gemma-4") ||
    m.startsWith("mistralai/") ||
    m.startsWith("anthropic/") ||
    m.startsWith("openai/")
  ) {
    return "openrouter";
  }
  return "gemini";
}

export function resolveProviderCascadeOrder(preferredModel?: string): TextProviderName[] {
  const preferredProvider = detectPreferredProviderFromModel(preferredModel);
  if (preferredProvider === "gemini") {
    return PROVIDER_ORDER;
  }
  return [
    preferredProvider,
    ...PROVIDER_ORDER.filter((p) => p !== preferredProvider),
  ];
}

export function resolveRuntimeProviderOrder(
  preferredModel?: string,
  skipCooldown = false
): TextProviderName[] {
  const base = resolveProviderCascadeOrder(preferredModel);
  if (skipCooldown) return base;
  const now = Date.now();
  const healthyRemote: TextProviderName[] = [];
  const cooledRemote: TextProviderName[] = [];
  for (const p of base) {
    if (p === "local_deterministic") continue;
    if (isProviderInCooldown(p, now)) {
      cooledRemote.push(p);
    } else {
      healthyRemote.push(p);
    }
  }
  return [...healthyRemote, ...cooledRemote, "local_deterministic"];
}

export async function generateTextWithFallback(
  req: TextGenerationRequest,
  deterministicFallback?: () => string,
  options: TextFallbackOptions = {}
): Promise<TextGenerationResult> {
  const startTime = Date.now();
  const attemptedProviders: ProviderAttemptLog[] = [];
  const providerSequence = resolveRuntimeProviderOrder(req.preferredModel, options.skipCooldown);
  const perAttemptTimeoutMs = options.firstTokenTimeoutMs ?? DEFAULT_NON_STREAM_TIMEOUT_MS;
  const totalBudgetMs = options.totalCascadeBudgetMs ?? DEFAULT_TOTAL_CASCADE_BUDGET_MS;
  const maxPerProvider = options.maxCandidatesPerProvider ?? 2;

  for (let depth = 0; depth < providerSequence.length; depth++) {
    const provider = providerSequence[depth];
    const cfg = getProviderConfig(provider);
    const pStart = Date.now();

    if (provider === "local_deterministic") {
      const localText = deterministicFallback
        ? deterministicFallback()
        : "Local deterministic RAG synthesis completed.";
      recordProviderSuccess("local_deterministic");
      attemptedProviders.push({
        provider: "local_deterministic",
        model: cfg.defaultModel,
        success: true,
        latencyMs: Math.max(1, Date.now() - pStart),
      });

      return {
        text: localText,
        provider: "local_deterministic",
        model: cfg.defaultModel,
        fallbackTriggered: depth > 0,
        fallbackDepth: depth,
        isLocalFallback: true,
        attemptedProviders,
        latencyMs: Math.max(1, Date.now() - startTime),
        status: depth === 0 ? "success" : "fallback",
      };
    }

    if (!cfg.configured) {
      attemptedProviders.push({
        provider,
        model: cfg.defaultModel,
        success: false,
        errorCategory: "provider_unavailable",
        errorMessage: `${provider.toUpperCase()}_API_KEY is not configured in server environment.`,
        latencyMs: 0,
      });
      continue;
    }

    const elapsedSoFar = Date.now() - startTime;
    const remainingBudget = totalBudgetMs - elapsedSoFar;
    const minNeededMs = Math.min(1000, Math.max(250, perAttemptTimeoutMs));
    if (remainingBudget < minNeededMs) {
      attemptedProviders.push({
        provider,
        model: cfg.defaultModel,
        success: false,
        errorCategory: "timeout",
        errorMessage: `Skipped ${provider.toUpperCase()} because total cascade budget (${totalBudgetMs}ms) was exhausted.`,
        statusCode: 504,
        latencyMs: 0,
      });
      continue;
    }

    const preferredProvider = detectPreferredProviderFromModel(req.preferredModel);
    const primaryModel =
      req.preferredModel && preferredProvider === provider
        ? req.preferredModel
        : cfg.defaultModel;

    const fullCandidates =
      provider === "gemini"
        ? getGeminiModelCandidates(primaryModel)
        : provider === "openrouter"
        ? getOpenRouterModelCandidates(primaryModel)
        : provider === "groq"
        ? getGroqModelCandidates(primaryModel)
        : [primaryModel];
    const modelCandidates = fullCandidates.slice(0, Math.max(1, maxPerProvider));

    for (let mIdx = 0; mIdx < modelCandidates.length; mIdx++) {
      const selectedModel = modelCandidates[mIdx];
      const attemptStart = Date.now();
      const remainingForAttempt = totalBudgetMs - (Date.now() - startTime);
      if (remainingForAttempt < 250) break;
      const attemptBudget = Math.min(perAttemptTimeoutMs, remainingForAttempt);

      try {
        let resultText = "";
        if (provider === "gemini") {
          resultText = await executeGeminiContent(req, selectedModel, attemptBudget);
        } else if (provider === "openrouter" || provider === "groq") {
          resultText = await executeOpenAiCompatibleContent(provider, req, selectedModel, attemptBudget);
        }

        recordProviderSuccess(provider);
        attemptedProviders.push({
          provider,
          model: selectedModel,
          success: true,
          latencyMs: Math.max(1, Date.now() - attemptStart),
        });

        return {
          text: resultText,
          provider,
          model: selectedModel,
          fallbackTriggered: depth > 0 || mIdx > 0,
          fallbackDepth: depth,
          isLocalFallback: false,
          attemptedProviders,
          latencyMs: Math.max(1, Date.now() - startTime),
          status: depth === 0 && mIdx === 0 ? "success" : "fallback",
        };
      } catch (err: any) {
        const classified = classifyProviderError(provider, err);
        recordProviderFailure(provider, classified.category, classified.message, {
          model: selectedModel,
          statusCode: classified.statusCode,
        });
        attemptedProviders.push({
          provider,
          model: selectedModel,
          success: false,
          errorCategory: classified.category,
          errorMessage: classified.message,
          statusCode: classified.statusCode,
          latencyMs: Math.max(1, Date.now() - attemptStart),
        });
        console.warn(
          `[Text Provider Fallback] ${provider} (${selectedModel}) failed with ${classified.category}: ${classified.message}. Cascading to next candidate...`
        );

        const canTryNextModel =
          (provider === "gemini" || provider === "openrouter" || provider === "groq") &&
          mIdx + 1 < modelCandidates.length &&
          (classified.category === "model_not_found" ||
            classified.category === "quota_error" ||
            classified.category === "payload_error" ||
            classified.category === "empty_response");
        if (!canTryNextModel) {
          break;
        }
      }
    }
  }

  // If even local deterministic failed
  const fallbackText = deterministicFallback ? deterministicFallback() : "Grounded response completed.";
  return {
    text: fallbackText,
    provider: "local_deterministic",
    model: "local-rag-v1",
    fallbackTriggered: true,
    fallbackDepth: 3,
    isLocalFallback: true,
    attemptedProviders,
    latencyMs: Math.max(1, Date.now() - startTime),
    status: "fallback",
  };
}

// -----------------------------------------------------------------------------
// Orchestration: Streaming Fallback Chain (SSE-ready)
// -----------------------------------------------------------------------------

export interface StreamEventPayload {
  type: "token" | "provider_selected" | "error" | "done";
  data: any;
}

export async function* streamTextWithFallback(
  req: TextGenerationRequest,
  deterministicFallback?: () => string | AsyncGenerator<string>,
  onProviderMeta?: (meta: {
    provider: TextProviderName;
    model: string;
    fallbackTriggered: boolean;
    fallbackDepth: number;
    isLocalFallback: boolean;
    attemptedProviders: ProviderAttemptLog[];
  }) => void,
  options: TextFallbackOptions = {}
): AsyncGenerator<StreamEventPayload> {
  const cascadeStart = Date.now();
  const attemptedProviders: ProviderAttemptLog[] = [];
  const providerSequence = resolveRuntimeProviderOrder(req.preferredModel, options.skipCooldown);
  const firstTokenTimeoutMs = options.firstTokenTimeoutMs ?? DEFAULT_FIRST_TOKEN_TIMEOUT_MS;
  const chunkTimeoutMs = options.chunkTimeoutMs ?? DEFAULT_STREAM_CHUNK_TIMEOUT_MS;
  const totalBudgetMs = options.totalCascadeBudgetMs ?? DEFAULT_TOTAL_CASCADE_BUDGET_MS;
  const maxPerProvider = options.maxCandidatesPerProvider ?? 2;

  for (let depth = 0; depth < providerSequence.length; depth++) {
    const provider = providerSequence[depth];
    const cfg = getProviderConfig(provider);
    const pStart = Date.now();

    if (provider === "local_deterministic") {
      const modelName = cfg.defaultModel;
      attemptedProviders.push({
        provider: "local_deterministic",
        model: modelName,
        success: true,
        latencyMs: Math.max(1, Date.now() - pStart),
      });
      recordProviderSuccess("local_deterministic");

      onProviderMeta?.({
        provider: "local_deterministic",
        model: modelName,
        fallbackTriggered: depth > 0,
        fallbackDepth: depth,
        isLocalFallback: true,
        attemptedProviders,
      });

      yield {
        type: "provider_selected",
        data: {
          provider: "local_deterministic",
          model: modelName,
          fallbackTriggered: depth > 0,
          fallbackDepth: depth,
          isLocalFallback: true,
          attemptedProviders,
        },
      };

      if (deterministicFallback) {
        const localRes = deterministicFallback();
        if (typeof (localRes as any)?.[Symbol.asyncIterator] === "function") {
          for await (const chunk of localRes as AsyncGenerator<string>) {
            yield { type: "token", data: chunk };
          }
        } else {
          for (const chunk of chunkTextForFastStream(String(localRes))) {
            yield { type: "token", data: chunk };
          }
        }
      } else {
        yield { type: "token", data: "Grounded analysis completed." };
      }

      yield { type: "done", data: true };
      return;
    }

    if (!cfg.configured) {
      attemptedProviders.push({
        provider,
        model: cfg.defaultModel,
        success: false,
        errorCategory: "provider_unavailable",
        errorMessage: `${provider.toUpperCase()}_API_KEY is not configured in server environment.`,
        latencyMs: 0,
      });
      continue;
    }

    const elapsedSoFar = Date.now() - cascadeStart;
    const remainingBudget = totalBudgetMs - elapsedSoFar;
    const minNeededMs = Math.min(1000, Math.max(250, firstTokenTimeoutMs));
    if (remainingBudget < minNeededMs) {
      attemptedProviders.push({
        provider,
        model: cfg.defaultModel,
        success: false,
        errorCategory: "timeout",
        errorMessage: `Skipped ${provider.toUpperCase()} because total cascade budget (${totalBudgetMs}ms) was exhausted.`,
        statusCode: 504,
        latencyMs: 0,
      });
      continue;
    }

    const preferredProvider = detectPreferredProviderFromModel(req.preferredModel);
    const primaryModel =
      req.preferredModel && preferredProvider === provider
        ? req.preferredModel
        : cfg.defaultModel;

    const fullCandidates =
      provider === "gemini"
        ? getGeminiModelCandidates(primaryModel)
        : provider === "openrouter"
        ? getOpenRouterModelCandidates(primaryModel)
        : provider === "groq"
        ? getGroqModelCandidates(primaryModel)
        : [primaryModel];
    const modelCandidates = fullCandidates.slice(0, Math.max(1, maxPerProvider));

    for (let mIdx = 0; mIdx < modelCandidates.length; mIdx++) {
      const selectedModel = modelCandidates[mIdx];
      const attemptStart = Date.now();
      const remainingForAttempt = totalBudgetMs - (Date.now() - cascadeStart);
      if (remainingForAttempt < 250) break;
      const attemptTimeoutMs = Math.min(firstTokenTimeoutMs, remainingForAttempt);

      const controller = new AbortController();
      let streamGenerator: AsyncGenerator<string> | null = null;

      try {
        if (provider === "gemini") {
          streamGenerator = streamGeminiContent(req, selectedModel, attemptTimeoutMs, controller);
        } else if (provider === "openrouter" || provider === "groq") {
          streamGenerator = streamOpenAiCompatibleContent(
            provider,
            req,
            selectedModel,
            attemptTimeoutMs,
            controller
          );
        }

        if (streamGenerator) {
          // Pull until the first non-whitespace chunk arrives within the first-token timeout
          let firstNonEmptyChunk = "";
          const firstTokenDeadline = Date.now() + attemptTimeoutMs;
          while (true) {
            const leftMs = firstTokenDeadline - Date.now();
            if (leftMs <= 0) {
              controller.abort();
              throw createTimeoutError(`${provider.toUpperCase()} (${selectedModel}) first token`, attemptTimeoutMs);
            }
            const nextStep = await withTimeout(
              streamGenerator.next(),
              leftMs,
              `${provider.toUpperCase()} (${selectedModel}) first token`,
              () => controller.abort()
            );
            if (nextStep.done) {
              break;
            }
            if (typeof nextStep.value === "string" && nextStep.value.trim().length > 0) {
              firstNonEmptyChunk = nextStep.value;
              break;
            }
          }

          if (!firstNonEmptyChunk) {
            throw new Error(
              `${provider.toUpperCase()} (${selectedModel}) returned an empty stream callback (0 tokens).`
            );
          }

          recordProviderSuccess(provider);
          attemptedProviders.push({
            provider,
            model: selectedModel,
            success: true,
            latencyMs: Math.max(1, Date.now() - attemptStart),
          });

          onProviderMeta?.({
            provider,
            model: selectedModel,
            fallbackTriggered: depth > 0 || mIdx > 0,
            fallbackDepth: depth,
            isLocalFallback: false,
            attemptedProviders,
          });

          yield {
            type: "provider_selected",
            data: {
              provider,
              model: selectedModel,
              fallbackTriggered: depth > 0 || mIdx > 0,
              fallbackDepth: depth,
              isLocalFallback: false,
              attemptedProviders,
            },
          };

          yield { type: "token", data: firstNonEmptyChunk };

          try {
            while (true) {
              const nextStep = await withTimeout(
                streamGenerator.next(),
                chunkTimeoutMs,
                `${provider.toUpperCase()} (${selectedModel}) stream chunk`,
                () => controller.abort()
              );
              if (nextStep.done) break;
              if (nextStep.value) {
                yield { type: "token", data: nextStep.value };
              }
            }
          } catch (midStreamErr: any) {
            console.warn(
              `[Streaming Text Provider Mid-Stream Warning] ${provider} (${selectedModel}) interrupted after first token:`,
              midStreamErr?.message || midStreamErr
            );
          }

          yield { type: "done", data: true };
          return;
        }
      } catch (err: any) {
        try {
          controller.abort();
          await streamGenerator?.return?.(undefined as any);
        } catch {
          // ignore cleanup errors
        }
        const classified = classifyProviderError(provider, err);
        recordProviderFailure(provider, classified.category, classified.message, {
          model: selectedModel,
          statusCode: classified.statusCode,
        });
        attemptedProviders.push({
          provider,
          model: selectedModel,
          success: false,
          errorCategory: classified.category,
          errorMessage: classified.message,
          statusCode: classified.statusCode,
          latencyMs: Math.max(1, Date.now() - attemptStart),
        });
        console.warn(
          `[Streaming Text Provider Fallback] ${provider} (${selectedModel}) failed: ${classified.category} (${classified.message}). Cascading to next candidate...`
        );

        const canTryNextModel =
          (provider === "gemini" || provider === "openrouter" || provider === "groq") &&
          mIdx + 1 < modelCandidates.length &&
          (classified.category === "model_not_found" ||
            classified.category === "quota_error" ||
            classified.category === "payload_error" ||
            classified.category === "empty_response");
        if (!canTryNextModel) {
          break;
        }
      }
    }
  }

  // All remote providers exhausted; fallback to local synthesis
  yield {
    type: "provider_selected",
    data: {
      provider: "local_deterministic",
      model: "local-rag-v1",
      fallbackTriggered: true,
      fallbackDepth: 3,
      isLocalFallback: true,
      attemptedProviders,
    },
  };

  const fallbackText = deterministicFallback ? String(deterministicFallback()) : "Grounded response completed.";
  for (const chunk of chunkTextForFastStream(fallbackText)) {
    yield { type: "token", data: chunk };
  }
  yield { type: "done", data: true };
}
