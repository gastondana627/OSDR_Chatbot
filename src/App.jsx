import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useConversations } from "./hooks/useConversations.js";
import { streamChat, fetchModels, fetchOsdrDiagnostics, fetchSystemDiagnostics, fetchAwgRadar, exportEvidenceBundle, formatErrorMessage } from "./api.js";
import { useAuth } from "./context/AuthContext.jsx";
import Sidebar from "./components/chat/Sidebar.jsx";
import Message from "./components/chat/Message.jsx";
import OsdrDiagnosticsModal from "./components/system/OsdrDiagnosticsModal.jsx";
import ComputerUsePanel from "./components/system/ComputerUsePanel.jsx";
import LicenseHudOverlay from "./components/system/LicenseHudOverlay.jsx";
import ReleaseRadarModal from "./components/awg/ReleaseRadarModal.jsx";
import RyanScholarPulseWidget from "./components/awg/RyanScholarPulseWidget.jsx";
import ContributorHub from "./components/community/ContributorHub.jsx";
import UserLoginPortal from "./components/auth/UserLoginPortal.jsx";
import AdminPortal from "./components/auth/AdminPortal.jsx";
import { getPersonalizedPresetsForProfile } from "./utils/researcherProfile.js";

const BrainAwgOrdinationExplorer = lazy(() =>
  import("./components/brain/BrainAwgOrdinationExplorer.jsx")
);

const LeoDosimetryExplorer = lazy(() =>
  import("./components/leo/LeoDosimetryExplorer.jsx")
);

export function resolveRouteFromPathname(pathname) {
  const clean = String(pathname || "").replace(/\/+$/, "");
  if (clean === "/contributors") return "/contributors";
  if (clean === "/brain-awg" || clean === "/brain") return "/brain-awg";
  if (clean === "/leo-dosimetry" || clean === "/leo") return "/leo-dosimetry";
  if (clean === "/account" || clean === "/login" || clean === "/signup") return "/account";
  if (clean === "/admin") return "/admin";
  return "/";
}

export default function App() {
  const {
    conversations, active, activeId, setActiveId,
    createConversation, deleteConversation, updateActive,
  } = useConversations();

  const {
    firebaseUser,
    adminSession,
    researcherProfile,
    needsOnboarding,
    dismissOnboarding,
    isAdmin,
    signOutUser,
  } = useAuth();
  const appliedProfileUidRef = useRef("");

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState([]);
  const [model, setModel] = useState("");
  const [awgMode, setAwgMode] = useState(false);
  const [exportFormat, setExportFormat] = useState("markdown");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [diagnostics, setDiagnostics] = useState(null);
  const [systemDiagnostics, setSystemDiagnostics] = useState(null);
  const [showDiagModal, setShowDiagModal] = useState(false);
  const [showComputerUseModal, setShowComputerUseModal] = useState(false);
  const [showReleaseRadarModal, setShowReleaseRadarModal] = useState(false);
  const [activeRoute, setActiveRoute] = useState(() =>
    typeof window !== "undefined" ? resolveRouteFromPathname(window.location.pathname) : "/"
  );
  const [radarInitialTab, setRadarInitialTab] = useState("releases");
  const [radarBadgeCount, setRadarBadgeCount] = useState(null);
  const [diagModalTab, setDiagModalTab] = useState("osdr");
  const scrollRef = useRef(null);

  const navigateTo = (targetPath) => {
    const normalized = resolveRouteFromPathname(targetPath);
    setActiveRoute(normalized);
    if (typeof window !== "undefined" && window.location.pathname !== normalized) {
      window.history.pushState({ route: normalized }, "", normalized);
    }
  };

  useEffect(() => {
    const onPopState = () => {
      setActiveRoute(resolveRouteFromPathname(window.location.pathname));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    fetchModels()
      .then((d) => {
        const availableModels = d.models || ["gemini-4-argon", "gemini-3.7-flash", "gemini-2.5-flash"];
        setModels(availableModels);
        const preferred =
          availableModels.find((m) => m === d.default) ||
          availableModels.find((m) => d.default && m.startsWith(d.default)) ||
          availableModels.find((m) => m === "groq/openai/gpt-oss-120b") ||
          availableModels.find((m) => m === "gemini-4-argon") ||
          availableModels[0];
        setModel(preferred || "gemini-3.7-flash");
      })
      .catch(() => {
        setModels(["gemini-4-argon", "gemini-3.7-flash", "gemini-2.5-flash"]);
        setModel("gemini-3.7-flash");
      });

    // Fetch initial OSDR retrieval & system diagnostics
    fetchSystemDiagnostics()
      .then((res) => {
        if (res.osdrDiagnostics) setDiagnostics(res.osdrDiagnostics);
        if (res.systemDiagnostics) setSystemDiagnostics(res.systemDiagnostics);
      })
      .catch(() => {
        fetchOsdrDiagnostics()
          .then((diag) => setDiagnostics(diag))
          .catch(() => {});
      });

    // Fetch lightweight Release Radar counts for header pill
    fetchAwgRadar()
      .then((data) => {
        if (data?.osdrReleases) {
          setRadarBadgeCount({
            releases: data.osdrReleases.length,
            leads: data.leadSignals?.length || 0,
          });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if ((active?.messages?.length || 0) === 0) {
      el.scrollTo(0, 0);
    } else {
      el.scrollTo(0, el.scrollHeight);
    }
  }, [active?.messages, busy, activeId, activeRoute]);

  // Apply signed-in researcher's preferred model and default AWG mode once per UID / preference update
  useEffect(() => {
    if (!researcherProfile?.uid) {
      appliedProfileUidRef.current = "";
      return;
    }
    const signature = `${researcherProfile.uid}:${researcherProfile.preferredModel || ""}:${Boolean(researcherProfile.defaultAwgMode)}`;
    if (appliedProfileUidRef.current === signature) return;
    appliedProfileUidRef.current = signature;

    if (researcherProfile.preferredModel && models.includes(researcherProfile.preferredModel)) {
      setModel(researcherProfile.preferredModel);
    }
    if (researcherProfile.defaultAwgMode) {
      setAwgMode(true);
    }
  }, [researcherProfile, models]);

  function handleQuickPrompt(promptText) {
    if (busy) return;
    executePrompt(promptText);
  }

  function handleUpdateMessage(msgIndex, updatedMsg) {
    updateActive((msgs) => {
      const copy = [...msgs];
      if (copy[msgIndex]) {
        copy[msgIndex] = updatedMsg;
      }
      return copy;
    });
  }

  const recentPair = (() => {
    const msgs = active?.messages || [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === "assistant" && Array.isArray(m.sources) && m.sources.length === 2 && !m.awgDetails?.researchPreset) {
        return { studyA: m.sources[0], studyB: m.sources[1] };
      }
    }
    return null;
  })();

  async function executePrompt(promptText) {
    let text = promptText.trim();
    if (awgMode && !/^\/awg\b|^!awg\b|^awg:/i.test(text)) {
      text = `/awg ${text}`;
    }
    if (!text || busy) return;
    setInput("");
    setBusy(true);

    const isAwgPrompt = text.toLowerCase().startsWith("/awg");

    // Snapshot history BEFORE appending, for the API call.
    const history = (active?.messages || []).map((m) => ({ role: m.role, content: m.content }));

    updateActive((msgs) => [
      ...msgs,
      { role: "user", content: text, isAwg: isAwgPrompt },
      { role: "assistant", content: "", sources: [], model, usedModel: model, isAwg: isAwgPrompt },
    ]);

    await streamChat(
      { message: text, history, model },
      {
        onSources: (studies, usedModel, isAwg, awgDetails, usedProvider) =>
          updateActive((msgs) =>
            patchLast(msgs, (m) => ({
              ...m,
              sources: studies,
              model: usedModel || m.model || model,
              usedModel: usedModel || model,
              provider: usedProvider || "Not reported",
              isAwg: typeof isAwg === "boolean" ? isAwg : isAwgPrompt,
              isAwgChooser: Boolean(awgDetails?.isGuidedChooser),
              isAwgHelp: Boolean(awgDetails?.action === "help"),
              isAwgResearchPreset: Boolean(awgDetails?.researchPreset),
              isAwgRadar: Boolean(awgDetails?.isAwgRadar || awgDetails?.action === "radar"),
              awgDetails,
            }))
          ),
        onProvider: ({ provider, model: usedModel }) =>
          updateActive((msgs) =>
            patchLast(msgs, (m) => ({
              ...m,
              provider: provider || m.provider || "Not reported",
              model: usedModel || m.model || model,
            }))
          ),
        onToken: (t) =>
          updateActive((msgs) =>
            patchLast(msgs, (m) => ({
              ...m,
              content: m.content + t,
            }))
          ),
        onError: (err) =>
          updateActive((msgs) =>
            patchLast(msgs, (m) => ({
              ...m,
              content: m.content + `\n\n[error] ${formatErrorMessage(err)}`,
            }))
          ),
        onDone: () => setBusy(false),
      }
    );
  }

  async function send(e) {
    e?.preventDefault?.();
    await executePrompt(input);
  }

  async function handleExportEvidenceBundle() {
    if (!active?.messages?.length || exporting) return;
    setExporting(true);
    setExportError("");
    try {
      let latestPrompt = "";
      const entries = [];
      for (const message of active.messages) {
        if (message.role === "user") {
          latestPrompt = typeof message.content === "string" ? message.content : "";
        } else if (message.role === "assistant" && typeof message.content === "string" && message.content.trim()) {
          entries.push({
            prompt: latestPrompt,
            response: message.content,
            citedAccessions: message.sources || [],
            model: message.model || model,
            provider: message.provider || "Not reported",
          });
        }
      }

      const blob = await exportEvidenceBundle(entries, exportFormat);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `osdr-evidence-bundle.${exportFormat === "json" ? "json" : "md"}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setExportError(formatErrorMessage(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={(id) => {
          setActiveId(id);
          if (activeRoute !== "/") navigateTo("/");
        }}
        onNew={() => {
          createConversation();
          if (activeRoute !== "/") navigateTo("/");
        }}
        onDelete={deleteConversation}
        user={firebaseUser}
        adminSession={adminSession}
        researcherProfile={researcherProfile}
        isAdmin={isAdmin}
        activeRoute={activeRoute}
        onOpenBrainAwg={() => navigateTo("/brain-awg")}
        onOpenLeoDosimetry={() => navigateTo("/leo-dosimetry")}
        onOpenAccount={() => navigateTo("/account")}
        onOpenAdmin={() => navigateTo("/admin")}
        onOpenRyanRadar={() => {
          setRadarInitialTab("leads");
          setShowReleaseRadarModal(true);
        }}
        onSignOut={signOutUser}
      />

      <main className="chat">
        <header className="chat-header">
          <div className="header-left">
            <button
              type="button"
              className="header-brand-btn"
              onClick={() => navigateTo("/")}
              title="Return to OSDR ChatBot Launchpad"
            >
              <strong>OSDR ChatBot</strong>
            </button>
            <span className="header-tag">NASA OSDR</span>
            <span className="subtitle">Evidence-Grounded Study Discovery, Comparison &amp; AWG Media</span>
          </div>
          <div className="header-right">
            <button
              type="button"
              className={`awg-mode-toggle ${awgMode ? "active" : ""}`}
              onClick={() => setAwgMode((enabled) => !enabled)}
              aria-pressed={awgMode}
              data-testid="awg-mode-toggle"
            >
              {awgMode ? "AWG Mode: On" : "AWG Mode: Off"}
            </button>
            <label className="model-control">
              <span className="model-label">Model</span>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className={model?.includes("argon") ? "model-select argon-active" : "model-select"}
              >
                {(() => {
                  const formatModelLabel = (m) => {
                    if (m === "gemini-4-argon") return "🪐 Gemini 4 Argon (Reasoning · 1M)";
                    if (m === "gemini-3.7-flash") return "⚡ Gemini 3.7 Flash (Balanced)";
                    if (m === "gemini-2.5-flash") return "⏱️ Gemini 2.5 Flash (Fast)";
                    if (m === "gemini-3.1-pro-preview") return "🔬 Gemini 3.1 Pro Preview";
                    if (m === "gemma4") return "💎 Google Gemma 4 (Open Weights)";
                    if (m === "openrouter/free") return "🆓 OpenRouter Free Auto-Router ($0 Live)";
                    if (m === "google/gemma-4-31b-it:free") return "💎 Gemma 4 31B Instruct (OpenRouter · Free)";
                    if (m === "nvidia/nemotron-3-ultra-550b-a55b:free") return "🟢 NVIDIA Nemotron 3 Ultra 550B (OpenRouter · Free)";
                    if (m === "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free") return "🧠 NVIDIA Nemotron 3 Reasoning (OpenRouter · Free)";
                    if (m === "groq/openai/gpt-oss-120b") return "🚀 Groq GPT-OSS 120B (LPU · 0.8s Free)";
                    if (m === "groq/openai/gpt-oss-20b") return "⚡ Groq GPT-OSS 20B (LPU · Fast Free)";
                    if (m === "groq/llama-3.3-70b-versatile") return "🚀 Groq Llama 3.3 70B (LPU · Free)";
                    if (m === "groq/llama-3.1-8b-instant") return "⚡ Groq Llama 3.1 8B (Instant · Free)";
                    return m;
                  };
                  const fastFreeCloud = models.filter(
                    (m) => m.startsWith("groq/") || m === "openrouter/free" || m.endsWith(":free")
                  );
                  const geminiFamily = models.filter((m) => !fastFreeCloud.includes(m));
                  return (
                    <>
                      {fastFreeCloud.length > 0 && (
                        <optgroup label="Fast Free Cloud ($0 Live · Groq & OpenRouter)">
                          {fastFreeCloud.map((m) => (
                            <option key={m} value={m}>
                              {formatModelLabel(m)}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {geminiFamily.length > 0 && (
                        <optgroup label="Google Gemini & Gemma">
                          {geminiFamily.map((m) => (
                            <option key={m} value={m}>
                              {formatModelLabel(m)}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </>
                  );
                })()}
              </select>
            </label>
            <button
              type="button"
              className="system-diagnostics-toggle"
              onClick={() => {
                setDiagModalTab("osdr");
                setShowDiagModal(true);
              }}
              aria-haspopup="dialog"
              aria-expanded={showDiagModal}
              data-testid="system-diagnostics-toggle"
            >
              System Diagnostics
            </button>
          </div>
        </header>

        <div className="messages-stage">
          {activeRoute === "/brain-awg" ? (
            <Suspense
              fallback={
                <div className="brain-loading-shell" role="status">
                  Loading Brain AWG · 3D Ordination Explorer...
                </div>
              }
            >
              <BrainAwgOrdinationExplorer onBackToChat={() => navigateTo("/")} />
            </Suspense>
          ) : activeRoute === "/leo-dosimetry" ? (
            <Suspense
              fallback={
                <div className="brain-loading-shell" role="status">
                  Loading LEO Dosimetry · SAA/GCR Pass-Audit Explorer...
                </div>
              }
            >
              <LeoDosimetryExplorer onBackToChat={() => navigateTo("/")} />
            </Suspense>
          ) : activeRoute === "/contributors" ? (
            <ContributorHub
              researcherProfile={researcherProfile}
              onBackToChat={() => navigateTo("/")}
              onRunPrompt={(cmd) => {
                navigateTo("/");
                executePrompt(cmd);
              }}
            />
          ) : activeRoute === "/account" ? (
            <UserLoginPortal
              onBackToChat={() => navigateTo("/")}
              onNavigate={navigateTo}
              onRunPrompt={(cmd) => {
                navigateTo("/");
                executePrompt(cmd);
              }}
            />
          ) : activeRoute === "/admin" ? (
            <AdminPortal
              onBackToChat={() => navigateTo("/")}
              onNavigate={navigateTo}
            />
          ) : (
            <div className="messages" ref={scrollRef}>
            {!active?.messages.length && (
              <div className="empty">
                <div className="empty-hero-icon">🪐</div>
                <div className="empty-title">NASA OSDR Research Assistant</div>
                <p className="hint">
                  Explore NASA Open Science Data Repository / GeneLab studies with evidence-grounded citations, or use <strong>AWG Mode</strong> (<code style={{ color: "var(--accent-cyan)" }}>/awg</code>) for cross-study comparison and scientific media synthesis.
                </p>

                <RyanScholarPulseWidget
                  onRunPrompt={(cmd) => executePrompt(cmd)}
                  onOpenFullRadar={(tab) => {
                    setRadarInitialTab(tab || "leads");
                    setShowReleaseRadarModal(true);
                  }}
                />

                {needsOnboarding && (
                  <div className="onboarding-nudge-bar" data-testid="home-onboarding-nudge">
                    <span className="onboarding-nudge-text">
                      <strong>Welcome!</strong> Check off your NASA OSDR AWG subgroups to customize presets &amp; your researcher profile.
                    </span>
                    <div className="onboarding-nudge-actions">
                      <button
                        type="button"
                        className="onboarding-nudge-cta"
                        onClick={() => navigateTo("/account")}
                      >
                        Set Up AWG Profile →
                      </button>
                      <button
                        type="button"
                        className="onboarding-nudge-dismiss"
                        onClick={dismissOnboarding}
                        aria-label="Dismiss profile setup banner"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}

                <div className="empty-sections">
                  {/* Standard RAG Q&A Box */}
                  <div className="suggestion-box" data-testid="study-discovery-box">
                    <div className="box-header">
                      <span>🔍</span>
                      <strong>Study Discovery &amp; Evidence Search</strong>
                    </div>
                    <button
                      type="button"
                      className="suggestion-btn"
                      data-testid="study-discovery-btn-iop"
                      onClick={() => handleQuickPrompt("Which studies measured intraocular pressure during spaceflight?")}
                    >
                      "Which studies measured intraocular pressure during spaceflight?"
                    </button>
                    <button
                      type="button"
                      className="suggestion-btn"
                      data-testid="study-discovery-btn-osd87"
                      onClick={() => handleQuickPrompt("Tell me about mouse retina gene expression in STS-135 (OSD-87).")}
                    >
                      "Tell me about mouse retina gene expression in STS-135 (OSD-87)"
                    </button>
                    <button
                      type="button"
                      className="suggestion-btn"
                      data-testid="study-discovery-btn-osd758"
                      onClick={() => handleQuickPrompt("What artificial gravity countermeasures are tested in OSD-758?")}
                    >
                      "What artificial gravity countermeasures are tested in OSD-758?"
                    </button>
                    <button
                      type="button"
                      className="suggestion-btn"
                      data-testid="study-discovery-btn-deep"
                      style={{ borderColor: "rgba(168, 85, 247, 0.4)" }}
                      onClick={() => handleQuickPrompt("Perform deep multi-omics reasoning comparing mouse transcriptomics (OSD-100) and rat ocular pressure (OSD-679).")}
                    >
                      🪐 "Deep cross-study reasoning comparing OSD-100 and OSD-679"
                    </button>
                  </div>

                  <div className="suggestion-box awg-promo" data-testid="awg-research-presets">
                    <div className="box-header">
                      <span>✦</span>
                      <strong>AWG Research Presets</strong>
                      {researcherProfile?.awgSubgroups?.length > 0 && (
                        <span className="preset-tailored-pill">Tailored to Your AWG</span>
                      )}
                    </div>
                    {getPersonalizedPresetsForProfile(researcherProfile).map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        data-testid={`awg-preset-btn-${preset.id}`}
                        className={`suggestion-btn awg-code ${preset.isMatched ? "is-awg-matched" : ""}`}
                        onClick={() => executePrompt(preset.command)}
                      >
                        <span>{preset.label}</span>
                        {preset.isMatched && (
                          <span className="preset-matched-badge">★ Your AWG</span>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* AWG Media Mode Box */}
                  <div className="suggestion-box awg-promo">
                    <div className="box-header">
                      <span>✦</span>
                      <strong>AWG Study Comparison (/awg)</strong>
                    </div>
                    <button
                      className="suggestion-btn awg-code"
                      onClick={() => executePrompt("/awg")}
                    >
                      /awg (Open Guided Chooser) ➔
                    </button>
                    <button
                      className="suggestion-btn awg-code"
                      onClick={() => executePrompt("/awg random")}
                    >
                      /awg random (Roll Scored Compatible Pair) ➔
                    </button>
                    <button
                      className="suggestion-btn awg-code"
                      onClick={() => executePrompt("/awg compare OSD-679 OSD-680")}
                    >
                      /awg compare OSD-679 OSD-680 (OCT Imaging × Optic-Nerve MRI) ➔
                    </button>
                    <button
                      className="suggestion-btn awg-code"
                      onClick={() => {
                        setRadarInitialTab("releases");
                        setShowReleaseRadarModal(true);
                      }}
                    >
                      Release Radar: Quarterly OSDR &amp; AWG Lead Pre-OSDR Watch ➔
                    </button>
                    <button
                      type="button"
                      className="suggestion-btn awg-code"
                      onClick={() => navigateTo("/brain-awg")}
                      data-testid="empty-open-brain-awg-btn"
                    >
                      Brain AWG 3D Ordination Explorer (/brain-awg): scikit-bio rclr + PCoA + PERMANOVA ➔
                    </button>
                    <button
                      type="button"
                      className="suggestion-btn awg-code"
                      onClick={() => navigateTo("/leo-dosimetry")}
                      data-testid="empty-open-leo-dosimetry-btn"
                    >
                      LEO Dosimetry · SAA/GCR Pass-Audit Explorer (/leo-dosimetry): Thread #3665 ML Eval ➔
                    </button>
                    <button
                      className="suggestion-btn awg-code"
                      onClick={() => navigateTo("/contributors")}
                      data-testid="empty-open-integrations-btn"
                    >
                      Contributor Hub (/contributors): RetinaCellTwin, SpaceSleepTwin &amp; Intake ➔
                    </button>
                    <button
                      className="suggestion-btn awg-code"
                      onClick={() => executePrompt("/awg radar")}
                    >
                      /awg radar (Stream Release Digest in Chat) ➔
                    </button>
                    <button
                      className="suggestion-btn awg-code"
                      onClick={() => executePrompt("/awg help")}
                    >
                      /awg help (Command Reference) ➔
                    </button>
                  </div>
                </div>
              </div>
            )}

            {active?.messages.map((m, i) => (
              <Message
                key={i}
                message={m}
                streaming={busy && i === active.messages.length - 1}
                onUpdateMessage={(updated) => handleUpdateMessage(i, updated)}
                onRunCommand={(cmd) => executePrompt(cmd)}
                onOpenRadar={(tab) => {
                  setRadarInitialTab(tab || "releases");
                  setShowReleaseRadarModal(true);
                }}
                recentPair={recentPair}
              />
            ))}
            </div>
          )}

          {activeRoute !== "/brain-awg" && activeRoute !== "/leo-dosimetry" && <LicenseHudOverlay />}
        </div>

        {activeRoute === "/" && (
          <div className="composer-area">
            <form className="composer" onSubmit={send}>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Search OSDR studies or type /awg, /awg radar, /awg compare OSD-679 OSD-680..."
                disabled={busy}
                autoFocus
              />
              <button type="submit" disabled={busy || !input.trim()}>
                {busy ? "..." : "Send"}
              </button>
            </form>
            <div className="thread-export">
              {exportError && <span className="export-error" role="alert">{exportError}</span>}
              <label>
                <span className="sr-only">Evidence bundle format</span>
                <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}>
                  <option value="markdown">Markdown</option>
                  <option value="json">JSON</option>
                </select>
              </label>
              <button
                type="button"
                onClick={handleExportEvidenceBundle}
                disabled={busy || exporting || !active?.messages?.some((m) => m.role === "assistant" && m.content?.trim())}
              >
                {exporting ? "Preparing bundle..." : "Export Evidence Bundle"}
              </button>
            </div>
          </div>
        )}
      </main>

      <ReleaseRadarModal
        isOpen={showReleaseRadarModal}
        initialTab={radarInitialTab}
        onClose={() => setShowReleaseRadarModal(false)}
        onRunPrompt={(cmd) => {
          setShowReleaseRadarModal(false);
          executePrompt(cmd);
        }}
        onSnapshotLoaded={(data) => {
          if (data?.osdrReleases) {
            setRadarBadgeCount({
              releases: data.osdrReleases.length,
              leads: data.leadSignals?.length || 0,
            });
          }
        }}
      />

      <ComputerUsePanel
        isOpen={showComputerUseModal}
        onClose={() => setShowComputerUseModal(false)}
      />

      {showDiagModal && (
        <OsdrDiagnosticsModal
          diagnostics={diagnostics}
          systemDiagnostics={systemDiagnostics}
          initialTab={diagModalTab}
          onOpenComputerUse={() => {
            setShowDiagModal(false);
            setShowComputerUseModal(true);
          }}
          onOpenReleaseRadar={() => {
            setShowDiagModal(false);
            setRadarInitialTab("releases");
            setShowReleaseRadarModal(true);
          }}
          onOpenContributorHub={() => {
            setShowDiagModal(false);
            navigateTo("/contributors");
          }}
          onOpenAccount={() => {
            setShowDiagModal(false);
            navigateTo("/account");
          }}
          onOpenAdmin={() => {
            setShowDiagModal(false);
            navigateTo("/admin");
          }}
          onClose={() => setShowDiagModal(false)}
          onRefresh={(newDiag, newSysDiag) => {
            if (newDiag) setDiagnostics(newDiag);
            if (newSysDiag) setSystemDiagnostics(newSysDiag);
          }}
        />
      )}
    </div>
  );
}

// Replace the last message in the list via `fn`.
function patchLast(msgs, fn) {
  if (!msgs.length) return msgs;
  const copy = msgs.slice();
  copy[copy.length - 1] = fn(copy[copy.length - 1]);
  return copy;
}
