# Contributing to OSDR_Chatbot

Thank you for helping improve **OSDR_Chatbot**! Contributions from space biology researchers, Analysis Working Group (AWG) leads, bioinformaticians, and full-stack/ML engineers are welcome.

---

## Code of Scientific Integrity

Because this project operates over NASA Open Science Data Repository (`OSD-*`) records and biomedical publications, all pull requests must preserve four core epistemic invariants:

1. **Strict Provenance Separation:** Repository metadata (`organism`, `tissue`, `assay`, `platform`, mission factor), DOI-backed observed findings, model interpretations, and follow-up hypotheses must remain clearly labeled and never blended silently.
2. **No Silent Accession Substitution:** Invalid, single, or duplicate study accessions entered by users or downstream tools must return structured validation warnings (`server/accessionValidator.ts`), never swap in unrelated datasets.
3. **Cross-Mission, Frozen-Panel & Small-$n$ ML Guardrails:** Comparisons across distinct missions (e.g., RR-9 `OSD-255` vs. RR-18 `OSD-685`, MHU-8 `OSD-758`, or HLU+LDR `OSD-203`) must explicitly surface `ZERO_SHARED_ANIMALS`, `P_GT_N_ANIMAL_DISJOINT`, batch/gravity/timepoint strata (`COHORT_BATCH_CONTROLS`), `FROZEN_PANEL_FDR_GUARDRAIL` (freezing the `OSD-255` discovery signature before external testing), and `SPATIAL_ALIGNMENT` constraints in both UI cards and Schema Contract JSON exports.
4. **Domain-Scoped Release Tracking:** Non-mammalian studies (`Plant`, `Microbes`) in the OSDR Release Radar must omit mammalian retinal SANS scoring, and AWG lead publication tracking must enforce space-biology domain filtering (`evaluateSpaceBiologyScope` in `server/radar.ts`).

---

## Zero-API-Key Deterministic Setup & Verification

You do **not** need a Google Gemini, OpenRouter, Groq, or OpenAI API key to run the test suite, typecheck, build the application, or inspect the UI locally.

### Prerequisites

* **Node.js** `>= 18`
* **npm** `>= 9`

### Install & Run Automated Checks (No `.env` or API Keys Required)

```bash
# 1. Clone and install dependencies
git clone https://github.com/gastondana627/OSDR_Chatbot.git
cd OSDR_Chatbot
npm install

# 2. Typecheck TypeScript across client UI, Express/serverless backend, and tests
npm run lint

# 3. Run all 13 deterministic unit & HTTP integration test suites without API keys
npm test

# 4. Build the Vite frontend, Express bundle, and Vercel serverless entry
npm run build
```

All 13 test scripts under `tests/` execute without LLM credentials by exercising:
* Local curated `StudyManifest` invariants and 7-axis compatibility math (`tests/scientificIntegrity.test.ts`, `tests/evidenceModel.test.ts`),
* Community showcase endpoints and `FROZEN_PANEL_FDR_GUARDRAIL` contracts (`tests/communityIntegrations.test.ts`),
* Accession parsing and anti-substitution checks (`tests/accessionValidation.test.ts`),
* Capability routing, media gating, and outreach markdown guardrails (`tests/awgMediaCapabilityGating.test.ts`, `tests/capabilityRouterAndComputerUse.test.ts`, `tests/memeMarkdown.test.ts`, `tests/argonReasoningAndLongContext.test.ts`),
* Local Express server routes (`/api/diagnostics`, `/api/awg/radar`, `/api/chat` deterministic/greeting fast-paths and degraded error handling in `tests/degradedStateHandling.test.ts`, `tests/chatTwoPhaseSafeExecution.test.ts`, `tests/releaseRadar.test.ts`, `tests/vercelDeploymentRouting.test.ts`, `tests/ttsProviderAgnostic.test.ts`).

> **Note for restricted network environments:** `tests/degradedStateHandling.test.ts` opens a localhost HTTP port and calls `POST /api/osdr/test-connection`, which gracefully handles unreachable upstream networks by returning structured status telemetry without throwing unhandled exceptions.

### Running the Web App in Zero-Key Offline / Fallback Mode

```bash
# Start full-stack Express + Vite app on http://localhost:3000 with zero API keys
npm run dev
```

When `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, and `GROQ_API_KEY` are unset:
* `/api/chat` uses deterministic metadata-grounded synthesis over `server/studiesData.ts`, `server/studyManifests.ts`, and live NASA OSDR REST lookups when online.
* `/awg`, `/awg radar`, `/awg compare <A> <B>`, `/awg random`, `/awg meme <A> <B>`, and `/awg media audit` remain fully operational using the bundled snapshot (`server/radarSnapshot.json`), local evidence audit cards, Schema Contract JSON export, and 60fps client-side canvas players.

---

## Submitting Changes

1. **Fork & Branch:** Create a descriptive feature branch from `main` (e.g., `fix/osd-manifest-validation` or `feat/ingest-schema-hook`).
2. **Add Regression Tests:** Any change to compatibility rubrics, schema contracts, provenance tiers, or Release Radar filtering should include assertions under `tests/`.
3. **Verify Before Opening a PR:** Confirm `npm run lint`, `npm test`, and `npm run build` all pass cleanly.
4. **Never Commit Credentials:** Do not commit `.env`, `.env.*` (other than `.env.example`), API tokens, or keys.

## Reporting Bugs or Suggesting Connectors

Please open a [GitHub Issue](https://github.com/gastondana627/OSDR_Chatbot/issues) including:
* Expected vs. observed behavior (and the exact `/awg` command or accession IDs involved),
* Relevant `GET /api/osdr/diagnostics` or `GET /api/diagnostics` JSON fields (sanitized—never paste secret values),
* Whether the issue reproduces in zero-key deterministic mode or live LLM mode.

