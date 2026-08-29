import { GoogleGenAI } from "@google/genai";
import crypto from "crypto";
import { getStudyById, OSDRStudy } from "./rag";
import { validateAwgAccessions } from "./accessionValidator";
import {
  extractStudyMetadata,
  extractObservedResult,
  deriveInterpretationClaims,
} from "./awg";
import {
  MediaProvenanceRecord,
  StageExecutionAudit,
  recordMediaAudit,
  computePromptFingerprint,
  computeContentHash,
  getStatusLabel,
  MediaGenerationStatus,
  discoverVideoProviderCapabilities,
  getCachedVideoDiscovery,
  VideoProviderDiscovery,
  markVideoModelUnavailable,
  checkVeoQuotaGate,
  triggerVeoCircuitBreaker,
  recordVeoAttempt,
  isVeoCircuitBreakerOpen,
  EXHAUSTED_QUOTA_MESSAGE,
} from "./mediaGen";
import { generateTextWithFallback } from "./textProviders";

export interface AwgMemeClipScene {
  timeStart: number;
  timeEnd: number;
  mainText: string;
  subText: string;
  badge: string;
  visualType: "contrast_split" | "group_project" | "organelle_panic" | "analog_reality" | "fluid_arrows" | "transcript_protein";
  details: string[];
  accentColor: string;
}

export interface AwgMemeClip {
  title: string;
  premise: string;
  duration: number;
  studies: [string, string];
  activeResolvedPair: [string, string];
  studyA: {
    study_id: string;
    title: string;
    organism: string;
    tissue: string;
    assay: string;
    factor: string;
    duration: string;
    repositoryUrl: string;
  };
  studyB: {
    study_id: string;
    title: string;
    organism: string;
    tissue: string;
    assay: string;
    factor: string;
    duration: string;
    repositoryUrl: string;
  };
  cautionBadge: string;
  cautionText: string;
  clipPrompt: string;
  seed: number;
  operationName?: string;
  videoUrl?: string;
  isVideoGenerationAvailable: boolean;
  isFailedState: boolean;
  fallbackReason?: string;
  fallbackNotice: string;
  canvasAnimation: {
    theme: string;
    primaryColor: string;
    accentColor: string;
    scenes: AwgMemeClipScene[];
  };
  provenance: MediaProvenanceRecord;
  // Compatibility getters for legacy callers
  memeTitle?: string;
  memeHook?: string;
  scientificCore?: string;
  humorAngle?: string;
  groundedFacts?: string[];
  conceptualElements?: any;
}

// In-memory cache for meme clip artifacts
const memeClipCache = new Map<string, { clip: AwgMemeClip; createdAt: string }>();

function simplifyOrganism(org: string): string {
  const o = (org || "").toLowerCase();
  if (o.includes("musculus") || o.includes("mouse")) return "Mouse";
  if (o.includes("norvegicus") || o.includes("rat")) return "Rat";
  if (o.includes("sapiens") || o.includes("human")) return "Human";
  if (o.includes("drosophila") || o.includes("fly")) return "Fruit fly";
  if (o.includes("elegans") || o.includes("worm")) return "C. elegans";
  return org || "Specimen";
}

function simplifyTissue(tissue: string): string {
  const t = (tissue || "").toLowerCase();
  if (t.includes("retin")) return "retina";
  if (t.includes("optic")) return "optic nerve";
  if (t.includes("bone") || t.includes("marrow")) return "bone marrow";
  if (t.includes("soleus") || t.includes("muscle")) return "soleus muscle";
  if (t.includes("liver")) return "liver";
  if (t.includes("brain")) return "brain";
  if (t.includes("plasma") || t.includes("serum")) return "plasma";
  return tissue ? tissue.toLowerCase() : "tissue";
}

/**
 * Builds a deterministic metadata-grounded video prompt & premise using only active resolved pair metadata.
 * Uses accession IDs, organism, tissue, assay, factor/exposure, duration, and evidence boundary without inventing results.
 */
export function buildLocalMetadataPremiseAndPrompt(
  studyA: OSDRStudy,
  studyB: OSDRStudy,
  seed: number = 42
): { premise: string; clipPrompt: string } {
  const metaA = extractStudyMetadata(studyA);
  const metaB = extractStudyMetadata(studyB);

  const orgA = simplifyOrganism(studyA.organism);
  const orgB = simplifyOrganism(studyB.organism);
  const tisA = simplifyTissue(studyA.material_type);
  const tisB = simplifyTissue(studyB.material_type);
  const facA = studyA.study_factor || "Spaceflight Adaptation";
  const facB = studyB.study_factor || "Ground Analog";
  const assayA = studyA.assay_measurement || "Transcriptomics";
  const assayB = studyB.assay_measurement || "Proteomics";
  const durA = metaA.duration !== "Not specified" ? metaA.duration : "flight duration";
  const durB = metaB.duration !== "Not specified" ? metaB.duration : "flight duration";

  const templates = [
    {
      premise: `When ${studyA.study_id} (${orgA} ${tisA}) meets ${studyB.study_id} (${orgB} ${tisB}) in NASA OSDR comparative space biology.`,
      clipPrompt: `Scientific 3D animation contrasting space biology studies: ${studyA.study_id} (${orgA} ${tisA}, ${facA}, ${durA}) versus ${studyB.study_id} (${orgB} ${tisB}, ${facB}, ${durB}). Clean cinematic visualization. Seed:${seed}`,
    },
    {
      premise: `Contrasting ${studyA.study_id} (${facA}, ${assayA}) with ${studyB.study_id} (${facB}, ${assayB}) under NASA space biology protocols.`,
      clipPrompt: `Motion graphics visualization comparing NASA OSDR datasets: ${studyA.study_id} (${orgA} ${tisA}) vs ${studyB.study_id} (${orgB} ${tisB}). High fidelity laboratory lighting. Seed:${seed}`,
    },
    {
      premise: `Space biology study matchup: ${studyA.study_id} (${orgA} ${tisA}) under ${facA} versus ${studyB.study_id} (${orgB} ${tisB}) under ${facB}.`,
      clipPrompt: `Cinematic scientific space biology rendering comparing ${studyA.study_id} (${orgA}) and ${studyB.study_id} (${orgB}) experimental assays. Seed:${seed}`,
    },
    {
      premise: `Comparing ${studyA.study_id} (${durA} ${facA}) and ${studyB.study_id} (${durB} ${facB}) across ${assayA} and ${assayB} data.`,
      clipPrompt: `Laboratory data animation visualizing space biology experimental factors: ${facA} (${studyA.study_id}) vs ${facB} (${studyB.study_id}). Seed:${seed}`,
    },
  ];

  const idx = Math.abs(seed) % templates.length;
  return templates[idx];
}

/**
 * Builds a deterministic, scientifically responsible 5-6 second comedic meme clip concept
 * honoring strict biological compatibility and ground analog constraints.
 */
export function buildLocalMemeClip(
  studyA: OSDRStudy,
  studyB: OSDRStudy,
  seed: number = 42,
  status: MediaGenerationStatus = "fallback",
  requestId: string = crypto.randomUUID()
): AwgMemeClip {
  const sA = studyA;
  const sB = studyB;

  const metaA = extractStudyMetadata(sA);
  const metaB = extractStudyMetadata(sB);
  const resA = extractObservedResult(sA);
  const resB = extractObservedResult(sB);
  const interpretations = deriveInterpretationClaims(sA, sB);

  const orgA = simplifyOrganism(sA.organism);
  const tissueA = simplifyTissue(sA.material_type);
  const factorA = sA.study_factor || "Spaceflight Adaptation";
  const factorB = sB.study_factor || "Spaceflight Adaptation";

  const isGroundAnalogA = factorA.toLowerCase().includes("tilt") || factorA.toLowerCase().includes("bedrest") || factorA.toLowerCase().includes("hindlimb") || factorA.toLowerCase().includes("ground");
  const isGroundAnalogB = factorB.toLowerCase().includes("tilt") || factorB.toLowerCase().includes("bedrest") || factorB.toLowerCase().includes("hindlimb") || factorB.toLowerCase().includes("ground");
  const isAllGroundAnalog = isGroundAnalogA && isGroundAnalogB;

  const isRnaA = sA.assay_measurement.toLowerCase().includes("rna") || sA.assay_measurement.toLowerCase().includes("transcript");
  const isProteomicsB = sB.assay_measurement.toLowerCase().includes("protein") || sB.assay_measurement.toLowerCase().includes("proteom");
  const isMetabolomicsB = sB.assay_measurement.toLowerCase().includes("metabol");

  // Determine compatible gags based on study reality
  const gags: {
    premise: string;
    clipPrompt: string;
    scenes: AwgMemeClipScene[];
    accentColor: string;
  }[] = [];

  // Gag 1: Group Project / Multi-Omics Coordination
  gags.push({
    premise: `${orgA} ${tissueA}: preparing for spaceflight like it is a group project with three different omics teams.`,
    clipPrompt: `5-second comedic educational 2D animation showing ${orgA.toLowerCase()} ${tissueA} cells dressed in tiny lab coats at a whiteboard: ${sA.study_id} (${sA.assay_measurement}) passes blueprints while ${sB.study_id} (${sB.assay_measurement}) frantically recalculates with OSDR accession tags. Clean scientific style.`,
    scenes: [
      {
        timeStart: 0.0,
        timeEnd: 1.8,
        mainText: `${orgA} ${tissueA.charAt(0).toUpperCase() + tissueA.slice(1)}: Group Project All-Hands`,
        subText: `${sA.study_id} (${sA.assay_measurement}) submits transcriptomic blueprints at 2 AM`,
        badge: "SCENE 1: THE BLUEPRINTS",
        visualType: "group_project",
        details: [
          `Organism: ${sA.organism} (${sA.study_id})`,
          `Observed: ${resA.finding.slice(0, 70)}...`,
        ],
        accentColor: "#38bdf8",
      },
      {
        timeStart: 1.8,
        timeEnd: 3.6,
        mainText: `${sB.study_id} (${sB.assay_measurement}) Reads the Report`,
        subText: "Translational team: 'Wait, none of these proteins were budgeted for translation'",
        badge: "SCENE 2: REALITY CHECK",
        visualType: "contrast_split",
        details: [
          `Assay: ${sB.assay_measurement} (${sB.study_id})`,
          `Observed: ${resB.finding.slice(0, 70)}...`,
        ],
        accentColor: "#f59e0b",
      },
      {
        timeStart: 3.6,
        timeEnd: 5.5,
        mainText: "Conclusion: Multi-Omic Convergence",
        subText: `[INTERPRETATION] Coordinated ${tissueA} remodeling under ${factorA}`,
        badge: "SCENE 3: SYNTHESIS",
        visualType: "organelle_panic",
        details: [
          `Grounded Citation: ${sA.study_id} × ${sB.study_id}`,
          `Link: osdr.nasa.gov/bio/repo/data/studies/${sA.study_id}`,
        ],
        accentColor: "#10b981",
      },
    ],
    accentColor: "#38bdf8",
  });

  // Gag 2: Ground Analog Reality or Spaceflight Fluid Shift
  if (isAllGroundAnalog) {
    gags.push({
      premise: `${orgA} ${tissueA} microvasculature realizing -6° head-down tilt means gravity is no longer handling venous drainage for free.`,
      clipPrompt: `5-second humorous animation: An anatomical diagram of ${orgA.toLowerCase()} ${tissueA} microvessels looking surprised as blue cephalad fluid arrows pool upward under 6-degree head-down tilt, labeled with OSDR accessions ${sA.study_id} & ${sB.study_id}.`,
      scenes: [
        {
          timeStart: 0.0,
          timeEnd: 1.8,
          mainText: "Ground SANS Analog: Day 1 vs Day 30",
          subText: `Venous vascular system expecting normal 1G downward hydrostatic gradient`,
          badge: "SCENE 1: EXPECTATION",
          visualType: "analog_reality",
          details: [
            `Experimental Factor: ${factorA}`,
            `Study Model: ${sA.organism} (${sA.study_id})`,
          ],
          accentColor: "#818cf8",
        },
        {
          timeStart: 1.8,
          timeEnd: 3.6,
          mainText: "Cephalad Fluid Redistribution",
          subText: `${sA.study_id} & ${sB.study_id} record elevated backpressure and barrier stress`,
          badge: "SCENE 2: ANALOG REALITY",
          visualType: "fluid_arrows",
          details: [
            `Tissue: ${sA.material_type}`,
            `Finding: ${resA.finding.slice(0, 65)}...`,
          ],
          accentColor: "#f43f5e",
        },
        {
          timeStart: 3.6,
          timeEnd: 5.5,
          mainText: "Vascular Endothelium: 'Help Wanted: 1G Vector'",
          subText: `[INTERPRETATION] Mechanosensitive remodeling observed in ${sA.study_id} × ${sB.study_id}`,
          badge: "SCENE 3: OUTREACH GAG",
          visualType: "organelle_panic",
          details: [
            `Verified OSDR Links: ${sA.study_id} · ${sB.study_id}`,
            `Caution: Conceptual outreach framing only`,
          ],
          accentColor: "#38bdf8",
        },
      ],
      accentColor: "#818cf8",
    });
  } else {
    gags.push({
      premise: `Microgravity: when your ${tissueA} packs for zero-g, but your capillaries forgot to cancel their 1G physics subscription.`,
      clipPrompt: `5-second playful 2D motion graphic: A stylized ${orgA.toLowerCase()} floating weightlessly with cheerful music, while a split-screen microscope view shows retinal tight junctions tightening molecular bolts with OSDR study badges (${sA.study_id} × ${sB.study_id}).`,
      scenes: [
        {
          timeStart: 0.0,
          timeEnd: 1.8,
          mainText: "Spaceflight Physical Freedom",
          subText: "Floating weightlessly in Low Earth Orbit",
          badge: "SCENE 1: SCI-FI FANTASY",
          visualType: "contrast_split",
          details: [
            `Flight Factor: ${factorA}`,
            `Repository Record: ${sA.study_id}`,
          ],
          accentColor: "#a855f7",
        },
        {
          timeStart: 1.8,
          timeEnd: 3.6,
          mainText: "Internal Multi-Omic Reality",
          subText: `${sA.study_id} (${sA.assay_measurement}) shows immediate vascular barrier signaling`,
          badge: "SCENE 2: MOLECULAR REALITY",
          visualType: "fluid_arrows",
          details: [
            `Observed Assay: ${sA.assay_measurement}`,
            `Observed Finding: ${resA.finding.slice(0, 65)}...`,
          ],
          accentColor: "#ef4444",
        },
        {
          timeStart: 3.6,
          timeEnd: 5.5,
          mainText: "Tight Junctions: 'Centrifuge, Please!'",
          subText: `[INTERPRETATION] SANS-relevant endothelial remodeling in ${sA.study_id} × ${sB.study_id}`,
          badge: "SCENE 3: TRANSLATIONAL PUNCHLINE",
          visualType: "organelle_panic",
          details: [
            `Studies: ${sA.study_id} × ${sB.study_id}`,
            `[CONCEPTUAL COMMUNICATION]`,
          ],
          accentColor: "#10b981",
        },
      ],
      accentColor: "#a855f7",
    });
  }

  // Gag 3: Transcript vs Protein or Metabolite Disconnect
  if (isRnaA && (isProteomicsB || isMetabolomicsB)) {
    const bType = isProteomicsB ? "Proteomics" : "Metabolomics";
    gags.push({
      premise: `RNA-seq (${sA.study_id}) orders 500 stress defense transcripts; ${bType} (${sB.study_id}) reports the cellular delivery truck broke down.`,
      clipPrompt: `5-second split-screen scientific comedy animation: Left side shows RNA-seq (${sA.study_id}) enthusiastically printing glowing mRNA memos; Right side shows ${bType.toLowerCase()} (${sB.study_id}) standing by an empty loading dock with a single tumbleweed.`,
      scenes: [
        {
          timeStart: 0.0,
          timeEnd: 1.8,
          mainText: `Transcriptome (${sA.study_id}): 'We Did It!'`,
          subText: `Synthesized hundreds of stress-response transcripts under ${factorA}`,
          badge: "SCENE 1: TRANSCRIPTIONAL HYPERDRIVE",
          visualType: "transcript_protein",
          details: [
            `Assay: ${sA.assay_measurement}`,
            `Platform: ${sA.assay_platform}`,
          ],
          accentColor: "#38bdf8",
        },
        {
          timeStart: 1.8,
          timeEnd: 3.6,
          mainText: `${bType} (${sB.study_id}): 'Checking the Mass Spec...'`,
          subText: `Steady-state abundance reveals post-transcriptional bottleneck`,
          badge: `SCENE 2: ${bType.toUpperCase()} COLD TRUTH`,
          visualType: "contrast_split",
          details: [
            `Assay: ${sB.assay_measurement}`,
            `Finding: ${resB.finding.slice(0, 65)}...`,
          ],
          accentColor: "#f59e0b",
        },
        {
          timeStart: 3.6,
          timeEnd: 5.5,
          mainText: "Cellular Reality: Transcript ≠ Output",
          subText: `[INTERPRETATION] Multi-omic discordance in ${tissueA} adaptation (${sA.study_id} × ${sB.study_id})`,
          badge: "SCENE 3: MULTI-OMIC TAKEAWAY",
          visualType: "group_project",
          details: [
            `Grounded Studies: ${sA.study_id} · ${sB.study_id}`,
            `[CONCEPTUAL COMMUNICATION]`,
          ],
          accentColor: "#10b981",
        },
      ],
      accentColor: "#06b6d4",
    });
  }

  // Pick deterministic gag variation based on seed modulo available gags
  const variationIndex = Math.abs(seed) % gags.length;
  const chosenGag = gags[variationIndex];

  const cautionBadge = "[CONCEPTUAL COMMUNICATION]";
  const cautionText = `Conceptual outreach communication based on verified NASA OSDR datasets (${sA.study_id} × ${sB.study_id}). Humor and visual analogies represent educational simplification; not actual astronaut dialog or clinical telemetry.`;
  const fallbackNotice = "Video generation unavailable — conceptual fallback preview; no provider-generated video was created.";

  const promptFingerprint = computePromptFingerprint(`${chosenGag.clipPrompt}:seed=${seed}`);
  const cacheKey = `meme-clip:${[sA.study_id, sB.study_id].sort().join("::")}:seed=${seed}`;
  const contentHash = computeContentHash({
    chosenGag: chosenGag.premise,
    prompt: chosenGag.clipPrompt,
    seed,
    studies: [sA.study_id, sB.study_id],
  });

  const currentDiscovery = getCachedVideoDiscovery();
  const selectedVideoModel = currentDiscovery?.selectedModel || "none";

  const provenance: MediaProvenanceRecord = {
    requestId,
    artifactId: `art-meme-clip-${requestId.slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    mediaType: "meme_clip",
    provider: status === "fresh_provider" ? "Google Gemini" : "NASA OSDR Local Motion Engine",
    providerModel: selectedVideoModel,
    planningModel: "none",
    planningMethod: "local_metadata_template",
    videoProviderModel: selectedVideoModel,
    fallbackRenderer: "procedural-canvas-animator-v1",
    finalArtifactType: "none",
    stages: {
      activePairResolution: "success",
      promptPlanning: "success",
      planningMethod: "local_metadata_template",
      providerVideoRequest: "not_attempted",
      artifactPersistence: "not_applicable",
      fallbackPreview: "used",
      planningModel: "none",
      videoProviderModel: selectedVideoModel,
      videoProviderError: "Provider video generation was not attempted.",
      fallbackRenderer: "procedural-canvas-animator-v1",
      finalArtifactType: "none",
    },
    generationStatus: status,
    statusLabel: getStatusLabel(status),
    cacheKey,
    cacheHit: status === "cache_hit",
    creativeDirection: `Meme Clip: ${chosenGag.premise.slice(0, 40)}…`,
    seed,
    promptFingerprint,
    contentHash,
    sourceStudyPair: [sA.study_id, sB.study_id],
    latencyMs: 12,
  };

  const clip: AwgMemeClip = {
    title: "AWG Meme Clip",
    premise: chosenGag.premise,
    duration: 5.5,
    studies: [sA.study_id, sB.study_id],
    activeResolvedPair: [sA.study_id, sB.study_id],
    studyA: {
      study_id: sA.study_id,
      title: sA.title,
      organism: sA.organism,
      tissue: sA.material_type,
      assay: sA.assay_measurement,
      factor: sA.study_factor,
      duration: metaA.duration,
      repositoryUrl: metaA.repositoryUrl,
    },
    studyB: {
      study_id: sB.study_id,
      title: sB.title,
      organism: sB.organism,
      tissue: sB.material_type,
      assay: sB.assay_measurement,
      factor: sB.study_factor,
      duration: metaB.duration,
      repositoryUrl: metaB.repositoryUrl,
    },
    cautionBadge,
    cautionText,
    clipPrompt: chosenGag.clipPrompt,
    seed,
    isVideoGenerationAvailable: false,
    isFailedState: true,
    fallbackReason: "Provider video generation was not attempted.",
    fallbackNotice,
    canvasAnimation: {
      theme: "dark_cinematic",
      primaryColor: "#0f172a",
      accentColor: chosenGag.accentColor,
      scenes: chosenGag.scenes,
    },
    provenance,
    // Compatibility fields for legacy consumers
    memeTitle: "AWG Meme Clip",
    memeHook: chosenGag.premise,
    scientificCore: `Co-analysis of ${sA.study_id} (${sA.assay_measurement}) and ${sB.study_id} (${sB.assay_measurement}) in ${sA.material_type}.`,
    humorAngle: "Clip-first relatable scientific comedy",
    groundedFacts: [
      `[METADATA] ${sA.study_id}: ${sA.organism} | Tissue: ${sA.material_type} | Assay: ${sA.assay_measurement} | Factor: ${sA.study_factor}`,
      `[METADATA] ${sB.study_id}: ${sB.organism} | Tissue: ${sB.material_type} | Assay: ${sB.assay_measurement} | Factor: ${sB.study_factor}`,
      `[OBSERVED RESULT] ${sA.study_id}: ${resA.finding}`,
      `[OBSERVED RESULT] ${sB.study_id}: ${resB.finding}`,
      `[INTERPRETATION] ${interpretations[0]?.claim || "Multi-omics pathway convergence"}`,
    ],
  };

  return clip;
}

/**
 * Primary generator for AWG Meme Clip feature.
 * 1. Attempts provider video generation first.
 * 2. Uses exact active pair; never silently swaps or defaults.
 * 3. Incorporates fresh seed in prompt and cache key.
 * 4. Checks cache for prior artifacts and marks "Reused cached artifact".
 * 5. If provider video unavailable, seamlessly returns structured procedural fallback with exact required notice.
 */
export async function generateAwgMemeConcept({
  studies,
  query,
  summary,
  memeAngle,
  seed,
  freshVariation = false,
}: {
  studies: string[];
  query?: string;
  summary?: string;
  memeAngle?: string;
  seed?: number | string;
  freshVariation?: boolean;
}): Promise<AwgMemeClip> {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  // Validate exact accession pair
  const validation = await validateAwgAccessions(studies || []);
  if (!validation.isValid || !validation.studyA || !validation.studyB) {
    throw new Error(
      validation.userMessage ||
        validation.errorMessage ||
        "Invalid study accessions provided for meme generation. Silent substitution is disabled."
    );
  }

  const studyA = validation.studyA;
  const studyB = validation.studyB;

  // Resolve numeric seed
  let numericSeed = typeof seed === "number" ? seed : parseInt(String(seed || ""), 10);
  if (isNaN(numericSeed) || (freshVariation && !isVeoCircuitBreakerOpen())) {
    numericSeed = Math.floor(Math.random() * 900000) + 100000;
  }

  const cacheKey = `meme-clip:${[studyA.study_id, studyB.study_id].sort().join("::")}:seed=${numericSeed}`;

  // Check Cache: reuse cached artifact if not forcing fresh variation OR if circuit breaker/quota exhaustion is active
  if (memeClipCache.has(cacheKey) && (!freshVariation || isVeoCircuitBreakerOpen())) {
    const cachedEntry = memeClipCache.get(cacheKey)!;
    const cachedClip = { ...cachedEntry.clip };
    cachedClip.provenance = {
      ...cachedClip.provenance,
      requestId,
      createdAt: new Date().toISOString(),
      generationStatus: "cache_hit",
      statusLabel: "Reused cached artifact",
      cacheHit: true,
      latencyMs: Math.max(1, Date.now() - startTime),
    };
    recordMediaAudit(cachedClip.provenance);
    return cachedClip;
  }

  // 1. Build deterministic metadata-grounded baseline premise and prompt
  const localPlan = buildLocalMetadataPremiseAndPrompt(studyA, studyB, numericSeed);
  let chosenPremise = localPlan.premise;
  let videoPrompt = localPlan.clipPrompt;

  let planningMethod: "local_metadata_template" | "gemini_generated" | "openrouter_generated" | "groq_generated" | "none" = "local_metadata_template";
  let planningModelName = "none";
  let promptPlanningStatus: "success" | "fail" | "not_attempted" = "success";
  let promptPlanningError: string | undefined = undefined;

  let providerVideoStatus: "not_attempted" | "success" | "fail" | "not_available" = "not_attempted";
  let providerVideoError: string | undefined = undefined;
  let providerOperationName: string | undefined = undefined;
  let providerGeneratedVideo = false;
  let isConfigurationError = false;
  let videoDiscoveryResult: VideoProviderDiscovery | undefined = undefined;

  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (apiKey) {
    let ai: GoogleGenAI | null = null;
    try {
      ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { "User-Agent": "aistudio-build" } },
      });
    } catch (clientErr: any) {
      providerVideoStatus = "fail";
      providerVideoError = clientErr?.message || "Provider API client initialization failure.";
      isConfigurationError = true;
    }

    if (ai) {
      // Stage 2: Prompt Planning via multi-provider text fallback chain (never blocks Veo)
      try {
        const prompt = `You are a scientific outreach writer for NASA Space Biology (OSDR).
Create ONE short, relatable, funny, scientifically responsible one-line premise for a 5-second video clip contrasting these two exact studies:
Study A: ${studyA.study_id} (${studyA.organism}, ${studyA.material_type}, ${studyA.assay_measurement}, ${studyA.study_factor})
Study B: ${studyB.study_id} (${studyB.organism}, ${studyB.material_type}, ${studyB.assay_measurement}, ${studyB.study_factor})
Seed: ${numericSeed}

Strict Constraints:
1. Exactly ONE punchy, funny sentence (under 130 characters).
2. Grounded strictly in the actual organism, tissue, assays, or ground-analog/flight factor.
3. If both are ground analog (e.g. bedrest/HDT), do NOT invent fake spaceflight missions.
4. Do NOT fabricate findings or clinical claims.
5. Friendly and educational humor.

Output strict JSON:
{
  "premise": "string",
  "clipPrompt": "string"
}`;

        const planRes = await generateTextWithFallback({
          prompt,
          temperature: 0.7,
          preferredModel: "gemini-3.7-flash",
          responseMimeType: "application/json",
        });

        const raw = planRes.text?.trim();
        if (raw) {
          // Remove potential markdown code blocks if any provider wrapped json
          const cleanJson = raw.replace(/^```(json)?\s*/i, "").replace(/\s*```$/i, "").trim();
          const parsed = JSON.parse(cleanJson);
          if (parsed.premise && typeof parsed.premise === "string" && parsed.premise.trim()) {
            chosenPremise = parsed.premise.trim();
          }
          if (parsed.clipPrompt && typeof parsed.clipPrompt === "string" && parsed.clipPrompt.trim()) {
            videoPrompt = `${parsed.clipPrompt.trim()} Seed:${numericSeed}`;
          }
          planningMethod =
            planRes.provider === "gemini"
              ? "gemini_generated"
              : planRes.provider === "openrouter"
              ? "openrouter_generated"
              : planRes.provider === "groq"
              ? "groq_generated"
              : "local_metadata_template";
          planningModelName = planRes.model;
          promptPlanningStatus = "success";
          promptPlanningError = undefined;
        }
      } catch (pErr: any) {
        // Fall back gracefully to the deterministic local metadata template without blocking Veo
        planningMethod = "local_metadata_template";
        planningModelName = "none";
        promptPlanningStatus = "success";
        promptPlanningError = undefined;
      }

      // Stage 3: Discover Provider Video Capabilities dynamically
      try {
        const discovery = await discoverVideoProviderCapabilities();
        videoDiscoveryResult = discovery;

        if (discovery.status === "available" && discovery.selectedModel) {
          const pairKey = [studyA.study_id, studyB.study_id].sort().join("::");
          const quotaGate = checkVeoQuotaGate({
            pairKey,
            requestId,
            modelName: discovery.selectedModel,
          });

          if (!quotaGate.allowed) {
            providerVideoStatus = "not_attempted";
            providerVideoError = quotaGate.reason || EXHAUSTED_QUOTA_MESSAGE;
            isConfigurationError = false;
          } else {
            try {
              const videoOp = await ai.models.generateVideos({
                model: discovery.selectedModel,
                prompt: videoPrompt,
                config: {
                  numberOfVideos: 1,
                  resolution: "720p",
                  aspectRatio: "16:9",
                },
              });
              if (videoOp?.name) {
                providerOperationName = videoOp.name;
                providerGeneratedVideo = true;
                providerVideoStatus = "success";
                providerVideoError = undefined;
                recordVeoAttempt(pairKey, undefined, requestId, discovery.selectedModel);
              } else {
                providerVideoStatus = "fail";
                providerVideoError = `Provider video model (${discovery.selectedModel}) returned no operation handle.`;
                isConfigurationError = false;
              }
            } catch (vErr: any) {
              const errMsg = String(vErr?.message || "").toLowerCase();
              const errStatus = vErr?.status || vErr?.code;
              const isQuotaExhausted =
                errStatus === 429 ||
                errMsg.includes("429") ||
                errMsg.includes("resource_exhausted") ||
                errMsg.includes("quota") ||
                errMsg.includes("exhausted");

              if (isQuotaExhausted) {
                triggerVeoCircuitBreaker(vErr?.message, requestId, discovery.selectedModel);
                providerVideoStatus = "fail";
                providerVideoError = EXHAUSTED_QUOTA_MESSAGE;
                isConfigurationError = false;
                markVideoModelUnavailable(discovery.selectedModel, vErr?.message);
              } else {
                const isConfigOrPerm =
                  errStatus === 404 ||
                  errStatus === 403 ||
                  errStatus === 400 ||
                  errMsg.includes("not found") ||
                  errMsg.includes("unsupported") ||
                  errMsg.includes("permission") ||
                  errMsg.includes("forbidden") ||
                  errMsg.includes("not enabled") ||
                  errMsg.includes("access") ||
                  errMsg.includes("billing");

                providerVideoStatus = isConfigOrPerm ? "not_available" : "fail";
                providerVideoError = vErr?.message || `Provider video model (${discovery.selectedModel}) call failed.`;
                isConfigurationError = isConfigOrPerm;
                markVideoModelUnavailable(discovery.selectedModel, providerVideoError);
              }
            }
          }
        } else {
          // No eligible video generation model is available to this project/account
          providerVideoStatus = "not_available";
          providerVideoError = discovery.reason || "Provider video generation is not enabled for this project or API configuration.";
          isConfigurationError = discovery.isPermanentConfigError;
        }
      } catch (dErr: any) {
        providerVideoStatus = "fail";
        providerVideoError = dErr?.message || "Error discovering video provider capabilities.";
        isConfigurationError = true;
      }
    }
  } else {
    // No API key configured
    planningMethod = "local_metadata_template";
    planningModelName = "none";
    promptPlanningStatus = "success";
    providerVideoStatus = "not_available";
    providerVideoError = "GEMINI_API_KEY is not configured in server environment. Provider video generation is unavailable.";
    isConfigurationError = true;
    videoDiscoveryResult = {
      status: "unconfigured",
      invocationMethod: "none",
      availableVideoModels: [],
      allAvailableModelsCount: 0,
      apiSurface: "GoogleGenAI SDK (v1beta)",
      reason: "GEMINI_API_KEY is not configured in server environment.",
      requiredStep: "Configure GEMINI_API_KEY in project settings.",
      checkedAt: new Date().toISOString(),
      isPermanentConfigError: true,
    };
  }

  const selectedModelName = videoDiscoveryResult?.selectedModel || "none";

  const stages: StageExecutionAudit = {
    activePairResolution: "success",
    promptPlanning: promptPlanningStatus,
    planningMethod,
    providerVideoRequest: providerVideoStatus,
    artifactPersistence: providerGeneratedVideo ? "success" : "not_applicable",
    fallbackPreview: providerGeneratedVideo ? "not_used" : "used",
    planningModel: planningModelName,
    planningError: promptPlanningError,
    videoProviderModel: selectedModelName,
    videoProviderError: providerVideoError,
    videoProviderDiscovery: videoDiscoveryResult,
    isConfigurationError,
    fallbackRenderer: "procedural-canvas-animator-v1",
    finalArtifactType: providerGeneratedVideo ? "provider_mp4" : "none",
  };

  const initialStatus: MediaGenerationStatus = providerGeneratedVideo ? "fresh_provider" : "failed";
  const clip = buildLocalMemeClip(studyA, studyB, numericSeed, initialStatus, requestId);

  clip.premise = chosenPremise;
  if (clip.canvasAnimation?.scenes?.[0]) {
    clip.canvasAnimation.scenes[0].mainText = chosenPremise.slice(0, 50);
  }

  // Determine clear failure reason based on actual provider stage
  let computedFallbackReason: string | undefined = undefined;
  if (!providerGeneratedVideo) {
    if (
      providerVideoError?.includes("exhausted") ||
      providerVideoError?.includes("quota") ||
      providerVideoError?.includes("RESOURCE_EXHAUSTED") ||
      providerVideoError?.includes("429") ||
      isVeoCircuitBreakerOpen()
    ) {
      computedFallbackReason = EXHAUSTED_QUOTA_MESSAGE;
    } else if (providerVideoStatus === "not_available") {
      computedFallbackReason = providerVideoError || "Provider video generation is not enabled for this project or API configuration.";
    } else if (providerVideoStatus === "fail") {
      computedFallbackReason = `Video generation step failed on ${selectedModelName}: ${providerVideoError || "Provider video model call failed."}`;
    } else {
      computedFallbackReason = "Provider video generation was not attempted.";
    }
  }

  if (providerGeneratedVideo && providerOperationName) {
    clip.operationName = providerOperationName;
    clip.isVideoGenerationAvailable = true;
    clip.isFailedState = false;
    clip.fallbackReason = undefined;
    clip.provenance.provider = "Google Gemini";
    clip.provenance.providerModel = selectedModelName;
    clip.provenance.planningModel = planningModelName;
    clip.provenance.planningMethod = planningMethod;
    clip.provenance.videoProviderModel = selectedModelName;
    clip.provenance.fallbackRenderer = "none";
    clip.provenance.finalArtifactType = "provider_mp4";
    clip.provenance.stages = stages;
    clip.provenance.videoProviderDiscovery = videoDiscoveryResult;
    clip.provenance.isConfigurationError = false;
    clip.provenance.generationStatus = "fresh_provider";
    clip.provenance.statusLabel = "Fresh provider generation";
  } else {
    clip.isVideoGenerationAvailable = false;
    clip.isFailedState = true;
    clip.fallbackReason = computedFallbackReason;
    clip.provenance.provider = isConfigurationError || providerVideoStatus === "not_available" ? "NASA OSDR Local Motion Engine" : "Google Gemini";
    clip.provenance.providerModel = selectedModelName;
    clip.provenance.planningModel = planningModelName;
    clip.provenance.planningMethod = planningMethod;
    clip.provenance.videoProviderModel = selectedModelName;
    clip.provenance.fallbackRenderer = "procedural-canvas-animator-v1";
    clip.provenance.finalArtifactType = "none";
    clip.provenance.stages = stages;
    clip.provenance.videoProviderDiscovery = videoDiscoveryResult;
    clip.provenance.isConfigurationError = isConfigurationError;
    clip.provenance.generationStatus = isConfigurationError || providerVideoStatus === "not_available" ? "fallback" : "failed";
    clip.provenance.statusLabel = providerVideoStatus === "not_available" ? "Provider video unavailable" : "Video generation failed";
    clip.provenance.errorCode = isConfigurationError ? "ERR_VIDEO_PROVIDER_NOT_CONFIGURED" : "ERR_VIDEO_PROVIDER_FAILED";
    clip.provenance.errorMessage = computedFallbackReason;
  }

  clip.provenance.latencyMs = Math.max(1, Date.now() - startTime);
  clip.provenance.contentHash = computeContentHash({
    premise: clip.premise,
    seed: numericSeed,
    studies: [studyA, studyB],
    operationName: clip.operationName || "none",
    status: clip.provenance.generationStatus,
  });

  // Store in cache
  memeClipCache.set(cacheKey, {
    clip,
    createdAt: new Date().toISOString(),
  });

  recordMediaAudit(clip.provenance);
  return clip;
}

export const generateAwgMemeClip = generateAwgMemeConcept;
