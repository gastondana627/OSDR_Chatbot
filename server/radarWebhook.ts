import "./env";
import crypto from "crypto";
import type express from "express";
import {
  AWG_LEAD_WATCHLIST,
  getRadarSnapshot,
  RadarLeadSignal,
  RadarOsdrRelease,
  RadarSnapshot,
  refreshRadarLive,
  upsertLeadSignalsIntoSnapshot,
} from "./radar";
import { verifyRequestAdminOrCookie } from "./auth";

export const DEFAULT_RADAR_MONITOR_INTERVAL_HOURS = 8;

export type WebhookTargetType = "discord" | "slack" | "generic_json";

export interface OutboundWebhookTarget {
  url: string;
  type: WebhookTargetType;
  host: string;
}

export interface MaskedWebhookTarget {
  type: WebhookTargetType;
  host: string;
  configured: boolean;
}

export interface RadarSnapshotDiff {
  newSignals: RadarLeadSignal[];
  spotlightLeadDrops: RadarLeadSignal[];
  newOsdrReleases: RadarOsdrRelease[];
}

export interface DetectedDropRecord {
  id: string;
  detectedAt: string;
  leadId: string;
  leadName: string;
  spotlight: boolean;
  title: string;
  publishedDate: string;
  journal: string;
  url: string;
  doi?: string;
  sourcePlatform: string;
  triggerSource: string;
}

export interface WebhookDeliveryRecord {
  deliveryId: string;
  timestamp: string;
  event: string;
  targetHost: string;
  targetType: WebhookTargetType;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
  dropsCount: number;
  error?: string;
}

export interface RadarWebhookStatus {
  intervalHours: number;
  intervalMs: number;
  schedulerRunning: boolean;
  schedulerMode: "node_8h_daemon" | "github_actions_8h_cron";
  startedAt: string | null;
  lastCheckAt: string | null;
  nextScheduledCheckAt: string | null;
  lastCheckStatus: "idle" | "ok_no_new_drops" | "new_drops_detected" | "error";
  lastCheckReason: string | null;
  totalChecksRun: number;
  secretArmed: boolean;
  configuredTargets: MaskedWebhookTarget[];
  outboundReady: boolean;
  spotlightLead: {
    id: string;
    name: string;
    orcid: string;
    role: string;
    trackedSignalsCount: number;
    latestPublishedDate: string | null;
    recentTitles: Array<{
      id: string;
      title: string;
      publishedDate: string;
      journal: string;
      url: string;
      sourcePlatform: string;
    }>;
  };
  recentDetectedDrops: DetectedDropRecord[];
  recentDeliveries: WebhookDeliveryRecord[];
}

const monitorState = {
  schedulerRunning: false,
  startedAt: null as string | null,
  lastCheckAt: null as string | null,
  nextScheduledCheckAt: null as string | null,
  lastCheckStatus: "idle" as RadarWebhookStatus["lastCheckStatus"],
  lastCheckReason: null as string | null,
  totalChecksRun: 0,
  recentDetectedDrops: [] as DetectedDropRecord[],
  recentDeliveries: [] as WebhookDeliveryRecord[],
};

let daemonTimer: ReturnType<typeof setInterval> | null = null;
let bootCheckTimer: ReturnType<typeof setTimeout> | null = null;
let inFlightCheckPromise: Promise<{
  status: RadarWebhookStatus;
  refreshed: boolean;
  reason: string;
  diff: RadarSnapshotDiff;
  deliveries: WebhookDeliveryRecord[];
}> | null = null;

export function getRadarMonitorIntervalHours(): number {
  const raw = Number(process.env.RADAR_MONITOR_INTERVAL_HOURS || "");
  if (Number.isFinite(raw) && raw > 0 && raw <= 168) {
    return raw;
  }
  return DEFAULT_RADAR_MONITOR_INTERVAL_HOURS;
}

export function getRadarMonitorIntervalMs(): number {
  return Math.round(getRadarMonitorIntervalHours() * 60 * 60 * 1000);
}

export function getRadarWebhookSecret(): string {
  const secret = String(process.env.RADAR_WEBHOOK_SECRET || "").trim();
  if (!secret || secret === "undefined" || secret === "null") return "";
  return secret;
}

export function inferWebhookTargetType(url: string): WebhookTargetType {
  const lower = url.toLowerCase();
  if (lower.includes("discord.com/api/webhooks/") || lower.includes("discordapp.com/api/webhooks/")) {
    return "discord";
  }
  if (lower.includes("hooks.slack.com/")) {
    return "slack";
  }
  return "generic_json";
}

function parseWebhookUrlSafe(rawUrl: string): OutboundWebhookTarget | null {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null") return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return {
      url: parsed.toString(),
      type: inferWebhookTargetType(parsed.toString()),
      host: parsed.host,
    };
  } catch {
    return null;
  }
}

export function getConfiguredOutboundWebhookTargets(): OutboundWebhookTarget[] {
  const candidates: string[] = [];

  if (process.env.RADAR_WEBHOOK_URL) {
    candidates.push(process.env.RADAR_WEBHOOK_URL);
  }
  if (process.env.RADAR_WEBHOOK_URLS) {
    candidates.push(...process.env.RADAR_WEBHOOK_URLS.split(","));
  }
  if (process.env.DISCORD_WEBHOOK_URL) {
    candidates.push(process.env.DISCORD_WEBHOOK_URL);
  }
  if (process.env.SLACK_WEBHOOK_URL) {
    candidates.push(process.env.SLACK_WEBHOOK_URL);
  }

  const seenUrls = new Set<string>();
  const resolved: OutboundWebhookTarget[] = [];

  for (const cand of candidates) {
    const target = parseWebhookUrlSafe(cand);
    if (target && !seenUrls.has(target.url)) {
      seenUrls.add(target.url);
      resolved.push(target);
    }
  }

  return resolved;
}

function normalizeTitleFingerprint(title: string): string {
  return title
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 96);
}

function buildSignalIdentityKeys(signal: RadarLeadSignal): string[] {
  const keys: string[] = [];
  if (signal.doi) {
    keys.push(`doi:${signal.doi.toLowerCase().trim()}`);
  }
  if (signal.id) {
    keys.push(`id:${signal.id.toLowerCase().trim()}`);
  }
  keys.push(`t:${signal.leadId}:${normalizeTitleFingerprint(signal.title)}`);
  return keys;
}

export function diffRadarSnapshots(
  previous: RadarSnapshot,
  next: RadarSnapshot
): RadarSnapshotDiff {
  const prevSignalKeys = new Set<string>();
  for (const sig of previous?.leadSignals || []) {
    for (const k of buildSignalIdentityKeys(sig)) {
      prevSignalKeys.add(k);
    }
  }

  const prevReleaseIds = new Set<string>(
    (previous?.osdrReleases || []).map((r) => String(r.studyId || "").toUpperCase()).filter(Boolean)
  );

  const newSignals: RadarLeadSignal[] = [];
  for (const sig of next?.leadSignals || []) {
    const keys = buildSignalIdentityKeys(sig);
    const alreadyPresent = keys.some((k) => prevSignalKeys.has(k));
    if (!alreadyPresent) {
      newSignals.push(sig);
      for (const k of keys) prevSignalKeys.add(k);
    }
  }

  const spotlightLeadDrops = newSignals.filter(
    (s) => s.spotlight || s.leadId === "ryan-scott"
  );

  const newOsdrReleases: RadarOsdrRelease[] = [];
  for (const rel of next?.osdrReleases || []) {
    const sid = String(rel.studyId || "").toUpperCase();
    if (sid && !prevReleaseIds.has(sid)) {
      newOsdrReleases.push(rel);
      prevReleaseIds.add(sid);
    }
  }

  return {
    newSignals,
    spotlightLeadDrops,
    newOsdrReleases,
  };
}

export function signRadarWebhookPayload(rawBody: string, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return `sha256=${hmac}`;
}

function safeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function verifyRadarWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!secret || !signatureHeader) return false;
  const expected = signRadarWebhookPayload(rawBody, secret);
  return safeEqualStrings(signatureHeader.trim(), expected);
}

export function extractRawBodyForWebhook(req: express.Request): string {
  const rawBody = (req as any)?.rawBody;
  if (typeof rawBody === "string" && rawBody.length > 0) {
    return rawBody;
  }
  if (req.body && typeof req.body === "object") {
    return JSON.stringify(req.body);
  }
  if (typeof req.body === "string") {
    return req.body;
  }
  return "";
}

export async function verifyInboundWebhookAuth(req: express.Request): Promise<{
  authorized: boolean;
  authMethod: "hmac_signature" | "bearer_secret" | "header_secret" | "admin_session" | "none";
  reason: string;
}> {
  const secret = getRadarWebhookSecret();

  if (secret) {
    const sigHeader = String(
      req.headers["x-osdr-signature-256"] ||
        req.headers["x-hub-signature-256"] ||
        req.headers["x-radar-signature"] ||
        ""
    ).trim();
    if (sigHeader) {
      const rawBody = extractRawBodyForWebhook(req);
      if (verifyRadarWebhookSignature(rawBody, sigHeader, secret)) {
        return {
          authorized: true,
          authMethod: "hmac_signature",
          reason: "Verified X-OSDR-Signature-256 HMAC-SHA256 signature.",
        };
      }
      return {
        authorized: false,
        authMethod: "none",
        reason: "Invalid X-OSDR-Signature-256 HMAC signature.",
      };
    }

    const authHeader = String(req.headers.authorization || "").trim();
    if (authHeader.toLowerCase().startsWith("bearer ")) {
      const token = authHeader.slice(7).trim();
      if (safeEqualStrings(token, secret)) {
        return {
          authorized: true,
          authMethod: "bearer_secret",
          reason: "Verified Bearer RADAR_WEBHOOK_SECRET.",
        };
      }
      return {
        authorized: false,
        authMethod: "none",
        reason: "Invalid Bearer webhook secret.",
      };
    }

    const headerSecret = String(req.headers["x-webhook-secret"] || "").trim();
    if (headerSecret) {
      if (safeEqualStrings(headerSecret, secret)) {
        return {
          authorized: true,
          authMethod: "header_secret",
          reason: "Verified X-Webhook-Secret header.",
        };
      }
      return {
        authorized: false,
        authMethod: "none",
        reason: "Invalid X-Webhook-Secret header.",
      };
    }
  }

  const adminSession = await verifyRequestAdminOrCookie(req);
  if (adminSession) {
    return {
      authorized: true,
      authMethod: "admin_session",
      reason: "Verified administrator session.",
    };
  }

  return {
    authorized: false,
    authMethod: "none",
    reason: secret
      ? "Missing valid X-OSDR-Signature-256 HMAC, Bearer RADAR_WEBHOOK_SECRET, or authenticated /admin session."
      : "Set RADAR_WEBHOOK_SECRET in server .env or sign in via /admin to authorize inbound webhook mutations.",
  };
}

export interface WebhookEventPayload {
  event: "osdr_radar.lead_drops" | "osdr_radar.test_ping";
  timestamp: string;
  intervalHours: number;
  triggerSource: string;
  newDropsCount: number;
  spotlightLeadDropsCount: number;
  newReleasesCount: number;
  summary: string;
  newSignals: Array<{
    id: string;
    leadId: string;
    leadName: string;
    leadSubgroup: string;
    spotlight: boolean;
    title: string;
    journal: string;
    publishedDate: string;
    sourcePlatform: string;
    doi?: string;
    url: string;
    linkedOsdIds: string[];
  }>;
  newOsdrReleases: Array<{
    studyId: string;
    title: string;
    organism: string;
    subgroup: string;
    releaseDate: string;
    osdrUrl: string;
  }>;
}

export function buildWebhookEventPayload(
  diff: RadarSnapshotDiff,
  options: {
    event?: WebhookEventPayload["event"];
    triggerSource?: string;
    summaryOverride?: string;
  } = {}
): WebhookEventPayload {
  const event = options.event || "osdr_radar.lead_drops";
  const triggerSource = options.triggerSource || "8h_monitor";
  const intervalHours = getRadarMonitorIntervalHours();
  const spotlightCount = diff.spotlightLeadDrops.length;

  const summary =
    options.summaryOverride ||
    (event === "osdr_radar.test_ping"
      ? `OSDR ChatBot 8-hour Release Radar webhook ping (Ryan T. Scott & 8 AWG leads active).`
      : `Detected ${diff.newSignals.length} new AWG lead drop(s)${
          spotlightCount > 0 ? ` (${spotlightCount} from Ryan T. Scott)` : ""
        } and ${diff.newOsdrReleases.length} new OSDR dataset release(s).`);

  return {
    event,
    timestamp: new Date().toISOString(),
    intervalHours,
    triggerSource,
    newDropsCount: diff.newSignals.length,
    spotlightLeadDropsCount: spotlightCount,
    newReleasesCount: diff.newOsdrReleases.length,
    summary,
    newSignals: diff.newSignals.slice(0, 10).map((s) => ({
      id: s.id,
      leadId: s.leadId,
      leadName: s.leadName,
      leadSubgroup: s.leadSubgroup,
      spotlight: s.spotlight,
      title: s.title,
      journal: s.journal,
      publishedDate: s.publishedDate,
      sourcePlatform: s.sourcePlatform,
      ...(s.doi ? { doi: s.doi } : {}),
      url: s.url,
      linkedOsdIds: s.linkedOsdIds || [],
    })),
    newOsdrReleases: diff.newOsdrReleases.slice(0, 6).map((r) => ({
      studyId: r.studyId,
      title: r.title,
      organism: r.organism,
      subgroup: r.subgroup,
      releaseDate: r.releaseDate,
      osdrUrl: r.osdrUrl,
    })),
  };
}

export function formatWebhookBodyForTarget(
  targetType: WebhookTargetType,
  payload: WebhookEventPayload
): Record<string, any> {
  if (targetType === "discord") {
    const embeds = payload.newSignals.slice(0, 5).map((s) => ({
      title: s.title.slice(0, 240),
      url: s.url,
      color: s.spotlight ? 0xfbbf24 : 0x38bdf8,
      description: `**${s.leadName}** (${s.leadSubgroup}) · \`${s.publishedDate}\` · ${s.journal}`,
      fields: [
        { name: "Source", value: s.sourcePlatform, inline: true },
        ...(s.doi ? [{ name: "DOI", value: s.doi, inline: true }] : []),
        ...(s.linkedOsdIds.length > 0
          ? [{ name: "Linked OSDR", value: s.linkedOsdIds.join(", "), inline: true }]
          : []),
      ],
    }));

    return {
      username: "OSDR Release Radar (8h Monitor)",
      content: `🛰️ **${payload.summary}**`,
      embeds:
        embeds.length > 0
          ? embeds
          : payload.newOsdrReleases.slice(0, 3).map((r) => ({
              title: `${r.studyId}: ${r.title.slice(0, 220)}`,
              url: r.osdrUrl,
              color: 0x34d399,
              description: `${r.subgroup} · ${r.organism} · Released \`${r.releaseDate}\``,
            })),
    };
  }

  if (targetType === "slack") {
    const lines = [
      `*OSDR Release Radar (${payload.intervalHours}h Monitor)* — ${payload.summary}`,
      ...payload.newSignals.slice(0, 6).map(
        (s) =>
          `• *${s.leadName}* (\`${s.publishedDate}\` · ${s.sourcePlatform}): <${s.url}|${s.title}>`
      ),
      ...payload.newOsdrReleases.slice(0, 4).map(
        (r) => `• *${r.studyId}* (\`${r.releaseDate}\` · ${r.subgroup}): <${r.osdrUrl}|${r.title}>`
      ),
    ];
    return {
      text: lines.join("\n"),
    };
  }

  return payload;
}

function recordDetectedDrops(signals: RadarLeadSignal[], triggerSource: string) {
  if (!signals.length) return;
  const nowIso = new Date().toISOString();
  const seen = new Set(monitorState.recentDetectedDrops.map((d) => d.id));
  const additions: DetectedDropRecord[] = [];

  for (const s of signals) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    additions.push({
      id: s.id,
      detectedAt: nowIso,
      leadId: s.leadId,
      leadName: s.leadName,
      spotlight: s.spotlight,
      title: s.title,
      publishedDate: s.publishedDate,
      journal: s.journal,
      url: s.url,
      ...(s.doi ? { doi: s.doi } : {}),
      sourcePlatform: s.sourcePlatform,
      triggerSource,
    });
  }

  monitorState.recentDetectedDrops = [
    ...additions,
    ...monitorState.recentDetectedDrops,
  ].slice(0, 25);
}

export async function dispatchRadarDropWebhook(
  diff: RadarSnapshotDiff,
  options: {
    event?: WebhookEventPayload["event"];
    triggerSource?: string;
    summaryOverride?: string;
    targetsOverride?: OutboundWebhookTarget[];
    secretOverride?: string;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<WebhookDeliveryRecord[]> {
  const targets = options.targetsOverride ?? getConfiguredOutboundWebhookTargets();
  if (targets.length === 0) {
    return [];
  }

  const secret = options.secretOverride ?? getRadarWebhookSecret();
  const fetchFn = options.fetchImpl ?? fetch;
  const payload = buildWebhookEventPayload(diff, {
    event: options.event,
    triggerSource: options.triggerSource,
    summaryOverride: options.summaryOverride,
  });

  const dropsCount = diff.newSignals.length + diff.newOsdrReleases.length;
  const deliveries: WebhookDeliveryRecord[] = [];

  for (const target of targets) {
    const startTs = Date.now();
    const deliveryId = `whd-${crypto.randomBytes(6).toString("hex")}`;
    const bodyObj = formatWebhookBodyForTarget(target.type, payload);
    const rawBody = JSON.stringify(bodyObj);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "OSDR-ChatBot-Radar-Webhook/1.0",
      "X-OSDR-Event": payload.event,
      "X-OSDR-Delivery": deliveryId,
    };

    if (secret && target.type === "generic_json") {
      headers["X-OSDR-Signature-256"] = signRadarWebhookPayload(rawBody, secret);
    }

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 7500);

    try {
      const resp = await fetchFn(target.url, {
        method: "POST",
        headers,
        body: rawBody,
        signal: ctrl.signal,
      });
      const rec: WebhookDeliveryRecord = {
        deliveryId,
        timestamp: new Date().toISOString(),
        event: payload.event,
        targetHost: target.host,
        targetType: target.type,
        ok: resp.ok,
        statusCode: resp.status,
        latencyMs: Date.now() - startTs,
        dropsCount,
        ...(resp.ok ? {} : { error: `HTTP ${resp.status}` }),
      };
      deliveries.push(rec);
    } catch (err: any) {
      deliveries.push({
        deliveryId,
        timestamp: new Date().toISOString(),
        event: payload.event,
        targetHost: target.host,
        targetType: target.type,
        ok: false,
        statusCode: null,
        latencyMs: Date.now() - startTs,
        dropsCount,
        error: err?.message || "Webhook request failed",
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  monitorState.recentDeliveries = [
    ...deliveries,
    ...monitorState.recentDeliveries,
  ].slice(0, 25);

  return deliveries;
}

export function getRadarWebhookStatus(): RadarWebhookStatus {
  const snapshot = getRadarSnapshot();
  const ryanProfile =
    AWG_LEAD_WATCHLIST.find((l) => l.id === "ryan-scott") || AWG_LEAD_WATCHLIST[0];
  const ryanSignals = (snapshot.leadSignals || []).filter(
    (s) => s.leadId === "ryan-scott"
  );
  const targets = getConfiguredOutboundWebhookTargets();

  return {
    intervalHours: getRadarMonitorIntervalHours(),
    intervalMs: getRadarMonitorIntervalMs(),
    schedulerRunning: monitorState.schedulerRunning,
    schedulerMode: monitorState.schedulerRunning
      ? "node_8h_daemon"
      : "github_actions_8h_cron",
    startedAt: monitorState.startedAt,
    lastCheckAt: monitorState.lastCheckAt,
    nextScheduledCheckAt: monitorState.nextScheduledCheckAt,
    lastCheckStatus: monitorState.lastCheckStatus,
    lastCheckReason: monitorState.lastCheckReason,
    totalChecksRun: monitorState.totalChecksRun,
    secretArmed: Boolean(getRadarWebhookSecret()),
    configuredTargets: targets.map((t) => ({
      type: t.type,
      host: t.host,
      configured: true,
    })),
    outboundReady: targets.length > 0,
    spotlightLead: {
      id: ryanProfile.id,
      name: ryanProfile.name,
      orcid: ryanProfile.orcid,
      role: ryanProfile.role,
      trackedSignalsCount: ryanSignals.length,
      latestPublishedDate: ryanSignals[0]?.publishedDate || null,
      recentTitles: ryanSignals.slice(0, 5).map((s) => ({
        id: s.id,
        title: s.title,
        publishedDate: s.publishedDate,
        journal: s.journal,
        url: s.url,
        sourcePlatform: s.sourcePlatform,
      })),
    },
    recentDetectedDrops: monitorState.recentDetectedDrops,
    recentDeliveries: monitorState.recentDeliveries,
  };
}

export async function runRadarMonitorCheck(options: {
  force?: boolean;
  notify?: boolean;
  triggerSource?: string;
} = {}): Promise<{
  status: RadarWebhookStatus;
  refreshed: boolean;
  reason: string;
  diff: RadarSnapshotDiff;
  deliveries: WebhookDeliveryRecord[];
}> {
  if (inFlightCheckPromise) {
    return inFlightCheckPromise;
  }

  inFlightCheckPromise = (async () => {
    const previous = getRadarSnapshot();
    const triggerSource = options.triggerSource || "manual_check";
    const intervalMs = getRadarMonitorIntervalMs();

    try {
      const res = await refreshRadarLive(options.force !== false);
      const diff = diffRadarSnapshots(previous, res.snapshot);

      monitorState.lastCheckAt = new Date().toISOString();
      monitorState.totalChecksRun += 1;
      monitorState.lastCheckReason = res.reason;
      monitorState.nextScheduledCheckAt = new Date(Date.now() + intervalMs).toISOString();

      const hasDrops = diff.newSignals.length > 0 || diff.newOsdrReleases.length > 0;
      monitorState.lastCheckStatus = hasDrops ? "new_drops_detected" : "ok_no_new_drops";

      if (diff.newSignals.length > 0) {
        recordDetectedDrops(diff.newSignals, triggerSource);
      }

      let deliveries: WebhookDeliveryRecord[] = [];
      if (hasDrops && options.notify !== false) {
        deliveries = await dispatchRadarDropWebhook(diff, {
          triggerSource,
        });
      }

      return {
        status: getRadarWebhookStatus(),
        refreshed: res.refreshed,
        reason: res.reason,
        diff,
        deliveries,
      };
    } catch (err: any) {
      monitorState.lastCheckAt = new Date().toISOString();
      monitorState.totalChecksRun += 1;
      monitorState.lastCheckStatus = "error";
      monitorState.lastCheckReason = err?.message || "Monitor check failed";
      monitorState.nextScheduledCheckAt = new Date(Date.now() + intervalMs).toISOString();
      return {
        status: getRadarWebhookStatus(),
        refreshed: false,
        reason: monitorState.lastCheckReason || "error",
        diff: { newSignals: [], spotlightLeadDrops: [], newOsdrReleases: [] },
        deliveries: [],
      };
    } finally {
      inFlightCheckPromise = null;
    }
  })();

  return inFlightCheckPromise;
}

export async function processInboundWebhookPayload(body: any): Promise<{
  accepted: boolean;
  mode: "lead_drop_push" | "sync_now";
  addedSignals: RadarLeadSignal[];
  rejectedOutOfScope: number;
  diff: RadarSnapshotDiff;
  deliveries: WebhookDeliveryRecord[];
  status: RadarWebhookStatus;
}> {
  const payload = body && typeof body === "object" ? body : {};
  const action = String(payload.action || "").trim().toLowerCase();

  // Explicit push of lead drop articles (or array of items)
  const rawItems: any[] = Array.isArray(payload.signals)
    ? payload.signals
    : Array.isArray(payload.articles)
    ? payload.articles
    : payload.title && payload.url
    ? [payload]
    : [];

  if (rawItems.length > 0 && action !== "sync_now") {
    const normalized = rawItems.map((it) => ({
      leadId: typeof it?.leadId === "string" ? it.leadId : payload.leadId,
      title: String(it?.title || "").trim(),
      journal: typeof it?.journal === "string" ? it.journal : undefined,
      publishedDate: typeof it?.publishedDate === "string" ? it.publishedDate : undefined,
      url: String(it?.url || "").trim(),
      doi: typeof it?.doi === "string" ? it.doi : undefined,
      pmid: typeof it?.pmid === "string" ? it.pmid : undefined,
      pmcid: typeof it?.pmcid === "string" ? it.pmcid : undefined,
      isPreprint: Boolean(it?.isPreprint),
      summarySnippet: typeof it?.summarySnippet === "string" ? it.summarySnippet : undefined,
      sourcePlatform: "Webhook Push" as const,
      scopeMatchedBy: Array.isArray(it?.scopeMatchedBy) ? it.scopeMatchedBy : undefined,
    }));

    const mergeResult = upsertLeadSignalsIntoSnapshot(normalized, {
      skipScopeFilter: Boolean(payload.skipScopeFilter),
    });

    const diff: RadarSnapshotDiff = {
      newSignals: mergeResult.addedSignals,
      spotlightLeadDrops: mergeResult.addedSignals.filter(
        (s) => s.spotlight || s.leadId === "ryan-scott"
      ),
      newOsdrReleases: [],
    };

    monitorState.lastCheckAt = new Date().toISOString();
    monitorState.totalChecksRun += 1;
    monitorState.lastCheckStatus =
      mergeResult.addedSignals.length > 0 ? "new_drops_detected" : "ok_no_new_drops";
    monitorState.lastCheckReason = `inbound_webhook_push:${mergeResult.addedSignals.length}_added`;

    if (mergeResult.addedSignals.length > 0) {
      recordDetectedDrops(mergeResult.addedSignals, "inbound_webhook");
    }

    let deliveries: WebhookDeliveryRecord[] = [];
    if (mergeResult.addedSignals.length > 0 && payload.relay !== false) {
      deliveries = await dispatchRadarDropWebhook(diff, {
        triggerSource: "inbound_webhook_relay",
      });
    }

    return {
      accepted: true,
      mode: "lead_drop_push",
      addedSignals: mergeResult.addedSignals,
      rejectedOutOfScope: mergeResult.rejectedOutOfScope,
      diff,
      deliveries,
      status: getRadarWebhookStatus(),
    };
  }

  // Fallback / "sync_now": run live 8-hour sync check immediately
  const res = await runRadarMonitorCheck({
    force: payload.force !== false,
    notify: payload.notify !== false,
    triggerSource: String(payload.triggerSource || "inbound_webhook_sync"),
  });

  return {
    accepted: true,
    mode: "sync_now",
    addedSignals: res.diff.newSignals,
    rejectedOutOfScope: 0,
    diff: res.diff,
    deliveries: res.deliveries,
    status: res.status,
  };
}

export function startRadarMonitorDaemon(options: {
  runOnBoot?: boolean;
  bootDelayMs?: number;
} = {}): RadarWebhookStatus {
  if (daemonTimer) {
    return getRadarWebhookStatus();
  }

  const intervalMs = getRadarMonitorIntervalMs();
  const intervalHours = getRadarMonitorIntervalHours();
  monitorState.schedulerRunning = true;
  monitorState.startedAt = new Date().toISOString();
  monitorState.nextScheduledCheckAt = new Date(Date.now() + intervalMs).toISOString();

  daemonTimer = setInterval(() => {
    void runRadarMonitorCheck({
      force: true,
      notify: true,
      triggerSource: "scheduled_8h_daemon",
    });
  }, intervalMs);
  daemonTimer.unref?.();

  const shouldRunOnBoot =
    options.runOnBoot ?? process.env.RADAR_CHECK_ON_BOOT !== "false";

  if (shouldRunOnBoot) {
    const delayMs = options.bootDelayMs ?? 4500;
    bootCheckTimer = setTimeout(() => {
      void runRadarMonitorCheck({
        force: true,
        notify: true,
        triggerSource: "server_boot_initial_check",
      });
    }, delayMs);
    bootCheckTimer.unref?.();
  }

  const targets = getConfiguredOutboundWebhookTargets();
  console.log(
    `[Radar Webhook Monitor] Every-${intervalHours}h monitor active for Ryan T. Scott & 8 AWG chairs (outbound targets: ${targets.length}, next check: ${monitorState.nextScheduledCheckAt})`
  );

  return getRadarWebhookStatus();
}

export function stopRadarMonitorDaemon() {
  if (daemonTimer) {
    clearInterval(daemonTimer);
    daemonTimer = null;
  }
  if (bootCheckTimer) {
    clearTimeout(bootCheckTimer);
    bootCheckTimer = null;
  }
  monitorState.schedulerRunning = false;
  monitorState.nextScheduledCheckAt = null;
}

export function __resetRadarWebhookStateForTests() {
  stopRadarMonitorDaemon();
  monitorState.startedAt = null;
  monitorState.lastCheckAt = null;
  monitorState.lastCheckStatus = "idle";
  monitorState.lastCheckReason = null;
  monitorState.totalChecksRun = 0;
  monitorState.recentDetectedDrops = [];
  monitorState.recentDeliveries = [];
  inFlightCheckPromise = null;
}

