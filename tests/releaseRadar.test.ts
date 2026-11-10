import assert from "assert";
import http from "http";
import {
  AWG_LEAD_WATCHLIST,
  classifyOsdrSubgroup,
  classifyTimeWindow,
  evaluateSpaceBiologyScope,
  getRadarSnapshot,
  queryRadarSnapshot,
  scoreAgainstAnchors,
} from "../server/radar";
import { normalizeOsdrAccession, normalizeOsdrReleaseDate, osdrSourceToStudy } from "../server/osdrClient";
import { parseAwgQuery } from "../server/awg";
import { createExpressApp } from "../server/app";

async function runReleaseRadarTests() {
  console.log("▶ Running Release Radar & AWG Lead Watch Tests...\n");

  // -------------------------------------------------------------------------
  // Test 1: OSDR Accession & Release Date Normalization Guards
  // -------------------------------------------------------------------------
  console.log("Test 1: OSDR Normalization & Federated Repo Exclusion");
  assert.strictEqual(normalizeOsdrAccession("OSD-1018"), "OSD-1018");
  assert.strictEqual(normalizeOsdrAccession("osd_920"), "OSD-920");
  assert.strictEqual(normalizeOsdrAccession("PXD041234"), null, "Must exclude PRIDE PXD accessions");
  assert.strictEqual(normalizeOsdrAccession("mgp10234"), null, "Must exclude MGnify accessions");
  assert.strictEqual(normalizeOsdrAccession("GSE192412"), null, "Must exclude raw GEO GSE accessions");

  assert.strictEqual(normalizeOsdrReleaseDate("1741564800.0"), "2025-03-10");
  assert.strictEqual(normalizeOsdrReleaseDate("0000000000"), "");
  assert.strictEqual(normalizeOsdrReleaseDate("2026-11-04T00:00:00Z"), "2026-11-04");

  const nonOsdrHit = osdrSourceToStudy({
    Accession: "PXD050001",
    "Data Source Type": "pride",
    "Study Title": "External Proteomics Study",
  });
  assert.strictEqual(nonOsdrHit, null, "Federated external repo hits must not enter native OSDR releases");
  console.log("  ✔ Accessions, epoch dates, and external repository exclusions verified");

  // -------------------------------------------------------------------------
  // Test 2: Organism-First Subgroup Classification & Anchor Scoring Discipline
  // -------------------------------------------------------------------------
  console.log("Test 2: Subgroup Classification & Non-Mammalian Anchor Omission");
  const mockPlant = osdrSourceToStudy({
    Accession: "OSD-971",
    "Data Source Type": "cgene",
    "Study Title": "Genetic alterations of the putrescine pathway in Arabidopsis under spaceflight",
    "Study Description": "Relevant for future human life support bioregenerative systems.",
    organism: "Arabidopsis thaliana",
    "Material Type": "Seedling",
  })!;
  const plantClass = classifyOsdrSubgroup(mockPlant, "cgene");
  assert.strictEqual(plantClass.subgroup, "Plant");
  assert.strictEqual(plantClass.sansRelevant, false);
  assert.strictEqual(scoreAgainstAnchors(mockPlant, false), undefined, "Must NOT score plants against retinal anchors");

  const mockMicrobe = osdrSourceToStudy({
    Accession: "OSD-987",
    "Data Source Type": "cgene",
    "Study Title": "Streptococcus mutans growth-phase transcriptomics in simulated microgravity",
    "Study Description": "Oral pathogen implications for human crew health.",
    organism: "Streptococcus mutans",
    "Material Type": "Bacteria",
  })!;
  assert.strictEqual(classifyOsdrSubgroup(mockMicrobe, "cgene").subgroup, "Microbes");
  assert.strictEqual(scoreAgainstAnchors(mockMicrobe, false), undefined);

  const mockSans = osdrSourceToStudy({
    Accession: "OSD-920",
    "Data Source Type": "cgene",
    "Study Title": "Spaceflight induces systemic effects on retina and optic nerve extracellular matrix",
    organism: "Mus musculus",
    "Material Type": "Retina",
    "Study Factor Name": "Spaceflight",
  })!;
  const sansClass = classifyOsdrSubgroup(mockSans, "cgene");
  assert.strictEqual(sansClass.subgroup, "SANS / Ocular");
  assert.strictEqual(sansClass.sansRelevant, true);
  const sansAnchor = scoreAgainstAnchors(mockSans, true);
  assert.ok(sansAnchor && sansAnchor.comparabilityTier === "direct_retinal_sans");

  const mockAlzBrain = osdrSourceToStudy({
    Accession: "OSD-941",
    "Data Source Type": "cgene",
    "Study Title": "Spaceflight reshapes Alzheimer's disease molecular programs in human brain organoids",
    organism: "Homo sapiens",
    "Material Type": "Brain Organoid",
  })!;
  const alzAnchor = scoreAgainstAnchors(mockAlzBrain, false);
  assert.ok(alzAnchor && alzAnchor.comparabilityTier === "translational_mammalian");
  console.log("  ✔ Taxonomy classification, SANS detection, and honest anchor tiers verified");

  // -------------------------------------------------------------------------
  // Test 3: Strict Space Biology Domain Scope Guardrail & 9-Lead Watchlist
  // -------------------------------------------------------------------------
  console.log("Test 3: Strict Scope Guardrail & Verified 9 AWG Leads");
  assert.strictEqual(AWG_LEAD_WATCHLIST.length, 9, "Watchlist must contain 8 chairs + Ryan T. Scott");
  assert.ok(AWG_LEAD_WATCHLIST.some((l) => l.id === "ryan-scott" && l.spotlight === true));
  for (const l of AWG_LEAD_WATCHLIST) {
    assert.ok(/^\d{4}-\d{4}-\d{4}-[\dX]{4}$/.test(l.orcid), `Valid ORCID required for ${l.name}`);
  }

  const inScopePreprint = evaluateSpaceBiologyScope({
    title: "A systematic imputation framework for sparse, multimodal space biology datasets (RR9)",
    journal: "bioRxiv",
    summary: "Evaluates retinal imaging and transcriptomics under microgravity.",
  });
  assert.strictEqual(inScopePreprint.inScope, true);

  const offTopicClinical = evaluateSpaceBiologyScope({
    title: "Retrospective outcome evaluation of orthopedic bunionette osteotomy in outpatient podiatry",
    journal: "Foot & Ankle Surgery",
    summary: "Single-center retrospective clinical chart review.",
  });
  assert.strictEqual(offTopicClinical.inScope, false, "Off-topic clinical paper must be excluded");

  const offTopicTerrestrial = evaluateSpaceBiologyScope({
    title: "Patterns of carbon storage across boreal forests in Ontario",
    journal: "Forest Ecology",
    summary: "Field soil plots sampled annually.",
  });
  assert.strictEqual(offTopicTerrestrial.inScope, false, "Terrestrial forestry paper must be excluded");
  console.log("  ✔ Verified 9 AWG Lead ORCIDs and strict anti-protrusion domain filtering");

  // -------------------------------------------------------------------------
  // Test 4: Quarterly / Monthly Window Classification & Snapshot Contents
  // -------------------------------------------------------------------------
  console.log("Test 4: Time Window Bucketing & Bundled Snapshot Validation");
  const refMs = Date.parse("2026-11-09T18:00:00Z");
  assert.strictEqual(classifyTimeWindow("2026-11-04", refMs).windowBucket, "month");
  assert.strictEqual(classifyTimeWindow("2026-10-05", refMs).windowBucket, "current_quarter");
  assert.strictEqual(classifyTimeWindow("2026-08-15", refMs).windowBucket, "prev_quarter");
  assert.strictEqual(classifyTimeWindow("2026-05-01", refMs).windowBucket, "archive");

  const snap = getRadarSnapshot();
  assert.ok(snap.osdrReleases.length >= 20, "Snapshot must contain recent OSDR releases");
  assert.ok(snap.leadSignals.length >= 30, "Snapshot must contain scoped AWG lead signals");
  assert.ok(snap.scopeAudit.filteredOutNonSpaceCount >= 1, "Scope audit must track filtered works");

  const sansQueried = queryRadarSnapshot({ subgroup: "sans" });
  assert.ok(sansQueried.filteredReleases.some((r) => r.sansRelevant));

  const parsedCmd = parseAwgQuery("/awg radar leads");
  assert.strictEqual(parsedCmd.isAwg, true);
  assert.strictEqual(parsedCmd.action, "radar");
  console.log("  ✔ Snapshot counts, query filtering, and /awg radar parsing verified");

  // -------------------------------------------------------------------------
  // Test 5: Express HTTP Routes (/api/awg/radar, /refresh, /api/chat /awg radar)
  // -------------------------------------------------------------------------
  console.log("Test 5: Express HTTP Endpoints & /awg radar SSE Chat Stream");
  const app = createExpressApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const port = (server.address() as any).port;

  try {
    const radarRes = await fetch(`http://localhost:${port}/api/awg/radar?subgroup=sans`);
    assert.strictEqual(radarRes.status, 200);
    const radarJson = await radarRes.json();
    assert.strictEqual(radarJson.status, "ok");
    assert.ok(Array.isArray(radarJson.filteredReleases));
    assert.ok(radarJson.digestMarkdown.includes("Release Radar Digest"));

    const chatRes = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "/awg radar", history: [], model: "gemini-3.7-flash" }),
    });
    assert.strictEqual(chatRes.status, 200);
    const sseText = await chatRes.text();
    assert.ok(sseText.includes('"isAwgRadar":true'), "Chat SSE must emit isAwgRadar sources metadata");
    const streamedTokens = sseText
      .split("\n\n")
      .map((block) => {
        const lines = block.split("\n");
        const ev = lines.find((l) => l.startsWith("event:"))?.slice(6).trim();
        const dataLine = lines.find((l) => l.startsWith("data:"))?.slice(5).trim();
        if (ev === "token" && dataLine) {
          try {
            return JSON.parse(dataLine);
          } catch {
            return "";
          }
        }
        return "";
      })
      .join("");
    assert.ok(streamedTokens.includes("Release Radar Digest"), "Chat SSE must stream Release Radar digest markdown");
    console.log("  ✔ GET /api/awg/radar and POST /api/chat (/awg radar) verified end-to-end");
  } finally {
    server.close();
  }

  console.log("\n============================================================");
  console.log("🎉 ALL RELEASE RADAR & AWG LEAD WATCH TESTS PASSED!");
  console.log("============================================================\n");
}

runReleaseRadarTests().catch((err) => {
  console.error("Release Radar Test Failure:", err);
  process.exit(1);
});
