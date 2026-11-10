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
  # TODO: Add co-authors prior to submission (e.g., Jian [Last Name], Ryan T. Scott [orcid: 0000-0003-0654-5661], and AIML AWG collaborators)
affiliations:
  - name: NASA Open Science Data Repository (OSDR) Artificial Intelligence / Machine Learning Analysis Working Group (AIML AWG) Collaborator; Independent Software Architect
    index: 1
  # TODO: Update institutional affiliations once co-author roster is finalized
date: 9 November 2026
bibliography: paper.bib
---

# Summary

`OSDR_Chatbot` is an open-source, evidence-grounded web application and TypeScript service layer designed to accelerate upstream study discovery, cross-study experimental auditing, schema contract generation, and ongoing literature/dataset currency tracking over the **NASA Open Science Data Repository (OSDR)** [@Gebre2025; @Sanders2024]. Built around workflows developed alongside the NASA OSDR Artificial Intelligence / Machine Learning Analysis Working Group (AIML AWG) Spaceflight-Associated Neuro-ocular Syndrome (SANS) Retinal Digital Twin initiative, `OSDR_Chatbot` integrates live repository queries, peer-reviewed publication manifests, transparent multi-axis comparability scoring, strict $p \gg n$ / cross-mission schema guardrails, and an automated **OSDR Release Radar & AWG Lead Watch** studio into a single interactive interface ([`osdr-chatbot-kappa.vercel.app`](https://osdr-chatbot-kappa.vercel.app/)).

Unlike general-purpose conversational interfaces wrapped around large language models (LLMs), `OSDR_Chatbot` enforces strict epistemic separation between repository-verified metadata, DOI-backed empirical findings, model interpretation, and follow-up hypotheses, while operating deterministically in zero-API-key offline environments for full test reproducibility.

# Statement of Need

Studying complex spaceflight physiological syndromes such as SANS requires bridging fragmented multi-omics, histopathology, and ophthalmic imaging assays deposited across multiple missions and ground analogs—such as Rodent Research-9 (RR-9: `OSD-255` right-retina RNA-seq, `OSD-557` left-eye micro-CT and histology, `OSD-568` retinal fluorescence barrier microscopy, `OSD-583` intraocular pressure and blood-retinal barrier markers) [@Mao2019; @Overbey2019; @RoqueTorres2020], Mouse Habitat Unit-8 (MHU-8 / SpaceX CRS-27: `OSD-758` retina and `OSD-759` optic nerve artificial-gravity RNA-seq) [@Kremsky2024], Rodent Research-18 (RR-18: `OSD-685` and `OSD-698` mouse brain Nanostring GeoMx spatial transcriptomics) [@Kremsky2023], earlier shuttle/ISS cohorts (`OSD-87`, `OSD-100`, `OSD-194`) [@Mao2013; @GeneLabRR1; @GeneLabRR3], longitudinal hindlimb-unloading and low-dose irradiation (`OSD-203`) [@Kothiyal2022], and ground-based head-down tilt rat analogs (`OSD-679`, `OSD-680`, `OSD-681`).

In practice, interdisciplinary teams combining domain biologists and machine-learning practitioners encounter three recurring bottlenecks prior to downstream data ingestion and tabular/foundation-model benchmarking:

1. **Citation and Assay Confusion Across Split Dissections:** Investigators frequently conflate assays belonging to different studies or contralateral eyes from the same mission (for instance, attributing retinal RNA-seq to physiological/tonometry cohorts `OSD-583` or `OSD-557`, or confusing bulk RNA-seq with GeoMx digital spatial profiling).
2. **Cross-Mission Data Leakage Under Extreme $p \gg n$ Regimes:** Small animal counts (e.g., $n=16$ distinct right-retina mice in `OSD-255` across `CC1`/`CC2` control cohorts, and $n=12$ in `OSD-685`/`OSD-698` across different missions with zero shared animal subjects) require strictly animal-disjoint outer cross-validation folds, inner-fold feature scaling, cohort batch stratification, and spatial ROI coordinate alignment before applying imputation methods (such as MICE-Elastic) or tabular foundation models. Generic search portals do not flag these modeling hazards prior to code ingestion.
3. **Pre-Repository Discovery Lag:** Relevant spaceflight findings frequently appear in bioRxiv/arXiv preprints and peer-reviewed journals authored by GeneLab AWG leads weeks or months before formal `OSD-*` dataset curation completes, creating manual literature tracking overhead that risks pulling in off-topic terrestrial/clinical papers when scraped naively.

`OSDR_Chatbot` addresses these gaps by pairing human-readable scientific discovery with machine-verifiable guardrails, schema contract exports, and domain-scoped release monitoring.

# Software Architecture and Key Capabilities

The software is structured as a React 18 / Vite single-page frontend (`src/`) backed by an Express 4 and TypeScript REST/SSE API (`server/`), deployable locally or via serverless routing (`api/index.ts`).

* **4-Tier Authoritative Resolution & Provenance (`server/osdrClient.ts`):** Study lookups follow an explicit provenance hierarchy across (1) live NASA OSDR search/metadata APIs, (2) session-cached records, (3) curated study manifests (`server/studyManifests.ts`), and (4) offline benchmark cohorts (`server/studiesData.ts`), preventing silent substitution when invalid accessions are queried (`server/accessionValidator.ts`).
* **7-Axis Comparability Rubric & 4-Tab Evidence Audit (`server/awg.ts`, `src/components/audit/EvidenceAuditCard.jsx`):** Users running `/awg` or `/awg compare <A> <B>` inspect four separated evidence tabs (**Verified Metadata**, **Observed Results** with clickable DOI/PMID provenance, **Interpretation & Hypotheses** tagged with explicit `Epistemic Limit` cautions, and **Compatibility Breakdown** totaling up to 100 points across organism, tissue, exposure/mission, assay complementarity, duration, control design, and publication support). Cross-species or cross-mission comparisons enforce score caps and itemized deductions.
* **Automated Schema Guardrails, Frozen-Panel Policy & Contract JSON Export:** For every compared pair, `buildSchemaGuardrailsAndContract` in `server/awg.ts` emits explicit alerts (`ZERO_SHARED_ANIMALS`, `SAME_MISSION_DISSECTION_SPLIT`, `COHORT_BATCH_CONTROLS`, `P_GT_N_ANIMAL_DISJOINT`, `SPATIAL_ALIGNMENT`, and `FROZEN_PANEL_FDR_GUARDRAIL`) alongside a one-click **Copy Schema Contract JSON** payload specifying sample counts, batch/gravity strata (`CC1`/`CC2`, saline/BuOE, MHU-8 centrifugation bins), frozen reference signature policies (e.g., freezing the `OSD-255` NASA FDR < 0.05 panel prior to external testing), and recommended validation strategies for downstream Python/PyTorch loaders or community evidence platforms (`GET /api/awg/integrations`, including independent collaborator prototypes such as **RetinaCellTwin**).
* **OSDR Release Radar & AWG Lead Watch (`server/radar.ts`, `scripts/syncRadarSnapshot.ts`, `src/components/awg/ReleaseRadarModal.jsx`):** Tracks recent monthly and quarterly NASA OSDR (`cgene` and `alsda`) releases alongside Pre-OSDR preprints and peer-reviewed outputs across verified ORCID profiles of all GeneLab AWG subgroup chairs and OSDR science leadership via ORCID Public API, OpenAlex, and Europe PMC. A strict `evaluateSpaceBiologyScope` filter retains spaceflight/microgravity works while auditing off-topic clinical exclusions, and non-mammalian studies (`Plant`, `Microbes`) intentionally omit retinal SANS compatibility scores.
* **Provenance-Audited Media, Scoped Inspector, and Zero-Key Determinism (`server/mediaGen.ts`, `server/computerUse.ts`, `server/textProviders.ts`):** Supports interactive 4-panel visual galleries, 60fps canvas motion explainers, SHA-256 prompt-fingerprinted media audits (`/awg media audit`), domain-allowlisted `osdr.nasa.gov` DOM inspection, multi-provider LLM fallback cascade, and deterministic offline synthesis with 13 automated test suites (`tests/`).

# Research Applications

`OSDR_Chatbot` is currently deployed as a shared upstream discovery and schema-audit hub supporting the NASA OSDR AIML AWG Retinal Spaceflight Digital Twin group. Researchers use the tool to verify anatomical and assay boundaries across `OSD-255`, `OSD-557`, `OSD-568`, `OSD-583`, `OSD-758`, `OSD-759`, `OSD-203`, `OSD-685`, `OSD-698`, and ground SANS cohorts (`OSD-679`–`OSD-681`), export animal-disjoint and frozen-panel schema contracts into downstream multimodal demonstrators (such as Lissandra (`fuganti`)'s independent `RetinaCellTwin` evidence map), and monitor emerging quarterly OSDR depositions (`OSD-920`, `OSD-815`–`OSD-818`) and pre-OSDR subgroup manuscripts via `/awg radar`.

# Acknowledgements

We thank members and subgroup leads of the NASA Open Science Data Repository (OSDR) Analysis Working Groups—especially collaborators in the AIML AWG Retinal Spaceflight Digital Twin initiative—for scientific feedback, schema audit guidance, and dataset prioritization discussions. Metadata and dataset records are sourced from the publicly accessible NASA Open Science Data Repository (`https://osdr.nasa.gov/`). `OSDR_Chatbot` is an independent open-source project and is not officially endorsed or sponsored by NASA.

# References
