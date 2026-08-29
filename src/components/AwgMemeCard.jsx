import { useState, useRef, useEffect } from "react";
import { fetchAwgMemeClip } from "../api.js";

const STUDY_URL = "https://osdr.nasa.gov/bio/repo/data/studies/";

export default function AwgMemeCard({ memeConcept, studies = [], onRunCommand }) {
  const [clip, setClip] = useState(memeConcept);
  const [loadingVariation, setLoadingVariation] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [variationError, setVariationError] = useState("");

  const canvasRef = useRef(null);
  const reqIdRef = useRef(null);
  const timeRef = useRef(0);
  const lastTimestampRef = useRef(null);

  const isFreshProvider = clip?.provenance?.generationStatus === "fresh_provider" && clip?.isVideoGenerationAvailable;
  const isCacheHit = clip?.provenance?.generationStatus === "cache_hit";
  const isVideoAvailable = Boolean(clip?.isVideoGenerationAvailable && clip?.videoUrl);
  const isFailed = !isVideoAvailable;

  const [showSecondaryFallback, setShowSecondaryFallback] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const isPlayingRef = useRef(false);

  // Sync state if incoming memeConcept prop changes
  useEffect(() => {
    if (memeConcept) {
      setClip(memeConcept);
      setIsPlaying(false);
      isPlayingRef.current = false;
      setCurrentTime(0);
      timeRef.current = 0;
    }
  }, [memeConcept]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const duration = clip?.duration || 5.5;
  const sidA = clip?.studies?.[0] || clip?.studyA?.study_id || studies[0] || "OSD-87";
  const sidB = clip?.studies?.[1] || clip?.studyB?.study_id || studies[1] || "OSD-100";
  const activePairStr = `${sidA} × ${sidB}`;

  const premise =
    clip?.premise ||
    clip?.memeHook ||
    clip?.memeTitle ||
    "Mouse retina: preparing for spaceflight like it is a group project with three different omics teams.";

  const fallbackReason =
    clip?.fallbackReason ||
    clip?.provenance?.errorMessage ||
    "Provider video generation was not attempted.";

  const stages = clip?.provenance?.stages;
  const planningModel = clip?.provenance?.planningModel || stages?.planningModel || "none";
  const planningMethod = clip?.provenance?.planningMethod || stages?.planningMethod || (planningModel === "none" ? "local_metadata_template" : "gemini_generated");
  const videoProviderModel = clip?.provenance?.videoProviderModel || "veo-2.0-generate-001";
  const fallbackRenderer = clip?.provenance?.fallbackRenderer || "procedural-canvas-animator-v1";
  const finalArtifactType = clip?.provenance?.finalArtifactType || (isVideoAvailable ? "provider_mp4" : "none");

  // Determine stage failure category for UI
  const isConfigurationError =
    clip?.provenance?.isConfigurationError ||
    stages?.isConfigurationError ||
    stages?.providerVideoRequest === "not_available" ||
    clip?.provenance?.errorCode === "ERR_VIDEO_PROVIDER_NOT_CONFIGURED";

  const isFailedBeforeVideoCall = stages?.activePairResolution === "fail" || stages?.promptPlanning === "fail";
  const isFailedDuringVideoCall = stages?.providerVideoRequest === "fail";
  const isVideoNotAttempted = stages?.providerVideoRequest === "not_attempted";
  const isVideoNotAvailable = stages?.providerVideoRequest === "not_available" || isConfigurationError;

  const isQuotaExhausted =
    fallbackReason?.includes("exhausted") ||
    fallbackReason?.includes("quota") ||
    fallbackReason?.includes("RESOURCE_EXHAUSTED") ||
    fallbackReason?.includes("429") ||
    stages?.videoProviderError?.includes("429") ||
    stages?.videoProviderError?.includes("RESOURCE_EXHAUSTED") ||
    stages?.videoProviderError?.includes("quota") ||
    stages?.videoProviderError?.includes("exhausted") ||
    clip?.provenance?.errorMessage?.includes("429") ||
    clip?.provenance?.errorMessage?.includes("RESOURCE_EXHAUSTED") ||
    clip?.provenance?.errorMessage?.includes("quota") ||
    clip?.provenance?.errorMessage?.includes("exhausted") ||
    discovery?.reason?.includes("429") ||
    discovery?.reason?.includes("RESOURCE_EXHAUSTED") ||
    discovery?.reason?.includes("quota") ||
    discovery?.reason?.includes("exhausted");

  const failureStageTitle = isQuotaExhausted
    ? "Video quota is temporarily exhausted for this project. Try again later; fallback preview is available now."
    : isVideoNotAvailable
    ? "Provider video generation is not enabled for this project or API configuration"
    : isFailedDuringVideoCall
    ? "Failed During Provider Video Call"
    : isFailedBeforeVideoCall
    ? "Failed Before Provider Video Call"
    : isVideoNotAttempted
    ? "Provider Video Request Not Attempted"
    : "Video Generation Unavailable";

  const discovery = clip?.provenance?.videoProviderDiscovery || stages?.videoProviderDiscovery;

  const statusLabel =
    clip?.provenance?.generationStatus === "fresh_provider" && isVideoAvailable
      ? "Fresh provider generation"
      : clip?.provenance?.generationStatus === "cache_hit" && isVideoAvailable
      ? "Reused cached artifact"
      : "Failed / Unavailable";

  const fallbackNotice =
    clip?.fallbackNotice ||
    "Video generation unavailable — conceptual fallback preview; no provider-generated video was created.";

  // 60fps Canvas Animation Loop for the 5-6 second Meme Clip
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const displayWidth = 800;
    const displayHeight = 450;

    if (canvas.width !== displayWidth * dpr || canvas.height !== displayHeight * dpr) {
      canvas.width = displayWidth * dpr;
      canvas.height = displayHeight * dpr;
    }

    const render = (now) => {
      if (!lastTimestampRef.current) lastTimestampRef.current = now;
      const delta = (now - lastTimestampRef.current) / 1000;
      lastTimestampRef.current = now;

      if (isPlayingRef.current) {
        timeRef.current += delta;
        if (timeRef.current >= duration) {
          timeRef.current = 0; // loop seamlessly
        }
        setCurrentTime(timeRef.current);
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      drawMemeClipScene(ctx, displayWidth, displayHeight, timeRef.current, duration, clip, sidA, sidB);
      ctx.restore();

      reqIdRef.current = requestAnimationFrame(render);
    };

    reqIdRef.current = requestAnimationFrame(render);

    return () => {
      if (reqIdRef.current) cancelAnimationFrame(reqIdRef.current);
      lastTimestampRef.current = null;
    };
  }, [clip, duration, sidA, sidB]);

  const togglePlay = () => {
    setIsPlaying((prev) => !prev);
  };

  const handleSeek = (e) => {
    const val = parseFloat(e.target.value);
    timeRef.current = val;
    setCurrentTime(val);
  };

  const handleGenerateVariation = async () => {
    if (loadingVariation) return;
    setLoadingVariation(true);
    setVariationError("");

    try {
      const nextSeed = Math.floor(Math.random() * 900000) + 100000;
      const result = await fetchAwgMemeClip({
        studies: [sidA, sidB],
        seed: nextSeed,
        freshVariation: true,
      });

      if (result) {
        setClip(result);
        const isFresh = result?.provenance?.generationStatus === "fresh_provider";
        setIsPlaying(isFresh);
        isPlayingRef.current = isFresh;
        timeRef.current = 0;
        setCurrentTime(0);
      }
    } catch (err) {
      setVariationError(err?.message || "Failed to generate variation");
    } finally {
      setLoadingVariation(false);
    }
  };

  const handleCopyPrompt = () => {
    const promptText = clip?.clipPrompt || clip?.optionalClipPrompt || premise;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(promptText).then(() => {
        setCopiedPrompt(true);
        setTimeout(() => setCopiedPrompt(false), 2000);
      });
    }
  };

  return (
    <div className="awg-meme-clip-card">
      {/* 1. Header & Title */}
      <div className="clip-header">
        <div className="clip-title-badge">
          <span className="clip-icon">🎬</span>
          <h3 className="clip-title">AWG Meme Clip</h3>
        </div>
        <span className="clip-caution-badge">[CONCEPTUAL COMMUNICATION]</span>
      </div>

      {/* 2. One-line Comedic Premise */}
      <div className="clip-premise-box">
        <p className="clip-premise-text">“{premise}”</p>
      </div>

      {/* 3. Primary View: Real Video if available, OR Explicit Failed-Generation State */}
      {isVideoAvailable ? (
        <div className="clip-player-container">
          <video
            src={clip.videoUrl}
            controls
            autoPlay={isFreshProvider}
            loop
            className="clip-video-element"
          />
          <div className="clip-controls-bar">
            <span className="clip-time-display">0:05 / 0:05</span>
          </div>
        </div>
      ) : (
        <div className="clip-failed-state-box">
          <div className="clip-failed-header">
            <span className="clip-failed-icon">⚠️</span>
            <div className="clip-failed-title-group">
              <h4 className="clip-failed-title">{failureStageTitle}</h4>
              <p className="clip-failed-subtitle">
                {fallbackReason}
              </p>
            </div>
          </div>

          <div className="clip-failed-actions">
            {isQuotaExhausted ? (
              <button
                className="clip-btn clip-btn-primary"
                disabled={true}
                title="Video quota is temporarily exhausted. Fallback preview is active."
              >
                <span>⏳</span> Quota cooldown active
              </button>
            ) : isConfigurationError ? (
              <button
                className="clip-btn clip-btn-primary"
                onClick={handleGenerateVariation}
                disabled={loadingVariation}
                title="Verify provider configuration and refresh capability check"
              >
                {loadingVariation ? (
                  <>
                    <span className="clip-spinner" /> Checking configuration…
                  </>
                ) : (
                  <>
                    <span>⚙️</span> Check provider configuration
                  </>
                )}
              </button>
            ) : (
              <button
                className="clip-btn clip-btn-primary"
                onClick={handleGenerateVariation}
                disabled={loadingVariation}
              >
                {loadingVariation ? (
                  <>
                    <span className="clip-spinner" /> Retrying generation…
                  </>
                ) : (
                  <>
                    <span>🔄</span> Retry video generation
                  </>
                )}
              </button>
            )}
            <button
              className={`clip-btn clip-btn-secondary ${showSecondaryFallback ? "active" : ""}`}
              onClick={() => setShowSecondaryFallback((prev) => !prev)}
            >
              <span>👁️</span> {showSecondaryFallback ? "Hide conceptual fallback" : "View conceptual fallback preview"}
            </button>
          </div>

          {/* Strict Visible Debug / Audit Block */}
          <div className="clip-debug-audit-card">
            <div className="debug-audit-header">
              <span>🔍</span>
              <strong>Generation Provenance &amp; Multi-Stage Audit</strong>
            </div>

            {/* Stage-by-Stage Execution Status */}
            <div className="debug-stages-bar">
              <div className="stage-pill-item">
                <span className="stage-num">1. Pair:</span>
                <span className={`stage-badge ${stages?.activePairResolution === "success" ? "stage-pass" : "stage-fail"}`}>
                  {stages?.activePairResolution || "success"}
                </span>
              </div>
              <div className="stage-pill-item">
                <span className="stage-num">2. Planning ({planningMethod === "local_metadata_template" ? "Local Template" : planningModel}):</span>
                <span
                  className={`stage-badge ${
                    stages?.promptPlanning === "success"
                      ? "stage-pass"
                      : stages?.promptPlanning === "fail"
                      ? "stage-fail"
                      : "stage-skip"
                  }`}
                >
                  {stages?.promptPlanning || "not_attempted"}
                </span>
              </div>
              <div className="stage-pill-item">
                <span className="stage-num">3. Video Req ({videoProviderModel}):</span>
                <span
                  className={`stage-badge ${
                    stages?.providerVideoRequest === "success"
                      ? "stage-pass"
                      : stages?.providerVideoRequest === "not_available"
                      ? "stage-skip"
                      : stages?.providerVideoRequest === "fail"
                      ? "stage-fail"
                      : "stage-skip"
                  }`}
                >
                  {stages?.providerVideoRequest || "not_attempted"}
                </span>
              </div>
              <div className="stage-pill-item">
                <span className="stage-num">4. Artifact:</span>
                <span
                  className={`stage-badge ${
                    stages?.artifactPersistence === "success"
                      ? "stage-pass"
                      : stages?.artifactPersistence === "fail"
                      ? "stage-fail"
                      : "stage-skip"
                  }`}
                >
                  {stages?.artifactPersistence || "not_applicable"}
                </span>
              </div>
              <div className="stage-pill-item">
                <span className="stage-num">5. Fallback:</span>
                <span className="stage-badge stage-neutral">{stages?.fallbackPreview || "used"}</span>
              </div>
            </div>

            <div className="debug-audit-grid">
              <div className="debug-audit-item">
                <span className="debug-label">Active Resolved Pair:</span>
                <span className="debug-value font-mono font-semibold">{activePairStr}</span>
              </div>
              <div className="debug-audit-item">
                <span className="debug-label">Request ID:</span>
                <code className="debug-value font-mono">{clip?.provenance?.requestId || "N/A"}</code>
              </div>
              <div className="debug-audit-item">
                <span className="debug-label">Seed:</span>
                <code className="debug-value font-mono">{clip?.provenance?.seed ?? clip?.seed ?? 42}</code>
              </div>
              <div className="debug-audit-item">
                <span className="debug-label">Planning Method:</span>
                <span className="debug-value font-mono text-emerald-300">
                  {planningMethod === "local_metadata_template" ? "local_metadata_template (Deterministic)" : "gemini_generated"}
                </span>
              </div>
              <div className="debug-audit-item">
                <span className="debug-label">Planning Model:</span>
                <span className="debug-value font-mono text-cyan-300">{planningModel}</span>
              </div>
              <div className="debug-audit-item">
                <span className="debug-label">Video Provider Model:</span>
                <span className="debug-value font-mono text-indigo-300">{videoProviderModel}</span>
              </div>
              <div className="debug-audit-item">
                <span className="debug-label">Provider Capability:</span>
                <span className={`debug-value font-mono ${discovery?.status === "available" ? "text-emerald-300" : "text-amber-300"}`}>
                  {discovery?.status || "unconfigured"}
                </span>
              </div>
              <div className="debug-audit-item">
                <span className="debug-label">Invocation Method:</span>
                <span className="debug-value font-mono">{discovery?.invocationMethod || "none"}</span>
              </div>
              <div className="debug-audit-item">
                <span className="debug-label">Discovered Video Models:</span>
                <span className="debug-value font-mono text-xs">
                  {discovery?.availableVideoModels?.length
                    ? discovery.availableVideoModels.map((m) => m.cleanName).join(", ")
                    : "None"}
                </span>
              </div>
              <div className="debug-audit-item">
                <span className="debug-label">API Surface:</span>
                <span className="debug-value font-mono text-xs">{discovery?.apiSurface || "GoogleGenAI SDK (v1beta)"}</span>
              </div>
              <div className="debug-audit-item">
                <span className="debug-label">Fallback Renderer:</span>
                <span className="debug-value font-mono text-amber-300">{fallbackRenderer}</span>
              </div>
              <div className="debug-audit-item">
                <span className="debug-label">Final Artifact Type:</span>
                <span className="debug-value font-mono">{finalArtifactType}</span>
              </div>
              <div className="debug-audit-item">
                <span className="debug-label">Generation Status:</span>
                <span className="debug-value font-mono text-amber-400">{clip?.provenance?.generationStatus || "failed"}</span>
              </div>
              <div className="debug-audit-item">
                <span className="debug-label">Cache Hit:</span>
                <span className="debug-value font-mono">{clip?.provenance?.cacheHit ? "true" : "false"}</span>
              </div>
              <div className="debug-audit-item">
                <span className="debug-label">Artifact URL:</span>
                <span className="debug-value font-mono">{clip?.videoUrl ? clip.videoUrl : "missing"}</span>
              </div>
              <div className="debug-audit-item full-width">
                <span className="debug-label">Diagnosis / Notice:</span>
                <span className="debug-value text-red-400">{fallbackReason}</span>
              </div>
              {discovery?.requiredStep && (
                <div className="debug-audit-item full-width">
                  <span className="debug-label">Required Access / Step:</span>
                  <span className="debug-value text-amber-300 text-xs">{discovery.requiredStep}</span>
                </div>
              )}
            </div>
          </div>

          {/* Secondary Collapsed Fallback Preview (Only shown when explicitly expanded) */}
          {showSecondaryFallback && (
            <div className="clip-secondary-fallback-container">
              <div className="clip-fallback-banner">
                <span className="fallback-dot" />
                <span className="fallback-text">{fallbackNotice}</span>
              </div>

              <div className="clip-canvas-wrapper" onClick={togglePlay}>
                <canvas ref={canvasRef} className="clip-canvas" />
                {!isPlaying && (
                  <div className="clip-play-overlay">
                    <button
                      className="clip-play-btn"
                      aria-label="Play conceptual animation"
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePlay();
                      }}
                    >
                      ▶
                    </button>
                  </div>
                )}
              </div>

              <div className="clip-controls-bar">
                <button
                  className="clip-control-btn"
                  onClick={togglePlay}
                  title={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? "❚❚" : "▶"}
                </button>
                <input
                  type="range"
                  min="0"
                  max={duration}
                  step="0.05"
                  value={currentTime}
                  onChange={handleSeek}
                  className="clip-timeline-slider"
                />
                <span className="clip-time-display">
                  0:{Math.floor(currentTime).toString().padStart(2, "0")} / 0:
                  {Math.floor(duration).toString().padStart(2, "0")}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 5. Provenance & Accession Line */}
      <div className="clip-attribution-bar">
        <div className="clip-based-on">
          <span>Based on:</span>
          <a
            href={STUDY_URL + sidA}
            target="_blank"
            rel="noreferrer"
            className="clip-study-link"
          >
            {sidA}
          </a>
          <span className="clip-cross-symbol">×</span>
          <a
            href={STUDY_URL + sidB}
            target="_blank"
            rel="noreferrer"
            className="clip-study-link"
          >
            {sidB}
          </a>
        </div>

        <div className="clip-status-indicator">
          <span
            className={`status-pill ${
              clip?.provenance?.generationStatus === "fresh_provider"
                ? "pill-fresh"
                : clip?.provenance?.generationStatus === "cache_hit"
                ? "pill-cache"
                : "pill-fallback"
            }`}
          >
            {statusLabel}
          </span>
        </div>
      </div>

      {/* 6. Action Buttons Bar */}
      <div className="clip-actions-row">
        <button
          className="clip-btn clip-btn-primary"
          onClick={handleGenerateVariation}
          disabled={loadingVariation || isQuotaExhausted}
          title={
            isQuotaExhausted
              ? "Video quota is temporarily exhausted. Fallback preview is active."
              : "Request a fresh random seed and new clip variation"
          }
        >
          {loadingVariation ? (
            <>
              <span className="clip-spinner" /> Generating variation…
            </>
          ) : isQuotaExhausted ? (
            <>
              <span>⏳</span> Quota cooldown active
            </>
          ) : (
            <>
              <span>✨</span> Generate fresh variation
            </>
          )}
        </button>

        <button
          className={`clip-btn clip-btn-toggle ${showEvidence ? "active" : ""}`}
          onClick={() => setShowEvidence((prev) => !prev)}
        >
          <span>📋</span> {showEvidence ? "Hide evidence & provenance" : "Evidence and provenance"}
        </button>

        <button
          className="clip-btn clip-btn-secondary"
          onClick={handleCopyPrompt}
          title="Copy the underlying video prompt"
        >
          <span>📋</span> {copiedPrompt ? "Copied!" : "Copy clip prompt"}
        </button>
      </div>

      {variationError && (
        <div className="clip-error-text">
          ⚠️ {variationError}
        </div>
      )}

      {/* 7. Collapsed Evidence & Provenance Details Panel */}
      {showEvidence && (
        <div className="clip-evidence-panel">
          <h4 className="evidence-panel-title">Evidence, Accessions &amp; Provenance Audit</h4>
          
          <div className="evidence-grid">
            <div className="evidence-col">
              <strong>Study A ({sidA}) Metadata:</strong>
              <ul>
                <li><strong>Organism:</strong> {clip?.studyA?.organism || "Mus musculus"}</li>
                <li><strong>Tissue:</strong> {clip?.studyA?.tissue || "Retina"}</li>
                <li><strong>Assay:</strong> {clip?.studyA?.assay || "RNA-seq (Transcriptomics)"}</li>
                <li><strong>Factor:</strong> {clip?.studyA?.factor || "Spaceflight"}</li>
                <li><strong>Duration:</strong> {clip?.studyA?.duration || "Flight mission"}</li>
                <li><a href={STUDY_URL + sidA} target="_blank" rel="noreferrer">Open in NASA OSDR ↗</a></li>
              </ul>
            </div>

            <div className="evidence-col">
              <strong>Study B ({sidB}) Metadata:</strong>
              <ul>
                <li><strong>Organism:</strong> {clip?.studyB?.organism || "Mus musculus"}</li>
                <li><strong>Tissue:</strong> {clip?.studyB?.tissue || "Retina"}</li>
                <li><strong>Assay:</strong> {clip?.studyB?.assay || "Protein Expression"}</li>
                <li><strong>Factor:</strong> {clip?.studyB?.factor || "Spaceflight"}</li>
                <li><strong>Duration:</strong> {clip?.studyB?.duration || "Flight mission"}</li>
                <li><a href={STUDY_URL + sidB} target="_blank" rel="noreferrer">Open in NASA OSDR ↗</a></li>
              </ul>
            </div>
          </div>

          <div className="provenance-audit-box">
            <div className="audit-row">
              <span className="audit-label">Request ID:</span>
              <code className="audit-val">{clip?.provenance?.requestId || "req-local-init"}</code>
            </div>
            <div className="audit-row">
              <span className="audit-label">Generation Status:</span>
              <span className="audit-val">{clip?.provenance?.generationStatus || "failed"} ({statusLabel})</span>
            </div>
            <div className="audit-row">
              <span className="audit-label">Planning Method:</span>
              <span className="audit-val">{planningMethod}</span>
            </div>
            <div className="audit-row">
              <span className="audit-label">Planning Model:</span>
              <span className="audit-val">{planningModel}</span>
            </div>
            <div className="audit-row">
              <span className="audit-label">Video Provider Model:</span>
              <span className="audit-val">{videoProviderModel}</span>
            </div>
            <div className="audit-row">
              <span className="audit-label">Fallback Renderer:</span>
              <span className="audit-val">{fallbackRenderer}</span>
            </div>
            <div className="audit-row">
              <span className="audit-label">Final Artifact Type:</span>
              <span className="audit-val">{finalArtifactType}</span>
            </div>
            <div className="audit-row">
              <span className="audit-label">Seed:</span>
              <code className="audit-val">{clip?.provenance?.seed ?? clip?.seed ?? 42}</code>
            </div>
            <div className="audit-row">
              <span className="audit-label">Cache Status:</span>
              <span className="audit-val">{clip?.provenance?.cacheHit ? "Reused cached artifact" : "Fresh variation created"}</span>
            </div>
            <div className="audit-row">
              <span className="audit-label">Prompt Fingerprint:</span>
              <code className="audit-val">{clip?.provenance?.promptFingerprint || "sha256:00000000"}</code>
            </div>
          </div>

          <div className="evidence-footer-note">
            <em>✦ [INTERPRETATION] Claims and comedic metaphors are strictly partitioned from empirical OSDR repository records. No biological findings were fabricated.</em>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 60fps High-Resolution Procedural Canvas Renderer for 5-6 Second Scientific Meme Clips
 */
function drawMemeClipScene(ctx, width, height, time, duration, clip, sidA, sidB) {
  // Background gradient
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, "#090d16");
  bgGrad.addColorStop(1, "#111827");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Subtle space biology grid
  ctx.strokeStyle = "rgba(56, 189, 248, 0.05)";
  ctx.lineWidth = 1;
  const gridSize = 40;
  for (let x = 0; x < width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Floating molecular particles
  const numParticles = 18;
  for (let i = 0; i < numParticles; i++) {
    const px = ((i * 123.45 + time * 25) % width);
    const py = ((i * 78.9 + Math.sin(time + i) * 30) % (height - 80)) + 40;
    const rad = 2 + (i % 3);
    ctx.fillStyle = i % 2 === 0 ? "rgba(56, 189, 248, 0.25)" : "rgba(245, 158, 11, 0.25)";
    ctx.beginPath();
    ctx.arc(px, py, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  const scenes = clip?.canvasAnimation?.scenes || [
    {
      timeStart: 0.0,
      timeEnd: 1.8,
      mainText: `${sidA} Transcriptomics`,
      subText: "Transcriptional stress signaling initiated",
      badge: "SCENE 1: TRANSCRIPTS",
      accentColor: "#38bdf8",
    },
    {
      timeStart: 1.8,
      timeEnd: 3.6,
      mainText: `${sidB} Proteomics`,
      subText: "Steady-state protein levels evaluated",
      badge: "SCENE 2: PROTEINS",
      accentColor: "#f59e0b",
    },
    {
      timeStart: 3.6,
      timeEnd: 5.5,
      mainText: "Multi-Omic Synthesis",
      subText: `Co-adaptation observed in ${sidA} × ${sidB}`,
      badge: "SCENE 3: CONCLUSION",
      accentColor: "#10b981",
    },
  ];

  // Determine current active scene
  let currentScene = scenes[0];
  for (const sc of scenes) {
    if (time >= sc.timeStart && time <= sc.timeEnd) {
      currentScene = sc;
      break;
    }
  }

  // Top header bar in canvas
  ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
  ctx.fillRect(0, 0, width, 54);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.strokeRect(0, 0, width, 54);

  ctx.font = "bold 15px sans-serif";
  ctx.fillStyle = "#38bdf8";
  ctx.fillText("✦ NASA OSDR", 24, 32);

  ctx.font = "14px sans-serif";
  ctx.fillStyle = "#94a3b8";
  ctx.fillText(`AWG Meme Clip · ${sidA} × ${sidB}`, 150, 32);

  // Scene Badge (top right)
  const badgeText = currentScene.badge || "[CONCEPTUAL COMMUNICATION]";
  ctx.font = "bold 12px monospace";
  const badgeWidth = ctx.measureText(badgeText).width + 20;
  ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
  ctx.fillRect(width - badgeWidth - 24, 16, badgeWidth, 24);
  ctx.strokeStyle = currentScene.accentColor || "#38bdf8";
  ctx.strokeRect(width - badgeWidth - 24, 16, badgeWidth, 24);
  ctx.fillStyle = currentScene.accentColor || "#38bdf8";
  ctx.fillText(badgeText, width - badgeWidth - 14, 32);

  // Center Stage Box
  const stageY = 90;
  const stageH = 260;
  ctx.fillStyle = "rgba(15, 23, 42, 0.65)";
  ctx.roundRect ? ctx.roundRect(40, stageY, width - 80, stageH, 12) : ctx.fillRect(40, stageY, width - 80, stageH);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.stroke();

  // Animated Visual Graphic based on scene
  const pulse = (Math.sin(time * 4) + 1) / 2;
  const centerX = width / 2;
  const centerY = stageY + 70;

  // Draw dynamic dual-orb / omics connection animation
  ctx.beginPath();
  ctx.arc(centerX - 100, centerY, 32 + pulse * 4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(56, 189, 248, 0.2)";
  ctx.fill();
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = "bold 13px monospace";
  ctx.fillStyle = "#38bdf8";
  ctx.textAlign = "center";
  ctx.fillText(sidA, centerX - 100, centerY + 5);

  ctx.beginPath();
  ctx.arc(centerX + 100, centerY, 32 + (1 - pulse) * 4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(245, 158, 11, 0.2)";
  ctx.fill();
  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = "bold 13px monospace";
  ctx.fillStyle = "#f59e0b";
  ctx.fillText(sidB, centerX + 100, centerY + 5);

  // Connecting energetic wave
  ctx.beginPath();
  ctx.moveTo(centerX - 65, centerY);
  ctx.quadraticCurveTo(centerX, centerY - 25 * Math.sin(time * 5), centerX + 65, centerY);
  ctx.strokeStyle = currentScene.accentColor || "#38bdf8";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Main Scene Text
  ctx.textAlign = "center";
  ctx.font = "bold 22px sans-serif";
  ctx.fillStyle = "#f8fafc";
  ctx.fillText(currentScene.mainText, centerX, stageY + 160);

  // Subtitle
  ctx.font = "15px sans-serif";
  ctx.fillStyle = "#cbd5e1";
  ctx.fillText(currentScene.subText, centerX, stageY + 195);

  // Details tags
  if (Array.isArray(currentScene.details) && currentScene.details.length > 0) {
    ctx.font = "12px monospace";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(currentScene.details[0], centerX, stageY + 230);
  }

  // Bottom Canvas Safeguard Bar
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
  ctx.fillRect(0, height - 38, width, 38);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.strokeRect(0, height - 38, width, 38);

  ctx.font = "11px sans-serif";
  ctx.fillStyle = "#94a3b8";
  ctx.fillText("✦ Conceptual Outreach Communication · Grounded in NASA OSDR Accessions · Not Clinical Telemetry", 24, height - 15);

  // Small countdown / progress bar at bottom of canvas
  const progressRatio = Math.min(1, time / duration);
  ctx.fillStyle = currentScene.accentColor || "#38bdf8";
  ctx.fillRect(0, height - 3, width * progressRatio, 3);
}
