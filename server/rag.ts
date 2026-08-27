import { OSDRStudy } from "./studiesData";
import {
  getAllStudies,
  getStudyById,
  fetchLiveOSDRStudy,
  searchLiveOSDR,
  testOsdrLiveConnection,
  getDiagnostics,
  OSDR_ENDPOINTS,
} from "./osdrClient";

export {
  getAllStudies,
  getStudyById,
  fetchLiveOSDRStudy,
  searchLiveOSDR,
  testOsdrLiveConnection,
  getDiagnostics,
  OSDR_ENDPOINTS,
};
export type { OSDRStudy };

export const SYSTEM_PROMPT = `You are an expert scientific assistant specializing in NASA's Open Science Data Repository (OSDR) and space biology / space medicine.

You are given metadata retrieved from OSDR studies relevant to the user's question.

When answering:
- Cite specific OSD study IDs (e.g. OSD-87, OSD-679) when relevant
- Distinguish between human studies and animal/microbial models
- Note whether data comes from actual spaceflight vs. ground-based analogs (head-down tilt, hindlimb unloading)
- Be precise about assay types (RNA-seq, proteomics, histology, IOP measurements, etc.)
- If the retrieved context does not answer the question, say so — do not fabricate study details

The retrieved OSDR context is provided below.`;

export interface SearchResult {
  study_id: string;
  title: string;
  score: number;
}

export function searchStudies(query: string, topK: number = 10): SearchResult[] {
  const q = query.toLowerCase().trim();
  const allStudies = getAllStudies();

  if (!q) {
    return allStudies.slice(0, topK).map((s) => ({
      study_id: s.study_id,
      title: s.title,
      score: 1.0,
    }));
  }

  // Tokenize query words
  const tokens = q.split(/\s+/).filter((t) => t.length > 1);
  const explicitOSDMatch = q.match(/osd-?\d+/gi);

  const scored: SearchResult[] = [];

  for (const s of allStudies) {
    let score = 0;
    const sid = s.study_id.toLowerCase();
    const title = s.title.toLowerCase();
    const desc = s.description.toLowerCase();
    const organism = s.organism.toLowerCase();
    const assay = (s.assay_measurement + " " + s.assay_technology + " " + s.assay_platform).toLowerCase();
    const mission = (s.mission + " " + s.flight_program).toLowerCase();
    const factor = s.study_factor.toLowerCase();

    // Check explicit OSD match
    if (explicitOSDMatch) {
      for (const m of explicitOSDMatch) {
        const normM = m.replace("-", "");
        const normSid = sid.replace("-", "");
        if (normSid.includes(normM)) {
          score += 50;
        }
      }
    }

    if (sid.includes(q)) score += 30;
    if (title.includes(q)) score += 20;
    if (desc.includes(q)) score += 10;

    for (const token of tokens) {
      if (sid.includes(token)) score += 15;
      if (title.includes(token)) score += 8;
      if (organism.includes(token)) score += 6;
      if (assay.includes(token)) score += 5;
      if (factor.includes(token)) score += 4;
      if (mission.includes(token)) score += 4;
      if (desc.includes(token)) score += 2;
    }

    if (score > 0) {
      scored.push({
        study_id: s.study_id,
        title: s.title,
        score: Math.min(1.0, Number((score / 30).toFixed(3))),
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // If query is broad or no matches found, fallback to initial top items
  if (scored.length === 0) {
    return allStudies.slice(0, topK).map((s) => ({
      study_id: s.study_id,
      title: s.title,
      score: 0.1,
    }));
  }

  return scored.slice(0, topK);
}

export async function buildContextAsync(
  query: string,
  topK: number = 8
): Promise<{ context: string; sources: string[] }> {
  // If user mentioned explicit OSD IDs not yet in memory, fetch live from NASA OSDR
  const explicitMatches = query.match(/osd-?\d+/gi);
  if (explicitMatches) {
    for (const m of explicitMatches) {
      const num = m.replace(/[^0-9]/g, "");
      const normId = `OSD-${num}`;
      if (!getStudyById(normId)) {
        await fetchLiveOSDRStudy(normId);
      }
    }
  }

  // If local search doesn't find high-relevance matches, attempt live query against OSDR public search
  let results = searchStudies(query, topK);
  const bestScore = results[0]?.score || 0;
  if (bestScore < 0.35 && query.trim().length > 3) {
    const liveHits = await searchLiveOSDR(query, topK);
    if (liveHits.length > 0) {
      results = searchStudies(query, topK);
    }
  }

  if (!results.length) {
    return { context: "", sources: [] };
  }

  const sources = results.map((r) => r.study_id);
  const lines: string[] = [`Retrieved metadata from ${sources.length} OSDR studies:\n`];

  for (const sid of sources) {
    const s = getStudyById(sid);
    if (!s) continue;
    lines.push(`\n[${s.study_id}] ${s.title}`);
    lines.push(`  Organism: ${s.organism} | Tissue/Material: ${s.material_type}`);
    lines.push(`  Assay: ${s.assay_measurement} / ${s.assay_platform} (${s.assay_technology})`);
    lines.push(`  Factor: ${s.study_factor} | Mission: ${s.mission} | Flight program: ${s.flight_program}`);
    if (s.publication_title) {
      lines.push(`  Publication: ${s.publication_title} (${s.publication_authors})`);
    }
    lines.push(`  Description: ${s.description}`);
    lines.push(`  Files: ${s.file_count} total files available in OSDR repository`);
    if (s.source_type) {
      lines.push(`  Source Mode: ${s.source_type}`);
    }
  }

  return {
    context: lines.join("\n"),
    sources,
  };
}

export function buildContext(query: string, topK: number = 8): { context: string; sources: string[] } {
  const results = searchStudies(query, topK);
  if (!results.length) {
    return { context: "", sources: [] };
  }

  const sources = results.map((r) => r.study_id);
  const lines: string[] = [`Retrieved metadata from ${sources.length} OSDR studies:\n`];

  for (const sid of sources) {
    const s = getStudyById(sid);
    if (!s) continue;
    lines.push(`\n[${s.study_id}] ${s.title}`);
    lines.push(`  Organism: ${s.organism} | Tissue/Material: ${s.material_type}`);
    lines.push(`  Assay: ${s.assay_measurement} / ${s.assay_platform} (${s.assay_technology})`);
    lines.push(`  Factor: ${s.study_factor} | Mission: ${s.mission} | Flight program: ${s.flight_program}`);
    if (s.publication_title) {
      lines.push(`  Publication: ${s.publication_title} (${s.publication_authors})`);
    }
    lines.push(`  Description: ${s.description}`);
    lines.push(`  Files: ${s.file_count} total files available in OSDR repository`);
  }

  return {
    context: lines.join("\n"),
    sources,
  };
}
