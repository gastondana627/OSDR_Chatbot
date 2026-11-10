import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { collectLiveRadarSnapshot } from "../server/radar";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_PATH = path.resolve(__dirname, "../server/radarSnapshot.json");

async function main() {
  console.log("=== Syncing Live NASA OSDR & AWG Lead Release Radar Snapshot ===");
  const startedAt = Date.now();
  const snapshot = await collectLiveRadarSnapshot({
    referenceDateIso: new Date().toISOString(),
  });

  if (snapshot.osdrReleases.length === 0 || snapshot.leadSignals.length === 0) {
    console.error("Radar sync failed to collect sufficient live records:", snapshot.sourceStatus);
    process.exit(1);
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2) + "\n", "utf8");

  console.log(`\nSnapshot written to ${OUTPUT_PATH} in ${Date.now() - startedAt}ms`);
  console.log(`Window: Month="${snapshot.currentMonthLabel}" | Current Quarter=${snapshot.currentQuarterLabel} | Prev Quarter=${snapshot.previousQuarterLabel}`);
  console.log(`Sources: OSDR=${snapshot.sourceStatus.osdrMode} | ORCID=${snapshot.sourceStatus.orcidMode} | EuropePMC=${snapshot.sourceStatus.europePmcMode}`);
  console.log(`OSDR Releases captured: ${snapshot.osdrReleases.length} (SANS-relevant: ${snapshot.osdrReleases.filter((r) => r.sansRelevant).length})`);
  console.log(`Lead Signals captured: ${snapshot.leadSignals.length} (in-scope=${snapshot.scopeAudit.inScopeCount}, filtered non-space=${snapshot.scopeAudit.filteredOutNonSpaceCount})`);

  console.log("\n--- Newest 8 OSDR Releases ---");
  for (const r of snapshot.osdrReleases.slice(0, 8)) {
    const anchor = r.bestAnchor ? `${r.bestAnchor.studyId} (${r.bestAnchor.totalScore}/100)` : "none";
    console.log(`  ${r.studyId} | ${r.releaseDate} (${r.quarterLabel}, ${r.windowBucket}) | ${r.subgroup} | ${r.sourceSystem} | anchor=${anchor} | ${r.title.slice(0, 68)}`);
  }

  console.log("\n--- Per-Lead Summary ---");
  for (const l of snapshot.leads) {
    console.log(`  ${l.name.padEnd(22)} (${l.subgroup.padEnd(19)}) | kept=${String(l.inScopeCount).padStart(2)} (pre=${l.preOsdrCount}, osdr=${l.liveOsdrCount}) | filtered_out=${l.filteredOutNonSpaceCount}`);
  }

  console.log("\n--- Newest 12 Lead Signals ---");
  for (const s of snapshot.leadSignals.slice(0, 12)) {
    console.log(`  [${s.publishedDate}] ${s.leadName} | ${s.status} | ${s.sourcePlatform} | ${s.title.slice(0, 70)}`);
  }
}

main().catch((err) => {
  console.error("Unhandled sync error:", err);
  process.exit(1);
});
