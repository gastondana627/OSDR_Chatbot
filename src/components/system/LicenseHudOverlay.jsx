import { useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, Scale, ShieldCheck, Terminal, X } from "lucide-react";

const REPO_URL = "https://github.com/gastondana627/OSDR_Chatbot";
const ORCID_URL = "https://orcid.org/0009-0007-1011-860X";
const SCHOLAR_URL = "https://scholar.google.com/citations?user=juOv0f0AAAAJ&hl=en";

export default function LicenseHudOverlay() {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const containerRef = useRef(null);

  const isOpen = hovered || focused || pinned;

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setPinned(false);
        setHovered(false);
        setFocused(false);
      }
    }

    function handleKeyDown(e) {
      if (e.key === "Escape") {
        setPinned(false);
        setHovered(false);
        setFocused(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function handleDismiss(e) {
    e.stopPropagation();
    setPinned(false);
    setHovered(false);
    setFocused(false);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  return (
    <aside
      ref={containerRef}
      className={`hud-license-overlay${isOpen ? " is-open" : ""}${pinned ? " is-pinned" : ""}`}
      aria-label="Software license and open-source provenance"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setFocused(false);
        }
      }}
    >
      {isOpen && (
        <div
          id="hud-license-popover"
          className="hud-license-popover-wrap"
          role="region"
          aria-label="MIT License and open-source details"
        >
          <div className="hud-license-card">
            <div className="hud-license-card-head">
              <div className="hud-license-badge-group">
                <span className="hud-license-osi-pill">
                  <ShieldCheck size={12} />
                  <span>OSI Approved</span>
                </span>
                <span className="hud-license-title">MIT License · v0.1.0</span>
              </div>
              {pinned && (
                <button
                  type="button"
                  className="hud-license-close-btn"
                  onClick={handleDismiss}
                  title="Close license panel"
                  aria-label="Close license details"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <p className="hud-license-copyright">
              Copyright &copy; 2026 Gaston Dana and OSDR_Chatbot contributors
            </p>

            <p className="hud-license-summary">
              Permissive open-source release (<code>private: false</code>). Free to inspect,
              fork, modify, and integrate into NASA OSDR &amp; AWG bioinformatics workflows as
              long as the MIT copyright and permission notice are preserved.
            </p>

            <div className="hud-license-meta-grid">
              <div className="hud-license-meta-cell">
                <span className="hud-license-meta-label">Lead Author ORCID</span>
                <a
                  href={ORCID_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hud-license-meta-link"
                  data-testid="hud-orcid-link"
                >
                  <span>0009-0007-1011-860X</span>
                  <ExternalLink size={10} />
                </a>
              </div>
              <div className="hud-license-meta-cell">
                <span className="hud-license-meta-label">Google Scholar</span>
                <a
                  href={SCHOLAR_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hud-license-meta-link"
                  data-testid="hud-scholar-link"
                >
                  <span>Gaston Dana · Profile</span>
                  <ExternalLink size={10} />
                </a>
              </div>
              <div className="hud-license-meta-cell">
                <span className="hud-license-meta-label">JOSS Paper Draft</span>
                <a
                  href={`${REPO_URL}/blob/main/paper/paper.md`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hud-license-meta-link"
                >
                  <span>paper/paper.md</span>
                  <ExternalLink size={10} />
                </a>
              </div>
              <div className="hud-license-meta-cell">
                <span className="hud-license-meta-label">Zero-Key Verify</span>
                <span className="hud-license-meta-code">
                  <Terminal size={10} />
                  <span>npm run lint &amp;&amp; npm test</span>
                </span>
              </div>
              <div className="hud-license-meta-cell is-full">
                <span className="hud-license-meta-label">Scope Notice</span>
                <span className="hud-license-meta-muted">
                  Independent open-source software · Not affiliated with or endorsed by NASA.
                </span>
              </div>
            </div>

            <div className="hud-license-actions">
              <a
                href={`${REPO_URL}/blob/main/LICENSE`}
                target="_blank"
                rel="noopener noreferrer"
                className="hud-license-action-link primary"
              >
                <FileText size={11} />
                <span>Full MIT LICENSE</span>
                <ExternalLink size={10} />
              </a>
              <a
                href={`${REPO_URL}/blob/main/CONTRIBUTING.md`}
                target="_blank"
                rel="noopener noreferrer"
                className="hud-license-action-link"
              >
                <span>CONTRIBUTING</span>
                <ExternalLink size={10} />
              </a>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="hud-license-action-link"
              >
                <span>GitHub Repo</span>
                <ExternalLink size={10} />
              </a>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        className="hud-license-pill"
        data-testid="hud-license-trigger"
        aria-expanded={isOpen}
        aria-controls="hud-license-popover"
        onClick={() => setPinned((prev) => !prev)}
        title="MIT Open-Source License — hover or click for copyright, ORCID & verification terms"
      >
        <Scale size={12} className="hud-license-pill-icon" />
        <span className="hud-license-pill-name">MIT License</span>
        <span className="hud-license-pill-divider" aria-hidden="true">·</span>
        <span className="hud-license-pill-sub">Open Source v0.1.0</span>
      </button>
    </aside>
  );
}

