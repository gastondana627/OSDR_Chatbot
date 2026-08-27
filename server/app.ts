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

export function createExpressApp(): express.Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  const apiRouter = express.Router();

  // GET /api/health - status check for deployment diagnostics
  apiRouter.get("/health", (req, res) => {
    res.json({
      status: "ok",
      service: "NASA OSDR ChatBot & AWG Evidence Engine",
      environment: process.env.NODE_ENV || "development",
      geminiApiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
      timestamp: new Date().toISOString(),
    });
  });

  // GET /api/models - available LLM models for the selector
  apiRouter.get("/models", (req, res) => {
    const models = [
      "gemini-3.7-flash",
      "gemini-3.1-pro-preview",
      "gemma4",
    ];
    res.json({
      models,
      default: "gemini-3.7-flash",
    });
  });

  // GET /api/studies - list cached studies (id, title, file_count)
  apiRouter.get("/studies", (req, res) => {
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
  });

  // GET /api/study/:study_id - full cached or live record for one study
  apiRouter.get("/study/:study_id", async (req, res) => {
    const sid = req.params.study_id;
    let found = getStudyById(sid);
    if (!found) {
      found = (await fetchLiveOSDRStudy(sid)) || undefined;
    }
    if (!found) {
      return res.status(404).json({ error: `Study ${sid} not found in OSDR` });
    }
    res.json(found);
  });

  // GET /api/search - semantic and keyword study search
  apiRouter.get("/search", (req, res) => {
    const q = String(req.query.q || "");
    const k = parseInt(String(req.query.k || "10"), 10);
    const results = searchStudies(q, k);
    res.json({ results });
  });

  // GET /api/osdr/diagnostics - audit status of live OSDR API vs local cached mappings
  apiRouter.get("/osdr/diagnostics", (req, res) => {
    res.json(getDiagnostics());
  });

  // POST /api/osdr/test-connection - execute a live active ping against NASA OSDR API
  apiRouter.post("/osdr/test-connection", async (req, res) => {
    const result = await testOsdrLiveConnection();
    res.json({
      testResult: result,
      diagnostics: getDiagnostics(),
    });
  });

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
    const { message, history, model } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Missing 'message' in request body" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const writeSSE = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const stream = generateChatStream(message, history || [], model);
      for await (const evt of stream) {
        writeSSE(evt.type, evt.data);
      }
    } catch (err: any) {
      writeSSE("error", err?.message || "Internal server error");
      writeSSE("done", true);
    } finally {
      res.end();
    }
  });

  // Mount API router at both "/api" prefix and root "/" for seamless Vercel / serverless rewrite routing
  app.use("/api", apiRouter);
  app.use(apiRouter);

  return app;
}

export const app = createExpressApp();
export default app;
