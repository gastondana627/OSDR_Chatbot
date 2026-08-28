import { useState } from "react";
import { testOsdrConnection, fetchSystemDiagnostics } from "../api.js";

export default function OsdrDiagnosticsModal({
  diagnostics,
  systemDiagnostics,
  onClose,
  onRefresh,
  initialTab = "osdr",
}) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [testing, setTesting] = useState(false);
  const [testOutput, setTestOutput] = useState(null);
  const [refreshingSystem, setRefreshingSystem] = useState(false);

  const handleRunPing = async () => {
    setTesting(true);
    setTestOutput(null);
    try {
      const res = await testOsdrConnection();
      setTestOutput(res.testResult);
      if (onRefresh) {
        onRefresh(res.diagnostics);
      }
    } catch (err) {
      setTestOutput({ success: false, latencyMs: 0, error: err?.message || "Ping failed" });
    } finally {
      setTesting(false);
    }
  };

  const handleRefreshSystem = async () => {
    setRefreshingSystem(true);
    try {
      const res = await fetchSystemDiagnostics(true);
      if (onRefresh) {
        onRefresh(res.osdrDiagnostics, res.systemDiagnostics);
      }
    } catch (err) {
      console.warn("System diagnostic refresh error:", err);
    } finally {
      setRefreshingSystem(false);
    }
  };

  const isConnected = diagnostics?.connectionStatus === "connected";
  const statusColor = isConnected ? "#10b981" : diagnostics?.connectionStatus === "degraded" ? "#f59e0b" : "#ef4444";
  const statusText = isConnected
    ? "CONNECTED (LIVE REST API)"
    : diagnostics?.connectionStatus === "degraded"
    ? "DEGRADED"
    : diagnostics?.connectionStatus === "untested"
    ? "UNTESTED (RUN PING)"
    : "OFFLINE / LOCAL FALLBACK";

  const sysStatus = systemDiagnostics?.discoveryStatus;
  const isAiLive = sysStatus === "live_success";
  const aiStatusColor = isAiLive ? "#10b981" : sysStatus === "key_missing" ? "#38bdf8" : sysStatus === "quota_error" ? "#f59e0b" : "#ef4444";
  const aiStatusLabel = isAiLive
    ? "LIVE GEMINI API CONNECTED"
    : sysStatus === "key_missing"
    ? "LOCAL RAG ENGINE ACTIVE (NO API KEY)"
    : sysStatus === "auth_error"
    ? "API KEY UNAUTHORIZED (401/403)"
    : sysStatus === "quota_error"
    ? "QUOTA / RATE LIMITED (429)"
    : "FALLBACK RAG ENGINE ACTIVE";

  return (
    <div className="osdr-diag-overlay" onClick={onClose}>
      <div className="osdr-diag-modal" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="osdr-diag-header">
          <div className="osdr-diag-title">
            <span className="osdr-diag-icon">🛡️</span>
            <div>
              <h3>System &amp; NASA OSDR Diagnostics</h3>
              <span className="osdr-diag-sub">Server Health, Gemini Discovery &amp; Real-Time Data Attribution</span>
            </div>
          </div>
          <button className="osdr-diag-close" onClick={onClose} aria-label="Close modal">×</button>
        </div>

        {/* Tab Selection */}
        <div className="osdr-tab-bar" style={{ display: "flex", gap: "8px", borderBottom: "1px solid var(--border-color)", paddingBottom: "12px", marginBottom: "16px" }}>
          <button
            className={`tab-btn ${activeTab === "osdr" ? "active" : ""}`}
            onClick={() => setActiveTab("osdr")}
            style={{
              padding: "6px 14px",
              borderRadius: "6px",
              border: "1px solid",
              borderColor: activeTab === "osdr" ? "var(--accent-cyan)" : "var(--border-color)",
              background: activeTab === "osdr" ? "rgba(6, 182, 212, 0.15)" : "transparent",
              color: activeTab === "osdr" ? "var(--accent-cyan)" : "var(--text-muted)",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "13px",
            }}
          >
            📡 NASA OSDR Live REST Audit
          </button>
          <button
            className={`tab-btn ${activeTab === "ai" ? "active" : ""}`}
            onClick={() => setActiveTab("ai")}
            style={{
              padding: "6px 14px",
              borderRadius: "6px",
              border: "1px solid",
              borderColor: activeTab === "ai" ? "var(--accent-cyan)" : "var(--border-color)",
              background: activeTab === "ai" ? "rgba(6, 182, 212, 0.15)" : "transparent",
              color: activeTab === "ai" ? "var(--accent-cyan)" : "var(--text-muted)",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "13px",
            }}
          >
            🤖 Gemini Model &amp; Server Environment
          </button>
        </div>

        {activeTab === "osdr" && (
          <>
            {/* Live Status Pill Bar */}
            <div className="osdr-status-hero" style={{ borderColor: `${statusColor}44` }}>
              <div className="osdr-status-left">
                <span className="osdr-live-dot" style={{ backgroundColor: statusColor }} />
                <div>
                  <div className="osdr-status-title" style={{ color: statusColor }}>
                    {statusText}
                  </div>
                  <div className="osdr-status-detail">
                    Active Source Mode: <strong>{diagnostics?.sourceMode || "local_curated_mapping"}</strong>
                    {diagnostics?.latencyMs ? (
                      <span> · Latency: <strong>{diagnostics.latencyMs}ms</strong></span>
                    ) : null}
                  </div>
                </div>
              </div>
              <button
                className="osdr-test-btn"
                onClick={handleRunPing}
                disabled={testing}
              >
                {testing ? "Pinging OSDR API..." : "⚡ Test Live Connection"}
              </button>
            </div>

            {/* Test Output Banner if available */}
            {testOutput && (
              <div className={`osdr-test-banner ${testOutput.success ? "success" : "error"}`}>
                {testOutput.success ? (
                  <div>
                    ✓ <strong>NASA OSDR Runtime Ping Successful!</strong> HTTP 200 OK received in {testOutput.latencyMs}ms from <code>osdr.nasa.gov</code>.
                  </div>
                ) : (
                  <div>
                    ✕ <strong>Live Ping Failed:</strong> {testOutput.error}
                  </div>
                )}
              </div>
            )}

            {/* Data Source Taxonomy Grid */}
            <div className="osdr-section-title">Data Source Classification</div>
            <div className="osdr-taxonomy-grid">
              {/* 1. Live API */}
              <div className={`osdr-tax-card ${diagnostics?.connectionStatus === "connected" ? "active-source" : ""}`}>
                <div className="tax-badge live">1. live_api</div>
                <div className="tax-count">
                  {diagnostics?.dataSources?.live_api?.totalRuntimeFetches || 0} fetches
                </div>
                <p className="tax-desc">
                  Direct runtime HTTP calls to official NASA OSDR REST endpoints for real-time study discovery.
                </p>
                <div className="tax-substatus">
                  Status: <strong>{diagnostics?.connectionStatus === "connected" ? "Active at Runtime" : "Standby / Tested"}</strong>
                </div>
              </div>

              {/* 2. Cached Snapshot */}
              <div className="osdr-tax-card">
                <div className="tax-badge cached">2. cached_snapshot</div>
                <div className="tax-count">
                  {diagnostics?.dataSources?.cached_snapshot?.count || 0} dynamic studies
                </div>
                <p className="tax-desc">
                  In-memory cache of live-fetched OSDR studies retained for instant repeat reference in this session.
                </p>
                <div className="tax-substatus">
                  Indexed: <strong>{diagnostics?.dataSources?.cached_snapshot?.dynamicStudyIds?.length ? diagnostics.dataSources.cached_snapshot.dynamicStudyIds.join(", ") : "None yet (fetches on-demand)"}</strong>
                </div>
              </div>

              {/* 3. Local Curated Mapping */}
              <div className="osdr-tax-card">
                <div className="tax-badge local">3. local_curated_mapping</div>
                <div className="tax-count">
                  {diagnostics?.dataSources?.local_curated_mapping?.count || 13} mapped
                </div>
                <p className="tax-desc">
                  Fast zero-latency keyword &amp; token retrieval index indexing study attributes and phenotypes.
                </p>
                <div className="tax-substatus">
                  Search Index: <strong>Indexed In-Memory</strong>
                </div>
              </div>

              {/* 4. Static Seeded Examples */}
              <div className="osdr-tax-card">
                <div className="tax-badge static">4. static seeded examples</div>
                <div className="tax-count">
                  {diagnostics?.dataSources?.static_seeded_examples?.count || 13} studies
                </div>
                <p className="tax-desc">
                  Curated benchmark records (OSD-679, OSD-680, OSD-681, etc.) for high-precision SANS &amp; omics queries.
                </p>
                <div className="tax-substatus">
                  Curation: <strong>Space Biology Benchmarks</strong>
                </div>
              </div>
            </div>

            {/* Timestamps & Error Tracking */}
            <div className="osdr-section-title">Telemetry &amp; Audit Timestamps</div>
            <div className="osdr-telemetry-box">
              <div className="telemetry-row">
                <span className="tel-label">Last Successful Fetch:</span>
                <span className="tel-val">
                  {diagnostics?.lastSuccessfulFetch ? new Date(diagnostics.lastSuccessfulFetch).toLocaleString() : "None in current session"}
                </span>
              </div>
              <div className="telemetry-row">
                <span className="tel-label">Last Checked At:</span>
                <span className="tel-val">
                  {diagnostics?.lastCheckedAt ? new Date(diagnostics.lastCheckedAt).toLocaleString() : "Never"}
                </span>
              </div>
              <div className="telemetry-row">
                <span className="tel-label">Last Fetch Error:</span>
                <span className={`tel-val ${diagnostics?.lastFetchError ? "error-text" : "none-text"}`}>
                  {diagnostics?.lastFetchError || "None (0 errors)"}
                </span>
              </div>
            </div>

            {/* Exact Endpoint URLs Audit */}
            <div className="osdr-section-title">Verified NASA OSDR Public REST Endpoints</div>
            <div className="osdr-endpoints-list">
              <div className="endpoint-item">
                <span className="endpoint-method">GET</span>
                <code className="endpoint-url">https://osdr.nasa.gov/osdr/data/search?ffield=Accession&amp;fvalue=&#123;OSD_ID&#125;</code>
                <span className="endpoint-desc">Live Study Metadata Search</span>
              </div>
              <div className="endpoint-item">
                <span className="endpoint-method">GET</span>
                <code className="endpoint-url">https://osdr.nasa.gov/osdr/data/search?term=&#123;keyword&#125;&amp;size=&#123;N&#125;</code>
                <span className="endpoint-desc">Keyword Search Index</span>
              </div>
              <div className="endpoint-item">
                <span className="endpoint-method">GET</span>
                <code className="endpoint-url">https://osdr.nasa.gov/osdr/data/osd/files/&#123;numeric_id&#125;/?page=1&amp;size=20</code>
                <span className="endpoint-desc">OSDR Study File Count &amp; Listing</span>
              </div>
            </div>
          </>
        )}

        {activeTab === "ai" && (
          <>
            {/* AI Status Hero */}
            <div className="osdr-status-hero" style={{ borderColor: `${aiStatusColor}44` }}>
              <div className="osdr-status-left">
                <span className="osdr-live-dot" style={{ backgroundColor: aiStatusColor }} />
                <div>
                  <div className="osdr-status-title" style={{ color: aiStatusColor }}>
                    {aiStatusLabel}
                  </div>
                  <div className="osdr-status-detail">
                    Environment: <strong>{systemDiagnostics?.environment || (systemDiagnostics?.isVercel ? "vercel" : "server")}</strong>
                    <span> · API Key: <strong>{systemDiagnostics?.geminiApiKeyPresent ? `Configured (${systemDiagnostics.geminiApiKeyPrefix || "present"})` : "Not Configured"}</strong></span>
                  </div>
                </div>
              </div>
              <button
                className="osdr-test-btn"
                onClick={handleRefreshSystem}
                disabled={refreshingSystem}
              >
                {refreshingSystem ? "Discovering Models..." : "🔄 Refresh Discovery"}
              </button>
            </div>

            {systemDiagnostics?.discoveryError && (
              <div className="osdr-test-banner" style={{ borderColor: "rgba(245, 158, 11, 0.4)", background: "rgba(245, 158, 11, 0.08)" }}>
                <div>
                  ℹ️ <strong>Discovery Status:</strong> {systemDiagnostics.discoveryError}
                  {systemDiagnostics.discoveryDetails && (
                    <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--text-muted)" }}>
                      Technical: {systemDiagnostics.discoveryDetails}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Model Counts & Availability Grid */}
            <div className="osdr-section-title">Model Capabilities &amp; Counts</div>
            <div className="osdr-taxonomy-grid">
              <div className="osdr-tax-card">
                <div className="tax-badge live">Text &amp; Chat Models</div>
                <div className="tax-count">
                  {systemDiagnostics?.counts?.textChatModels || systemDiagnostics?.models?.textChat?.length || 4} available
                </div>
                <p className="tax-desc">
                  Default: <code>{systemDiagnostics?.models?.defaultTextChat || "gemini-3.7-flash"}</code>
                </p>
                <div className="tax-substatus">
                  Candidates: <strong>{(systemDiagnostics?.models?.textChat || ["gemini-3.7-flash", "gemini-2.5-flash"]).slice(0, 3).join(", ")}</strong>
                </div>
              </div>

              <div className="osdr-tax-card">
                <div className="tax-badge cached">Image Generation</div>
                <div className="tax-count">
                  {systemDiagnostics?.counts?.imageModels || 0} models
                </div>
                <p className="tax-desc">
                  Generates multi-aspect visual abstracts and data visualization panels.
                </p>
                <div className="tax-substatus">
                  Engine: <strong>{systemDiagnostics?.geminiApiKeyPresent ? "Imagen 3" : "High-Fidelity Vector Synthesis"}</strong>
                </div>
              </div>

              <div className="osdr-tax-card">
                <div className="tax-badge local">Video Generation</div>
                <div className="tax-count">
                  {systemDiagnostics?.counts?.videoModels || 0} models
                </div>
                <p className="tax-desc">
                  Synthesizes 5s scientific motion briefs and translational clips.
                </p>
                <div className="tax-substatus">
                  Engine: <strong>{systemDiagnostics?.counts?.videoModels ? "Veo 2.0 Video API" : "Live Biological Animation Simulator"}</strong>
                </div>
              </div>

              <div className="osdr-tax-card">
                <div className="tax-badge static">Serverless Environment</div>
                <div className="tax-count">
                  {systemDiagnostics?.isVercel ? "Vercel Serverless" : "Node / Cloud Run"}
                </div>
                <p className="tax-desc">
                  Uptime: {systemDiagnostics?.uptimeSeconds ? `${systemDiagnostics.uptimeSeconds}s` : "Active"}
                </p>
                <div className="tax-substatus">
                  Boot Time: <strong>{systemDiagnostics?.serverBootTime ? new Date(systemDiagnostics.serverBootTime).toLocaleTimeString() : "Recent"}</strong>
                </div>
              </div>
            </div>

            {/* Multi-Provider Text Fallback Chain */}
            <div className="osdr-section-title">Resilient Multi-Provider Text Fallback Cascade</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px", marginBottom: "16px" }}>
              {/* 1. Gemini */}
              <div style={{ padding: "12px", borderRadius: "8px", background: "rgba(255, 255, 255, 0.03)", border: "1px solid var(--border-color)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <strong style={{ fontSize: "13px" }}>1. Google Gemini (Primary)</strong>
                  <span style={{ fontSize: "11px", padding: "2px 6px", borderRadius: "4px", background: systemDiagnostics?.textProviders?.providers?.gemini?.configured ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)", color: systemDiagnostics?.textProviders?.providers?.gemini?.configured ? "#10b981" : "#ef4444" }}>
                    {systemDiagnostics?.textProviders?.providers?.gemini?.configured ? "Configured" : "Unset"}
                  </span>
                </div>
                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "4px" }}>
                  Model: <code>{systemDiagnostics?.textProviders?.providers?.gemini?.defaultModel || "gemini-3.7-flash"}</code>
                </div>
                <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  Key: GEMINI_API_KEY
                </div>
              </div>

              {/* 2. OpenRouter */}
              <div style={{ padding: "12px", borderRadius: "8px", background: "rgba(255, 255, 255, 0.03)", border: "1px solid var(--border-color)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <strong style={{ fontSize: "13px" }}>2. OpenRouter (Secondary)</strong>
                  <span style={{ fontSize: "11px", padding: "2px 6px", borderRadius: "4px", background: systemDiagnostics?.textProviders?.providers?.openrouter?.configured ? "rgba(16, 185, 129, 0.2)" : "rgba(255, 255, 255, 0.1)", color: systemDiagnostics?.textProviders?.providers?.openrouter?.configured ? "#10b981" : "var(--text-muted)" }}>
                    {systemDiagnostics?.textProviders?.providers?.openrouter?.configured ? "Configured" : "Optional"}
                  </span>
                </div>
                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "4px" }}>
                  Model: <code>{systemDiagnostics?.textProviders?.providers?.openrouter?.defaultModel || "meta-llama/llama-3.3-70b-instruct"}</code>
                </div>
                <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  Key: OPENROUTER_API_KEY
                </div>
              </div>

              {/* 3. Groq */}
              <div style={{ padding: "12px", borderRadius: "8px", background: "rgba(255, 255, 255, 0.03)", border: "1px solid var(--border-color)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <strong style={{ fontSize: "13px" }}>3. Groq (Tertiary)</strong>
                  <span style={{ fontSize: "11px", padding: "2px 6px", borderRadius: "4px", background: systemDiagnostics?.textProviders?.providers?.groq?.configured ? "rgba(16, 185, 129, 0.2)" : "rgba(255, 255, 255, 0.1)", color: systemDiagnostics?.textProviders?.providers?.groq?.configured ? "#10b981" : "var(--text-muted)" }}>
                    {systemDiagnostics?.textProviders?.providers?.groq?.configured ? "Configured" : "Optional"}
                  </span>
                </div>
                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "4px" }}>
                  Model: <code>{systemDiagnostics?.textProviders?.providers?.groq?.defaultModel || "llama-3.3-70b-versatile"}</code>
                </div>
                <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  Key: GROQ_API_KEY
                </div>
              </div>

              {/* 4. Local Deterministic */}
              <div style={{ padding: "12px", borderRadius: "8px", background: "rgba(255, 255, 255, 0.03)", border: "1px solid var(--border-color)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <strong style={{ fontSize: "13px" }}>4. Local RAG (Final)</strong>
                  <span style={{ fontSize: "11px", padding: "2px 6px", borderRadius: "4px", background: "rgba(16, 185, 129, 0.2)", color: "#10b981" }}>
                    Active Always
                  </span>
                </div>
                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "4px" }}>
                  Model: <code>local-rag-v1</code>
                </div>
                <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  Zero external dependencies
                </div>
              </div>
            </div>

            {/* Model List */}
            {systemDiagnostics?.models?.textChat && systemDiagnostics.models.textChat.length > 0 && (
              <>
                <div className="osdr-section-title">Discovered Chat Models</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "16px" }}>
                  {systemDiagnostics.models.textChat.map((m) => (
                    <span
                      key={m}
                      style={{
                        padding: "4px 8px",
                        fontSize: "12px",
                        fontFamily: "var(--font-mono, monospace)",
                        background: "rgba(255, 255, 255, 0.05)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "4px",
                        color: m === systemDiagnostics.models.defaultTextChat ? "var(--accent-cyan)" : "inherit",
                      }}
                    >
                      {m} {m === systemDiagnostics.models.defaultTextChat ? "★ default" : ""}
                    </span>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* Modal Footer */}
        <div className="osdr-diag-footer">
          <div className="footer-note">
            🛡️ <em>All API keys and secrets are strictly masked and isolated to server-side memory.</em>
          </div>
          <button className="ctrl-btn-small" onClick={onClose}>Close Diagnostics</button>
        </div>
      </div>
    </div>
  );
}
