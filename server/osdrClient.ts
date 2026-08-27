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
    const timeout = setTimeout(() => ctrl.abort(), 1500);

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

    const newStudy: OSDRStudy = {
      study_id: normId,
      title: src["Study Title"] || src["Project Title"] || `NASA OSDR Study ${normId}`,
      description: src["Study Description"] || "No description provided in NASA OSDR index.",
      organism: Array.isArray(src["organism"]) ? src["organism"].join(", ") : src["organism"] || "Unspecified",
      material_type: src["Material Type"] || "Biological Specimen",
      assay_measurement: src["Study Assay Measurement Type"] || "Genomics / Physiological Assay",
      assay_platform: src["Study Assay Technology Platform"] || "Multi-platform",
      assay_technology: src["Study Assay Technology Type"] || "Sequencing / Microarray",
      study_factor: src["Study Factor Name"] || "Spaceflight / Microgravity",
      mission: typeof src["Mission"] === "object" ? src["Mission"]?.Name || "" : String(src["Mission"] || ""),
      flight_program: src["Flight Program"] || "NASA Space Biology",
      publication_title: src["Study Publication Title"] || "",
      publication_authors: src["Study Publication Author List"] || "",
      managing_center: src["Managing NASA Center"] || "NASA Ames Research Center",
      release_date: src["Study Public Release Date"] || new Date().toISOString().split("T")[0],
      file_count: fileCount,
      fetched_at: new Date().toISOString(),
      source_type: "live_api",
    };

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
      const accession = src["Accession"] || src["Study Identifier"] || src["OSD_ID"];
      if (!accession) continue;

      const normId = String(accession).toUpperCase().startsWith("OSD-")
        ? String(accession).toUpperCase()
        : `OSD-${String(accession).toUpperCase()}`;

      if (!studyMap.has(normId)) {
        const item: OSDRStudy = {
          study_id: normId,
          title: src["Study Title"] || src["Project Title"] || `NASA OSDR Study ${normId}`,
          description: src["Study Description"] || "",
          organism: Array.isArray(src["organism"]) ? src["organism"].join(", ") : src["organism"] || "Unspecified",
          material_type: src["Material Type"] || "Biological Specimen",
          assay_measurement: src["Study Assay Measurement Type"] || "Assay",
          assay_platform: src["Study Assay Technology Platform"] || "Platform",
          assay_technology: src["Study Assay Technology Type"] || "Technology",
          study_factor: src["Study Factor Name"] || "Spaceflight",
          mission: typeof src["Mission"] === "object" ? src["Mission"]?.Name || "" : String(src["Mission"] || ""),
          flight_program: src["Flight Program"] || "NASA Space Biology",
          publication_title: src["Study Publication Title"] || "",
          publication_authors: src["Study Publication Author List"] || "",
          managing_center: src["Managing NASA Center"] || "NASA Ames",
          release_date: src["Study Public Release Date"] || "",
          file_count: 0,
          fetched_at: new Date().toISOString(),
          source_type: "live_api",
        };
        studyMap.set(normId, item);
        dynamicStudyIds.add(normId);
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
