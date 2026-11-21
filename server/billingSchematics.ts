import { detectEnvironment } from "./modelDiscovery";
import { getMultiProviderDiagnostics } from "./textProviders";
import { getMediaConfigStatus } from "./mediaGen";
import { getAuthDiagnosticsStatus } from "./auth";

export interface BillingLineItem {
  id: string;
  component: string;
  cloudOrProvider: string;
  activeTierLabel: string;
  currentMonthlyBillUsd: number;
  formattedBill: string;
  notes: string;
}

export interface ScalingTierProposal {
  id: string;
  phase: string;
  title: string;
  targetScale: string;
  estimatedMonthlyRangeUsd: string;
  hostingTarget: string;
  modelsUnlocked: string[];
  lineItems: Array<{
    item: string;
    estimate: string;
    detail: string;
  }>;
  automatedCostControls: string[];
}

export interface AdminBillingSchematics {
  generatedAt: string;
  adminOnlyDisclaimer: string;
  currentBuildSummary: {
    currentMonthlyBillUsd: number;
    formattedCurrentBill: string;
    billingMode: "free_tier_and_openrouter_cascade";
    hostingCloud: string;
    aiProviderCloud: string;
    cronAutomationCloud: string;
    gcpCloudRunReady: boolean;
  };
  currentBuildLineItems: BillingLineItem[];
  scalingProposals: ScalingTierProposal[];
  proposalMarkdown: string;
}

export const ADMIN_FREE_TIER_DISCLAIMER =
  "ADMIN & TEAM LEAD NOTICE: All models in this build operate strictly on free-tier usage (Google AI Studio Free Tier, Groq Free Tier, and Local Deterministic RAG) or OpenRouter (:free tier prioritized cascade with empty-callback protection). Current build cloud and API bill: $0.00 / month.";

export function getAdminBillingSchematics(): AdminBillingSchematics {
  const { env, isVercel } = detectEnvironment();
  const providerDiag = getMultiProviderDiagnostics();
  const mediaCfg = getMediaConfigStatus();
  const authDiag = getAuthDiagnosticsStatus();

  const currentBuildLineItems: BillingLineItem[] = [
    {
      id: "hosting-vercel",
      component: "Frontend Edge CDN & Serverless Express API (api/serverless.js)",
      cloudOrProvider: isVercel ? "Vercel (Active Production)" : `Vercel + Local (${env})`,
      activeTierLabel: "Vercel Hobby / Free Tier",
      currentMonthlyBillUsd: 0,
      formattedBill: "$0.00 / mo",
      notes: "Serves Vite SPA (dist/) and Node ESM serverless function (/api/*); auto-detects GCP Cloud Run (K_SERVICE) if containerized.",
    },
    {
      id: "ai-gemini-free",
      component: "Primary Text & Multi-Omics Reasoning (Gemini 4 Argon / 3.7 Flash / 2.5 Flash)",
      cloudOrProvider: "Google Cloud / Google AI Studio (@google/genai)",
      activeTierLabel: providerDiag.providers.gemini.configured
        ? "AI Studio Free Tier (RPM/RPD Quota)"
        : "Zero-Key Local Fallback Active",
      currentMonthlyBillUsd: 0,
      formattedBill: "$0.00 / mo",
      notes: "Cascades across gemini-3.7-flash and gemini-2.5-flash on 429 or empty stream callbacks before falling back to OpenRouter.",
    },
    {
      id: "ai-openrouter-free",
      component: "Secondary Text Fallback Cascade (Llama 3.3 70B Instruct)",
      cloudOrProvider: "OpenRouter API",
      activeTierLabel: providerDiag.providers.openrouter.configured
        ? "OpenRouter :free Tier Priority"
        : "Standby (:free Tier Priority)",
      currentMonthlyBillUsd: 0,
      formattedBill: "$0.00 / mo",
      notes: "Prioritizes meta-llama/llama-3.3-70b-instruct:free and guards against 0-token empty callbacks.",
    },
    {
      id: "ai-groq-local",
      component: "Tertiary Fast Inference & Offline Deterministic RAG Engine",
      cloudOrProvider: "Groq Cloud + In-Memory OSDR Synthesis",
      activeTierLabel: "Groq Free Tier + Local RAG (local-rag-v1)",
      currentMonthlyBillUsd: 0,
      formattedBill: "$0.00 / mo",
      notes: "Guarantees 100% uptime and citation-grounded responses at $0.00 cost even when all external LLM quotas are exhausted.",
    },
    {
      id: "media-tts-free",
      component: "4-Panel Visual Gallery, 5s Motion Briefs, Translational Clips & TTS",
      cloudOrProvider: "Procedural SVG/Canvas Engine + Optional AI Studio Free Tier",
      activeTierLabel: mediaCfg.geminiVideoConfigured
        ? "Veo Quota Circuit-Breaker Gated"
        : "Zero-Cost Procedural SVG & 60fps HTML5 Canvas",
      currentMonthlyBillUsd: 0,
      formattedBill: "$0.00 / mo",
      notes: "Uses deterministic SVG infographics, 60fps canvas motion briefs, and per-pair cooldown circuit breakers to prevent runaway media charges.",
    },
    {
      id: "auth-firebase-spark",
      component: "Researcher Login (/account) & Admin Perimeter (/admin)",
      cloudOrProvider: "Google Firebase Authentication (Spark Plan) + Node Crypto",
      activeTierLabel: authDiag.firebaseClientConfigured
        ? "Firebase Spark Free Tier (50,000 MAUs)"
        : "Ready for .env Keys ($0 Spark Tier)",
      currentMonthlyBillUsd: 0,
      formattedBill: "$0.00 / mo",
      notes: "Verifies RS256 ID tokens via Google public X.509 certs and signs HttpOnly HMAC admin cookies with zero database or Admin SDK runtime fees.",
    },
    {
      id: "radar-cron-apis",
      component: "8-Hour Release Radar Monitor & Scientific Literature Collectors",
      cloudOrProvider: "GitHub Actions + NASA OSDR / NTRS / ORCID / OpenAlex / PubMed",
      activeTierLabel: "Public Repo Free Actions + Open Science REST APIs",
      currentMonthlyBillUsd: 0,
      formattedBill: "$0.00 / mo",
      notes: "Runs every 8 hours (0 */8 * * *) to index Ryan T. Scott & 9 AWG Chair publications and dispatch HMAC-signed webhooks.",
    },
  ];

  const scalingProposals: ScalingTierProposal[] = [
    {
      id: "phase-1-free-build",
      phase: "Phase 1 (Current Active Build)",
      title: "Zero-Bill Free-Tier & OpenRouter :free Architecture",
      targetScale: "1–30 active AWG researchers & community reviewers",
      estimatedMonthlyRangeUsd: "$0.00 / month",
      hostingTarget: "Vercel Hobby Serverless + GitHub Actions 8h Cron",
      modelsUnlocked: [
        "gemini-3.7-flash (AI Studio Free Tier)",
        "gemini-2.5-flash (AI Studio Free Tier)",
        "meta-llama/llama-3.3-70b-instruct:free (OpenRouter)",
        "llama-3.3-70b-versatile (Groq Free Tier)",
        "local-rag-v1 + Procedural SVG/Canvas Media",
      ],
      lineItems: [
        {
          item: "Vercel Hobby + GitHub Actions Cron + Firebase Spark Auth",
          estimate: "$0.00 / mo",
          detail: "Included within free tier allowances (100 GB-hrs serverless, 50k Firebase MAUs).",
        },
        {
          item: "Google AI Studio Free Tier + OpenRouter :free Cascade",
          estimate: "$0.00 / mo",
          detail: "Empty-callback detection cascades across free Gemini Flash tiers before OpenRouter :free.",
        },
      ],
      automatedCostControls: [
        "OPENROUTER_FREE_TIER_FIRST=true (tries :free endpoints first)",
        "Empty-stream callback guard (0-token streams retry free Gemini tiers first)",
        "Procedural SVG/Canvas fallback when image/video quotas are absent or exhausted",
      ],
    },
    {
      id: "phase-2-awg-production",
      phase: "Phase 2 (AWG Subgroup Production Proposal)",
      title: "Sustained Multi-Omics Reasoning & Live Visual Gallery Scale",
      targetScale: "30–150 researchers across AIML, Animal, Plant, Multi-Omics & SANS AWGs",
      estimatedMonthlyRangeUsd: "$45 – $95 / month",
      hostingTarget: "Vercel Pro ($20/mo) or GCP Cloud Run ($12–$18/mo)",
      modelsUnlocked: [
        "gemini-4-argon (1M Context Cross-Mission Reasoning)",
        "gemini-3.7-flash & gemini-3.1-pro-preview (Pay-As-You-Go High RPM)",
        "OpenRouter Paid Fallback Pool (Llama-3.3-70B / DeepSeek-R1 / Claude)",
        "Imagen 3 / Gemini Flash Image (4-Panel Grounded Visual Galleries)",
        "Gemini & OpenAI Neural TTS Briefings",
      ],
      lineItems: [
        {
          item: "Compute & Streaming Infrastructure (Vercel Pro or GCP Cloud Run)",
          estimate: "$15 – $20 / mo",
          detail: "Unlocks 60s–300s long-context SSE reasoning timeouts and dedicated concurrency.",
        },
        {
          item: "Gemini API Pay-As-You-Go + OpenRouter Top-Up Credits",
          estimate: "$20 – $50 / mo",
          detail: "Covers ~3,000–5,000 multi-study RAG & schema-contract comparisons per month.",
        },
        {
          item: "Live 4-Panel Imagen Visual Abstracts & Neural TTS",
          estimate: "$10 – $20 / mo",
          detail: "Covers ~300–500 generated 4-part study galleries and audio briefings per month.",
        },
        {
          item: "Firebase Blaze / Cloud Firestore Usage Ledger",
          estimate: "$0 – $5 / mo",
          detail: "Persists researcher workspaces, saved evidence bundles, and daily per-user token counters.",
        },
      ],
      automatedCostControls: [
        "Firebase Auth Role Gating: Guests remain on $0 free tier; signed-in AWG members unlock Phase 2 models",
        "Capped thinkingBudget (4,096 tokens) on standard queries; full 1M reasoning reserved for /awg compare",
        "Hard $25/mo OpenRouter credit cap + GCP Billing Alert at 50% / 80% / 100%",
      ],
    },
    {
      id: "phase-3-full-multimodal-lab",
      phase: "Phase 3 (Full Multi-Modal & Veo Motion Lab Proposal)",
      title: "Enterprise Space-Bio Digital Twin & Live Veo Video Synthesis",
      targetScale: "150–500+ users, live conference workshops & automated cross-mission audits",
      estimatedMonthlyRangeUsd: "$250 – $550 / month",
      hostingTarget: "GCP Cloud Run + Vertex AI / Google Cloud Billing Project",
      modelsUnlocked: [
        "Full Gemini 4 Argon 1M Unified Context + Deep Thinking",
        "Veo Video Generation (veo-2.0 / veo-3.1-lite 5s Motion Briefs & Translational Clips)",
        "Gemini Computer Use Preview (Live Headless Browser OSDR Portal Inspection)",
        "Multi-Provider High-Throughput Batch Evaluation",
      ],
      lineItems: [
        {
          item: "GCP Cloud Run Autoscaling + Firestore + Cloud Storage",
          estimate: "$35 – $70 / mo",
          detail: "Dedicated container instances with cached media artifacts and persistent audit logs.",
        },
        {
          item: "Gemini 4 Argon 1M Context & Computer Use API",
          estimate: "$115 – $230 / mo",
          detail: "High-throughput cross-mission transcriptomic & spatial matrix synthesis (OSD-255 × OSD-758 × OSD-685).",
        },
        {
          item: "Live Veo Video Generation (Study Briefs, Translational & Outreach Clips)",
          estimate: "$100 – $250 / mo",
          detail: "Gated by SHA-256 content caching, 20s per-pair cooldown, and 300s 429 circuit breaker.",
        },
      ],
      automatedCostControls: [
        "In-App Daily USD Circuit Breaker (DAILY_MAX_COST_USD auto-switches to $0 free tier when reached)",
        "Admin-Only & Team-Lead Gating for live Veo MP4 generation and Computer Use runs",
        "GCP Pub/Sub Billing Webhook to automatically disable paid media endpoints at monthly ceiling",
      ],
    },
  ];

  const proposalMarkdown = [
    "### NASA OSDR ChatBot — Cloud Architecture, Current $0.00 Bill & Future Scaling Proposal",
    "",
    `> **${ADMIN_FREE_TIER_DISCLAIMER}**`,
    "",
    "#### 1. Current Build Cloud & API Bill ($0.00 / Month)",
    "- **Compute & Hosting:** Vercel Hobby Serverless (`api/serverless.js`) + Static Vite Edge CDN (`$0.00/mo`) — GCP Cloud Run compatible.",
    "- **8-Hour Release Radar Automation:** GitHub Actions Cron (`0 */8 * * *`) + NASA OSDR / NTRS / ORCID / OpenAlex / PubMed REST APIs (`$0.00/mo`).",
    "- **Authentication & Admin Security:** Firebase Authentication Spark Free Tier (50k MAUs) + pure Node `crypto` RS256 & `HttpOnly` HMAC sessions (`$0.00/mo`).",
    "- **Model Cascade:** Google AI Studio Free Tier (`gemini-3.7-flash`, `gemini-2.5-flash`) -> OpenRouter `:free` (`meta-llama/llama-3.3-70b-instruct:free`) -> Groq Free Tier -> Local Deterministic RAG (`$0.00/mo`).",
    "",
    "#### 2. Proposed Future Scaling Tiers (AWG Team Lead Budget Guide)",
    "| Scaling Phase | Target AWG Scale | Est. Monthly Bill | Unlocked Models & Infrastructure | Automated Cost Guardrails |",
    "| :--- | :--- | :--- | :--- | :--- |",
    "| **Phase 1 (Current Build)** | 1–30 active users | **$0.00 / mo** | AI Studio Free Tier + OpenRouter `:free` + Groq Free + Procedural SVG/Canvas Media | Empty-callback cascade guard, `OPENROUTER_FREE_TIER_FIRST=true` |",
    "| **Phase 2 (AWG Subgroup Production)** | 30–150 researchers | **$45 – $95 / mo** | Vercel Pro or GCP Cloud Run + sustained `gemini-4-argon` (1M context) + Imagen 3 4-panel galleries + Neural TTS + Firestore | Firebase Auth role gating (Guests on `$0` tier; signed-in AWG members on Phase 2) + `$25` OpenRouter cap |",
    "| **Phase 3 (Full Multi-Modal & Veo Lab)** | 150–500+ users / workshops | **$250 – $550 / mo** | GCP Cloud Run + Vertex AI + Live Veo Video (`veo-2.0`/`veo-3.1-lite`) + Gemini Computer Use | Daily USD circuit breaker (`DAILY_MAX_COST_USD`), SHA-256 media cache, GCP Pub/Sub budget cutoff |",
  ].join("\n");

  return {
    generatedAt: new Date().toISOString(),
    adminOnlyDisclaimer: ADMIN_FREE_TIER_DISCLAIMER,
    currentBuildSummary: {
      currentMonthlyBillUsd: 0,
      formattedCurrentBill: "$0.00 / month",
      billingMode: "free_tier_and_openrouter_cascade",
      hostingCloud: isVercel
        ? "Vercel Serverless + Edge CDN (Production)"
        : "Vercel Serverless (Production) + Local Express/Vite Dev",
      aiProviderCloud:
        "Google Cloud / AI Studio (Free Tier) -> OpenRouter (:free) -> Groq (Free Tier) -> Local RAG",
      cronAutomationCloud: "GitHub Actions (Every 8h Cron: 0 */8 * * *)",
      gcpCloudRunReady: true,
    },
    currentBuildLineItems,
    scalingProposals,
    proposalMarkdown,
  };
}
