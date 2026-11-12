import "./env";
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
import { getCommunityIntegrationsPayload } from "./communityIntegrations";
import { INITIAL_STUDIES } from "./studiesData";
import {
  queryRadarSnapshot,
  formatRadarDigestMarkdown,
} from "./radar";
import {
  buildWebhookEventPayload,
  dispatchRadarDropWebhook,
  getRadarWebhookStatus,
  processInboundWebhookPayload,
  runRadarMonitorCheck,
  verifyInboundWebhookAuth,
} from "./radarWebhook";
import { generateAwgMemeConcept } from "./memeGen";
import { generateTtsAudio, getTtsCapabilities } from "./tts";
import { getFirebasePublicClientConfig, getSafeKeyDiagnostics } from "./env";
import {
  buildAdminCookieHeader,
  checkAdminRateLimit,
  clearAdminAuthFailures,
  constantTimeCredentialMatch,
  evaluateFirebaseAdminAccess,
  extractBearerToken,
  getAdminCredentialsForServerLogin,
  getAuthDiagnosticsStatus,
  mintAdminCustomTokenIfPossible,
  recordAdminAuthFailure,
  resolveAdminSessionFromRequest,
  setFirebaseAdminClaimIfPossible,
  signAdminSessionToken,
  verifyFirebaseIdToken,
  verifyRequestAdminOrCookie,
} from "./auth";
import { discoverVideoProviderCapabilities, getCachedVideoDiscovery } from "./mediaGen";
import { getAllCapabilityRecords, getCapabilityLabelMap } from "./modelCapabilities";
import { executeComputerUseTask } from "./computerUse";
import {
  runModelDiscovery,
  classifyGeminiError,
  detectEnvironment,
  FALLBACK_TEXT_MODELS,
} from "./modelDiscovery";
import { getMultiProviderDiagnostics, MultiProviderDiagnostics } from "./textProviders";

export function createExpressApp(): express.Express {
  const app = express();

  app.use(cors({ origin: true, credentials: true }));

  // Handle both pre-parsed serverless bodies and standard requests safely (retain rawBody for HMAC webhook checks)
  app.use((req, res, next) => {
    if (req.body && typeof req.body === "object") {
      return next();
    }
    express.json({
      limit: "10mb",
      verify: (rawReq: any, _res, buf) => {
        if (buf && buf.length > 0) {
          rawReq.rawBody = buf.toString("utf8");
        }
      },
    })(req, res, next);
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

    console.info(`[Diagnostics Route Stage: entered] Method=${req.method} | IP=${req.ip || "local"}`);

    try {
      stage = "provider_registry_init";
      // Safe probe of provider cascade
      const multiDiag = getMultiProviderDiagnostics();
      providerRegistryLoaded = Boolean(multiDiag && multiDiag.providers);
      console.info(`[Diagnostics Route Stage: provider_probe_done] ProvidersConfigured=${Object.keys(multiDiag.providers || {}).length}`);

      stage = "model_discovery";
      const forceRefresh = req.query.refresh === "true";
      const keyPresent = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
      console.info(`[Diagnostics Model Discovery] ForceRefresh=${forceRefresh} | GeminiKeyPresent=${keyPresent}`);
      
      const modelDiag = await runModelDiscovery(forceRefresh);
      console.info(`[Diagnostics Model Discovery Completed] Status=${modelDiag.discoveryStatus} | ModelsCount=${modelDiag.counts.textChatModels}`);
      
      stage = "osdr_lookup";
      const osdrDiag = getDiagnostics();
      console.info(`[Diagnostics Route Stage: diagnostics_loaded] SourceMode=${osdrDiag.sourceMode} | TotalStudies=${osdrDiag.dataSources?.local_curated_mapping?.count || 0}`);
      
      const elapsed = Date.now() - startTs;
      console.info(`[Diagnostics Route Stage: response_finished] Status=ok | Elapsed=${elapsed}ms`);
      
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
            static_seeded_examples: { count: INITIAL_STUDIES.length, description: "Static seeded benchmark studies" },
            local_curated_mapping: { count: INITIAL_STUDIES.length, description: "In-memory fast retrieval index" },
            cached_snapshot: { count: 0, description: "Dynamic studies cache", dynamicStudyIds: [] },
            live_api: { enabled: true, active: false, totalRuntimeFetches: 0, failedRuntimeFetches: 0 },
          },
        };
      }

      console.info(`[Diagnostics Route Stage: response_finished] Status=degraded | FailureStage=${stage} | Elapsed=${elapsed}ms`);

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
          counts: { allModels: 0, textChatModels: FALLBACK_TEXT_MODELS.length, imageModels: 0, videoModels: 0 },
          models: {
            textChat: FALLBACK_TEXT_MODELS,
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


  // GET /api/diagnostics/keys - safe diagnostics for key source and provider readiness
  apiRouter.get("/diagnostics/keys", async (req: express.Request, res: express.Response) => {
    try {
      const keyDiag = getSafeKeyDiagnostics();
      const mediaConfig = getMediaConfigStatus();
      const videoDiscovery = getCachedVideoDiscovery() || (await discoverVideoProviderCapabilities());

      res.status(200).json({
        status: "ok",
        ...keyDiag,
        imageProviderReady: mediaConfig.geminiImageConfigured,
        videoProviderReady: videoDiscovery?.status === "available",
        imageModel: mediaConfig.imageModel,
        videoModel: videoDiscovery?.selectedModel || "none",
        lastProviderErrorCategory: videoDiscovery?.reason || "none",
        discoveredImageModels: [
          "gemini-3.1-flash-lite-image",
          "gemini-3.1-flash-image",
          "gemini-2.5-flash-image",
          "gemini-3-pro-image",
          "nano-banana-pro-preview"
        ],
        discoveredVideoModels: videoDiscovery?.availableVideoModels?.map((m: any) => m.cleanName) || [],
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        status: "error",
        error: err?.message || "Failed to inspect key diagnostics",
      });
    }
  });

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
        models: FALLBACK_TEXT_MODELS,
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
    console.info(`[OSDR Diagnostics Route Stage: entered] Method=${req.method} | IP=${req.ip || "local"}`);
    try {
      const diag = getDiagnostics();
      const count = diag.dataSources?.local_curated_mapping?.count || 0;
      console.info(`[OSDR Diagnostics Route Stage: diagnostics_loaded] SourceMode=${diag.sourceMode} | Studies=${count}`);
      const elapsed = Date.now() - startTs;
      console.info(`[OSDR Diagnostics Route Stage: response_finished] Status=ok | Elapsed=${elapsed}ms`);
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
      console.warn(`[OSDR Diagnostics Route Stage: response_finished] Status=degraded | Error after ${elapsed}ms:`, err);
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
          static_seeded_examples: { count: INITIAL_STUDIES.length, description: "Static seeded benchmark studies" },
          local_curated_mapping: { count: INITIAL_STUDIES.length, description: "In-memory fast retrieval index" },
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
    console.info(`[OSDR Test Connection Route Stage: entered] Method=${req.method} | IP=${req.ip || "local"}`);
    try {
      pingAttempted = true;
      const result = await testOsdrLiveConnection();
      const diag = getDiagnostics();
      const elapsed = Date.now() - startTs;
      console.info(`[OSDR Test Connection Route Stage: diagnostics_loaded] Success=${result.success} | Latency=${result.latencyMs}ms (${elapsed}ms)`);
      console.info(`[OSDR Test Connection Route Stage: response_finished] Status=${result.success ? "ok" : "degraded"} | Elapsed=${elapsed}ms`);

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
      console.warn(`[OSDR Test Connection Route Stage: response_finished] Status=degraded | Top-Level Exception after ${elapsed}ms:`, err);
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
            static_seeded_examples: { count: INITIAL_STUDIES.length, description: "Static seeded benchmark studies" },
            local_curated_mapping: { count: INITIAL_STUDIES.length, description: "In-memory fast retrieval index" },
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

  // GET /api/awg/radar - quarterly/monthly OSDR releases + 9 AWG Leads Pre-OSDR Watch
  apiRouter.get("/awg/radar", async (req: express.Request, res: express.Response) => {
    try {
      const doRefresh = req.query.refresh === "true";
      let refreshMeta: { refreshed: boolean; reason: string; newDropsCount?: number } | null = null;
      if (doRefresh) {
        const checked = await runRadarMonitorCheck({
          force: true,
          notify: true,
          triggerSource: "radar_get_refresh",
        });
        refreshMeta = {
          refreshed: checked.refreshed,
          reason: checked.reason,
          newDropsCount: checked.diff.newSignals.length + checked.diff.newOsdrReleases.length,
        };
      }

      const queried = queryRadarSnapshot({
        tab: typeof req.query.tab === "string" ? req.query.tab : undefined,
        window: typeof req.query.window === "string" ? req.query.window : undefined,
        subgroup: typeof req.query.subgroup === "string" ? req.query.subgroup : undefined,
        lead: typeof req.query.lead === "string" ? req.query.lead : undefined,
        search: typeof req.query.search === "string" ? req.query.search : undefined,
      });

      res.status(200).json({
        status: "ok",
        ...queried,
        digestMarkdown: formatRadarDigestMarkdown(queried),
        refreshMeta,
        webhookStatus: getRadarWebhookStatus(),
      });
    } catch (err: any) {
      res.status(500).json({
        status: "error",
        error: err?.message || "Failed to load AWG Release Radar snapshot",
      });
    }
  });

  // POST /api/awg/radar/refresh - attempt live sync from OSDR + ORCID + NTRS + Crossref + Europe PMC & run 8h diff/webhook
  apiRouter.post("/awg/radar/refresh", async (req: express.Request, res: express.Response) => {
    try {
      const force = req.body?.force !== false;
      const result = await runRadarMonitorCheck({
        force,
        notify: req.body?.notify !== false,
        triggerSource: "radar_manual_sync",
      });
      const queried = queryRadarSnapshot({});
      res.status(200).json({
        status: "ok",
        refreshed: result.refreshed,
        reason: result.reason,
        diff: {
          newSignalsCount: result.diff.newSignals.length,
          spotlightLeadDropsCount: result.diff.spotlightLeadDrops.length,
          newOsdrReleasesCount: result.diff.newOsdrReleases.length,
          newSignals: result.diff.newSignals,
        },
        deliveries: result.deliveries,
        webhookStatus: result.status,
        ...queried,
        digestMarkdown: formatRadarDigestMarkdown(queried),
      });
    } catch (err: any) {
      res.status(500).json({
        status: "error",
        error: err?.message || "Failed to refresh AWG Release Radar",
      });
    }
  });

  // GET /api/awg/radar/webhook/status - 8-hour monitor cadence, Ryan T. Scott spotlight stats & delivery logs
  apiRouter.get("/awg/radar/webhook/status", (req: express.Request, res: express.Response) => {
    try {
      res.status(200).json({
        status: "ok",
        ...getRadarWebhookStatus(),
      });
    } catch (err: any) {
      res.status(500).json({
        status: "error",
        error: err?.message || "Failed to read Release Radar webhook monitor status",
      });
    }
  });

  // POST /api/awg/radar/webhook/check - trigger immediate 8h drop detection cycle & dispatch configured webhooks
  apiRouter.post("/awg/radar/webhook/check", async (req: express.Request, res: express.Response) => {
    try {
      const force = req.body?.force !== false;
      const result = await runRadarMonitorCheck({
        force,
        notify: req.body?.notify !== false,
        triggerSource: typeof req.body?.triggerSource === "string" ? req.body.triggerSource : "ui_8h_check",
      });
      const queried = queryRadarSnapshot({});
      res.status(200).json({
        status: "ok",
        refreshed: result.refreshed,
        reason: result.reason,
        newDropsCount: result.diff.newSignals.length + result.diff.newOsdrReleases.length,
        diff: {
          newSignalsCount: result.diff.newSignals.length,
          spotlightLeadDropsCount: result.diff.spotlightLeadDrops.length,
          newOsdrReleasesCount: result.diff.newOsdrReleases.length,
          newSignals: result.diff.newSignals,
          newOsdrReleases: result.diff.newOsdrReleases,
        },
        deliveries: result.deliveries,
        webhookStatus: result.status,
        snapshot: {
          ...queried,
          digestMarkdown: formatRadarDigestMarkdown(queried),
        },
      });
    } catch (err: any) {
      res.status(500).json({
        status: "error",
        error: err?.message || "Failed to execute 8h Release Radar monitor check",
      });
    }
  });

  // POST /api/awg/radar/webhook - authenticated inbound webhook (HMAC SHA-256 / Bearer secret / Admin session)
  apiRouter.post("/awg/radar/webhook", async (req: express.Request, res: express.Response) => {
    const auth = await verifyInboundWebhookAuth(req);
    if (!auth.authorized) {
      return res.status(401).json({
        status: "unauthorized",
        error: auth.reason,
      });
    }

    try {
      const result = await processInboundWebhookPayload(req.body);
      return res.status(200).json({
        status: "ok",
        authMethod: auth.authMethod,
        ...result,
      });
    } catch (err: any) {
      return res.status(500).json({
        status: "error",
        error: err?.message || "Failed to process Release Radar inbound webhook",
      });
    }
  });

  // POST /api/awg/radar/webhook/test - admin/secret protected outbound webhook ping & payload preview
  apiRouter.post("/awg/radar/webhook/test", async (req: express.Request, res: express.Response) => {
    const auth = await verifyInboundWebhookAuth(req);
    if (!auth.authorized) {
      return res.status(401).json({
        status: "unauthorized",
        error: auth.reason,
      });
    }

    try {
      const webhookStatus = getRadarWebhookStatus();
      const ryanLatest = queryRadarSnapshot({ lead: "ryan-scott" }).filteredLeadSignals.slice(0, 1);
      const mockDiff = {
        newSignals: ryanLatest,
        spotlightLeadDrops: ryanLatest,
        newOsdrReleases: [],
      };
      const previewPayload = buildWebhookEventPayload(mockDiff, {
        event: "osdr_radar.test_ping",
        triggerSource: "admin_test_ping",
      });
      const deliveries = await dispatchRadarDropWebhook(mockDiff, {
        event: "osdr_radar.test_ping",
        triggerSource: "admin_test_ping",
      });

      return res.status(200).json({
        status: "ok",
        authMethod: auth.authMethod,
        outboundConfigured: webhookStatus.outboundReady,
        targetsCount: webhookStatus.configuredTargets.length,
        deliveries,
        previewPayload,
        webhookStatus: getRadarWebhookStatus(),
      });
    } catch (err: any) {
      return res.status(500).json({
        status: "error",
        error: err?.message || "Failed to dispatch Release Radar test webhook",
      });
    }
  });

  // GET /api/awg/integrations - community research demonstrators & downstream Schema Contract handshakes
  apiRouter.get("/awg/integrations", (req, res) => {
    try {
      const payload = getCommunityIntegrationsPayload();
      res.status(200).json({
        status: "ok",
        ...payload,
      });
    } catch (err: any) {
      res.status(500).json({
        status: "error",
        error: err?.message || "Failed to load AWG community integrations",
      });
    }
  });

  // =========================================================================
  // Firebase User Auth & Dedicated /admin Session Routes
  // =========================================================================

  // GET /api/auth/config - public non-secret Firebase Web SDK config & capability status
  apiRouter.get("/auth/config", (req, res) => {
    try {
      const clientConfig = getFirebasePublicClientConfig();
      const status = getAuthDiagnosticsStatus();
      res.status(200).json({
        status: "ok",
        firebaseConfig: {
          apiKey: clientConfig.apiKey,
          authDomain: clientConfig.authDomain,
          projectId: clientConfig.projectId,
          storageBucket: clientConfig.storageBucket,
          messagingSenderId: clientConfig.messagingSenderId,
          appId: clientConfig.appId,
          measurementId: clientConfig.measurementId,
          authEmulatorUrl: clientConfig.authEmulatorUrl,
        },
        configured: clientConfig.configured,
        missingFields: clientConfig.missingFields,
        providers: {
          emailPassword: true,
          google: true,
        },
        adminStatus: {
          firebaseAdminSdkReady: status.firebaseAdminSdkReady,
          adminPasscodeRequired: status.adminPasscodeConfigured,
          directAdminCredentialsConfigured: status.directAdminCredentialsConfigured,
          adminAllowlistConfigured: status.adminAllowlistCount > 0,
        },
      });
    } catch (err: any) {
      res.status(500).json({
        status: "error",
        error: err?.message || "Failed to read Firebase auth configuration",
      });
    }
  });

  // GET /api/auth/session - verify current Firebase Bearer token + optional admin cookie
  apiRouter.get("/auth/session", async (req, res) => {
    const adminSession = resolveAdminSessionFromRequest(req);
    const bearer = extractBearerToken(req);

    if (!bearer) {
      return res.status(200).json({
        status: "ok",
        authenticated: false,
        user: null,
        adminSession,
      });
    }

    try {
      const user = await verifyFirebaseIdToken(bearer);
      const adminEvaluation = evaluateFirebaseAdminAccess(user);
      return res.status(200).json({
        status: "ok",
        authenticated: true,
        user: {
          uid: user.uid,
          email: user.email,
          emailVerified: user.emailVerified,
          name: user.name,
          picture: user.picture,
          signInProvider: user.signInProvider,
          adminClaim: user.adminClaim,
          role: user.adminClaim || adminSession ? "admin" : user.roleClaim || "user",
          verificationMode: user.verificationMode,
        },
        adminEligible: adminEvaluation.authorized,
        adminPasscodeRequired: adminEvaluation.passcodeRequired,
        adminSession,
      });
    } catch (err: any) {
      return res.status(401).json({
        status: "unauthorized",
        authenticated: false,
        user: null,
        adminSession: null,
        error: err?.message || "Invalid or expired Firebase ID token.",
      });
    }
  });

  // GET /api/admin/session - inspect current verified /admin session
  apiRouter.get("/admin/session", async (req, res) => {
    const session = await verifyRequestAdminOrCookie(req);
    return res.status(200).json({
      status: "ok",
      authenticated: Boolean(session),
      session,
      ...getAuthDiagnosticsStatus(),
    });
  });

  // POST /api/admin/verify - verify Firebase admin ID token (+ optional server ADMIN_PASSCODE)
  apiRouter.post("/admin/verify", async (req, res) => {
    const limit = checkAdminRateLimit(req);
    if (!limit.allowed) {
      res.setHeader("Retry-After", String(limit.retryAfterSec));
      return res.status(429).json({
        status: "rate_limited",
        error: `Too many failed admin verification attempts. Try again in ${limit.retryAfterSec}s.`,
      });
    }

    const bearer = extractBearerToken(req) || (typeof req.body?.idToken === "string" ? req.body.idToken.trim() : "");
    const passcode = typeof req.body?.passcode === "string" ? req.body.passcode : "";

    if (!bearer) {
      return res.status(401).json({
        status: "unauthorized",
        error: "Sign in with Firebase first to obtain an ID token for admin verification.",
      });
    }

    try {
      const user = await verifyFirebaseIdToken(bearer);
      const evaluation = evaluateFirebaseAdminAccess(user, passcode);

      if (!evaluation.authorized) {
        recordAdminAuthFailure(req);
        return res.status(403).json({
          status: "denied",
          error: evaluation.reason,
          passcodeRequired: evaluation.passcodeRequired,
          uid: user.uid,
          email: user.email,
        });
      }

      clearAdminAuthFailures(req);

      let customClaimSynced = false;
      if (!user.adminClaim && user.uid) {
        try {
          const claimResult = await setFirebaseAdminClaimIfPossible(user.uid, true);
          customClaimSynced = claimResult.updated;
        } catch {
          customClaimSynced = false;
        }
      }

      const { token, payload } = signAdminSessionToken({
        uid: user.uid,
        email: user.email,
        displayName: user.name || user.email || "Administrator",
        authMethod: evaluation.authMethod || "firebase_allowlist",
      });

      res.setHeader("Set-Cookie", buildAdminCookieHeader(token, req));
      return res.status(200).json({
        status: "ok",
        authenticated: true,
        session: payload,
        customClaimSynced,
        message: evaluation.reason,
      });
    } catch (err: any) {
      recordAdminAuthFailure(req);
      return res.status(401).json({
        status: "unauthorized",
        error: err?.message || "Failed to verify Firebase admin token.",
      });
    }
  });

  // POST /api/admin/login - dedicated server-side admin credentials login (.env ADMIN_USERNAME/ADMIN_EMAILS + ADMIN_PASSCODE)
  apiRouter.post("/admin/login", async (req, res) => {
    const limit = checkAdminRateLimit(req);
    if (!limit.allowed) {
      res.setHeader("Retry-After", String(limit.retryAfterSec));
      return res.status(429).json({
        status: "rate_limited",
        error: `Too many failed admin login attempts. Try again in ${limit.retryAfterSec}s.`,
      });
    }

    const creds = getAdminCredentialsForServerLogin();
    if (!creds.configured) {
      return res.status(503).json({
        status: "unconfigured",
        error:
          "Server admin credentials are not configured yet. Set ADMIN_EMAILS (or ADMIN_USERNAME) and ADMIN_PASSCODE in your server .env.",
      });
    }

    const rawIdentity = String(req.body?.email || req.body?.username || "").trim();
    const rawPassword = String(req.body?.password || req.body?.passcode || "");

    if (!rawIdentity || !rawPassword) {
      return res.status(400).json({
        status: "invalid_request",
        error: "Both administrator email/username and password are required.",
      });
    }

    const lowerIdentity = rawIdentity.toLowerCase();
    const identityMatches =
      constantTimeCredentialMatch(lowerIdentity, creds.expectedUsername.toLowerCase()) ||
      creds.expectedEmails.some((allowed) => constantTimeCredentialMatch(lowerIdentity, allowed));
    const passwordMatches = constantTimeCredentialMatch(rawPassword, creds.expectedSecret);

    if (!identityMatches || !passwordMatches) {
      recordAdminAuthFailure(req);
      return res.status(401).json({
        status: "unauthorized",
        error: "Invalid administrator credentials.",
      });
    }

    clearAdminAuthFailures(req);

    const resolvedEmail = lowerIdentity.includes("@")
      ? lowerIdentity
      : creds.expectedEmails[0] || null;
    const adminUid = `admin-${lowerIdentity.replace(/[^a-z0-9._-]+/g, "_")}`;

    const customToken = await mintAdminCustomTokenIfPossible(adminUid, {
      admin: true,
      role: "admin",
      ...(resolvedEmail ? { email: resolvedEmail } : {}),
    });

    const { token, payload } = signAdminSessionToken({
      uid: adminUid,
      email: resolvedEmail || rawIdentity,
      displayName: resolvedEmail || rawIdentity,
      authMethod: "server_credentials",
    });

    res.setHeader("Set-Cookie", buildAdminCookieHeader(token, req));
    return res.status(200).json({
      status: "ok",
      authenticated: true,
      session: payload,
      customToken,
      message: "Signed into Administrator Console via server-side credentials.",
    });
  });

  // POST /api/admin/logout - revoke HttpOnly admin session cookie
  apiRouter.post("/admin/logout", (req, res) => {
    res.setHeader("Set-Cookie", buildAdminCookieHeader("", req, 0));
    return res.status(200).json({
      status: "ok",
      authenticated: false,
    });
  });

  // GET /api/admin/overview - protected administrator telemetry & governance overview
  apiRouter.get("/admin/overview", async (req, res) => {
    const adminSession = await verifyRequestAdminOrCookie(req);
    if (!adminSession) {
      return res.status(401).json({
        status: "unauthorized",
        error: "Administrator authentication required.",
      });
    }

    try {
      const radar = queryRadarSnapshot({});
      const integrations = getCommunityIntegrationsPayload();
      const mediaAudit = getMediaAuditLog(20);
      return res.status(200).json({
        status: "ok",
        session: adminSession,
        authDiagnostics: getAuthDiagnosticsStatus(),
        osdrDiagnostics: getDiagnostics(),
        systemHealth: {
          keys: getSafeKeyDiagnostics(),
          providers: getMultiProviderDiagnostics(),
          media: getMediaConfigStatus(),
        },
        mediaAuditSummary: {
          totalEntries: mediaAudit.length,
          recentEntries: mediaAudit.slice(0, 8).map((entry: any) => ({
            requestId: entry.requestId,
            mode: entry.mode,
            status: entry.status,
            provider: entry.provider,
            timestamp: entry.timestamp,
          })),
        },
        radarSummary: {
          osdrReleasesCount: radar.osdrReleases.length,
          leadSignalsCount: radar.leadSignals.length,
          lastSyncedAt: radar.generatedAt,
          webhookStatus: getRadarWebhookStatus(),
        },
        communitySummary: {
          contributorsCount: integrations.contributors.length,
          contributors: integrations.contributors.map((c) => ({
            id: c.id,
            title: c.title,
            author: c.author,
            domain: c.domain,
            appUrl: c.appUrl,
          })),
        },
      });
    } catch (err: any) {
      return res.status(500).json({
        status: "error",
        error: err?.message || "Failed to load admin overview.",
      });
    }
  });

  // POST /api/admin/claims - protected Firebase Custom Claim promotion/revocation
  apiRouter.post("/admin/claims", async (req, res) => {
    const adminSession = await verifyRequestAdminOrCookie(req);
    if (!adminSession) {
      return res.status(401).json({
        status: "unauthorized",
        error: "Administrator authentication required.",
      });
    }

    const target = typeof req.body?.target === "string" ? req.body.target.trim() : "";
    const grantAdmin = req.body?.grantAdmin !== false;

    if (!target) {
      return res.status(400).json({
        status: "invalid_request",
        error: "Target user email or Firebase UID is required.",
      });
    }

    if (!grantAdmin && (target === adminSession.uid || target.toLowerCase() === (adminSession.email || "").toLowerCase())) {
      return res.status(400).json({
        status: "invalid_request",
        error: "You cannot revoke admin claims from your active signed-in session.",
      });
    }

    try {
      const result = await setFirebaseAdminClaimIfPossible(target, grantAdmin);
      return res.status(result.updated ? 200 : 503).json({
        status: result.updated ? "ok" : "unavailable",
        ...result,
      });
    } catch (err: any) {
      return res.status(400).json({
        status: "error",
        error: err?.message || "Failed to update Firebase custom claims.",
      });
    }
  });

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


  // GET /api/tts/status - check configured TTS capabilities (Gemini & OpenAI)
  apiRouter.get("/tts/status", (req: express.Request, res: express.Response) => {
    try {
      const caps = getTtsCapabilities();
      res.status(200).json({
        status: "ok",
        ...caps,
      });
    } catch (err: any) {
      res.status(200).json({
        status: "error",
        error: err?.message || "Failed to inspect TTS capabilities",
        configuredProviders: [],
        defaultProvider: "none",
        geminiConfigured: false,
        openaiConfigured: false,
      });
    }
  });


  // GET /api/capabilities - centralized Gemini capability family registry and label map
  apiRouter.get("/capabilities", (req: express.Request, res: express.Response) => {
    try {
      res.status(200).json({
        status: "ok",
        capabilities: getAllCapabilityRecords(),
        labelMap: getCapabilityLabelMap(),
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        status: "error",
        error: err?.message || "Failed to retrieve capabilities registry",
      });
    }
  });

  // POST /api/computer-use - scoped Gemini Computer Use Preview execution endpoint
  apiRouter.post("/computer-use", async (req: express.Request, res: express.Response) => {
    try {
      const { task, startUrl, mode } = req.body || {};
      if (!task || typeof task !== "string" || !task.trim()) {
        return res.status(400).json({
          success: false,
          error: "Task string is required for Computer Use execution.",
        });
      }

      const clientIp = req.ip || "local";
      const result = await executeComputerUseTask({
        task,
        startUrl,
        mode,
        sessionId: clientIp,
      });

      if (!result.success && result.error?.includes("cooldown")) {
        return res.status(429).json(result);
      }

      res.status(200).json(result);
    } catch (err: any) {
      console.warn("[Computer Use Route Exception]:", err?.message || err);
      res.status(500).json({
        success: false,
        error: err?.message || "Internal error executing Computer Use task",
      });
    }
  });

  // POST /api/tts - generate speech audio for assistant response
  apiRouter.post("/tts", async (req: express.Request, res: express.Response) => {
    try {
      const { text, provider, messageId, chatModel, voice } = req.body || {};
      if (!text || typeof text !== "string" || !text.trim()) {
        return res.status(400).json({
          status: "error",
          error: "Text parameter is required for TTS generation.",
        });
      }

      const result = await generateTtsAudio({
        text,
        provider,
        messageId,
        chatModel,
        voice,
      });

      if (result.status === "error") {
        return res.status(503).json(result);
      }

      res.status(200).json(result);
    } catch (err: any) {
      console.warn("[TTS Route Exception]:", err?.message || err);
      res.status(500).json({
        status: "error",
        error: err?.message || "Internal server error generating TTS audio",
      });
    }
  });

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
    let stage = "route_entry";
    let providerRegistryLoaded = false;

    console.info(`[Chat Route Stage: entered] Method=${req.method} | IP=${req.ip || "local"} | Accept=${req.headers["accept"] || "none"}`);

    const acceptsEventStream = (req.headers["accept"] || "").includes("text/event-stream");
    const acceptsJson = (req.headers["accept"] || "").includes("application/json") || !acceptsEventStream;

    let message = "";
    let history: any[] = [];
    let model = "gemini-3.7-flash";
    let selectedProvider = "local_deterministic";
    let isSimpleGreeting = false;

    // Helper to send a safe preflight error based on client's accepted response types
    const sendPreflightError = (
      statusCode: number,
      failureStage: string,
      errorCategory: string,
      code: string,
      userMessage: string,
      technicalMessage?: string,
      resolution?: string
    ) => {
      if (res.headersSent || headersWritten) {
        return;
      }
      console.info(`[Chat Route Stage: response_finished] Preflight error completed: Code=${code} | Status=${statusCode} | Elapsed=${Date.now() - startTs}ms`);
      if (acceptsJson || !acceptsEventStream) {
        return res.status(statusCode).json({
          status: "degraded",
          routeEntered: true,
          providerRegistryLoaded,
          osdrPingAttempted: false,
          failureStage,
          errorCategory,
          error: userMessage,
          code,
          technicalMessage: technicalMessage || userMessage,
          resolution: resolution || "Check payload parameters or provider configuration.",
          timestamp: new Date().toISOString(),
        });
      } else {
        // Client strictly expects SSE
        try {
          res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache, no-transform");
          res.setHeader("Connection", "keep-alive");
          res.setHeader("X-Accel-Buffering", "no");
          res.flushHeaders?.();
          headersWritten = true;
          console.info("[Chat Route Stage: sse_headers_written] SSE degraded error stream headers flushed.");

          res.write(
            `event: error\ndata: ${JSON.stringify({
              code,
              category: errorCategory,
              message: userMessage,
              technicalMessage: technicalMessage || userMessage,
              resolution,
            })}\n\n`
          );
          res.write(`event: done\ndata: true\n\n`);
          res.end();
        } catch (sseErr) {
          console.error("[Chat Route Stage: stream_error] Failed to write SSE error stream:", sseErr);
        }
      }
    };

    // ==========================================
    // PHASE 1: Preflight Validation & Route Decision
    // ==========================================
    try {
      stage = "validation";
      const rawBody = req.body || {};
      message = typeof rawBody.message === "string" ? rawBody.message.trim() : (typeof req.query.message === "string" ? req.query.message.trim() : "");
      history = Array.isArray(rawBody.history) ? rawBody.history : [];
      model = typeof rawBody.model === "string" && rawBody.model.trim() ? rawBody.model.trim() : "gemini-3.7-flash";

      if (!message) {
        console.warn("[Chat Validation Failure] Missing or empty 'message' in request body.");
        return sendPreflightError(
          400,
          "payload_validation",
          "payload_error",
          "ERR_INVALID_PAYLOAD",
          "Missing 'message' in request body",
          "The 'message' field is required and must be a non-empty string.",
          "Provide a non-empty 'message' string in the JSON payload."
        );
      }
      console.info(`[Chat Route Stage: payload_validated] MessageLength=${message.length} | HistoryCount=${history.length} | RequestedModel=${model}`);

      stage = "provider_selection";
      const rawMsg = message.trim();
      const isGreeting = /^(\s*|\/)*(hi|hello|hey|greetings|howdy|good\s+(morning|afternoon|evening)|welcome)(\s+.*)?$/i.test(rawMsg);
      const isExplicitAwg = rawMsg.startsWith("/awg") || rawMsg.toLowerCase().startsWith("awg ");
      isSimpleGreeting = isGreeting && !isExplicitAwg;

      // Safe probe of provider cascade
      let multiDiag: MultiProviderDiagnostics;
      try {
        multiDiag = getMultiProviderDiagnostics();
        providerRegistryLoaded = Boolean(multiDiag && multiDiag.providers);
      } catch (provErr: any) {
        console.warn("[Chat Provider Registry Warning]:", provErr);
        multiDiag = {
          primaryProvider: "gemini",
          fallbackChain: ["gemini", "openrouter", "groq", "local_deterministic"],
          providers: {} as any,
          lastSuccessfulProvider: null,
          overallTextReadiness: "local_only",
        };
        providerRegistryLoaded = false;
      }

      if (isSimpleGreeting) {
        selectedProvider = "local_deterministic";
        console.info("[Chat Provider Selection] Simple greeting detected: Bypassing remote discovery and routing directly to local deterministic engine.");
      } else {
        selectedProvider = multiDiag.providers?.gemini?.configured
          ? "gemini"
          : multiDiag.providers?.openrouter?.configured
          ? "openrouter"
          : multiDiag.providers?.groq?.configured
          ? "groq"
          : "local_deterministic";
      }

      console.info(`[Chat Route Stage: provider_probe_done] SelectedProvider=${selectedProvider} | Readiness=${multiDiag.overallTextReadiness}`);
      console.info(`[Chat Route Stage: diagnostics_loaded] ProviderRegistryLoaded=${providerRegistryLoaded} | IsSimpleGreeting=${isSimpleGreeting}`);
    } catch (preflightErr: any) {
      console.error(`[Chat Preflight Error in stage '${stage}' after ${Date.now() - startTs}ms]:`, preflightErr);
      const classified = classifyGeminiError(preflightErr);
      return sendPreflightError(
        200,
        stage,
        classified.category || "preflight_error",
        classified.code || "ERR_CHAT_PREFLIGHT",
        classified.userMessage || "Preflight validation failed",
        classified.technicalMessage || preflightErr?.message,
        classified.resolution
      );
    }

    // ==========================================
    // PHASE 2: Stream Initialization & Token Generation
    // ==========================================
    stage = "stream_initialization";
    try {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
      headersWritten = true;
      console.info("[Chat Route Stage: sse_headers_written] SSE stream headers initialized successfully.");
    } catch (sseInitErr: any) {
      console.error("[Chat SSE Init Failure] Failed to set SSE headers:", sseInitErr);
      return sendPreflightError(
        200,
        "sse_header_initialization",
        "sse_init_failure",
        "ERR_SSE_INIT",
        "Failed to initialize Server-Sent Events stream",
        sseInitErr?.message
      );
    }

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
      stage = "stream_generation";
      console.info(`[Chat Route Stage: stream_started] Generating stream for message="${message.slice(0, 40)}" | Provider=${selectedProvider}...`);
      const stream = generateChatStream(message, history, model);
      for await (const evt of stream) {
        writeSSE(evt.type, evt.data);
      }
      const elapsed = Date.now() - startTs;
      console.info(`[Chat Stream Success] Stream completed successfully. TokensSent=${tokensSent} | Elapsed=${elapsed}ms`);
    } catch (streamErr: any) {
      const elapsed = Date.now() - startTs;
      console.error(`[Chat Route Stage: stream_error] Stream exception after ${elapsed}ms:`, streamErr);
      const classified = classifyGeminiError(streamErr);
      writeSSE("error", {
        code: classified.code,
        category: classified.category,
        message: classified.userMessage,
        technicalMessage: classified.technicalMessage,
        resolution: classified.resolution,
      });
      writeSSE("done", true);
    } finally {
      try {
        if (!res.writableEnded) {
          res.end();
        }
      } catch {}
      console.info(`[Chat Route Stage: response_finished] Stream cycle closed. TokensSent=${tokensSent} | TotalElapsed=${Date.now() - startTs}ms`);
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

