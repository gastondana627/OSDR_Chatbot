import { useState } from "react";

/**
 * Returns human-readable label and CSS class for the 4 standardized provenance states.
 */
export function getProvenanceMeta(provenance) {
  if (!provenance) {
    return {
      status: "fallback",
      label: "Conceptual local fallback",
      icon: "📐",
      className: "prov-fallback",
      providerSummary: "NASA OSDR Local Vector Engine",
    };
  }

  const status = provenance.generationStatus;
  switch (status) {
    case "fresh_provider":
      return {
        status: "fresh_provider",
        label: "Fresh provider generation",
        icon: "✦",
        className: "prov-fresh",
        providerSummary: `${provenance.provider || "Gemini"} (${provenance.providerModel || "model"})`,
      };
    case "cache_hit":
      return {
        status: "cache_hit",
        label: "Reused cached artifact",
        icon: "📦",
        className: "prov-cache",
        providerSummary: `Cached (${provenance.provider || "Provider"})`,
      };
    case "fallback":
      return {
        status: "fallback",
        label: "Conceptual local fallback",
        icon: "📐",
        className: "prov-fallback",
        providerSummary: `${provenance.provider || "NASA OSDR Local Engine"}`,
      };
    case "failed":
      return {
        status: "failed",
        label: "Generation failed — no new media created",
        icon: "⚠️",
        className: "prov-failed",
        providerSummary: provenance.errorMessage || "Error during generation",
      };
    default:
      return {
        status: "fallback",
        label: "Conceptual local fallback",
        icon: "📐",
        className: "prov-fallback",
        providerSummary: "NASA OSDR Local Engine",
      };
  }
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
                      {provenance.generationStatus === "fresh_provider" && "Generated via real-time API call to upstream AI provider"}
                      {provenance.generationStatus === "cache_hit" && "Instant artifact retrieval from server-side cache (no redundant API charge)"}
                      {provenance.generationStatus === "fallback" && "Deterministic multi-omics procedural SVG/Canvas generation"}
                      {provenance.generationStatus === "failed" && "Upstream API error encountered — fallback rendered safely"}
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
