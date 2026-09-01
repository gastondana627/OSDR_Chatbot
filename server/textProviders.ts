import { getGeminiApiKey } from "./env";
import { GoogleGenAI } from "@google/genai";
import { getSafeGeminiClient } from "./modelDiscovery";

export type TextProviderName = "gemini" | "openrouter" | "groq" | "local_deterministic";

export type ProviderErrorCategory =
  | "auth_error"
  | "quota_error"
  | "network_error"
  | "model_not_found"
  | "payload_error"
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
  "openrouter",
  "groq",
  "local_deterministic",
];

// Track runtime health of providers
const providerRuntimeState: Record<
  TextProviderName,
  {
    lastErrorCategory?: ProviderErrorCategory;
    lastErrorMessage?: string;
    lastSuccessfulCall?: string;
    consecutiveFailures: number;
  }
> = {
  gemini: { consecutiveFailures: 0 },
  openrouter: { consecutiveFailures: 0 },
  groq: { consecutiveFailures: 0 },
  local_deterministic: { consecutiveFailures: 0 },
};

let lastGlobalSuccessfulProvider: TextProviderName | null = null;

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
  lastGlobalSuccessfulProvider = provider;
}

export function recordProviderFailure(
  provider: TextProviderName,
  category: ProviderErrorCategory,
  errorMessage: string
): void {
  providerRuntimeState[provider].consecutiveFailures += 1;
  providerRuntimeState[provider].lastErrorCategory = category;
  providerRuntimeState[provider].lastErrorMessage = errorMessage;
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
        "meta-llama/llama-3.3-70b-instruct"
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
      const defaultModel = (process.env.GROQ_MODEL || "llama-3.3-70b-versatile").trim();
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
  modelName: string
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

  const config: any = {};
  if (req.systemInstruction) {
    config.systemInstruction = req.systemInstruction;
  }
  if (req.temperature !== undefined) {
    config.temperature = req.temperature;
  }
  if (req.responseMimeType) {
    config.responseMimeType = req.responseMimeType;
  }

  const res = await client.models.generateContent({
    model: modelName,
    contents,
    config,
  });

  const text = res.text?.trim() || "";
  if (!text) {
    throw new Error("Gemini returned empty text response.");
  }
  return text;
}

async function* streamGeminiContent(
  req: TextGenerationRequest,
  modelName: string
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

  const config: any = {};
  if (req.systemInstruction) {
    config.systemInstruction = req.systemInstruction;
  }
  if (req.temperature !== undefined) {
    config.temperature = req.temperature;
  }

  const stream = await client.models.generateContentStream({
    model: modelName,
    contents,
    config,
  });

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
  modelName: string
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

  const resp = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

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

  const json = await resp.json();
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
  modelName: string
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

  const resp = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

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
}

// -----------------------------------------------------------------------------
// Orchestration: Non-Streaming Fallback Chain
// -----------------------------------------------------------------------------

export async function generateTextWithFallback(
  req: TextGenerationRequest,
  deterministicFallback?: () => string
): Promise<TextGenerationResult> {
  const startTime = Date.now();
  const attemptedProviders: ProviderAttemptLog[] = [];

  for (let depth = 0; depth < PROVIDER_ORDER.length; depth++) {
    const provider = PROVIDER_ORDER[depth];
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

    const selectedModel =
      provider === "gemini" && req.preferredModel
        ? req.preferredModel
        : cfg.defaultModel;

    try {
      let resultText = "";
      if (provider === "gemini") {
        resultText = await executeGeminiContent(req, selectedModel);
      } else if (provider === "openrouter" || provider === "groq") {
        resultText = await executeOpenAiCompatibleContent(provider, req, selectedModel);
      }

      recordProviderSuccess(provider);
      attemptedProviders.push({
        provider,
        model: selectedModel,
        success: true,
        latencyMs: Math.max(1, Date.now() - pStart),
      });

      return {
        text: resultText,
        provider,
        model: selectedModel,
        fallbackTriggered: depth > 0,
        fallbackDepth: depth,
        isLocalFallback: false,
        attemptedProviders,
        latencyMs: Math.max(1, Date.now() - startTime),
        status: depth === 0 ? "success" : "fallback",
      };
    } catch (err: any) {
      const classified = classifyProviderError(provider, err);
      recordProviderFailure(provider, classified.category, classified.message);
      attemptedProviders.push({
        provider,
        model: selectedModel,
        success: false,
        errorCategory: classified.category,
        errorMessage: classified.message,
        statusCode: classified.statusCode,
        latencyMs: Math.max(1, Date.now() - pStart),
      });
      console.warn(
        `[Text Provider Fallback] ${provider} (${selectedModel}) failed with ${classified.category}: ${classified.message}. Cascading to next candidate...`
      );
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
  }) => void
): AsyncGenerator<StreamEventPayload> {
  const attemptedProviders: ProviderAttemptLog[] = [];

  for (let depth = 0; depth < PROVIDER_ORDER.length; depth++) {
    const provider = PROVIDER_ORDER[depth];
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
          const text = String(localRes);
          const words = text.split(/(\s+)/);
          for (const word of words) {
            yield { type: "token", data: word };
            await new Promise((r) => setTimeout(r, 10));
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

    const selectedModel =
      provider === "gemini" && req.preferredModel
        ? req.preferredModel
        : cfg.defaultModel;

    let streamGenerator: AsyncGenerator<string> | null = null;

    try {
      if (provider === "gemini") {
        streamGenerator = streamGeminiContent(req, selectedModel);
      } else if (provider === "openrouter" || provider === "groq") {
        streamGenerator = streamOpenAiCompatibleContent(provider, req, selectedModel);
      }

      if (streamGenerator) {
        // Attempt to fetch first token to verify stream viability before committing
        const first = await streamGenerator.next();
        if (!first.done) {
          recordProviderSuccess(provider);
          attemptedProviders.push({
            provider,
            model: selectedModel,
            success: true,
            latencyMs: Math.max(1, Date.now() - pStart),
          });

          onProviderMeta?.({
            provider,
            model: selectedModel,
            fallbackTriggered: depth > 0,
            fallbackDepth: depth,
            isLocalFallback: false,
            attemptedProviders,
          });

          yield {
            type: "provider_selected",
            data: {
              provider,
              model: selectedModel,
              fallbackTriggered: depth > 0,
              fallbackDepth: depth,
              isLocalFallback: false,
              attemptedProviders,
            },
          };

          if (first.value) {
            yield { type: "token", data: first.value };
          }

          for await (const chunk of streamGenerator) {
            if (chunk) {
              yield { type: "token", data: chunk };
            }
          }

          yield { type: "done", data: true };
          return;
        }
      }
    } catch (err: any) {
      const classified = classifyProviderError(provider, err);
      recordProviderFailure(provider, classified.category, classified.message);
      attemptedProviders.push({
        provider,
        model: selectedModel,
        success: false,
        errorCategory: classified.category,
        errorMessage: classified.message,
        statusCode: classified.statusCode,
        latencyMs: Math.max(1, Date.now() - pStart),
      });
      console.warn(
        `[Streaming Text Provider Fallback] ${provider} (${selectedModel}) failed: ${classified.category} (${classified.message}). Cascading to next candidate...`
      );
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
  const words = fallbackText.split(/(\s+)/);
  for (const word of words) {
    yield { type: "token", data: word };
    await new Promise((r) => setTimeout(r, 10));
  }
  yield { type: "done", data: true };
}
