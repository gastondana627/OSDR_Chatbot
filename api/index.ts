import type { IncomingMessage, ServerResponse } from "http";
import app from "../server/app";
import { detectEnvironment, classifyGeminiError, runModelDiscovery } from "../server/modelDiscovery";
import { getDiagnostics } from "../server/osdrClient";

console.info("[Vercel Runtime] Boot start: initializing NASA OSDR ChatBot & AWG Evidence Engine...");
const { env, isVercel } = detectEnvironment();
console.info(`[Vercel Runtime] Environment detected: ${env} (isVercel: ${isVercel})`);
console.info(`[Vercel Runtime] GEMINI_API_KEY present: ${Boolean(process.env.GEMINI_API_KEY)}`);

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url || "/";
  const method = req.method || "GET";
  const startTs = Date.now();

  console.info(`[Vercel Runtime Route Entry] ${method} ${url} | Env: ${env} | Key configured: ${Boolean(process.env.GEMINI_API_KEY)}`);

  // 1. Fast path for /api/health and /health
  const isHealthCheck =
    url === "/api/health" ||
    url === "/health" ||
    url.startsWith("/api/health?") ||
    url.startsWith("/health?");

  if (isHealthCheck) {
    console.info(`[Vercel Runtime Health] Handling health check for ${method} ${url}`);
    if (app) {
      try {
        return app(req, res);
      } catch (appErr: any) {
        console.warn("[Vercel Runtime Health] Express health route exception, returning direct fallback payload:", appErr);
      }
    }

    const rawKey = process.env.GEMINI_API_KEY;
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        status: "ok",
        service: "NASA OSDR ChatBot & AWG Evidence Engine",
        env: isVercel ? "vercel" : "local",
        serverBoot: true,
        geminiKeyPresent: Boolean(rawKey && rawKey.trim().length > 0),
        startupError: null,
        timestamp: new Date().toISOString(),
      })
    );
    return;
  }

  // 2. Resilient path for /api/diagnostics, /api/system/diagnostics, /api/config
  const isDiagnostics =
    url === "/api/diagnostics" ||
    url === "/api/system/diagnostics" ||
    url === "/api/config" ||
    url.startsWith("/api/diagnostics?") ||
    url.startsWith("/api/system/diagnostics?") ||
    url.startsWith("/api/config?");

  // 3. Resilient path for /api/osdr/diagnostics
  const isOsdrDiagnostics =
    url === "/api/osdr/diagnostics" ||
    url.startsWith("/api/osdr/diagnostics?");

  try {
    return app(req, res);
  } catch (err: any) {
    const elapsed = Date.now() - startTs;
    console.error(`[Vercel Runtime Exception] Top-level handler failure processing ${method} ${url} (${elapsed}ms):`, err);

    if (res.headersSent) {
      console.warn(`[Vercel Runtime Headers Sent] Headers already sent for ${method} ${url}, skipping emergency response.`);
      return;
    }

    // Degraded 200 fallback for diagnostics routes
    if (isDiagnostics) {
      console.info(`[Vercel Runtime Fallback] Returning degraded 200 JSON for diagnostics.`);
      let osdrDiag: any = null;
      try {
        osdrDiag = getDiagnostics();
      } catch {
        osdrDiag = {
          sourceMode: "local_curated_mapping",
          connectionStatus: "degraded",
          lastCheckedAt: new Date().toISOString(),
          lastSuccessfulFetch: null,
          lastFetchError: "Internal OSDR diagnostics fallback",
          latencyMs: null,
          dataSources: {
            static_seeded_examples: { count: 13, description: "Static seeded benchmark studies" },
            local_curated_mapping: { count: 13, description: "In-memory fast retrieval index" },
            cached_snapshot: { count: 0, description: "Dynamic studies cache", dynamicStudyIds: [] },
            live_api: { enabled: true, active: false, totalRuntimeFetches: 0, failedRuntimeFetches: 0 },
          },
        };
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          status: "degraded",
          service: "NASA OSDR ChatBot & AWG Evidence Engine",
          error: err?.message || "Serverless runtime diagnostics error",
          code: "ERR_DIAGNOSTICS_DEGRADED",
          systemDiagnostics: {
            serverBootSuccess: true,
            environment: env,
            isVercel,
            discoveryStatus: "discovery_error",
            discoveryError: err?.message || "Serverless invocation error",
            geminiApiKeyPresent: Boolean(process.env.GEMINI_API_KEY),
            geminiApiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
            counts: { allModels: 0, textChatModels: 4, imageModels: 0, videoModels: 0 },
            models: {
              textChat: ["gemini-3.7-flash", "gemini-2.5-flash", "gemini-3.1-pro-preview", "gemma4"],
              defaultTextChat: "gemini-3.7-flash",
              image: [],
              video: [],
            },
            timestamp: new Date().toISOString(),
          },
          osdrDiagnostics: osdrDiag,
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    if (isOsdrDiagnostics) {
      console.info(`[Vercel Runtime Fallback] Returning degraded 200 JSON for OSDR diagnostics.`);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          sourceMode: "local_curated_mapping",
          connectionStatus: "degraded",
          lastCheckedAt: new Date().toISOString(),
          lastSuccessfulFetch: null,
          lastFetchError: err?.message || "Serverless invocation error",
          latencyMs: null,
          dataSources: {
            static_seeded_examples: { count: 13, description: "Static seeded benchmark studies" },
            local_curated_mapping: { count: 13, description: "In-memory fast retrieval index" },
            cached_snapshot: { count: 0, description: "Dynamic studies cache", dynamicStudyIds: [] },
            live_api: { enabled: true, active: false, totalRuntimeFetches: 0, failedRuntimeFetches: 0 },
          },
        })
      );
      return;
    }

    const classified = classifyGeminiError(err);
    res.statusCode = classified.statusCode || 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: classified.userMessage || "Internal backend exception",
        category: classified.category || "serverless_runtime_error",
        code: classified.code || "ERR_SERVERLESS_RUNTIME",
        technicalMessage: classified.technicalMessage || err?.message,
        resolution: classified.resolution || "Review serverless invocation logs.",
        env: isVercel ? "vercel" : "local",
        timestamp: new Date().toISOString(),
      })
    );
  }
}

