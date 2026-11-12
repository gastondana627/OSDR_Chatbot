import "../server/env";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { collectLiveRadarSnapshot, RadarSnapshot } from "../server/radar";
import {
  buildWebhookEventPayload,
  diffRadarSnapshots,
  dispatchRadarDropWebhook,
  getConfiguredOutboundWebhookTargets,
  getRadarWebhookSecret,
  signRadarWebhookPayload,
} from "../server/radarWebhook";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_PATH = path.resolve(__dirname, "../server/radarSnapshot.json");

async function main() {
  const shouldNotify = process.argv.includes("--notify");
  console.log("=== Syncing Live NASA OSDR & AWG Lead Release Radar Snapshot (8h Monitor) ===");
  const startedAt = Date.now();

  let previousSnapshot: RadarSnapshot | null = null;
  try {
    if (fs.existsSync(OUTPUT_PATH)) {
      previousSnapshot = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8")) as RadarSnapshot;
    }
  } catch {
    previousSnapshot = null;
  }

  const snapshot = await collectLiveRadarSnapshot({
    referenceDateIso: new Date().toISOString(),
  });

  if (snapshot.osdrReleases.length === 0 || snapshot.leadSignals.length === 0) {
    console.error("Radar sync failed to collect sufficient live records:", snapshot.sourceStatus);
    process.exit(1);
  }

  const diff = previousSnapshot
    ? diffRadarSnapshots(previousSnapshot, snapshot)
    : { newSignals: [], spotlightLeadDrops: [], newOsdrReleases: [] };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2) + "\n", "utf8");

  console.log(`\nSnapshot written to ${OUTPUT_PATH} in ${Date.now() - startedAt}ms`);
  console.log(`Window: Month="${snapshot.currentMonthLabel}" | Current Quarter=${snapshot.currentQuarterLabel} | Prev Quarter=${snapshot.previousQuarterLabel}`);
  console.log(
    `Sources: OSDR=${snapshot.sourceStatus.osdrMode} | ORCID=${snapshot.sourceStatus.orcidMode} | OpenAlex=${snapshot.sourceStatus.openalexMode} | NTRS=${snapshot.sourceStatus.ntrsMode || "n/a"} | Crossref=${snapshot.sourceStatus.crossrefMode || "n/a"} | PubMed=${snapshot.sourceStatus.pubmedMode || "n/a"} | EuropePMC=${snapshot.sourceStatus.europePmcMode}`
  );
  console.log(`OSDR Releases captured: ${snapshot.osdrReleases.length} (SANS-relevant: ${snapshot.osdrReleases.filter((r) => r.sansRelevant).length})`);
  console.log(`Lead Signals captured: ${snapshot.leadSignals.length} (in-scope=${snapshot.scopeAudit.inScopeCount}, filtered non-space=${snapshot.scopeAudit.filteredOutNonSpaceCount})`);
  console.log(
    `8h Diff Check: newSignals=${diff.newSignals.length} (Ryan T. Scott spotlight=${diff.spotlightLeadDrops.length}), newOsdrReleases=${diff.newOsdrReleases.length}`
  );

  if (diff.newSignals.length > 0) {
    console.log("\n--- Newly Detected AWG Lead Drops ---");
    for (const s of diff.newSignals) {
      console.log(`  + [${s.publishedDate}] ${s.leadName} (${s.sourcePlatform}) | ${s.title}`);
    }
  }

  console.log("\n--- Newest 8 OSDR Releases ---");
  for (const r of snapshot.osdrReleases.slice(0, 8)) {
    const anchor = r.bestAnchor ? `${r.bestAnchor.studyId} (${r.bestAnchor.totalScore}/100)` : "none";
    console.log(`  ${r.studyId} | ${r.releaseDate} (${r.quarterLabel}, ${r.windowBucket}) | ${r.subgroup} | ${r.sourceSystem} | anchor=${anchor} | ${r.title.slice(0, 68)}`);
  }

  console.log("\n--- Per-Lead Summary ---");
  for (const l of snapshot.leads) {
    console.log(`  ${l.name.padEnd(22)} (${l.subgroup.padEnd(19)}) | kept=${String(l.inScopeCount).padStart(2)} (pre=${l.preOsdrCount}, osdr=${l.liveOsdrCount}) | filtered_out=${l.filteredOutNonSpaceCount}`);
  }

  console.log("\n--- Spotlight: Ryan T. Scott Latest Works ---");
  for (const s of snapshot.leadSignals.filter((x) => x.leadId === "ryan-scott").slice(0, 8)) {
    console.log(`  [${s.publishedDate}] ${s.status} | ${s.sourcePlatform} | ${s.title.slice(0, 74)}`);
  }

  const hasNewDrops = diff.newSignals.length > 0 || diff.newOsdrReleases.length > 0;
  if (shouldNotify && hasNewDrops) {
    const targets = getConfiguredOutboundWebhookTargets();
    if (targets.length > 0) {
      console.log(`\nDispatching outbound webhook alerts to ${targets.length} configured target(s)...`);
      const deliveries = await dispatchRadarDropWebhook(diff, {
        triggerSource: "cli_8h_cron",
      });
      for (const d of deliveries) {
        console.log(`  -> ${d.targetHost} (${d.targetType}): ok=${d.ok} status=${d.statusCode} latency=${d.latencyMs}ms`);
      }
    } else {
      console.log("\n[--notify] No outbound RADAR_WEBHOOK_URL / DISCORD_WEBHOOK_URL / SLACK_WEBHOOK_URL configured.");
    }

    const appWebhookUrl = String(process.env.RADAR_APP_WEBHOOK_URL || "").trim();
    if (appWebhookUrl) {
      try {
        const body = JSON.stringify({
          action: "lead_drop_push",
          signals: diff.newSignals,
          summary: buildWebhookEventPayload(diff, { triggerSource: "github_actions_8h_cron" }).summary,
        });
        const secret = getRadarWebhookSecret();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (secret) {
          headers["X-OSDR-Signature-256"] = signRadarWebhookPayload(body, secret);
        }
        const resp = await fetch(appWebhookUrl, { method: "POST", headers, body });
        console.log(`  -> App webhook sync ping (${new URL(appWebhookUrl).host}): HTTP ${resp.status}`);
      } catch (err: any) {
        console.warn(`  -> App webhook sync ping failed: ${err?.message || err}`);
      }
    }
  }
}

main().catch((err) => {
  console.error("Unhandled sync error:", err);
  process.exit(1);
});
