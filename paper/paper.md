---
title: 'OSDR ChatBot: An Evidence-Grounded Discovery, Schema-Guardrail, and Release Radar Hub for NASA Open Science Data Repository Multi-Omics Research'
tags:
  - TypeScript
  - React
  - NASA OSDR
  - space biology
  - multi-omics
  - SANS
  - scientific software
authors:
  - name: Gaston Dana
    orcid: 0009-0007-1011-860X
    corresponding: true
    affiliation: 1
  # TODO: Confirm final co-author roster, ORCIDs, and institutional affiliations prior to submission
  # (e.g., Jian Gong, Lauren M. Sanders, Ryan T. Scott [orcid: 0000-0003-0654-5661], and AIML AWG collaborators)
affiliations:
  - name: Independent Software Architect; Collaborator, NASA Open Science Data Repository (OSDR) Artificial Intelligence / Machine Learning Analysis Working Group (AIML AWG)
    index: 1
  # TODO: Add institutional affiliations for confirmed co-authors prior to submission
date: 24 November 2026
bibliography: paper.bib
---

# Summary

`OSDR_Chatbot` is an open-source, evidence-grounded web application and TypeScript/Python service suite for study discovery, cross-study experimental auditing, machine-learning schema contract export, subgroup exploratory analysis, and automated release tracking over the **NASA Open Science Data Repository (OSDR)** [@Gebre2025; @Sanders2024]. Developed alongside NASA OSDR Artificial Intelligence / Machine Learning Analysis Working Group (AIML AWG) workflows on Spaceflight-Associated Neuro-ocular Syndrome (SANS), `OSDR_Chatbot` unifies live OSDR lookups, peer-reviewed study manifests, 100-point comparability audits, $p \gg n$ cross-mission schema guardrails, decoupled Brain AWG and LEO Dosimetry explorers, and an automated **OSDR Release Radar** studio ([`osdr-chatbot-kappa.vercel.app`](https://osdr-chatbot-kappa.vercel.app/)).

Unlike unconstrained conversational LLM wrappers, `OSDR_Chatbot` enforces strict epistemic separation between repository-verified metadata, DOI-backed observed findings, model interpretation, and follow-up hypotheses, while running deterministically with zero API keys for full test reproducibility.

# Statement of Need

Studying spaceflight syndromes such as SANS requires integrating multi-omics, histopathology, and imaging assays split across missions and ground analogs: Rodent Research-9 (`OSD-255` right-retina RNA-seq, `OSD-557` left-eye micro-CT/histology, `OSD-568` retinal barrier microscopy, `OSD-583` intraocular pressure and barrier markers) [@Mao2019; @Overbey2019; @RoqueTorres2020], MHU-8 / CRS-27 (`OSD-758` retina and `OSD-759` optic nerve artificial-gravity RNA-seq) [@Kremsky2024], Rodent Research-18 (`OSD-685`, `OSD-698` brain GeoMx spatial transcriptomics) [@Kremsky2023], earlier shuttle/ISS cohorts (`OSD-87`, `OSD-100`, `OSD-194`) [@Mao2013; @GeneLabRR1; @GeneLabRR3], longitudinal hindlimb-unloading and irradiation (`OSD-203`) [@Kothiyal2022], and head-down tilt rat analogs (`OSD-679` to `OSD-681`).

Interdisciplinary biology and ML teams face three recurring pre-modeling bottlenecks:

1. **Citation and Assay Confusion Across Split Dissections:** Researchers often conflate assays across studies or contralateral eyes from one mission (e.g., attributing RNA-seq to tonometry/micro-CT cohorts `OSD-583`/`OSD-557`, or conflating bulk RNA-seq with GeoMx spatial profiling).
2. **Cross-Mission Data Leakage Under Extreme $p \gg n$ Regimes:** Small animal cohorts ($n=16$ right-retina mice in `OSD-255` across `CC1`/`CC2` controls; $n=12$ in `OSD-685`/`OSD-698` with zero shared subjects across missions) require animal-disjoint outer folds, inner-fold scaling, batch stratification, and spatial ROI alignment prior to imputation or tabular foundation-model benchmarking.
3. **Pre-Repository Discovery Lag:** AWG preprints and journal articles appear weeks before formal `OSD-*` dataset curation, while naive scraping pulls off-topic clinical literature.

**State of the Field:** The official NASA OSDR Web Portal, GeneLab processing pipelines, and general-purpose scientific chat assistants address raw archive access, bioinformatics processing, or unconstrained synthesis, respectively, but do not pair live OSDR resolution with cross-mission leakage guardrails, machine-readable ML schema contracts, zero-key deterministic auditing, and space-biology-scoped release monitoring. `OSDR_Chatbot` fills this upstream research-engineering gap without duplicating NASA's archive.

# Software Architecture and Key Capabilities

`OSDR_Chatbot` combines a React 18 / Vite frontend (`src/`), an Express 4 and TypeScript REST/SSE backend (`server/`, Vercel serverless entry `api/index.ts`), and deterministic Python adapters (`scripts/`).

* **4-Tier Authoritative Resolution (`server/osdrClient.ts`):** Resolves queries sequentially across live NASA OSDR APIs, session cache, curated DOI manifests (`server/studyManifests.ts`), and offline benchmark cohorts (`server/studiesData.ts`), blocking silent accession substitution (`server/accessionValidator.ts`).
* **7-Axis Comparability & 4-Tab Evidence Audit (`server/awg.ts`, `src/components/audit/EvidenceAuditCard.jsx`):** `/awg compare <A> <B>` partitions outputs into **Verified Metadata**, DOI/PMID-backed **Observed Results**, **Interpretation & Hypotheses** with `Epistemic Limit` tags, and a capped 100-point **Compatibility Breakdown** across organism, tissue, exposure, assay complementarity, duration, controls, and publications.
* **Schema Guardrails, Presets & Evidence Bundles (`server/awg.ts`, `server/evidenceBundle.ts`):** `buildSchemaGuardrailsAndContract` flags `ZERO_SHARED_ANIMALS`, `SAME_MISSION_DISSECTION_SPLIT`, `COHORT_BATCH_CONTROLS`, `P_GT_N_ANIMAL_DISJOINT`, `SPATIAL_ALIGNMENT`, and `FROZEN_PANEL_FDR_GUARDRAIL`, exporting a one-click **Schema Contract JSON** for downstream Python/PyTorch loaders (`/contributors`, `GET /api/awg/integrations`). One-click AWG presets (`/awg preset <id>`) and Markdown/JSON **Evidence Bundles** (`POST /api/evidence-bundle`) record prompts, citations, provider provenance, and UTC timestamps.
* **OSDR Release Radar & 8-Hour Lead Watch (`server/radar.ts`, `server/radarWebhook.ts`):** Monitors monthly/quarterly OSDR (`cgene`/`alsda`) depositions and pre-OSDR outputs across verified AWG chair ORCIDs via ORCID, OpenAlex, Crossref, NASA NTRS, PubMed, and Europe PMC on an 8-hour schedule (`0 */8 * * *`) with space-biology scope filtering (`evaluateSpaceBiologyScope`) and HMAC-SHA256 webhooks.
* **Dedicated Subgroup Explorers (`/brain-awg` and `/leo-dosimetry`):** Two lazy-loaded workspaces pair Python CLIs with browser mathematical parity and explicit illustrative-demo guardrails: (1) **Brain AWG 3D Omics Ordination Explorer** (`scripts/skbio_to_3d.py`, `src/utils/brainOrdination.js`) for deterministic `scikit-bio` `rclr`, Aitchison distance, 3D PCoA, and PERMANOVA over JSON or browser-dropped CSVs; and (2) **LEO Dosimetry SAA/GCR Pass-Audit Explorer** (`scripts/leo_saa_eval.py`, `src/utils/leoDosimetry.js`) for pass-level bootstrap 95% CIs, paired $\Delta F_1$ tests, Merge vs. Hysteresis rules, Hybrid Arm-and-Confirm triggering, and automated label-discrepancy auditing.
* **Resilient Multi-Provider Streaming & Verification (`server/textProviders.ts`, `server/modelDiscovery.ts`, `server/gemini.ts`, `src/api.js`):** Streams across a `$0` free-tier cascade (**Gemini -> Groq LPU -> OpenRouter -> Local Deterministic RAG**), preferring live Groq LPU (`openai/gpt-oss-120b`) when configured and enforcing `5.5 s` first-token `AbortController` timeouts, single-attempt SDK failure propagation, a `14.5 s` cascade budget guaranteeing local fallback, `90 s` provider cooldowns, a `28 s` client stream watchdog, ~`100 ms` chunked deterministic commands (`/awg`, `/awg radar`, `/awg help`), and empty-launchpad scroll-to-top framing (`src/App.jsx`). Additional modules cover SHA-256 media provenance (`/awg media audit`), allowlisted `osdr.nasa.gov` inspection (`server/computerUse.ts`), and optional per-UID AWG profiles (`/account`). Verification spans **22 Node/TypeScript test suites (`npm test`)**, **12 Python `pytest` tests**, strict `tsc --noEmit` checks, and live production Playwright E2E tests.

# Research Applications

`OSDR_Chatbot` operates as a shared upstream discovery, schema-audit, and exploratory workspace for NASA OSDR AIML AWG collaborators. Investigators verify dissection and assay boundaries across `OSD-255`, `OSD-557`, `OSD-568`, `OSD-583`, `OSD-758`, `OSD-759`, `OSD-203`, `OSD-685`, `OSD-698`, and `OSD-679` to `OSD-681`, export aligned schema contracts into independent collaborator prototypes (`RetinaCellTwin` and `SpaceSleepTwin` by Lissandra Kruse Fuganti in `/contributors`), audit multi-omics ordinations (`/brain-awg`) and orbital dosimetry passes (`/leo-dosimetry`), and track emerging OSDR releases via `/awg radar`.

# Acknowledgements

We thank Jian Gong, Lauren M. Sanders, Ryan T. Scott, and NASA OSDR Analysis Working Group collaborators in the AIML AWG Retinal Spaceflight Digital Twin initiative for scientific guidance, schema-audit feedback, and dataset prioritization. Dataset metadata are sourced from the publicly accessible NASA OSDR (`https://osdr.nasa.gov/`). `OSDR_Chatbot` is an independent open-source project and is not officially endorsed or sponsored by NASA.

# References
