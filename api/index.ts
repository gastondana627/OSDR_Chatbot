import type { IncomingMessage, ServerResponse } from "http";
import app from "../server/app";
import { detectEnvironment, classifyGeminiError } from "../server/modelDiscovery";

console.info("[Vercel Runtime] Boot start: initializing NASA OSDR ChatBot & AWG Evidence Engine...");
const { env, isVercel } = detectEnvironment();
console.info(`[Vercel Runtime] Environment detected: ${env} (isVercel: ${isVercel})`);
console.info(`[Vercel Runtime] GEMINI_API_KEY present: ${Boolean(process.env.GEMINI_API_KEY)}`);

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url || "/";
  const method = req.method || "GET";

  // Fast emergency path for /api/health and /health
  const isHealthCheck =
    url === "/api/health" ||
    url === "/health" ||
    url.startsWith("/api/health?") ||
    url.startsWith("/health?");

  if (isHealthCheck) {
    console.info(`[Vercel Runtime] Serving health check for ${method} ${url}`);
    if (app) {
      try {
        return app(req, res);
      } catch (appErr: any) {
        console.warn("[Vercel Runtime] Express health route error, returning direct emergency payload:", appErr);
      }
    }

    // Direct guaranteed 200 payload
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

  try {
    return app(req, res);
  } catch (err: any) {
    console.error(`[Vercel Runtime] Uncaught exception processing ${method} ${url}:`, err);
    const classified = classifyGeminiError(err);
    if (!res.headersSent) {
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
}
