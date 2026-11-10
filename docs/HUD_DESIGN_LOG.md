# OSDR ChatBot — Pre-v1.0 HUD Design Log & Flow Remix Inventory

> **Branch Scope:** `design/hud-v1` (isolated creative HUD & tooling iteration branch; `main` remains frozen at commit `5ac13ac` until collaborator feedback closes).  
> **Non-Affiliation Rule:** Every HUD surface, badge, and Flow remix **MUST** preserve the disclaimer *"Independent open-source software · Not affiliated with or endorsed by NASA."* Avoid official NASA meatball/worm insignia or impersonating official `nasa.gov` portals.

---

## 1. Baseline Visual Captures (`docs/media/hud-baseline/`)

Baseline screenshots were captured deterministically (`NODE_ENV=production`, zero external API keys required) on Playwright Chromium before applying HUD restyling or community showcase controls:

| Baseline Image | Viewport | Target UI Zone | Observations for Pre-v1.0 Polish |
| :--- | :--- | :--- | :--- |
| [desktop-home.png](./media/hud-baseline/desktop-home.png) | `1440×960` | Top command header, empty-state dual launch cards, bottom-right License HUD pill, composer bar | Clean contrast; header has 5 compact pills (`OSDR Status`, `Release Radar`, `Computer Use`, `AI Status`, `Model`), plus room for a subtle GeneLab telemetry hairline and `Community & Integrations` trigger. |
| [desktop-license-hover.png](./media/hud-baseline/desktop-license-hover.png) | `1440×960` | `#hud-license-popover` expanded above License pill | Solid opaque backdrop prevents bleed; upgrade metadata grid to display both **ORCID (`0009-0007-1011-860X`)** and **Google Scholar (`juOv0f0AAAAJ`)**, `paper/paper.md`, `Zero-Key Verify`, and untruncated independent-software notice. |
| [desktop-awg-chooser.png](./media/hud-baseline/desktop-awg-chooser.png) | `1440×960` | `/awg` Guided Study Comparison panel | 2-column suggested pair cards work well; consider compact filtering by assay layer (RNA-seq / Spatial / Microscopy / IOP-OCT) and direct preview tags for frozen-panel replication (`OSD-255 × OSD-758`). |
| [desktop-compare-audit.png](./media/hud-baseline/desktop-compare-audit.png) | `1440×960` | 3-Tier Evidence & Provenance Audit (`EvidenceAuditCard.jsx`) + Guardrail strip | Guardrail banner (`SAME_MISSION_DISSECTION_SPLIT`, `P_GT_N_ANIMAL_DISJOINT`, `COHORT_BATCH_CONTROLS`, and new `FROZEN_PANEL_FDR_GUARDRAIL`) + `Copy Schema Contract JSON` button are high-value tooling anchors to lock for v1.0. |
| [desktop-release-radar.png](./media/hud-baseline/desktop-release-radar.png) | `1440×960` | `OSDR Release Radar` dual-tab modal | Split master-detail drawer scales well; good template for `CommunityIntegrationsModal.jsx` and any unified Pre-v1.0 Tooling Rail. |
| [mobile-home.png](./media/hud-baseline/mobile-home.png) | `390×844` | Responsive mobile header + empty state + License HUD pill | Top `.chat-header` wraps onto 4 rows on narrow `390px` viewports and crowds `.empty-hero-icon`; good candidate for collapsible HUD action menu / horizontal scroll pill rail on `<640px`. |

---

## 2. HUD Zones & Flow Remix Targets

Use the baseline PNGs above as direct visual references when generating Flow / Stitch UI remixes:

1. **Zone A — Orbital Top Command Strip (`.chat-header`)**
   - *Current:* Title + `NASA OSDR` tag, 4 telemetry pills (`OSDR`, `Release Radar`, `Computer Use`, `AI`) + model selector + `1M Reasoning` chip.
   - *GeneLab-Inspired HUD Concept:* Deep-space telemetry hairline (`1px` cyan/emerald gradient border), subtle orbital grid tick marks, grouped "Telemetry" vs. "Workspaces" (`Release Radar`, `Community Hub`, `Computer Use`), and responsive compact drawer on `<640px`.
2. **Zone B — Empty-State Mission Launchpad (`.empty` / `.empty-sections`)**
   - *Current:* 2 equal columns (`Study Discovery & Evidence Search` and `AWG Study Comparison (/awg)`).
   - *Remix Options:*
     - *Layout Concept 1 (Compact Mission Dock):* Left quick-action rail for `/awg` workflows + right featured cohort cards (`RR-9`, `MHU-8`, `HLU+LDR`, `RetinaCellTwin`).
     - *Layout Concept 2 (GeneLab Matrix HUD):* Tabular accession matrix (`OSD-255`, `OSD-583`, `OSD-557`, `OSD-568`, `OSD-758`, `OSD-203`) paired with one-click compare / contract actions.
3. **Zone C — Evidence Audit & Guardrail Strip (`EvidenceAuditCard.jsx`)**
   - *Lockable Tooling Candidates for v1.0:*
     - `Copy Schema Contract JSON` (machine-readable animal-disjoint / CC1–CC2 / frozen-panel FDR rules)
     - `Inspect Guardrails` (`ZERO_SHARED_ANIMALS`, `P_GT_N_ANIMAL_DISJOINT`, `FROZEN_PANEL_FDR_GUARDRAIL`)
     - `4-Panel AWG Media Gallery` & `Motion Explainer`
     - `Community & Downstream Handoff` (send or compare against external prototypes like `RetinaCellTwin`)
4. **Zone D — Corner Provenance & License HUD (`LicenseHudOverlay.jsx`)**
   - *Permanent Guardrail Anchor:* Displays `MIT License · Open Source v0.1.0`, OSI status, Gaston Dana's **ORCID** (`0009-0007-1011-860X`) + **Google Scholar**, JOSS paper draft, zero-key reproduction command, and explicit non-NASA-affiliation notice.

---

## 3. Concept & Integration Captures (`docs/media/hud-concepts/`)

Verified on `design/hud-v1` (`NODE_ENV=production`, zero external API keys required, Playwright Chromium `1440×960` + `390×844`):

| Concept Image | Viewport | Highlighted Changes |
| :--- | :--- | :--- |
| [desktop-license-scholar.png](./media/hud-concepts/desktop-license-scholar.png) | `1440×960` | Upgraded `#hud-license-popover` with **ORCID (`0009-0007-1011-860X`)**, **Google Scholar (`juOv0f0AAAAJ`)**, `paper/paper.md`, `Zero-Key Verify`, and full-width non-NASA Scope Notice. |
| [desktop-integrations-retinacelltwin.png](./media/hud-concepts/desktop-integrations-retinacelltwin.png) | `1440×960` | `Community & Downstream Integrations` drawer (`Integrations` pill) featuring **Lissandra (`fuganti`)**'s independent [RetinaCellTwin](https://retina-cell-twin-osdr.fuganti.chatgpt.site/) prototype without modifying core ingest contracts. |
| [desktop-integrations-contracts.png](./media/hud-concepts/desktop-integrations-contracts.png) | `1440×960` | Scrolled Schema Contract Handshakes view (`OSD-255 × OSD-758`, `OSD-255 × OSD-203`, `OSD-557 × OSD-568`), `FROZEN DISCOVERY PANEL POLICY`, copyable JSON preview, and direct `/awg compare` launcher. |
| [desktop-compare-osd255-osd758.png](./media/hud-concepts/desktop-compare-osd255-osd758.png) | `1440×960` | Live `/awg compare OSD-255 OSD-758` audit (`94/100`) surfacing `ZERO_SHARED_ANIMALS`, `P_GT_N_ANIMAL_DISJOINT`, `COHORT_BATCH_CONTROLS`, and `FROZEN_PANEL_FDR_GUARDRAIL` + `FROZEN PANEL CONTRACT` strip. |

---

## 4. Iteration Checklist (Before Opening v1.0 Tag on `main`)

- [x] Capture initial HUD & integration concept screenshots into `docs/media/hud-concepts/` (kept outside the Science Research Questions doc except for 1 feedback link/compact bottom appendix).
- [x] Promote Community & Downstream Integrations into the permanent `/contributors` **Contributor Hub & Ingestion Intake Portal** (`src/components/community/ContributorHub.jsx` & `src/components/community/ContributionSubmissionForm.jsx`) featuring **Lissandra Kruse Fuganti (`fuganti`)**'s [RetinaCellTwin](https://retina-cell-twin-osdr.fuganti.chatgpt.site/) and zero-backend `contributor_manifest.json` intake generation.
- [ ] Add Flow remix mockups (e.g., GeneLab-inspired telemetry header / Compact Mission Dock vs. Matrix HUD) to `docs/media/hud-concepts/`.
- [ ] Collect AWG collaborator votes on:
  1. Preferred HUD layout (`Layout Concept 1` vs `2` vs baseline).
  2. Export / tooling buttons to lock permanently for `v1.0`.
- [ ] Merge only approved, tested changes back to `main` after `npm run lint`, zero-key `npm test`, `npm run build`, and desktop+mobile Playwright verification.

