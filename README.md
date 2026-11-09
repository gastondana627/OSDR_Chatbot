# OSDR ChatBot

**An evidence-grounded NASA Open Science Data Repository (OSDR) research assistant for live study discovery, Analysis Working Group (AWG) multi-omics comparisons, scoped study UI inspection, and provenance-audited scientific media.**

[![Live Demo](https://img.shields.io/badge/Live_App-Vercel-0ea5e9?style=flat-square)](https://osdr-chatbot-kappa.vercel.app/)
[![Frontend](https://img.shields.io/badge/Frontend-React_18_+_Vite-61dafb?style=flat-square)](#repository-structure)
[![Backend](https://img.shields.io/badge/Backend-Express_4_+_TypeScript-3178c6?style=flat-square)](#api-reference)
[![Data Source](https://img.shields.io/badge/Data-NASA_OSDR_REST_API-0b3d91?style=flat-square)](#data--provenance)

---



https://github.com/user-attachments/assets/7ae5a0a6-df28-48e2-8140-9e4a7a867cd1









---

## Feature Walkthrough Video

<video src="docs/media/osdr-chatbot-demo.mp4" poster="docs/media/osdr-chatbot-poster.png" controls muted playsinline width="100%"></video>

> **Full HD Walkthrough (`3m 43s` · `1280×800`):** [**Watch / Download `docs/media/osdr-chatbot-demo.mp4`**](docs/media/osdr-chatbot-demo.mp4)

[![OSDR ChatBot Walkthrough Highlight Reel](docs/media/osdr-chatbot-preview.gif)](docs/media/osdr-chatbot-demo.mp4)

### Walkthrough Chapters

| Timestamp | Feature Demonstrated | Key Highlights |
|---|---|---|
| `0:00 – 0:27` | **Grounded OSDR Q&A & Live REST Diagnostics** | Prompting on `STS-135` mouse retina (`OSD-87`), inspecting clickable `osdr.nasa.gov` chips, and running **Test Live Connection** (`HTTP 200 OK` across 4 data tiers) |
| `0:27 – 1:15` | **AWG Guided Chooser & 3-Tier Evidence Audit** | Running `/awg`, switching `Contextual Studies` ↔ `Broader Repository Search`, comparing `OSD-583 × OSD-557`, and auditing all 4 Evidence Audit tabs + `100/100` Compatibility Breakdown |
| `1:15 – 2:16` | **Visual Gallery, Zoom Modal & 60fps Motion Players** | Comparing `OSD-679` (`OCT/IOP`) × `OSD-680` (`Optic-Nerve MRI`), stepping through 4 downloadable study diagrams, scrubbing the `5s Motion Brief`, and toggling perspectives in `Relatable Translational Clip` |
| `2:16 – 2:36` | **Scoped Gemini Computer Use Study Inspector** | Running the `osdr.nasa.gov`-allowlisted inspector on `OSD-680`, verifying the 4-step domain audit trail and 7 extracted OSDR metadata attributes |
| `2:36 – 3:43` | **AWG Meme Outreach & Session Provenance Registry** | Running `/awg meme OSD-100 OSD-194`, playing the 60fps conceptual preview canvas, reviewing evidence separation, and filtering SHA-256 provenance records in `/awg media audit` |

---

## Core Capabilities

- **Evidence-Grounded Space Biology Chat (`POST /api/chat`)**: Streams SSE responses grounded in NASA OSDR accessions (`OSD-*`) with clickable study citation pills linking directly to `osdr.nasa.gov`. Supports multi-provider resilience across Gemini (`gemini-4-argon`, `gemini-3.7-flash`, `gemini-2.5-flash`), OpenRouter, Groq, and a deterministic offline fallback engine.
- **AWG Guided Chooser & Cross-Study Co-Analysis (`/awg`, `/awg compare`, `/awg random`)**: Ranks compatible study pairs across organism, tissue, assay platform, mission factor, and publication coverage using a transparent **0–100 compatibility rubric**.
- **Strict Accession Validation & 4-Tab Evidence Audit**: Prevents silent substitution of invalid/single/duplicate accessions and classifies outputs cleanly into **Verified Metadata**, DOI-backed **Observed Results**, **Interpretation & Hypotheses** (with explicit `Epistemic Limit` warnings), and **Compatibility Breakdown**.
- **3-Mode Grounded Media Suite**:
  - **4-Panel Visual Gallery**: Infographics, histology/pathway diagrams, narrative context scenes, and comparative study profiles (with SVG/PNG export and full-screen lightbox).
  - **5s Scientific Motion Brief**: 3-scene 60fps HTML5 canvas kinetic explainer with scene scrubbing and snapshot export.
  - **Relatable Translational Clip & Meme Outreach**: Mission-facing analogies with live perspective switching (`OCT Retinal Scan`, `HDT Analog Lab`, `Crew Health`, `Ground vs Flight`) and strict fact-vs-framing boundaries.
- **Media Generation Audit & Provenance Registry (`/awg media audit`)**: Session-wide filterable audit log tracking provider, model tier, generation status (`fresh_provider`, `cache_hit`, `fallback`, `failed`), latency, and SHA-256 prompt fingerprints.
- **Scoped Gemini Computer Use (`POST /api/computer-use`)**: Allowlist-enforced (`osdr.nasa.gov`, `nasa.gov`, `ncbi.nlm.nih.gov`) step-by-step study page inspection with structured metadata extraction.
- **Diagnostics & Text-to-Speech (`GET /api/osdr/diagnostics`, `POST /api/tts`)**: Live NASA OSDR round-trip latency testing plus provider-agnostic spoken audio playback (`Gemini 2.5 Flash TTS` / `OpenAI TTS`).

---

## Scientific Epistemic Boundary

> [!IMPORTANT]
> **OSDR_Chatbot is a research-support and scientific communication tool.** Generated diagrams, motion briefs, translational clips, and synthetic hypotheses are conceptual visualizations built on repository metadata—they are **not** raw sequencing/imaging telemetry, clinical guidance, or validated medical countermeasures.

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                                 BROWSER UI                                  │
│  React 18 + Vite SPA · SSE Chat Stream · Media Gallery & 60fps Players      │
│  4-Tab Evidence Audit · Provenance Registry · Live OSDR Diagnostics         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTP / REST / SSE
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EXPRESS API & VERCEL EDGE                         │
│     server/app.ts · api/index.ts (Serverless Adapter) · Key Isolation       │
└──────────────┬───────────────────────┬──────────────────────┬───────────────┘
               │                       │                      │
               ▼                       ▼                      ▼
┌──────────────────────┐ ┌─────────────────────────┐ ┌────────────────────────┐
│   OSDR DATA & RAG    │ │  AWG SCORING & VALIDATE │ │ MEDIA, TTS & INSPECTOR │
│ • Live OSDR REST API │ │ • Strict Pair Validator │ │ • Nano Banana / Veo    │
│ • Session Snapshot   │ │ • 100-Pt Rubric Engine  │ │ • 60fps Canvas Engines │
│ • Curated Mappings   │ │ • 3-Tier Evidence Map   │ │ • SHA-256 Audit Log    │
│ • Seeded Fallbacks   │ │ • Grounded Meme Engine  │ │ • Scoped Computer Use  │
└──────────────────────┘ └─────────────────────────┘ └────────────────────────┘
```

---

## Repository Structure

```text
OSDR_Chatbot/
├── api/                         # Vercel serverless adapter & bundled handler
│   ├── index.ts                 # Serverless request entry & degraded-mode guard
│   └── serverless.js            # Esbuild ESM output consumed by vercel.json
├── docs/                        # Reference documentation & walkthrough media
│   ├── media/
│   │   ├── osdr-chatbot-demo.mp4
│   │   ├── osdr-chatbot-preview.gif
│   │   └── osdr-chatbot-poster.png
│   ├── AWG_COMMANDS.md          # Complete /awg command & evidence-tier guide
│   └── GEMINI_CAPABILITIES.md   # Model registry, routing & quota guardrails
├── server/                      # Backend domain services (Express + TypeScript)
│   ├── app.ts                   # REST & SSE API router
│   ├── accessionValidator.ts    # Strict accession parsing & anti-substitution rules
│   ├── awg.ts                   # AWG command parser, compatibility scorer & evidence map
│   ├── computerUse.ts           # Domain-allowlisted OSDR DOM/schema inspector
│   ├── env.ts                   # Server-only secret/environment isolation
│   ├── gemini.ts                # Streaming Gemini chat & system instruction synthesis
│   ├── mediaGen.ts              # Image/video generation, Veo circuit breaker & audit log
│   ├── memeGen.ts               # Metadata-grounded scientific outreach generator
│   ├── memeMarkdown.ts          # Safe Markdown serialization for outreach cards
│   ├── modelCapabilities.ts     # Centralized Gemini 4 Argon / Nano Banana / Veo router
│   ├── modelDiscovery.ts        # Live model discovery & error classification
│   ├── osdrClient.ts            # Live NASA OSDR API client & 4-tier provenance tracker
│   ├── rag.ts                   # Hybrid retrieval & OSDR prompt context assembly
│   ├── studiesData.ts           # Indexed space-biology dataset metadata
│   ├── studyManifests.ts        # Curated DOIs, observed outcomes & epistemic cautions
│   ├── textProviders.ts         # Multi-provider LLM cascade (Gemini -> OpenRouter -> Groq)
│   └── tts.ts                   # Provider-agnostic TTS WAV synthesis
├── src/                         # Frontend SPA (React 18 + Vite)
│   ├── components/
│   │   ├── audit/               # AccessionValidationCard, EvidenceAuditCard, MediaAuditCard, MediaProvenanceBadge
│   │   ├── awg/                 # AwgGuidedChooser, AwgMediaGallery, AwgMemeCard, RelatableClipPlayer, StudyBriefVideoPlayer, VisualAbstractCard
│   │   ├── chat/                # Message, Sidebar, TtsPlayButton
│   │   └── system/              # ComputerUsePanel, ErrorBoundary, OsdrDiagnosticsModal
│   ├── hooks/
│   │   └── useConversations.js  # Local conversation state persistence
│   ├── App.jsx                  # Application layout, streaming orchestrator & header controls
│   ├── api.js                   # Typed frontend fetch/SSE helpers
│   ├── main.jsx                 # React root & ErrorBoundary mount
│   └── styles.css               # Unified dark scientific theme stylesheet
├── tests/                       # Automated verification suite (11 test modules via tsx)
├── server.ts                    # Local Node/Vite development & production entry point
├── package.json                 # Build, dev, lint/typecheck, and test scripts
├── tsconfig.json                # TypeScript compiler config (src, server, tests)
├── vite.config.ts               # Vite frontend bundler configuration
└── vercel.json                  # Vercel SPA & /api/(.*) serverless rewrites
```

---

## AWG Commands & Data Provenance

See [`docs/AWG_COMMANDS.md`](docs/AWG_COMMANDS.md) for detailed workflows and [`docs/GEMINI_CAPABILITIES.md`](docs/GEMINI_CAPABILITIES.md) for capability routing and rate-limit policies.

| Command | Purpose | Example |
|---|---|---|
| `/awg` | Launch interactive Guided Study Chooser & repository search | `/awg` |
| `/awg compare <A> <B>` | Dual-accession evidence audit, compatibility breakdown & visual media | `/awg compare OSD-679 OSD-680` |
| `/awg random` | Roll a verified high-compatibility pair | `/awg random` |
| `/awg meme <A> <B>` | Generate outreach clip with conceptual vs. empirical boundary | `/awg meme OSD-100 OSD-194` |
| `/awg media audit` | Inspect all session media outputs & SHA-256 provenance records | `/awg media audit` |
| `/awg help` | View command help & epistemic rules in chat | `/awg help` |

### 4-Tier Data Resolution Hierarchy

1. **`live_api`** — Real-time HTTP queries against `osdr.nasa.gov/osdr/data/search`, `/osd/meta`, and `/osd/files`.
2. **`cached_snapshot`** — Session-cached accession records fetched dynamically during runtime.
3. **`local_curated_mapping`** — Verified space biology metadata & multi-omics assay cross-references.
4. **`static_seeded_examples`** — Resilient offline benchmark cohorts (`OSD-583`, `OSD-557`, `OSD-679`, `OSD-680`, `OSD-681`, `OSD-100`, `OSD-194`, `OSD-87`).

---

## Setup & Development

### Prerequisites

- **Node.js** `>= 18`
- **npm** `>= 9`

### Environment Variables

Create a `.env` file from [`.env.example`](.env.example). All keys remain isolated on the backend Node.js runtime and are never bundled into client JavaScript.

| Variable | Required? | Description |
|---|---|---|
| `GEMINI_API_KEY` | Recommended | Enables Gemini chat streaming, image/video capability discovery, Computer Use & Gemini TTS |
| `GEMINI_TEXT_MODEL` | Optional | Default chat model (`gemini-4-argon`, `gemini-3.7-flash`, or `gemini-2.5-flash`) |
| `OPENROUTER_API_KEY` | Optional | Automatic fallback text provider when Gemini is rate-limited (`429`) or unavailable |
| `GROQ_API_KEY` | Optional | Tertiary fallback text provider in the cascade |
| `OPENAI_API_KEY` | Optional | Alternate TTS backend (`tts-1` / `alloy`) for response audio playback |

### Install, Run & Verify

```bash
# Install dependencies
npm install

# Start development server (Express API + Vite HMR on http://localhost:3000)
npm run dev

# Typecheck TypeScript (src, server, tests)
npm run lint

# Build production SPA + Express server + Vercel serverless bundle
npm run build

# Run full automated test suite (11 integration & unit test files)
npm test

# Start built production server
npm run start
```

---

## API Reference

All endpoints are served under `/api/*` via `server/app.ts` (and routed to `api/serverless.js` in Vercel deployments).

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Fast deployment health & key presence check |
| `GET` | `/api/diagnostics` | Full system, model discovery & OSDR connectivity telemetry |
| `GET` | `/api/models` | Lists available text chat models & default model ID |
| `GET` | `/api/studies` | Lists indexed & cached OSDR studies |
| `GET` | `/api/study/:study_id` | Fetch single study metadata (queries live OSDR if uncached) |
| `GET` | `/api/search` | Fast local tokenized search across indexed datasets |
| `GET` | `/api/osdr/diagnostics` | OSDR provenance tier counts & request telemetry |
| `POST` | `/api/osdr/test-connection` | Live HTTP ping against `osdr.nasa.gov` |
| `GET` | `/api/osdr/search-live` | Live search proxy to NASA OSDR Search API |
| `POST` | `/api/chat` | SSE streaming chat & `/awg` synthesis endpoint |
| `GET` | `/api/awg/suggestions` | Curated high-compatibility study pairings |
| `GET` | `/api/awg/random-pair` | Select a random compatible study pair |
| `GET` | `/api/awg/compatibility` | Compute 100-point compatibility breakdown (`?studyA=...&studyB=...`) |
| `POST` | `/api/awg/media-set` | Generate 4-part grounded AWG image gallery |
| `POST` | `/api/awg/video` | Generate 3-scene scientific motion brief |
| `POST` | `/api/awg/translational-clip` | Generate grounded relatable translational clip |
| `POST` | `/api/awg/meme` | Generate grounded outreach meme concept |
| `GET` | `/api/awg/media/audit` | Retrieve session media generation audit & SHA-256 registry |
| `POST` | `/api/computer-use` | Execute allowlisted OSDR study inspection step log |
| `GET` | `/api/capabilities` | Return centralized Gemini capability registry & labels |
| `GET` / `POST` | `/api/tts/status`, `/api/tts` | Check TTS providers and synthesize WAV audio |

---

## Deployment & Security

- **Live Deployment:** https://osdr-chatbot-kappa.vercel.app/
- **Server-Side Isolation:** Credentials reside strictly in Node memory (`server/env.ts`) and are excluded via `.gitignore` (`.env`, `.env.*`, `*.pem`, `*.key`, `credentials.json`).

---

## Attribution & Disclaimer

This project integrates publicly accessible metadata from the **[NASA Open Science Data Repository (OSDR)](https://osdr.nasa.gov/)**. It is an independent open-source research-support tool and is **not officially affiliated with, endorsed by, or sponsored by NASA**.
