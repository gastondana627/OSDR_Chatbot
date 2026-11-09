import React, { useState } from "react";

export default function EvidenceAuditCard({ evidenceMap, onClose }) {
  const [activeTab, setActiveTab] = useState("metadata"); // "metadata" | "results" | "interpretations" | "scoring"

  if (!evidenceMap) return null;

  const {
    studyMetadata = [],
    observedResults = [],
    interpretationClaims = [],
    scoreBreakdown,
    manifestA,
    manifestB,
  } = evidenceMap;

  return (
    <div className="awg-evidence-card">
      <div className="awg-ev-header">
        <div className="awg-ev-title-wrap">
          <span className="awg-ev-icon">🔬</span>
          <div>
            <h4 className="awg-ev-title">
              NASA OSDR Evidence &amp; Provenance Audit
              <span className="awg-ev-auth-pill">
                Authoritative Grounding
              </span>
            </h4>
            <div className="awg-ev-subtitle">
              Verified against machine-readable OSDR records &amp; peer-reviewed publications
            </div>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="awg-ev-close-btn"
            title="Close Evidence Audit"
          >
            ×
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="awg-ev-tabs">
        <button
          onClick={() => setActiveTab("metadata")}
          className={`awg-ev-tab-btn ${activeTab === "metadata" ? "active" : ""}`}
        >
          Verified Metadata ({studyMetadata.length})
        </button>
        <button
          onClick={() => setActiveTab("results")}
          className={`awg-ev-tab-btn ${activeTab === "results" ? "active" : ""}`}
        >
          Observed Results ({observedResults.length})
        </button>
        <button
          onClick={() => setActiveTab("interpretations")}
          className={`awg-ev-tab-btn ${activeTab === "interpretations" ? "active" : ""}`}
        >
          Interpretation &amp; Hypotheses ({interpretationClaims.length})
        </button>
        {scoreBreakdown && (
          <button
            onClick={() => setActiveTab("scoring")}
            className={`awg-ev-tab-btn ${activeTab === "scoring" ? "active" : ""}`}
          >
            Compatibility Breakdown ({scoreBreakdown.totalScore}/100)
          </button>
        )}
      </div>

      {/* Tab: Verified Metadata */}
      {activeTab === "metadata" && (
        <div className="awg-ev-stack">
          {studyMetadata.map((meta, idx) => (
            <div key={meta.study_id + idx} className="awg-ev-panel">
              <div className="awg-ev-panel-top">
                <div className="awg-ev-id-row">
                  <span className="awg-ev-study-id">{meta.study_id}</span>
                  <span className="awg-ev-verified-pill">
                    ✓ {meta.dataQuality.toUpperCase()}
                  </span>
                </div>
                <a
                  href={meta.repositoryUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="awg-ev-link"
                >
                  OSDR Record ↗
                </a>
              </div>

              <div className="awg-ev-meta-grid">
                <div>
                  <span className="awg-ev-label">Organism:</span>{" "}
                  <span className="awg-ev-value">{meta.organism}</span>
                </div>
                <div>
                  <span className="awg-ev-label">Tissue (Exact):</span>{" "}
                  <span className="awg-ev-value">{meta.tissue}</span>
                </div>
                <div>
                  <span className="awg-ev-label">Assay (Verified):</span>{" "}
                  <span className="awg-ev-value">{meta.assay}</span>
                </div>
                <div>
                  <span className="awg-ev-label">Platform:</span>{" "}
                  <span className="awg-ev-value">{meta.platform}</span>
                </div>
                <div>
                  <span className="awg-ev-label">Mission &amp; Factor:</span>{" "}
                  <span className="awg-ev-value">{meta.mission} ({meta.duration})</span>
                </div>
                <div>
                  <span className="awg-ev-label">Factor:</span>{" "}
                  <span className="awg-ev-value">{meta.factor}</span>
                </div>
              </div>
              <div className="awg-ev-source-foot">
                Source: {meta.sourceStatement}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab: Observed Results */}
      {activeTab === "results" && (
        <div className="awg-ev-stack">
          {observedResults.map((res, idx) => (
            <div key={res.study_id + idx} className="awg-ev-panel">
              <div className="awg-ev-panel-top">
                <div className="awg-ev-id-row">
                  <span className="awg-ev-observed-tag">
                    [OBSERVED RESULT] {res.study_id}
                  </span>
                  <span className="awg-ev-assay-ctx">{res.assayContext}</span>
                </div>
                {res.doi && (
                  <a
                    href={`https://doi.org/${res.doi}`}
                    target="_blank"
                    rel="noreferrer"
                    className="awg-ev-link mono"
                  >
                    DOI: {res.doi} ↗
                  </a>
                )}
              </div>
              <p className="awg-ev-body-copy">{res.finding}</p>
              <div className="awg-ev-citation">
                Citation: {res.sourceReference}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab: Interpretation & Hypotheses */}
      {activeTab === "interpretations" && (
        <div className="awg-ev-stack">
          {interpretationClaims.map((claim, idx) => {
            const isHypothesis = claim.subtype === "Hypothesis";
            const isCandidate = claim.subtype === "Candidate follow-up";
            const variantClass = isHypothesis
              ? "is-hypothesis"
              : isCandidate
              ? "is-candidate"
              : "is-interpretation";

            return (
              <div key={claim.topic + idx} className="awg-ev-panel">
                <div className="awg-ev-panel-top">
                  <div className="awg-ev-id-row">
                    <span className={`awg-ev-claim-badge ${variantClass}`}>
                      {claim.badge}
                    </span>
                    <strong className="awg-ev-claim-topic">{claim.topic}</strong>
                  </div>
                </div>
                <p className="awg-ev-body-copy">{claim.claim}</p>
                <div className="awg-ev-rationale">
                  <strong>Rationale:</strong> {claim.rationale}
                </div>
                <div className="awg-ev-caution-box">
                  ⚠️ Epistemic Limit: {claim.epistemicCaution}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tab: Scoring Breakdown */}
      {activeTab === "scoring" && scoreBreakdown && (
        <div className="awg-ev-stack">
          <div className="awg-ev-panel is-scoring">
            <div className="awg-ev-score-hero">
              <span className="awg-ev-score-hero-label">Total Compatibility Score:</span>
              <span className="awg-ev-score-hero-val">
                {scoreBreakdown.totalScore}/100
              </span>
            </div>
            <div className="awg-ev-readiness">
              Readiness: <strong>{scoreBreakdown.comparisonReadiness}</strong>
            </div>

            {/* Itemized Points */}
            <div className="awg-ev-score-rows">
              <div className="awg-ev-score-row">
                <span className="awg-ev-score-name">1. Organism Match</span>
                <span className="awg-ev-score-pts">{scoreBreakdown.organismMatch} / 20</span>
              </div>
              <div className="awg-ev-score-row">
                <span className="awg-ev-score-name">2. Tissue &amp; Material Overlap</span>
                <span className="awg-ev-score-pts">{scoreBreakdown.tissueOverlap} / 20</span>
              </div>
              <div className="awg-ev-score-row">
                <span className="awg-ev-score-name">3. Exposure &amp; Platform Similarity</span>
                <span className="awg-ev-score-pts">{scoreBreakdown.exposurePlatformSimilarity} / 20</span>
              </div>
              <div className="awg-ev-score-row">
                <span className="awg-ev-score-name">4. Assay Complementarity</span>
                <span className="awg-ev-score-pts">{scoreBreakdown.assayComplementarity} / 15</span>
              </div>
              <div className="awg-ev-score-row">
                <span className="awg-ev-score-name">5. Timepoint &amp; Duration Comparability</span>
                <span className="awg-ev-score-pts">{scoreBreakdown.timepointDurationComparability} / 10</span>
              </div>
              <div className="awg-ev-score-row">
                <span className="awg-ev-score-name">6. Control-Design Comparability</span>
                <span className="awg-ev-score-pts">{scoreBreakdown.controlDesignComparability} / 10</span>
              </div>
              <div className="awg-ev-score-row">
                <span className="awg-ev-score-name">7. Publication &amp; Evidence Availability</span>
                <span className="awg-ev-score-pts">{scoreBreakdown.publicationEvidenceAvailability} / 5</span>
              </div>
            </div>

            {/* Why points earned */}
            {scoreBreakdown.whyEarned?.length > 0 && (
              <div className="awg-ev-score-notes earned">
                <div className="awg-ev-notes-heading earned">Points Earned:</div>
                <ul className="awg-ev-notes-list">
                  {scoreBreakdown.whyEarned.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Why points withheld */}
            {scoreBreakdown.whyWithheld?.length > 0 && (
              <div className="awg-ev-score-notes withheld">
                <div className="awg-ev-notes-heading withheld">Points Withheld / Caveats:</div>
                <ul className="awg-ev-notes-list muted">
                  {scoreBreakdown.whyWithheld.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
