import { ArrowRight, Database, Radar, ShieldCheck, Sparkles, Users } from "lucide-react";

export default function AwgRadarInlineCard({ details, onOpenRadar, onRunCommand }) {
  if (!details) return null;

  const counts = details.counts || {};
  const topReleases = details.topReleases || [];
  const topLeadSignals = details.topLeadSignals || [];
  const scopeAudit = details.scopeAudit || {};

  return (
    <div className="rr-inline-card" data-testid="awg-radar-inline-card">
      <div className="rr-inline-header">
        <div className="rr-inline-title-wrap">
          <span className="rr-radar-icon sm" aria-hidden="true">
            <Radar size={15} />
          </span>
          <div>
            <div className="rr-inline-title">NASA OSDR &amp; AWG Release Radar</div>
            <div className="rr-inline-sub">
              {details.currentQuarterLabel || "2026-Q4"} (Prev: {details.previousQuarterLabel || "2026-Q3"}) · Updated{" "}
              {String(details.generatedAt || "").slice(0, 10) || "Snapshot"}
            </div>
          </div>
        </div>

        <div className="rr-inline-open-btns">
          <button
            type="button"
            className="rr-inline-open-btn primary"
            onClick={() => onOpenRadar?.("releases")}
            data-testid="rr-inline-open-releases"
          >
            <Database size={13} />
            <span>Open Releases ({counts.totalReleases ?? topReleases.length})</span>
          </button>
          <button
            type="button"
            className="rr-inline-open-btn"
            onClick={() => onOpenRadar?.("leads")}
            data-testid="rr-inline-open-leads"
          >
            <Users size={13} />
            <span>Open AWG Leads ({counts.totalLeadSignals ?? topLeadSignals.length})</span>
          </button>
        </div>
      </div>

      {/* Compact Metric Strip */}
      <div className="rr-inline-metrics">
        <div className="rr-inline-stat">
          <span className="rr-stat-num">{counts.monthReleases ?? 0}</span>
          <span className="rr-stat-label">Last 30 Days</span>
        </div>
        <div className="rr-inline-stat">
          <span className="rr-stat-num">{counts.prevQuarterReleases ?? 0}</span>
          <span className="rr-stat-label">{details.previousQuarterLabel || "2026-Q3"}</span>
        </div>
        <div className="rr-inline-stat is-accent">
          <span className="rr-stat-num">{counts.sansReleases ?? 0}</span>
          <span className="rr-stat-label">SANS / Ocular</span>
        </div>
        <div className="rr-inline-stat is-amber">
          <span className="rr-stat-num">{counts.preOsdrSignals ?? 0}</span>
          <span className="rr-stat-label">Pre-OSDR Signals</span>
        </div>
        <div className="rr-inline-stat">
          <span className="rr-stat-num">{scopeAudit.filteredOutNonSpaceCount ?? 0}</span>
          <span className="rr-stat-label">Off-Topic Excluded</span>
        </div>
      </div>

      {/* Two Highlight Columns: Latest OSDR vs AWG Leads Pre-OSDR */}
      <div className="rr-inline-columns">
        <div className="rr-inline-col">
          <div className="rr-inline-col-title">
            <Database size={13} />
            <span>Newest OSDR Releases</span>
          </div>
          {topReleases.slice(0, 3).map((r) => (
            <div key={r.studyId} className="rr-inline-item">
              <div className="rr-inline-item-meta">
                <span className="rr-osd-id">{r.studyId}</span>
                <span className={`rr-sub-tag ${r.sansRelevant ? "is-sans" : ""}`}>{r.subgroup}</span>
                <span className="rr-date-meta">{r.releaseDate}</span>
              </div>
              <div className="rr-inline-item-title">{r.title}</div>
              <div className="rr-inline-item-actions">
                <span className="rr-item-org">{r.organism}</span>
                {r.bestAnchor ? (
                  <button
                    type="button"
                    className="rr-mini-action"
                    onClick={() => onRunCommand?.(`/awg compare ${r.studyId} ${r.bestAnchor.studyId}`)}
                  >
                    <span>Compare × {r.bestAnchor.studyId}</span>
                    <ArrowRight size={11} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="rr-mini-action"
                    onClick={() => onRunCommand?.(`/awg analyze ${r.studyId}`)}
                  >
                    <span>Inspect</span>
                    <ArrowRight size={11} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="rr-inline-col">
          <div className="rr-inline-col-title">
            <Sparkles size={13} />
            <span>AWG Lead Pre-OSDR &amp; Paper Watch</span>
          </div>
          {topLeadSignals.slice(0, 3).map((sig) => (
            <div key={sig.id} className="rr-inline-item">
              <div className="rr-inline-item-meta">
                <span
                  className={`rr-status-pill ${
                    sig.status === "pre_osdr_signal" ? "is-pre" : "is-live-osdr"
                  }`}
                >
                  {sig.status === "pre_osdr_signal" ? "Pre-OSDR" : "Live OSDR"}
                </span>
                <span className="rr-lead-sub-tag">{sig.leadName}</span>
                <span className="rr-date-meta">{sig.publishedDate}</span>
              </div>
              <div className="rr-inline-item-title">{sig.title}</div>
              <div className="rr-inline-item-actions">
                <span className="rr-item-org">{sig.journal}</span>
                {sig.concepts?.[0] && (
                  <button
                    type="button"
                    className="rr-mini-action"
                    onClick={() =>
                      onRunCommand?.(sig.concepts[0].command || sig.concepts[0].prompt)
                    }
                  >
                    <span>{sig.linkedOsdIds?.[0] ? `Compare ${sig.linkedOsdIds[0]}` : "Bridge"}</span>
                    <ArrowRight size={11} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rr-inline-foot">
        <ShieldCheck size={13} />
        <span>
          Strict domain scope enforced across {counts.leadsTracked || 9} GeneLab AWG Chairs + Ryan T. Scott.
        </span>
      </div>
    </div>
  );
}
