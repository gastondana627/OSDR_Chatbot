import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Info,
  Layers,
  ShieldAlert,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  DETECTOR_COLORS,
  buildLeoDemoDataset,
  evaluateLeoCsvText,
  generateLeoSvgSnapshot,
  getLeoProvenanceBadgeText,
  serializeDemoRowsToCsv,
  serializeDiscrepanciesToCsv,
  validateLeoEvalJson,
} from "../../utils/leoDosimetry.js";

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function fmtSignedMin(val) {
  if (val === null || val === undefined || !Number.isFinite(val)) return "N/A";
  const sign = val > 0 ? "+" : "";
  return `${sign}${val.toFixed(2)}m`;
}

const LAYER_CONFIG = [
  { key: "human", label: "Human Labels", short: "Human", color: DETECTOR_COLORS.human },
  { key: "hybrid", label: "Hybrid Arm & Confirm", short: "Hybrid", color: DETECTOR_COLORS.hybrid },
  { key: "model_b", label: "Model B (Sensor+B/L)", short: "Model B", color: DETECTOR_COLORS.model_b },
  { key: "model_a", label: "Model A (Sensor)", short: "Model A", color: DETECTOR_COLORS.model_a },
  { key: "nasa_flag", label: "NASA Flag", short: "NASA Flag", color: DETECTOR_COLORS.nasa_flag },
];

export default function LeoDosimetryExplorer({ onBackToChat }) {
  const fileInputId = useId();
  const passSelectId = useId();
  const scrubberId = useId();
  const demoDataset = useMemo(() => buildLeoDemoDataset(), []);

  const [dataset, setDataset] = useState(demoDataset);
  const [rule, setRule] = useState("hysteresis");
  const [selectedPassId, setSelectedPassId] = useState(
    () => demoDataset.rules.hysteresis.passes[0]?.pass_id || "PASS_01"
  );
  const [visibleLayers, setVisibleLayers] = useState(
    () => new Set(["human", "hybrid", "model_b", "model_a", "nasa_flag"])
  );
  const [scrubIdx, setScrubIdx] = useState(18);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [statusAnnouncement, setStatusAnnouncement] = useState("");
  const scrubberRef = useRef(null);

  const ruleData = dataset.rules[rule] || dataset.rules.hysteresis;
  const activePass = useMemo(
    () =>
      ruleData.passes.find((p) => p.pass_id === selectedPassId) ||
      ruleData.passes[0],
    [ruleData, selectedPassId]
  );

  const trace = useMemo(
    () => (activePass ? dataset.pass_traces[activePass.pass_id] || [] : []),
    [dataset, activePass]
  );

  const clampedScrubIdx = Math.min(Math.max(0, scrubIdx), Math.max(0, trace.length - 1));
  const activeSample = trace[clampedScrubIdx] || null;

  useEffect(() => {
    const prevTitle = document.title;
    document.title = "LEO Dosimetry · SAA/GCR Separation & Pass-Audit | OSDR ChatBot";
    return () => {
      document.title = prevTitle;
    };
  }, []);

  // Keep scrubber progress CSS variable updated for fallback browsers without accent-color
  useEffect(() => {
    if (!scrubberRef.current || trace.length <= 1) return;
    const pct = (clampedScrubIdx / (trace.length - 1)) * 100;
    scrubberRef.current.style.setProperty("--progress", `${pct.toFixed(1)}%`);
  }, [clampedScrubIdx, trace.length]);

  const toggleLayer = (layerKey) => {
    setVisibleLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layerKey)) next.delete(layerKey);
      else next.add(layerKey);
      return next;
    });
  };

  const handleSelectPass = (pid, announceLabel) => {
    setSelectedPassId(pid);
    const nextTrace = dataset.pass_traces[pid] || [];
    // Default scrubber to the peak flux sample in the selected pass
    if (nextTrace.length > 0) {
      let bestIdx = 0;
      let bestFlux = -Infinity;
      for (let i = 0; i < nextTrace.length; i += 1) {
        if (nextTrace[i].flux > bestFlux) {
          bestFlux = nextTrace[i].flux;
          bestIdx = i;
        }
      }
      setScrubIdx(bestIdx);
    } else {
      setScrubIdx(0);
    }
    if (announceLabel) {
      setStatusAnnouncement(announceLabel);
    }
  };

  const handleJumpFlagged = () => {
    const flagged = ruleData.discrepancies;
    if (!flagged.length) return;
    const curIdx = flagged.findIndex((d) => d.pass_id === activePass?.pass_id);
    const nextItem = flagged[(curIdx + 1) % flagged.length];
    handleSelectPass(
      nextItem.pass_id,
      `Jumped to flagged discrepancy pass ${nextItem.pass_id}: ${nextItem.summary}.`
    );
  };

  const processUploadedFile = async (file) => {
    if (!file) return;
    setUploadError("");
    try {
      const text = await file.text();
      const lower = file.name.toLowerCase();
      let parsed;
      if (lower.endsWith(".json") || text.trim().startsWith("{")) {
        parsed = validateLeoEvalJson(JSON.parse(text), file.name);
      } else {
        parsed = evaluateLeoCsvText(text, {
          filename: file.name,
          bootstrapResamples: 1000,
          seed: 42,
        });
      }
      setDataset(parsed);
      const firstPid = parsed.rules[rule]?.passes?.[0]?.pass_id || parsed.rules.hysteresis.passes[0]?.pass_id;
      if (firstPid) {
        setSelectedPassId(firstPid);
        setScrubIdx(16);
      }
      setStatusAnnouncement(
        `Loaded ${parsed.summary.total_passes} orbital passes (${parsed.summary.total_samples} rows) from ${file.name}.`
      );
    } catch (err) {
      setUploadError(
        err instanceof Error
          ? err.message
          : "Could not parse uploaded file. Provide a leo_saa_eval.py JSON or LEO pass CSV/TSV."
      );
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) processUploadedFile(file);
  };

  const handleExportSvg = () => {
    const svgText = generateLeoSvgSnapshot(dataset, {
      rule,
      passId: activePass?.pass_id,
      visibleLayers: Array.from(visibleLayers),
    });
    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    downloadBlob(blob, `leo-dosimetry-${activePass?.pass_id || "pass"}-${rule}.svg`);
    setStatusAnnouncement("Exported publication vector SVG snapshot.");
  };

  const handleExportPng = () => {
    const svgText = generateLeoSvgSnapshot(dataset, {
      rule,
      passId: activePass?.pass_id,
      visibleLayers: Array.from(visibleLayers),
    });
    const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1680;
      canvas.height = 1050;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#080d17";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((pngBlob) => {
          if (pngBlob) {
            downloadBlob(pngBlob, `leo-dosimetry-${activePass?.pass_id || "pass"}-${rule}.png`);
            setStatusAnnouncement("Exported publication high-DPI PNG snapshot.");
          }
          URL.revokeObjectURL(url);
        }, "image/png");
      } else {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const handleDownloadSampleCsv = () => {
    const csv = serializeDemoRowsToCsv();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, "leo_saa_gcr_demo_passes.csv");
    setStatusAnnouncement("Downloaded illustrative 12-pass synthetic LEO CSV template.");
  };

  const handleExportDiscrepanciesCsv = () => {
    const csv = serializeDiscrepanciesToCsv(ruleData.discrepancies, ruleData.passes);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `leo-dosimetry-discrepancies-${rule}.csv`);
    setStatusAnnouncement(
      `Exported ${ruleData.discrepancies.length} flagged orbital pass discrepancies as CSV.`
    );
  };

  // Interactive SVG geometry
  const svgW = 760;
  const svgH = 342;
  const padL = 74;
  const padR = 18;
  const padT = 18;
  const fluxH = 178;
  const plotW = svgW - padL - padR;

  const tStart = trace.length ? trace[0].time_min : 0;
  const tEnd = trace.length ? trace[trace.length - 1].time_min : 20;
  const tSpan = Math.max(tEnd - tStart, 1);
  const maxFlux = Math.max(10, ...trace.map((pt) => pt.flux)) * 1.12;

  const mapX = (t) => padL + ((t - tStart) / tSpan) * plotW;
  const mapY = (f) => padT + fluxH - (f / maxFlux) * fluxH;

  const fluxLine = trace
    .map((pt) => `${mapX(pt.time_min).toFixed(1)},${mapY(pt.flux).toFixed(1)}`)
    .join(" ");
  const fluxArea =
    trace.length > 1
      ? `${mapX(trace[0].time_min).toFixed(1)},${(padT + fluxH).toFixed(1)} ${fluxLine} ${mapX(trace[trace.length - 1].time_min).toFixed(1)},${(padT + fluxH).toFixed(1)}`
      : "";

  const handleSvgPointer = (e) => {
    if (!trace.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const svgX = ((e.clientX - rect.left) / rect.width) * svgW;
    const frac = Math.min(1, Math.max(0, (svgX - padL) / plotW));
    const idx = Math.round(frac * (trace.length - 1));
    setScrubIdx(idx);
  };

  const badgeText = getLeoProvenanceBadgeText(dataset);
  const highDiscrepancyCount = ruleData.discrepancies.filter((d) => d.severity === "high").length;

  return (
    <div className="leo-page" data-testid="leo-dosimetry-workspace">
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {statusAnnouncement}
      </div>

      {/* Compact Workspace Header */}
      <header className="leo-header">
        <div className="leo-header-main">
          <div className="leo-top-row">
            <button
              type="button"
              className="brain-back-link"
              onClick={onBackToChat}
              data-testid="leo-back-to-chat"
            >
              <ArrowLeft size={14} aria-hidden="true" />
              <span>OSDR ChatBot Q&amp;A</span>
            </button>
            <span className="leo-scope-pill">
              <Activity size={12} aria-hidden="true" />
              <span>AWG Thread #3665 · Pass-Level ML Eval</span>
            </span>
          </div>
          <h1 className="leo-title">LEO Dosimetry · SAA/GCR Separation &amp; Pass-Audit Explorer</h1>
          <p className="leo-subtitle">
            Frozen orbital pass-level evaluation (bootstrap 95% CIs, Merge vs. Hysteresis, Hybrid Arm-and-Confirm trigger, and automated human-label discrepancy auditing).
          </p>
        </div>

        <div className="leo-header-actions">
          <button
            type="button"
            className="brain-action-btn is-primary"
            onClick={handleExportPng}
            data-testid="leo-export-png"
          >
            <Download size={14} aria-hidden="true" />
            <span>Export PNG</span>
          </button>
          <button
            type="button"
            className="brain-action-btn"
            onClick={handleExportSvg}
            data-testid="leo-export-svg"
          >
            <Download size={14} aria-hidden="true" />
            <span>Export SVG</span>
          </button>
          {!dataset.isIllustrativeDemo && (
            <button
              type="button"
              className="brain-action-btn"
              onClick={() => {
                setDataset(demoDataset);
                setSelectedPassId(demoDataset.rules[rule].passes[0]?.pass_id || "PASS_01");
                setUploadError("");
                setStatusAnnouncement("Restored illustrative 12-pass synthetic LEO demo.");
              }}
              data-testid="leo-reset-demo"
            >
              <Sparkles size={14} aria-hidden="true" />
              <span>Restore Demo</span>
            </button>
          )}
        </div>
      </header>

      {/* Provenance Banner */}
      <div
        className={`brain-provenance-banner ${dataset.isIllustrativeDemo ? "is-demo" : "is-user"}`}
        data-testid="leo-provenance-banner"
      >
        <Info size={15} aria-hidden="true" className="brain-provenance-icon" />
        <div className="brain-provenance-copy">
          <div className="brain-provenance-headline">
            <span className="brain-provenance-pill" data-testid="leo-provenance-pill">
              {badgeText}
            </span>
            {!dataset.isIllustrativeDemo && (
              <strong className="brain-provenance-dataset">
                {dataset.provenance?.dataset_label}
              </strong>
            )}
          </div>
          <span>{dataset.provenance?.note}</span>
        </div>
      </div>

      {/* Primary Above-the-Fold Grid: Interactive Pass Timeline + Scoreboard & Discrepancy Audit Rail */}
      <div className="leo-grid">
        {/* Left: Interactive Pass Timeline Scrubber */}
        <section className="leo-stage-card" aria-labelledby="leo-timeline-heading">
          <div className="leo-stage-toolbar">
            <div className="leo-stage-title-group">
              <h2 id="leo-timeline-heading" className="brain-card-heading">
                Pass Timeline: <code>{activePass?.pass_id}</code>
              </h2>
              {activePass?.discrepancy_code && (
                <span className={`leo-flag-chip is-${activePass.discrepancy_severity}`}>
                  <AlertTriangle size={12} aria-hidden="true" />
                  <span>{activePass.discrepancy_code.replace(/_/g, " ")}</span>
                </span>
              )}
            </div>

            <div className="leo-controls-row">
              <div className="leo-rule-switch" role="group" aria-label="Boundary segmentation rule">
                <button
                  type="button"
                  className={`leo-rule-btn ${rule === "hysteresis" ? "is-active" : ""}`}
                  aria-pressed={rule === "hysteresis"}
                  onClick={() => {
                    setRule("hysteresis");
                    setStatusAnnouncement("Switched boundary rule to Hysteresis (enter 0.65 / exit 0.35).");
                  }}
                  data-testid="leo-rule-hysteresis"
                >
                  Hysteresis
                </button>
                <button
                  type="button"
                  className={`leo-rule-btn ${rule === "merge" ? "is-active" : ""}`}
                  aria-pressed={rule === "merge"}
                  onClick={() => {
                    setRule("merge");
                    setStatusAnnouncement("Switched boundary rule to Merge (threshold 0.50, 2.0m gap).");
                  }}
                  data-testid="leo-rule-merge"
                >
                  Merge
                </button>
              </div>

              <label htmlFor={passSelectId} className="leo-select-wrap">
                <span className="visually-hidden">Select orbital pass</span>
                <select
                  id={passSelectId}
                  className="leo-pass-select"
                  value={activePass?.pass_id || ""}
                  onChange={(e) => handleSelectPass(e.target.value, `Inspecting orbital pass ${e.target.value}.`)}
                  data-testid="leo-pass-select"
                >
                  {ruleData.passes.map((p) => (
                    <option key={p.pass_id} value={p.pass_id}>
                      {p.pass_id} {p.discrepancy_severity === "high" ? "⚠ MISSED LABEL" : p.discrepancy_severity === "medium" ? "△ BOUNDARY" : p.discrepancy_severity === "low" ? "· NASA FA" : p.has_human_saa ? "· SAA" : "· GCR"}
                    </option>
                  ))}
                </select>
              </label>

              {ruleData.discrepancies.length > 0 && (
                <button
                  type="button"
                  className="leo-jump-btn"
                  onClick={handleJumpFlagged}
                  data-testid="leo-jump-discrepancy"
                >
                  <ShieldAlert size={13} aria-hidden="true" />
                  <span>Flagged ({ruleData.discrepancies.length})</span>
                </button>
              )}
            </div>
          </div>

          {/* Layer Visibility Toggles */}
          <div className="leo-layer-bar" role="group" aria-label="Toggle detector overlay spans">
            <span className="leo-layer-label">
              <Layers size={12} aria-hidden="true" />
              <span>Spans:</span>
            </span>
            {LAYER_CONFIG.map((layer) => {
              const on = visibleLayers.has(layer.key);
              return (
                <button
                  key={layer.key}
                  type="button"
                  className={`leo-layer-pill ${on ? "is-on" : ""}`}
                  aria-pressed={on}
                  onClick={() => toggleLayer(layer.key)}
                  data-testid={`leo-layer-${layer.key}`}
                >
                  <span className="brain-swatch" style={{ background: layer.color }} aria-hidden="true" />
                  <span>{layer.short}</span>
                </button>
              );
            })}
          </div>

          {/* Live Entry/Exit Lag Comparison Strip */}
          <div className="leo-lag-strip" data-testid="leo-lag-strip">
            <span>
              <strong>Hybrid Entry:</strong>{" "}
              <em className="is-good">{fmtSignedMin(activePass?.metrics?.hybrid_entry_lag_min)}</em>
            </span>
            <span>
              <strong>Hybrid Exit:</strong>{" "}
              <em className="is-good">{fmtSignedMin(activePass?.metrics?.hybrid_exit_lag_min)}</em>
            </span>
            <span>
              <strong>NASA Entry:</strong>{" "}
              <em>{fmtSignedMin(activePass?.metrics?.nasa_entry_lag_min)}</em>
            </span>
            <span>
              <strong>NASA Exit Tail:</strong>{" "}
              <em className="is-warn">{fmtSignedMin(activePass?.metrics?.nasa_exit_lag_min)}</em>
            </span>
            <span>
              <strong>Peak Flux:</strong>{" "}
              <em>{Number(activePass?.peak_flux || 0).toFixed(1)}</em>
            </span>
          </div>

          {/* Interactive Vector SVG Pass Timeline */}
          <figure className="leo-chart-figure">
            <div className="leo-svg-wrap">
              <svg
                viewBox={`0 0 ${svgW} ${svgH}`}
                className="leo-timeline-svg"
                role="img"
                aria-label={`Orbital pass ${activePass?.pass_id} radiation flux curve and detector spans under ${rule} rule`}
                onPointerMove={(e) => {
                  if (e.buttons === 1) handleSvgPointer(e);
                }}
                onClick={handleSvgPointer}
                data-testid="leo-timeline-svg"
              >
                <rect x={padL} y={padT} width={plotW} height={fluxH} rx="6" fill="#060a12" stroke="#1e293b" />

                {/* Horizontal Flux Gridlines */}
                {[0.25, 0.5, 0.75, 1.0].map((frac) => {
                  const y = padT + fluxH * (1 - frac);
                  const val = maxFlux * frac;
                  return (
                    <g key={frac}>
                      <line
                        x1={padL}
                        y1={y}
                        x2={padL + plotW}
                        y2={y}
                        stroke="#1e293b"
                        strokeDasharray="3 4"
                      />
                      <text x={padL - 8} y={y + 4} fill="#64748b" fontSize="10" textAnchor="end">
                        {val.toFixed(0)}
                      </text>
                    </g>
                  );
                })}

                {/* Shaded Spans on Flux Plot */}
                {visibleLayers.has("nasa_flag") &&
                  (activePass?.events?.nasa_flag || []).map((ev, i) => (
                    <rect
                      key={`s-nasa-${i}`}
                      x={mapX(ev.start)}
                      y={padT}
                      width={Math.max(2, mapX(ev.end) - mapX(ev.start))}
                      height={fluxH}
                      fill={DETECTOR_COLORS.nasa_flag}
                      fillOpacity="0.08"
                    />
                  ))}
                {visibleLayers.has("human") &&
                  (activePass?.events?.human || []).map((ev, i) => (
                    <rect
                      key={`s-human-${i}`}
                      x={mapX(ev.start)}
                      y={padT}
                      width={Math.max(2, mapX(ev.end) - mapX(ev.start))}
                      height={fluxH}
                      fill={DETECTOR_COLORS.human}
                      fillOpacity="0.12"
                    />
                  ))}
                {visibleLayers.has("hybrid") &&
                  (activePass?.events?.hybrid || []).map((ev, i) => (
                    <g key={`s-hyb-${i}`}>
                      {/* Early ARMED pre-alert window before Model B confirms */}
                      {ev.confirm_start > ev.armed_start && (
                        <rect
                          x={mapX(ev.armed_start)}
                          y={padT}
                          width={Math.max(2, mapX(ev.confirm_start) - mapX(ev.armed_start))}
                          height={fluxH}
                          fill="#fbbf24"
                          fillOpacity="0.22"
                        />
                      )}
                      <rect
                        x={mapX(ev.confirm_start ?? ev.start)}
                        y={padT}
                        width={Math.max(2, mapX(ev.end) - mapX(ev.confirm_start ?? ev.start))}
                        height={fluxH}
                        fill={DETECTOR_COLORS.hybrid}
                        fillOpacity="0.16"
                      />
                      {/* Entry & Exit vertical lines */}
                      <line
                        x1={mapX(ev.start)}
                        y1={padT}
                        x2={mapX(ev.start)}
                        y2={padT + fluxH}
                        stroke={DETECTOR_COLORS.hybrid}
                        strokeWidth="1.5"
                        strokeDasharray="4 2"
                      />
                      <line
                        x1={mapX(ev.end)}
                        y1={padT}
                        x2={mapX(ev.end)}
                        y2={padT + fluxH}
                        stroke={DETECTOR_COLORS.hybrid}
                        strokeWidth="1.5"
                      />
                    </g>
                  ))}

                {/* Raw Flux Area & Curve */}
                {fluxArea && <polygon points={fluxArea} fill="#38bdf8" fillOpacity="0.15" />}
                {fluxLine && (
                  <polyline
                    points={fluxLine}
                    fill="none"
                    stroke={DETECTOR_COLORS.flux}
                    strokeWidth="2.1"
                    strokeLinejoin="round"
                  />
                )}

                {/* X-Axis Minute Ticks */}
                {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                  const t = tStart + tSpan * frac;
                  const x = mapX(t);
                  return (
                    <text
                      key={frac}
                      x={x}
                      y={padT + fluxH + 14}
                      fill="#94a3b8"
                      fontSize="10"
                      textAnchor={frac === 0 ? "start" : frac === 1 ? "end" : "middle"}
                    >
                      {t.toFixed(1)}m
                    </text>
                  );
                })}

                {/* Aligned Detector Span Tracks */}
                {LAYER_CONFIG.map((layer, laneIdx) => {
                  const y = padT + fluxH + 24 + laneIdx * 23;
                  const isOn = visibleLayers.has(layer.key);
                  const evs = activePass?.events?.[layer.key] || [];
                  const disarmed =
                    layer.key === "hybrid" ? activePass?.hybrid_disarmed_arms || [] : [];

                  return (
                    <g key={layer.key} opacity={isOn ? 1 : 0.24}>
                      <text
                        x={padL - 8}
                        y={y + 11}
                        fill={layer.color}
                        fontSize="10.5"
                        fontWeight="700"
                        textAnchor="end"
                      >
                        {layer.short}
                      </text>
                      <rect x={padL} y={y} width={plotW} height="14" rx="3" fill="#0f172a" />

                      {/* Suppressed ARMED bars for Hybrid on NASA false-alarm passes */}
                      {isOn &&
                        disarmed.map((arm, idx) => (
                          <rect
                            key={`arm-${idx}`}
                            x={mapX(arm.start)}
                            y={y + 2}
                            width={Math.max(4, mapX(arm.end) - mapX(arm.start))}
                            height="10"
                            rx="2"
                            fill="none"
                            stroke="#fbbf24"
                            strokeWidth="1.2"
                            strokeDasharray="3 2"
                          />
                        ))}

                      {isOn &&
                        evs.map((ev, idx) => (
                          <g key={`bar-${idx}`}>
                            {layer.key === "hybrid" && ev.confirm_start > ev.armed_start && (
                              <rect
                                x={mapX(ev.armed_start)}
                                y={y}
                                width={Math.max(3, mapX(ev.confirm_start) - mapX(ev.armed_start))}
                                height="14"
                                rx="3"
                                fill="#fbbf24"
                                fillOpacity="0.85"
                              />
                            )}
                            <rect
                              x={mapX(layer.key === "hybrid" ? ev.confirm_start ?? ev.start : ev.start)}
                              y={y}
                              width={Math.max(
                                4,
                                mapX(ev.end) -
                                  mapX(layer.key === "hybrid" ? ev.confirm_start ?? ev.start : ev.start)
                              )}
                              height="14"
                              rx="3"
                              fill={layer.color}
                              fillOpacity="0.92"
                            />
                          </g>
                        ))}
                    </g>
                  );
                })}

                {/* Active Scrubber Crosshair */}
                {activeSample && (
                  <g pointerEvents="none">
                    <line
                      x1={mapX(activeSample.time_min)}
                      y1={padT}
                      x2={mapX(activeSample.time_min)}
                      y2={svgH - 6}
                      stroke="#38bdf8"
                      strokeWidth="1.5"
                      strokeDasharray="3 3"
                    />
                    <circle
                      cx={mapX(activeSample.time_min)}
                      cy={mapY(activeSample.flux)}
                      r="5"
                      fill="#38bdf8"
                      stroke="#080d17"
                      strokeWidth="2"
                    />
                  </g>
                )}
              </svg>
            </div>

            {/* Scrubber Slider + Live Telemetry Readout */}
            <div className="leo-scrubber-bar">
              <label htmlFor={scrubberId} className="leo-scrubber-label">
                <span>Scrub t:</span>
                <input
                  ref={scrubberRef}
                  id={scrubberId}
                  type="range"
                  className="leo-range-input"
                  min={0}
                  max={Math.max(0, trace.length - 1)}
                  value={clampedScrubIdx}
                  onChange={(e) => setScrubIdx(Number(e.target.value))}
                  data-testid="leo-time-scrubber"
                />
              </label>
              {activeSample && (
                <div className="leo-telemetry-readout" data-testid="leo-telemetry-readout">
                  <span>t=<strong>{activeSample.time_min.toFixed(1)}m</strong></span>
                  <span>Flux=<strong>{activeSample.flux.toFixed(1)}</strong></span>
                  {activeSample.b_field !== null && (
                    <span>B=<strong>{activeSample.b_field.toFixed(1)}µT</strong></span>
                  )}
                  {activeSample.l_shell !== null && (
                    <span>L=<strong>{activeSample.l_shell.toFixed(2)}</strong></span>
                  )}
                  <span>ModB=<strong>{activeSample.model_b.toFixed(2)}</strong></span>
                  <span>NASA=<strong>{activeSample.nasa_flag >= 0.5 ? "ON" : "OFF"}</strong></span>
                </div>
              )}
            </div>
          </figure>
        </section>

        {/* Right Side Rail: Pass-Level Scoreboard + Discrepancy Queue + Upload */}
        <aside className="leo-rail" aria-label="Pass-level scoreboard, discrepancy queue, and upload">
          {/* Card 1: Pass-Level Scoreboard */}
          <div className="brain-card leo-scoreboard-card" data-testid="leo-scoreboard">
            <div className="leo-card-head">
              <h2 className="brain-card-heading">
                Pass-Level Scoreboard ({rule === "hysteresis" ? "Hysteresis" : "Merge"})
              </h2>
              <span className="leo-boot-pill">
                {dataset.summary.bootstrap_resamples}× Pass Bootstrap
              </span>
            </div>

            <div className="leo-sb-list">
              {["nasa_flag", "model_a", "model_b", "hybrid"].map((key) => {
                const s = ruleData.scoreboard[key];
                const isHybrid = key === "hybrid";
                const df = s.delta_f1_vs_nasa;
                const fmtDelta = (v) => `${v >= 0 ? "+" : ""}${Number(v).toFixed(3)}`;
                const fmtBound = (v) => `${v >= 0 ? "+" : ""}${Number(v).toFixed(2)}`;
                return (
                  <div
                    key={key}
                    className={`leo-sb-row ${isHybrid ? "is-hybrid" : ""}`}
                    data-testid={`leo-sb-${key}`}
                  >
                    <div className="leo-sb-top">
                      <span className="leo-sb-name">
                        <span
                          className="brain-swatch"
                          style={{ background: DETECTOR_COLORS[key] }}
                          aria-hidden="true"
                        />
                        <strong>{s.label}</strong>
                      </span>
                      <span className="leo-sb-f1">
                        F1 <strong>{s.f1.toFixed(3)}</strong>{" "}
                        <small>[{s.ci_95.f1[0].toFixed(2)}-{s.ci_95.f1[1].toFixed(2)}]</small>
                      </span>
                    </div>
                    {df && (
                      <div className="leo-sb-delta" data-testid={`leo-delta-${key}`}>
                        <span>
                          ΔF1 vs NASA: <strong>{fmtDelta(df.delta)}</strong>{" "}
                          <small>
                            95% CI [{fmtBound(df.ci_95[0])}, {fmtBound(df.ci_95[1])}]
                          </small>
                        </span>
                        <span
                          className={`leo-sig-pill ${df.significant ? "is-sig" : "is-ns"}`}
                        >
                          {df.significant ? "Sig (CI ≠ 0)" : "n.s."}
                        </span>
                      </div>
                    )}
                    <div className="leo-sb-metrics">
                      <span>Entry <strong>{fmtSignedMin(s.entry_lead_lag_min)}</strong></span>
                      <span>Exit <strong>{fmtSignedMin(s.exit_lag_min)}</strong></span>
                      <span>FA/d <strong>{s.false_alarms_per_day.toFixed(2)}</strong></span>
                      <span>Dose <strong>{s.saa_dose_fraction_pct.toFixed(1)}%</strong></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Card 2: Automated Label Discrepancy Audit Queue */}
          <div className="brain-card leo-audit-card" data-testid="leo-discrepancy-queue">
            <div className="leo-card-head">
              <h2 className="brain-card-heading">Discrepancy Audit Queue</h2>
              <div className="leo-audit-head-actions">
                <span className="leo-audit-count">
                  {highDiscrepancyCount > 0
                    ? `${highDiscrepancyCount} High · ${ruleData.discrepancies.length} Total`
                    : `${ruleData.discrepancies.length} Flagged`}
                </span>
                <button
                  type="button"
                  className="leo-mini-export-btn"
                  onClick={handleExportDiscrepanciesCsv}
                  disabled={ruleData.discrepancies.length === 0}
                  aria-label="Export Discrepancies (CSV)"
                  data-testid="leo-export-discrepancies-csv"
                >
                  <Download size={12} aria-hidden="true" />
                  <span>Export CSV</span>
                </button>
              </div>
            </div>

            {ruleData.discrepancies.length > 0 ? (
              <ul className="leo-audit-list" role="list">
                {ruleData.discrepancies.map((item) => {
                  const isSelected = item.pass_id === activePass?.pass_id;
                  return (
                    <li key={`${item.pass_id}-${item.code}`}>
                      <button
                        type="button"
                        className={`leo-audit-item is-${item.severity} ${isSelected ? "is-selected" : ""}`}
                        onClick={() =>
                          handleSelectPass(
                            item.pass_id,
                            `Inspecting flagged pass ${item.pass_id}: ${item.summary}.`
                          )
                        }
                        data-testid={`leo-discrepancy-${item.pass_id}`}
                      >
                        <div className="leo-audit-item-top">
                          <code>{item.pass_id}</code>
                          <span className={`leo-sev-tag is-${item.severity}`}>
                            {item.severity.toUpperCase()}
                          </span>
                        </div>
                        <div className="leo-audit-summary">{item.summary}</div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="leo-audit-clean">
                <CheckCircle2 size={14} aria-hidden="true" />
                <span>Zero label discrepancies detected under current rule.</span>
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* Lower Row: Upload Dropzone + Accessible Responsive Pass Summary Table */}
      <div className="leo-lower-grid">
        <section className="brain-card leo-upload-card" aria-labelledby="leo-upload-heading">
          <h2 id="leo-upload-heading" className="brain-card-heading">
            Load Your LEO Pass Table (CSV/TSV or JSON)
          </h2>
          <div
            className={`brain-dropzone ${isDragOver ? "is-drag-over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            data-testid="leo-dropzone"
          >
            <Upload size={18} aria-hidden="true" className="brain-drop-icon" />
            <p className="brain-drop-title">
              Drop <code>leo_saa_eval.py</code> JSON or any pass CSV/TSV
            </p>
            <p className="brain-drop-hint" id={`${fileInputId}-hint`}>
              Columns: <code>time_min</code>/<code>timestamp_utc</code>, <code>flux</code>, optional <code>b_field</code>, <code>l_shell</code>, <code>nasa_flag</code>, <code>model_a</code>, <code>model_b</code>, <code>human_label</code>, <code>pass_id</code>. Runs 100% locally.
            </p>
            <div className="brain-drop-actions">
              <label htmlFor={fileInputId} className="brain-upload-label">
                Choose File
              </label>
              <input
                id={fileInputId}
                type="file"
                accept=".json,.csv,.tsv,.txt"
                className="visually-hidden"
                aria-describedby={`${fileInputId}-hint`}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) processUploadedFile(file);
                  e.target.value = "";
                }}
                data-testid="leo-file-input"
              />
              <button
                type="button"
                className="brain-ghost-btn"
                onClick={handleDownloadSampleCsv}
                data-testid="leo-download-sample-csv"
              >
                <FileSpreadsheet size={13} aria-hidden="true" />
                <span>Sample CSV</span>
              </button>
            </div>
          </div>
          {uploadError && (
            <p className="brain-error-banner" role="alert" data-testid="leo-upload-error">
              {uploadError}
            </p>
          )}
        </section>

        <section className="brain-table-card leo-table-card" aria-labelledby="leo-pass-table-heading">
          <h2 id="leo-pass-table-heading" className="brain-card-heading">
            Accessible Orbital Pass Summary Table ({ruleData.passes.length} passes · {rule})
          </h2>
          <div
            tabIndex={0}
            role="region"
            aria-labelledby="leo-pass-table-heading"
            className="leo-table-wrapper"
          >
            <table className="leo-pass-table">
              <caption className="visually-hidden">
                Orbital pass summary with peak flux, Hybrid vs. NASA timing lag, and discrepancy flags
              </caption>
              <thead>
                <tr>
                  <th scope="col">Pass ID</th>
                  <th scope="col">Peak Flux</th>
                  <th scope="col">Hybrid Entry</th>
                  <th scope="col">Hybrid Exit</th>
                  <th scope="col">NASA Exit</th>
                  <th scope="col">Audit Status</th>
                </tr>
              </thead>
              <tbody>
                {ruleData.passes.map((p) => {
                  const selected = p.pass_id === activePass?.pass_id;
                  return (
                    <tr key={p.pass_id} className={selected ? "is-selected" : ""}>
                      <th scope="row">
                        <button
                          type="button"
                          className="brain-row-select-btn"
                          aria-pressed={selected}
                          onClick={() => handleSelectPass(p.pass_id, `Selected orbital pass ${p.pass_id}.`)}
                        >
                          {p.pass_id}
                        </button>
                      </th>
                      <td className="is-mono">{Number(p.peak_flux || 0).toFixed(1)}</td>
                      <td className="is-mono">{fmtSignedMin(p.metrics?.hybrid_entry_lag_min)}</td>
                      <td className="is-mono">{fmtSignedMin(p.metrics?.hybrid_exit_lag_min)}</td>
                      <td className="is-mono">{fmtSignedMin(p.metrics?.nasa_exit_lag_min)}</td>
                      <td>
                        {p.discrepancy_code ? (
                          <span className={`leo-sev-tag is-${p.discrepancy_severity}`}>
                            {p.discrepancy_code.replace(/_/g, " ")}
                          </span>
                        ) : p.has_human_saa ? (
                          <span className="leo-clean-tag">Verified SAA</span>
                        ) : (
                          <span className="leo-gcr-tag">Quiet GCR</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Static Footer with Attribution & Epistemic Guardrails */}
      <footer className="leo-footer">
        <p>
          <strong>Method:</strong> {dataset.provenance?.method} ·{" "}
          <strong>CLI Harness:</strong> <code>python scripts/leo_saa_eval.py --input passes.csv --out leo_eval.json</code>
        </p>
        <p>
          <strong>Epistemic Integrity (NASA OSDR AWG Thread #3665):</strong>{" "}
          Built-in 12-pass dataset is strictly an illustrative synthetic simulation - never empirical RadLab, SPACEDOS, or ISS mission telemetry. ·{" "}
          <span className="brain-license-inline">MIT License · Open Source v1.0.0</span>
        </p>
      </footer>
    </div>
  );
}
