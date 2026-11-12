import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  Database,
  ExternalLink,
  FileJson,
  GitBranch,
  Layers,
  ShieldCheck,
  Sparkles,
  Tag,
  Users,
  X,
} from "lucide-react";
import { fetchAwgIntegrations } from "../../api.js";
import {
  buildFeaturedModelManifest,
  copyTextSafely,
} from "../../utils/contributorManifest.js";

export default function CommunityIntegrationsModal({ isOpen, onClose, onRunPrompt }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [copiedContract, setCopiedContract] = useState(false);
  const [copiedManifestId, setCopiedManifestId] = useState("");

  const isMountedRef = useRef(true);
  const fetchingRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || payload || fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    setErrorMsg("");
    fetchAwgIntegrations()
      .then((data) => {
        if (!isMountedRef.current) return;
        setPayload(data);
        if (data?.handshakeTemplates?.length && !selectedTemplateId) {
          setSelectedTemplateId(data.handshakeTemplates[0].id);
        }
      })
      .catch((err) => {
        if (!isMountedRef.current) return;
        setErrorMsg(err?.message || "Failed to load Community & Downstream Integrations.");
      })
      .finally(() => {
        fetchingRef.current = false;
        if (isMountedRef.current) setLoading(false);
      });
  }, [isOpen, payload]);

  const contributors = payload?.contributors || [];
  const templates = payload?.handshakeTemplates || [];

  const activeTemplate = useMemo(() => {
    if (!templates.length) return null;
    return templates.find((t) => t.id === selectedTemplateId) || templates[0];
  }, [templates, selectedTemplateId]);

  const handleCopyContract = async () => {
    const jsonPayload = activeTemplate?.contractPreview
      ? JSON.stringify(activeTemplate.contractPreview, null, 2)
      : "";
    if (!jsonPayload) return;
    const copied = await copyTextSafely(jsonPayload);
    if (copied) {
      setCopiedContract(true);
      setTimeout(() => setCopiedContract(false), 2200);
    }
  };

  const handleCopyManifest = async (entry) => {
    const manifestDoc = entry?.modelManifest || buildFeaturedModelManifest(entry);
    const copied = await copyTextSafely(JSON.stringify(manifestDoc, null, 2));
    if (copied) {
      setCopiedManifestId(entry.id);
      setTimeout(() => {
        setCopiedManifestId((prev) => (prev === entry.id ? "" : prev));
      }, 2200);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop ci-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ci-modal-title"
    >
      <div
        className="modal-card ci-modal"
        onClick={(e) => e.stopPropagation()}
        data-testid="community-integrations-modal"
      >
        {/* Header */}
        <div className="ci-header">
          <div className="ci-title-block">
            <div className="ci-title-row">
              <span className="ci-header-icon" aria-hidden="true">
                <Layers size={18} strokeWidth={2} />
              </span>
              <h2 id="ci-modal-title" className="ci-title">
                Community &amp; Downstream Integrations
              </h2>
              <span className="ci-branch-pill">
                <GitBranch size={11} />
                <span>MIT · Open Source</span>
              </span>
            </div>
            <p className="ci-subtitle">
              External AWG collaborator prototypes and machine-readable Schema Contract handshakes exported by OSDR ChatBot.
            </p>
          </div>
          <button
            type="button"
            className="modal-close-btn ci-close-btn"
            onClick={onClose}
            aria-label="Close Community Integrations"
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Attribution & Branch Notice */}
        {payload?.attributionNotice && (
          <div className="ci-notice-strip">
            <ShieldCheck size={14} className="ci-notice-icon" />
            <div className="ci-notice-copy">
              <strong>Independent Collaborator Modules:</strong> {payload.attributionNotice}
            </div>
          </div>
        )}

        <div className="ci-body">
          {loading && (
            <div className="ci-loading-state">
              <div className="spinner" />
              <span>Loading collaborator demonstrators and live Schema Contracts…</span>
            </div>
          )}

          {errorMsg && (
            <div className="ci-error-banner">
              <span>{errorMsg}</span>
            </div>
          )}

          {!loading && !errorMsg && (
            <div className="ci-sections">
              {/* Section 1: Featured Collaborator Research Prototypes */}
              <section className="ci-section" aria-label="Featured Community Prototypes">
                <div className="ci-section-head">
                  <span className="ci-section-eyebrow">
                    <Users size={13} />
                    <span>Featured AWG Research Prototypes ({contributors.length})</span>
                  </span>
                </div>

                {contributors.map((entry) => {
                  const displayTitle = entry.title || entry.name;
                  const displayAuthor = entry.author || entry.creatorLabel;
                  const liveUrl = entry.appUrl || entry.externalUrl;
                  const repoUrl = entry.repoUrl || entry.repositoryUrl;
                  const isManifestCopied = copiedManifestId === entry.id;

                  return (
                    <article
                      key={entry.id}
                      className="ci-prototype-card"
                      data-testid={`ci-contributor-${entry.id}`}
                    >
                      <div className="ci-proto-top">
                        <div className="ci-proto-identity">
                          <div className="ci-proto-name-row">
                            <h3 className="ci-proto-name">{displayTitle}</h3>
                            <span className="ci-author-pill">
                              By {displayAuthor}
                            </span>
                            {entry.subgroup && (
                              <span className="ch-subgroup-pill">{entry.subgroup}</span>
                            )}
                            <span className="ci-status-pill">
                              {entry.badgeLabel || "External Research Prototype"}
                            </span>
                          </div>
                          {entry.domain && (
                            <div className="ch-domain-line">
                              <span className="ch-domain-label">Domain:</span> {entry.domain}
                            </div>
                          )}
                          <p className="ci-proto-tagline">{entry.tagline}</p>
                        </div>

                        <div className="ci-card-actions-wrap">
                          <a
                            href={liveUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ci-launch-link"
                            data-testid={`ci-launch-${entry.id}`}
                          >
                            <span>Open Live App</span>
                            <ExternalLink size={13} />
                          </a>

                          {repoUrl && (
                            <a
                              href={repoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ch-repo-link"
                              data-testid={`ci-repo-${entry.id}`}
                            >
                              <span>{entry.repositoryLabel || "GitHub Repository"}</span>
                              <ExternalLink size={12} />
                            </a>
                          )}

                          <button
                            type="button"
                            className={`ci-btn ci-btn-copy ${isManifestCopied ? "copied" : ""}`}
                            onClick={() => handleCopyManifest(entry)}
                            data-testid={`ci-copy-manifest-${entry.id}`}
                          >
                            {isManifestCopied ? <Check size={12} /> : <FileJson size={12} />}
                            <span>
                              {isManifestCopied
                                ? "Copied Citation / Model Manifest JSON"
                                : "Copy Citation / Model Manifest JSON"}
                            </span>
                          </button>
                        </div>
                      </div>

                      <p className="ci-proto-summary">{entry.summary}</p>
                      <p className="ci-proto-rel-note">{entry.relationshipNote}</p>

                      {entry.disclaimer && (
                        <div
                          className="ch-disclaimer-box"
                          data-testid={`ci-disclaimer-${entry.id}`}
                        >
                          <AlertTriangle size={14} className="ch-disclaimer-icon" />
                          <div>
                            <strong>Model Boundary Disclaimer:</strong> {entry.disclaimer}
                          </div>
                        </div>
                      )}

                      <div className="ci-scope-pills" aria-label={`${displayTitle} Datasets and Scope`}>
                        {entry.datasetScope.map((ds) => (
                          <span key={ds} className="ci-scope-chip">
                            <Database size={10} />
                            <span>{ds}</span>
                          </span>
                        ))}
                      </div>

                      {entry.tags?.length > 0 && (
                        <div className="ch-tags-row" aria-label={`${displayTitle} Tags`}>
                          {entry.tags.map((tag) => (
                            <span key={tag} className="ch-tag-pill">
                              <Tag size={10} />
                              <span>{tag}</span>
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="ci-modules-grid">
                        {entry.architecturalModules.map((mod) => (
                          <div key={mod.title} className="ci-module-tile">
                            <div className="ci-module-title">{mod.title}</div>
                            <p className="ci-module-detail">{mod.detail}</p>
                          </div>
                        ))}
                      </div>

                      <div className="ci-guardrails-box">
                        <div className="ci-box-label">Shared Provenance Guardrails</div>
                        <ul className="ci-guardrail-list">
                          {entry.provenanceGuardrails.map((rule) => (
                            <li key={rule}>{rule}</li>
                          ))}
                        </ul>
                      </div>
                    </article>
                  );
                })}
              </section>

              {/* Section 2: Data Pipeline Handshakes & Schema Contracts */}
              <section className="ci-section" aria-label="Schema Contract Pipeline Handshakes">
                <div className="ci-section-head">
                  <span className="ci-section-eyebrow">
                    <Sparkles size={13} />
                    <span>Schema Contract Handshakes ({templates.length})</span>
                  </span>
                  <span className="ci-section-hint">
                    Select a cohort bridge to inspect its frozen-panel policy and copy its machine-readable contract JSON
                  </span>
                </div>

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
                        data-testid={`ci-template-${tpl.id}`}
                      >
                        <span className="ci-tpl-pair">{tpl.studyPair.join(" × ")}</span>
                        {typeof tpl.compatibilityScore === "number" && (
                          <span className="ci-tpl-score">{tpl.compatibilityScore}/100</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {activeTemplate && (
                  <div className="ci-handshake-detail" data-testid="ci-handshake-detail">
                    <div className="ci-handshake-head">
                      <div>
                        <h4 className="ci-handshake-title">{activeTemplate.title}</h4>
                        <p className="ci-handshake-usecase">{activeTemplate.useCase}</p>
                      </div>
                      <div className="ci-handshake-actions">
                        <button
                          type="button"
                          className={`ci-btn ci-btn-copy ${copiedContract ? "copied" : ""}`}
                          onClick={handleCopyContract}
                          disabled={!activeTemplate.contractPreview}
                          data-testid="ci-copy-contract-btn"
                        >
                          {copiedContract ? <Check size={13} /> : <Copy size={13} />}
                          <span>{copiedContract ? "Copied Contract JSON" : "Copy Schema Contract JSON"}</span>
                        </button>
                        <button
                          type="button"
                          className="ci-btn ci-btn-run"
                          onClick={() => onRunPrompt?.(activeTemplate.command)}
                          data-testid="ci-run-compare-btn"
                        >
                          <span>Run {activeTemplate.command}</span>
                          <ArrowRight size={13} />
                        </button>
                      </div>
                    </div>

                    {activeTemplate.frozenPanelPolicy && (
                      <div className="ci-frozen-policy-box" data-testid="ci-frozen-panel-policy">
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
                      <pre className="ci-contract-pre" data-testid="ci-contract-json-preview">
                        {JSON.stringify(activeTemplate.contractPreview, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

