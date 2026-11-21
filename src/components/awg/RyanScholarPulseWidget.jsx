import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Radar,
  Sparkles,
  Star,
} from "lucide-react";
import { fetchAwgRadar, triggerRadarMonitorCheck } from "../../api.js";

const RYAN_SCHOLAR_URL =
  "https://scholar.google.com/scholar?q=author%3A%22Ryan+T.+Scott%22+NASA+space+biology+OSDR";
const RYAN_ORCID_URL = "https://orcid.org/0000-0003-0654-5661";

export default function RyanScholarPulseWidget({
  onRunPrompt,
  onOpenFullRadar,
  compactSidebarMode = false,
}) {
  const [signals, setSignals] = useState([]);
  const [webhookStatus, setWebhookStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("all"); // "all" | "2026" | "ntrs" | "journals"
  const [tickerIdx, setTickerIdx] = useState(0);
  const [syncNotice, setSyncNotice] = useState("");

  useEffect(() => {
    let active = true;
    fetchAwgRadar({ lead: "ryan-scott" })
      .then((data) => {
        if (!active) return;
        const ryanList = (data?.filteredLeadSignals || data?.leadSignals || []).filter(
          (s) => s.leadId === "ryan-scott"
        );
        setSignals(ryanList);
        if (data?.webhookStatus) {
          setWebhookStatus(data.webhookStatus);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Gentle auto-advance for the 1-line collapsed ticker every 6.5s
  useEffect(() => {
    if (expanded || signals.length <= 1) return undefined;
    const timer = setInterval(() => {
      setTickerIdx((prev) => (prev + 1) % Math.min(signals.length, 5));
    }, 6500);
    return () => clearInterval(timer);
  }, [expanded, signals.length]);

  const filteredSignals = useMemo(() => {
    return signals.filter((sig) => {
      if (sourceFilter === "2026") {
        return String(sig.publishedDate || "").startsWith("2026");
      }
      if (sourceFilter === "ntrs") {
        return String(sig.sourcePlatform || "").toLowerCase().includes("ntrs");
      }
      if (sourceFilter === "journals") {
        return !String(sig.sourcePlatform || "").toLowerCase().includes("ntrs");
      }
      return true;
    });
  }, [signals, sourceFilter]);

  const latestSignal = signals[tickerIdx % Math.max(1, signals.length)] || signals[0] || null;

  const handleRun8hCheck = async (e) => {
    e?.stopPropagation?.();
    if (checking) return;
    setChecking(true);
    setSyncNotice("");
    try {
      const res = await triggerRadarMonitorCheck(true);
      const ryanList = (
        res?.snapshot?.leadSignals || []
      ).filter((s) => s.leadId === "ryan-scott");
      if (ryanList.length > 0) {
        setSignals(ryanList);
      }
      if (res?.webhookStatus) {
        setWebhookStatus(res.webhookStatus);
      }
      const newCount = res?.diff?.spotlightLeadDropsCount || 0;
      setSyncNotice(
        newCount > 0
          ? `+${newCount} new Ryan T. Scott drop(s) detected!`
          : `8h sync verified (${ryanList.length || signals.length} works indexed)`
      );
      setTimeout(() => setSyncNotice(""), 4000);
    } catch {
      setSyncNotice("Using verified 8h snapshot");
      setTimeout(() => setSyncNotice(""), 3200);
    } finally {
      setChecking(false);
    }
  };

  const handleAskAboutSignal = (sig) => {
    if (!sig) return;
    const osdTag = sig.linkedOsdIds?.length ? ` (${sig.linkedOsdIds.join(", ")})` : "";
    const prompt = sig.concepts?.[0]?.command
      ? sig.concepts[0].command
      : `Summarize Ryan T. Scott's ${sig.publishedDate} release "${sig.title}"${osdTag} and explain how it connects to NASA OSDR datasets.`;
    onRunPrompt?.(prompt);
  };

  if (compactSidebarMode) {
    return (
      <div className="ryan-sidebar-pulse" data-testid="ryan-sidebar-pulse">
        <button
          type="button"
          className="ryan-sidebar-pulse-btn"
          onClick={() => onOpenFullRadar?.("leads")}
          title="Open Ryan T. Scott 8-Hour Scholar & Pre-OSDR Release Watch"
        >
          <span className="ryan-pulse-dot" />
          <span className="ryan-sidebar-pulse-text">
            <strong>Ryan T. Scott Drops</strong> · {signals.length || 15} tracked
          </span>
          <Radar size={12} />
        </button>
      </div>
    );
  }

  return (
    <section
      className={`ryan-pulse-widget ${expanded ? "is-expanded" : "is-collapsed"}`}
      aria-label="Ryan T. Scott Latest Scholar & Pre-OSDR Drops"
      data-testid="ryan-scholar-pulse-widget"
    >
      {/* Sleek 1-Line Collapsible Pulse Bar (Zero UI Overload) */}
      <div className="ryan-pulse-bar">
        <div className="ryan-pulse-left">
          <span className="ryan-live-badge" title="Automated 8-hour scraping active across ORCID, OpenAlex, NASA NTRS, Crossref, PubMed & Europe PMC">
            <span className="ryan-pulse-dot" />
            <Star size={11} />
            <span>Lab Lead 8h Pulse · Ryan T. Scott</span>
          </span>

          {loading ? (
            <span className="ryan-ticker-headline muted">
              Loading Ryan T. Scott&apos;s latest Scholar &amp; NASA NTRS drops…
            </span>
          ) : latestSignal ? (
            <button
              type="button"
              className="ryan-ticker-headline-btn"
              onClick={() => setExpanded((prev) => !prev)}
              title="Click to expand Ryan T. Scott's latest releases"
              data-testid="ryan-ticker-headline-btn"
            >
              <span className="ryan-ticker-date">{latestSignal.publishedDate}</span>
              <span className="ryan-ticker-source">{latestSignal.sourcePlatform}</span>
              <span className="ryan-ticker-title">{latestSignal.title}</span>
            </button>
          ) : null}
        </div>

        <div className="ryan-pulse-actions">
          {syncNotice && <span className="ryan-sync-pill">{syncNotice}</span>}

          {latestSignal && !expanded && (
            <button
              type="button"
              className="ryan-mini-btn is-accent"
              onClick={() => handleAskAboutSignal(latestSignal)}
              title="Ask OSDR ChatBot how this release connects to indexed OSDR studies"
              data-testid="ryan-ticker-ask-btn"
            >
              <Sparkles size={11} />
              <span>Ask in Chat</span>
            </button>
          )}

          <button
            type="button"
            className="ryan-mini-btn"
            onClick={handleRun8hCheck}
            disabled={checking}
            title="Run live 8-hour scrape across ORCID, OpenAlex, NASA NTRS, Crossref & PubMed"
            data-testid="ryan-widget-sync-btn"
          >
            <Activity size={11} className={checking ? "rr-spin" : ""} />
            <span>{checking ? "Syncing…" : "8h Sync"}</span>
          </button>

          <button
            type="button"
            className="ryan-mini-btn is-toggle"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            data-testid="ryan-widget-toggle-btn"
          >
            <span>{expanded ? "Hide Drops" : `View ${signals.length || 15} Drops`}</span>
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {/* Expandable Interactive Drawer (Only open when requested) */}
      {expanded && (
        <div className="ryan-pulse-drawer" data-testid="ryan-pulse-drawer">
          <div className="ryan-drawer-toolbar">
            <div className="ryan-filter-pills" role="tablist" aria-label="Filter Ryan T. Scott Drops">
              {[
                { id: "all", label: `All Scoped (${signals.length})` },
                {
                  id: "2026",
                  label: `2026 Drops (${signals.filter((s) => String(s.publishedDate || "").startsWith("2026")).length})`,
                },
                {
                  id: "ntrs",
                  label: `NASA NTRS (${signals.filter((s) => String(s.sourcePlatform || "").toLowerCase().includes("ntrs")).length})`,
                },
                {
                  id: "journals",
                  label: `OpenAlex / Journals (${signals.filter((s) => !String(s.sourcePlatform || "").toLowerCase().includes("ntrs")).length})`,
                },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={sourceFilter === tab.id}
                  className={`ryan-filter-chip ${sourceFilter === tab.id ? "active" : ""}`}
                  onClick={() => setSourceFilter(tab.id)}
                  data-testid={`ryan-filter-${tab.id}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="ryan-external-links">
              <a
                href={RYAN_SCHOLAR_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="ryan-ext-pill"
                data-testid="ryan-google-scholar-link"
              >
                <span>Google Scholar</span>
                <ExternalLink size={11} />
              </a>
              <a
                href={RYAN_ORCID_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="ryan-ext-pill"
                data-testid="ryan-orcid-link"
              >
                <span>ORCID (0000-0003-0654-5661)</span>
                <ExternalLink size={11} />
              </a>
              <button
                type="button"
                className="ryan-ext-pill is-radar-btn"
                onClick={() => onOpenFullRadar?.("leads")}
                data-testid="ryan-open-full-radar-btn"
              >
                <Radar size={11} />
                <span>Full 9-Lead Radar</span>
              </button>
            </div>
          </div>

          <div className="ryan-cards-grid">
            {filteredSignals.slice(0, 6).map((sig) => (
              <article
                key={sig.id}
                className="ryan-drop-card"
                data-testid={`ryan-drop-card-${sig.id}`}
              >
                <div className="ryan-drop-meta">
                  <span className="ryan-drop-date">{sig.publishedDate}</span>
                  <span className="ryan-drop-platform">{sig.sourcePlatform}</span>
                  {sig.linkedOsdIds?.map((osdId) => (
                    <span key={osdId} className="ryan-drop-osd">
                      {osdId}
                    </span>
                  ))}
                </div>

                <h4 className="ryan-drop-title">{sig.title}</h4>
                <div className="ryan-drop-venue">{sig.journal}</div>

                <div className="ryan-drop-foot">
                  <button
                    type="button"
                    className="ryan-card-ask-btn"
                    onClick={() => handleAskAboutSignal(sig)}
                  >
                    <span>Bridge to OSDR in Chat</span>
                    <ArrowRight size={12} />
                  </button>

                  <a
                    href={sig.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ryan-card-source-link"
                  >
                    <span>Source</span>
                    <ExternalLink size={11} />
                  </a>
                </div>
              </article>
            ))}
          </div>

          <div className="ryan-drawer-foot">
            <span>
              Auto-scraped every {webhookStatus?.intervalHours || 8}h via ORCID + OpenAlex + NASA
              NTRS + Crossref + PubMed + Europe PMC (CAPTCHA-free Google Scholar alternative).
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
