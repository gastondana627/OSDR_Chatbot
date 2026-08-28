import type { IncomingMessage, ServerResponse } from "http";
import app from "../server/app";
import { detectEnvironment, classifyGeminiError, runModelDiscovery } from "../server/modelDiscovery";
import { getDiagnostics, testOsdrLiveConnection } from "../server/osdrClient";
import { getMultiProviderDiagnostics } from "../server/textProviders";

console.info("[Vercel Runtime] Boot start: initializing NASA OSDR ChatBot & AWG Evidence Engine...");
const { env, isVercel } = detectEnvironment();
console.info(`[Vercel Runtime] Environment detected: ${env} (isVercel: ${isVercel})`);
console.info(`[Vercel Runtime] GEMINI_API_KEY present: ${Boolean(process.env.GEMINI_API_KEY)}`);

export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url || "/";
  const method = req.method || "GET";
  const startTs = Date.now();

  console.info(`[Vercel Runtime Route Entry] ${method} ${url} | Env: ${env} | Key configured: ${Boolean(process.env.GEMINI_API_KEY)}`);

  return new Promise<void>((resolve) => {
    let finished = false;
    const finishHandler = () => {
      if (!finished) {
        finished = true;
        resolve();
      }
    };

    res.once("finish", finishHandler);
    res.once("close", finishHandler);
    res.once("error", finishHandler);

    const isHealthCheck =
      url === "/api/health" ||
      url === "/health" ||
      url.startsWith("/api/health?") ||
      url.startsWith("/health?");

    const isDiagnostics =
      url === "/api/diagnostics" ||
      url === "/api/system/diagnostics" ||
      url === "/api/config" ||
      url.startsWith("/api/diagnostics?") ||
      url.startsWith("/api/system/diagnostics?") ||
      url.startsWith("/api/config?");

    const isOsdrDiagnostics =
      url === "/api/osdr/diagnostics" ||
      url.startsWith("/api/osdr/diagnostics?");

    const isOsdrTestConnection =
      url === "/api/osdr/test-connection" ||
      url.startsWith("/api/osdr/test-connection?");

    // Delegate to Express app with async completion tracking
    try {
      (app as any)(req, res, (err?: any) => {
        if (err) {
          const elapsed = Date.now() - startTs;
          console.error(`[Vercel Runtime Unhandled Route Callback Error after ${elapsed}ms]:`, err);

          if (!res.headersSent) {
            const classified = classifyGeminiError(err);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");

            if (isDiagnostics) {
              res.end(
                JSON.stringify({
                  status: "degraded",
                  routeEntered: true,
                  providerRegistryLoaded: true,
                  osdrPingAttempted: false,
                  failureStage: "vercel_handler_diagnostics_error",
                  errorCategory: classified.category || "serverless_runtime_error",
                  service: "NASA OSDR ChatBot & AWG Evidence Engine",
                  error: classified.userMessage,
                  code: classified.code,
                  systemDiagnostics: {
                    serverBootSuccess: true,
                    environment: env,
                    isVercel,
                    discoveryStatus: "discovery_error",
                    discoveryError: err?.message || "Serverless execution exception",
                    geminiApiKeyPresent: Boolean(process.env.GEMINI_API_KEY),
                    geminiApiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
                    textProviders: getMultiProviderDiagnostics(),
                    counts: { allModels: 0, textChatModels: 4, imageModels: 0, videoModels: 0 },
                    models: {
                      textChat: ["gemini-3.7-flash", "gemini-2.5-flash", "gemini-3.1-pro-preview", "gemma4"],
                      defaultTextChat: "gemini-3.7-flash",
                      image: [],
                      video: [],
                    },
                    timestamp: new Date().toISOString(),
                  },
                  osdrDiagnostics: getDiagnostics(),
                  timestamp: new Date().toISOString(),
                })
              );
            } else if (isOsdrDiagnostics) {
              res.end(
                JSON.stringify({
                  status: "degraded",
                  routeEntered: true,
                  providerRegistryLoaded: true,
                  osdrPingAttempted: false,
                  failureStage: "vercel_handler_osdr_diagnostics_error",
                  errorCategory: "internal_error",
                  ...getDiagnostics(),
                })
              );
            } else if (isOsdrTestConnection) {
              res.end(
                JSON.stringify({
                  status: "degraded",
                  routeEntered: true,
                  providerRegistryLoaded: true,
                  osdrPingAttempted: true,
                  failureStage: "vercel_handler_test_connection_error",
                  errorCategory: "network_error",
                  testResult: {
                    success: false,
                    latencyMs: Date.now() - startTs,
                    error: err?.message || "NASA OSDR connection test error",
                  },
                  diagnostics: getDiagnostics(),
                  timestamp: new Date().toISOString(),
                })
              );
            } else {
              res.end(
                JSON.stringify({
                  status: "degraded",
                  routeEntered: true,
                  providerRegistryLoaded: true,
                  osdrPingAttempted: false,
                  failureStage: "unhandled_serverless_route",
                  errorCategory: classified.category || "serverless_runtime_error",
                  error: classified.userMessage || "Serverless runtime exception",
                  code: classified.code || "ERR_SERVERLESS_RUNTIME",
                  technicalMessage: classified.technicalMessage || err?.message,
                  resolution: classified.resolution || "Check Vercel execution logs.",
                  timestamp: new Date().toISOString(),
                })
              );
            }
          }
        }
        finishHandler();
      });
    } catch (syncErr: any) {
      const elapsed = Date.now() - startTs;
      console.error(`[Vercel Runtime Synchronous Dispatch Exception after ${elapsed}ms]:`, syncErr);

      if (!res.headersSent) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            status: "degraded",
            routeEntered: true,
            providerRegistryLoaded: false,
            osdrPingAttempted: false,
            failureStage: "sync_dispatch_exception",
            errorCategory: "sync_runtime_error",
            error: syncErr?.message || "Synchronous route dispatch exception",
            timestamp: new Date().toISOString(),
          })
        );
      }
      finishHandler();
    }
  });
}
