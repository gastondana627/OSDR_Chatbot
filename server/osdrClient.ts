import { INITIAL_STUDIES, OSDRStudy } from "./studiesData";

export interface OsdrDiagnostics {
  sourceMode: "live_api" | "cached_snapshot" | "local_curated_mapping" | "hybrid_live_with_fallback";
  connectionStatus: "connected" | "offline" | "degraded" | "untested";
  lastCheckedAt: string | null;
  lastSuccessfulFetch: string | null;
  lastFetchError: string | null;
  latencyMs: number | null;
  activeEndpoints: {
    search: string;
    studyMeta: string;
    studyFiles: string;
  };
  dataSources: {
    static_seeded_examples: {
      count: number;
      description: string;
      studies: string[];
    };
    local_curated_mapping: {
      count: number;
      description: string;
    };
    cached_snapshot: {
      count: number;
      description: string;
      dynamicStudyIds: string[];
    };
    live_api: {
      enabled: boolean;
      active: boolean;
      description: string;
      totalRuntimeFetches: number;
      failedRuntimeFetches: number;
    };
  };
}

// In-memory study cache indexed by normalized study_id (e.g. "OSD-679")
const studyMap = new Map<string, OSDRStudy>();
const seededStudyIds: string[] = [];
const dynamicStudyIds = new Set<string>();

for (const s of INITIAL_STUDIES) {
  const norm = s.study_id.toUpperCase();
  studyMap.set(norm, { ...s, source_type: "static_seeded_example" });
  seededStudyIds.push(norm);
}

// Connection tracker state
let connectionStatus: "connected" | "offline" | "degraded" | "untested" = "untested";
let lastCheckedAt: string | null = null;
let lastSuccessfulFetch: string | null = null;
let lastFetchError: string | null = null;
let lastLatencyMs: number | null = null;
let totalRuntimeFetches = 0;
let failedRuntimeFetches = 0;

export const OSDR_ENDPOINTS = {
  search: "https://osdr.nasa.gov/osdr/data/search",
  studyMeta: "https://osdr.nasa.gov/osdr/data/osd/meta",
  studyFiles: "https://osdr.nasa.gov/osdr/data/osd/files",
};

/**
 * Safely flatten string / string[] / object values returned by OSDR Elasticsearch _source fields.
 */
export function asCleanText(val: unknown, fallback: string = ""): string {
  if (val == null) return fallback;
  if (typeof val === "string") return val.trim() || fallback;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) {
    const parts = val
      .map((item) => asCleanText(item, ""))
      .filter((s) => s.length > 0);
    const unique = Array.from(new Set(parts));
    return unique.length > 0 ? unique.join(", ") : fallback;
  }
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (obj["First Name"] != null || obj["Last Name"] != null) {
      const fn = asCleanText(obj["First Name"], "");
      const ln = asCleanText(obj["Last Name"], "");
      const combined = `${fn} ${ln}`.trim();
      if (combined) return combined;
    }
    const candidate = obj.Name || obj.name || obj.title || obj.label || obj.value;
    if (candidate != null) return asCleanText(candidate, fallback);
  }
  return fallback;
}

/**
 * Normalize NASA OSDR Study Public Release Date (often Unix epoch seconds/float strings like
 * "1741564800.0" or sentinel "0000000000") into clean ISO YYYY-MM-DD (or "" if unset).
 */
export function normalizeOsdrReleaseDate(raw: unknown): string {
  if (raw == null) return "";
  const str = String(raw).trim();
  if (!str || /^0+(\.0+)?$/.test(str)) return "";

  const isoMatch = str.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/);
  if (isoMatch) return isoMatch[1];

  const slashMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[1]}-${slashMatch[2]}`;
  }

  if (/^\d+(?:\.\d+)?$/.test(str)) {
    const num = Number(str);
    if (!Number.isFinite(num) || num <= 0) return "";
    // Epoch milliseconds if > 1e11, otherwise seconds if > 1e8 (after ~1973)
    const ms = num > 1e11 ? num : num > 1e8 ? num * 1000 : NaN;
    if (Number.isNaN(ms)) return "";
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    const yr = d.getUTCFullYear();
    if (yr < 1995 || yr > 2100) return "";
    return d.toISOString().slice(0, 10);
  }

  const parsed = Date.parse(str);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    const yr = d.getUTCFullYear();
    if (yr >= 1995 && yr <= 2100) {
      return d.toISOString().slice(0, 10);
    }
  }
  return "";
}

/**
 * Normalize an OSDR accession strictly to OSD-<digits>. Returns null for federated
 * external repository IDs (e.g., PRIDE PXD*, MGnify mgp*, raw GEO GSE*).
 */
export function normalizeOsdrAccession(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase();
  const osdMatch = s.match(/^OSD[-_]?(\d+)$/);
  if (osdMatch) return `OSD-${osdMatch[1]}`;
  return null;
}

/**
 * Convert an OSDR Elasticsearch `_source` hit into a clean `OSDRStudy` object.
 * Returns null if the hit is from a non-OSDR external repository without an `OSD-*` accession.
 */
export function osdrSourceToStudy(
  src: Record<string, any>,
  options: {
    forcedStudyId?: string;
    fileCount?: number;
    sourceType?: OSDRStudy["source_type"];
  } = {}
): OSDRStudy | null {
  const rawAcc = src["Accession"] || src["Study Identifier"] || src["OSD_ID"];
  const normId =
    options.forcedStudyId ||
    normalizeOsdrAccession(rawAcc);
  if (!normId) return null;

  const dataSrcType = asCleanText(src["Data Source Type"]).toLowerCase();
  if (dataSrcType && dataSrcType !== "cgene" && dataSrcType !== "alsda" && !options.forcedStudyId) {
    return null;
  }

  const missionObj = src["Mission"];
  const missionName =
    typeof missionObj === "object" && missionObj !== null && !Array.isArray(missionObj)
      ? asCleanText(missionObj.Name || missionObj.name)
      : asCleanText(missionObj);

  const rawDoi = asCleanText(src["Study Publication DOI"] || src["DOI"] || "");
  const cleanDoi = rawDoi ? rawDoi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim() : undefined;

  return {
    study_id: normId,
    title: asCleanText(src["Study Title"] || src["Project Title"], `NASA OSDR Study ${normId}`),
    description: asCleanText(src["Study Description"], "No description provided in NASA OSDR index."),
    organism: asCleanText(src["organism"], "Unspecified"),
    material_type: asCleanText(src["Material Type"], "Biological Specimen"),
    assay_measurement: asCleanText(src["Study Assay Measurement Type"], "Genomics / Physiological Assay"),
    assay_platform: asCleanText(src["Study Assay Technology Platform"], "Multi-platform"),
    assay_technology: asCleanText(src["Study Assay Technology Type"], "Sequencing / Assay"),
    study_factor: asCleanText(src["Study Factor Name"] || src["Factor Value"], "Spaceflight / Microgravity"),
    mission: missionName,
    flight_program: asCleanText(src["Flight Program"] || src["Project Type"], dataSrcType === "alsda" ? "NASA ALSDA / HRP" : "NASA Space Biology"),
    publication_title: asCleanText(src["Study Publication Title"]),
    publication_authors: asCleanText(src["Study Publication Author List"] || src["Study Person"]),
    managing_center: asCleanText(src["Managing NASA Center"], "NASA Ames Research Center"),
    release_date: normalizeOsdrReleaseDate(src["Study Public Release Date"]),
    doi: cleanDoi,
    file_count: options.fileCount ?? 0,
    fetched_at: new Date().toISOString(),
    source_type: options.sourceType || "live_api",
  };
}

/**
 * Bulk-register snapshot or radar studies into the in-memory index without overwriting
 * rich curated benchmarks or polluting runtime dynamic session fetch lists.
 */
export function upsertOsdrStudies(studies: OSDRStudy[]): number {
  let added = 0;
  for (const s of studies) {
    if (!s?.study_id) continue;
    const norm = s.study_id.toUpperCase();
    if (!studyMap.has(norm)) {
      studyMap.set(norm, { ...s, study_id: norm, source_type: s.source_type || "cached_snapshot" });
      added++;
    }
  }
  return added;
}

/**
 * Ping NASA OSDR API to verify true runtime reachability
 */
export async function testOsdrLiveConnection(): Promise<{ success: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  lastCheckedAt = new Date().toISOString();

  try {
    const testUrl = `${OSDR_ENDPOINTS.search}?ffield=Accession&fvalue=OSD-679&size=1&from=0`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);

    const res = await fetch(testUrl, {
      headers: { "User-Agent": "NASA-OSDR-ChatBot/1.0" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    const latency = Date.now() - start;
    lastLatencyMs = latency;

    if (res.ok) {
      const data = await res.json();
      const hits = data?.hits?.hits || [];
      if (hits.length > 0) {
        connectionStatus = "connected";
        lastSuccessfulFetch = new Date().toISOString();
        lastFetchError = null;
        return { success: true, latencyMs: latency };
      }
    }

    connectionStatus = "degraded";
    lastFetchError = `NASA OSDR returned HTTP ${res.status}: ${res.statusText}`;
    return { success: false, latencyMs: latency, error: lastFetchError };
  } catch (err: any) {
    const latency = Date.now() - start;
    lastLatencyMs = latency;
    connectionStatus = "offline";
    lastFetchError = err?.message || "Failed to reach NASA OSDR API";
    return { success: false, latencyMs: latency, error: lastFetchError };
  }
}

/**
 * Fetch a study dynamically from NASA OSDR at runtime
 */
export async function fetchLiveOSDRStudy(studyId: string): Promise<OSDRStudy | null> {
  const normId = studyId.toUpperCase().startsWith("OSD-") ? studyId.toUpperCase() : `OSD-${studyId.toUpperCase()}`;
  
  // If already in memory, return cached record
  if (studyMap.has(normId)) {
    return studyMap.get(normId)!;
  }

  totalRuntimeFetches++;
  const searchUrl = `${OSDR_ENDPOINTS.search}?ffield=Accession&fvalue=${encodeURIComponent(normId)}&size=1&from=0`;

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5000);

    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "NASA-OSDR-ChatBot/1.0" },
      signal: ctrl.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      failedRuntimeFetches++;
      lastFetchError = `HTTP ${res.status} fetching ${normId}`;
      return null;
    }

    const json = await res.json();
    const hits = json?.hits?.hits || [];
    if (!hits.length) {
      return null;
    }

    const src = hits[0]._source || {};
    const numericId = normId.replace("OSD-", "").trim();

    // Fetch live file count if available
    let fileCount = 0;
    try {
      const fRes = await fetch(`${OSDR_ENDPOINTS.studyFiles}/${numericId}/?page=1&size=20`, {
        headers: { "User-Agent": "NASA-OSDR-ChatBot/1.0" },
      });
      if (fRes.ok) {
        const fJson = await fRes.json();
        const studyData = fJson?.studies?.[normId] || {};
        fileCount = studyData.file_count || 0;
      }
    } catch {
      // Non-critical file count failure
    }

    const newStudy = osdrSourceToStudy(src, {
      forcedStudyId: normId,
      fileCount,
      sourceType: "live_api",
    });
    if (!newStudy) return null;

    studyMap.set(normId, newStudy);
    dynamicStudyIds.add(normId);
    connectionStatus = "connected";
    lastSuccessfulFetch = new Date().toISOString();
    lastFetchError = null;

    return newStudy;
  } catch (err: any) {
    failedRuntimeFetches++;
    lastFetchError = err?.message || `Network error fetching ${normId}`;
    return null;
  }
}

/**
 * Fetch keyword search hits dynamically from live NASA OSDR search index
 */
export async function searchLiveOSDR(query: string, size: number = 5): Promise<OSDRStudy[]> {
  if (!query || query.trim().length < 2) return [];

  totalRuntimeFetches++;
  const searchUrl = `${OSDR_ENDPOINTS.search}?term=${encodeURIComponent(query.trim())}&size=${size}&from=0`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);

    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "NASA-OSDR-ChatBot/1.0" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      failedRuntimeFetches++;
      return [];
    }

    const json = await res.json();
    const hits = json?.hits?.hits || [];
    const newStudies: OSDRStudy[] = [];

    for (const h of hits) {
      const src = h._source || {};
      const item = osdrSourceToStudy(src, { sourceType: "live_api" });
      if (!item) continue;

      if (!studyMap.has(item.study_id)) {
        studyMap.set(item.study_id, item);
        dynamicStudyIds.add(item.study_id);
        newStudies.push(item);
      }
    }

    if (hits.length > 0) {
      connectionStatus = "connected";
      lastSuccessfulFetch = new Date().toISOString();
      lastFetchError = null;
    }

    return newStudies;
  } catch (err: any) {
    failedRuntimeFetches++;
    lastFetchError = err?.message || "Error during live search";
    return [];
  }
}

export function getAllStudies(): OSDRStudy[] {
  return Array.from(studyMap.values());
}

export function getStudyById(id: string): OSDRStudy | undefined {
  const norm = id.toUpperCase().startsWith("OSD-") ? id.toUpperCase() : `OSD-${id.toUpperCase()}`;
  return studyMap.get(norm);
}

export function getDiagnostics(): OsdrDiagnostics {
  const isLive = connectionStatus === "connected" && lastSuccessfulFetch !== null;
  return {
    sourceMode: isLive ? "live_api" : "local_curated_mapping",
    connectionStatus,
    lastCheckedAt,
    lastSuccessfulFetch,
    lastFetchError,
    latencyMs: lastLatencyMs,
    activeEndpoints: {
      search: `${OSDR_ENDPOINTS.search}?ffield=Accession&fvalue={OSD_ID}&size=1`,
      studyMeta: `${OSDR_ENDPOINTS.studyMeta}/{numeric_id}`,
      studyFiles: `${OSDR_ENDPOINTS.studyFiles}/{numeric_id}/?page=1&size=20`,
    },
    dataSources: {
      static_seeded_examples: {
        count: seededStudyIds.length,
        description: "Pre-indexed high-fidelity NASA Space Biology & SANS studies with curated assays, factor vectors, and publication records.",
        studies: seededStudyIds,
      },
      local_curated_mapping: {
        count: studyMap.size,
        description: "In-memory fast retrieval index supporting instant zero-latency RAG keyword and semantic ranking.",
      },
      cached_snapshot: {
        count: dynamicStudyIds.size,
        description: "Dynamically resolved live study payloads cached in memory during active user session.",
        dynamicStudyIds: Array.from(dynamicStudyIds),
      },
      live_api: {
        enabled: true,
        active: connectionStatus === "connected",
        description: "Direct runtime REST fetch against NASA OSDR (osdr.nasa.gov) search and file endpoints.",
        totalRuntimeFetches,
        failedRuntimeFetches,
      },
    },
  };
}
