import React, { useState, useEffect } from "react";
import {
  fetchAwgSuggestions,
  fetchAwgRandomPair,
  fetchAwgCompatibility,
  searchOsdrCatalog,
  fetchStudies,
} from "../api.js";

// Studies currently available in this grounded comparison context
const CONTEXTUAL_POPULAR_STUDIES = [
  { id: "OSD-679", label: "OSD-679 (Retina RNA-seq HDT)", tissue: "Retina", assay: "RNA-seq" },
  { id: "OSD-680", label: "OSD-680 (Retina Proteomics HDT)", tissue: "Retina", assay: "Proteomics" },
  { id: "OSD-681", label: "OSD-681 (Retina Metabolomics HDT)", tissue: "Retina", assay: "Metabolomics" },
  { id: "OSD-583", label: "OSD-583 (ISS RR-9 Eye IOP & Transcriptomics)", tissue: "Eye / IOP", assay: "Transcriptomics" },
  { id: "OSD-87",  label: "OSD-87 (STS-135 Retina Microarray)", tissue: "Retina", assay: "Microarray" },
  { id: "OSD-194", label: "OSD-194 (ISS RR-3 Retina RNA-seq)", tissue: "Retina", assay: "RNA-seq" },
  { id: "OSD-758", label: "OSD-758 (ISS Centrifugation 1g vs Microgravity)", tissue: "Retina", assay: "RNA-seq" },
  { id: "OSD-759", label: "OSD-759 (ISS Artificial Gravity Proteomics)", tissue: "Retina", assay: "Proteomics" },
];

const SEARCH_PRESETS = [
  { label: "All Spaceflight", q: "spaceflight" },
  { label: "Retina / SANS", q: "retina eye fluid shift" },
  { label: "Head-Down Tilt", q: "head-down tilt bed rest" },
  { label: "Proteomics", q: "proteomics mass spectrometry" },
  { label: "RNA-seq / Transcriptomics", q: "RNA-seq transcriptomics" },
  { label: "ISS Rodent Research", q: "rodent research ISS" },
  { label: "Liver / Metabolism", q: "liver metabolism" },
];

export default function AwgGuidedChooser({
  initialSuggestions,
  recentPair,
  onRunComparison,
  onRunRandom,
  onSelectCommand,
}) {
  // Mode switcher: "contextual" (Studies available in this comparison context) vs "repository" (Broader repository search)
  const [scopeMode, setScopeMode] = useState("contextual"); // "contextual" | "repository"

  // Contextual tabs
  const [activeTab, setActiveTab] = useState("suggested"); // "suggested" | "random" | "custom" | "help"
  const [customA, setCustomA] = useState("OSD-679");
  const [customB, setCustomB] = useState("OSD-680");
  const [suggestions, setSuggestions] = useState(initialSuggestions || []);
  const [loadingSuggestions, setLoadingSuggestions] = useState(!initialSuggestions?.length);

  // Random pair roll state
  const [rollingRandom, setRollingRandom] = useState(false);
  const [randomRollResult, setRandomRollResult] = useState(null);

  // Live compatibility scoring for custom inputs
  const [customScore, setCustomScore] = useState(null);
  const [scoringCustom, setScoringCustom] = useState(false);

  // Broader Repository Search State
  const [repoQuery, setRepoQuery] = useState("retina");
  const [isLiveSearch, setIsLiveSearch] = useState(false);
  const [searchingRepo, setSearchingRepo] = useState(false);
  const [repoResults, setRepoResults] = useState([]);
  const [repoSearched, setRepoSearched] = useState(false);

  useEffect(() => {
    if (!suggestions || suggestions.length === 0) {
      setLoadingSuggestions(true);
      fetchAwgSuggestions()
        .then((res) => {
          setSuggestions(res.suggestions || []);
        })
        .catch(() => {})
        .finally(() => setLoadingSuggestions(false));
    }
  }, []);

  // Update live compatibility score when custom inputs change
  useEffect(() => {
    const a = customA.trim().toUpperCase();
    const b = customB.trim().toUpperCase();
    if (a && b && a !== b && a.startsWith("OSD-") && b.startsWith("OSD-")) {
      setScoringCustom(true);
      fetchAwgCompatibility(a, b)
        .then((res) => {
          setCustomScore(res);
        })
        .catch(() => {
          setCustomScore(null);
        })
        .finally(() => setScoringCustom(false));
    } else {
      setCustomScore(null);
    }
  }, [customA, customB]);

  // Execute broader repository search
  const handleSearchRepository = async (queryToUse, liveMode = isLiveSearch) => {
    const q = (queryToUse != null ? queryToUse : repoQuery).trim();
    setSearchingRepo(true);
    setRepoSearched(true);
    try {
      const results = await searchOsdrCatalog(q, { isLive: liveMode, limit: 12 });
      setRepoResults(results || []);
    } catch (err) {
      console.error("Repository search failed:", err);
      setRepoResults([]);
    } finally {
      setSearchingRepo(false);
    }
  };

  // Initial search when switching to repository tab
  useEffect(() => {
    if (scopeMode === "repository" && !repoSearched) {
      handleSearchRepository("retina spaceflight", isLiveSearch);
    }
  }, [scopeMode]);

  const handleRollRandom = async () => {
    setRollingRandom(true);
    try {
      const res = await fetchAwgRandomPair();
      setRandomRollResult(res);
    } catch (err) {
      console.error("Failed to roll random pair:", err);
    } finally {
      setRollingRandom(false);
    }
  };

  const handleExecuteCustom = (e) => {
    e?.preventDefault?.();
    const a = customA.trim().toUpperCase();
    const b = customB.trim().toUpperCase();
    if (a && b) {
      onRunComparison?.(a, b);
    }
  };

  return (
    <div className="awg-chooser-panel">
      {/* Header Banner */}
      <div className="awg-chooser-header">
        <div className="awg-chooser-title-group">
          <span className="awg-chooser-badge">✦ AWG STUDY COMPARISON</span>
          <h3 className="awg-chooser-title">Select Two OSDR Studies to Co-Analyze</h3>
          <p className="awg-chooser-desc">
            The Analysis Working Group compares complementary datasets across multi-omics assay layers to uncover shared spaceflight mechanisms, pathway convergences, and candidate countermeasures.
          </p>
        </div>
      </div>

      {/* Scope Mode Switcher: Contextual Comparison vs. Broader Repository Search */}
      <div className="awg-scope-toggle-bar">
        <div className="scope-toggle-btn-group">
          <button
            type="button"
            className={`scope-toggle-btn ${scopeMode === "contextual" ? "active" : ""}`}
            onClick={() => setScopeMode("contextual")}
            title="Studies and verified multi-omics pairs currently available in this grounded comparison context"
          >
            <span>🔬</span> Contextual Studies
            <span className="scope-sub-pill">Active Comparison Context</span>
          </button>
          <button
            type="button"
            className={`scope-toggle-btn ${scopeMode === "repository" ? "active" : ""}`}
            onClick={() => setScopeMode("repository")}
            title="Live catalog search across the entire NASA OSDR repository"
          >
            <span>🌐</span> Broader Repository Search
            <span className="scope-sub-pill">Live OSDR Search Index</span>
          </button>
        </div>

        <div className="scope-context-notice">
          {scopeMode === "contextual" ? (
            <span>
              ℹ️ <strong>Grounded Context:</strong> Studies currently available in this grounded comparison context (pre-computed multi-omics pairs &amp; benchmark accessions).
            </span>
          ) : (
            <span>
              🌐 <strong>Broader Repository:</strong> Querying the complete NASA Open Science Data Repository catalog and live OSDR indexing API.
            </span>
          )}
        </div>
      </div>

      {/* MODE 1: CONTEXTUAL COMPARISON STUDIES */}
      {scopeMode === "contextual" && (
        <>
          {/* Navigation Tabs */}
          <div className="awg-chooser-tabs">
            <button
              className={`awg-chooser-tab ${activeTab === "suggested" ? "active" : ""}`}
              onClick={() => setActiveTab("suggested")}
            >
              <span>✨</span> Suggested Compatible Pairs ({suggestions.length || 4})
            </button>
            <button
              className={`awg-chooser-tab ${activeTab === "random" ? "active" : ""}`}
              onClick={() => {
                setActiveTab("random");
                if (!randomRollResult) handleRollRandom();
              }}
            >
              <span>🎲</span> System-Selected Random Pair
            </button>
            <button
              className={`awg-chooser-tab ${activeTab === "custom" ? "active" : ""}`}
              onClick={() => setActiveTab("custom")}
            >
              <span>🔍</span> Enter Custom Study IDs
            </button>
            <button
              className={`awg-chooser-tab ${activeTab === "help" ? "active" : ""}`}
              onClick={() => setActiveTab("help")}
            >
              <span>📖</span> Command Reference
            </button>
          </div>

          {/* Tab Content: Suggested Compatible Pairs */}
          {activeTab === "suggested" && (
            <div className="awg-tab-body">
              {recentPair && recentPair.studyA && recentPair.studyB && (
                <div className="awg-recent-pair-card">
                  <div className="recent-pair-header">
                    <span className="recent-tag">⏱️ Active In Session</span>
                    <span className="recent-ids">{recentPair.studyA} × {recentPair.studyB}</span>
                  </div>
                  <p className="recent-desc">
                    Resume comparison for previously loaded session studies ({recentPair.studyA} and {recentPair.studyB}).
                  </p>
                  <button
                    className="awg-action-btn primary"
                    onClick={() => onRunComparison?.(recentPair.studyA, recentPair.studyB)}
                  >
                    Resume Active Pair ({recentPair.studyA} × {recentPair.studyB}) ➔
                  </button>
                </div>
              )}

              {loadingSuggestions ? (
                <div className="awg-chooser-loading">
                  <div className="spinner" />
                  <span>Evaluating multi-axis compatibility for studies currently available in this grounded comparison context…</span>
                </div>
              ) : (
                <div className="awg-suggestions-grid">
                  {suggestions.map((p, idx) => (
                    <div key={idx} className="awg-suggestion-card">
                      <div className="suggestion-card-top">
                        <span className="compatibility-score-pill">
                          ⭐ {p.score || 95}/100 Match
                        </span>
                        <span className="suggestion-category-tag">{p.tag || "Multi-Omics"}</span>
                      </div>

                      <div className="suggestion-pair-titles">
                        <div className="study-node">
                          <strong className="study-code">{p.studyIds?.[0] || p.studyA?.study_id}</strong>
                          <span className="study-assay-tag">{p.studyA?.assay_measurement || "RNA-seq"}</span>
                        </div>
                        <span className="pair-x-connector">×</span>
                        <div className="study-node">
                          <strong className="study-code">{p.studyIds?.[1] || p.studyB?.study_id}</strong>
                          <span className="study-assay-tag">{p.studyB?.assay_measurement || "Proteomics"}</span>
                        </div>
                      </div>

                      <div className="suggestion-common-axis">
                        <strong>Axis:</strong> {p.commonAxis || "Spaceflight Adaptation & Fluid Shift"}
                      </div>

                      <p className="suggestion-rationale">
                        {p.whyMatched || "Matched model organism, synchronized analog factors, and complementary multi-omics assays."}
                      </p>

                      <button
                        className="awg-action-btn"
                        onClick={() =>
                          onRunComparison?.(
                            p.studyIds?.[0] || p.studyA?.study_id,
                            p.studyIds?.[1] || p.studyB?.study_id
                          )
                        }
                      >
                        Compare {p.studyIds?.[0] || p.studyA?.study_id} &amp; {p.studyIds?.[1] || p.studyB?.study_id} ➔
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab Content: System-Selected Random Pair */}
          {activeTab === "random" && (
            <div className="awg-tab-body">
              <div className="awg-random-container">
                <div className="random-intro">
                  <div className="random-icon">🎲</div>
                  <div>
                    <h4>Smart Compatibility-Scored Random Selection</h4>
                    <p>
                      Evaluates 5 scientific axes (organism match, tissue overlap, assay complementarity, shared mission/analog factors, and translational relevance) across studies currently available in this grounded comparison context.
                    </p>
                  </div>
                </div>

                {rollingRandom ? (
                  <div className="awg-chooser-loading">
                    <div className="spinner" />
                    <span>Rolling and scoring compatible OSDR study pairs in this comparison context…</span>
                  </div>
                ) : randomRollResult ? (
                  <div className="awg-random-card">
                    <div className="random-card-header">
                      <span className="system-selected-badge">🎲 SYSTEM-SELECTED PAIR</span>
                      <span className="compatibility-score-pill">
                        Score: {randomRollResult.score}/100
                      </span>
                    </div>

                    <div className="random-pair-display">
                      <div className="random-study-box">
                        <span className="box-label">STUDY 1</span>
                        <strong className="box-code">{randomRollResult.studyA.study_id}</strong>
                        <span className="box-title">{randomRollResult.studyA.title}</span>
                        <div className="box-meta">
                          <span>🔬 {randomRollResult.studyA.assay_measurement}</span>
                          <span>🧬 {randomRollResult.studyA.organism}</span>
                          <span>👁️ {randomRollResult.studyA.material_type}</span>
                        </div>
                      </div>

                      <div className="random-vs-divider">
                        <span>CO-ANALYSIS</span>
                        <div className="vs-line" />
                      </div>

                      <div className="random-study-box">
                        <span className="box-label">STUDY 2</span>
                        <strong className="box-code">{randomRollResult.studyB.study_id}</strong>
                        <span className="box-title">{randomRollResult.studyB.title}</span>
                        <div className="box-meta">
                          <span>🔬 {randomRollResult.studyB.assay_measurement}</span>
                          <span>🧬 {randomRollResult.studyB.organism}</span>
                          <span>👁️ {randomRollResult.studyB.material_type}</span>
                        </div>
                      </div>
                    </div>

                    <div className="random-insights-box">
                      <div className="insight-row">
                        <strong>Common Scientific Axis:</strong>
                        <span>{randomRollResult.commonScientificAxis}</span>
                      </div>
                      <div className="insight-row">
                        <strong>Why this pair was chosen:</strong>
                        <span>{randomRollResult.whyChosen}</span>
                      </div>
                    </div>

                    <div className="random-actions">
                      <button
                        className="awg-action-btn primary"
                        onClick={() =>
                          onRunComparison?.(
                            randomRollResult.studyA.study_id,
                            randomRollResult.studyB.study_id
                          )
                        }
                      >
                        Run Comparison for this Pair ➔
                      </button>
                      <button className="awg-action-btn secondary" onClick={handleRollRandom}>
                        🎲 Re-Roll Another Random Pair
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="awg-action-btn primary" onClick={handleRollRandom}>
                    🎲 Roll Random Pair Now
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Tab Content: Enter Custom Study IDs */}
          {activeTab === "custom" && (
            <div className="awg-tab-body">
              <form className="awg-custom-form" onSubmit={handleExecuteCustom}>
                <div className="custom-inputs-row">
                  <div className="input-group">
                    <label>First Study Accession (Study A)</label>
                    <input
                      type="text"
                      value={customA}
                      onChange={(e) => setCustomA(e.target.value)}
                      placeholder="e.g. OSD-679"
                      className="awg-osd-input"
                    />
                  </div>

                  <div className="input-divider">×</div>

                  <div className="input-group">
                    <label>Second Study Accession (Study B)</label>
                    <input
                      type="text"
                      value={customB}
                      onChange={(e) => setCustomB(e.target.value)}
                      placeholder="e.g. OSD-680 or OSD-681"
                      className="awg-osd-input"
                    />
                  </div>
                </div>

                {/* Quick Picker Chips */}
                <div className="quick-picker-section">
                  <span className="quick-picker-label">
                    Studies Available in Grounded Comparison Context:
                  </span>
                  <div className="quick-chips-wrap">
                    {CONTEXTUAL_POPULAR_STUDIES.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="quick-study-chip"
                        onClick={() => {
                          if (!customA || customA === s.id) {
                            setCustomA(s.id);
                          } else {
                            setCustomB(s.id);
                          }
                        }}
                        title={`${s.label} - ${s.tissue} ${s.assay}`}
                      >
                        <strong>{s.id}</strong> ({s.assay})
                      </button>
                    ))}
                  </div>
                </div>

                {/* Live Compatibility Score Card */}
                {scoringCustom && (
                  <div className="custom-score-evaluating">
                    <span className="spinner" /> Evaluating pair compatibility across OSDR metadata…
                  </div>
                )}

                {customScore && !scoringCustom && (
                  <div className="custom-score-preview">
                    <div className="preview-top">
                      <span className="preview-title">
                        Compatibility Preview: <strong>{customScore.studyA}</strong> × <strong>{customScore.studyB}</strong>
                      </span>
                      <span className="preview-score-badge">
                        {customScore.totalScore}/100 Match Score
                      </span>
                    </div>
                    <div className="preview-axis">
                      <strong>Common Axis:</strong> {customScore.commonScientificAxis}
                    </div>
                    <div className="preview-rationale">
                      <strong>Why it matches:</strong> {customScore.whyChosen}
                    </div>
                  </div>
                )}

                <div className="custom-submit-row">
                  <button
                    type="submit"
                    className="awg-action-btn primary"
                    disabled={!customA.trim() || !customB.trim()}
                  >
                    Compare {customA.trim().toUpperCase()} &amp; {customB.trim().toUpperCase()} ➔
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Tab Content: Help & Command Reference */}
          {activeTab === "help" && (
            <div className="awg-tab-body">
              <div className="awg-help-guide">
                <h4>AWG Workflow Commands</h4>
                <div className="command-guide-grid">
                  <div
                    className="command-guide-card"
                    onClick={() => onSelectCommand?.("/awg")}
                  >
                    <code>/awg</code>
                    <p>Opens this guided comparison chooser.</p>
                  </div>

                  <div
                    className="command-guide-card"
                    onClick={() => onSelectCommand?.("/awg compare OSD-679 OSD-680")}
                  >
                    <code>/awg compare OSD-679 OSD-680</code>
                    <p>Direct multi-omics comparison between two specific accessions.</p>
                  </div>

                  <div
                    className="command-guide-card"
                    onClick={() => onSelectCommand?.("/awg random")}
                  >
                    <code>/awg random</code>
                    <p>Rolls and executes a high-compatibility system-selected pair.</p>
                  </div>

                  <div
                    className="command-guide-card"
                    onClick={() => onSelectCommand?.("/awg meme")}
                  >
                    <code>/awg meme</code>
                    <p>Generates an experimental, scientifically grounded outreach meme concept for the active pair.</p>
                  </div>

                  <div
                    className="command-guide-card"
                    onClick={() => onSelectCommand?.("/awg help")}
                  >
                    <code>/awg help</code>
                    <p>Displays the detailed AWG workflow guide &amp; multi-omics synthesis rules.</p>
                  </div>
                </div>

                <div className="scoring-criteria-box">
                  <h5>How Compatibility is Scored</h5>
                  <ul>
                    <li><strong>Model Organism (25 pts):</strong> Matched rodent or mammalian biology (*Rattus norvegicus*, *Mus musculus*).</li>
                    <li><strong>Tissue Overlap (25 pts):</strong> Identical or interconnected tissue systems (Retina, Choroid, CSF, Vascular barrier).</li>
                    <li><strong>Assay Complementarity (25 pts):</strong> Cross-layer multi-omics (RNA-seq × Proteomics, Transcriptomics × Metabolomics).</li>
                    <li><strong>Experiment Factor (15 pts):</strong> Head-Down Tilt bedrest, ISS on-orbit spaceflight, or Centrifugation.</li>
                    <li><strong>Translational Relevance (10 pts):</strong> Relevance to SANS, blood-retinal barrier remodeling, and countermeasure targets.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* MODE 2: BROADER OSDR REPOSITORY SEARCH */}
      {scopeMode === "repository" && (
        <div className="awg-tab-body">
          <div className="awg-repo-search-panel">
            {/* Search Input Bar */}
            <div className="repo-search-bar-row">
              <div className="repo-input-wrap">
                <span className="repo-search-icon">🔍</span>
                <input
                  type="text"
                  value={repoQuery}
                  onChange={(e) => setRepoQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSearchRepository(repoQuery, isLiveSearch);
                  }}
                  placeholder="Search full repository by tissue, assay, factor, or accession (e.g. retina, proteomics, OSD-679)..."
                  className="repo-search-input"
                />
                {repoQuery && (
                  <button className="repo-clear-btn" onClick={() => setRepoQuery("")}>
                    ✕
                  </button>
                )}
              </div>

              <button
                type="button"
                className="awg-action-btn primary repo-submit-btn"
                onClick={() => handleSearchRepository(repoQuery, isLiveSearch)}
                disabled={searchingRepo}
              >
                {searchingRepo ? (
                  <>
                    <span className="spinner" /> Searching…
                  </>
                ) : (
                  "Search Repository"
                )}
              </button>
            </div>

            {/* Live Search Toggle & Filter Presets */}
            <div className="repo-filters-bar">
              <div className="repo-presets-wrap">
                <span className="presets-label">Presets:</span>
                {SEARCH_PRESETS.map((p, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="repo-preset-chip"
                    onClick={() => {
                      setRepoQuery(p.q);
                      handleSearchRepository(p.q, isLiveSearch);
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <label className="repo-live-toggle" title="Toggle between local indexed repository and live NASA OSDR API">
                <input
                  type="checkbox"
                  checked={isLiveSearch}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setIsLiveSearch(next);
                    handleSearchRepository(repoQuery, next);
                  }}
                />
                <span>Query Live NASA OSDR API</span>
              </label>
            </div>

            {/* Active Study Selection Staging Dock */}
            <div className="repo-pair-dock">
              <div className="dock-title">
                <span>🎯</span> Selected Pair Staging:
              </div>
              <div className="dock-inputs">
                <div className="dock-slot">
                  <span className="slot-badge">STUDY A:</span>
                  <input
                    type="text"
                    value={customA}
                    onChange={(e) => setCustomA(e.target.value)}
                    placeholder="OSD-..."
                    className="dock-osd-input"
                  />
                </div>
                <span className="dock-x">×</span>
                <div className="dock-slot">
                  <span className="slot-badge">STUDY B:</span>
                  <input
                    type="text"
                    value={customB}
                    onChange={(e) => setCustomB(e.target.value)}
                    placeholder="OSD-..."
                    className="dock-osd-input"
                  />
                </div>
                <button
                  type="button"
                  className="awg-action-btn primary dock-compare-btn"
                  onClick={() => onRunComparison?.(customA.trim().toUpperCase(), customB.trim().toUpperCase())}
                  disabled={!customA.trim() || !customB.trim()}
                >
                  Co-Analyze Selected Pair ({customA.trim().toUpperCase()} × {customB.trim().toUpperCase()}) ➔
                </button>
              </div>
            </div>

            {/* Search Results List */}
            {searchingRepo ? (
              <div className="awg-chooser-loading">
                <div className="spinner" />
                <span>Searching complete NASA OSDR catalog for "{repoQuery}"…</span>
              </div>
            ) : repoResults.length > 0 ? (
              <div className="repo-results-container">
                <div className="repo-results-header">
                  <span>Found <strong>{repoResults.length}</strong> studies matching "{repoQuery}":</span>
                  <span className="repo-tip-text">Click "Set A" or "Set B" to stage studies for co-analysis</span>
                </div>
                <div className="repo-results-grid">
                  {repoResults.map((study, idx) => {
                    const sid = study.study_id || `OSD-${idx + 1}`;
                    const isSelectedA = customA.toUpperCase() === sid.toUpperCase();
                    const isSelectedB = customB.toUpperCase() === sid.toUpperCase();

                    return (
                      <div key={idx} className={`repo-study-card ${isSelectedA || isSelectedB ? "staged-card" : ""}`}>
                        <div className="repo-card-top">
                          <strong className="repo-card-id">{sid}</strong>
                          <div className="repo-card-tags">
                            {study.assay_measurement && (
                              <span className="repo-tag assay">{study.assay_measurement}</span>
                            )}
                            {study.organism && (
                              <span className="repo-tag organism">{study.organism}</span>
                            )}
                          </div>
                        </div>

                        <div className="repo-card-title" title={study.title}>
                          {study.title || "NASA OSDR Spaceflight Dataset"}
                        </div>

                        {study.material_type && (
                          <div className="repo-card-meta">
                            <span>Tissue: <strong>{study.material_type}</strong></span>
                            {study.file_count != null && <span>Files: <strong>{study.file_count}</strong></span>}
                          </div>
                        )}

                        <div className="repo-card-actions">
                          <button
                            type="button"
                            className={`repo-set-btn ${isSelectedA ? "active" : ""}`}
                            onClick={() => setCustomA(sid)}
                          >
                            {isSelectedA ? "✓ Staged as Study A" : "Set Study A"}
                          </button>
                          <button
                            type="button"
                            className={`repo-set-btn ${isSelectedB ? "active" : ""}`}
                            onClick={() => setCustomB(sid)}
                          >
                            {isSelectedB ? "✓ Staged as Study B" : "Set Study B"}
                          </button>
                          <a
                            className="repo-view-link"
                            href={`https://osdr.nasa.gov/bio/repo/data/studies/${sid}`}
                            target="_blank"
                            rel="noreferrer"
                            title={`Open ${sid} on NASA OSDR portal`}
                          >
                            OSDR ↗
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : repoSearched ? (
              <div className="repo-no-results">
                <span>No matching studies found in NASA OSDR catalog for "{repoQuery}". Try searching with broader terms like "spaceflight", "retina", or "head-down tilt".</span>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
