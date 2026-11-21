# Changelog

All notable releases of **NASA OSDR ChatBot & AWG Evidence Engine** are documented here.

## [1.0.0] - 2026-11-21

### Highlights
- **Live Free Multi-Model Inference Cascade (`$0.00/mo`):** Automatic failover across Groq LPU (`openai/gpt-oss-120b`, sub-second responses), OpenRouter Free Auto-Router (`openrouter/free` + live `:free` models), Google Gemini, and deterministic offline OSDR RAG, with empty-stream callback protection and a curated chat-only model dropdown.
- **Optional Firebase Auth & 3-Step AWG Researcher Profile (`/account`):** Email/Password and Google Sign-In wired via pure Node `crypto` RS256 verification (Vercel Node 20 safe). Includes an optional first-login walkthrough to check off NASA OSDR AWG subgroups (9 tracks), customize avatar/ORCID/model preferences, highlight `★ Your AWG` presets on the launchpad, display sidebar subgroup chips, auto-fill `/contributors`, and export/import/delete local per-UID profile JSON.
- **1-Click Study Discovery, Rich Safe Markdown & Zero-Key Voice Readout:** All Study Discovery and AWG Research Preset buttons run immediately on click, render pure-React XSS-safe Markdown (headings, tables, code, clickable `OSD-*` links), provide 1-click **Copy** and provider badges, and speak responses aloud via automatic Browser Web Speech (`window.speechSynthesis`) fallback with zero API keys needed.
- **OSDR & AWG 8-Hour Scholar Pulse & Release Radar:** Compact 42px institutional home ticker expanding into a 6-card source-filtered drawer across all verified AWG chairs and OSDR science leadership (with an internal Ryan T. Scott spotlight filter) spanning ORCID, NASA NTRS, OpenAlex, Crossref, PubMed, and Europe PMC, plus an automated 8-hour sync workflow and HMAC-SHA256 webhooks.
- **Contributor Hub (`/contributors`):** Showcases `RetinaCellTwin` and `SpaceSleepTwin` alongside aligned Schema Contract exports and a zero-backend intake generator (`contributor_manifest.json`, GitHub PR block, AWG forum snippet).
- **Admin Operations & Automated Key Alerts (`/admin`):** Dedicated admin console with `$0.00` current build billing schematics, 3-phase scaling proposals, and automated API key rejection email/webhook reminders (`server/alertNotifier.ts` + 12-hour GitHub Actions provider watch).
- **JOSS Manuscript Automation:** Updated `paper/paper.md` + `paper/paper.bib`, added `CONTRIBUTING.md`, and enabled automatic 2-page PDF compilation via `openjournals/inara` (`.github/workflows/joss-paper.yml`).
- **Automated Verification:** 19 test suites covering scientific metadata integrity, accession validation, multi-omics media gating, Release Radar & webhooks, Firebase Auth & Admin security, researcher profiles, alert delivery, and provider-agnostic TTS.
