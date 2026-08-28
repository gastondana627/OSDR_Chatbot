import { useEffect, useRef, useState } from "react";
import { generateTranslationalClip } from "../api";
import MediaProvenanceBadge from "./MediaProvenanceBadge.jsx";

export default function RelatableClipPlayer({ clipData, onClose, onUpdateClip }) {
  const canvasRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [showSafeguards, setShowSafeguards] = useState(false);
  const [activeDirection, setActiveDirection] = useState(
    clipData?.direction || "lab_analog"
  );
  const [loadingNewDirection, setLoadingNewDirection] = useState(false);
  const [currentSeed, setCurrentSeed] = useState(clipData?.creativeSeed || 42);

  const duration = clipData?.duration || 6.0;
  const currentClip = clipData;

  const reqIdRef = useRef(null);
  const lastTimestampRef = useRef(null);
  const timeRef = useRef(0);
  const isPlayingRef = useRef(true);

  useEffect(() => {
    if (clipData?.direction) {
      setActiveDirection(clipData.direction);
    }
    if (clipData?.creativeSeed !== undefined) {
      setCurrentSeed(clipData.creativeSeed);
    }
  }, [clipData?.direction, clipData?.creativeSeed]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Main 60fps cinematic Canvas render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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
          timeRef.current = 0; // seamless continuous loop
        }
        setCurrentTime(timeRef.current);
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      drawGroundedTranslationalScene(
        ctx,
        displayWidth,
        displayHeight,
        timeRef.current,
        duration,
        currentClip,
        activeDirection,
        currentSeed
      );
      ctx.restore();

      reqIdRef.current = requestAnimationFrame(render);
    };

    reqIdRef.current = requestAnimationFrame(render);

    return () => {
      if (reqIdRef.current) cancelAnimationFrame(reqIdRef.current);
      lastTimestampRef.current = null;
    };
  }, [duration, currentClip, activeDirection, currentSeed]);

  const togglePlay = () => {
    setIsPlaying((prev) => !prev);
  };

  const handleSeek = (e) => {
    const val = parseFloat(e.target.value);
    timeRef.current = val;
    setCurrentTime(val);
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
    const studiesStr = (currentClip.studies || []).join("_") || "osdr";
    a.download = `NASA_Translational_${activeDirection}_${studiesStr}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleSwitchDirection = async (newDir) => {
    if (newDir === activeDirection && !loadingNewDirection) return;
    setActiveDirection(newDir);
    setLoadingNewDirection(true);
    try {
      const res = await generateTranslationalClip({
        studies: currentClip.studies,
        query: currentClip.headline || currentClip.title,
        summary: currentClip.storyNarrative,
        direction: newDir,
        seed: Math.floor(Math.random() * 100000),
      });
      if (onUpdateClip) {
        onUpdateClip(res);
      }
    } catch {
      // Local visual mode switched seamlessly
    } finally {
      setLoadingNewDirection(false);
    }
  };

  const handleRollSeed = async () => {
    const newSeed = Math.floor(Math.random() * 100000);
    setCurrentSeed(newSeed);
    setLoadingNewDirection(true);
    try {
      const res = await generateTranslationalClip({
        studies: currentClip.studies,
        query: currentClip.headline || currentClip.title,
        summary: currentClip.storyNarrative,
        direction: activeDirection,
        seed: newSeed,
      });
      if (onUpdateClip) {
        onUpdateClip(res);
      }
    } catch {
      // Local seed updated
    } finally {
      setLoadingNewDirection(false);
    }
  };

  const currentProgressPct = (currentTime / duration) * 100;
  const currentStage =
    currentClip.cinematicConfig?.narrativeStages?.find(
      (s) => currentTime >= s.timeRange[0] && currentTime <= s.timeRange[1]
    ) || currentClip.cinematicConfig?.narrativeStages?.[0];

  const allDirectionOptions = [
    { id: "lab_analog", label: "🏢 HDT Analog Lab", tag: "Terrestrial -6° HDT Bedrest" },
    { id: "ocular_imaging", label: "👁️ OCT Retinal Scan", tag: "Diagnostic SANS Imaging" },
    { id: "omics_translation", label: "🧬 Wet-Lab Omics", tag: "RNA-seq × Mass Spec Bench" },
    { id: "mission_monitoring", label: "🧑‍🚀 Crew Health", tag: "Operational Resilience" },
    { id: "operational_relevance", label: "⚖️ Ground vs Flight", tag: "Side-by-Side Comparison" },
  ];

  const directionOptions = currentClip.alternateDirectionsAvailable
    ? allDirectionOptions.filter((d) =>
        currentClip.alternateDirectionsAvailable.some((alt) => alt.key === d.id) ||
        currentClip.direction === d.id ||
        currentClip.selectedDirectionKey === d.id
      )
    : allDirectionOptions;

  const selectedDirectionLabel =
    currentClip.selectedDirectionLabel ||
    currentClip.directionLabel ||
    directionOptions.find((d) => d.id === activeDirection)?.label ||
    activeDirection;

  const selectionRationale =
    currentClip.selectionRationale ||
    currentClip.directionRationale ||
    `Matched to active study attributes and prompt context. Switch directions below anytime to view alternate grounded perspectives.`;

  return (
    <div className="awg-translational-clip-card" id="awg-translational-clip-player">
      {/* Header with Mode Distinction & Provenance */}
      <div className="clip-header">
        <div className="clip-title-group">
          <div className="clip-badge-row">
            <span className="clip-type-pill">🎬 Translational Mission Visualizer</span>
            <span className="clip-provenance-pill">
              {currentClip.provenance?.planningProvider || (currentClip.generationSource === "gemini_veo"
                ? "✨ Veo AI Planned Scene"
                : "✦ 60fps Canvas Simulation")}
            </span>
            <span className="clip-duration-pill">{duration.toFixed(1)}s Kinetic Simulation</span>
            <span className="seed-badge">Seed #{currentSeed}</span>
          </div>
          <h4 className="clip-title">{currentClip.title}</h4>
          <p className="clip-headline">{currentClip.headline}</p>
        </div>

        <div className="clip-header-actions">
          <button
            className="ctrl-btn-small"
            onClick={handleRollSeed}
            disabled={loadingNewDirection}
            title="Roll a new creative direction seed for run-to-run sub-scenario variation"
          >
            {loadingNewDirection ? "⏳ Updating..." : "🎲 Re-roll Seed"}
          </button>
          <button
            className={`ctrl-btn-small ${showSafeguards ? "active-toggle" : ""}`}
            onClick={() => setShowSafeguards(!showSafeguards)}
            title="Inspect Grounded Evidence vs Conceptual Framing & Accuracy Safeguards"
          >
            🛡️ Evidence vs Framing
          </button>
          <button
            className="ctrl-btn-small"
            onClick={handleDownloadSnapshot}
            title="Export high-resolution PNG snapshot"
          >
            📸 Snapshot Frame
          </button>
          {onClose && (
            <button className="awg-close-btn" onClick={onClose} title="Close clip player">
              ×
            </button>
          )}
        </div>
      </div>

      {/* Selected Grounded Direction & Why this mode fits */}
      <div className="clip-selection-meta-box">
        <div className="selection-meta-row">
          <div className="selection-meta-badge">
            <span className="selection-badge-label">Selected grounded direction:</span>
            <strong className="selection-badge-value">{selectedDirectionLabel}</strong>
          </div>
          {currentClip.provenance && (
            <MediaProvenanceBadge provenance={currentClip.provenance} />
          )}
        </div>

        <div className="selection-rationale-box">
          <span className="rationale-tag">Why this mode fits this OSD pair:</span>
          <p className="rationale-text">{selectionRationale}</p>
        </div>

        <div className="switch-direction-hint">
          💡 <em>You can switch among any of the {directionOptions.length} grounded directions below to explore different translational perspectives without changing the underlying OSD evidence.</em>
        </div>
      </div>

      {/* Internal Mode Selector Toolbar */}
      <div className="clip-direction-selector-bar">
        <span className="direction-selector-label">Grounded Directions:</span>
        <div className="direction-pills-row">
          {directionOptions.map((opt) => {
            const isSelected = activeDirection === opt.id;
            return (
              <button
                key={opt.id}
                className={`direction-pill-btn ${isSelected ? "active" : ""}`}
                onClick={() => handleSwitchDirection(opt.id)}
                disabled={loadingNewDirection}
                title={opt.tag}
              >
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Grounded Evidence vs Conceptual Framing Panel */}
      {showSafeguards && (
        <div className="clip-safeguards-panel">
          <div className="safeguards-header">
            <strong>Grounded evidence vs conceptual framing</strong>
            <span className="safeguards-sub">Scientific restraint: Distinguishing empirical repository data from conceptual translational visualization</span>
          </div>

          <div className="safeguards-grid">
            {/* 1. Grounded Evidence */}
            <div className="safeguard-col grounded">
              <div className="col-tag">🟢 Grounded Evidence (NASA OSDR Accessions)</div>
              <div className="col-content">
                {(currentClip.groundedEvidence || currentClip.accuracySafeguards?.groundedFacts)?.map((fact, i) => (
                  <div key={i} className="fact-item">
                    <div className="fact-header-row">
                      <span className="fact-id">{fact.studyId || fact.study_id}</span>
                      <span className="fact-org">{fact.organism}</span>
                    </div>
                    <div className="fact-detail">
                      <strong>Tissue:</strong> {fact.tissue} · <strong>Factor:</strong> {fact.factor}
                    </div>
                    <div className="fact-assay">
                      <strong>Assay:</strong> {fact.assay}
                    </div>
                    {fact.repositoryRecord && (
                      <div className="fact-record">
                        <em>{fact.repositoryRecord}</em>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 2. Conceptual Framing */}
            <div className="safeguard-col conceptual">
              <div className="col-tag">🔵 Conceptual Framing &amp; Analog Metaphor</div>
              <div className="col-content">
                <div className="conceptual-field">
                  <strong>Scenario Context:</strong> {currentClip.conceptualElements?.scenarioTitle || currentClip.scenario}
                </div>
                <div className="conceptual-field">
                  <strong>Visual Metaphor:</strong> {currentClip.conceptualElements?.visualMetaphor || currentClip.visualMetaphor}
                </div>
                {currentClip.conceptualElements?.keyVisualElements && (
                  <div className="conceptual-elements-list">
                    <strong>Key Scene Elements:</strong>
                    <ul>
                      {currentClip.conceptualElements.keyVisualElements.map((el, idx) => (
                        <li key={idx}>{el}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="conceptual-disclaimer">
                  ⚠️ <em>{currentClip.conceptualElements?.analogSimulationDisclaimer || "Represents a conceptual translational visualization grounded in repository metadata to illustrate real-world mission relevance, rather than direct astronaut telemetry or live clinical patient recordings."}</em>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cinematic Viewport Canvas */}
      <div className="clip-canvas-wrapper">
        <canvas
          ref={canvasRef}
          className="clip-canvas"
          onClick={togglePlay}
          title="Click to play / pause translational clip"
        />

        {/* Ambient Grounded Telemetry Overlay */}
        <div className="clip-canvas-hud-overlay">
          <div className="hud-metric-pill">
            <span className="hud-dot green" />
            <span className="hud-text">{currentClip.cinematicConfig?.hudOverlay?.vitalReading}</span>
          </div>
          <div className="hud-metric-pill">
            <span className="hud-dot cyan" />
            <span className="hud-text">{currentClip.cinematicConfig?.hudOverlay?.fluidShiftMetric}</span>
          </div>
          <div className="hud-metric-pill">
            <span className="hud-dot amber" />
            <span className="hud-text">{currentClip.cinematicConfig?.hudOverlay?.cellularIntegrityIndex}</span>
          </div>
        </div>

        {/* Dynamic Story Subtitle Bar */}
        {currentStage && (
          <div className="clip-subtitles-bar">
            <div className="subtitle-stage-pill">{currentStage.stageTitle}</div>
            <div className="subtitle-caption">{currentStage.caption}</div>
          </div>
        )}
      </div>

      {/* Player Control Bar */}
      <div className="clip-controls">
        <button
          className="clip-play-btn"
          onClick={togglePlay}
          title={isPlaying ? "Pause clip" : "Play clip"}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>

        <button className="clip-ctrl-btn" onClick={handleRestart} title="Restart clip">
          ↺
        </button>

        <span className="clip-time-display">
          {currentTime.toFixed(1)}s / {duration.toFixed(1)}s
        </span>

        <input
          type="range"
          min="0"
          max={duration}
          step="0.05"
          value={currentTime}
          onChange={handleSeek}
          className="clip-scrubber"
          style={{
            background: `linear-gradient(to right, #06b6d4 0%, #06b6d4 ${currentProgressPct}%, #1e293b ${currentProgressPct}%, #1e293b 100%)`,
          }}
        />

        <div className="clip-studies-tag">
          Grounded Studies: <strong>{(currentClip.studies || []).join(" × ")}</strong>
        </div>
      </div>

      {/* Narrative Synthesis Footer */}
      <div className="clip-narrative-footer">
        <div className="narrative-scenario">
          <span className="scenario-label">Scenario Context:</span>
          <strong>{currentClip.scenario}</strong>
          <span className="seed-badge">Seed #{currentSeed}</span>
        </div>
        <p className="narrative-body">{currentClip.storyNarrative}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-Direction Grounded Canvas Scene Router
// ---------------------------------------------------------------------------

function drawGroundedTranslationalScene(
  ctx,
  width,
  height,
  t,
  duration,
  clipData,
  direction,
  seed
) {
  const normTime = (t / duration) % 1.0;

  switch (direction) {
    case "lab_analog":
      drawLabAnalogScene(ctx, width, height, t, duration, clipData, seed, normTime);
      break;
    case "ocular_imaging":
      drawOcularImagingScene(ctx, width, height, t, duration, clipData, seed, normTime);
      break;
    case "omics_translation":
      drawOmicsTranslationScene(ctx, width, height, t, duration, clipData, seed, normTime);
      break;
    case "mission_monitoring":
      drawMissionMonitoringScene(ctx, width, height, t, duration, clipData, seed, normTime);
      break;
    case "operational_relevance":
    default:
      drawOperationalRelevanceScene(ctx, width, height, t, duration, clipData, seed, normTime);
      break;
  }

  // Common Bottom Timeline Indicator
  ctx.save();
  ctx.fillStyle = "rgba(6, 182, 212, 0.85)";
  ctx.fillRect(0, height - 4, width * normTime, 4);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 1. Head-Down Tilt Analog Lab Scene (-6° HDT Bedrest Facility)
// ---------------------------------------------------------------------------

function drawLabAnalogScene(ctx, width, height, t, duration, clipData, seed, normTime) {
  // Background: Clean Terrestrial Analog Laboratory Room
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, "#0c1322");
  bgGrad.addColorStop(0.5, "#080c16");
  bgGrad.addColorStop(1, "#03060c");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Subtle Clinical Wall Architecture Lines & Calibration Grid
  ctx.save();
  ctx.strokeStyle = "rgba(245, 158, 11, 0.08)";
  ctx.lineWidth = 1;
  for (let x = 60; x < width; x += 120) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 60; y < height; y += 90) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();

  // Draw Head-Down Tilt (-6° Incline) Bed Structure
  ctx.save();
  const bedCenterX = width * 0.48;
  const bedCenterY = height * 0.52;
  const tiltAngle = -0.105; // ~-6 degrees in radians

  ctx.translate(bedCenterX, bedCenterY);
  ctx.rotate(tiltAngle);

  // Bed Base & Frame
  ctx.fillStyle = "#1e293b";
  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(-240, -15, 480, 30, 8);
  ctx.fill();
  ctx.stroke();

  // Head Cushion & Foot Rest
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(-230, -35, 80, 20); // Head rest (lower end due to -6° tilt)
  ctx.fillRect(210, -35, 20, 20);  // Foot brace

  // Analog Subject Resting Silhouette
  ctx.fillStyle = "#09101d";
  ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  // Head
  ctx.arc(-180, -35, 22, 0, Math.PI * 2);
  // Torso
  ctx.roundRect(-155, -42, 170, 28, 6);
  // Legs
  ctx.roundRect(15, -40, 190, 22, 4);
  ctx.fill();
  ctx.stroke();

  // Hydrostatic Fluid Shift Dynamic Vectors (Flowing toward Cranial/Head End: Right -> Left)
  const fluidPhase = (t * 80) % 360;
  for (let i = 0; i < 8; i++) {
    const fx = 180 - ((fluidPhase + i * 45) % 360);
    const fy = -28 + Math.sin(t * 3 + i) * 4;
    ctx.fillStyle = "rgba(6, 182, 212, 0.85)";
    ctx.beginPath();
    ctx.arc(fx, fy, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  // Incline Angle Protractor Indicator (Left Center)
  ctx.save();
  const protX = width * 0.16;
  const protY = height * 0.42;

  ctx.strokeStyle = "rgba(245, 158, 11, 0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(protX, protY, 55, -Math.PI * 0.15, Math.PI * 0.15);
  ctx.stroke();

  // Horizontal Baseline
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.beginPath();
  ctx.moveTo(protX - 40, protY);
  ctx.lineTo(protX + 70, protY);
  ctx.stroke();

  // -6° Tilt Ray
  ctx.setLineDash([]);
  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(protX, protY);
  ctx.lineTo(protX + 68 * Math.cos(tiltAngle), protY + 68 * Math.sin(tiltAngle));
  ctx.stroke();

  ctx.fillStyle = "#f59e0b";
  ctx.font = "700 13px monospace";
  ctx.fillText("-6.0° HDT TILT", protX + 15, protY - 14);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "500 11px system-ui";
  ctx.fillText("Analog Hydrostatic Angle", protX + 15, protY + 28);
  ctx.restore();

  // Research Observer Desk / Monitor (Right Foreground)
  ctx.save();
  const deskX = width * 0.82;
  const deskY = height * 0.65;

  // Station Screen
  ctx.fillStyle = "#0f172a";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(deskX - 80, deskY - 120, 160, 110, 8);
  ctx.fill();
  ctx.stroke();

  // Screen graph
  ctx.strokeStyle = "#06b6d4";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x < 140; x += 10) {
    const gx = deskX - 70 + x;
    const gy = deskY - 70 + Math.sin((x + t * 40) * 0.08) * 18;
    if (x === 0) ctx.moveTo(gx, gy);
    else ctx.lineTo(gx, gy);
  }
  ctx.stroke();

  ctx.fillStyle = "#38bdf8";
  ctx.font = "700 10px monospace";
  ctx.fillText("FLUID REDISTRIBUTION", deskX - 70, deskY - 100);

  // Scientist Silhouette
  ctx.fillStyle = "#09101d";
  ctx.beginPath();
  ctx.arc(deskX - 95, deskY - 50, 18, 0, Math.PI * 2);
  ctx.roundRect(deskX - 125, deskY - 30, 60, 90, 8);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 2. Ocular Imaging Scene (High-Resolution OCT & Retinal Stratification)
// ---------------------------------------------------------------------------

function drawOcularImagingScene(ctx, width, height, t, duration, clipData, seed, normTime) {
  // Background: Deep Diagnostic Indigo
  const bgGrad = ctx.createRadialGradient(width * 0.5, height * 0.5, 40, width * 0.5, height * 0.5, width * 0.7);
  bgGrad.addColorStop(0, "#0e152e");
  bgGrad.addColorStop(0.6, "#080c1c");
  bgGrad.addColorStop(1, "#03050c");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Anatomical Retinal Cross-Section Layers (Stratification)
  const layerStartY = height * 0.28;
  const layers = [
    { name: "ILM / Nerve Fiber Layer (NFL)", color: "rgba(56, 189, 248, 0.4)", h: 28 },
    { name: "Ganglion Cell Layer (GCL)", color: "rgba(6, 182, 212, 0.35)", h: 36 },
    { name: "Inner Plexiform Layer (IPL)", color: "rgba(99, 102, 241, 0.3)", h: 42 },
    { name: "Outer Nuclear Layer (ONL)", color: "rgba(168, 85, 247, 0.35)", h: 48 },
    { name: "Retinal Pigment Epithelium (RPE)", color: "rgba(244, 63, 94, 0.4)", h: 32 },
    { name: "Choroid Microvasculature", color: "rgba(245, 158, 11, 0.35)", h: 54 },
  ];

  ctx.save();
  let currentY = layerStartY;

  layers.forEach((layer, idx) => {
    ctx.fillStyle = layer.color;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(120, currentY);

    // Add organic biological waviness to retinal bands
    for (let x = 120; x <= width - 120; x += 30) {
      const wave = Math.sin((x + idx * 45 + t * 20) * 0.015) * 4;
      ctx.lineTo(x, currentY + wave);
    }
    ctx.lineTo(width - 120, currentY + layer.h);
    for (let x = width - 120; x >= 120; x -= 30) {
      const wave = Math.sin((x + idx * 45 + t * 20) * 0.015) * 4;
      ctx.lineTo(x, currentY + layer.h + wave);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Layer Label
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "600 11px system-ui";
    ctx.fillText(layer.name, 135, currentY + layer.h * 0.65);

    currentY += layer.h + 4;
  });
  ctx.restore();

  // Active OCT Laser Scanner Sweep Beam (Sweeps Horizontally Across Retina)
  ctx.save();
  const scanSweepX = 140 + ((t * 180) % (width - 280));

  const beamGrad = ctx.createLinearGradient(scanSweepX - 25, 0, scanSweepX + 25, 0);
  beamGrad.addColorStop(0, "rgba(6, 182, 212, 0)");
  beamGrad.addColorStop(0.5, "rgba(6, 182, 212, 0.65)");
  beamGrad.addColorStop(1, "rgba(6, 182, 212, 0)");

  ctx.fillStyle = beamGrad;
  ctx.fillRect(scanSweepX - 25, layerStartY - 20, 50, currentY - layerStartY + 30);

  // Vertical Laser Line
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2.5;
  ctx.shadowColor = "#06b6d4";
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(scanSweepX, layerStartY - 30);
  ctx.lineTo(scanSweepX, currentY + 15);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Diagnostic Reticle at Intersection
  ctx.strokeStyle = "#f43f5e";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(scanSweepX, layerStartY + 90, 14, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Microvascular Tight Junction Points (Claudin-5 / VEGF-A Markers)
  ctx.save();
  for (let k = 0; k < 14; k++) {
    const px = 180 + (k * 65) + Math.sin(t * 2 + k) * 6;
    const py = layerStartY + 160 + Math.cos(t * 1.5 + k) * 12;
    ctx.fillStyle = k % 2 === 0 ? "#34d399" : "#fb7185";
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.beginPath();
    ctx.arc(px, py, 8 + Math.sin(t * 4 + k) * 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 3. Omics Translation Scene (Space Biology Wet-Lab & Benchtop Omics Integration)
// ---------------------------------------------------------------------------

function drawOmicsTranslationScene(ctx, width, height, t, duration, clipData, seed, normTime) {
  // Background: Deep Slate & Bioluminescent Emerald
  const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
  bgGrad.addColorStop(0, "#08141e");
  bgGrad.addColorStop(0.5, "#060d15");
  bgGrad.addColorStop(1, "#03060a");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Wet-Lab Benchtop Surface
  ctx.save();
  const benchY = height * 0.48;
  ctx.fillStyle = "#0c1824";
  ctx.strokeStyle = "rgba(16, 185, 129, 0.25)";
  ctx.lineWidth = 2;
  ctx.fillRect(60, benchY, width - 120, height * 0.44);
  ctx.strokeRect(60, benchY, width - 120, height * 0.44);

  // Dual Cross-Assay Channels: Upper RNA-seq vs Lower Mass Spec
  // Upper Channel: RNA-seq Transcript Wave
  ctx.fillStyle = "rgba(56, 189, 248, 0.12)";
  ctx.fillRect(90, benchY + 20, width - 180, 80);
  ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
  ctx.strokeRect(90, benchY + 20, width - 180, 80);

  ctx.fillStyle = "#38bdf8";
  ctx.font = "700 12px monospace";
  ctx.fillText("ASSAY 1: RNA-seq Transcriptomics (Gene Expression Peaks)", 105, benchY + 40);

  // RNA Peak graph
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  const rnaPoints = [];
  for (let x = 110; x < width - 110; x += 15) {
    const rx = x;
    const ry = benchY + 80 - Math.abs(Math.sin((x * 0.03) + t * 2)) * 40;
    rnaPoints.push({ x: rx, y: ry });
    if (x === 110) ctx.moveTo(rx, ry);
    else ctx.lineTo(rx, ry);
  }
  ctx.stroke();

  // Lower Channel: Mass Spectrometry / Metabolomics Peaks
  ctx.fillStyle = "rgba(16, 185, 129, 0.12)";
  ctx.fillRect(90, benchY + 130, width - 180, 80);
  ctx.strokeStyle = "rgba(16, 185, 129, 0.4)";
  ctx.strokeRect(90, benchY + 130, width - 180, 80);

  ctx.fillStyle = "#34d399";
  ctx.font = "700 12px monospace";
  ctx.fillText("ASSAY 2: LC-MS/MS Proteomics / Metabolomics (Abundance Spectrum)", 105, benchY + 150);

  // Mass Spec Peaks
  ctx.strokeStyle = "#10b981";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  const msPoints = [];
  for (let x = 110; x < width - 110; x += 15) {
    const mx = x;
    const my = benchY + 195 - Math.abs(Math.cos((x * 0.035) + t * 2.5)) * 42;
    msPoints.push({ x: mx, y: my });
    if (x === 110) ctx.moveTo(mx, my);
    else ctx.lineTo(mx, my);
  }
  ctx.stroke();

  // Dynamic Cross-Omics Correlation Connecting Bridges (Gene ➔ Metabolite)
  for (let i = 0; i < 7; i++) {
    const idx = 4 + i * 8;
    if (rnaPoints[idx] && msPoints[idx]) {
      ctx.strokeStyle = "rgba(168, 85, 247, 0.75)";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(rnaPoints[idx].x, rnaPoints[idx].y);
      ctx.lineTo(msPoints[idx].x, msPoints[idx].y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Flow particle along bridge
      const pRatio = (t * 1.5 + i * 0.2) % 1.0;
      const px = rnaPoints[idx].x;
      const py = rnaPoints[idx].y + (msPoints[idx].y - rnaPoints[idx].y) * pRatio;
      ctx.fillStyle = "#c084fc";
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();

  // Benchtop Micropipetting Station & Sample Flow Well (Top Center)
  ctx.save();
  const pipeX = width * 0.5 + Math.sin(t * 1.2) * 120;
  const pipeY = height * 0.24;

  ctx.fillStyle = "#334155";
  ctx.strokeStyle = "#06b6d4";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(pipeX - 10, pipeY - 80, 20, 90, 4);
  ctx.fill();
  ctx.stroke();

  // Pipette tip dispensing drop
  const dropY = pipeY + 10 + ((t * 40) % 28);
  ctx.fillStyle = "#38bdf8";
  ctx.beginPath();
  ctx.arc(pipeX, dropY, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 4. Mission Monitoring Scene (Translational Astronaut-Health Concept)
// ---------------------------------------------------------------------------

function drawMissionMonitoringScene(ctx, width, height, t, duration, clipData, seed, normTime) {
  // Background: Spaceflight Habitat Interior
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, "#081022");
  bgGrad.addColorStop(0.5, "#060b17");
  bgGrad.addColorStop(1, "#02050b");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Habitat Structural Ribs
  ctx.save();
  ctx.strokeStyle = "rgba(56, 189, 248, 0.1)";
  ctx.lineWidth = 2;
  for (let x = 100; x < width; x += 180) {
    ctx.beginPath();
    ctx.ellipse(x, height * 0.48, 80, 240, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // Ergonomic Astronaut Exercise Silhouette (Center-Left)
  ctx.save();
  const astroX = width * 0.38 + Math.sin(t * 1.5) * 5;
  const astroY = height * 0.52;

  // Resistance Exercise Frame
  ctx.strokeStyle = "#475569";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(astroX - 120, astroY + 120);
  ctx.lineTo(astroX - 40, astroY - 100);
  ctx.lineTo(astroX + 120, astroY + 120);
  ctx.stroke();

  // Astronaut Silhouette
  ctx.fillStyle = "#0f172a";
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2;

  // Head
  ctx.beginPath();
  ctx.arc(astroX, astroY - 70, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Body & Torso
  ctx.beginPath();
  ctx.roundRect(astroX - 25, astroY - 45, 50, 80, 10);
  ctx.fill();
  ctx.stroke();

  // Arms gripping countermeasure resistance bar
  ctx.beginPath();
  ctx.moveTo(astroX - 25, astroY - 30);
  ctx.lineTo(astroX - 60, astroY - 70 + Math.sin(t * 3) * 12);
  ctx.moveTo(astroX + 25, astroY - 30);
  ctx.lineTo(astroX + 60, astroY - 70 + Math.sin(t * 3) * 12);
  ctx.stroke();

  ctx.restore();

  // Crew Physiological Resilience Wave Monitor (Right Side)
  ctx.save();
  const monitorX = width * 0.72;
  const monitorY = height * 0.45;

  ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
  ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(monitorX - 180, monitorY - 140, 360, 260, 12);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#38bdf8";
  ctx.font = "700 13px system-ui";
  ctx.fillText("PHYSIOLOGICAL ADAPTATION & RESILIENCE", monitorX - 160, monitorY - 110);

  // Sinusoidal Cardiac / Muscular Wave
  ctx.strokeStyle = "#10b981";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let x = 0; x < 320; x += 8) {
    const px = monitorX - 160 + x;
    const py = monitorY - 40 + Math.sin((x + t * 70) * 0.05) * 25 + Math.sin((x + t * 40) * 0.12) * 10;
    if (x === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Physiological Recovery Meter
  ctx.fillStyle = "#94a3b8";
  ctx.font = "600 11px monospace";
  ctx.fillText("PHYSIOLOGICAL RECOVERY FLUX", monitorX - 160, monitorY + 30);

  ctx.fillStyle = "#1e293b";
  ctx.fillRect(monitorX - 160, monitorY + 45, 320, 16);
  ctx.fillStyle = "#34d399";
  ctx.fillRect(monitorX - 160, monitorY + 45, 280 + Math.sin(t * 2) * 15, 16);

  ctx.fillStyle = "#f8fafc";
  ctx.font = "700 11px monospace";
  ctx.fillText("COUNTERMEASURE LOAD: ADAPTIVE", monitorX - 160, monitorY + 95);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 5. Operational Relevance Scene (Side-by-Side Split Screen Framing)
// ---------------------------------------------------------------------------

function drawOperationalRelevanceScene(ctx, width, height, t, duration, clipData, seed, normTime) {
  // Balanced Dual-Zone Canvas (Terrestrial Amber Control vs Spaceflight Indigo)
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, "#0b0f19");
  bgGrad.addColorStop(0.5, "#0f172a");
  bgGrad.addColorStop(1, "#1e1b4b");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  const midX = width / 2;

  // Split Divider
  ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(midX, 40);
  ctx.lineTo(midX, height - 70);
  ctx.stroke();
  ctx.setLineDash([]);

  // LEFT PANEL: 1G Ground Baseline Control
  ctx.save();
  ctx.fillStyle = "#f59e0b";
  ctx.font = "800 13px system-ui";
  ctx.fillText("1G TERRESTRIAL BASELINE / GROUND CONTROL", 60, 65);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "500 12px system-ui";
  ctx.fillText("Normal Gravitational Vector & Tissue Homeostasis", 60, 88);

  // Normal baseline diagram
  ctx.fillStyle = "#1e1b18";
  ctx.strokeStyle = "rgba(245, 158, 11, 0.4)";
  ctx.lineWidth = 1.5;
  ctx.roundRect(60, 115, midX - 120, height * 0.58, 10);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#fde68a";
  ctx.font = "700 11px monospace";
  ctx.fillText("● Baseline Perfusion: 100%", 85, 150);
  ctx.fillText("● Structural Tissue Tone: Reference", 85, 180);
  ctx.fillText("● Tissue Boundary Layer: Intact", 85, 210);

  // Calm baseline wave
  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x < midX - 160; x += 10) {
    const bx = 85 + x;
    const by = height * 0.52 + Math.sin(x * 0.05 + t * 2) * 12;
    if (x === 0) ctx.moveTo(bx, by);
    else ctx.lineTo(bx, by);
  }
  ctx.stroke();
  ctx.restore();

  // RIGHT PANEL: Spaceflight Exposure / Analog Response
  ctx.save();
  ctx.fillStyle = "#38bdf8";
  ctx.font = "800 13px system-ui";
  ctx.fillText("SPACEFLIGHT EXPOSURE / ANALOG DATA", midX + 60, 65);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "500 12px system-ui";
  ctx.fillText("Cephalad Fluid Shift & Anatomical Adaptation", midX + 60, 88);

  // Flight response diagram
  ctx.fillStyle = "#0f172a";
  ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
  ctx.lineWidth = 1.5;
  ctx.roundRect(midX + 60, 115, midX - 120, height * 0.58, 10);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#bae6fd";
  ctx.font = "700 11px monospace";
  ctx.fillText("▲ Cephalad Fluid Delta: Elevated", midX + 85, 150);
  ctx.fillText("▼ Biomechanical Tissue Tone: Shifted", midX + 85, 180);
  ctx.fillText("✦ Countermeasure Target Lock: Active", midX + 85, 210);

  // Dynamic stressed wave
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x < midX - 160; x += 10) {
    const fx = midX + 85 + x;
    const fy = height * 0.52 + Math.sin(x * 0.08 + t * 4) * 22;
    if (x === 0) ctx.moveTo(fx, fy);
    else ctx.lineTo(fx, fy);
  }
  ctx.stroke();
  ctx.restore();
}
