// ==============================================================================
// Researcher Account Profile & AWG Subgroup Store (Option A: Local per-UID v1)
// ==============================================================================
// Persists researcher identity, checked NASA OSDR Analysis Working Group (AWG)
// subgroups, and workspace preferences in localStorage keyed strictly by Firebase
// UID (`osdr_researcher_profile_v1:<uid>`).
//
// Designed with an explicit storage adapter boundary so enabling Cloud Firestore
// (`users/{uid}`) later can upgrade sync transparently without changing any UI.

export const PROFILE_STORAGE_PREFIX = "osdr_researcher_profile_v1:";
export const PROFILE_SCHEMA_VERSION = 1;

/**
 * Official NASA OSDR Analysis Working Groups (AWG) & Collaborator Tracks.
 */
export const AWG_PROFILE_SUBGROUPS = [
  {
    id: "AIML AWG",
    shortLabel: "AI/ML",
    title: "AIML AWG",
    description: "Machine learning, foundation models, digital twins & reproducible OSDR benchmarks.",
    accent: "#38bdf8",
    recommendedPresets: ["rr9-multimodal-retina", "flight-vs-sans-analog"],
    contributorGroup: "AIML AWG",
    radarKeywords: ["ai", "ml", "aiml", "twin", "model", "benchmark", "foundation"],
  },
  {
    id: "Animal AWG",
    shortLabel: "Animal",
    title: "Animal AWG",
    description: "Rodent Research (RR-1 to RR-18), spaceflight mouse/rat physiology & ground analogs.",
    accent: "#a78bfa",
    recommendedPresets: ["rr9-multimodal-retina", "rr18-brain-buoe", "sex-epigenetic-eye"],
    contributorGroup: "Animal AWG",
    radarKeywords: ["rodent", "mouse", "mice", "rat", "rr-9", "rr-18", "animal", "retina", "brain"],
  },
  {
    id: "Plant AWG",
    shortLabel: "Plant",
    title: "Plant AWG",
    description: "Spaceflight plant biology, Arabidopsis, BRIC, VEGGIE & gravity/root transcriptomics.",
    accent: "#34d399",
    recommendedPresets: ["flight-vs-sans-analog"],
    contributorGroup: "Plant AWG",
    radarKeywords: ["plant", "arabidopsis", "bric", "veggie", "crop", "botany"],
  },
  {
    id: "Multi-Omics / Systems Biology AWG",
    shortLabel: "Multi-Omics",
    title: "Multi-Omics / Systems Biology AWG",
    description: "Cross-layer RNA-seq, methylation (RRBS), spatial proteomics & metabolomics integration.",
    accent: "#60a5fa",
    recommendedPresets: ["rr9-multimodal-retina", "sex-epigenetic-eye", "rr18-brain-buoe"],
    contributorGroup: "Multi-Omics / Systems Biology AWG",
    radarKeywords: ["multi-omics", "systems", "transcriptomics", "epigenetic", "methylation", "spatial"],
  },
  {
    id: "Microbes AWG",
    shortLabel: "Microbes",
    title: "Microbes AWG",
    description: "Spaceflight microbiome, ISS habitat flora, metagenomics & microbial adaptation.",
    accent: "#2dd4bf",
    recommendedPresets: ["sex-epigenetic-eye"],
    contributorGroup: "Microbes AWG",
    radarKeywords: ["microbe", "microbiome", "metagenomics", "bacteria", "fungi"],
  },
  {
    id: "Human / Clinical Spaceflight AWG",
    shortLabel: "Human / SANS",
    title: "Human / Clinical Spaceflight AWG",
    description: "Astronaut health, SANS ocular physiology, circadian/sleep twins & Inspiration4 cohorts.",
    accent: "#f472b6",
    recommendedPresets: ["flight-vs-sans-analog", "rr9-multimodal-retina"],
    contributorGroup: "Human / Clinical Spaceflight AWG",
    radarKeywords: ["human", "clinical", "sans", "astronaut", "sleep", "circadian", "inspiration4"],
  },
  {
    id: "ALSDA / Biospecimen AWG",
    shortLabel: "ALSDA",
    title: "ALSDA / Biospecimen AWG",
    description: "Ames Life Sciences Data Archive, OCT/MRI phenotypic assays & biospecimen curation.",
    accent: "#fbbf24",
    recommendedPresets: ["rr9-multimodal-retina", "flight-vs-sans-analog"],
    contributorGroup: "Animal AWG",
    radarKeywords: ["alsda", "oct", "mri", "imaging", "biospecimen", "phenotype"],
  },
  {
    id: "Radiation / Space Health AWG",
    shortLabel: "Radiation",
    title: "Radiation / Space Health AWG",
    description: "Low-dose radiation (LDR), GCR/SPE space analogs, oxidative stress & BuOE rescue.",
    accent: "#fb923c",
    recommendedPresets: ["rr18-brain-buoe", "sex-epigenetic-eye"],
    contributorGroup: "Multi-Omics / Systems Biology AWG",
    radarKeywords: ["radiation", "buoe", "ldr", "oxidative", "countermeasure", "gcr"],
  },
  {
    id: "Independent / Academic Collaborator",
    shortLabel: "Collaborator",
    title: "Independent / Academic Collaborator",
    description: "Open-science contributors, university labs, JOSS reviewers & citizen bioinformaticians.",
    accent: "#94a3b8",
    recommendedPresets: ["rr9-multimodal-retina"],
    contributorGroup: "Independent / Academic Collaborator",
    radarKeywords: ["open science", "osdr", "fair", "benchmark"],
  },
];

export const VALID_SUBGROUP_IDS = new Set(AWG_PROFILE_SUBGROUPS.map((g) => g.id));

export const AVATAR_ACCENTS = [
  { id: "cyan", label: "Orbital Cyan", bg: "linear-gradient(135deg, #0284c7, #38bdf8)", ring: "#38bdf8" },
  { id: "violet", label: "Deep Nebula", bg: "linear-gradient(135deg, #6d28d9, #a78bfa)", ring: "#a78bfa" },
  { id: "emerald", label: "Bio Flora", bg: "linear-gradient(135deg, #059669, #34d399)", ring: "#34d399" },
  { id: "amber", label: "Solar Telemetry", bg: "linear-gradient(135deg, #d97706, #fbbf24)", ring: "#fbbf24" },
  { id: "rose", label: "SANS Signal", bg: "linear-gradient(135deg, #be185d, #f472b6)", ring: "#f472b6" },
  { id: "slate", label: "Lunar Slate", bg: "linear-gradient(135deg, #334155, #94a3b8)", ring: "#94a3b8" },
];

export const RESEARCH_FOCUS_OPTIONS = [
  {
    id: "multi-omics",
    label: "Cross-Study Multi-Omics & AWG Comparisons",
    description: "Compare paired OSDR accessions across RNA-seq, epigenomics, proteomics, and imaging.",
  },
  {
    id: "digital-twins",
    label: "Digital Twins & AI/ML Benchmarks",
    description: "Explore RetinaCellTwin, SpaceSleepTwin, and schema-aligned contributor models.",
  },
  {
    id: "release-radar",
    label: "Pre-OSDR & Ryan Scholar Release Watch",
    description: "Track fresh 8-hour OSDR study releases, NTRS preprints, and AWG chair publications.",
  },
  {
    id: "study-discovery",
    label: "OSDR Study Discovery & Evidence Search",
    description: "Search NASA GeneLab / OSDR datasets with evidence-grounded citations and exports.",
  },
];

export const HOME_RESEARCH_PRESETS = [
  {
    id: "rr9-multimodal-retina",
    command: "/awg preset rr9-multimodal-retina",
    label: "RR-9 Multi-Modal Retina Integration · OSD-255 / 557 / 583",
    subgroups: ["AIML AWG", "Animal AWG", "Multi-Omics / Systems Biology AWG", "Human / Clinical Spaceflight AWG", "ALSDA / Biospecimen AWG", "Independent / Academic Collaborator"],
  },
  {
    id: "sex-epigenetic-eye",
    command: "/awg preset sex-epigenetic-eye",
    label: "Sex & Epigenetic Regulation in Spaceflown Eye · OSD-194 / 100 / 255",
    subgroups: ["Animal AWG", "Multi-Omics / Systems Biology AWG", "Microbes AWG", "Radiation / Space Health AWG"],
  },
  {
    id: "rr18-brain-buoe",
    command: "/awg preset rr18-brain-buoe",
    label: "RR-18 Brain Spatial Transcriptomics & BuOE Rescue · OSD-685 / 698",
    subgroups: ["Animal AWG", "Multi-Omics / Systems Biology AWG", "Radiation / Space Health AWG"],
  },
  {
    id: "flight-vs-sans-analog",
    command: "/awg preset flight-vs-sans-analog",
    label: "Spaceflight vs. Ground-Based SANS Analogs · OSD-680 / 557 / 583",
    subgroups: ["AIML AWG", "Human / Clinical Spaceflight AWG", "ALSDA / Biospecimen AWG", "Plant AWG"],
  },
];

function safeStr(value, maxLen = 180) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

/**
 * Normalize an ORCID input (accepts bare `0000-0002-1825-0097` or full URL).
 */
export function normalizeOrcid(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  const stripped = trimmed
    .replace(/^https?:\/\/(www\.)?orcid\.org\//i, "")
    .replace(/\/+$/, "")
    .toUpperCase();
  return stripped.slice(0, 24);
}

/**
 * Validate optional ORCID format (`0000-0000-0000-000X`). Blank is valid.
 */
export function validateOrcidFormat(raw) {
  const normalized = normalizeOrcid(raw);
  if (!normalized) return { valid: true, normalized: "", error: "" };
  const pattern = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;
  if (!pattern.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: "ORCID should follow 0000-0000-0000-0000 (or leave blank).",
    };
  }
  return { valid: true, normalized, error: "" };
}

export function normalizeForumHandle(raw) {
  const cleaned = safeStr(raw, 48).replace(/\s+/g, "");
  if (!cleaned) return "";
  return cleaned.startsWith("@") ? cleaned : `@${cleaned}`;
}

export function sanitizeSubgroupList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const id = String(item || "").trim();
    if (VALID_SUBGROUP_IDS.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export function getAvatarAccentSpec(accentId) {
  return AVATAR_ACCENTS.find((a) => a.id === accentId) || AVATAR_ACCENTS[0];
}

export function getSubgroupSpec(subgroupId) {
  return AWG_PROFILE_SUBGROUPS.find((g) => g.id === subgroupId) || null;
}

export function computeProfileInitials(profile, firebaseUser = null) {
  const customBadge = safeStr(profile?.avatarBadge || "", 3).toUpperCase();
  if (customBadge) return customBadge;
  const source =
    safeStr(profile?.displayName || "", 80) ||
    safeStr(firebaseUser?.displayName || "", 80) ||
    safeStr(firebaseUser?.email || "", 80) ||
    "OS";
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function createDefaultResearcherProfile(uid, firebaseUser = null) {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    storageMode: "local_uid_v1",
    uid: String(uid || "").trim(),
    displayName: safeStr(firebaseUser?.displayName || "", 80),
    email: safeStr(firebaseUser?.email || "", 120),
    affiliation: "",
    roleTitle: "",
    orcid: "",
    forumHandle: "",
    bio: "",
    avatarAccent: "cyan",
    avatarBadge: "",
    awgSubgroups: [],
    researchFocus: "multi-omics",
    preferredModel: "",
    defaultAwgMode: false,
    onboardingCompleted: false,
    onboardingDismissed: false,
    updatedAt: "",
  };
}

function resolveStorage(customStorage) {
  if (customStorage) return customStorage;
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export function getProfileStorageKey(uid) {
  return `${PROFILE_STORAGE_PREFIX}${String(uid || "").trim()}`;
}

export function sanitizeProfileRecord(uid, raw, firebaseUser = null) {
  const base = createDefaultResearcherProfile(uid, firebaseUser);
  const src = raw && typeof raw === "object" ? raw : {};

  const validAccentIds = new Set(AVATAR_ACCENTS.map((a) => a.id));
  const validFocusIds = new Set(RESEARCH_FOCUS_OPTIONS.map((f) => f.id));

  const displayName = safeStr(src.displayName, 80) || base.displayName;
  const orcidCheck = validateOrcidFormat(src.orcid);

  return {
    ...base,
    uid: base.uid,
    displayName,
    email: safeStr(firebaseUser?.email || src.email || base.email, 120),
    affiliation: safeStr(src.affiliation, 120),
    roleTitle: safeStr(src.roleTitle, 80),
    orcid: orcidCheck.valid ? orcidCheck.normalized : "",
    forumHandle: normalizeForumHandle(src.forumHandle),
    bio: safeStr(src.bio, 260),
    avatarAccent: validAccentIds.has(src.avatarAccent) ? src.avatarAccent : base.avatarAccent,
    avatarBadge: safeStr(src.avatarBadge, 3).toUpperCase(),
    awgSubgroups: sanitizeSubgroupList(src.awgSubgroups),
    researchFocus: validFocusIds.has(src.researchFocus) ? src.researchFocus : base.researchFocus,
    preferredModel: safeStr(src.preferredModel, 96),
    defaultAwgMode: Boolean(src.defaultAwgMode),
    onboardingCompleted: Boolean(src.onboardingCompleted),
    onboardingDismissed: Boolean(src.onboardingDismissed),
    updatedAt: typeof src.updatedAt === "string" ? src.updatedAt : "",
  };
}

export function loadResearcherProfile(uid, firebaseUser = null, customStorage = null) {
  const cleanUid = String(uid || "").trim();
  if (!cleanUid) return null;
  const storage = resolveStorage(customStorage);
  if (!storage) {
    return createDefaultResearcherProfile(cleanUid, firebaseUser);
  }
  try {
    const raw = storage.getItem(getProfileStorageKey(cleanUid));
    if (!raw) {
      return createDefaultResearcherProfile(cleanUid, firebaseUser);
    }
    const parsed = JSON.parse(raw);
    return sanitizeProfileRecord(cleanUid, parsed, firebaseUser);
  } catch {
    return createDefaultResearcherProfile(cleanUid, firebaseUser);
  }
}

export function saveResearcherProfile(uid, patch, firebaseUser = null, customStorage = null) {
  const cleanUid = String(uid || "").trim();
  if (!cleanUid) {
    throw new Error("Cannot save researcher profile without a valid Firebase UID.");
  }
  const existing = loadResearcherProfile(cleanUid, firebaseUser, customStorage);
  const merged = sanitizeProfileRecord(
    cleanUid,
    {
      ...existing,
      ...(patch || {}),
      updatedAt: new Date().toISOString(),
    },
    firebaseUser
  );
  const storage = resolveStorage(customStorage);
  if (storage) {
    storage.setItem(getProfileStorageKey(cleanUid), JSON.stringify(merged));
  }
  return merged;
}

export function deleteResearcherProfile(uid, customStorage = null) {
  const cleanUid = String(uid || "").trim();
  if (!cleanUid) return false;
  const storage = resolveStorage(customStorage);
  if (storage) {
    storage.removeItem(getProfileStorageKey(cleanUid));
  }
  return true;
}

export function exportResearcherProfilePayload(profile) {
  if (!profile) return null;
  return {
    exportFormat: "osdr_researcher_profile_v1",
    exportedAt: new Date().toISOString(),
    profile: {
      displayName: profile.displayName || "",
      affiliation: profile.affiliation || "",
      roleTitle: profile.roleTitle || "",
      orcid: profile.orcid || "",
      forumHandle: profile.forumHandle || "",
      bio: profile.bio || "",
      avatarAccent: profile.avatarAccent || "cyan",
      avatarBadge: profile.avatarBadge || "",
      awgSubgroups: sanitizeSubgroupList(profile.awgSubgroups),
      researchFocus: profile.researchFocus || "multi-omics",
      preferredModel: profile.preferredModel || "",
      defaultAwgMode: Boolean(profile.defaultAwgMode),
      onboardingCompleted: true,
    },
  };
}

export function parseImportedResearcherProfile(rawText, uid, firebaseUser = null) {
  let parsed;
  try {
    parsed = typeof rawText === "string" ? JSON.parse(rawText) : rawText;
  } catch {
    throw new Error("Invalid JSON file. Choose a valid OSDR researcher profile export (.json).");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Profile JSON must be an object.");
  }
  const candidate = parsed.profile && typeof parsed.profile === "object" ? parsed.profile : parsed;
  const hasAnyKnownField =
    Array.isArray(candidate.awgSubgroups) ||
    typeof candidate.displayName === "string" ||
    typeof candidate.affiliation === "string" ||
    typeof candidate.orcid === "string" ||
    typeof candidate.researchFocus === "string";

  if (!hasAnyKnownField) {
    throw new Error("JSON file does not contain recognized OSDR researcher profile fields.");
  }
  return sanitizeProfileRecord(
    uid,
    {
      ...candidate,
      onboardingCompleted: true,
      onboardingDismissed: false,
      updatedAt: new Date().toISOString(),
    },
    firebaseUser
  );
}

/**
 * Sort Home Launchpad AWG Research Presets so presets aligned with the user's
 * checked AWG subgroups appear first with a matched badge.
 */
export function getPersonalizedPresetsForProfile(profile) {
  const checked = new Set(sanitizeSubgroupList(profile?.awgSubgroups));
  if (!checked.size) {
    return HOME_RESEARCH_PRESETS.map((p) => ({ ...p, matchedSubgroups: [], isMatched: false }));
  }
  const enriched = HOME_RESEARCH_PRESETS.map((preset) => {
    const matchedSubgroups = preset.subgroups.filter((sg) => checked.has(sg));
    return {
      ...preset,
      matchedSubgroups,
      isMatched: matchedSubgroups.length > 0,
    };
  });
  return enriched.sort((a, b) => b.matchedSubgroups.length - a.matchedSubgroups.length);
}

/**
 * Map a saved researcher profile to Contributor Hub intake form defaults.
 */
export function mapProfileToContributorDefaults(profile) {
  if (!profile) return null;
  const subgroups = sanitizeSubgroupList(profile.awgSubgroups);
  const firstSpec = subgroups.length ? getSubgroupSpec(subgroups[0]) : null;
  return {
    contributorName: profile.displayName || "",
    forumHandle: profile.forumHandle || "",
    awgSubgroup: firstSpec?.contributorGroup || "AIML AWG",
    affiliation: [profile.affiliation, profile.orcid ? `ORCID: ${profile.orcid}` : ""]
      .filter(Boolean)
      .join(" · "),
  };
}
