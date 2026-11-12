export const AWG_SUBGROUPS = [
  "AIML AWG",
  "Animal AWG",
  "Plant AWG",
  "Multi-Omics / Systems Biology AWG",
  "Microbes AWG",
  "Human / Clinical Spaceflight AWG",
  "Independent / Academic Collaborator",
];

const LOCAL_SUBMISSIONS_KEY = "osdr_chatbot_contributor_submissions_v1";

/**
 * Canonical client-side featured model manifest definitions mirroring /api/awg/integrations.
 */
export const FEATURED_COMMUNITY_MANIFESTS = {
  retinacelltwin: {
    id: "retinacelltwin",
    title: "RetinaCellTwin",
    author: "Lissandra Kruse Fuganti (@fuganti)",
    subgroup: "AIML AWG",
    appUrl: "https://retina-cell-twin-osdr.fuganti.chatgpt.site/",
    repoUrl:
      "https://github.com/gastondana627/OSDR_Chatbot/blob/main/server/communityIntegrations.ts",
    domain: "Spaceflight Retinal Transcriptomics, SANS & Cross-Mission VOI",
    tags: ["SANS", "retinal-transcriptomics", "OSD-255", "digital-twin", "evidence-synthesis"],
    disclaimer:
      "Exploratory research demonstrator, not a clinically validated model or diagnostic tool for SANS. Outputs should be treated as exploratory and not as predictions about astronauts.",
  },
  "space-sleep-twin": {
    id: "space-sleep-twin",
    title: "SpaceSleepTwin",
    author: "Lissandra Kruse Fuganti (@fuganti)",
    subgroup: "PlantAWG",
    appUrl: "https://lissandrakruse.github.io/SpaceSleepTwin/",
    repoUrl: "https://github.com/lissandrakruse/SpaceSleepTwin",
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
  },
};

/**
 * Build or normalize a Citation / Model Manifest JSON payload for a featured community prototype.
 */
export function buildFeaturedModelManifest(entry = {}) {
  if (entry?.modelManifest && entry.modelManifest.manifestType === "osdr_chatbot_community_model_manifest") {
    return entry.modelManifest;
  }

  const base = FEATURED_COMMUNITY_MANIFESTS[entry?.id] || {};
  const id = entry?.id || base.id || "community-model";
  const title = entry?.title || entry?.name || base.title || "Community Prototype";
  const author = entry?.author || entry?.creatorLabel || base.author || "AWG Contributor";
  const subgroup = entry?.subgroup || base.subgroup;
  const domain = entry?.domain || base.domain || "Space Biology Modeling";
  const appUrl = entry?.appUrl || entry?.externalUrl || base.appUrl || "";
  const repoUrl = entry?.repoUrl || entry?.repositoryUrl || base.repoUrl || "";
  const tags = Array.isArray(entry?.tags) ? entry.tags : base.tags || [];
  const disclaimer =
    entry?.disclaimer ||
    base.disclaimer ||
    "Exploratory research demonstrator attributed to its independent author; not affiliated with or endorsed by NASA.";

  return {
    schemaVersion: "1.0.0",
    manifestType: "osdr_chatbot_community_model_manifest",
    generatedAt: new Date().toISOString(),
    id,
    title,
    author,
    creatorHandle: entry?.creatorHandle || "contributor",
    ...(subgroup ? { subgroup } : {}),
    status: entry?.status || "external_research_prototype",
    domain,
    tags,
    appUrl,
    repoUrl,
    description: entry?.summary || entry?.tagline || "",
    datasetScope: Array.isArray(entry?.datasetScope) ? entry.datasetScope : [],
    provenanceGuardrails: Array.isArray(entry?.provenanceGuardrails)
      ? entry.provenanceGuardrails
      : [],
    disclaimer,
    upstreamHub: {
      name: "OSDR_Chatbot Contributor Hub",
      route: "/contributors",
      apiEndpoint: "/api/awg/integrations",
      repository: "https://github.com/gastondana627/OSDR_Chatbot",
    },
    citation: {
      preferredCitation: `${author}${subgroup ? ` (${subgroup})` : ""}. ${title}: ${domain}. Live App: ${appUrl}${repoUrl ? ` · Repository: ${repoUrl}` : ""}`,
      attributionNotice:
        "Community prototypes shown here are independent research demonstrators credited to their respective authors and are not endorsed by or officially affiliated with NASA.",
    },
  };
}

/**
 * Parse comma/whitespace-separated OSDR study IDs into canonical `OSD-<digits>` strings.
 */
export function parseTargetOsdrStudyIds(rawInput) {
  const tokens = String(rawInput || "")
    .split(/[\s,;|]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const validIds = [];
  const invalidTokens = [];
  const seen = new Set();

  for (const tok of tokens) {
    const normalized = tok.toUpperCase().replace(/^OSD-?(\d+)$/, "OSD-$1");
    if (/^OSD-\d+$/.test(normalized)) {
      if (!seen.has(normalized)) {
        seen.add(normalized);
        validIds.push(normalized);
      }
    } else {
      invalidTokens.push(tok);
    }
  }

  return { validIds, invalidTokens };
}

/**
 * Normalize a forum/GitHub handle to `@handle` format if provided.
 */
export function normalizeForumHandle(rawHandle) {
  const trimmed = String(rawHandle || "").trim();
  if (!trimmed) return "";
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

/**
 * Build a standardized `contributor_manifest.json` object for PR review or forum sharing.
 */
export function buildContributorManifest(formInput = {}) {
  const name = String(formInput.contributorName || "").trim();
  const handle = normalizeForumHandle(formInput.forumHandle);
  const awgSubgroup = String(formInput.awgSubgroup || "AIML AWG").trim() || "AIML AWG";
  const affiliation = String(formInput.affiliation || "").trim();
  const title = String(formInput.projectTitle || "").trim();
  const abstract = String(formInput.abstract || "").trim();
  const liveDemoUrl = String(formInput.liveDemoUrl || "").trim();
  const repositoryOrPaperUrl = String(formInput.repositoryOrPaperUrl || "").trim();
  const { validIds } = parseTargetOsdrStudyIds(formInput.targetStudyIds);

  const includesOsd255 = validIds.includes("OSD-255");

  return {
    schemaVersion: "1.0.0",
    manifestType: "osdr_chatbot_contributor_submission",
    submittedAt: new Date().toISOString(),
    contributor: {
      name,
      handle: handle || null,
      awgSubgroup,
      affiliation: affiliation || null,
    },
    project: {
      title,
      abstract,
      liveDemoUrl: liveDemoUrl || null,
      repositoryOrPaperUrl: repositoryOrPaperUrl || null,
      status: "community_submission_draft",
    },
    osdrIntegration: {
      targetStudyIds: validIds,
      upstreamDiscoveryHub: "OSDR_Chatbot",
      contractHandshakeVersion: "1.0.0",
      includesRetinalFrozenPanelPolicy: includesOsd255,
      ...(includesOsd255
        ? {
            frozenPanelReference: {
              referenceAccession: "OSD-255",
              discoveryPanelSize: 362,
              discoveryThreshold: "NASA OSDR FDR < 0.05",
            },
          }
        : {}),
      provenanceGuardrails: [
        "NO_RAW_CROSS_MISSION_ANIMAL_POOLING",
        "ANIMAL_DISJOINT_VALIDATION_SPLITS",
        ...(includesOsd255 ? ["FROZEN_DISCOVERY_PANEL_BEFORE_EXTERNAL_TEST"] : []),
        "INDEPENDENT_NON_NASA_ATTRIBUTION",
      ],
    },
  };
}

/**
 * Format a ready-to-paste GitHub Pull Request / Issue contribution block.
 */
export function formatGitHubContributionBlock(manifest) {
  const c = manifest?.contributor || {};
  const p = manifest?.project || {};
  const studies = manifest?.osdrIntegration?.targetStudyIds || [];
  const studyList = studies.length ? studies.map((id) => `\`${id}\``).join(", ") : "_None specified_";
  const authorLine = c.handle ? `${c.name || "Contributor"} (${c.handle})` : c.name || "Contributor";

  return [
    `### Community Contributor Hub Submission: ${p.title || "Untitled Tool"}`,
    "",
    `- **Contributor:** ${authorLine}`,
    `- **AWG Subgroup / Affiliation:** ${c.awgSubgroup || "AIML AWG"}${c.affiliation ? ` · ${c.affiliation}` : ""}`,
    `- **Target OSDR Studies:** ${studyList}`,
    `- **Live Tool / Demo:** ${p.liveDemoUrl || "_Pending URL_"}`,
    `- **Repository / Paper:** ${p.repositoryOrPaperUrl || "_Pending URL_"}`,
    "",
    "**Abstract / Integration Scope:**",
    `> ${p.abstract || "Independent AWG research tool integrating OSDR_Chatbot discovery metadata."}`,
    "",
    "**Provenance & Scope Attestation:**",
    "- [x] Independent community prototype attributed to its creator (not affiliated with or endorsed by NASA).",
    "- [x] Preserves OSDR mission/animal boundaries without silent sample pooling.",
    "",
    "<details>",
    "<summary><code>contributor_manifest.json</code></summary>",
    "",
    "```json",
    JSON.stringify(manifest, null, 2),
    "```",
    "</details>",
  ].join("\n");
}

/**
 * Format a crisp AWG Forum announcement post ready to share in subgroup discussions.
 */
export function formatForumAnnouncementText(manifest) {
  const c = manifest?.contributor || {};
  const p = manifest?.project || {};
  const studies = manifest?.osdrIntegration?.targetStudyIds || [];
  const studyLine = studies.length ? studies.join(", ") : "NASA OSDR datasets";
  const authorLine = c.handle ? `${c.name || "AWG Member"} (${c.handle})` : c.name || "AWG Member";

  return [
    `New AWG Community Tool Showcase: **${p.title || "OSDR Research Prototype"}**`,
    `Built by ${authorLine} (${c.awgSubgroup || "AIML AWG"}${c.affiliation ? ` — ${c.affiliation}` : ""})`,
    "",
    `${p.abstract || "Interactive analysis and evidence synthesis workflow built on NASA OSDR cohorts."}`,
    "",
    `• Target OSDR Datasets: ${studyLine}`,
    ...(p.liveDemoUrl ? [`• Live App / Demo: ${p.liveDemoUrl}`] : []),
    ...(p.repositoryOrPaperUrl ? [`• Repository / Paper: ${p.repositoryOrPaperUrl}`] : []),
    `• Aligned via OSDR ChatBot Contributor Hub (/contributors) — independent community prototype.`,
  ].join("\n");
}

/**
 * Copy text to clipboard with synchronous textarea fallback for restricted/HTTP contexts.
 */
export async function copyTextSafely(text) {
  const value = String(text || "");
  if (!value) return false;

  if (typeof navigator !== "undefined" && navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to execCommand fallback
    }
  }

  if (typeof document !== "undefined") {
    try {
      const el = document.createElement("textarea");
      el.value = value;
      el.setAttribute("readonly", "");
      el.style.position = "absolute";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      return Boolean(ok);
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Trigger a client-side JSON file download.
 */
export function downloadJsonFile(filename, data) {
  if (typeof document === "undefined" || typeof Blob === "undefined") return false;
  try {
    const jsonText = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonText], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

export function loadSavedContributorSubmissions() {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_SUBMISSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveContributorSubmission(manifest) {
  const existing = loadSavedContributorSubmissions();
  const entry = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    savedAt: new Date().toISOString(),
    manifest,
  };
  const next = [entry, ...existing].slice(0, 20);
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(LOCAL_SUBMISSIONS_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
  }
  return next;
}

export function removeContributorSubmission(entryId) {
  const existing = loadSavedContributorSubmissions();
  const next = existing.filter((item) => item.id !== entryId);
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(LOCAL_SUBMISSIONS_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
  }
  return next;
}

