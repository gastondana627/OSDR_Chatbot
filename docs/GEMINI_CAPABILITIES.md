# Gemini Capability Registry & Router Reference

This document outlines the centralized capability routing architecture, normalized model families, and operational guardrails for the **NASA OSDR ChatBot & AWG Evidence Engine**.

---

## 1. Centralized Capability Families

| Capability Group | Canonical ID | User-Facing Display Label | API Model ID | Default Use Case | Quota Sensitivity |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Image** | `nano-banana-2-lite` | **Nano Banana 2 Lite — Gemini 3.1 Flash Lite Image** | `gemini-3.1-flash-lite-image` | Primary balanced default for AWG 4-image visual abstract sets | Low |
| **Image** | `nano-banana` | **Nano Banana — Gemini 2.5 Flash Preview Image** | `gemini-2.5-flash-preview-image` | Low-latency conceptual illustrations | Low |
| **Image** | `nano-banana-2` | **Nano Banana 2 — Gemini 3.1 Flash Image** | `gemini-3.1-flash-image` | High-fidelity comparative figures | Medium |
| **Image** | `nano-banana-pro` | **Nano Banana Pro — Gemini 3 Pro Image** | `gemini-3-pro-image` | Complex multi-panel ultrastructure figures | High |
| **Video** | `veo-3-lite-generate-preview` | **Veo 3 Lite Generate** | `veo-3.1-lite-generate-preview` | Default video briefs and AWG meme clips | **High** (2 RPM / 10 RPD) |
| **Video** | `veo-3-fast-generate` | **Veo 3 Fast Generate** | `veo-3.0-fast-generate-001` | Rapid kinetic fluid-dynamic briefs | High |
| **Video** | `veo-3-generate` | **Veo 3 Generate** | `veo-3.0-generate-001` | Maximum-fidelity 1080p outreach renders | High |
| **Computer Use** | `computer-use-preview` | **Computer Use Preview** | `gemini-2.5-flash` | Guarded OSDR UI inspection & metadata extraction | Medium (150 RPM / 10K RPD) |
| **Text** | `gemini-3.7-flash` | **Gemini 3.7 Flash — Primary Reasoning** | `gemini-3.7-flash` | Primary chat, AWG synthesis & RAG reasoning | Low |
| **Text** | `gemini-2.5-flash` | **Gemini 2.5 Flash — Fast Synthesis** | `gemini-2.5-flash` | Low-latency structured JSON formatting | Low |
| **TTS** | `gemini-2.5-flash-tts` | **Gemini 2.5 Flash Audio (Aoede)** | `gemini-2.5-flash` | Natural spoken assistant audio (WAV output) | Low |

---

## 2. Feature-to-Capability Routing Map

| Application Feature | Route / Endpoint | Target Capability Family | Fallback Mechanism |
| :--- | :--- | :--- | :--- |
| **AWG Visual Abstract Gallery** | `POST /api/awg/image-set` | `nano-banana-2-lite` | Procedural SVG Vector Engine (Data Viz, Bio Mechanism, Narrative, Accession Summary) |
| **Scientific Motion Briefs** | `POST /api/awg/video` | `veo-3-lite-generate-preview` | 60fps Procedural Canvas Motion Animator (`scientific_motion_brief`) |
| **AWG Meme Clips** | `POST /api/awg/meme` | `veo-3-lite-generate-preview` | Local Metadata-Grounded Conceptual Motion Preview |
| **Relatable Translational Clips** | `POST /api/awg/translational-clip` | `veo-3-lite-generate-preview` | Procedural Canvas Cinematic Engine (`local_conceptual_clip`) |
| **Spoken Response Audio** | `POST /api/tts` | `gemini-2.5-flash-tts` | OpenAI TTS (`tts-1` / `alloy`) -> Graceful UI fallback |
| **Repository UI Inspector** | `POST /api/computer-use` | `computer-use-preview` | Local Structured Schema Extractor |

---

## 3. Rate-Limit & Quota Guardrails

### Video Quota Protection (Veo Family)
- **Live Google AI Studio Tier Quotas**: 2 RPM / 10 RPD.
- **Circuit Breaker**: Trips for 5 minutes (300 seconds) upon receiving HTTP 429 (`RESOURCE_EXHAUSTED`).
- **Cooldown Spacing**: Enforces 20-second per-pair and 15-second per-session request spacing.
- **Immediate Fallback Caching**: Bypasses network provider invocation during active circuit breaker and serves cached canvas animations in <2ms.

### Computer Use Preview Guardrails
- **Project Quotas**: 150 RPM, 2M TPM, 10,000 RPD.
- **Domain Allowlist Policy**: Operations are strictly restricted to verified domains (`osdr.nasa.gov`, `nasa.gov`, `genelab-data.ndc.nasa.gov`, `ncbi.nlm.nih.gov`, `github.com`, `localhost`).
- **Step Limit**: Maximum 5 discrete steps per execution.
- **Timeout**: 20-second hard execution deadline.
- **Cooldown**: 3-second session throttle.
- **User-Triggered**: All Computer Use tasks require explicit user initiation from the Research / Dev Panel.

---

## 4. Programmatic API Reference

```ts
import {
  getPreferredImageModel,
  getPreferredVideoModel,
  getPreferredComputerUseModel,
  resolveBestModelForTask,
  getCapabilityLabelMap
} from "./server/modelCapabilities";

// 1. Resolve default balanced image model
const imageCap = getPreferredImageModel({ preference: "balanced" });
// -> Nano Banana 2 Lite — Gemini 3.1 Flash Lite Image

// 2. Resolve lowest-quota video model
const videoCap = getPreferredVideoModel({ preference: "lowest_quota" });
// -> Veo 3 Lite Generate (veo-3.1-lite-generate-preview)

// 3. Resolve Computer Use model
const cuCap = getPreferredComputerUseModel();
// -> Computer Use Preview (gemini-2.5-flash)
```
