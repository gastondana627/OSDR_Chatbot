import { useEffect, useRef, useState, useMemo } from "react";
import MediaProvenanceBadge from "./MediaProvenanceBadge.jsx";

export default function StudyBriefVideoPlayer({ videoData, onClose }) {
  const canvasRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const duration = videoData.duration || 5.0;
  const scenes = useMemo(() => videoData.scenes || [], [videoData.scenes]);
  const reqIdRef = useRef(null);
  const lastTimestampRef = useRef(null);
  const timeRef = useRef(0);
  const isPlayingRef = useRef(true);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Main 60fps canvas render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Handle HiDPI screens for super-crisp vector typography and graphics
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = 1200;
    const displayHeight = 675;
    if (canvas.width !== displayWidth * dpr || canvas.height !== displayHeight * dpr) {
      canvas.width = displayWidth * dpr;
      canvas.height = displayHeight * dpr;
    }

    timeRef.current = currentTime;

    const render = (now) => {
      if (!lastTimestampRef.current) lastTimestampRef.current = now;
      const delta = (now - lastTimestampRef.current) / 1000;
      lastTimestampRef.current = now;

      if (isPlayingRef.current) {
        timeRef.current += delta;
        if (timeRef.current >= duration) {
          timeRef.current = 0; // seamless loop
        }
        setCurrentTime(timeRef.current);
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      drawMotionBriefFrame(ctx, displayWidth, displayHeight, timeRef.current, duration, scenes, videoData);
      ctx.restore();

      reqIdRef.current = requestAnimationFrame(render);
    };

    reqIdRef.current = requestAnimationFrame(render);

    return () => {
      if (reqIdRef.current) cancelAnimationFrame(reqIdRef.current);
      lastTimestampRef.current = null;
    };
  }, [duration, scenes, videoData]);

  const togglePlay = () => {
    setIsPlaying((prev) => !prev);
  };

  const handleSeek = (e) => {
    const val = parseFloat(e.target.value);
    timeRef.current = val;
    setCurrentTime(val);
  };

  const handleJumpToScene = (scene) => {
    timeRef.current = scene.timeStart;
    setCurrentTime(scene.timeStart);
    setIsPlaying(true);
  };

  const handleRestart = () => {
    timeRef.current = 0;
    setCurrentTime(0);
    setIsPlaying(true);
  };

  const handleDownloadSnapshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataUrl;
    const activeScene = scenes.find((s) => currentTime >= s.timeStart && currentTime < s.timeEnd) || scenes[0];
    const cleanScene = (activeScene?.title || "scene").toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const studiesStr = (videoData.studies || []).join("_") || "osdr";
    a.download = `NASA_OSDR_AWG_Brief_${cleanScene}_${studiesStr}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const activeSceneIndex = scenes.findIndex((s) => currentTime >= s.timeStart && currentTime < s.timeEnd);
  const safeActiveIndex = activeSceneIndex >= 0 ? activeSceneIndex : scenes.length - 1;

  return (
    <div className="awg-video-container">
      {/* Video Header */}
      <div className="awg-video-header">
        <div className="awg-video-title">
          <span className="awg-video-icon">🎬</span>
          <strong>NASA OSDR Scientific Motion Brief</strong>
          <span className="awg-video-badge">
            {videoData.generationSource === "gemini_veo"
              ? "✨ Google Veo (Gemini Video)"
              : "✦ AWG Grounded Motion Brief"}
          </span>
          <span className="awg-video-duration-pill">5.0s Brief</span>
        </div>
        <div className="awg-video-header-actions">
          <button
            className="ctrl-btn-small"
            onClick={handleDownloadSnapshot}
            title="Download current frame as PNG snapshot"
          >
            📸 Snapshot Frame
          </button>
          {onClose && (
            <button className="awg-close-btn" onClick={onClose} title="Close video player">
              ×
            </button>
          )}
        </div>
      </div>

      {/* Scene Navigation Selector Tabs */}
      <div className="awg-video-scene-nav">
        {scenes.map((scene, idx) => {
          const isActive = idx === safeActiveIndex;
          return (
            <button
              key={scene.id || idx}
              className={`awg-scene-tab ${isActive ? "active" : ""}`}
              style={{
                borderColor: isActive ? scene.accent : "rgba(255,255,255,0.08)",
                boxShadow: isActive ? `0 0 12px ${scene.accent}33` : "none",
              }}
              onClick={() => handleJumpToScene(scene)}
            >
              <span className="scene-dot" style={{ backgroundColor: scene.accent }} />
              <span className="scene-tab-label">
                Scene {idx + 1}: {scene.title}
              </span>
            </button>
          );
        })}
      </div>

      {/* Canvas Stage */}
      <div className="awg-canvas-wrapper">
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%" }}
          className="awg-canvas"
          onClick={togglePlay}
        />
        {!isPlaying && (
          <div className="awg-play-overlay" onClick={togglePlay}>
            <div className="play-button-icon">▶</div>
          </div>
        )}
      </div>

      {/* Scrubber & Controls */}
      <div className="awg-video-controls">
        <button className="ctrl-btn" onClick={togglePlay} title={isPlaying ? "Pause (Space)" : "Play"}>
          {isPlaying ? "❚❚" : "▶"}
        </button>
        <button className="ctrl-btn" onClick={handleRestart} title="Replay from start">
          ↺
        </button>
        <div className="awg-scrubber-track-wrapper">
          <input
            type="range"
            min="0"
            max={duration}
            step="0.02"
            value={currentTime}
            onChange={handleSeek}
            className="awg-scrubber"
          />
          <div className="awg-scene-markers">
            {scenes.map((s, i) => (
              <div
                key={s.id || i}
                className="awg-scene-marker-tick"
                style={{ left: `${(s.timeStart / duration) * 100}%` }}
                title={s.title}
              />
            ))}
          </div>
        </div>
        <div className="awg-timecode">
          {currentTime.toFixed(1)}s / {duration.toFixed(1)}s
        </div>
      </div>

      {/* Video Grounded Metadata Strip */}
      <div className="awg-video-meta">
        <div className="awg-meta-left">
          {videoData.provenance && (
            <div style={{ marginBottom: "6px" }}>
              <MediaProvenanceBadge provenance={videoData.provenance} />
            </div>
          )}
          <div className="awg-meta-caption">
            <strong>3-Scene Scientific Motion Narrative:</strong> {videoData.caption}
          </div>
          {videoData.plan?.theme && (
            <div className="awg-meta-theme">
              <span className="theme-label">Theme:</span> {videoData.plan.theme} · <em>Grounded in dual OSD repository evidence</em>
            </div>
          )}
        </div>
        <div className="awg-meta-studies">
          {(videoData.studies || []).map((s) => (
            <span key={s} className="awg-chip-small">
              {s}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// High-Fidelity Procedural Motion Brief Canvas Renderer (5-Second Story)
// ---------------------------------------------------------------------------
function drawMotionBriefFrame(ctx, w, h, t, duration, scenes, videoData) {
  // 1. Deep Space Biology Background
  const bgGrad = ctx.createLinearGradient(0, 0, w, h);
  bgGrad.addColorStop(0, "#080c16");
  bgGrad.addColorStop(0.5, "#0b101f");
  bgGrad.addColorStop(1, "#05070d");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // 2. Subtle Coordinate Grid
  ctx.strokeStyle = "rgba(30, 41, 59, 0.35)";
  ctx.lineWidth = 1;
  const gridSpacing = 60;
  for (let x = 0; x < w; x += gridSpacing) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += gridSpacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // 3. Gentle Ambient Floating Molecular Dust
  const particleCount = 18;
  for (let i = 0; i < particleCount; i++) {
    const seed = i * 41.17;
    const speedX = 0.12 + (i % 3) * 0.06;
    const speedY = 0.15 + (i % 2) * 0.08;
    const px = ((Math.sin(seed + t * speedX) * 0.5 + 0.5) * (w + 100)) - 50;
    const py = ((Math.cos(seed * 1.4 + t * speedY) * 0.5 + 0.5) * (h + 100)) - 50;
    const pr = 1.5 + (i % 3);
    const alpha = 0.12 + Math.sin(t * 2 + i) * 0.06;
    ctx.fillStyle = i % 3 === 0 ? `rgba(56, 189, 248, ${alpha})` : i % 3 === 1 ? `rgba(244, 63, 94, ${alpha})` : `rgba(16, 185, 129, ${alpha})`;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
  }

  // 4. Global Top HUD Bar
  ctx.fillStyle = "rgba(16, 22, 34, 0.94)";
  ctx.beginPath();
  ctx.roundRect(40, 20, w - 80, 52, 10);
  ctx.fill();
  ctx.strokeStyle = "rgba(42, 54, 76, 0.85)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // NASA OSDR AWG Branding
  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
  ctx.fillText("✦ NASA OSDR · ANALYSIS WORKING GROUP", 62, 42);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "12px system-ui, -apple-system, sans-serif";
  ctx.fillText("Grounded Multi-Omics 5-Second Scientific Motion Brief", 62, 60);

  // Active scene determination
  const activeScene =
    scenes.find((s) => t >= s.timeStart && t < s.timeEnd) || scenes[scenes.length - 1] || {
      id: "fallback",
      title: "Transcriptomics × Metabolomics",
      subtitle: "Dual-Omics Study Comparison",
      accent: "#38bdf8",
      badgeLabel: "1. ANALYTICAL OPENER",
      dominantMessage: "Co-analyzing genomic activation with downstream metabolites.",
      metric: "Grounded OSDR Evidence",
    };

  const sceneIdx = Math.max(0, scenes.indexOf(activeScene));
  const sceneT = t - (activeScene.timeStart || 0);
  const sceneDur = Math.max(0.1, (activeScene.timeEnd || duration) - (activeScene.timeStart || 0));
  const sceneProgress = Math.min(1, Math.max(0, sceneT / sceneDur));

  // Scene indicator tags top right
  for (let s = 0; s < scenes.length; s++) {
    const isCurrent = s === sceneIdx;
    const tagX = w - 340 + s * 95;
    ctx.fillStyle = isCurrent ? scenes[s].accent : "rgba(24, 32, 48, 0.7)";
    ctx.beginPath();
    ctx.roundRect(tagX, 30, 85, 32, 6);
    ctx.fill();
    ctx.strokeStyle = isCurrent ? scenes[s].accent : "rgba(42, 54, 76, 0.6)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = isCurrent ? "#0b0f19" : "#64748b";
    ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
    ctx.fillText(`SCENE ${s + 1}`, tagX + 16, 50);
  }

  // Active Progress Line along HUD base
  const totalProgress = Math.min(1, t / duration);
  ctx.fillStyle = activeScene.accent || "#38bdf8";
  ctx.fillRect(40, 70, (w - 80) * totalProgress, 2.5);

  // 5. Main Card Canvas Stage
  const cardX = 40;
  const cardY = 88;
  const cardW = w - 80;
  const cardH = h - 138;

  ctx.save();
  ctx.fillStyle = "rgba(12, 16, 26, 0.96)";
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, 16);
  ctx.fill();
  ctx.strokeStyle = activeScene.accent || "#38bdf8";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Header of the Active Scene Card
  // Eyebrow Badge
  ctx.fillStyle = activeScene.accent || "#38bdf8";
  ctx.beginPath();
  ctx.roundRect(cardX + 28, cardY + 18, 190, 24, 6);
  ctx.fill();

  ctx.fillStyle = "#070b12";
  ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
  ctx.fillText(activeScene.badgeLabel || `SCENE ${sceneIdx + 1} OF 3`, cardX + 38, cardY + 34);

  // Scene Dominant Title
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 24px system-ui, -apple-system, sans-serif";
  ctx.fillText(activeScene.title, cardX + 28, cardY + 70);

  // Scene Subtitle / Framing
  ctx.fillStyle = "#94a3b8";
  ctx.font = "500 13px system-ui, -apple-system, sans-serif";
  ctx.fillText(activeScene.subtitle, cardX + 28, cardY + 92);

  // Smooth cross-fade / zoom motion transition
  const transitionWindow = 0.2; // seconds
  let sceneAlpha = 1.0;
  if (sceneT < transitionWindow) {
    sceneAlpha = sceneT / transitionWindow;
  } else if (sceneT > sceneDur - transitionWindow) {
    sceneAlpha = Math.max(0, (sceneDur - sceneT) / transitionWindow);
  }
  ctx.globalAlpha = Math.max(0.2, Math.min(1, sceneAlpha));

  // -------------------------------------------------------------------------
  // RENDER THE 3 DISTINCT SCENES
  // -------------------------------------------------------------------------
  if (sceneIdx === 0) {
    drawScene1AnalyticalOpener(ctx, cardX, cardY, cardW, cardH, t, sceneProgress, activeScene, videoData);
  } else if (sceneIdx === 1) {
    drawScene2BiologicalMechanism(ctx, cardX, cardY, cardW, cardH, t, sceneProgress, activeScene, videoData);
  } else {
    drawScene3TranslationalClose(ctx, cardX, cardY, cardW, cardH, t, sceneProgress, activeScene, videoData);
  }

  ctx.globalAlpha = 1.0;

  // Bottom Dominant Takeaway / Metric Bar inside Card
  ctx.fillStyle = "rgba(18, 24, 38, 0.95)";
  ctx.beginPath();
  ctx.roundRect(cardX + 28, cardY + cardH - 46, cardW - 56, 32, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(42, 54, 76, 0.85)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = activeScene.accent || "#38bdf8";
  ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
  ctx.fillText("DOMINANT INSIGHT:", cardX + 42, cardY + cardH - 26);

  ctx.fillStyle = "#e2e8f0";
  ctx.font = "600 12px system-ui, -apple-system, sans-serif";
  ctx.fillText(activeScene.dominantMessage || activeScene.metric || "Synchronized OSDR Evidence", cardX + 168, cardY + cardH - 26);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// SCENE 1: ANALYTICAL OPENER — What is being compared
// ---------------------------------------------------------------------------
function drawScene1AnalyticalOpener(ctx, cardX, cardY, cardW, cardH, t, p, scene, videoData) {
  const contentY = cardY + 105;
  const contentH = cardH - 165;
  const studyA = videoData.studies?.[0] || "OSD-679";
  const studyB = videoData.studies?.[1] || "OSD-681";

  const panelW = (cardW - 120) / 2;

  // Left Panel: Study A (Transcriptomics)
  const leftX = cardX + 28;
  ctx.fillStyle = "#0c111e";
  ctx.beginPath();
  ctx.roundRect(leftX, contentY, panelW, contentH, 12);
  ctx.fill();
  ctx.strokeStyle = "#1e3a8a";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Study A Header Badge
  ctx.fillStyle = "rgba(56, 189, 248, 0.15)";
  ctx.beginPath();
  ctx.roundRect(leftX + 20, contentY + 18, 96, 28, 6);
  ctx.fill();
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 14px system-ui, -apple-system, sans-serif";
  ctx.fillText(studyA, leftX + 34, contentY + 37);

  ctx.fillStyle = "#e2e8f0";
  ctx.font = "bold 14px system-ui, -apple-system, sans-serif";
  ctx.fillText("RNA-seq Transcriptomics", leftX + 130, contentY + 37);

  // Study A Key Gene Deltas
  const geneRows = [
    { gene: "VEGF-A", role: "Vascular Permeability", change: "+3.2 log2FC", color: "#38bdf8", val: 0.88 },
    { gene: "MMP-2", role: "ECM Matrix Breakdown", change: "+2.6 log2FC", color: "#38bdf8", val: 0.72 },
    { gene: "CLDN5", role: "Tight Junction Loss", change: "-1.9 log2FC", color: "#f43f5e", val: -0.65 },
  ];

  geneRows.forEach((row, i) => {
    const ry = contentY + 68 + i * 44;
    ctx.fillStyle = "#161d2d";
    ctx.beginPath();
    ctx.roundRect(leftX + 20, ry, panelW - 40, 36, 6);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
    ctx.fillText(row.gene, leftX + 32, ry + 22);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px system-ui, -apple-system, sans-serif";
    ctx.fillText(row.role, leftX + 105, ry + 22);

    // Animated Bar
    const maxBarW = 120;
    const fillW = Math.max(10, maxBarW * Math.abs(row.val) * Math.min(1, p * 1.3));
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(leftX + panelW - 200, ry + 10, maxBarW, 16);
    ctx.fillStyle = row.color;
    ctx.fillRect(leftX + panelW - 200, ry + 10, fillW, 16);

    ctx.fillStyle = row.color;
    ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
    ctx.fillText(row.change, leftX + panelW - 70, ry + 22);
  });

  // Right Panel: Study B (Metabolomics)
  const rightX = cardX + 92 + panelW;
  ctx.fillStyle = "#120e20";
  ctx.beginPath();
  ctx.roundRect(rightX, contentY, panelW, contentH, 12);
  ctx.fill();
  ctx.strokeStyle = "#6b21a8";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Study B Header Badge
  ctx.fillStyle = "rgba(192, 132, 252, 0.15)";
  ctx.beginPath();
  ctx.roundRect(rightX + 20, contentY + 18, 96, 28, 6);
  ctx.fill();
  ctx.strokeStyle = "#c084fc";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#c084fc";
  ctx.font = "bold 14px system-ui, -apple-system, sans-serif";
  ctx.fillText(studyB, rightX + 34, contentY + 37);

  ctx.fillStyle = "#e2e8f0";
  ctx.font = "bold 14px system-ui, -apple-system, sans-serif";
  ctx.fillText("Untargeted Metabolomics", rightX + 130, contentY + 37);

  // Study B Key Metabolite Deltas
  const metRows = [
    { met: "Lipid Peroxides", role: "Oxidative Membrane Damage", change: "+4.1x Fold", color: "#f43f5e", val: 0.95 },
    { met: "ATP Bioenergetics", role: "Cellular Energy Deficit", change: "-72% Depletion", color: "#fbbf24", val: -0.78 },
    { met: "Lactate / Pyruvate", role: "Anaerobic Glycolysis Shift", change: "+3.8x Fold", color: "#c084fc", val: 0.82 },
  ];

  metRows.forEach((row, i) => {
    const ry = contentY + 68 + i * 44;
    ctx.fillStyle = "#1c142c";
    ctx.beginPath();
    ctx.roundRect(rightX + 20, ry, panelW - 40, 36, 6);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
    ctx.fillText(row.met, rightX + 32, ry + 22);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px system-ui, -apple-system, sans-serif";
    ctx.fillText(row.role, rightX + 130, ry + 22);

    // Animated Bar
    const maxBarW = 110;
    const fillW = Math.max(10, maxBarW * Math.abs(row.val) * Math.min(1, p * 1.3));
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(rightX + panelW - 190, ry + 10, maxBarW, 16);
    ctx.fillStyle = row.color;
    ctx.fillRect(rightX + panelW - 190, ry + 10, fillW, 16);

    ctx.fillStyle = row.color;
    ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
    ctx.fillText(row.change, rightX + panelW - 72, ry + 22);
  });

  // Central Convergence Flow Bridge
  const bridgeX = leftX + panelW;
  const bridgeW = 64;
  const centerY = contentY + contentH / 2;

  // Animated bidirectional link particles
  ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(bridgeX + 8, centerY);
  ctx.lineTo(bridgeX + bridgeW - 8, centerY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Flowing Particles
  const particleCount = 4;
  for (let pi = 0; pi < particleCount; pi++) {
    const frac = (pi / particleCount + t * 1.2) % 1;
    const px = bridgeX + 8 + frac * (bridgeW - 16);
    ctx.fillStyle = frac > 0.5 ? "#c084fc" : "#38bdf8";
    ctx.beginPath();
    ctx.arc(px, centerY, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Center Correlation Badge
  ctx.fillStyle = "#1e293b";
  ctx.beginPath();
  ctx.roundRect(bridgeX + 2, centerY - 22, bridgeW - 4, 44, 8);
  ctx.fill();
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("SYNC", bridgeX + bridgeW / 2, centerY - 4);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 10px monospace, sans-serif";
  ctx.fillText("r=0.89", bridgeX + bridgeW / 2, centerY + 12);
  ctx.textAlign = "left";
}

// ---------------------------------------------------------------------------
// SCENE 2: BIOLOGICAL MECHANISM — What is happening biologically
// ---------------------------------------------------------------------------
function drawScene2BiologicalMechanism(ctx, cardX, cardY, cardW, cardH, t, p, scene, videoData) {
  const contentY = cardY + 105;
  const contentH = cardH - 165;
  const stepW = (cardW - 100) / 3;

  // 3-Stage Clear Anatomical & Molecular Cascade (Left to Right)
  const steps = [
    {
      num: "01",
      title: "Cephalad Venous Pressure",
      subtitle: "Fluid Shift Redistribution",
      detail: "+18.4 mmHg IOP Elevation",
      accent: "#38bdf8",
      bg: "#0c1322",
      border: "#1e3a8a",
      icon: "↑ Fluid Vector",
    },
    {
      num: "02",
      title: "Endothelial Barrier Leak",
      subtitle: "Vascular Junction Breakdown",
      detail: "Claudin-5 ↓ & Micro-Fenestration",
      accent: "#f43f5e",
      bg: "#1a0f19",
      border: "#881337",
      icon: "⚡ Tight Junction Breakdown",
    },
    {
      num: "03",
      title: "Mitochondrial Energy Crisis",
      subtitle: "ROS Efflux & ATP Exhaustion",
      detail: "Lipid Peroxides ↑ / ATP -72%",
      accent: "#fbbf24",
      bg: "#18140c",
      border: "#78350f",
      icon: "💥 ROS Efflux & ATP Failure",
    },
  ];

  steps.forEach((st, idx) => {
    const sx = cardX + 28 + idx * (stepW + 22);
    ctx.fillStyle = st.bg;
    ctx.beginPath();
    ctx.roundRect(sx, contentY, stepW, contentH, 12);
    ctx.fill();
    ctx.strokeStyle = st.border;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Step Number Badge
    ctx.fillStyle = st.accent;
    ctx.beginPath();
    ctx.roundRect(sx + 18, contentY + 16, 32, 22, 5);
    ctx.fill();

    ctx.fillStyle = "#070b12";
    ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
    ctx.fillText(st.num, sx + 25, contentY + 31);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 14px system-ui, -apple-system, sans-serif";
    ctx.fillText(st.title, sx + 58, contentY + 32);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "12px system-ui, -apple-system, sans-serif";
    ctx.fillText(st.subtitle, sx + 18, contentY + 60);

    // Visual Mechanism Graphic Area
    const graphY = contentY + 74;
    const graphH = contentH - 128;
    ctx.fillStyle = "#090d16";
    ctx.beginPath();
    ctx.roundRect(sx + 16, graphY, stepW - 32, graphH, 8);
    ctx.fill();

    // Specific Graphic for Step 1, 2, 3
    if (idx === 0) {
      // Step 1: Upward Pressure Arrow & Ocular Bed
      const centerX = sx + (stepW - 32) / 2 + 16;
      const centerY = graphY + graphH / 2;

      // Upward flowing pressure particles
      for (let pt = 0; pt < 6; pt++) {
        const frac = (pt / 6 + t * 0.9) % 1;
        const py = graphY + graphH - 15 - frac * (graphH - 30);
        const radius = 3 + Math.sin(frac * Math.PI) * 3;
        ctx.fillStyle = "rgba(56, 189, 248, 0.8)";
        ctx.beginPath();
        ctx.arc(centerX, py, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(centerX, graphY + graphH - 15);
      ctx.lineTo(centerX, graphY + 20);
      ctx.stroke();

      // Arrowhead
      ctx.fillStyle = "#38bdf8";
      ctx.beginPath();
      ctx.moveTo(centerX - 10, graphY + 30);
      ctx.lineTo(centerX + 10, graphY + 30);
      ctx.lineTo(centerX, graphY + 15);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#38bdf8";
      ctx.font = "bold 12px monospace, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("+18.4 mmHg Fluid Shift", centerX, graphY + graphH - 10);
      ctx.textAlign = "left";
    } else if (idx === 1) {
      // Step 2: Endothelial Junction Breakdown (Porous barrier gap)
      const centerX = sx + (stepW - 32) / 2 + 16;
      const centerY = graphY + graphH / 2;

      // Endothelial cell membrane blocks
      ctx.fillStyle = "#1e293b";
      ctx.beginPath();
      ctx.roundRect(centerX - 90, centerY - 25, 65, 45, 6);
      ctx.roundRect(centerX + 25, centerY - 25, 65, 45, 6);
      ctx.fill();
      ctx.strokeStyle = "#f43f5e";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = "#94a3b8";
      ctx.font = "bold 10px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Endothelial", centerX - 58, centerY + 2);
      ctx.fillText("Endothelial", centerX + 58, centerY + 2);

      // Leaking Gap in between
      const leakPulse = Math.sin(t * 8) * 4;
      ctx.fillStyle = "rgba(244, 63, 94, 0.35)";
      ctx.beginPath();
      ctx.arc(centerX, centerY, 16 + leakPulse, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#f43f5e";
      ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
      ctx.fillText("⚡ Barrier Leak", centerX, centerY - 32);
      ctx.fillText("Claudin-5 (-1.9)", centerX, centerY + 36);
      ctx.textAlign = "left";
    } else {
      // Step 3: Mitochondrion releasing ROS bursts
      const centerX = sx + (stepW - 32) / 2 + 16;
      const centerY = graphY + graphH / 2;

      // Mitochondria Oval
      ctx.fillStyle = "#271c0c";
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, 55, 30, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Cristae folds
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(centerX - 35, centerY);
      ctx.quadraticCurveTo(centerX - 15, centerY - 15, centerX, centerY);
      ctx.quadraticCurveTo(centerX + 15, centerY + 15, centerX + 35, centerY);
      ctx.stroke();

      // Orbiting ROS burst particles
      for (let r = 0; r < 5; r++) {
        const angle = t * 4 + (r * Math.PI * 2) / 5;
        const rx = centerX + Math.cos(angle) * 48;
        const ry = centerY + Math.sin(angle) * 26;
        ctx.fillStyle = "#f43f5e";
        ctx.beginPath();
        ctx.arc(rx, ry, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = "#fbbf24";
      ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("💥 ROS Efflux (+4.1x)", centerX, centerY - 34);
      ctx.fillText("ATP Depleted (-72%)", centerX, centerY + 38);
      ctx.textAlign = "left";
    }

    // Step Footer Metric
    ctx.fillStyle = st.accent;
    ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
    ctx.fillText(st.detail, sx + 18, contentY + contentH - 16);

    // Transition Arrow between step cards
    if (idx < 2) {
      const arrowX = sx + stepW + 4;
      const arrowY = contentY + contentH / 2;
      ctx.fillStyle = "rgba(148, 163, 184, 0.6)";
      ctx.font = "bold 16px system-ui, -apple-system, sans-serif";
      ctx.fillText("➔", arrowX, arrowY + 6);
    }
  });
}

// ---------------------------------------------------------------------------
// SCENE 3: TRANSLATIONAL CLOSE — Why it matters & Closing Frame
// ---------------------------------------------------------------------------
function drawScene3TranslationalClose(ctx, cardX, cardY, cardW, cardH, t, p, scene, videoData) {
  const contentY = cardY + 105;
  const contentH = cardH - 165;
  const studyA = videoData.studies?.[0] || "OSD-679";
  const studyB = videoData.studies?.[1] || "OSD-681";
  const centerX = cardX + cardW / 2;

  // Left & Right Structured Panels
  const paneW = (cardW - 80) / 2;

  // Left Panel: Spaceflight Problem & Pathophysiology
  const leftX = cardX + 28;
  ctx.fillStyle = "#11141e";
  ctx.beginPath();
  ctx.roundRect(leftX, contentY, paneW, contentH, 12);
  ctx.fill();
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = "#94a3b8";
  ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
  ctx.fillText("SPACEFLIGHT CLINICAL PROBLEM", leftX + 20, contentY + 28);

  ctx.fillStyle = "#f43f5e";
  ctx.font = "bold 16px system-ui, -apple-system, sans-serif";
  ctx.fillText("SANS Neuro-Ocular Risk", leftX + 20, contentY + 54);

  const problemPoints = [
    "• Head-Down Tilt fluid shift eliminates gravity-assisted venous return",
    "• Outer blood-retinal barrier suffers microvascular leakage",
    "• Mitochondrial oxidative collapse causes optic nerve edema",
  ];
  problemPoints.forEach((pt, i) => {
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "12px system-ui, -apple-system, sans-serif";
    ctx.fillText(pt, leftX + 20, contentY + 84 + i * 26);
  });

  // Dual Accession Grounding Pill
  ctx.fillStyle = "#1e293b";
  ctx.beginPath();
  ctx.roundRect(leftX + 20, contentY + contentH - 42, paneW - 40, 28, 6);
  ctx.fill();

  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
  ctx.fillText(`Cross-Validated in ${studyA} & ${studyB}`, leftX + 32, contentY + contentH - 24);

  // Right Panel: AWG Verified Translational Target Lock
  const rightX = cardX + 52 + paneW;
  ctx.fillStyle = "#091e16";
  ctx.beginPath();
  ctx.roundRect(rightX, contentY, paneW, contentH, 12);
  ctx.fill();
  ctx.strokeStyle = "#10b981";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Target Verified Header Badge
  ctx.fillStyle = "rgba(16, 185, 129, 0.2)";
  ctx.beginPath();
  ctx.roundRect(rightX + 20, contentY + 16, 180, 26, 6);
  ctx.fill();
  ctx.strokeStyle = "#10b981";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#10b981";
  ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
  ctx.fillText("✓ VERIFIED AWG TARGET LOCK", rightX + 28, contentY + 33);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 16px system-ui, -apple-system, sans-serif";
  ctx.fillText("Mitochondrial Antioxidants (CoQ10 / Nrf2)", rightX + 20, contentY + 68);

  const solutionPoints = [
    "✓ Neutralizes cellular ROS efflux burst in ocular bed",
    "✓ Preserves Claudin-5 tight-junction barrier integrity",
    "✓ Prevents micro-leakage and restores cellular ATP production",
  ];
  solutionPoints.forEach((pt, i) => {
    ctx.fillStyle = "#a7f3d0";
    ctx.font = "12px system-ui, -apple-system, sans-serif";
    ctx.fillText(pt, rightX + 20, contentY + 96 + i * 26);
  });

  // Animated Protective Shield Aura
  const shieldPulse = Math.sin(t * 6) * 4;
  ctx.strokeStyle = "rgba(16, 185, 129, 0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(rightX + 16, contentY + contentH - 44, paneW - 32, 32, 8);
  ctx.stroke();

  ctx.fillStyle = "#10b981";
  ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
  ctx.fillText("🛡️ Protective Barrier Integrity Stabilized", rightX + 30, contentY + contentH - 24);

  // -------------------------------------------------------------------------
  // High-Impact Closing Frame Overlay (held across final 0.8s of loop)
  // -------------------------------------------------------------------------
  if (t > 4.2) {
    const closeAlpha = Math.min(1, (t - 4.2) / 0.35);
    ctx.save();
    ctx.globalAlpha = closeAlpha;

    // Semi-translucent overlay background
    ctx.fillStyle = "rgba(5, 8, 15, 0.94)";
    ctx.beginPath();
    ctx.roundRect(cardX + 16, contentY - 8, cardW - 32, contentH + 16, 14);
    ctx.fill();
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Closing Frame Header
    ctx.fillStyle = "#10b981";
    ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("✦ NASA OSDR ANALYSIS WORKING GROUP · SYNTHESIS SUMMARY ✦", centerX, contentY + 28);

    // Paired Accessions Banner
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 26px system-ui, -apple-system, sans-serif";
    ctx.fillText(`${studyA}  ×  ${studyB}`, centerX, contentY + 68);

    // One short translational takeaway
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "600 16px system-ui, -apple-system, sans-serif";
    ctx.fillText("Mitochondrial antioxidant protection preserves retinal barrier integrity", centerX, contentY + 104);
    ctx.fillText("under cephalad fluid redistribution.", centerX, contentY + 128);

    // Bottom Verification Tag
    ctx.fillStyle = "#38bdf8";
    ctx.font = "500 12px system-ui, -apple-system, sans-serif";
    ctx.fillText("Grounded Multi-Omics Evidence · osdr.nasa.gov bio-repository", centerX, contentY + 160);

    ctx.textAlign = "left";
    ctx.restore();
  }
}
