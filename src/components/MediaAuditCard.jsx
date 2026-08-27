import { useState, useEffect, useMemo } from "react";
import { fetchMediaAuditLog } from "../api.js";
import MediaProvenanceBadge from "./MediaProvenanceBadge.jsx";

export default function MediaAuditCard({ initialAuditLog, onRunCommand }) {
  const [auditList, setAuditList] = useState(initialAuditLog || []);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [copiedId, setCopiedId] = useState("");

  const refreshAudit = async () => {
    setLoading(true);
    try {
      const res = await fetchMediaAuditLog(20);
      if (res && Array.isArray(res.audit)) {
        setAuditList(res.audit);
      }
    } catch (err) {
      console.warn("Failed to refresh media audit log:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialAuditLog || initialAuditLog.length === 0) {
      refreshAudit();
    }
  }, []);

  const filteredList = useMemo(() => {
    return auditList.filter((item) => {
      if (statusFilter !== "all" && item.generationStatus !== statusFilter) {
        return false;
      }
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      const studies = (item.sourceStudyPair || []).join(" ").toLowerCase();
      const prov = (item.provider || "").toLowerCase();
      const model = (item.providerModel || "").toLowerCase();
      const id = (item.requestId || "").toLowerCase();
      const artId = (item.artifactId || "").toLowerCase();
      const dir = (item.creativeDirection || "").toLowerCase();
      return (
        studies.includes(term) ||
        prov.includes(term) ||
        model.includes(term) ||
        id.includes(term) ||
        artId.includes(term) ||
        dir.includes(term)
      );
    });
  }, [auditList, searchTerm, statusFilter]);

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(String(text));
    setCopiedId(id);
    setTimeout(() => setCopiedId(""), 2000);
  };

  return (
    <div className="awg-audit-card-container" id="awg-media-audit-root">
      {/* Header */}
      <div className="awg-audit-header">
        <div className="awg-audit-title-row">
          <span className="awg-audit-icon">🛡️</span>
          <div>
            <h3 className="awg-audit-heading">AWG Media Generation Audit & Provenance Registry</h3>
            <p className="awg-audit-sub">
              Independent, auditable execution verification across generated images, scientific motion briefs, relatable clips, and meme concepts.
            </p>
          </div>
        </div>
        <div className="awg-audit-header-actions">
          <button
            className="ctrl-btn-small"
            onClick={refreshAudit}
            disabled={loading}
            title="Refresh latest 20 provenance records"
          >
            {loading ? "Refreshing…" : "🔄 Refresh Log"}
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="awg-audit-controls">
        <div className="search-input-wrap">
          <input
            type="text"
            className="awg-audit-search"
            placeholder="Search by Study ID, Provider, Model, Request ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button className="clear-search-btn" onClick={() => setSearchTerm("")}>
              ×
            </button>
          )}
        </div>

        <div className="status-filter-pills">
          <button
            className={`filter-pill ${statusFilter === "all" ? "active" : ""}`}
            onClick={() => setStatusFilter("all")}
          >
            All ({auditList.length})
          </button>
          <button
            className={`filter-pill prov-fresh ${statusFilter === "fresh_provider" ? "active" : ""}`}
            onClick={() => setStatusFilter("fresh_provider")}
          >
            ✦ Fresh Provider
          </button>
          <button
            className={`filter-pill prov-cache ${statusFilter === "cache_hit" ? "active" : ""}`}
            onClick={() => setStatusFilter("cache_hit")}
          >
            📦 Cached Hits
          </button>
          <button
            className={`filter-pill prov-fallback ${statusFilter === "fallback" ? "active" : ""}`}
            onClick={() => setStatusFilter("fallback")}
          >
            📐 Local Fallbacks
          </button>
          <button
            className={`filter-pill prov-failed ${statusFilter === "failed" ? "active" : ""}`}
            onClick={() => setStatusFilter("failed")}
          >
            ⚠️ Failed
          </button>
        </div>
      </div>

      {/* Table of Records */}
      {filteredList.length === 0 ? (
        <div className="awg-audit-empty">
          <p>No media provenance records match the current filter.</p>
          {auditList.length === 0 && (
            <div className="audit-empty-hint">
              Run <code>/awg compare OSD-679 OSD-680</code> or <code>/awg meme</code> to generate artifacts and populate the audit log.
            </div>
          )}
        </div>
      ) : (
        <div className="awg-audit-table-wrap">
          <table className="awg-audit-table">
            <thead>
              <tr>
                <th>Status & Provenance</th>
                <th>Output / Direction</th>
                <th>Provider & Model</th>
                <th>Source Studies</th>
                <th>Latency</th>
                <th>Prompt Fingerprint</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredList.map((rec) => {
                return (
                  <tr key={rec.requestId} className={`audit-row row-${rec.generationStatus}`}>
                    <td>
                      <MediaProvenanceBadge provenance={rec} compact showInspectButton={false} />
                    </td>
                    <td>
                      <div className="audit-output-title">
                        {rec.creativeDirection || rec.artifactId}
                      </div>
                      <div className="audit-output-time">
                        {new Date(rec.createdAt).toLocaleTimeString()}
                      </div>
                    </td>
                    <td>
                      <div className="audit-provider-info">
                        <strong>{rec.provider}</strong>
                        <code>{rec.providerModel}</code>
                      </div>
                    </td>
                    <td>
                      <div className="audit-studies-cell">
                        {(rec.sourceStudyPair || []).map((sid) => (
                          <span key={sid} className="prov-study-chip">
                            {sid}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className="audit-latency">{rec.latencyMs ?? 0}ms</span>
                    </td>
                    <td>
                      <code
                        className="audit-fp-cell"
                        title={rec.promptFingerprint}
                        onClick={() => handleCopy(rec.promptFingerprint, rec.requestId + "-fp")}
                      >
                        {rec.promptFingerprint ? rec.promptFingerprint.slice(0, 10) + "…" : "—"}
                        {copiedId === rec.requestId + "-fp" && <span className="copied-tag">✓</span>}
                      </code>
                    </td>
                    <td>
                      <button
                        className="ctrl-btn-small"
                        onClick={() => setSelectedRecord(rec)}
                        title="View complete provenance certificate"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Selected Provenance Record Dialog */}
      {selectedRecord && (
        <MediaProvenanceBadge
          provenance={selectedRecord}
          showInspectButton={false}
        />
      )}

      {/* Footer quick action commands */}
      <div className="awg-audit-footer">
        <span className="audit-summary-count">
          Showing {filteredList.length} of {auditList.length} total provenance records
        </span>
        <div className="audit-actions">
          <button
            className="awg-action-chip"
            onClick={() => onRunCommand?.("/awg compare OSD-679 OSD-680")}
          >
            🔬 Run Comparison
          </button>
          <button
            className="awg-action-chip"
            onClick={() => onRunCommand?.("/awg meme")}
          >
            🎭 Run Meme Mode
          </button>
          <button
            className="awg-action-chip"
            onClick={() => onRunCommand?.("/awg help")}
          >
            ❓ Help
          </button>
        </div>
      </div>
    </div>
  );
}
