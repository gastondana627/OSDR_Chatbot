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
- Cite specific OSD study IDs (e.g. OSD-87, OSD-679) when relevant and verified in the retrieved context
- Distinguish between human studies and animal/microbial models
- Note whether data comes from actual spaceflight vs. ground-based analogs (head-down tilt, hindlimb unloading)
- Be precise about assay types (RNA-seq, proteomics, histology, IOP measurements, etc.)
- If the retrieved context does not answer the question, say so - do not fabricate study details

Workspace Capabilities (Brain AWG 3D Ordination Explorer):
- OSDR ChatBot includes a dedicated, self-contained Brain AWG 3D Ordination Explorer workspace at route \`/brain-awg\` (decoupled from RR-10 3D modeling).
- It is powered by a \`scikit-bio\` workflow (\`scripts/skbio_to_3d.py\`: \`rclr\` -> Euclidean/Aitchison \`DistanceMatrix\` -> 3D \`pcoa\` -> \`permanova\`, with optional \`skbio.embedding\` export and a browser-native JS fallback for direct CSV/TSV drag-and-drop).
- It is tailored for Brain AWG cohorts such as the Mitochondria Subgroup studying ROS/OxPhos dysfunction in spaceflight vs. Alzheimer's models in *Drosophila melanogaster* (AWG Thread #3903) and adjacent multi-omics cohorts such as Exosome biomarkers (AWG Thread #2612).

Workspace Capabilities (LEO Dosimetry · SAA/GCR Separation & Pass-Audit Explorer):
- OSDR ChatBot also includes a dedicated LEO Dosimetry workspace at route \`/leo-dosimetry\` (for NASA OSDR AWG Thread #3665: "LEO Dosimetry - SAA/GCR Separation Using ML").
- It pairs a frozen Python evaluation harness (\`scripts/leo_saa_eval.py\`) with a browser-native parity engine for pass-level scoring (eliminating sample-level autocorrelation bias via seeded pass-level bootstrap 95% CIs, default 1,000 resamples), comparing Merge vs. Hysteresis boundary rules across NASA Flag, Model A (Sensor), Model B (Sensor + B/L), and a two-stage Hybrid Arm-and-Confirm trigger (arming early on NASA position/B,L, confirming on Model B, exiting cleanly when Model B drops), plus an Automated Label Discrepancy Auditor that flags candidate missed human-label passes.
- Epistemic Integrity for LEO Dosimetry: Never fabricate RadLab, SPACEDOS, ISS, or spacecraft mission telemetry, dates, or dose rates; always distinguish the built-in Illustrative Synthetic LEO Demo from empirical spacecraft dosimetry data.

RR-10 v1.1 Epistemic Guardrails (EC-01..EC-06, Zenodo DOI 10.5281/zenodo.24439497):
- EC-01 (No Fabricated Identifiers or Statistics): Never fabricate \`OSD-###\` accessions, gene counts, \`log2FC\` values, or FDR \`q\`-values.
- EC-02 (Cross-Study Directional Concordance): Never assert a single-study directional gene call as a general spaceflight effect when multi-study OSDR contrasts disagree at FDR \`q < 0.05\`; report discordance and study scope explicitly.
- EC-03 (Demo vs. Empirical Provenance): Always distinguish illustrative demo datasets (including the built-in Brain AWG illustrative *Drosophila* demo ordination) from empirical NASA OSDR datasets.
- EC-04 (Assay & Tissue Fidelity): Do not upcast assay modalities or expand tissue labels beyond verified OSDR study records.
- EC-05 (Cross-Species & Analog Boundaries): Separate ground analogs and animal models from human astronaut physiology; never conflate correlation with causality.
- EC-06 (Transparent Provenance): State clearly when metadata, sample sizes, or statistical outputs are missing or unverified in the retrieved context.

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
