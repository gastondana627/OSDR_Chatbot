import { getStudyById } from "./osdrClient";
import {
  buildAwgEvidenceMap,
  IngestionSchemaContract,
  SchemaGuardrailNotice,
  scoreStudyCompatibility,
} from "./awg";

export interface CommunityModelManifest {
  schemaVersion: "1.0.0";
  manifestType: "osdr_chatbot_community_model_manifest";
  generatedAt: string;
  id: string;
  title: string;
  author: string;
  creatorHandle: string;
  subgroup?: string;
  status: "external_research_prototype";
  domain: string;
  tags: string[];
  appUrl: string;
  repoUrl: string;
  description: string;
  datasetScope: string[];
  provenanceGuardrails: string[];
  disclaimer: string;
  upstreamHub: {
    name: string;
    route: string;
    apiEndpoint: string;
    repository: string;
  };
  citation: {
    preferredCitation: string;
    attributionNotice: string;
  };
}

export interface CommunityPrototypeEntry {
  id: string;
  name: string;
  title: string;
  author: string;
  creatorLabel: string;
  creatorHandle: string;
  subgroup?: string;
  badgeLabel?: string;
  status: "external_research_prototype";
  domain: string;
  tags: string[];
  disclaimer: string;
  relationshipNote: string;
  appUrl: string;
  externalUrl: string;
  repoUrl: string;
  repositoryUrl?: string;
  repositoryLabel?: string;
  tagline: string;
  summary: string;
  datasetScope: string[];
  architecturalModules: Array<{
    title: string;
    detail: string;
  }>;
  provenanceGuardrails: string[];
  suggestedChatPrompts: Array<{
    label: string;
    command: string;
  }>;
  modelManifest?: CommunityModelManifest;
}

export interface PipelineHandshakeTemplate {
  id: string;
  title: string;
  studyPair: [string, string];
  useCase: string;
  downstreamTargetId: string;
  compatibilityScore: number | null;
  command: string;
  frozenPanelPolicy: {
    referenceAccession: string;
    discoveryPanelSize?: number;
    discoveryThreshold: string;
    rule: string;
  };
  keyGuardrails: SchemaGuardrailNotice[];
  contractPreview: IngestionSchemaContract | null;
}

export interface CommunityIntegrationsPayload {
  generatedAt: string;
  attributionNotice: string;
  hudDesignBranchNotice: string;
  contributors: CommunityPrototypeEntry[];
  manifests: CommunityModelManifest[];
  handshakeTemplates: PipelineHandshakeTemplate[];
}

function buildHandshakeTemplate(opts: {
  id: string;
  title: string;
  studyAId: string;
  studyBId: string;
  useCase: string;
  downstreamTargetId: string;
  command: string;
  fallbackFrozenPanelPolicy: PipelineHandshakeTemplate["frozenPanelPolicy"];
}): PipelineHandshakeTemplate {
  const studyA = getStudyById(opts.studyAId);
  const studyB = getStudyById(opts.studyBId);

  if (!studyA || !studyB) {
    return {
      id: opts.id,
      title: opts.title,
      studyPair: [opts.studyAId, opts.studyBId],
      useCase: opts.useCase,
      downstreamTargetId: opts.downstreamTargetId,
      compatibilityScore: null,
      command: opts.command,
      frozenPanelPolicy: opts.fallbackFrozenPanelPolicy,
      keyGuardrails: [],
      contractPreview: null,
    };
  }

  const breakdown = scoreStudyCompatibility(studyA, studyB);
  const evidenceMap = buildAwgEvidenceMap(studyA, studyB);

  return {
    id: opts.id,
    title: opts.title,
    studyPair: [studyA.study_id, studyB.study_id],
    useCase: opts.useCase,
    downstreamTargetId: opts.downstreamTargetId,
    compatibilityScore: breakdown.totalScore,
    command: opts.command,
    frozenPanelPolicy:
      evidenceMap.schemaContract?.frozenPanelPolicy || opts.fallbackFrozenPanelPolicy,
    keyGuardrails: evidenceMap.schemaGuardrails || [],
    contractPreview: evidenceMap.schemaContract || null,
  };
}

const COMMUNITY_ATTRIBUTION_NOTICE =
  "Community prototypes shown here are independent research demonstrators credited to their respective authors and are not endorsed by or officially affiliated with NASA.";

export function buildCommunityModelManifest(
  entry: CommunityPrototypeEntry,
  generatedAt: string = new Date().toISOString()
): CommunityModelManifest {
  const title = entry.title || entry.name;
  const author = entry.author || entry.creatorLabel;
  const appUrl = entry.appUrl || entry.externalUrl;
  const repoUrl = entry.repoUrl || entry.repositoryUrl || "";

  return {
    schemaVersion: "1.0.0",
    manifestType: "osdr_chatbot_community_model_manifest",
    generatedAt,
    id: entry.id,
    title,
    author,
    creatorHandle: entry.creatorHandle,
    ...(entry.subgroup ? { subgroup: entry.subgroup } : {}),
    status: entry.status,
    domain: entry.domain,
    tags: [...entry.tags],
    appUrl,
    repoUrl,
    description: entry.summary,
    datasetScope: [...entry.datasetScope],
    provenanceGuardrails: [...entry.provenanceGuardrails],
    disclaimer: entry.disclaimer,
    upstreamHub: {
      name: "OSDR_Chatbot Contributor Hub",
      route: "/contributors",
      apiEndpoint: "/api/awg/integrations",
      repository: "https://github.com/gastondana627/OSDR_Chatbot",
    },
    citation: {
      preferredCitation: `${author}${entry.subgroup ? ` (${entry.subgroup})` : ""}. ${title}: ${entry.domain}. Live App: ${appUrl}${repoUrl ? ` · Repository: ${repoUrl}` : ""}`,
      attributionNotice: COMMUNITY_ATTRIBUTION_NOTICE,
    },
  };
}

export function getCommunityIntegrationsPayload(): CommunityIntegrationsPayload {
  const generatedAt = new Date().toISOString();

  const rawContributors: CommunityPrototypeEntry[] = [
    {
      id: "retinacelltwin",
      name: "RetinaCellTwin",
      title: "RetinaCellTwin",
      author: "Lissandra Kruse Fuganti (@fuganti)",
      creatorLabel: "Lissandra Kruse Fuganti (fuganti)",
      creatorHandle: "fuganti",
      subgroup: "AIML AWG",
      badgeLabel: "1st Contributor Prototype",
      status: "external_research_prototype",
      domain: "Spaceflight Retinal Transcriptomics, SANS & Cross-Mission VOI",
      tags: ["SANS", "retinal-transcriptomics", "OSD-255", "digital-twin", "evidence-synthesis"],
      disclaimer:
        "Exploratory research demonstrator, not a clinically validated model or diagnostic tool for SANS. Outputs should be treated as exploratory and not as predictions about astronauts.",
      relationshipNote:
        "Independent AWG collaborator research demonstrator developed by Lissandra Kruse Fuganti (fuganti); linked here without modifying OSDR_Chatbot core ingest contracts.",
      appUrl: "https://retina-cell-twin-osdr.fuganti.chatgpt.site/",
      externalUrl: "https://retina-cell-twin-osdr.fuganti.chatgpt.site/",
      repoUrl:
        "https://github.com/gastondana627/OSDR_Chatbot/blob/main/server/communityIntegrations.ts",
      repositoryUrl:
        "https://github.com/gastondana627/OSDR_Chatbot/blob/main/server/communityIntegrations.ts",
      repositoryLabel: "Aligned Schema Contract Spec",
      tagline:
        "Multimodal probabilistic spaceflight retina research twin & evidence solver (OSD-255 × OSD-758 / OSD-203 / OSD-557)",
      summary:
        "Evaluates whether frozen discovery gene signatures replicate independently across orbital artificial-gravity centrifugation and ground radiation/unloading cohorts, synthesizing imaging endpoints (4-HNE, TUNEL, PECAM, ZO-1) and decision-science planning under transparent provenance guardrails.",
      datasetScope: [
        "OSD-255 (RR-9 Discovery Panel)",
        "OSD-758 (MHU-8 Gravity: µg, 0.33G, 0.66G/0.67g, 1G)",
        "OSD-203 (Ground HLU + 0.04 Gy LDR)",
        "OSD-557 (RR-9 Micro-CT & 4-HNE/PNA)",
        "OSD-568 (RR-9 TUNEL, PECAM-1, ZO-1)",
      ],
      architecturalModules: [
        {
          title: "Cross-Mission Independent Auditing",
          detail:
            "Audits frozen gene panels (such as the 362-gene OSD-255 RR-9 discovery set at NASA FDR < 0.05) across independent OSD-758 artificial-gravity centrifugation bins (µg, 0.33G, 0.66G, 1G) and ground analog OSD-203.",
        },
        {
          title: "Multimodal Evidence Solver",
          detail:
            "Computes directional consistency, standardized effect sizes (Hedges' g), uncertainty intervals, and probabilities of direction across imaging endpoints (4-HNE, TUNEL, PECAM, ZO-1) without black-box interpolation.",
        },
        {
          title: "Decision Science & VOI Layer",
          detail:
            "Combines Value of Information (VOI) calculations with integer programming to simulate follow-up experiment prioritization under resource constraints and uncertain priors.",
        },
        {
          title: "Transparent Provenance Guardrails",
          detail:
            "Links raw ISA archive checksums and versioned summaries while explicitly labeling exploratory or post-hoc cross-sectional contrasts.",
        },
      ],
      provenanceGuardrails: [
        "No pooled raw animal joins across separate missions (RR-9 SpaceX-12 vs. MHU-8 SpaceX-27 vs. Ground LSDA 13471).",
        "Discovery gene sets and FDR thresholds stay frozen inside the reference cohort prior to external testing.",
        "Explicit separation of confirmatory replication vs. post-hoc/exploratory cross-mission associations.",
      ],
      suggestedChatPrompts: [
        {
          label: "Audit OSD-255 × OSD-758 Contract",
          command: "/awg compare OSD-255 OSD-758",
        },
        {
          label: "Audit OSD-255 × OSD-203 Analog",
          command: "/awg compare OSD-255 OSD-203",
        },
        {
          label: "Inspect OSD-557 × OSD-568 Imaging",
          command: "/awg compare OSD-557 OSD-568",
        },
      ],
    },
    {
      id: "space-sleep-twin",
      name: "SpaceSleepTwin",
      title: "SpaceSleepTwin",
      author: "Lissandra Kruse Fuganti (@fuganti)",
      creatorLabel: "Lissandra Kruse Fuganti (fuganti)",
      creatorHandle: "fuganti",
      subgroup: "PlantAWG",
      badgeLabel: "2nd Featured Prototype · PlantAWG",
      status: "external_research_prototype",
      domain: "Circadian Rhythm, Sleep Latency & HERA Analog Lighting",
      tags: [
        "circadian-rhythm",
        "HERA",
        "digital-twin",
        "sleep-latency",
        "lighting-interventions",
      ],
      disclaimer:
        "Exploratory computational model. Not validated in astronauts; simulations do not establish clinical sleep outcomes.",
      relationshipNote:
        "Independent AWG collaborator computational prototype developed by Lissandra Kruse Fuganti (@fuganti / PlantAWG); showcased alongside RetinaCellTwin without modifying OSDR_Chatbot core ingest contracts.",
      appUrl: "https://lissandrakruse.github.io/SpaceSleepTwin/",
      externalUrl: "https://lissandrakruse.github.io/SpaceSleepTwin/",
      repoUrl: "https://github.com/lissandrakruse/SpaceSleepTwin",
      repositoryUrl: "https://github.com/lissandrakruse/SpaceSleepTwin",
      repositoryLabel: "GitHub Repository",
      tagline:
        "Circadian Rhythm, Sleep Latency & HERA Analog Lighting — Mechanistic circadian & LED-lighting schedule simulator",
      summary:
        "An exploratory computational tool for studying sleep, circadian rhythms, and lighting schedules (including LED-lighting scenarios in space analogs). Combines a mechanistic circadian model with a simplified reconstruction of the published NASA HERA terrestrial-analog lighting study, plus exploratory sleep-latency analyses using terrestrial Manchester and MeLiDos data.",
      datasetScope: [
        "NASA HERA Terrestrial-Analog Lighting Study (Simplified Reconstruction)",
        "Manchester Terrestrial Sleep-Latency Dataset",
        "MeLiDos Terrestrial Light & Sleep Dataset",
        "Space-Analog LED Lighting Schedules",
      ],
      architecturalModules: [
        {
          title: "Mechanistic Circadian Rhythm Model",
          detail:
            "Simulates circadian phase shifts, entrainment dynamics, and sleep-wake timing under candidate ambient and LED-lighting schedules across analog mission timelines.",
        },
        {
          title: "NASA HERA Lighting Study Reconstruction",
          detail:
            "Implements a simplified computational reconstruction of the published NASA Human Exploration Research Analog (HERA) terrestrial-analog lighting intervention study.",
        },
        {
          title: "Manchester & MeLiDos Sleep-Latency Analyses",
          detail:
            "Evaluates exploratory sleep-latency dynamics using terrestrial Manchester and MeLiDos light-exposure and sleep datasets.",
        },
        {
          title: "Exploratory Analog Boundary Guardrails",
          detail:
            "Keeps terrestrial-analog simulations cleanly separated from orbital medical claims so outputs remain transparent, testable, and hypothesis-generating.",
        },
      ],
      provenanceGuardrails: [
        "Exploratory computational model. Not validated in astronauts; simulations do not establish clinical sleep outcomes.",
        "Combines a simplified reconstruction of the published NASA HERA terrestrial-analog lighting study with terrestrial Manchester and MeLiDos data rather than private flight medical records.",
        "Outputs are intended to support lighting-schedule sensitivity checks and community feedback on modeling assumptions.",
      ],
      suggestedChatPrompts: [
        {
          label: "Search OSDR Circadian & Sleep Studies",
          command:
            "Which NASA OSDR studies examine circadian rhythms, sleep disruption, or lighting schedules in spaceflight analogs?",
        },
      ],
    },
  ];

  const contributors: CommunityPrototypeEntry[] = rawContributors.map((entry) => ({
    ...entry,
    modelManifest: buildCommunityModelManifest(entry, generatedAt),
  }));

  const manifests: CommunityModelManifest[] = contributors.map((entry) => entry.modelManifest!);

  const handshakeTemplates: PipelineHandshakeTemplate[] = [
    buildHandshakeTemplate({
      id: "osd255-x-osd758-mhu8",
      title: "OSD-255 (RR-9 Discovery) → OSD-758 (MHU-8 Artificial Gravity)",
      studyAId: "OSD-255",
      studyBId: "OSD-758",
      useCase:
        "Feeds machine-readable cross-mission contract & zero-shared-animals metadata into downstream frozen-panel evaluation across MHU-8 µg, 0.33G, 0.67g (~0.66G), and 1.0G centrifugation bins.",
      downstreamTargetId: "retinacelltwin",
      command: "/awg compare OSD-255 OSD-758",
      fallbackFrozenPanelPolicy: {
        referenceAccession: "OSD-255",
        discoveryPanelSize: 362,
        discoveryThreshold: "NASA OSDR FDR < 0.05",
        rule: "Lock 362-gene OSD-255 discovery signature before scoring MHU-8 centrifugation bins; enforce animal-disjoint splits and zero raw sample pooling.",
      },
    }),
    buildHandshakeTemplate({
      id: "osd255-x-osd203-analog",
      title: "OSD-255 (RR-9 Flight Retina) → OSD-203 (HLU + 0.04 Gy LDR)",
      studyAId: "OSD-255",
      studyBId: "OSD-203",
      useCase:
        "Exports cross-protocol guardrails bridging RR-9 flight retina RNA-seq against ground 21-day hindlimb unloading + 0.04 Gy LDR radiation RNA-seq/RRBS (7d, 1mo, 4mo timepoints).",
      downstreamTargetId: "retinacelltwin",
      command: "/awg compare OSD-255 OSD-203",
      fallbackFrozenPanelPolicy: {
        referenceAccession: "OSD-255",
        discoveryPanelSize: 362,
        discoveryThreshold: "NASA OSDR FDR < 0.05",
        rule: "Retain discovery signature inside OSD-255; stratify OSD-203 downstream by female sex, 6-mo age, radiation/unloading factor, and 7d/1mo/4mo recovery strata.",
      },
    }),
    buildHandshakeTemplate({
      id: "osd557-x-osd568-imaging",
      title: "OSD-557 (Micro-CT & 4-HNE/PNA) × OSD-568 (TUNEL, PECAM-1, ZO-1)",
      studyAId: "OSD-557",
      studyBId: "OSD-568",
      useCase:
        "Documents RR-9 ocular imaging assay boundaries & CC1/CC2 control strata for multimodal standardized effect-size solvers (Hedges' g / probability of direction).",
      downstreamTargetId: "retinacelltwin",
      command: "/awg compare OSD-557 OSD-568",
      fallbackFrozenPanelPolicy: {
        referenceAccession: "OSD-255",
        discoveryPanelSize: 362,
        discoveryThreshold: "NASA OSDR FDR < 0.05",
        rule: "Preserve separation between RR-9 left-eye/microscopy sub-cohorts (OSD-557, OSD-568) and right-retina RNA-seq (OSD-255); prevent double-counting shared mission backgrounds.",
      },
    }),
  ];

  return {
    generatedAt,
    attributionNotice: COMMUNITY_ATTRIBUTION_NOTICE,
    hudDesignBranchNotice:
      "Community Contributor Hub & Schema Contract showcase: links upstream OSDR discovery with independent AWG collaborator prototypes.",
    contributors,
    manifests,
    handshakeTemplates,
  };
}

