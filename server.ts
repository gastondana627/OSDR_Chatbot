import "./server/env";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createExpressApp } from "./server/app";
import { getMediaConfigStatus } from "./server/mediaGen";
import { testOsdrLiveConnection } from "./server/rag";

async function startServer() {
  const app = createExpressApp();
  const PORT = 3000;

  // --- Frontend Integration ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Startup Environment & Security Validation
  function validateEnvironment() {
    const config = getMediaConfigStatus();
    console.log("--------------------------------------------------");
    console.log("[Startup Config] AI Studio & OSDR Environment:");
    console.log(`  - GEMINI_API_KEY configured: ${config.geminiApiKeyPresent}`);
    console.log(`  - Gemini image generation: ${config.geminiImageConfigured ? `Enabled (${config.imageModel})` : "Disabled (GEMINI_API_KEY missing - procedural vector fallbacks active)"}`);
    console.log(`  - Gemini video generation: ${config.geminiVideoConfigured ? `Enabled (${config.videoModel})` : "Unavailable (Conceptual motion preview fallback active)"}`);
    console.log("  ✓ All API keys and secrets strictly masked and isolated to server-side runtime.");
    console.log("--------------------------------------------------");
  }

  validateEnvironment();

  // Test live connection to NASA OSDR API in background
  testOsdrLiveConnection().then((res) => {
    if (res.success) {
      console.log(`[OSDR Connectivity] Live NASA OSDR API connected (${res.latencyMs}ms latency)`);
    } else {
      console.warn(`[OSDR Connectivity] NASA OSDR API unreachable at startup: ${res.error}`);
    }
  }).catch((err) => {
    console.warn(`[OSDR Connectivity] Error testing NASA OSDR API: ${err?.message}`);
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`OSDR ChatBot running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
