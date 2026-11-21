// ==============================================================================
// API Key Rejection & Provider Health Alert Delivery System
// ==============================================================================
// Automatically emails (via Resend REST API — 3,000 free emails/mo, zero deps)
// and/or pings a webhook (Discord/Slack/generic) whenever an LLM API key is
// rejected (HTTP 401/403 auth_error) or optionally when quota is exhausted.
// Includes per-provider cooldown protection so your inbox is never spammed.

export interface ApiKeyAlertEvent {
  id: string;
  provider: string;
  model: string;
  errorCategory: string;
  statusCode?: number;
  errorMessage: string;
  timestamp: string;
  channelsAttempted: string[];
  delivered: boolean;
  suppressedByCooldown: boolean;
  deliveryErrors: string[];
}

export interface AlertDeliveryTransport {
  fetchFn?: typeof fetch;
}

const PROVIDER_CONSOLE_URLS: Record<string, { label: string; url: string; envVar: string }> = {
  gemini: {
    label: "Google AI Studio",
    url: "https://aistudio.google.com/apikey",
    envVar: "GEMINI_API_KEY",
  },
  openrouter: {
    label: "OpenRouter Keys",
    url: "https://openrouter.ai/keys",
    envVar: "OPENROUTER_API_KEY",
  },
  groq: {
    label: "Groq Console Keys",
    url: "https://console.groq.com/keys",
    envVar: "GROQ_API_KEY",
  },
  openai: {
    label: "OpenAI API Keys",
    url: "https://platform.openai.com/api-keys",
    envVar: "OPENAI_API_KEY",
  },
};

const lastAlertSentAt = new Map<string, number>();
const recentAlerts: ApiKeyAlertEvent[] = [];
const MAX_ALERT_HISTORY = 30;

function cleanEnv(val: string | undefined): string {
  if (typeof val !== "string") return "";
  const trimmed = val.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null") return "";
  return trimmed;
}

export function getAlertConfig() {
  const resendApiKey = cleanEnv(process.env.RESEND_API_KEY);
  const emailToRaw = cleanEnv(process.env.ALERT_EMAIL_TO || process.env.ADMIN_EMAILS);
  const emailRecipients = emailToRaw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@"));
  const emailFrom =
    cleanEnv(process.env.ALERT_EMAIL_FROM) || "OSDR ChatBot Alerts <onboarding@resend.dev>";

  const webhookUrl = cleanEnv(
    process.env.ALERT_WEBHOOK_URL ||
      process.env.DISCORD_WEBHOOK_URL ||
      process.env.SLACK_WEBHOOK_URL
  );

  const cooldownMinutesRaw = Number(process.env.ALERT_COOLDOWN_MINUTES);
  const cooldownMinutes =
    Number.isFinite(cooldownMinutesRaw) && cooldownMinutesRaw >= 0
      ? cooldownMinutesRaw
      : 60;

  const alertOnQuotaErrors = cleanEnv(process.env.ALERT_ON_QUOTA_ERRORS) === "true";
  const appUrl =
    cleanEnv(process.env.PUBLIC_APP_URL) || "https://osdr-chatbot-kappa.vercel.app";

  return {
    emailConfigured: Boolean(resendApiKey && emailRecipients.length > 0),
    resendApiKey,
    emailRecipients,
    emailFrom,
    webhookConfigured: Boolean(webhookUrl),
    webhookUrl,
    cooldownMinutes,
    alertOnQuotaErrors,
    appUrl,
  };
}

export function shouldAlertForCategory(errorCategory: string): boolean {
  const cat = String(errorCategory || "").toLowerCase();
  if (cat === "auth_error") return true;
  if (cat === "quota_error" && getAlertConfig().alertOnQuotaErrors) return true;
  return false;
}

export function buildApiKeyAlertContent(params: {
  provider: string;
  model: string;
  errorCategory: string;
  statusCode?: number;
  errorMessage: string;
  timestamp: string;
  appUrl: string;
  isTest?: boolean;
}) {
  const providerKey = params.provider.toLowerCase();
  const meta = PROVIDER_CONSOLE_URLS[providerKey] || {
    label: `${params.provider.toUpperCase()} Console`,
    url: "https://vercel.com/dashboard",
    envVar: `${params.provider.toUpperCase()}_API_KEY`,
  };

  const prefix = params.isTest ? "[TEST ALERT]" : "[ACTION NEEDED]";
  const subject = `${prefix} OSDR ChatBot: ${meta.envVar} rejected (${params.errorCategory}${
    params.statusCode ? ` HTTP ${params.statusCode}` : ""
  })`;

  const text = [
    `${prefix} NASA OSDR ChatBot API Key Reminder`,
    "",
    `Provider: ${params.provider.toUpperCase()} (${meta.envVar})`,
    `Model Attempted: ${params.model || "default"}`,
    `Failure Type: ${params.errorCategory}${params.statusCode ? ` (HTTP ${params.statusCode})` : ""}`,
    `Details: ${params.errorMessage}`,
    `Detected At (UTC): ${params.timestamp}`,
    `Live App: ${params.appUrl}`,
    "",
    `How to refresh this key:`,
    `1. Create/rotate key at ${meta.label}: ${meta.url}`,
    `2. Update ${meta.envVar} in Vercel -> Settings -> Environment Variables`,
    `3. Redeploy (or wait for next push). Meanwhile OSDR ChatBot automatically cascades to remaining free providers + Local RAG.`,
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #0b1220; color: #e2e8f0; padding: 24px; border-radius: 12px; border: 1px solid #1e293b;">
      <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #38bdf8; margin-bottom: 6px;">
        NASA OSDR ChatBot · Provider Key Watch
      </div>
      <h2 style="margin: 0 0 12px; font-size: 18px; color: #f8fafc;">
        ${prefix} ${meta.envVar} Rejected (${params.errorCategory})
      </h2>
      <p style="margin: 0 0 14px; font-size: 14px; line-height: 1.5; color: #cbd5e1;">
        An upstream inference call reported a key rejection. Your app automatically cascaded to the remaining free-tier providers so researchers were not blocked, and this reminder lets you rotate the key at your convenience.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 13px;">
        <tr><td style="padding: 6px 0; color: #94a3b8;">Provider</td><td style="padding: 6px 0; color: #f8fafc; font-weight: 600;">${params.provider.toUpperCase()} (<code>${meta.envVar}</code>)</td></tr>
        <tr><td style="padding: 6px 0; color: #94a3b8;">Model</td><td style="padding: 6px 0; color: #f8fafc;"><code>${params.model || "default"}</code></td></tr>
        <tr><td style="padding: 6px 0; color: #94a3b8;">Error</td><td style="padding: 6px 0; color: #fca5a5;">${params.errorMessage}</td></tr>
        <tr><td style="padding: 6px 0; color: #94a3b8;">Timestamp (UTC)</td><td style="padding: 6px 0; color: #cbd5e1;">${params.timestamp}</td></tr>
      </table>
      <div style="padding: 12px 14px; background: #111c33; border-radius: 8px; border: 1px solid #334155; font-size: 13px; line-height: 1.55;">
        <strong>Quick Fix:</strong><br/>
        1. Rotate key in <a href="${meta.url}" style="color: #38bdf8;">${meta.label}</a><br/>
        2. Update <code>${meta.envVar}</code> in Vercel Environment Variables<br/>
        3. Verify live at <a href="${params.appUrl}/api/diagnostics?refresh=true" style="color: #38bdf8;">${params.appUrl}/api/diagnostics</a>
      </div>
    </div>
  `.trim();

  return { subject, text, html, meta };
}

export async function notifyApiKeyFailure(
  params: {
    provider: string;
    model: string;
    errorCategory: string;
    statusCode?: number;
    errorMessage: string;
    force?: boolean;
    isTest?: boolean;
  },
  transport: AlertDeliveryTransport = {}
): Promise<ApiKeyAlertEvent | null> {
  if (!params.force && !shouldAlertForCategory(params.errorCategory)) {
    return null;
  }

  // Avoid real network calls during unit tests unless a custom fetchFn is explicitly supplied
  const isAutomatedTestEnv =
    process.env.NODE_ENV === "test" || process.env.AWG_ALLOW_LIVE_ALERTS === "false";
  if (isAutomatedTestEnv && !transport.fetchFn) {
    return null;
  }

  const cfg = getAlertConfig();
  const nowMs = Date.now();
  const cooldownKey = `${params.provider.toLowerCase()}:${params.errorCategory.toLowerCase()}`;
  const cooldownMs = cfg.cooldownMinutes * 60 * 1000;
  const lastSent = lastAlertSentAt.get(cooldownKey) || 0;

  const event: ApiKeyAlertEvent = {
    id: `alert-${nowMs}-${Math.random().toString(36).slice(2, 7)}`,
    provider: params.provider,
    model: params.model,
    errorCategory: params.errorCategory,
    statusCode: params.statusCode,
    errorMessage: params.errorMessage,
    timestamp: new Date(nowMs).toISOString(),
    channelsAttempted: [],
    delivered: false,
    suppressedByCooldown: false,
    deliveryErrors: [],
  };

  if (!params.force && lastSent > 0 && nowMs - lastSent < cooldownMs) {
    event.suppressedByCooldown = true;
    recordAlertHistory(event);
    return event;
  }

  const fetchImpl = transport.fetchFn || globalThis.fetch;
  const content = buildApiKeyAlertContent({
    provider: params.provider,
    model: params.model,
    errorCategory: params.errorCategory,
    statusCode: params.statusCode,
    errorMessage: params.errorMessage,
    timestamp: event.timestamp,
    appUrl: cfg.appUrl,
    isTest: params.isTest,
  });

  // Channel 1: Resend Email API (free 3,000 emails/mo)
  if (cfg.emailConfigured && typeof fetchImpl === "function") {
    event.channelsAttempted.push("resend_email");
    try {
      const resp = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.resendApiKey}`,
        },
        body: JSON.stringify({
          from: cfg.emailFrom,
          to: cfg.emailRecipients,
          subject: content.subject,
          text: content.text,
          html: content.html,
        }),
      });
      if (resp.ok) {
        event.delivered = true;
      } else {
        const body = await resp.text().catch(() => "");
        event.deliveryErrors.push(
          `Resend HTTP ${resp.status}: ${body.slice(0, 180) || resp.statusText}`
        );
      }
    } catch (err: any) {
      event.deliveryErrors.push(`Resend fetch error: ${err?.message || String(err)}`);
    }
  }

  // Channel 2: Optional Webhook (Discord / Slack / Zapier / generic JSON)
  if (cfg.webhookConfigured && typeof fetchImpl === "function") {
    event.channelsAttempted.push("webhook");
    try {
      const isDiscord = cfg.webhookUrl.includes("discord.com/api/webhooks");
      const isSlack = cfg.webhookUrl.includes("hooks.slack.com/");
      const payload = isDiscord
        ? { content: `**${content.subject}**\n${content.text}` }
        : isSlack
        ? { text: `*${content.subject}*\n${content.text}` }
        : {
            event: "osdr_api_key_alert",
            subject: content.subject,
            provider: params.provider,
            model: params.model,
            errorCategory: params.errorCategory,
            statusCode: params.statusCode,
            errorMessage: params.errorMessage,
            timestamp: event.timestamp,
            appUrl: cfg.appUrl,
          };

      const resp = await fetchImpl(cfg.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (resp.ok) {
        event.delivered = true;
      } else {
        event.deliveryErrors.push(`Webhook HTTP ${resp.status}`);
      }
    } catch (err: any) {
      event.deliveryErrors.push(`Webhook fetch error: ${err?.message || String(err)}`);
    }
  }

  if (event.delivered) {
    lastAlertSentAt.set(cooldownKey, nowMs);
  }
  recordAlertHistory(event);
  return event;
}

export async function sendTestApiKeyAlert(
  transport: AlertDeliveryTransport = {}
): Promise<ApiKeyAlertEvent> {
  const res = await notifyApiKeyFailure(
    {
      provider: "groq",
      model: "openai/gpt-oss-120b",
      errorCategory: "auth_error",
      statusCode: 401,
      errorMessage:
        "Synthetic test alert triggered from OSDR ChatBot Admin Portal to confirm email/webhook delivery.",
      force: true,
      isTest: true,
    },
    transport
  );
  return res!;
}

function recordAlertHistory(event: ApiKeyAlertEvent) {
  recentAlerts.unshift(event);
  if (recentAlerts.length > MAX_ALERT_HISTORY) {
    recentAlerts.length = MAX_ALERT_HISTORY;
  }
}

export function getAlertNotifierStatus() {
  const cfg = getAlertConfig();
  return {
    emailConfigured: cfg.emailConfigured,
    emailRecipientCount: cfg.emailRecipients.length,
    emailRecipientsMasked: cfg.emailRecipients.map((e) => {
      const [local, domain] = e.split("@");
      if (!domain) return "***";
      return `${local.slice(0, 2)}***@${domain}`;
    }),
    webhookConfigured: cfg.webhookConfigured,
    cooldownMinutes: cfg.cooldownMinutes,
    alertOnQuotaErrors: cfg.alertOnQuotaErrors,
    recentAlertsCount: recentAlerts.length,
    recentAlerts: recentAlerts.slice(0, 10),
  };
}

export function resetAlertNotifierStateForTests() {
  lastAlertSentAt.clear();
  recentAlerts.length = 0;
}
