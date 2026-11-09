# Gemini Capability Registry & Router Reference

This document outlines the centralized capability routing architecture, normalized model families, and operational guardrails in `server/modelCapabilities.ts` for the **NASA OSDR ChatBot & AWG Evidence Engine**.

---

## 1. Centralized Capability Families

| Capability Group | Canonical ID | User-Facing Display Label | API Model ID | Default Use Case | Quota Sensitivity |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Text / Reasoning** | `gemini-4-argon` | **Gemini 4 Argon — Frontier Reasoning Flagship** | `gemini-4-argon` | Default flagship frontier reasoning, deep AWG synthesis, 1M-token context analysis | Medium |
| **Text** | `gemini-3.7-flash` | **Gemini 3.7 Flash — Primary Reasoning Engine** | `gemini-3.7-flash` | High-speed analytical reasoning, RAG synthesis & streaming fallback | Low |
| **Text** | `gemini-2.5-flash` | **Gemini 2.5 Flash — Fast Synthesis & Routing** | `gemini-2.5-flash` | Low-latency JSON formatting, plan parsing & fallback chat | Low |
| **Image** | `nano-banana-2-lite` | **Nano Banana 2 Lite — Gemini 3.1 Flash Lite Image** | `gemini-3.1-flash-lite-image` | Primary balanced default for AWG 4-image visual abstract sets | Low |
| **Image** | `nano-banana` | **Nano Banana — Gemini 2.5 Flash Preview Image** | `gemini-2.5-flash-preview-image` | Fast conceptual illustrations | Low |
| **Image** | `nano-banana-2` | **Nano Banana 2 — Gemini 3.1 Flash Image** | `gemini-3.1-flash-image` | High-fidelity comparative figures | Medium |
| **Image** | `nano-banana-pro` | **Nano Banana Pro — Gemini 3 Pro Image** | `gemini-3-pro-image` | Complex multi-panel ultrastructure figures | High |
| **Video** | `veo-3-lite-generate-preview` | **Veo 3 Lite Generate** | `veo-3.1-lite-generate-preview` | Default video briefs and AWG meme clips | **High** (2 RPM / 10 RPD) |
| **Video** | `veo-3-fast-generate` | **Veo 3 Fast Generate** | `veo-3.0-fast-generate-001` | Rapid kinetic fluid-dynamic briefs | High |
| **Video** | `veo-3-generate` | **Veo 3 Generate** | `veo-3.0-generate-001` | Maximum-fidelity 1080p outreach renders | High |
| **Computer Use** | `computer-use-preview` | **Computer Use Preview** | `gemini-2.5-flash` | Guarded OSDR UI inspection & structured metadata extraction | Medium (150 RPM / 10K RPD) |
| **TTS** | `gemini-2.5-flash-tts` | **Gemini 2.5 Flash Audio — Multimodal Speech Engine** | `gemini-2.5-flash` | Natural spoken assistant audio (`Aoede` voice, WAV output) | Low |

---

## 2. Feature-to-Capability Routing Map

| Application Feature | Route / Endpoint | Target Capability Family | Fallback Mechanism |
| :--- | :--- | :--- | :--- |
| **Main Chat & AWG Synthesis** | `POST /api/chat` | `gemini-4-argon` | Multi-provider cascade (`gemini-3.7-flash` -> `gemini-2.5-flash` -> OpenRouter -> Groq -> Local Deterministic Engine) |
| **AWG Visual Abstract Gallery** | `POST /api/awg/media-set` | `nano-banana-2-lite` | Procedural SVG Vector Engine (Data Viz, Histology, Narrative, Accession Profile) |
| **Scientific Motion Briefs** | `POST /api/awg/video` | `veo-3-lite-generate-preview` | 60fps Procedural Canvas Motion Animator (`procedural-canvas-animator-v1`) |
| **AWG Meme Clips** | `POST /api/awg/meme` | `veo-3-lite-generate-preview` | Local Metadata-Grounded Conceptual Motion Preview |
| **Relatable Translational Clips** | `POST /api/awg/translational-clip` | `veo-3-lite-generate-preview` | 60fps Procedural Canvas Cinematic Engine (`procedural-canvas-cinematic-v1`) |
| **Spoken Response Audio** | `POST /api/tts` | `gemini-2.5-flash-tts` | OpenAI TTS (`tts-1` / `alloy`) -> Graceful UI error badge |
| **Repository UI Inspector** | `POST /api/computer-use` | `computer-use-preview` | Scoped Local Structured Schema Extractor |

---

## 3. Rate-Limit & Quota Guardrails

### Video Quota Protection (Veo Family)
- **Live Google AI Studio Tier Quotas**: `2 RPM` / `10 RPD`.
- **Circuit Breaker**: Trips for 5 minutes (`300s`) upon receiving HTTP 429 (`RESOURCE_EXHAUSTED`).
- **Cooldown Spacing**: Enforces `20s` per-pair and `15s` per-session request spacing.
- **Immediate Fallback Caching**: Bypasses network provider invocation during an active circuit breaker and serves cached canvas animations in `<2ms`.

### Computer Use Preview Guardrails
- **Domain Allowlist Policy**: Strictly restricted to verified domains (`osdr.nasa.gov`, `nasa.gov`, `genelab-data.ndc.nasa.gov`, `ncbi.nlm.nih.gov`, `github.com`, `localhost`).
- **Execution Limits**: Maximum 5 steps per execution, `20s` timeout, `3s` session cooldown.
- **Explicit Trigger**: All Computer Use tasks require explicit user initiation from the top navigation panel.

---

## 4. Programmatic API Reference

```ts
import {
  getPreferredImageModel,
  getPreferredVideoModel,
  getPreferredComputerUseModel,
  resolveBestModelForTask,
} from "./server/modelCapabilities";

const reasoningCap = resolveBestModelForTask("reasoning");
// -> Gemini 4 Argon — Frontier Reasoning Flagship (1,048,576 token context)

const imageCap = getPreferredImageModel({ preference: "balanced" });
// -> Nano Banana 2 Lite — Gemini 3.1 Flash Lite Image

const videoCap = getPreferredVideoModel({ preference: "lowest_quota" });
// -> Veo 3 Lite Generate (veo-3.1-lite-generate-preview)

const cuCap = getPreferredComputerUseModel();
// -> Computer Use Preview (gemini-2.5-flash)
```
