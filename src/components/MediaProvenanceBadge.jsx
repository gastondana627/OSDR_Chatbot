import { useState } from "react";

/**
 * Returns human-readable label, icon, render description and CSS class
 * for the explicit artifact types and standardized provenance states.
 */
export function getProvenanceMeta(provenance) {
  if (!provenance) {
    return {
      status: "fallback",
      label: "Procedural SVG Vector",
      artifactLabel: "Procedural SVG (Data URI)",
      renderEngineLabel: "SVG Vector Engine",
      icon: "📐",
      className: "prov-fallback",
      providerSummary: "NASA OSDR Local Vector Engine",
    };
  }

  const status = provenance.generationStatus;
  const artifactType = provenance.artifactType || (
    provenance.mediaType === "motion_brief" || provenance.mediaType === "translational_clip"
      ? "canvas_motion_render"
      : status === "fresh_provider" && provenance.provider?.toLowerCase().includes("gemini")
      ? "provider_image_data_uri"
      : "fallback_svg_data_uri"
  );

  const renderEngine = provenance.renderEngine || (
    artifactType === "provider_image_data_uri"
      ? "gemini_inline_image"
      : artifactType === "fallback_svg_data_uri"
      ? "svg_vector_engine"
      : artifactType === "canvas_motion_render"
      ? "browser_canvas_60fps"
      : artifactType === "provider_video_url"
      ? "veo_hosted_mp4"
      : "svg_vector_engine"
  );

  // Label specific to the artifact type and render engine
  let artifactLabel = "Procedural SVG";
  let renderEngineLabel = "SVG Vector Engine";
  let specificLabel = "Procedural SVG Output";
  let icon = "📐";
  let className = "prov-fallback";

  switch (artifactType) {
    case "provider_image_data_uri":
      artifactLabel = "AI Still (Inline PNG Data URI)";
      renderEngineLabel = "Gemini Inline Image API";
      specificLabel = "AI Image (Gemini PNG)";
      icon = "✦";
      className = status === "cache_hit" ? "prov-cache" : "prov-fresh";
      break;

    case "fallback_svg_data_uri":
      artifactLabel = "Procedural Vector (SVG Data URI)";
      renderEngineLabel = "NASA OSDR Vector Engine";
      specificLabel = "Procedural SVG Chart";
      icon = "📐";
      className = "prov-fallback";
      break;

    case "canvas_motion_render":
      artifactLabel = "Client Canvas Motion (60fps)";
      renderEngineLabel = "Browser Canvas Engine (60fps)";
      specificLabel = provenance.planningProvider?.includes("Veo")
        ? "AI-Planned Canvas Motion"
        : "Kinetic Canvas Motion";
      icon = "🎬";
      className = "prov-fresh";
      break;

    case "provider_video_url":
      artifactLabel = "Hosted MP4 Video Artifact";
      renderEngineLabel = "Google Veo Cloud MP4";
      specificLabel = "Hosted MP4 Video";
      icon = "📹";
      className = "prov-fresh";
      break;

    default:
      if (status === "fresh_provider") {
        specificLabel = "Fresh provider generation";
        icon = "✦";
        className = "prov-fresh";
      } else if (status === "cache_hit") {
        specificLabel = "Reused cached artifact";
        icon = "📦";
        className = "prov-cache";
      } else {
        specificLabel = "Conceptual local fallback";
        icon = "📐";
        className = "prov-fallback";
      }
  }

  const providerSummary =
    artifactType === "canvas_motion_render"
      ? `${provenance.planningProvider || provenance.provider || "Kinetic Canvas"} (60fps Canvas)`
      : `${provenance.provider || "NASA OSDR Local Engine"} (${provenance.providerModel || renderEngineLabel})`;

  return {
    status,
    artifactType,
    renderEngine,
    artifactLabel,
    renderEngineLabel,
    label: specificLabel,
    icon,
    className,
    providerSummary,
  };
}

/**
 * Compact inline badge with optional click-to-inspect provenance details.
 */
export default function MediaProvenanceBadge({ provenance, compact = false, showInspectButton = true }) {
  const [inspectOpen, setInspectOpen] = useState(false);
  const [copiedField, setCopiedField] = useState("");

  if (!provenance) return null;

  const meta = getProvenanceMeta(provenance);

  const handleCopy = (text, fieldName) => {
    if (!text) return;
    navigator.clipboard.writeText(String(text));
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(""), 2000);
  };

  return (
    <>
      <div className={`awg-provenance-badge-root ${meta.className} ${compact ? "compact" : ""}`}>
        <span className="prov-status-indicator">{meta.icon}</span>
        <span className="prov-status-label">{meta.label}</span>
        {!compact && provenance.providerModel && (
          <span className="prov-model-pill">
            {provenance.providerModel}
          </span>
        )}
        {!compact && provenance.latencyMs != null && (
          <span className="prov-latency-pill">
            {provenance.latencyMs}ms
          </span>
        )}
        {showInspectButton && (
          <button
            className="prov-inspect-btn"
            onClick={(e) => {
              e.stopPropagation();
              setInspectOpen(true);
            }}
            title="Inspect full auditable provenance certificate"
          >
            🔍 Audit
          </button>
        )}
      </div>

      {/* Inspect Provenance Modal / Inspector */}
      {inspectOpen && (
        <div className="awg-modal-overlay" onClick={() => setInspectOpen(false)}>
          <div className="awg-modal-content prov-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="awg-modal-header">
              <div className="modal-title-row">
                <span className="prov-modal-icon">🛡️</span>
                <div>
                  <strong>Media Generation Provenance Certificate</strong>
                  <div className="prov-modal-sub">
                    Verifiable execution audit record for generated artifact
                  </div>
                </div>
              </div>
              <button className="awg-close-btn" onClick={() => setInspectOpen(false)}>
                ×
              </button>
            </div>

            <div className="awg-modal-body prov-modal-body">
              {/* Primary Status Banner */}
              <div className={`prov-status-banner ${meta.className}`}>
                <div className="status-banner-left">
                  <span className="banner-icon">{meta.icon}</span>
                  <div>
                    <div className="banner-status-title">{meta.label}</div>
                    <div className="banner-status-desc">
                      {meta.artifactType === "provider_image_data_uri" && "Authentic AI image generation via upstream Gemini Image API (base64 inline data URI)"}
                      {meta.artifactType === "fallback_svg_data_uri" && "Deterministic multi-omics procedural SVG vector chart (data URI)"}
                      {meta.artifactType === "canvas_motion_render" && "High-fidelity 60fps kinetic motion brief rendered client-side in HTML5 Canvas"}
                      {meta.artifactType === "provider_video_url" && "Upstream provider-hosted playable MP4 video artifact"}
                    </div>
                  </div>
                </div>
                <div className="status-banner-right">
                  <span className="latency-badge">{provenance.latencyMs ?? 0} ms</span>
                </div>
              </div>

              {/* Provenance Fields Grid */}
              <div className="prov-fields-grid">
                <div className="prov-field-card">
                  <div className="field-label">ARTIFACT TYPE</div>
                  <div className="field-val-text">
                    <strong>{meta.artifactLabel}</strong>
                    <div className="field-subnote"><code>{meta.artifactType}</code></div>
                  </div>
                </div>

                <div className="prov-field-card">
                  <div className="field-label">RENDER ENGINE</div>
                  <div className="field-val-text">
                    <strong>{meta.renderEngineLabel}</strong>
                    <div className="field-subnote"><code>{meta.renderEngine}</code></div>
                  </div>
                </div>

                <div className="prov-field-card">
                  <div className="field-label">REQUEST ID (UUID)</div>
                  <div className="field-val-row">
                    <code className="prov-code">{provenance.requestId || "—"}</code>
                    <button
                      className="field-copy-btn"
                      onClick={() => handleCopy(provenance.requestId, "requestId")}
                    >
                      {copiedField === "requestId" ? "✓" : "Copy"}
                    </button>
                  </div>
                </div>

                <div className="prov-field-card">
                  <div className="field-label">ARTIFACT ID</div>
                  <div className="field-val-row">
                    <code className="prov-code">{provenance.artifactId || "—"}</code>
                    <button
                      className="field-copy-btn"
                      onClick={() => handleCopy(provenance.artifactId, "artifactId")}
                    >
                      {copiedField === "artifactId" ? "✓" : "Copy"}
                    </button>
                  </div>
                </div>

                <div className="prov-field-card">
                  <div className="field-label">CREATED AT (TIMESTAMP)</div>
                  <div className="field-val-text">
                    {provenance.createdAt ? new Date(provenance.createdAt).toUTCString() : "—"}
                  </div>
                </div>

                <div className="prov-field-card">
                  <div className="field-label">PROVIDER & MODEL</div>
                  <div className="field-val-text">
                    <strong>{provenance.provider || "local"}</strong> &middot; <code>{provenance.providerModel || "none"}</code>
                  </div>
                </div>

                <div className="prov-field-card span-2">
                  <div className="field-label">PROMPT FINGERPRINT (SHA-256 HASH)</div>
                  <div className="field-val-row">
                    <code className="prov-code-hash">{provenance.promptFingerprint || "—"}</code>
                    <button
                      className="field-copy-btn"
                      onClick={() => handleCopy(provenance.promptFingerprint, "fp")}
                    >
                      {copiedField === "fp" ? "✓" : "Copy"}
                    </button>
                  </div>
                  <div className="field-subnote">Cryptographic hash only — secrets and prompts are never exposed</div>
                </div>

                <div className="prov-field-card">
                  <div className="field-label">CACHE STATUS & KEY</div>
                  <div className="field-val-text">
                    <span className={`cache-pill ${provenance.cacheHit ? "is-hit" : "is-miss"}`}>
                      {provenance.cacheHit ? "CACHE HIT" : "CACHE MISS"}
                    </span>
                    {provenance.cacheKey && (
                      <span className="cache-key-sub">Key: {provenance.cacheKey.slice(0, 16)}…</span>
                    )}
                  </div>
                </div>

                <div className="prov-field-card">
                  <div className="field-label">CREATIVE DIRECTION & SEED</div>
                  <div className="field-val-text">
                    <span>{provenance.creativeDirection || "Default"}</span> &middot; Seed: <code>{provenance.seed ?? "auto"}</code>
                  </div>
                </div>

                <div className="prov-field-card">
                  <div className="field-label">SOURCE STUDY PAIR</div>
                  <div className="field-val-chips">
                    {Array.isArray(provenance.sourceStudyPair) && provenance.sourceStudyPair.length > 0 ? (
                      provenance.sourceStudyPair.map((sid) => (
                        <span key={sid} className="prov-study-chip">
                          {sid}
                        </span>
                      ))
                    ) : (
                      <span className="empty-val">—</span>
                    )}
                  </div>
                </div>

                <div className="prov-field-card">
                  <div className="field-label">ASSET URL / DESTINATION</div>
                  <div className="field-val-text url-truncate">
                    {provenance.assetUrl ? (
                      provenance.assetUrl.startsWith("data:") ? (
                        <span className="data-uri-label">Embedded Vector Asset (Data URI)</span>
                      ) : (
                        <a href={provenance.assetUrl} target="_blank" rel="noreferrer">
                          {provenance.assetUrl}
                        </a>
                      )
                    ) : (
                      "—"
                    )}
                  </div>
                </div>

                {provenance.errorMessage && (
                  <div className="prov-field-card span-2 prov-error-card">
                    <div className="field-label error-label">ERROR DIAGNOSTICS</div>
                    <div className="error-code-row">
                      <strong>Code:</strong> <code>{provenance.errorCode || "UNKNOWN_ERROR"}</code>
                    </div>
                    <div className="error-msg-text">{provenance.errorMessage}</div>
                  </div>
                )}
              </div>
            </div>

            <div className="awg-modal-footer prov-modal-footer">
              <span className="footer-audit-note">
                Audited by NASA OSDR AWG Verification Subsystem &middot; Run <code>/awg media audit</code> to inspect system-wide log
              </span>
              <button
                className="ctrl-btn-small"
                onClick={() => handleCopy(JSON.stringify(provenance, null, 2), "json")}
              >
                {copiedField === "json" ? "✓ JSON Copied" : "Copy Raw JSON"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
