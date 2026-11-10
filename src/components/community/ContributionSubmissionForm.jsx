import { useMemo, useState } from "react";
import {
  BookmarkPlus,
  Check,
  Code2,
  Copy,
  Database,
  Download,
  FileJson,
  MessageSquareShare,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import {
  AWG_SUBGROUPS,
  buildContributorManifest,
  copyTextSafely,
  downloadJsonFile,
  formatForumAnnouncementText,
  formatGitHubContributionBlock,
  parseTargetOsdrStudyIds,
} from "../../utils/contributorManifest.js";

const EMPTY_FORM = {
  contributorName: "",
  forumHandle: "",
  awgSubgroup: "AIML AWG",
  affiliation: "",
  projectTitle: "",
  abstract: "",
  liveDemoUrl: "",
  repositoryOrPaperUrl: "",
  targetStudyIds: "",
};

const QUICK_STUDY_PRESETS = ["OSD-255", "OSD-758", "OSD-203", "OSD-557", "OSD-685", "OSD-698"];

export default function ContributionSubmissionForm({ onSaveSubmission }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [manifest, setManifest] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [copyStatus, setCopyStatus] = useState(""); // "manifest" | "github" | "forum" | ""
  const [savedNotice, setSavedNotice] = useState(false);

  const parsedIds = useMemo(
    () => parseTargetOsdrStudyIds(form.targetStudyIds),
    [form.targetStudyIds]
  );

  const updateField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errorMsg) setErrorMsg("");
    if (savedNotice) setSavedNotice(false);
  };

  const appendPresetStudy = (studyId) => {
    if (parsedIds.validIds.includes(studyId)) return;
    const nextList = [...parsedIds.validIds, studyId].join(", ");
    updateField("targetStudyIds", nextList);
  };

  const validateAndBuild = () => {
    if (!form.contributorName.trim()) {
      setErrorMsg("Please enter your Contributor Name before generating a manifest.");
      return null;
    }
    if (!form.projectTitle.trim()) {
      setErrorMsg("Please enter a Project Title before generating a manifest.");
      return null;
    }
    const built = buildContributorManifest(form);
    setManifest(built);
    setErrorMsg("");
    return built;
  };

  const handleGenerate = (e) => {
    e?.preventDefault?.();
    validateAndBuild();
  };

  const handleSaveLocal = () => {
    const built = validateAndBuild();
    if (!built) return;
    onSaveSubmission?.(built);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2600);
  };

  const handleCopyAction = async (kind, text) => {
    const ok = await copyTextSafely(text);
    if (ok) {
      setCopyStatus(kind);
      setTimeout(() => setCopyStatus(""), 2200);
    }
  };

  const handleReset = () => {
    setForm(EMPTY_FORM);
    setManifest(null);
    setErrorMsg("");
    setCopyStatus("");
    setSavedNotice(false);
  };

  const handleLoadSample = () => {
    const sample = {
      contributorName: "Dr. Jordan Vega",
      forumHandle: "@jvega_bio",
      awgSubgroup: "Multi-Omics / Systems Biology AWG",
      affiliation: "Space Bioanalytics Lab",
      projectTitle: "GeoMx Retinal-Brain Spatial Contrast Atlas",
      abstract:
        "Cross-cohort spatial proteomics and transcriptomics differential viewer pairing RR-18 brain/ocular sections (OSD-685, OSD-698) with strict animal-disjoint outer folds.",
      liveDemoUrl: "https://example.org/geomx-atlas-demo",
      repositoryOrPaperUrl: "https://github.com/example/geomx-spatial-atlas",
      targetStudyIds: "OSD-685, OSD-698, OSD-255",
    };
    setForm(sample);
    setManifest(buildContributorManifest(sample));
    setErrorMsg("");
  };

  return (
    <section
      className="ch-intake-card"
      aria-label="Contributor Submission and Intake Tool"
      data-testid="contributor-submission-form"
    >
      <div className="ch-intake-head">
        <div>
          <div className="ch-eyebrow">
            <Sparkles size={13} />
            <span>Community Tool &amp; Notebook Intake Portal</span>
          </div>
          <h2 className="ch-intake-title">Submit Your Prototype, Notebook, or Benchmark Tool</h2>
          <p className="ch-intake-desc">
            Zero-backend intake generator: format your metadata into a standardized{" "}
            <code>contributor_manifest.json</code>, copy a ready-to-paste GitHub PR block or AWG
            forum announcement, and preview your entry live on this hub via local browser state.
          </p>
        </div>

        <div className="ch-intake-head-tools">
          <button
            type="button"
            className="ch-ghost-btn"
            onClick={handleLoadSample}
            data-testid="intake-load-sample-btn"
          >
            Fill Example
          </button>
          <button
            type="button"
            className="ch-ghost-btn"
            onClick={handleReset}
            title="Clear form"
          >
            <RotateCcw size={12} />
            <span>Reset</span>
          </button>
        </div>
      </div>

      <form className="ch-form" onSubmit={handleGenerate} noValidate>
        <div className="ch-form-grid">
          <div className="ch-field">
            <label htmlFor="ch-contributor-name" className="ch-label">
              Contributor Name <span className="ch-req">*</span>
            </label>
            <input
              id="ch-contributor-name"
              type="text"
              className="ch-input"
              value={form.contributorName}
              onChange={(e) => updateField("contributorName", e.target.value)}
              placeholder="e.g., Lissandra Kruse Fuganti"
              data-testid="input-contributor-name"
              required
            />
          </div>

          <div className="ch-field">
            <label htmlFor="ch-forum-handle" className="ch-label">
              Forum / GitHub Handle
            </label>
            <input
              id="ch-forum-handle"
              type="text"
              className="ch-input"
              value={form.forumHandle}
              onChange={(e) => updateField("forumHandle", e.target.value)}
              placeholder="e.g., @fuganti"
              data-testid="input-forum-handle"
            />
          </div>

          <div className="ch-field">
            <label htmlFor="ch-awg-subgroup" className="ch-label">
              AWG Subgroup
            </label>
            <select
              id="ch-awg-subgroup"
              className="ch-input ch-select"
              value={form.awgSubgroup}
              onChange={(e) => updateField("awgSubgroup", e.target.value)}
              data-testid="input-awg-subgroup"
            >
              {AWG_SUBGROUPS.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </div>

          <div className="ch-field">
            <label htmlFor="ch-affiliation" className="ch-label">
              Affiliation / Lab (Optional)
            </label>
            <input
              id="ch-affiliation"
              type="text"
              className="ch-input"
              value={form.affiliation}
              onChange={(e) => updateField("affiliation", e.target.value)}
              placeholder="e.g., AIML Working Group / University Lab"
              data-testid="input-affiliation"
            />
          </div>

          <div className="ch-field ch-field-full">
            <label htmlFor="ch-project-title" className="ch-label">
              Project Title <span className="ch-req">*</span>
            </label>
            <input
              id="ch-project-title"
              type="text"
              className="ch-input"
              value={form.projectTitle}
              onChange={(e) => updateField("projectTitle", e.target.value)}
              placeholder="e.g., RetinaCellTwin — Multimodal OSDR Evidence Solver"
              data-testid="input-project-title"
              required
            />
          </div>

          <div className="ch-field ch-field-full">
            <label htmlFor="ch-project-abstract" className="ch-label">
              Short Abstract / Description
            </label>
            <textarea
              id="ch-project-abstract"
              rows={3}
              className="ch-input ch-textarea"
              value={form.abstract}
              onChange={(e) => updateField("abstract", e.target.value)}
              placeholder="Summarize what the model, notebook, or visualization computes and how OSDR discovery metadata or Schema Contracts plug in..."
              data-testid="input-project-abstract"
            />
          </div>

          <div className="ch-field">
            <label htmlFor="ch-live-url" className="ch-label">
              Live Tool URL / Demo Link
            </label>
            <input
              id="ch-live-url"
              type="url"
              className="ch-input"
              value={form.liveDemoUrl}
              onChange={(e) => updateField("liveDemoUrl", e.target.value)}
              placeholder="https://your-tool.example.org/"
              data-testid="input-live-url"
            />
          </div>

          <div className="ch-field">
            <label htmlFor="ch-repo-url" className="ch-label">
              Repository / Paper Link (GitHub, Zenodo, Hugging Face, Kaggle, JOSS)
            </label>
            <input
              id="ch-repo-url"
              type="url"
              className="ch-input"
              value={form.repositoryOrPaperUrl}
              onChange={(e) => updateField("repositoryOrPaperUrl", e.target.value)}
              placeholder="https://github.com/org/repo or https://doi.org/..."
              data-testid="input-repo-url"
            />
          </div>

          <div className="ch-field ch-field-full">
            <label htmlFor="ch-target-studies" className="ch-label">
              Target OSDR Study IDs (comma-separated, e.g., <code>OSD-255, OSD-685</code>)
            </label>
            <input
              id="ch-target-studies"
              type="text"
              className="ch-input"
              value={form.targetStudyIds}
              onChange={(e) => updateField("targetStudyIds", e.target.value)}
              placeholder="OSD-255, OSD-758, OSD-203"
              data-testid="input-target-studies"
            />
            <div className="ch-study-helper-row">
              <span className="ch-helper-label">Quick add:</span>
              {QUICK_STUDY_PRESETS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="ch-preset-chip"
                  onClick={() => appendPresetStudy(id)}
                >
                  + {id}
                </button>
              ))}
            </div>
            {(parsedIds.validIds.length > 0 || parsedIds.invalidTokens.length > 0) && (
              <div className="ch-parsed-studies">
                {parsedIds.validIds.map((id) => (
                  <span key={id} className="ci-scope-chip">
                    <Database size={10} />
                    <span>{id}</span>
                  </span>
                ))}
                {parsedIds.invalidTokens.length > 0 && (
                  <span className="ch-invalid-hint">
                    Ignored non-OSD token(s): {parsedIds.invalidTokens.join(", ")} (expected{" "}
                    <code>OSD-###</code>)
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {errorMsg && (
          <div className="ch-form-error" role="alert" data-testid="intake-error-banner">
            {errorMsg}
          </div>
        )}

        <div className="ch-form-submit-row">
          <button
            type="submit"
            className="ch-primary-btn"
            data-testid="generate-manifest-btn"
          >
            <FileJson size={14} />
            <span>Generate Ingestion Manifest</span>
          </button>

          <button
            type="button"
            className={`ch-secondary-btn ${savedNotice ? "is-done" : ""}`}
            onClick={handleSaveLocal}
            data-testid="save-local-submission-btn"
          >
            {savedNotice ? <Check size={14} /> : <BookmarkPlus size={14} />}
            <span>{savedNotice ? "Saved to Hub Preview" : "Save Draft to Hub Preview (Local)"}</span>
          </button>
        </div>
      </form>

      {manifest && (
        <div className="ch-manifest-output" data-testid="generated-manifest-panel">
          <div className="ch-manifest-bar">
            <div className="ch-manifest-badge-row">
              <span className="ch-manifest-pill">contributor_manifest.json ready</span>
              <span className="ch-manifest-meta">
                {manifest.osdrIntegration.targetStudyIds.length} OSDR accession(s) · Schema{" "}
                {manifest.schemaVersion}
              </span>
            </div>

            <div className="ch-manifest-actions">
              <button
                type="button"
                className="ci-btn ci-btn-run"
                onClick={() => downloadJsonFile("contributor_manifest.json", manifest)}
                data-testid="download-manifest-btn"
              >
                <Download size={13} />
                <span>Download contributor_manifest.json</span>
              </button>

              <button
                type="button"
                className={`ci-btn ci-btn-copy ${copyStatus === "manifest" ? "copied" : ""}`}
                onClick={() => handleCopyAction("manifest", JSON.stringify(manifest, null, 2))}
                data-testid="copy-manifest-btn"
              >
                {copyStatus === "manifest" ? <Check size={13} /> : <Copy size={13} />}
                <span>{copyStatus === "manifest" ? "Copied JSON" : "Copy Manifest JSON"}</span>
              </button>

              <button
                type="button"
                className={`ci-btn ci-btn-copy ${copyStatus === "github" ? "copied" : ""}`}
                onClick={() => handleCopyAction("github", formatGitHubContributionBlock(manifest))}
                data-testid="copy-github-block-btn"
              >
                {copyStatus === "github" ? <Check size={13} /> : <Code2 size={13} />}
                <span>
                  {copyStatus === "github"
                    ? "Copied PR Block"
                    : "Copy GitHub Contribution Block"}
                </span>
              </button>

              <button
                type="button"
                className={`ci-btn ci-btn-copy ${copyStatus === "forum" ? "copied" : ""}`}
                onClick={() => handleCopyAction("forum", formatForumAnnouncementText(manifest))}
                data-testid="copy-forum-text-btn"
              >
                {copyStatus === "forum" ? <Check size={13} /> : <MessageSquareShare size={13} />}
                <span>
                  {copyStatus === "forum"
                    ? "Copied Forum Text"
                    : "Copy Forum Announcement Text"}
                </span>
              </button>
            </div>
          </div>

          <pre className="ci-contract-pre ch-manifest-pre" data-testid="generated-manifest-preview">
            {JSON.stringify(manifest, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}

