import React, { useState } from "react";

export default function AccessionValidationCard({
  validation,
  onRunCommand,
  onConfirmReplacement,
}) {
  const [selectedReplacement, setSelectedReplacement] = useState("");
  const [customSecondAccession, setCustomSecondAccession] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);

  if (!validation) return null;

  const {
    validationStatus,
    requestedPair = [],
    resolvedPair = null,
    errorMessage,
    userMessage,
    failedAccession,
    contextualMatches = [],
  } = validation;

  const studyA = requestedPair[0] || "OSD-679";
  const isIdentical = validationStatus === "identical_accessions";
  const isSingle = validationStatus === "single_accession";
  const isUnresolved = validationStatus === "unresolved_accession";
  const isMalformed = validationStatus === "malformed_accession";

  // Filter out the first study from suggestions
  const suggestedReplacements = contextualMatches
    .filter((m) => m.study_id !== studyA)
    .slice(0, 4);

  const handleConfirmCustom = (e) => {
    e?.preventDefault?.();
    const cleanSecond = customSecondAccession.trim().toUpperCase();
    if (!cleanSecond) return;
    const formattedSecond = cleanSecond.startsWith("OSD-") ? cleanSecond : `OSD-${cleanSecond.replace(/[^0-9]/g, "")}`;
    if (formattedSecond === studyA) {
      alert(`Please choose a distinct study. ${studyA} is already selected as the first accession.`);
      return;
    }
    if (onConfirmReplacement) {
      onConfirmReplacement(studyA, formattedSecond);
    } else if (onRunCommand) {
      onRunCommand(`/awg compare ${studyA} ${formattedSecond}`);
    }
  };

  const handleSelectSuggestedPair = (suggestedB) => {
    if (onConfirmReplacement) {
      onConfirmReplacement(studyA, suggestedB);
    } else if (onRunCommand) {
      onRunCommand(`/awg compare ${studyA} ${suggestedB}`);
    }
  };

  return (
    <div className="awg-validation-card" id="awg-accession-validation-state">
      {/* Header Badge & Title */}
      <div className="validation-header">
        <div className="validation-badge-group">
          <span className="validation-badge error">
            ⚠️ AWG Accession Validation
          </span>
          <span className="provenance-tag">
            Provenance: {requestedPair.join(" × ") || "No Accessions"}
          </span>
        </div>
        <h4 className="validation-title">
          {isIdentical
            ? `Choose two distinct OSDR studies. You selected ${studyA} twice.`
            : isUnresolved
            ? `Study ${failedAccession || requestedPair.join(", ")} could not be resolved`
            : isMalformed
            ? `Invalid accession format in '${requestedPair.join(", ")}'`
            : isSingle
            ? `Comparison requires two distinct studies (only ${studyA} provided)`
            : errorMessage || "Study accession validation required"}
        </h4>
        <p className="validation-desc">
          {userMessage ||
            "The NASA OSDR Analysis Working Group (AWG) requires two distinct, resolvable accessions to perform evidence-grounded multi-omics comparison."}
        </p>
      </div>

      {/* Provenance Audit Strip */}
      <div className="validation-provenance-strip">
        <div className="prov-item">
          <span className="prov-label">Requested Pair:</span>
          <span className="prov-val code">
            {requestedPair.length > 0 ? requestedPair.join(" & ") : "None"}
          </span>
        </div>
        <div className="prov-item">
          <span className="prov-label">Resolved Pair:</span>
          <span className="prov-val code muted">
            {resolvedPair ? resolvedPair.join(" × ") : "None (Substitution Blocked)"}
          </span>
        </div>
        <div className="prov-item">
          <span className="prov-label">Validation Status:</span>
          <span className="prov-val status-tag">
            {validationStatus || "rejected"}
          </span>
        </div>
        <div className="prov-item">
          <span className="prov-label">Silent Substitution:</span>
          <span className="prov-val blocked">🚫 Disabled</span>
        </div>
      </div>

      {/* 3 Explicit Action Modules */}
      <div className="validation-actions-container">
        <div className="actions-header-label">
          <span>Three Explicit Resolution Actions:</span>
        </div>

        <div className="validation-actions-grid">
          {/* Action 1: Change Second Accession */}
          <div className="validation-action-card">
            <div className="action-card-header">
              <span className="action-number">1</span>
              <div>
                <strong>Change Second Accession</strong>
                <p>Keep {studyA} and enter a different study ID.</p>
              </div>
            </div>

            {showCustomInput ? (
              <form onSubmit={handleConfirmCustom} className="action-custom-form">
                <div className="custom-input-row">
                  <span className="fixed-study-badge">{studyA}</span>
                  <span className="cross-symbol">×</span>
                  <input
                    type="text"
                    className="custom-accession-input"
                    placeholder="e.g. OSD-680, OSD-679, OSD-583"
                    value={customSecondAccession}
                    onChange={(e) => setCustomSecondAccession(e.target.value)}
                    autoFocus
                  />
                  <button type="submit" className="confirm-btn primary" disabled={!customSecondAccession.trim()}>
                    Confirm &amp; Run ➔
                  </button>
                </div>
              </form>
            ) : (
              <button
                className="action-trigger-btn"
                onClick={() => setShowCustomInput(true)}
              >
                ✏️ Enter Distinct Second Accession
              </button>
            )}
          </div>

          {/* Action 2: Select a Compatible Suggested Pair */}
          <div className="validation-action-card">
            <div className="action-card-header">
              <span className="action-number">2</span>
              <div>
                <strong>Select a Compatible Suggested Pair</strong>
                <p>Explicitly confirm an authentic, grounded OSDR counterpart.</p>
              </div>
            </div>

            <div className="suggested-replacements-list">
              {suggestedReplacements.map((match) => (
                <button
                  key={match.study_id}
                  className="suggested-replacement-chip"
                  onClick={() => handleSelectSuggestedPair(match.study_id)}
                  title={`Explicitly confirm comparison: ${studyA} × ${match.study_id}`}
                >
                  <span className="chip-study-id">{studyA} × {match.study_id}</span>
                  <span className="chip-study-assay">{match.assay} ({match.tissue})</span>
                  <span className="chip-confirm-arrow">Confirm ➔</span>
                </button>
              ))}
            </div>
          </div>

          {/* Action 3: Run /awg random */}
          <div className="validation-action-card">
            <div className="action-card-header">
              <span className="action-number">3</span>
              <div>
                <strong>Run /awg random</strong>
                <p>Let the AWG scoring engine roll a top-ranked compatible pair.</p>
              </div>
            </div>

            <button
              className="action-trigger-btn random-btn"
              onClick={() => onRunCommand?.("/awg random")}
            >
              🎲 Roll High-Compatibility Random Pair
            </button>
          </div>
        </div>
      </div>

      {/* Contextual Available Matches Strip if an accession failed to resolve */}
      {contextualMatches.length > 0 && isUnresolved && (
        <div className="contextual-matches-section">
          <span className="contextual-label">
            Available Verified Studies in this Comparison Context:
          </span>
          <div className="contextual-chips-row">
            {contextualMatches.map((m) => (
              <button
                key={m.study_id}
                className="context-chip"
                onClick={() => onRunCommand?.(`/awg compare ${m.study_id} OSD-679`)}
              >
                <strong>{m.study_id}</strong>: {m.tissue} ({m.assay})
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
