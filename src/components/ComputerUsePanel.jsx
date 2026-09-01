import { useState } from "react";
import { fetchComputerUse } from "../api.js";

const QUICK_TASKS = [
  { label: "Inspect OSD-87 metadata", task: "Open the OSDR study page for OSD-87 and summarize visible metadata fields", url: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-87" },
  { label: "Analyze OSD-680 optic nerve", task: "Inspect OSD-680 and extract MRI sheath morphometry and HDT bedrest parameters", url: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-680" },
  { label: "Browse OSDR repository", task: "Inspect the NASA OSDR repository index and list available accessions and search filters", url: "https://osdr.nasa.gov/bio/repo/data/studies" },
];

export default function ComputerUsePanel({ isOpen, onClose }) {
  const [task, setTask] = useState(QUICK_TASKS[0].task);
  const [startUrl, setStartUrl] = useState(QUICK_TASKS[0].url);
  const [mode, setMode] = useState("analyze");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  if (!isOpen) return null;

  const handleRunTask = async (e) => {
    e?.preventDefault();
    if (!task.trim() || loading) return;
    setLoading(true);
    setErrorMsg("");
    setResult(null);

    try {
      const res = await fetchComputerUse({ task, startUrl, mode });
      if (!res.success) {
        throw new Error(res.error || "Computer Use execution failed.");
      }
      setResult(res);
    } catch (err) {
      setErrorMsg(err?.message || "Failed to execute Computer Use task.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectQuickTask = (qt) => {
    setTask(qt.task);
    setStartUrl(qt.url);
    setErrorMsg("");
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card computer-use-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <div className="modal-title-row">
              <span className="modal-icon">🖥️</span>
              <h2 className="modal-title">Gemini Computer Use Preview</h2>
              <span className="cu-badge-preview">[RESEARCH / DEV PREVIEW]</span>
            </div>
            <p className="modal-subtitle">
              Scoped autonomous UI inspection and metadata extraction guarded by NASA OSDR domain allowlist.
            </p>
          </div>
          <button className="modal-close-btn" onClick={onClose} title="Close Panel">
            ✕
          </button>
        </div>

        {/* Quota Banner */}
        <div className="cu-quota-banner">
          <div className="cu-quota-item">
            <span className="cu-quota-label">Capability:</span>
            <span className="cu-quota-val">Computer Use Preview (gemini-2.5-flash)</span>
          </div>
          <div className="cu-quota-item">
            <span className="cu-quota-label">Project Quota:</span>
            <span className="cu-quota-val">150 RPM · 2M TPM · 10K RPD</span>
          </div>
          <div className="cu-quota-item">
            <span className="cu-quota-label">Domain Policy:</span>
            <span className="cu-quota-val text-emerald-400">osdr.nasa.gov (guarded)</span>
          </div>
        </div>

        {/* Form */}
        <form className="cu-form" onSubmit={handleRunTask}>
          <div className="cu-quick-chips">
            <span className="cu-chips-label">Quick Scenarios:</span>
            {QUICK_TASKS.map((qt, idx) => (
              <button
                key={idx}
                type="button"
                className="cu-chip-btn"
                onClick={() => handleSelectQuickTask(qt)}
              >
                {qt.label}
              </button>
            ))}
          </div>

          <div className="cu-input-group">
            <label className="cu-label">Task Description</label>
            <textarea
              className="cu-textarea"
              rows={3}
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="e.g. Open OSD-87 study portal and extract visible assay metadata..."
              required
            />
          </div>

          <div className="cu-row-2col">
            <div className="cu-input-group">
              <label className="cu-label">Start URL</label>
              <input
                type="url"
                className="cu-input"
                value={startUrl}
                onChange={(e) => setStartUrl(e.target.value)}
                placeholder="https://osdr.nasa.gov/bio/repo/data/studies/OSD-87"
              />
            </div>
            <div className="cu-input-group">
              <label className="cu-label">Execution Mode</label>
              <select
                className="cu-select"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                <option value="analyze">analyze (Structured Inspection)</option>
                <option value="navigate">navigate (Step-by-Step Flow)</option>
              </select>
            </div>
          </div>

          <div className="cu-actions-bar">
            <button
              type="submit"
              className="cu-run-btn"
              disabled={loading || !task.trim()}
            >
              {loading ? (
                <>
                  <span className="cu-spinner" /> Executing Computer Use…
                </>
              ) : (
                <>
                  <span>▶</span> Run Scoped Computer Use
                </>
              )}
            </button>
          </div>
        </form>

        {/* Error Alert */}
        {errorMsg && (
          <div className="cu-error-box">
            <span className="cu-error-icon">⚠️</span>
            <div className="cu-error-text">{errorMsg}</div>
          </div>
        )}

        {/* Results Panel */}
        {result && (
          <div className="cu-results-container">
            <div className="cu-results-header">
              <div className="cu-res-title">
                <span>Execution Summary</span>
                <span className="cu-time-badge">{result.executionTimeMs}ms</span>
              </div>
              <span className="cu-model-tag">{result.capabilityLabel}</span>
            </div>

            {/* Executive Summary */}
            {result.extractedData?.summary && (
              <div className="cu-summary-box">
                <p className="cu-summary-text">{result.extractedData.summary}</p>
              </div>
            )}

            {/* Step Logs */}
            <div className="cu-steps-section">
              <h4 className="cu-section-title">Step Execution Log ({result.steps?.length || 0} steps)</h4>
              <div className="cu-steps-list">
                {result.steps?.map((step) => (
                  <div key={step.stepNumber} className={`cu-step-item step-${step.status}`}>
                    <div className="cu-step-num">Step {step.stepNumber}</div>
                    <div className="cu-step-content">
                      <div className="cu-step-action-row">
                        <span className="cu-step-action">{step.action}</span>
                        <span className={`cu-step-status-pill pill-${step.status}`}>{step.status}</span>
                      </div>
                      <p className="cu-step-summary">{step.summary}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Extracted Structured Metadata */}
            {result.extractedData?.visibleFields && Object.keys(result.extractedData.visibleFields).length > 0 && (
              <div className="cu-fields-section">
                <h4 className="cu-section-title">Visible Metadata Attributes</h4>
                <div className="cu-fields-grid">
                  {Object.entries(result.extractedData.visibleFields).map(([k, v]) => (
                    <div key={k} className="cu-field-card">
                      <span className="cu-field-key">{k}</span>
                      <span className="cu-field-val">{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
