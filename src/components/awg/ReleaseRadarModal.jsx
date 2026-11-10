import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Clock,
  Copy,
  Database,
  ExternalLink,
  FlaskConical,
  GitBranch,
  Radar,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
  X,
} from "lucide-react";
import { fetchAwgRadar, refreshAwgRadar } from "../../api.js";

function matchesWindowFilter(windowBucket, isRecentMonth, filterKey) {
  if (!filterKey || filterKey === "all") return true;
  if (filterKey === "month") return Boolean(isRecentMonth) || windowBucket === "month";
  if (filterKey === "current_quarter") {
    return windowBucket === "month" || windowBucket === "current_quarter";
  }
  if (filterKey === "prev_quarter") return windowBucket === "prev_quarter";
  if (filterKey === "recent_quarters") {
    return (
      windowBucket === "month" ||
      windowBucket === "current_quarter" ||
      windowBucket === "prev_quarter"
    );
  }
  return true;
}

function getWindowBadgeLabel(windowBucket, isRecentMonth, quarterLabel, snapshot) {
  if (isRecentMonth || windowBucket === "month") {
    return `${snapshot?.currentMonthLabel || "Last 30 Days"} (${quarterLabel})`;
  }
  if (windowBucket === "current_quarter") return `${quarterLabel} (Current Qtr)`;
  if (windowBucket === "prev_quarter") return `${quarterLabel} (Prev Qtr)`;
  return quarterLabel || "Archive";
}

function cleanStudyIdList(ids) {
  return Array.isArray(ids) ? ids.filter(Boolean) : [];
}

export default function ReleaseRadarModal({
  isOpen,
  initialTab = "releases",
  initialSubgroup = "all",
  initialWindow = "all",
  onClose,
  onRunPrompt,
  onSnapshotLoaded,
}) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  const [activeTab, setActiveTab] = useState(initialTab);
  const [windowFilter, setWindowFilter] = useState(initialWindow || "all");
  const [subgroupFilter, setSubgroupFilter] = useState(initialSubgroup || "all");
  const [leadFilter, setLeadFilter] = useState("all");
  const [leadStatusFilter, setLeadStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedReleaseId, setSelectedReleaseId] = useState(null);
  const [selectedLeadSignalId, setSelectedLeadSignalId] = useState(null);
  const [copiedDigest, setCopiedDigest] = useState(false);

  const detailRef = useRef(null);
  const isMountedRef = useRef(true);
  const fetchingRef = useRef(false);
  const onSnapshotLoadedRef = useRef(onSnapshotLoaded);
  onSnapshotLoadedRef.current = onSnapshotLoaded;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(initialTab || "releases");
    if (initialSubgroup) setSubgroupFilter(initialSubgroup);
    if (initialWindow) setWindowFilter(initialWindow);
  }, [isOpen, initialTab, initialSubgroup, initialWindow]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || snapshot || fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    setErrorMsg("");
    fetchAwgRadar()
      .then((data) => {
        if (!isMountedRef.current) return;
        setSnapshot(data);
        onSnapshotLoadedRef.current?.(data);
      })
      .catch((err) => {
        if (!isMountedRef.current) return;
        setErrorMsg(err?.message || "Failed to load Release Radar data.");
      })
      .finally(() => {
        fetchingRef.current = false;
        if (isMountedRef.current) setLoading(false);
      });
  }, [isOpen, snapshot]);

  const handleSyncLive = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncNotice(null);
    setErrorMsg("");
    try {
      const data = await refreshAwgRadar(true);
      setSnapshot(data);
      onSnapshotLoaded?.(data);
      if (data?.refreshed) {
        setSyncNotice({
          tone: "success",
          text: `Live sync updated (${data.osdrReleases?.length || 0} OSDR releases · ${data.leadSignals?.length || 0} scoped lead works).`,
        });
      } else {
        setSyncNotice({
          tone: "info",
          text: `Serving verified snapshot (${data?.reason || "offline_fallback"}): live upstream APIs were unavailable or partially rate-limited.`,
        });
      }
    } catch (err) {
      setSyncNotice({
        tone: "warn",
        text: err?.message || "Sync request failed; keeping bundled snapshot.",
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleCopyDigest = async () => {
    const md = snapshot?.digestMarkdown;
    if (!md) return;
    try {
      await navigator.clipboard.writeText(md);
      setCopiedDigest(true);
      setTimeout(() => setCopiedDigest(false), 2200);
    } catch {
      // Ignore clipboard permission errors in non-HTTPS contexts
    }
  };

  const releases = snapshot?.osdrReleases || [];
  const leadSignals = snapshot?.leadSignals || [];
  const leadsMeta = snapshot?.leads || [];

  const windowCounts = useMemo(() => {
    const list = activeTab === "releases" ? releases : leadSignals;
    return {
      all: list.length,
      month: list.filter((i) => matchesWindowFilter(i.windowBucket, i.isRecentMonth, "month")).length,
      current_quarter: list.filter((i) =>
        matchesWindowFilter(i.windowBucket, i.isRecentMonth, "current_quarter")
      ).length,
      prev_quarter: list.filter((i) =>
        matchesWindowFilter(i.windowBucket, i.isRecentMonth, "prev_quarter")
      ).length,
      recent_quarters: list.filter((i) =>
        matchesWindowFilter(i.windowBucket, i.isRecentMonth, "recent_quarters")
      ).length,
    };
  }, [activeTab, releases, leadSignals]);

  const subgroupChips = useMemo(() => {
    const byWindow = releases.filter((r) =>
      matchesWindowFilter(r.windowBucket, r.isRecentMonth, windowFilter)
    );
    const countSub = (key) => {
      if (key === "all") return byWindow.length;
      if (key === "sans") {
        return byWindow.filter((r) => r.sansRelevant || r.subgroup === "SANS / Ocular").length;
      }
      if (key === "cgene" || key === "alsda") {
        return byWindow.filter((r) => r.sourceSystem === key).length;
      }
      return byWindow.filter((r) => r.subgroup === key).length;
    };

    const defs = [
      { id: "all", label: "All Subgroups" },
      { id: "sans", label: "SANS / Ocular", highlight: true },
      { id: "cgene", label: "CGENE Omics" },
      { id: "ALSDA", label: "ALSDA" },
      { id: "RadLab", label: "RadLab" },
      { id: "Human", label: "Human" },
      { id: "Animal", label: "Animal" },
      { id: "Plant", label: "Plant" },
      { id: "Microbes", label: "Microbes" },
      { id: "Multi-Omics", label: "Multi-Omics" },
    ];

    return defs
      .map((d) => ({ ...d, count: countSub(d.id) }))
      .filter((d) => d.id === "all" || d.id === "sans" || d.count > 0);
  }, [releases, windowFilter]);

  const filteredReleases = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return releases.filter((item) => {
      if (!matchesWindowFilter(item.windowBucket, item.isRecentMonth, windowFilter)) return false;
      if (subgroupFilter !== "all") {
        if (subgroupFilter === "sans") {
          if (!item.sansRelevant && item.subgroup !== "SANS / Ocular") return false;
        } else if (subgroupFilter === "cgene" || subgroupFilter === "alsda") {
          if (item.sourceSystem !== subgroupFilter) return false;
        } else if (item.subgroup !== subgroupFilter) {
          return false;
        }
      }
      if (q) {
        const hay =
          `${item.studyId} ${item.title} ${item.organism} ${item.materialType} ${item.assayMeasurement} ${item.subgroup} ${item.mission}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [releases, windowFilter, subgroupFilter, searchQuery]);

  const filteredLeadSignals = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return leadSignals.filter((sig) => {
      if (!matchesWindowFilter(sig.windowBucket, sig.isRecentMonth, windowFilter)) return false;
      if (leadFilter !== "all" && sig.leadId !== leadFilter) return false;
      if (leadStatusFilter !== "all" && sig.status !== leadStatusFilter) return false;
      if (q) {
        const hay = `${sig.title} ${sig.leadName} ${sig.leadSubgroup} ${sig.journal} ${
          sig.doi || ""
        } ${cleanStudyIdList(sig.linkedOsdIds).join(" ")} ${cleanStudyIdList(
          sig.externalAccessions
        ).join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [leadSignals, windowFilter, leadFilter, leadStatusFilter, searchQuery]);

  const activeRelease = useMemo(() => {
    if (filteredReleases.length === 0) return null;
    return (
      filteredReleases.find((r) => r.studyId === selectedReleaseId) || filteredReleases[0]
    );
  }, [filteredReleases, selectedReleaseId]);

  const activeLeadSignal = useMemo(() => {
    if (filteredLeadSignals.length === 0) return null;
    return (
      filteredLeadSignals.find((s) => s.id === selectedLeadSignalId) || filteredLeadSignals[0]
    );
  }, [filteredLeadSignals, selectedLeadSignalId]);

  const leadSignalsByLeadCount = useMemo(() => {
    const map = {};
    for (const sig of leadSignals) {
      if (!matchesWindowFilter(sig.windowBucket, sig.isRecentMonth, windowFilter)) continue;
      if (leadStatusFilter !== "all" && sig.status !== leadStatusFilter) continue;
      map[sig.leadId] = (map[sig.leadId] || 0) + 1;
    }
    return map;
  }, [leadSignals, windowFilter, leadStatusFilter]);

  const leadStatusCounts = useMemo(() => {
    const base = leadSignals.filter((sig) => {
      if (!matchesWindowFilter(sig.windowBucket, sig.isRecentMonth, windowFilter)) return false;
      if (leadFilter !== "all" && sig.leadId !== leadFilter) return false;
      return true;
    });
    return {
      all: base.length,
      pre_osdr_signal: base.filter((s) => s.status === "pre_osdr_signal").length,
      live_on_osdr: base.filter((s) => s.status === "live_on_osdr").length,
    };
  }, [leadSignals, windowFilter, leadFilter]);

  const handleRunInChat = (concept) => {
    const cmd = concept?.command || concept?.prompt;
    if (!cmd) return;
    onRunPrompt?.(cmd);
  };

  if (!isOpen) return null;

  const isLiveSynced =
    snapshot?.sourceStatus?.osdrMode === "live_api" &&
    snapshot?.sourceStatus?.orcidMode === "live_api";

  const selectedLeadProfile =
    leadFilter !== "all" ? leadsMeta.find((l) => l.id === leadFilter) : null;

  const sansTotalCount = releases.filter((r) => r.sansRelevant).length;
  const preOsdrTotalCount = leadSignals.filter((s) => s.status === "pre_osdr_signal").length;
  const liveOsdrLeadCount = leadSignals.filter((s) => s.status === "live_on_osdr").length;

  return (
    <div
      className="modal-backdrop rr-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="release-radar-title"
    >
      <div
        className="modal-card rr-modal"
        onClick={(e) => e.stopPropagation()}
        data-testid="release-radar-modal"
      >
        {/* Top Studio Header */}
        <div className="rr-header">
          <div className="rr-title-block">
            <div className="rr-title-row">
              <span className="rr-radar-icon" aria-hidden="true">
                <Radar size={18} strokeWidth={2} />
              </span>
              <h2 id="release-radar-title" className="rr-title">
                OSDR Release Radar
              </h2>
              <span className={`rr-source-pill ${isLiveSynced ? "is-live" : "is-snapshot"}`}>
                <span className="rr-pulse-dot" />
                {isLiveSynced ? "Verified Live Feed" : "Curated Snapshot"}
              </span>
              {snapshot?.generatedAt && (
                <span className="rr-date-stamp">
                  Updated {snapshot.generatedAt.slice(0, 10)}
                </span>
              )}
            </div>
            <p className="rr-subtitle">
              Track quarterly &amp; monthly NASA OSDR depositions alongside Pre-OSDR research signals from all 9 GeneLab AWG Subgroup Chairs + Ryan T. Scott.
            </p>
          </div>

          <div className="rr-header-actions">
            <button
              type="button"
              className="rr-btn rr-btn-ghost"
              onClick={handleSyncLive}
              disabled={syncing || loading}
              title="Query NASA OSDR, ORCID, OpenAlex, and Europe PMC live"
            >
              <RefreshCw size={14} className={syncing ? "rr-spin" : ""} />
              <span>{syncing ? "Syncing…" : "Sync Live"}</span>
            </button>
            <button
              type="button"
              className={`rr-btn rr-btn-ghost ${copiedDigest ? "is-copied" : ""}`}
              onClick={handleCopyDigest}
              disabled={!snapshot?.digestMarkdown}
              title="Copy Markdown summary digest for AWG lab chat"
            >
              {copiedDigest ? <Check size={14} /> : <Copy size={14} />}
              <span>{copiedDigest ? "Copied Digest" : "Copy Digest"}</span>
            </button>
            <button
              type="button"
              className="modal-close-btn rr-close-btn"
              onClick={onClose}
              aria-label="Close Release Radar"
              title="Close (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Optional Sync / Error Banner */}
        {syncNotice && (
          <div className={`rr-banner tone-${syncNotice.tone}`}>
            <span>{syncNotice.text}</span>
            <button
              type="button"
              className="rr-banner-dismiss"
              onClick={() => setSyncNotice(null)}
              aria-label="Dismiss notice"
            >
              ×
            </button>
          </div>
        )}
        {errorMsg && (
          <div className="rr-banner tone-warn">
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Primary Dual-Tab Strip + Scope Audit Badge */}
        <div className="rr-tabs-bar">
          <div className="rr-tabs-group" role="tablist" aria-label="Release Radar Views">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "releases"}
              className={`rr-tab-btn ${activeTab === "releases" ? "active" : ""}`}
              onClick={() => setActiveTab("releases")}
              data-testid="rr-tab-releases"
            >
              <Database size={14} />
              <span>OSDR Quarterly &amp; Monthly</span>
              <span className="rr-count-badge">{releases.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "leads"}
              className={`rr-tab-btn ${activeTab === "leads" ? "active" : ""}`}
              onClick={() => setActiveTab("leads")}
              data-testid="rr-tab-leads"
            >
              <Users size={14} />
              <span>AWG Leads &amp; Pre-OSDR Watch</span>
              <span className="rr-count-badge">{leadSignals.length}</span>
            </button>
          </div>

          {snapshot?.scopeAudit && (
            <div
              className="rr-scope-pill"
              title={snapshot.scopeAudit.filterDescription}
            >
              <ShieldCheck size={14} />
              <span>
                Space-Bio Scoped · <strong>{snapshot.scopeAudit.inScopeCount}</strong> kept /{" "}
                <strong>{snapshot.scopeAudit.filteredOutNonSpaceCount}</strong> off-topic excluded
              </span>
            </div>
          )}
        </div>

        {/* Calm Filter Bar: Row 1 Time Window + Search */}
        <div className="rr-filters-area">
          <div className="rr-filter-row">
            <div className="rr-window-pills" role="group" aria-label="Time Window">
              {[
                { id: "all", label: "All 2024–2026" },
                { id: "month", label: snapshot?.currentMonthLabel || "Last 30 Days" },
                { id: "current_quarter", label: snapshot?.currentQuarterLabel || "2026-Q4" },
                { id: "prev_quarter", label: snapshot?.previousQuarterLabel || "2026-Q3" },
                { id: "recent_quarters", label: "Q3–Q4 Combined" },
              ].map((win) => (
                <button
                  key={win.id}
                  type="button"
                  className={`rr-filter-pill ${windowFilter === win.id ? "active" : ""}`}
                  onClick={() => setWindowFilter(win.id)}
                  data-testid={`rr-win-${win.id}`}
                >
                  <span>{win.label}</span>
                  <span className="rr-pill-num">{windowCounts[win.id] ?? 0}</span>
                </button>
              ))}
            </div>

            <div className="rr-search-wrap">
              <Search size={14} className="rr-search-icon" />
              <input
                type="search"
                className="rr-search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  activeTab === "releases"
                    ? "Filter OSD-ID, tissue, organism, assay…"
                    : "Filter lead paper, bioRxiv preprint, DOI, OSD-*…"
                }
                aria-label="Filter Release Radar items"
              />
            </div>
          </div>

          {/* Row 2: Tab-Specific Secondary Chips */}
          {activeTab === "releases" ? (
            <div className="rr-filter-row rr-subfilters-row">
              <div className="rr-chip-strip">
                {subgroupChips.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    className={`rr-subchip ${subgroupFilter === chip.id ? "active" : ""} ${
                      chip.highlight ? "is-sans-chip" : ""
                    }`}
                    onClick={() => setSubgroupFilter(chip.id)}
                    data-testid={`rr-subgroup-${chip.id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  >
                    <span>{chip.label}</span>
                    <span className="rr-pill-num">{chip.count}</span>
                  </button>
                ))}
              </div>
              <div className="rr-kpi-inline">
                <span>
                  <strong className="rr-kpi-accent">{sansTotalCount}</strong> SANS / Ocular
                </span>
                <span className="rr-kpi-sep">·</span>
                <span>
                  <strong>{releases.filter((r) => r.isRecentMonth || r.windowBucket === "month").length}</strong> in Last 30d
                </span>
              </div>
            </div>
          ) : (
            <div className="rr-filter-row rr-subfilters-row">
              <div className="rr-chip-strip">
                <button
                  type="button"
                  className={`rr-subchip ${leadFilter === "all" ? "active" : ""}`}
                  onClick={() => setLeadFilter("all")}
                  data-testid="rr-lead-all"
                >
                  <span>All {leadsMeta.length} Leads</span>
                  <span className="rr-pill-num">{leadSignals.length}</span>
                </button>
                {leadsMeta.map((lead) => {
                  const countInWin = leadSignalsByLeadCount[lead.id] || 0;
                  return (
                    <button
                      key={lead.id}
                      type="button"
                      className={`rr-subchip ${leadFilter === lead.id ? "active" : ""} ${
                        lead.spotlight ? "is-spotlight-chip" : ""
                      }`}
                      onClick={() => setLeadFilter(lead.id)}
                      title={`${lead.name} — ${lead.role}`}
                      data-testid={`rr-lead-${lead.id}`}
                    >
                      {lead.spotlight && <Star size={11} className="rr-star-icon" />}
                      <span>{lead.name}</span>
                      <span className="rr-pill-num">{countInWin}</span>
                    </button>
                  );
                })}
              </div>

              <div className="rr-status-segment">
                {[
                  { id: "all", label: "All", count: leadStatusCounts.all },
                  { id: "pre_osdr_signal", label: "Pre-OSDR", count: leadStatusCounts.pre_osdr_signal },
                  { id: "live_on_osdr", label: "Live OSDR", count: leadStatusCounts.live_on_osdr },
                ].map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    className={`rr-seg-btn ${leadStatusFilter === st.id ? "active" : ""}`}
                    onClick={() => setLeadStatusFilter(st.id)}
                    data-testid={`rr-lead-status-${st.id}`}
                  >
                    {st.label} ({st.count})
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Workspace Content: Loading / Master-Detail Split */}
        {loading ? (
          <div className="rr-loading-state">
            <span className="spinner" />
            <span>Loading NASA OSDR Releases &amp; AWG Lead Release Radar…</span>
          </div>
        ) : (
          <div className="rr-split">
            {/* LEFT MASTER COLUMN */}
            <div className="rr-master" role="listbox" aria-label="Radar items">
              {activeTab === "releases" ? (
                filteredReleases.length === 0 ? (
                  <div className="rr-empty-pane">
                    <p>No OSDR releases match this filter combination.</p>
                    <button
                      type="button"
                      className="rr-btn rr-btn-ghost"
                      onClick={() => {
                        setWindowFilter("all");
                        setSubgroupFilter("all");
                        setSearchQuery("");
                      }}
                    >
                      Reset Releases Filters
                    </button>
                  </div>
                ) : (
                  filteredReleases.map((item) => {
                    const isSelected = activeRelease?.studyId === item.studyId;
                    return (
                      <button
                        key={item.studyId}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className={`rr-item-card ${isSelected ? "selected" : ""}`}
                        onClick={() => {
                          setSelectedReleaseId(item.studyId);
                          detailRef.current?.scrollTo?.(0, 0);
                        }}
                        data-testid={`rr-release-item-${item.studyId}`}
                      >
                        <div className="rr-item-top">
                          <div className="rr-item-badges">
                            <span className="rr-osd-id">{item.studyId}</span>
                            <span className={`rr-sub-tag ${item.sansRelevant ? "is-sans" : ""}`}>
                              {item.subgroup}
                            </span>
                            <span className="rr-sys-tag">{item.sourceSystem.toUpperCase()}</span>
                          </div>
                          <span className="rr-date-meta">{item.releaseDate || item.quarterLabel}</span>
                        </div>

                        <div className="rr-item-title">{item.title}</div>

                        <div className="rr-item-foot">
                          <span className="rr-item-org" title={item.organism}>
                            {item.organism}
                          </span>
                          {item.bestAnchor ? (
                            <span
                              className={`rr-anchor-chip ${
                                item.bestAnchor.comparabilityTier === "direct_retinal_sans"
                                  ? "is-direct"
                                  : "is-comparator"
                              }`}
                            >
                              × {item.bestAnchor.studyId} · {item.bestAnchor.totalScore}/100
                            </span>
                          ) : (
                            <span className="rr-nonmammalian-chip">Non-Mammalian</span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )
              ) : filteredLeadSignals.length === 0 ? (
                <div className="rr-empty-pane">
                  <p>
                    No scoped works match this lead / window filter.
                    {windowFilter === "month"
                      ? " Many preprints & papers sit in Q2/Q3 — try All 2024–2026 or Q3–Q4."
                      : ""}
                  </p>
                  <button
                    type="button"
                    className="rr-btn rr-btn-ghost"
                    onClick={() => {
                      setWindowFilter("all");
                      setLeadFilter("all");
                      setLeadStatusFilter("all");
                      setSearchQuery("");
                    }}
                  >
                    Show All {leadSignals.length} Scoped Signals
                  </button>
                </div>
              ) : (
                filteredLeadSignals.map((sig) => {
                  const isSelected = activeLeadSignal?.id === sig.id;
                  const isPre = sig.status === "pre_osdr_signal";
                  return (
                    <button
                      key={sig.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`rr-item-card ${isSelected ? "selected" : ""}`}
                      onClick={() => {
                        setSelectedLeadSignalId(sig.id);
                        detailRef.current?.scrollTo?.(0, 0);
                      }}
                      data-testid={`rr-lead-item-${sig.id}`}
                    >
                      <div className="rr-item-top">
                        <div className="rr-item-badges">
                          <span className={`rr-status-pill ${isPre ? "is-pre" : "is-live-osdr"}`}>
                            {isPre ? "Pre-OSDR Signal" : "Live on OSDR"}
                          </span>
                          {sig.isPreprint && <span className="rr-preprint-tag">Preprint</span>}
                          <span className="rr-lead-sub-tag">{sig.leadSubgroup}</span>
                        </div>
                        <span className="rr-date-meta">{sig.publishedDate}</span>
                      </div>

                      <div className="rr-item-title">{sig.title}</div>

                      <div className="rr-item-foot">
                        <span className="rr-item-org">
                          {sig.leadName} · {sig.journal}
                        </span>
                        {sig.linkedOsdIds?.length > 0 && (
                          <span className="rr-linked-osd">{sig.linkedOsdIds[0]}</span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* RIGHT DETAIL INSPECTOR */}
            <div className="rr-detail" ref={detailRef}>
              {activeTab === "releases" ? (
                activeRelease ? (
                  <div className="rr-detail-inner" data-testid="rr-release-detail">
                    <div className="rr-detail-head">
                      <div className="rr-detail-eyebrow">
                        <span className="rr-osd-id is-lg">{activeRelease.studyId}</span>
                        <span className={`rr-sub-tag ${activeRelease.sansRelevant ? "is-sans" : ""}`}>
                          {activeRelease.subgroup}
                        </span>
                        <span className="rr-sys-tag">
                          {activeRelease.sourceSystem === "alsda" ? "ALSDA Physiological" : "CGENE Omics"}
                        </span>
                        <span className="rr-window-tag">
                          <Clock size={11} />
                          {getWindowBadgeLabel(
                            activeRelease.windowBucket,
                            activeRelease.isRecentMonth,
                            activeRelease.quarterLabel,
                            snapshot
                          )}
                        </span>
                      </div>
                      <a
                        href={activeRelease.osdrUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rr-ext-link"
                      >
                        <span>NASA OSDR</span>
                        <ExternalLink size={12} />
                      </a>
                    </div>

                    <h3 className="rr-detail-title">{activeRelease.title}</h3>

                    {/* Metadata Grid */}
                    <div className="rr-meta-grid">
                      <div className="rr-meta-cell">
                        <span className="rr-meta-label">Organism</span>
                        <span className="rr-meta-value">{activeRelease.organism}</span>
                      </div>
                      <div className="rr-meta-cell">
                        <span className="rr-meta-label">Tissue / Material</span>
                        <span className="rr-meta-value">{activeRelease.materialType}</span>
                      </div>
                      <div className="rr-meta-cell">
                        <span className="rr-meta-label">Assay Measurement</span>
                        <span className="rr-meta-value">{activeRelease.assayMeasurement}</span>
                      </div>
                      <div className="rr-meta-cell">
                        <span className="rr-meta-label">Platform / Mission</span>
                        <span className="rr-meta-value">
                          {activeRelease.assayPlatform}
                          {activeRelease.mission ? ` · ${activeRelease.mission}` : ""}
                        </span>
                      </div>
                      <div className="rr-meta-cell">
                        <span className="rr-meta-label">Experimental Factor</span>
                        <span className="rr-meta-value">{activeRelease.studyFactor}</span>
                      </div>
                      <div className="rr-meta-cell">
                        <span className="rr-meta-label">Public Release Date</span>
                        <span className="rr-meta-value rr-mono">
                          {activeRelease.releaseDate || activeRelease.quarterLabel}
                        </span>
                      </div>
                    </div>

                    {/* Retinal Digital Twin Anchor Compatibility / Scope */}
                    {activeRelease.bestAnchor ? (() => {
                      const cleanAxis = String(activeRelease.bestAnchor.commonScientificAxis || "").replace(/\s{2,}/g, " · ").trim();
                      const rawWhy = String(activeRelease.bestAnchor.whyChosen || "").replace(/\s{2,}/g, " · ").trim();
                      const scoreNoteMatch = rawWhy.match(/\(\d+\/100[^)]*\)$/);
                      const cleanWhy =
                        rawWhy.toLowerCase().startsWith(cleanAxis.toLowerCase())
                          ? `Readiness: ${activeRelease.bestAnchor.comparisonReadiness}${scoreNoteMatch ? ` ${scoreNoteMatch[0]}` : ""}.`
                          : rawWhy;
                      return (
                        <div
                          className={`rr-anchor-box ${
                            activeRelease.bestAnchor.comparabilityTier === "direct_retinal_sans"
                              ? "is-direct"
                              : "is-comparator"
                          }`}
                        >
                          <div className="rr-anchor-top">
                            <div className="rr-anchor-title-row">
                              <FlaskConical size={14} />
                              <strong>{activeRelease.bestAnchor.comparabilityLabel}</strong>
                            </div>
                            <span className="rr-score-badge">
                              {activeRelease.bestAnchor.studyId} · {activeRelease.bestAnchor.totalScore}/100
                            </span>
                          </div>
                          {cleanAxis && <p className="rr-anchor-axis">{cleanAxis}</p>}
                          {cleanWhy && <p className="rr-anchor-why">{cleanWhy}</p>}
                        </div>
                      );
                    })() : (
                      <div className="rr-anchor-box is-nonmammalian">
                        <div className="rr-anchor-title-row">
                          <ShieldCheck size={14} />
                          <strong>Non-Mammalian Release — Retinal SANS Scoring Omitted</strong>
                        </div>
                        <p className="rr-anchor-why">
                          Plant and microbial OSDR depositions are tracked cleanly for AWG currency and intentionally excluded from the mammalian retinal SANS digital-twin compatibility score.
                        </p>
                      </div>
                    )}

                    {/* Fresh Ideas & Actionable Workflows: Use Now vs Roadmap */}
                    <div className="rr-concepts-split">
                      <div className="rr-concepts-col is-use-now">
                        <div className="rr-concepts-heading">
                          <Sparkles size={13} />
                          <span>Use Now in ChatBot</span>
                        </div>
                        {activeRelease.concepts
                          .filter((c) => c.kind === "use_now")
                          .map((c, idx) => (
                            <div key={idx} className="rr-concept-card">
                              <div className="rr-concept-title">{c.title}</div>
                              <p className="rr-concept-detail">{c.detail}</p>
                              <button
                                type="button"
                                className="rr-run-btn"
                                onClick={() => handleRunInChat(c)}
                              >
                                <span>{c.command ? c.command : "Ask Assistant"}</span>
                                <ArrowRight size={13} />
                              </button>
                            </div>
                          ))}
                      </div>

                      <div className="rr-concepts-col is-roadmap">
                        <div className="rr-concepts-heading">
                          <GitBranch size={13} />
                          <span>[ROADMAP] Integration Concepts</span>
                        </div>
                        {activeRelease.concepts
                          .filter((c) => c.kind === "roadmap")
                          .map((c, idx) => (
                            <div key={idx} className="rr-concept-card">
                              <div className="rr-concept-title">{c.title}</div>
                              <p className="rr-concept-detail">{c.detail}</p>
                              {c.extensionTarget && (
                                <span className="rr-target-pill">{c.extensionTarget}</span>
                              )}
                            </div>
                          ))}
                      </div>
                    </div>

                    {activeRelease.studyRecord?.description && (
                      <details className="rr-desc-details">
                        <summary>Repository Study Abstract &amp; Scope</summary>
                        <p>{activeRelease.studyRecord.description}</p>
                      </details>
                    )}
                  </div>
                ) : (
                  <div className="rr-detail-empty">
                    Select an OSDR release on the left to inspect metadata, anchor alignment, and actionable ChatBot hooks.
                  </div>
                )
              ) : activeLeadSignal ? (
                <div className="rr-detail-inner" data-testid="rr-lead-detail">
                  <div className="rr-detail-head">
                    <div className="rr-detail-eyebrow">
                      <span
                        className={`rr-status-pill ${
                          activeLeadSignal.status === "pre_osdr_signal"
                            ? "is-pre"
                            : "is-live-osdr"
                        }`}
                      >
                        {activeLeadSignal.status === "pre_osdr_signal"
                          ? "Pre-OSDR Early Signal"
                          : "Live on NASA OSDR"}
                      </span>
                      {activeLeadSignal.isPreprint && (
                        <span className="rr-preprint-tag">Preprint Before OSDR Curation</span>
                      )}
                      <span className="rr-window-tag">
                        <Clock size={11} />
                        {activeLeadSignal.publishedDate} ({activeLeadSignal.quarterLabel})
                      </span>
                    </div>
                    <div className="rr-head-links">
                      <a
                        href={`https://orcid.org/${activeLeadSignal.leadOrcid}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rr-ext-link subtle"
                      >
                        <span>ORCID</span>
                        <ExternalLink size={11} />
                      </a>
                      <a
                        href={activeLeadSignal.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rr-ext-link"
                      >
                        <span>Open Source</span>
                        <ExternalLink size={12} />
                      </a>
                    </div>
                  </div>

                  {/* Lead Profile Banner */}
                  <div className="rr-lead-banner">
                    <div>
                      <strong>{activeLeadSignal.leadName}</strong>
                      <span className="rr-lead-role"> · {activeLeadSignal.leadRole}</span>
                    </div>
                    <span className="rr-lead-source">{activeLeadSignal.sourcePlatform}</span>
                  </div>

                  <h3 className="rr-detail-title">{activeLeadSignal.title}</h3>

                  <div className="rr-venue-row">
                    <span className="rr-venue-name">{activeLeadSignal.journal}</span>
                    {activeLeadSignal.doi && (
                      <span className="rr-mono-pill">DOI: {activeLeadSignal.doi}</span>
                    )}
                    {activeLeadSignal.pmid && (
                      <span className="rr-mono-pill">PMID: {activeLeadSignal.pmid}</span>
                    )}
                  </div>

                  {activeLeadSignal.summarySnippet && (
                    <div className="rr-abstract-box">
                      <div className="rr-meta-label">Abstract / Metadata Summary</div>
                      <p>{activeLeadSignal.summarySnippet}</p>
                    </div>
                  )}

                  {/* Linked OSDR / External Accessions + Domain Guardrail Verification */}
                  <div className="rr-audit-strip">
                    <div className="rr-audit-row">
                      <span className="rr-audit-label">Scope Guardrail Match:</span>
                      <div className="rr-tag-row">
                        {activeLeadSignal.scopeMatchedBy?.map((term) => (
                          <span key={term} className="rr-scope-tag">
                            {term}
                          </span>
                        ))}
                      </div>
                    </div>

                    {cleanStudyIdList(activeLeadSignal.linkedOsdIds).length > 0 && (
                      <div className="rr-audit-row">
                        <span className="rr-audit-label">Linked OSDR Datasets:</span>
                        <div className="rr-tag-row">
                          {activeLeadSignal.linkedOsdIds.map((oid) => (
                            <button
                              key={oid}
                              type="button"
                              className="rr-osd-link-btn"
                              onClick={() =>
                                onRunPrompt?.(
                                  `/awg compare ${oid} ${oid === "OSD-255" ? "OSD-583" : "OSD-255"}`
                                )
                              }
                            >
                              {oid} · Compare in Chat ➔
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {cleanStudyIdList(activeLeadSignal.externalAccessions).length > 0 && (
                      <div className="rr-audit-row">
                        <span className="rr-audit-label">External Pre-OSDR Accessions:</span>
                        <div className="rr-tag-row">
                          {activeLeadSignal.externalAccessions.map((ext) => (
                            <span key={ext} className="rr-mono-pill">
                              {ext}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Use Now vs Roadmap Concepts */}
                  <div className="rr-concepts-split">
                    <div className="rr-concepts-col is-use-now">
                      <div className="rr-concepts-heading">
                        <Sparkles size={13} />
                        <span>Use Now in ChatBot</span>
                      </div>
                      {activeLeadSignal.concepts
                        .filter((c) => c.kind === "use_now")
                        .map((c, idx) => (
                          <div key={idx} className="rr-concept-card">
                            <div className="rr-concept-title">{c.title}</div>
                            <p className="rr-concept-detail">{c.detail}</p>
                            <button
                              type="button"
                              className="rr-run-btn"
                              onClick={() => handleRunInChat(c)}
                            >
                              <span>{c.command ? c.command : "Bridge Topic in Chat"}</span>
                              <ArrowRight size={13} />
                            </button>
                          </div>
                        ))}
                    </div>

                    <div className="rr-concepts-col is-roadmap">
                      <div className="rr-concepts-heading">
                        <GitBranch size={13} />
                        <span>[ROADMAP] Adapter Concepts</span>
                      </div>
                      {activeLeadSignal.concepts
                        .filter((c) => c.kind === "roadmap")
                        .map((c, idx) => (
                          <div key={idx} className="rr-concept-card">
                            <div className="rr-concept-title">{c.title}</div>
                            <p className="rr-concept-detail">{c.detail}</p>
                            {c.extensionTarget && (
                              <span className="rr-target-pill">{c.extensionTarget}</span>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rr-detail-empty">
                  {selectedLeadProfile ? (
                    <>
                      <strong>{selectedLeadProfile.name}</strong> ({selectedLeadProfile.subgroup}) has{" "}
                      {selectedLeadProfile.filteredOutNonSpaceCount} non-space works filtered out and{" "}
                      {selectedLeadProfile.inScopeCount} in-scope signals across 2024–2026. Switch to{" "}
                      <em>All 2024–2026</em> to inspect all retained works.
                    </>
                  ) : (
                    "Select an AWG lead signal on the left to inspect provenance, Pre-OSDR status, and integration ideas."
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Calm Footer Provenance Line */}
        <div className="rr-footer">
          <span className="rr-footer-source">
            {snapshot?.sourceStatus?.googleScholarNote ||
              "Sources: NASA OSDR REST API · ORCID Public API · OpenAlex Verified-ORCID Works · Europe PMC"}
          </span>
          <span className="rr-footer-stats">
            {leadsMeta.length} AWG Leads · {preOsdrTotalCount} Pre-OSDR · {liveOsdrLeadCount} Live OSDR Links
          </span>
        </div>
      </div>
    </div>
  );
}
