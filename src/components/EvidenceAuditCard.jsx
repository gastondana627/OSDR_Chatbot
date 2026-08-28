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
    <div className="awg-evidence-card border border-blue-900/40 bg-slate-900/90 rounded-xl p-4 my-3 text-slate-200 text-sm shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-700/60 pb-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">🔬</span>
          <div>
            <h4 className="font-semibold text-base text-slate-100 flex items-center gap-2">
              NASA OSDR Evidence &amp; Provenance Audit
              <span className="px-2 py-0.5 rounded text-xs font-mono bg-blue-950 text-blue-300 border border-blue-800">
                Authoritative Grounding
              </span>
            </h4>
            <div className="text-xs text-slate-400">
              Verified against machine-readable OSDR records &amp; peer-reviewed publications
            </div>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-lg px-2 py-1"
            title="Close Evidence Audit"
          >
            ×
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-3 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab("metadata")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeTab === "metadata"
              ? "bg-blue-600 text-white shadow"
              : "bg-slate-800 text-slate-300 hover:bg-slate-700"
          }`}
        >
          Verified Metadata ({studyMetadata.length})
        </button>
        <button
          onClick={() => setActiveTab("results")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeTab === "results"
              ? "bg-blue-600 text-white shadow"
              : "bg-slate-800 text-slate-300 hover:bg-slate-700"
          }`}
        >
          Observed Results ({observedResults.length})
        </button>
        <button
          onClick={() => setActiveTab("interpretations")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeTab === "interpretations"
              ? "bg-blue-600 text-white shadow"
              : "bg-slate-800 text-slate-300 hover:bg-slate-700"
          }`}
        >
          Interpretation &amp; Hypotheses ({interpretationClaims.length})
        </button>
        {scoreBreakdown && (
          <button
            onClick={() => setActiveTab("scoring")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === "scoring"
                ? "bg-blue-600 text-white shadow"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            Compatibility Breakdown ({scoreBreakdown.totalScore}/100)
          </button>
        )}
      </div>

      {/* Tab: Verified Metadata */}
      {activeTab === "metadata" && (
        <div className="space-y-3">
          {studyMetadata.map((meta, idx) => (
            <div
              key={meta.study_id + idx}
              className="bg-slate-950/70 border border-slate-800 rounded-lg p-3"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-blue-400 text-sm">
                    {meta.study_id}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[11px] bg-emerald-950/80 text-emerald-300 border border-emerald-800 font-mono">
                    ✓ {meta.dataQuality.toUpperCase()}
                  </span>
                </div>
                <a
                  href={meta.repositoryUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-400 hover:underline flex items-center gap-1"
                >
                  OSDR Record ↗
                </a>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-400">Organism:</span>{" "}
                  <span className="text-slate-200">{meta.organism}</span>
                </div>
                <div>
                  <span className="text-slate-400">Tissue (Exact):</span>{" "}
                  <span className="text-slate-200">{meta.tissue}</span>
                </div>
                <div>
                  <span className="text-slate-400">Assay (Verified):</span>{" "}
                  <span className="text-slate-200">{meta.assay}</span>
                </div>
                <div>
                  <span className="text-slate-400">Platform:</span>{" "}
                  <span className="text-slate-200">{meta.platform}</span>
                </div>
                <div>
                  <span className="text-slate-400">Mission &amp; Factor:</span>{" "}
                  <span className="text-slate-200">{meta.mission} ({meta.duration})</span>
                </div>
                <div>
                  <span className="text-slate-400">Factor:</span>{" "}
                  <span className="text-slate-200">{meta.factor}</span>
                </div>
              </div>
              <div className="mt-2 pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 font-mono">
                Source: {meta.sourceStatement}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab: Observed Results */}
      {activeTab === "results" && (
        <div className="space-y-3">
          {observedResults.map((res, idx) => (
            <div
              key={res.study_id + idx}
              className="bg-slate-950/70 border border-slate-800 rounded-lg p-3"
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-amber-400 text-xs">
                    [OBSERVED RESULT] {res.study_id}
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono">
                    {res.assayContext}
                  </span>
                </div>
                {res.doi && (
                  <a
                    href={`https://doi.org/${res.doi}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-blue-400 hover:underline font-mono"
                  >
                    DOI: {res.doi} ↗
                  </a>
                )}
              </div>
              <p className="text-xs text-slate-200 leading-relaxed mb-2">
                {res.finding}
              </p>
              <div className="text-[11px] text-slate-400 italic">
                Citation: {res.sourceReference}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab: Interpretation & Hypotheses */}
      {activeTab === "interpretations" && (
        <div className="space-y-3">
          {interpretationClaims.map((claim, idx) => {
            const isHypothesis = claim.subtype === "Hypothesis";
            const isCandidate = claim.subtype === "Candidate follow-up";
            const badgeClass = isHypothesis
              ? "bg-purple-950/80 text-purple-300 border-purple-800"
              : isCandidate
              ? "bg-cyan-950/80 text-cyan-300 border-cyan-800"
              : "bg-indigo-950/80 text-indigo-300 border-indigo-800";

            return (
              <div
                key={claim.topic + idx}
                className="bg-slate-950/70 border border-slate-800 rounded-lg p-3"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${badgeClass}`}>
                      {claim.badge}
                    </span>
                    <strong className="text-xs text-slate-200">{claim.topic}</strong>
                  </div>
                </div>
                <p className="text-xs text-slate-200 leading-relaxed mb-2">
                  {claim.claim}
                </p>
                <div className="text-[11px] text-slate-400 mb-1">
                  <strong>Rationale:</strong> {claim.rationale}
                </div>
                <div className="text-[11px] text-amber-300/80 font-mono bg-amber-950/30 border border-amber-900/40 rounded p-1.5">
                  ⚠️ Epistemic Limit: {claim.epistemicCaution}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tab: Scoring Breakdown */}
      {activeTab === "scoring" && scoreBreakdown && (
        <div className="space-y-3">
          <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-slate-200">Total Compatibility Score:</span>
              <span className="text-lg font-mono font-bold text-blue-400">
                {scoreBreakdown.totalScore}/100
              </span>
            </div>
            <div className="text-xs text-slate-400 mb-3">
              Readiness: <strong className="text-slate-200">{scoreBreakdown.comparisonReadiness}</strong>
            </div>

            {/* Itemized Points */}
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-300">1. Organism Match</span>
                <span className="font-mono text-emerald-400 font-semibold">{scoreBreakdown.organismMatch} / 20</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-300">2. Tissue &amp; Material Overlap</span>
                <span className="font-mono text-emerald-400 font-semibold">{scoreBreakdown.tissueOverlap} / 20</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-300">3. Exposure &amp; Platform Similarity</span>
                <span className="font-mono text-emerald-400 font-semibold">{scoreBreakdown.exposurePlatformSimilarity} / 20</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-300">4. Assay Complementarity</span>
                <span className="font-mono text-emerald-400 font-semibold">{scoreBreakdown.assayComplementarity} / 15</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-300">5. Timepoint &amp; Duration Comparability</span>
                <span className="font-mono text-emerald-400 font-semibold">{scoreBreakdown.timepointDurationComparability} / 10</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-300">6. Control-Design Comparability</span>
                <span className="font-mono text-emerald-400 font-semibold">{scoreBreakdown.controlDesignComparability} / 10</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-300">7. Publication &amp; Evidence Availability</span>
                <span className="font-mono text-emerald-400 font-semibold">{scoreBreakdown.publicationEvidenceAvailability} / 5</span>
              </div>
            </div>

            {/* Why points earned */}
            {scoreBreakdown.whyEarned?.length > 0 && (
              <div className="mt-3 pt-2 border-t border-slate-800">
                <div className="text-[11px] font-semibold text-emerald-400 mb-1">Points Earned:</div>
                <ul className="list-disc list-inside text-[11px] text-slate-300 space-y-0.5">
                  {scoreBreakdown.whyEarned.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Why points withheld */}
            {scoreBreakdown.whyWithheld?.length > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-800">
                <div className="text-[11px] font-semibold text-amber-400 mb-1">Points Withheld / Caveats:</div>
                <ul className="list-disc list-inside text-[11px] text-slate-400 space-y-0.5">
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
