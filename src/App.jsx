import { useEffect, useRef, useState } from "react";
import { useConversations } from "./hooks/useConversations.js";
import { streamChat, fetchModels, fetchOsdrDiagnostics, fetchSystemDiagnostics, formatErrorMessage } from "./api.js";
import Sidebar from "./components/Sidebar.jsx";
import Message from "./components/Message.jsx";
import OsdrDiagnosticsModal from "./components/OsdrDiagnosticsModal.jsx";

export default function App() {
  const {
    conversations, active, activeId, setActiveId,
    createConversation, deleteConversation, updateActive,
  } = useConversations();

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState([]);
  const [model, setModel] = useState("");
  const [diagnostics, setDiagnostics] = useState(null);
  const [systemDiagnostics, setSystemDiagnostics] = useState(null);
  const [showDiagModal, setShowDiagModal] = useState(false);
  const [diagModalTab, setDiagModalTab] = useState("osdr");
  const scrollRef = useRef(null);

  useEffect(() => {
    fetchModels()
      .then((d) => {
        setModels(d.models || ["gemini-3.7-flash", "gemini-2.5-flash"]);
        const preferred = (d.models || []).find((m) => m.startsWith(d.default)) || d.models?.[0];
        setModel(preferred || "gemini-3.7-flash");
      })
      .catch(() => {
        setModels(["gemini-3.7-flash", "gemini-2.5-flash"]);
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
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [active?.messages, busy]);

  function handleQuickPrompt(promptText) {
    if (busy) return;
    setInput(promptText);
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
      if (m.role === "assistant" && Array.isArray(m.sources) && m.sources.length >= 2) {
        return { studyA: m.sources[0], studyB: m.sources[1] };
      }
    }
    return null;
  })();

  async function executePrompt(promptText) {
    const text = promptText.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);

    const isAwgPrompt = text.toLowerCase().startsWith("/awg");

    // Snapshot history BEFORE appending, for the API call.
    const history = (active?.messages || []).map((m) => ({ role: m.role, content: m.content }));

    updateActive((msgs) => [
      ...msgs,
      { role: "user", content: text, isAwg: isAwgPrompt },
      { role: "assistant", content: "", sources: [], isAwg: isAwgPrompt },
    ]);

    await streamChat(
      { message: text, history, model },
      {
        onSources: (studies, usedModel, isAwg, awgDetails) =>
          updateActive((msgs) =>
            patchLast(msgs, (m) => ({
              ...m,
              sources: studies,
              isAwg: typeof isAwg === "boolean" ? isAwg : isAwgPrompt,
              isAwgChooser: Boolean(awgDetails?.isGuidedChooser),
              isAwgHelp: Boolean(awgDetails?.action === "help"),
              awgDetails,
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

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={createConversation}
        onDelete={deleteConversation}
      />

      <main className="chat">
        <header className="chat-header">
          <div className="header-left">
            <strong>OSDR ChatBot</strong>
            <span className="header-tag">NASA OSDR</span>
            <span className="subtitle">Evidence-Grounded Study Discovery, Comparison &amp; AWG Media</span>
          </div>
          <div className="header-right">
            <button
              className="osdr-header-status-btn"
              onClick={() => {
                setDiagModalTab("osdr");
                setShowDiagModal(true);
              }}
              title="Click to view NASA OSDR connection audit & diagnostics"
            >
              <span
                className="status-indicator-dot"
                style={{
                  backgroundColor:
                    diagnostics?.connectionStatus === "connected"
                      ? "#10b981"
                      : diagnostics?.connectionStatus === "degraded"
                      ? "#f59e0b"
                      : "#94a3b8",
                }}
              />
              <span>
                {diagnostics?.connectionStatus === "connected"
                  ? "OSDR: Live REST API"
                  : diagnostics?.sourceMode === "local_curated_mapping"
                  ? "OSDR: Curated Index"
                  : "OSDR: Status"}
              </span>
            </button>

            <button
              className="osdr-header-status-btn"
              onClick={() => {
                setDiagModalTab("ai");
                setShowDiagModal(true);
              }}
              title="Click to view Gemini Model Discovery & Server Environment"
              style={{ marginLeft: "4px" }}
            >
              <span
                className="status-indicator-dot"
                style={{
                  backgroundColor:
                    systemDiagnostics?.discoveryStatus === "live_success"
                      ? "#10b981"
                      : systemDiagnostics?.discoveryStatus === "key_missing"
                      ? "#38bdf8"
                      : systemDiagnostics?.discoveryStatus === "quota_error"
                      ? "#f59e0b"
                      : "#94a3b8",
                }}
              />
              <span>
                {systemDiagnostics?.discoveryStatus === "live_success"
                  ? "AI: Live API"
                  : systemDiagnostics?.discoveryStatus === "key_missing"
                  ? "AI: Grounded RAG"
                  : "AI: Discovery"}
              </span>
            </button>

            <span className="model-label">Model:</span>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </header>

        <div className="messages" ref={scrollRef}>
          {!active?.messages.length && (
            <div className="empty">
              <div className="empty-hero-icon">🪐</div>
              <div className="empty-title">NASA OSDR Research Assistant</div>
              <p className="hint">
                Explore NASA Open Science Data Repository / GeneLab studies with evidence-grounded citations, or use <strong>AWG Mode</strong> (<code style={{ color: "var(--accent-cyan)" }}>/awg</code>) for cross-study comparison and scientific media synthesis.
              </p>

              <div className="empty-sections">
                {/* Standard RAG Q&A Box */}
                <div className="suggestion-box">
                  <div className="box-header">
                    <span>🔍</span>
                    <strong>Study Discovery &amp; Evidence Search</strong>
                  </div>
                  <button
                    className="suggestion-btn"
                    onClick={() => handleQuickPrompt("Which studies measured intraocular pressure during spaceflight?")}
                  >
                    "Which studies measured intraocular pressure during spaceflight?"
                  </button>
                  <button
                    className="suggestion-btn"
                    onClick={() => handleQuickPrompt("Tell me about mouse retina gene expression in STS-135 (OSD-87).")}
                  >
                    "Tell me about mouse retina gene expression in STS-135 (OSD-87)"
                  </button>
                  <button
                    className="suggestion-btn"
                    onClick={() => handleQuickPrompt("What artificial gravity countermeasures are tested in OSD-758?")}
                  >
                    "What artificial gravity countermeasures are tested in OSD-758?"
                  </button>
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
                    /awg compare OSD-679 OSD-680 (RNA-seq × Proteomics) ➔
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
              recentPair={recentPair}
            />
          ))}
        </div>

        <form className="composer" onSubmit={send}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search OSDR studies or type /awg, /awg compare OSD-679 OSD-680, /awg random…"
            disabled={busy}
            autoFocus
          />
          <button type="submit" disabled={busy || !input.trim()}>
            {busy ? "…" : "Send"}
          </button>
        </form>
      </main>

      {showDiagModal && (
        <OsdrDiagnosticsModal
          diagnostics={diagnostics}
          systemDiagnostics={systemDiagnostics}
          initialTab={diagModalTab}
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
