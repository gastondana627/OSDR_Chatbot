# NASA OSDR Analysis Working Group (AWG) Command Reference

The **Analysis Working Group (AWG)** command suite in **OSDR_Chatbot** enables structured cross-study multi-omics co-analysis, transparent 100-point compatibility scoring, strict accession validation, and provenance-audited visual media generation grounded in NASA Open Science Data Repository records.

---

## Command Reference

| Command | Aliases | Action | Example |
|---|---|---|---|
| `/awg` | `/awg chooser`, `/awg guide`, `/awg menu` | Open interactive **Guided Study Chooser** with ranked compatibility pairs and repository search | `/awg` |
| `/awg compare <OSD-A> <OSD-B>` | `awg compare ...` | Co-analyze two distinct OSDR accessions across organism, tissue, assay, mission cohort, and validation constraints | `/awg compare OSD-583 OSD-255` |
| `/awg random` | `/awg roll`, `/awg auto` | Automatically select a high-compatibility study pair for immediate multi-omics co-analysis | `/awg random` |
| `/awg meme [OSD-A OSD-B]` | `!awg meme` | Generate a conceptual outreach clip pairing verified repository metadata with clear humor/reality boundaries | `/awg meme OSD-100 OSD-194` |
| `/awg media audit` | `/awg audit` | Open the session-wide **Media Generation Audit & SHA-256 Provenance Registry** | `/awg media audit` |
| `/awg analyze <OSD-ID>` | — | Single-accession deep metadata inspection with explicit counterpart pairing workflow | `/awg analyze OSD-583` |
| `/awg summary <OSD-ID>` | — | Generate structured executive accession metadata summary | `/awg summary OSD-679` |
| `/awg help` | `/awg ?`, `/awg --help` | Display the in-app AWG command guide and epistemic boundary rules | `/awg help` |

---

## Key Workflows & Safeguards

### 1. Guided Chooser & Broader Repository Search (`/awg`)
- Displays scored, ready-to-compare pairs alongside a toggle between **Contextual Studies** (active benchmark cohort) and **Broader Repository Search** (keyword search across indexed/live NASA OSDR records).

### 2. Strict Accession Validation (Zero Silent Substitution)
When an invalid, unresolved, identical (`OSD-679 OSD-679`), or single study ID is entered, AWG comparisons **never silently substitute** another study. Instead, the UI renders `AccessionValidationCard` with explicit resolution paths:
1. Enter a distinct second accession manually
2. Choose a suggested compatible counterpart explicitly
3. Roll a pair with `/awg random`

### 3. 100-Point Compatibility Breakdown
Each `/awg compare` response computes a transparent 7-dimension compatibility rubric (`0–100`):
- **Organism Match** (`0–20`)
- **Tissue & Material Overlap** (`0–20`)
- **Exposure & Platform Similarity** (`0–20`)
- **Assay Complementarity** (`0–15`)
- **Timepoint & Duration Comparability** (`0–10`)
- **Control-Design Comparability** (`0–10`)
- **Publication & Evidence Availability** (`0–5`)

### 4. Four-Tab Evidence Audit & Schema Contract Export (`EvidenceAuditCard`)
Every AWG comparison separates claims cleanly into strict evidence tiers and exposes machine-readable ML ingestion guardrails:
1. **Verified Metadata (`METADATA`)** — Direct organism, tissue, assay, platform, mission factor, and repository links.
2. **Observed Results (`OBSERVED RESULT`)** — Peer-reviewed empirical findings anchored with DOI citations.
3. **Interpretation & Hypotheses (`INTERPRETATION` / `HYPOTHESIS` / `CANDIDATE FOLLOW-UP`)** — Cross-study synthesis explicitly stamped with rationale and `Epistemic Limit` caveats.
4. **Compatibility Breakdown** — Full itemized score ledger explaining points earned, caveats withheld (including distinct mission / zero shared animals), and recommended animal-disjoint CV strategy.
5. **Schema Guardrails & Contract JSON (`Copy Schema Contract JSON`)** — Flags `ZERO_SHARED_ANIMALS`, `P_GT_N_ANIMAL_DISJOINT`, `COHORT_BATCH_CONTROLS` (`CC1`/`CC2`), and `SPATIAL_ALIGNMENT` (Nanostring GeoMx DSP across `OSD-685`/`OSD-698`) and exports the pair's typed `IngestionSchemaContract` JSON.
