import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Award,
  Check,
  Copy,
  Database,
  Download,
  ExternalLink,
  GitBranch,
  Layers,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { fetchAwgIntegrations } from "../../api.js";
import {
  copyTextSafely,
  downloadJsonFile,
  loadSavedContributorSubmissions,
  removeContributorSubmission,
  saveContributorSubmission,
} from "../../utils/contributorManifest.js";
import ContributionSubmissionForm from "./ContributionSubmissionForm.jsx";

export default function ContributorHub({ onBackToChat, onRunPrompt }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [copiedContract, setCopiedContract] = useState(false);
  const [savedSubmissions, setSavedSubmissions] = useState(() => loadSavedContributorSubmissions());

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorMsg("");
    fetchAwgIntegrations()
      .then((data) => {
        if (!active) return;
        setPayload(data);
        if (data?.handshakeTemplates?.length) {
          setSelectedTemplateId(data.handshakeTemplates[0].id);
        }
      })
      .catch((err) => {
        if (!active) return;
        setErrorMsg(err?.message || "Failed to load Contributor Hub integration metadata.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const contributors = payload?.contributors || [];
  const templates = payload?.handshakeTemplates || [];

  const activeTemplate = useMemo(() => {
    if (!templates.length) return null;
    return templates.find((t) => t.id === selectedTemplateId) || templates[0];
  }, [templates, selectedTemplateId]);

  const handleExportAlignedContract = async () => {
    const preview = activeTemplate?.contractPreview;
    if (!preview) return;
    const ok = await copyTextSafely(JSON.stringify(preview, null, 2));
    if (ok) {
      setCopiedContract(true);
      setTimeout(() => setCopiedContract(false), 2400);
    }
  };

  const handleDownloadAlignedContract = () => {
    if (!activeTemplate?.contractPreview) return;
    const safePair = (activeTemplate.studyPair || ["OSDR", "CONTRACT"]).join("_");
    downloadJsonFile(`aligned_schema_contract_${safePair}.json`, {
      exporter: "OSDR_Chatbot Contributor Hub",
      alignedContributor: contributors[0]?.name || "RetinaCellTwin",
      templateId: activeTemplate.id,
      frozenPanelPolicy: activeTemplate.frozenPanelPolicy,
      schemaContract: activeTemplate.contractPreview,
    });
  };

  const handleSaveSubmission = (manifest) => {
    const next = saveContributorSubmission(manifest);
    setSavedSubmissions(next);
  };

  const handleDeleteLocalSubmission = (id) => {
    const next = removeContributorSubmission(id);
    setSavedSubmissions(next);
  };

  return (
    <div className="ch-page" data-testid="contributor-hub-view">
      <div className="ch-container">
        {/* 1. Header & Mission Banner */}
        <header className="ch-hero">
          <div className="ch-hero-top">
            <button
              type="button"
              className="ch-back-btn"
              onClick={onBackToChat}
              data-testid="contributor-hub-back-btn"
            >
              <ArrowLeft size={14} />
              <span>Back to Research Chat</span>
            </button>

            <div className="ch-route-pills">
              <span className="ci-branch-pill">
                <Layers size={11} />
                <span>/contributors</span>
              </span>
              <span className="ci-branch-pill">
                <GitBranch size={11} />
                <span>MIT · Open Source</span>
              </span>
            </div>
          </div>

          <div className="ch-hero-copy">
            <div className="ch-eyebrow">
              <Users size={13} />
              <span>NASA OSDR AWG Community Integration Portal</span>
            </div>
            <h1 className="ch-title">Contributor Hub &amp; Ingestion Intake Portal</h1>
            <p className="ch-mission">
              Linking upstream OSDR study discovery and schema guardrails with independent,
              community-built modeling tools, digital twins, and benchmark notebooks across Working
              Groups.
            </p>
          </div>

          <div className="ch-notice-banner">
            <ShieldCheck size={15} className="ci-notice-icon" />
            <div>
              <strong>Independent Collaborator Attribution &amp; Provenance:</strong>{" "}
              {payload?.attributionNotice ||
                "Community prototypes shown here are independent research demonstrators credited to their respective authors and are not endorsed by or officially affiliated with NASA."}
            </div>
          </div>
        </header>

        {loading && (
          <div className="ci-loading-state">
            <div className="spinner" />
            <span>Loading featured AWG contributor modules &amp; aligned schema contracts…</span>
          </div>
        )}

        {errorMsg && (
          <div className="ci-error-banner" role="alert">
            {errorMsg}
          </div>
        )}

        {/* 2. Active Showcase: 1st Featured Contributor */}
        {!loading && !errorMsg && (
          <section
            className="ch-showcase-section"
            aria-label="1st Featured Contributor Showcase"
          >
            <div className="ch-section-header">
              <div className="ch-eyebrow">
                <Award size={13} />
                <span>Active Showcase · 1st Featured AWG Contributor</span>
              </div>
              <span className="ci-section-hint">
                Click &ldquo;Export Aligned Schema Contract JSON&rdquo; to pass animal-disjoint
                guardrails downstream
              </span>
            </div>

            {contributors.map((entry) => (
              <article
                key={entry.id}
                className="ci-prototype-card ch-featured-card"
                data-testid={`featured-contributor-${entry.id}`}
              >
                <div className="ci-proto-top">
                  <div className="ci-proto-identity">
                    <div className="ch-featured-kicker">
                      Featured Contributor: <strong>{entry.creatorLabel}</strong>
                    </div>
                    <div className="ci-proto-name-row">
                      <h2 className="ci-proto-name ch-project-name">{entry.name}</h2>
                      <span className="ci-author-pill">@{entry.creatorHandle}</span>
                      <span className="ci-status-pill">1st Contributor Prototype</span>
                    </div>
                    <p className="ci-proto-tagline">{entry.tagline}</p>
                  </div>

                  <div className="ch-showcase-actions">
                    <a
                      href={entry.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ci-launch-link"
                      data-testid={`hub-launch-${entry.id}`}
                    >
                      <span>Open Live App</span>
                      <ExternalLink size={13} />
                    </a>

                    {entry.repositoryUrl && (
                      <a
                        href={entry.repositoryUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ch-repo-link"
                        data-testid={`hub-repo-${entry.id}`}
                      >
                        <span>{entry.repositoryLabel || "Contract Repository"}</span>
                        <ExternalLink size={12} />
                      </a>
                    )}

                    <button
                      type="button"
                      className={`ci-btn ci-btn-copy ${copiedContract ? "copied" : ""}`}
                      onClick={handleExportAlignedContract}
                      disabled={!activeTemplate?.contractPreview}
                      data-testid="hub-export-aligned-contract-btn"
                    >
                      {copiedContract ? <Check size={13} /> : <Copy size={13} />}
                      <span>
                        {copiedContract
                          ? "Exported Aligned Schema Contract JSON"
                          : "Export Aligned Schema Contract JSON"}
                      </span>
                    </button>

                    <button
                      type="button"
                      className="ci-btn ci-btn-run"
                      onClick={handleDownloadAlignedContract}
                      disabled={!activeTemplate?.contractPreview}
                      data-testid="hub-download-aligned-contract-btn"
                      title="Download aligned schema contract JSON bundle"
                    >
                      <Download size={13} />
                      <span>Download JSON</span>
                    </button>
                  </div>
                </div>

                <p className="ci-proto-summary">{entry.summary}</p>
                <p className="ci-proto-rel-note">{entry.relationshipNote}</p>

                <div className="ci-scope-pills" aria-label="RetinaCellTwin Target OSDR Datasets">
                  {entry.datasetScope.map((ds) => (
                    <span key={ds} className="ci-scope-chip">
                      <Database size={10} />
                      <span>{ds}</span>
                    </span>
                  ))}
                </div>

                <div className="ci-modules-grid">
                  {entry.architecturalModules.map((mod) => (
                    <div key={mod.title} className="ci-module-tile">
                      <div className="ci-module-title">{mod.title}</div>
                      <p className="ci-module-detail">{mod.detail}</p>
                    </div>
                  ))}
                </div>

                <div className="ci-guardrails-box">
                  <div className="ci-box-label">Shared Provenance &amp; Cross-Mission Guardrails</div>
                  <ul className="ci-guardrail-list">
                    {entry.provenanceGuardrails.map((rule) => (
                      <li key={rule}>{rule}</li>
                    ))}
                  </ul>
                </div>

                {/* Live Aligned Schema Contract Bridge Selector */}
                {templates.length > 0 && (
                  <div className="ch-handshake-subsection">
                    <div className="ch-subhead-row">
                      <span className="ci-section-eyebrow">
                        <Sparkles size={13} />
                        <span>Aligned Schema Contract Bridges ({templates.length})</span>
                      </span>

                      <div className="ci-template-tabs" role="tablist" aria-label="Handshake Templates">
                        {templates.map((tpl) => {
                          const isSelected = activeTemplate?.id === tpl.id;
                          return (
                            <button
                              key={tpl.id}
                              type="button"
                              role="tab"
                              aria-selected={isSelected}
                              className={`ci-template-tab ${isSelected ? "active" : ""}`}
                              onClick={() => {
                                setSelectedTemplateId(tpl.id);
                                setCopiedContract(false);
                              }}
                              data-testid={`hub-template-${tpl.id}`}
                            >
                              <span className="ci-tpl-pair">{tpl.studyPair.join(" × ")}</span>
                              {typeof tpl.compatibilityScore === "number" && (
                                <span className="ci-tpl-score">{tpl.compatibilityScore}/100</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {activeTemplate && (
                      <div className="ci-handshake-detail" data-testid="hub-handshake-detail">
                        <div className="ci-handshake-head">
                          <div>
                            <h3 className="ci-handshake-title">{activeTemplate.title}</h3>
                            <p className="ci-handshake-usecase">{activeTemplate.useCase}</p>
                          </div>
                          <button
                            type="button"
                            className="ci-btn ci-btn-run"
                            onClick={() => onRunPrompt?.(activeTemplate.command)}
                            data-testid="hub-run-compare-btn"
                          >
                            <span>Run {activeTemplate.command} in Chat</span>
                            <ArrowRight size={13} />
                          </button>
                        </div>

                        {activeTemplate.frozenPanelPolicy && (
                          <div className="ci-frozen-policy-box" data-testid="hub-frozen-panel-policy">
                            <div className="ci-frozen-head">
                              <span className="ci-frozen-badge">FROZEN DISCOVERY PANEL POLICY</span>
                              <span className="ci-frozen-ref">
                                Reference: <code>{activeTemplate.frozenPanelPolicy.referenceAccession}</code> ·{" "}
                                {activeTemplate.frozenPanelPolicy.discoveryPanelSize || 362} genes ·{" "}
                                {activeTemplate.frozenPanelPolicy.discoveryThreshold}
                              </span>
                            </div>
                            <p className="ci-frozen-rule">{activeTemplate.frozenPanelPolicy.rule}</p>
                          </div>
                        )}

                        {activeTemplate.keyGuardrails?.length > 0 && (
                          <div className="ci-guardrail-chips">
                            {activeTemplate.keyGuardrails.map((g) => (
                              <span key={g.code} className={`ci-guardrail-pill is-${g.severity || "warning"}`}>
                                {g.code}
                              </span>
                            ))}
                          </div>
                        )}

                        {activeTemplate.contractPreview && (
                          <pre className="ci-contract-pre" data-testid="hub-contract-json-preview">
                            {JSON.stringify(activeTemplate.contractPreview, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </article>
            ))}
          </section>
        )}

        {/* 3. Locally Saved Community Submission Previews */}
        {savedSubmissions.length > 0 && (
          <section
            className="ch-local-queue-section"
            aria-label="Local Community Submission Previews"
            data-testid="local-submissions-list"
          >
            <div className="ch-section-header">
              <div className="ch-eyebrow">
                <Sparkles size={13} />
                <span>Your Local Showcase Previews ({savedSubmissions.length})</span>
              </div>
              <span className="ci-section-hint">
                Stored in your browser&apos;s localStorage for live layout inspection before opening a PR
              </span>
            </div>

            <div className="ch-local-grid">
              {savedSubmissions.map((item) => {
                const m = item.manifest || {};
                const contrib = m.contributor || {};
                const proj = m.project || {};
                const studyIds = m.osdrIntegration?.targetStudyIds || [];

                return (
                  <article key={item.id} className="ch-local-card" data-testid="local-submission-card">
                    <div className="ch-local-card-top">
                      <div>
                        <div className="ch-local-meta-row">
                          <span className="ci-author-pill">{contrib.awgSubgroup || "AWG"}</span>
                          <span className="ch-draft-pill">Local Browser Draft</span>
                        </div>
                        <h3 className="ch-local-title">{proj.title || "Untitled Tool"}</h3>
                        <div className="ch-local-author">
                          By <strong>{contrib.name || "Contributor"}</strong>
                          {contrib.handle ? ` (${contrib.handle})` : ""}
                          {contrib.affiliation ? ` · ${contrib.affiliation}` : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="ch-remove-btn"
                        onClick={() => handleDeleteLocalSubmission(item.id)}
                        title="Remove local preview"
                        aria-label={`Remove ${proj.title || "submission"}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    {proj.abstract && <p className="ch-local-abstract">{proj.abstract}</p>}

                    {studyIds.length > 0 && (
                      <div className="ci-scope-pills">
                        {studyIds.map((id) => (
                          <span key={id} className="ci-scope-chip">
                            <Database size={10} />
                            <span>{id}</span>
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="ch-local-actions">
                      {proj.liveDemoUrl && (
                        <a
                          href={proj.liveDemoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ch-repo-link"
                        >
                          <span>Live Demo</span>
                          <ExternalLink size={11} />
                        </a>
                      )}
                      {proj.repositoryOrPaperUrl && (
                        <a
                          href={proj.repositoryOrPaperUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ch-repo-link"
                        >
                          <span>Repo / Paper</span>
                          <ExternalLink size={11} />
                        </a>
                      )}
                      <button
                        type="button"
                        className="ci-btn ci-btn-copy"
                        onClick={() => downloadJsonFile("contributor_manifest.json", m)}
                      >
                        <Download size={12} />
                        <span>Download Manifest JSON</span>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {/* 4. Interactive Submission & Intake Tool */}
        <ContributionSubmissionForm onSaveSubmission={handleSaveSubmission} />
      </div>
    </div>
  );
}

