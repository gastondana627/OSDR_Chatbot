# OSDR_Chatbot

An evidence-grounded NASA OSDR research assistant for live study discovery, cross-study comparison, and scientific media generation.

---

## 1. Overview

**OSDR_Chatbot** is an AI-powered research-support application designed to accelerate the exploration of NASA's [Open Science Data Repository (OSDR)](https://osdr.nasa.gov/) and GeneLab space biology database. It bridges raw biological repository records with Analysis Working Group (AWG)-style multi-omics co-analysis, providing researchers, educators, and mission planners with instant study discovery, cross-study synthesis, and evidence-grounded scientific visual media.

---

## 2. Architecture

```text
┌────────────────────────────────────────────────────────────────────────┐
│                              BROWSER UI                                │
│   React 18 + Vite SPA · Chat Stream (SSE) · Media Gallery & Players    │
│            Live OSDR Diagnostics Modal · Accession Badges              │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / SSE / REST
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                           APP SERVER (Node.js)                         │
│       Express 4 Backend · Environment & Key Isolation (Server-Side)    │
│  /api/chat · /api/search · /api/osdr/* · /api/awg/* · Static Serving   │
└──────────────┬────────────────────┬────────────────────┬───────────────┘
               │                    │                    │
               ▼                    ▼                    ▼
┌──────────────────────┐  ┌──────────────────┐  ┌────────────────────────┐
│   OSDR DATA CLIENT   │  │   AWG SYNTHESIS  │  │    MEDIA GENERATION    │
│  • Live OSDR REST    │  │  • Evidence Map  │  │  • Gemini Image Gen    │
│    (/data/search,    │  │  • Omics Sync    │  │    (Flash-Lite-Image)  │
│     /osd/files)      │  │  • Fact vs.      │  │  • Veo Video Gen       │
│  • In-Memory Cache   │  │    Inference     │  │    (Veo-3.1-Lite)      │
│  • Curated Mappings  │  │  • Translation   │  │  • Truthful SVG/HTML5  │
│  • Seeded Snapshots  │  │    Targets       │  │    Procedural Fallback │
└──────────────────────┘  └──────────────────┘  └────────────────────────┘
```

---

## 3. Scientific-Boundary Statement

> [!IMPORTANT]
> **OSDR_Chatbot is a research-support and scientific communication tool. It combines repository-grounded study facts with evidence-informed synthesis and conceptual visualization. Generated images, charts, motion briefs, and translational clips are not raw experimental data, clinical guidance, or validated countermeasure recommendations unless explicitly linked to a source record.**

---

## 4. What It Does

- **Evidence-Grounded Chat & Study Discovery**: Ask questions in natural language regarding spaceflight biological factors (microgravity, space radiation, hyperoxia), model organisms (rodents, plants, cell cultures, human analog cohorts), and molecular assays. Responses cite verified OSDR accessions (`OSD-XXX`) with clickable repository links.
- **Live OSDR REST Retrieval**: Dynamically queries NASA OSDR REST endpoints at runtime for search indexing, study metadata, and file counts.
- **Hybrid Evidence Model**: Operates across a transparent four-tier data resolution hierarchy:
  1. `live_api`: Real-time query against live NASA OSDR search and metadata APIs.
  2. `cached_snapshot`: In-memory caching of dynamically fetched accession records.
  3. `local_curated_mapping`: Pre-indexed space biology assay associations and multi-omics linkages.
  4. `static_seeded_examples`: High-fidelity baseline records ensuring 100% application resilience during NASA server maintenance.
- **Analysis Working Group (AWG) Mode**: Activated by `/awg` commands to execute systematic cross-study comparisons, contrasting upstream transcription against downstream proteomic and metabolomic cascades.
- **Grounded Image Gallery**: Produces publication-ready visual sets categorized across Data Visualization Infographics, Biological Concept Diagrams, Contextual Scene Illustrations, and Accession Summary Cards.
- **Scientific Motion Brief**: Generates concise, 3-scene analytical motion explainers (*Analytical Opener ➔ Mechanistic Deep Dive ➔ Translational Close*).
- **Relatable Translational Clip**: Produces conceptual, mission-facing narrative clips communicating the real-world operational relevance of space biology findings.
- **OSDR Diagnostics Panel & Live Connection Test**: In-app monitoring modal allowing users to audit connection status, measure endpoint latency in milliseconds, inspect runtime fetch metrics, and run on-demand ping tests against NASA OSDR.

---

## 5. Commands

For the complete command documentation, parameters, and examples, see [`docs/AWG_COMMANDS.md`](docs/AWG_COMMANDS.md).

### Quick-Start Commands Table

| Command | Action | Example | Status |
|---|---|---|---|
| `/awg compare <OSD-A> <OSD-B>` | Co-analyze two OSDR accessions across assay layers and tissues | `/awg compare OSD-679 OSD-680` | **Implemented** |
| `/awg compare OSD-679 OSD-681` | Compare transcriptomic alterations with downstream metabolite profiles | `/awg compare OSD-679 OSD-681` | **Implemented** |
| `/awg analyze <OSD-ID>` | Single-study in-depth breakdown with automatic complementary pairing | `/awg analyze OSD-583` | **Implemented** |
| `/awg summary <OSD-ID>` | Generate structured executive accession metadata summary | `/awg summary OSD-679` | **Implemented** |
| `/awg suggest` | Discover recommended complementary cross-omics pairs in the dataset | `/awg suggest` | **Implemented** |
| `/awg help` | Display in-app AWG command guide and epistemic boundary rules | `/awg help` | **Implemented** |
| `/awg export <format>` | Export multi-omics comparison matrices to CSV / JSON / PDF | `/awg export json` | *Planned* |
| `/awg pathway <name>` | Cross-study targeted pathway query | `/awg pathway VEGF` | *Planned* |
| `/awg countermeasure <target>` | Candidate countermeasure mapping against molecular targets | `/awg countermeasure SANS` | *Planned* |

---

## 6. Data and Provenance

### Live OSDR Endpoints
The backend integrates directly with official NASA OSDR REST services:
- **Search API**: `https://osdr.nasa.gov/osdr/data/search` — Real-time accession discovery, text queries, and field filtering.
- **Study Metadata API**: `https://osdr.nasa.gov/osdr/data/osd/meta` — Accession metadata, mission parameters, and managing NASA centers.
- **Study Files API**: `https://osdr.nasa.gov/osdr/data/osd/files` — File counts and payload asset inventories.

### Cache and Seeded Fallbacks
To provide high reliability and avoid rate-limiting disruptions:
- Newly retrieved live studies are cached in-memory with timestamps.
- Seeded reference datasets (including `OSD-679`, `OSD-680`, `OSD-681`, `OSD-583`, and `OSD-87`) provide rich multi-omics baseline representations.

### Opening the OSDR Diagnostics Panel
Users can open the Diagnostics modal at any time by:
1. Clicking the **Connection Status Pill** in the top header or sidebar.
2. Clicking the **"Run Connection Ping"** button inside the modal to execute an active diagnostic round-trip against `osdr.nasa.gov`.
3. Querying `GET /api/osdr/diagnostics` via REST client.

### Source Modes
- **`live_api`**: Verified response retrieved dynamically from live NASA OSDR servers.
- **`cached_snapshot`**: Accession record previously fetched from NASA OSDR during the active server session.
- **`local_curated_mapping`**: Enhanced multi-omics assay mapping linked in local server registry.
- **`static_seeded_examples`**: Pre-packaged high-fidelity baseline study metadata.

### Epistemic Boundary of Live Connections
A successful live connection to NASA OSDR confirms that study metadata (sample titles, organisms, assay types, mission names) are authentic and directly retrieved from NASA databases. However, **generated media and synthetic summaries remain conceptual AI representations based on that metadata**—they do not represent raw detector readouts, primary sequencer files, or mass spectrometry spectra.

---

## 7. Media Modes

OSDR_Chatbot generates three distinct classes of scientific media, each with strict epistemic boundary enforcement:

### 1. Grounded Image Gallery
- **Data Visualization Infographic**: Structured multi-layer network graphs illustrating cross-layer regulatory interactions between upstream transcripts and downstream metabolites.
- **Biological Concept Diagram**: Stratified anatomical and cellular cross-sections illustrating proposed pathophysiological mechanisms (such as Blood-Retinal Barrier permeability in SANS).
- **Contextual Scene Illustration**: Conceptual simulations of space biology research environments, ground analog habitats, tilt angles, and telemetry workstations.
- **Accession Summary Card**: High-contrast executive cards compiling verified accession metadata, assay platforms, sample counts, and managing centers.

### 2. Scientific Motion Brief
A concise 5-second, 3-scene analytical explainer structured as:
1. **Scene 1: Analytical Opener (0.0s – 1.6s)** — Dual accession badges, model organism identification, and shared spaceflight analog factor.
2. **Scene 2: Mechanistic Deep Dive (1.6s – 3.4s)** — Cross-omics pathway alignment highlighting transcriptomic activation and downstream structural degradation.
3. **Scene 3: Translational Close (3.4s – 5.0s)** — Highlighting candidate therapeutic target pathways and countermeasure vectors.

### 3. Relatable Translational Clip
A cinematic, public-facing communication clip connecting microgravity cellular mechanisms to operational spaceflight human health challenges.

### Epistemic Boundary Framework for Media
| Boundary Tier | Definition | Handling in Media |
|---|---|---|
| **Observed Study Evidence** | Empirical facts directly recorded in OSDR records | Explicitly labeled on cards with exact accession IDs and assays |
| **Evidence-Informed Synthesis** | Multi-study pathway inferences and correlations | Clearly designated as synthesized cross-omics hypotheses |
| **Conceptual Visualization** | AI-rendered visual models, scene renders, animations | Accompanied by provenance disclaimer badges and confidence ratings |

---

## 8. Setup and Environment

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher

### Environment Variables
Configure your server-side environment variables in `.env` (refer to `.env.example`):

```env
# Server-Side API Keys (Never exposed to client or browser)
GEMINI_API_KEY=your_gemini_api_key_here
IMAGE_API_KEY=your_optional_image_key_here
VIDEO_API_KEY=your_optional_video_key_here
```

- `GEMINI_API_KEY`: Primary API key for Gemini chat streaming and default fallback for media generation.
- `IMAGE_API_KEY`: *(Optional)* Dedicated key for Gemini Image Generation (`gemini-3.1-flash-lite-image`). Defaults to `GEMINI_API_KEY` if omitted.
- `VIDEO_API_KEY`: *(Optional)* Dedicated key for Veo Video Generation (`veo-3.1-lite-generate-preview`). Defaults to `GEMINI_API_KEY` if omitted.

> [!NOTE]
> All API keys are isolated to server-side memory and never passed to the browser or client-side bundles.

### Installation & Launch

```bash
# 1. Install dependencies
npm install

# 2. Run in development mode (starts Node/Express server with Vite middleware on port 3000)
npm run dev

# 3. Build and run in production mode
npm run build
npm run start
```

Open `http://localhost:3000` in your browser.

---

## 9. API and Diagnostics

The backend exposes the following REST and SSE endpoints:

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/models` | List available Gemini models for chat selection |
| `GET` | `/api/studies` | Return list of cached/seeded OSDR studies with titles and file counts |
| `GET` | `/api/study/:study_id` | Fetch full metadata for a single accession (queries live OSDR if uncached) |
| `GET` | `/api/search` | Fast tokenized search across indexed study titles, assays, and descriptions |
| `GET` | `/api/osdr/diagnostics` | Audit connection status, latency, endpoint URLs, and fetch counts |
| `POST` | `/api/osdr/test-connection` | Execute active live HTTP ping against `osdr.nasa.gov` |
| `GET` | `/api/osdr/search-live` | Query live NASA OSDR search index in real time |
| `POST` | `/api/chat` | Server-Sent Events (SSE) stream for interactive chat and AWG synthesis |
| `GET` | `/api/awg/config` | Report configuration status for Gemini Image and Video generation |
| `POST` | `/api/awg/media-set` | Generate complete 4-part grounded image set (`/api/awg/media`, `/api/awg/gallery`) |
| `POST` | `/api/awg/image` | Generate single study-linked visual abstract |
| `POST` | `/api/awg/video` | Generate 5-second grounded scientific motion brief |
| `POST` | `/api/awg/translational-clip` | Generate creative relatable translational narrative video clip |

---

## 10. Security

- **Environment Isolation**: All sensitive credentials (`GEMINI_API_KEY`, `IMAGE_API_KEY`, `VIDEO_API_KEY`) are accessed strictly within backend Node.js services.
- **Git Protection**: `.gitignore` explicitly prevents committing `.env`, `.env.*`, certificates (`*.pem`, `*.key`), and service account credentials.
- **Client Safety**: The client-side React bundle contains no API tokens or secret keys; all communications route through the local Express proxy.

---

## 11. Limitations

1. **NASA OSDR Endpoint Availability**: Live metadata queries depend on the operational uptime and response times of NASA's public OSDR REST services (`osdr.nasa.gov`). If NASA servers are unavailable, the application gracefully degrades to cached and seeded records.
2. **Epistemic Scope**: Inferred multi-omics correlations and translational hypotheses represent evidence-informed AI synthesis. Researchers must verify biomarker claims, statistical values, and molecular targets against primary OSDR study publications.
3. **Media Generation Fallback**: When video/image API keys or provider quotas are unavailable, the system produces high-fidelity SVG/HTML5 procedural visual fallbacks to ensure uninhibited user workflow.

---

## 12. License and Attribution

- **NASA OSDR**: This project utilizes publicly accessible data and APIs provided by the [NASA Open Science Data Repository (OSDR)](https://osdr.nasa.gov/).
- **Disclaimer**: This tool is an independent open-source research-support application and is **not officially affiliated with, endorsed by, or sponsored by NASA** (National Aeronautics and Space Administration).
