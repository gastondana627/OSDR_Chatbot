import { useState } from "react";
import { testOsdrConnection } from "../api.js";

export default function OsdrDiagnosticsModal({ diagnostics, onClose, onRefresh }) {
  const [testing, setTesting] = useState(false);
  const [testOutput, setTestOutput] = useState(null);

  if (!diagnostics) return null;

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
      setTestOutput({ success: false, latencyMs: 0, error: err.message });
    } finally {
      setTesting(false);
    }
  };

  const isConnected = diagnostics.connectionStatus === "connected";
  const statusColor = isConnected ? "#10b981" : diagnostics.connectionStatus === "degraded" ? "#f59e0b" : "#ef4444";
  const statusText = isConnected
    ? "CONNECTED (LIVE REST API)"
    : diagnostics.connectionStatus === "degraded"
    ? "DEGRADED"
    : diagnostics.connectionStatus === "untested"
    ? "UNTESTED (RUN PING)"
    : "OFFLINE / LOCAL FALLBACK";

  return (
    <div className="osdr-diag-overlay" onClick={onClose}>
      <div className="osdr-diag-modal" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="osdr-diag-header">
          <div className="osdr-diag-title">
            <span className="osdr-diag-icon">📡</span>
            <div>
              <h3>NASA OSDR Retrieval Diagnostics</h3>
              <span className="osdr-diag-sub">Real-Time Connection Audit &amp; Data Source Attribution</span>
            </div>
          </div>
          <button className="osdr-diag-close" onClick={onClose}>×</button>
        </div>

        {/* Live Status Pill Bar */}
        <div className="osdr-status-hero" style={{ borderColor: `${statusColor}44` }}>
          <div className="osdr-status-left">
            <span className="osdr-live-dot" style={{ backgroundColor: statusColor }} />
            <div>
              <div className="osdr-status-title" style={{ color: statusColor }}>
                {statusText}
              </div>
              <div className="osdr-status-detail">
                Active Source Mode: <strong>{diagnostics.sourceMode}</strong>
                {diagnostics.latencyMs && (
                  <span> · Latency: <strong>{diagnostics.latencyMs}ms</strong></span>
                )}
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
          <div className={`osdr-tax-card ${diagnostics.connectionStatus === "connected" ? "active-source" : ""}`}>
            <div className="tax-badge live">1. live_api</div>
            <div className="tax-count">
              {diagnostics.dataSources?.live_api?.totalRuntimeFetches || 0} fetches
            </div>
            <p className="tax-desc">
              Direct runtime HTTP calls to official NASA OSDR REST endpoints for real-time study discovery.
            </p>
            <div className="tax-substatus">
              Status: <strong>{diagnostics.connectionStatus === "connected" ? "Active at Runtime" : "Standby / Tested"}</strong>
            </div>
          </div>

          {/* 2. Cached Snapshot */}
          <div className="osdr-tax-card">
            <div className="tax-badge cached">2. cached_snapshot</div>
            <div className="tax-count">
              {diagnostics.dataSources?.cached_snapshot?.count || 0} dynamic studies
            </div>
            <p className="tax-desc">
              In-memory cache of live-fetched OSDR studies retained for instant repeat reference in this session.
            </p>
            <div className="tax-substatus">
              Indexed: <strong>{diagnostics.dataSources?.cached_snapshot?.dynamicStudyIds?.length ? diagnostics.dataSources.cached_snapshot.dynamicStudyIds.join(", ") : "None yet (fetches on-demand)"}</strong>
            </div>
          </div>

          {/* 3. Local Curated Mapping */}
          <div className="osdr-tax-card">
            <div className="tax-badge local">3. local_curated_mapping</div>
            <div className="tax-count">
              {diagnostics.dataSources?.local_curated_mapping?.count || 13} mapped
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
              {diagnostics.dataSources?.static_seeded_examples?.count || 13} studies
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
              {diagnostics.lastSuccessfulFetch ? new Date(diagnostics.lastSuccessfulFetch).toLocaleString() : "None in current session"}
            </span>
          </div>
          <div className="telemetry-row">
            <span className="tel-label">Last Checked At:</span>
            <span className="tel-val">
              {diagnostics.lastCheckedAt ? new Date(diagnostics.lastCheckedAt).toLocaleString() : "Never"}
            </span>
          </div>
          <div className="telemetry-row">
            <span className="tel-label">Last Fetch Error:</span>
            <span className={`tel-val ${diagnostics.lastFetchError ? "error-text" : "none-text"}`}>
              {diagnostics.lastFetchError || "None (0 errors)"}
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

        {/* Modal Footer */}
        <div className="osdr-diag-footer">
          <div className="footer-note">
            🛡️ <em>Live connectivity is only asserted when real HTTP requests to <code>osdr.nasa.gov</code> succeed at runtime.</em>
          </div>
          <button className="ctrl-btn-small" onClick={onClose}>Close Diagnostics</button>
        </div>
      </div>
    </div>
  );
}
