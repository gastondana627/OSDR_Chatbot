import express from "express";
import cors from "cors";
import {
  getAllStudies,
  getStudyById,
  fetchLiveOSDRStudy,
  searchStudies,
  searchLiveOSDR,
  testOsdrLiveConnection,
  getDiagnostics,
} from "./rag";
import { generateChatStream } from "./gemini";
import {
  generateVisualAbstract,
  generateStudyBriefVideo,
  generateTranslationalClip,
  generateAwgMediaSet,
  getMediaConfigStatus,
  getMediaAuditLog,
} from "./mediaGen";
import {
  getSuggestedAwgPairs,
  selectRandomCompatiblePair,
  scoreStudyCompatibility,
} from "./awg";
import { generateAwgMemeConcept } from "./memeGen";
import {
  runModelDiscovery,
  classifyGeminiError,
  detectEnvironment,
} from "./modelDiscovery";
import { getMultiProviderDiagnostics } from "./textProviders";

export function createExpressApp(): express.Express {
  const app = express();

  app.use(cors());

  // Handle both pre-parsed serverless bodies and standard requests safely
  app.use((req, res, next) => {
    if (req.body && typeof req.body === "object") {
      return next();
    }
    express.json({ limit: "10mb" })(req, res, next);
  });
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  const apiRouter = express.Router();

  // GET /api/health - Minimal safe endpoint (zero dependencies, no model discovery, no external APIs)
  apiRouter.get("/health", (req: express.Request, res: express.Response) => {
    try {
      console.info("[Health Check] Handling /health request");
      const rawKey = process.env.GEMINI_API_KEY;
      const geminiKeyPresent = Boolean(rawKey && rawKey.trim().length > 0);
      const { env, isVercel } = detectEnvironment();

      res.status(200).json({
        ok: true,
        env: isVercel ? "vercel" : "local",
        serverBoot: true,
        geminiKeyPresent,
        startupError: null,
      });
    } catch (healthErr: any) {
      console.error("[Health Check Error]:", healthErr);
      res.status(200).json({
        ok: true,
        env: "vercel",
        serverBoot: true,
        geminiKeyPresent: false,
        startupError: healthErr?.message || "Health check fallback",
      });
    }
  });

  // GET /api/diagnostics & /api/system/diagnostics - Full model discovery and server diagnostics
  const handleDiagnostics = async (req: express.Request, res: express.Response) => {
    const startTs = Date.now();
    let stage = "request_entry";
    let providerRegistryLoaded = false;
    const osdrPingAttempted = false;

    try {
      stage = "provider_registry_init";
      // Safe probe of provider cascade
      const multiDiag = getMultiProviderDiagnostics();
      providerRegistryLoaded = Boolean(multiDiag && multiDiag.providers);

      stage = "model_discovery";
      const forceRefresh = req.query.refresh === "true";
      const keyPresent = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
      console.info(`[Diagnostics Entry] ForceRefresh=${forceRefresh} | GeminiKeyPresent=${keyPresent}`);
      
      const modelDiag = await runModelDiscovery(forceRefresh);
      console.info(`[Diagnostics Model Discovery Completed] Status=${modelDiag.discoveryStatus} | ModelsCount=${modelDiag.counts.textChatModels}`);
      
      stage = "osdr_lookup";
      const osdrDiag = getDiagnostics();
      console.info(`[Diagnostics OSDR Lookup Completed] SourceMode=${osdrDiag.sourceMode} | TotalStudies=${osdrDiag.dataSources.local_curated_mapping.count}`);
      
      const elapsed = Date.now() - startTs;
      console.info(`[Diagnostics Success] Completed in ${elapsed}ms`);
      
      res.status(200).json({
        status: "ok",
        routeEntered: true,
        providerRegistryLoaded,
        osdrPingAttempted,
        failureStage: null,
        errorCategory: null,
        service: "NASA OSDR ChatBot & AWG Evidence Engine",
        systemDiagnostics: modelDiag,
        osdrDiagnostics: osdrDiag,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      const elapsed = Date.now() - startTs;
      console.warn(`[Diagnostics Error in stage '${stage}' after ${elapsed}ms]:`, err);
      const classified = classifyGeminiError(err);
      
      let safeOsdrDiag: any;
      try {
        safeOsdrDiag = getDiagnostics();
      } catch (osdrErr) {
        console.warn("[Diagnostics OSDR Lookup Fallback]:", osdrErr);
        safeOsdrDiag = {
          sourceMode: "local_curated_mapping",
          connectionStatus: "degraded",
          lastCheckedAt: new Date().toISOString(),
          lastSuccessfulFetch: null,
          lastFetchError: "Diagnostics OSDR fallback",
          latencyMs: null,
          dataSources: {
            static_seeded_examples: { count: 13, description: "Static seeded benchmark studies" },
            local_curated_mapping: { count: 13, description: "In-memory fast retrieval index" },
            cached_snapshot: { count: 0, description: "Dynamic studies cache", dynamicStudyIds: [] },
            live_api: { enabled: true, active: false, totalRuntimeFetches: 0, failedRuntimeFetches: 0 },
          },
        };
      }

      res.status(200).json({
        status: "degraded",
        routeEntered: true,
        providerRegistryLoaded,
        osdrPingAttempted,
        failureStage: stage,
        errorCategory: classified.category || "discovery_error",
        service: "NASA OSDR ChatBot & AWG Evidence Engine",
        error: classified.userMessage,
        code: classified.code,
        systemDiagnostics: {
          serverBootSuccess: true,
          discoveryStatus: "discovery_error",
          discoveryError: err?.message || "Diagnostics model discovery failed",
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
        },
        osdrDiagnostics: safeOsdrDiag,
        timestamp: new Date().toISOString(),
      });
    }
  };

  apiRouter.get("/diagnostics", handleDiagnostics);
  apiRouter.get("/system/diagnostics", handleDiagnostics);
  apiRouter.get("/config", handleDiagnostics);

  // GET /api/models - dynamically discovered models with fallback
  apiRouter.get("/models", async (req, res) => {
    try {
      const forceRefresh = req.query.refresh === "true";
      const diag = await runModelDiscovery(forceRefresh);
      res.json({
        models: diag.models.textChat,
        default: diag.models.defaultTextChat,
        discoveryStatus: diag.discoveryStatus,
        geminiApiKeyConfigured: diag.geminiApiKeyConfigured,
        counts: diag.counts,
        discoveryError: diag.discoveryError,
      });
    } catch (err: any) {
      console.warn("[Models Endpoint Error, returning fallback]:", err);
      res.json({
        models: ["gemini-3.7-flash", "gemini-2.5-flash", "gemini-3.1-pro-preview", "gemma4"],
        default: "gemini-3.7-flash",
        discoveryStatus: "local_fallback",
        error: err?.message || "Model discovery failed, using fallback list",
      });
    }
  });

  // GET /api/studies - list cached studies (id, title, file_count)
  apiRouter.get("/studies", (req, res) => {
    try {
      const all = getAllStudies();
      const items = all.map((s) => ({
        study_id: s.study_id,
        title: s.title || "",
        file_count: s.file_count || 0,
      }));
      res.json({
        studies: items,
        count: items.length,
      });
    } catch (err: any) {
      res.status(200).json({
        studies: [],
        count: 0,
        error: err?.message || "Failed to retrieve studies",
      });
    }
  });

  // GET /api/study/:study_id - full cached or live record for one study
  apiRouter.get("/study/:study_id", async (req, res) => {
    try {
      const sid = req.params.study_id;
      let found = getStudyById(sid);
      if (!found) {
        found = (await fetchLiveOSDRStudy(sid)) || undefined;
      }
      if (!found) {
        return res.status(404).json({ error: `Study ${sid} not found in OSDR` });
      }
      res.json(found);
    } catch (err: any) {
      res.status(200).json({
        error: err?.message || "Failed to retrieve study record",
        study_id: req.params.study_id,
      });
    }
  });

  // GET /api/search - semantic and keyword study search
  apiRouter.get("/search", (req, res) => {
    try {
      const q = String(req.query.q || "");
      const k = parseInt(String(req.query.k || "10"), 10);
      const results = searchStudies(q, k);
      res.json({ results });
    } catch (err: any) {
      res.status(200).json({ results: [], error: err?.message });
    }
  });

  // GET /api/osdr/diagnostics - audit status of live OSDR API vs local cached mappings
  apiRouter.get("/osdr/diagnostics", (req, res) => {
    const startTs = Date.now();
    try {
      console.info("[OSDR Diagnostics Entry] Retrieving repository indexing status");
      const diag = getDiagnostics();
      const elapsed = Date.now() - startTs;
      console.info(`[OSDR Diagnostics Success] SourceMode=${diag.sourceMode} | Studies=${diag.dataSources.local_curated_mapping.count} (${elapsed}ms)`);
      res.status(200).json({
        status: "ok",
        routeEntered: true,
        providerRegistryLoaded: true,
        osdrPingAttempted: false,
        failureStage: null,
        errorCategory: null,
        ...diag,
      });
    } catch (err: any) {
      const elapsed = Date.now() - startTs;
      console.warn(`[OSDR Diagnostics Warning after ${elapsed}ms]:`, err);
      res.status(200).json({
        status: "degraded",
        routeEntered: true,
        providerRegistryLoaded: true,
        osdrPingAttempted: false,
        failureStage: "osdr_lookup",
        errorCategory: "internal_error",
        sourceMode: "local_curated_mapping",
        connectionStatus: "degraded",
        lastCheckedAt: new Date().toISOString(),
        lastSuccessfulFetch: null,
        lastFetchError: err?.message || "Error retrieving OSDR diagnostics",
        latencyMs: null,
        dataSources: {
          static_seeded_examples: { count: 13, description: "Static seeded benchmark studies" },
          local_curated_mapping: { count: 13, description: "In-memory fast retrieval index" },
          cached_snapshot: { count: 0, description: "Dynamic studies cache", dynamicStudyIds: [] },
          live_api: { enabled: true, active: false, totalRuntimeFetches: 0, failedRuntimeFetches: 0 },
        },
      });
    }
  });

  // POST & GET /api/osdr/test-connection - execute a live active ping against NASA OSDR API with structured safety
  const handleTestConnection = async (req: express.Request, res: express.Response) => {
    const startTs = Date.now();
    let pingAttempted = false;
    try {
      console.info("[OSDR Connection Test] Executing active live test ping against NASA OSDR API...");
      pingAttempted = true;
      const result = await testOsdrLiveConnection();
      const diag = getDiagnostics();
      const elapsed = Date.now() - startTs;
      console.info(`[OSDR Connection Test Completed] Success=${result.success} | Latency=${result.latencyMs}ms (${elapsed}ms)`);

      res.status(200).json({
        status: result.success ? "ok" : "degraded",
        routeEntered: true,
        providerRegistryLoaded: true,
        osdrPingAttempted: true,
        failureStage: result.success ? null : "osdr_live_ping",
        errorCategory: result.success ? null : (result.error ? "network_error" : "ping_failed"),
        testResult: result,
        diagnostics: diag,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      const elapsed = Date.now() - startTs;
      console.warn(`[OSDR Connection Test Top-Level Exception after ${elapsed}ms]:`, err);
      let safeDiag: any;
      try {
        safeDiag = getDiagnostics();
      } catch {
        safeDiag = {
          sourceMode: "local_curated_mapping",
          connectionStatus: "offline",
          lastCheckedAt: new Date().toISOString(),
          lastSuccessfulFetch: null,
          lastFetchError: err?.message || "Connection test failed",
          latencyMs: null,
          dataSources: {
            static_seeded_examples: { count: 13, description: "Static seeded benchmark studies" },
            local_curated_mapping: { count: 13, description: "In-memory fast retrieval index" },
            cached_snapshot: { count: 0, description: "Dynamic studies cache", dynamicStudyIds: [] },
            live_api: { enabled: true, active: false, totalRuntimeFetches: 0, failedRuntimeFetches: 0 },
          },
        };
      }

      res.status(200).json({
        status: "degraded",
        routeEntered: true,
        providerRegistryLoaded: true,
        osdrPingAttempted: pingAttempted,
        failureStage: "osdr_live_ping_exception",
        errorCategory: "network_error",
        testResult: {
          success: false,
          latencyMs: Date.now() - startTs,
          error: err?.message || "Failed to execute NASA OSDR connection test",
        },
        diagnostics: safeDiag,
        timestamp: new Date().toISOString(),
      });
    }
  };

  apiRouter.post("/osdr/test-connection", handleTestConnection);
  apiRouter.get("/osdr/test-connection", handleTestConnection);

  // GET /api/osdr/search-live - query live NASA OSDR search index
  apiRouter.get("/osdr/search-live", async (req, res) => {
    const q = String(req.query.q || "");
    const k = parseInt(String(req.query.k || "5"), 10);
    const results = await searchLiveOSDR(q, k);
    res.json({
      results,
      count: results.length,
      diagnostics: getDiagnostics(),
    });
  });

  // POST /api/awg/media-set & /api/awg/media - generate multi-output grounded media set
  const handleMediaSet = async (req: express.Request, res: express.Response) => {
    try {
      const { studies, query, summary } = req.body || {};
      if (!Array.isArray(studies) || studies.length === 0) {
        return res.status(400).json({ error: "Media generation requires at least one grounded OSDR study accession." });
      }
      const result = await generateAwgMediaSet({ studies, query, summary });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to generate grounded media set" });
    }
  };

  apiRouter.post("/awg/media-set", handleMediaSet);
  apiRouter.post("/awg/media", handleMediaSet);
  apiRouter.post("/awg/gallery", handleMediaSet);

  // POST /api/awg/image - generate study-linked visual abstract
  apiRouter.post("/awg/image", async (req, res) => {
    try {
      const { studies, query, summary } = req.body || {};
      if (!Array.isArray(studies) || studies.length === 0) {
        return res.status(400).json({ error: "Media generation requires at least one grounded OSDR study accession." });
      }
      const result = await generateVisualAbstract({ studies, query, summary });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to generate visual abstract" });
    }
  });

  // GET /api/awg/config - get diagnostics and status for Gemini Image and Video generation
  apiRouter.get("/awg/config", (req, res) => {
    res.json(getMediaConfigStatus());
  });

  // GET /api/awg/media/audit - return last 20 requests with full provenance
  const handleMediaAudit = (req: express.Request, res: express.Response) => {
    const limit = parseInt(String(req.query.limit || "20"), 10);
    const audit = getMediaAuditLog(isNaN(limit) ? 20 : limit);
    res.json({
      count: audit.length,
      limit: isNaN(limit) ? 20 : limit,
      audit,
    });
  };

  apiRouter.get("/awg/media/audit", handleMediaAudit);
  apiRouter.get("/awg/media-audit", handleMediaAudit);

  // GET /api/awg/suggestions - list top ranked study pairs for AWG comparison
  apiRouter.get("/awg/suggestions", (req, res) => {
    try {
      const suggestions = getSuggestedAwgPairs();
      res.json({ suggestions });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to retrieve suggestions" });
    }
  });

  // GET /api/awg/random-pair - roll a system-selected compatible study pair
  apiRouter.get("/awg/random-pair", (req, res) => {
    try {
      const pair = selectRandomCompatiblePair();
      res.json(pair);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to select random compatible pair" });
    }
  });

  // GET /api/awg/compatibility - score compatibility between two studies
  apiRouter.get("/awg/compatibility", (req, res) => {
    const sidA = String(req.query.studyA || "").toUpperCase();
    const sidB = String(req.query.studyB || "").toUpperCase();
    const studyA = getStudyById(sidA);
    const studyB = getStudyById(sidB);

    if (!studyA || !studyB) {
      return res.status(404).json({ error: "One or both studies not found for compatibility scoring." });
    }

    const breakdown = scoreStudyCompatibility(studyA, studyB);
    res.json({ studyA: sidA, studyB: sidB, ...breakdown });
  });

  // POST /api/awg/video - generate 5-second grounded study brief video
  apiRouter.post("/awg/video", async (req, res) => {
    try {
      const { studies, query, summary } = req.body || {};
      if (!Array.isArray(studies) || studies.length === 0) {
        return res.status(400).json({ error: "Media generation requires at least one grounded OSDR study accession." });
      }
      const result = await generateStudyBriefVideo({ studies, query, summary });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to generate study brief video" });
    }
  });

  // POST /api/awg/translational-clip & /api/awg/relatable-clip
  const handleTranslationalClip = async (req: express.Request, res: express.Response) => {
    try {
      const { studies, query, summary, direction, seed } = req.body || {};
      if (!Array.isArray(studies) || studies.length === 0) {
        return res.status(400).json({ error: "Translational clip generation requires at least one grounded OSDR study accession." });
      }
      const result = await generateTranslationalClip({ studies, query, summary, direction, seed });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to generate translational clip" });
    }
  };

  apiRouter.post("/awg/translational-clip", handleTranslationalClip);
  apiRouter.post("/awg/relatable-clip", handleTranslationalClip);

  // POST /api/awg/meme - generate clip-first comedic meme video tied to active pair
  apiRouter.post("/awg/meme", async (req, res) => {
    try {
      const { studies, query, summary, memeAngle, seed, freshVariation } = req.body || {};
      if (!Array.isArray(studies) || studies.length === 0) {
        return res.status(400).json({ error: "Meme clip generation requires at least one grounded OSDR study accession." });
      }
      const result = await generateAwgMemeConcept({ studies, query, summary, memeAngle, seed, freshVariation });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to generate meme clip" });
    }
  });

  // POST /api/chat - stream SSE response with sources and tokens
  apiRouter.post("/chat", async (req, res) => {
    const startTs = Date.now();
    let headersWritten = false;
    const stage = "chat_request_entry";

    try {
      const rawBody = req.body || {};
      const message = typeof rawBody.message === "string" ? rawBody.message : (typeof req.query.message === "string" ? req.query.message : "");
      const history = Array.isArray(rawBody.history) ? rawBody.history : [];
      const model = typeof rawBody.model === "string" ? rawBody.model : "gemini-3.7-flash";

      console.info(`[Chat Entry] Message="${message.slice(0, 50)}" | HistoryLength=${history.length} | Model=${model}`);

      if (!message || !message.trim()) {
        return res.status(400).json({
          status: "degraded",
          routeEntered: true,
          providerRegistryLoaded: true,
          osdrPingAttempted: false,
          failureStage: "payload_validation",
          errorCategory: "payload_error",
          error: "Missing 'message' in request body",
          code: "ERR_INVALID_PAYLOAD",
          resolution: "Provide a non-empty 'message' string in the JSON payload.",
        });
      }

      // Set streaming headers
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
      headersWritten = true;

      let tokensSent = 0;
      const writeSSE = (event: string, data: any) => {
        try {
          if (event === "token") tokensSent++;
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        } catch (writeErr) {
          console.warn("[SSE Write Warning]:", writeErr);
        }
      };

      try {
        console.info("[Chat SSE Stream Setup] Initializing generateChatStream generator...");
        const stream = generateChatStream(message, history, model);
        for await (const evt of stream) {
          writeSSE(evt.type, evt.data);
        }
        const elapsed = Date.now() - startTs;
        console.info(`[Chat Stream Completed] TokensSent=${tokensSent} | Elapsed=${elapsed}ms`);
      } catch (streamErr: any) {
        const elapsed = Date.now() - startTs;
        console.error(`[Chat Stream Error after ${elapsed}ms]:`, streamErr);
        const classified = classifyGeminiError(streamErr);
        writeSSE("error", {
          code: classified.code,
          category: classified.category,
          message: classified.userMessage,
          technicalMessage: classified.technicalMessage,
          resolution: classified.resolution,
        });
        writeSSE("done", true);
      }
    } catch (err: any) {
      console.error("[Chat Top-Level Error]:", err);
      if (!headersWritten && !res.headersSent) {
        return res.status(200).json({
          status: "degraded",
          routeEntered: true,
          providerRegistryLoaded: true,
          osdrPingAttempted: false,
          failureStage: stage,
          errorCategory: "serverless_runtime_error",
          error: err?.message || "Failed to initialize chat stream",
          timestamp: new Date().toISOString(),
        });
      }
    } finally {
      try {
        if (!res.writableEnded) {
          res.end();
        }
      } catch {}
    }
  });

  // Mount API router at both "/api" prefix and root "/" for seamless Vercel / serverless rewrite routing
  app.use("/api", apiRouter);
  app.use(apiRouter);

  // Global Express Error Handler for uncaught exceptions
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    const classified = classifyGeminiError(err);
    console.error("[Backend Uncaught Error]:", err);
    if (res.headersSent) {
      return next(err);
    }
    res.status(200).json({
      status: "degraded",
      routeEntered: true,
      providerRegistryLoaded: true,
      osdrPingAttempted: false,
      failureStage: "global_express_error_handler",
      errorCategory: classified.category || "internal_error",
      error: classified.userMessage,
      code: classified.code,
      technicalMessage: classified.technicalMessage,
      resolution: classified.resolution,
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}

export const app = createExpressApp();
export default app;

