import assert from "node:assert/strict";
import {
  getAlertNotifierStatus,
  notifyApiKeyFailure,
  resetAlertNotifierStateForTests,
  sendTestApiKeyAlert,
} from "../server/alertNotifier";
import { getGroqModelCandidates } from "../server/textProviders";

async function runTests() {
  console.log("Running API Key Rejection Email/Webhook Alert & Groq Model Cascade Tests...\n");

  const prevEnv = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    ALERT_EMAIL_TO: process.env.ALERT_EMAIL_TO,
    ALERT_WEBHOOK_URL: process.env.ALERT_WEBHOOK_URL,
    ALERT_COOLDOWN_MINUTES: process.env.ALERT_COOLDOWN_MINUTES,
    ALERT_ON_QUOTA_ERRORS: process.env.ALERT_ON_QUOTA_ERRORS,
  };

  try {
    resetAlertNotifierStateForTests();
    process.env.RESEND_API_KEY = "re_test_key_12345";
    process.env.ALERT_EMAIL_TO = "gastondana627@gmail.com";
    process.env.ALERT_WEBHOOK_URL = "https://example.org/hook";
    process.env.ALERT_COOLDOWN_MINUTES = "60";
    process.env.ALERT_ON_QUOTA_ERRORS = "false";

    const sentCalls: Array<{ url: string; body: any; auth?: string }> = [];
    const mockFetch: any = async (url: string, init: any) => {
      sentCalls.push({
        url,
        body: JSON.parse(init.body),
        auth: init.headers?.Authorization,
      });
      return { ok: true, status: 200, statusText: "OK", text: async () => '{"id":"ok"}' };
    };

    // Test 1: auth_error sends email via Resend + optional webhook
    const ev1 = await notifyApiKeyFailure(
      {
        provider: "groq",
        model: "openai/gpt-oss-120b",
        errorCategory: "auth_error",
        statusCode: 401,
        errorMessage: "GROQ API key is unauthorized or invalid (HTTP 401).",
      },
      { fetchFn: mockFetch }
    );
    assert.ok(ev1, "Expected alert event on auth_error");
    assert.equal(ev1.delivered, true);
    assert.equal(ev1.suppressedByCooldown, false);
    assert.deepEqual(ev1.channelsAttempted, ["resend_email", "webhook"]);
    assert.equal(sentCalls.length, 2);
    assert.equal(sentCalls[0].url, "https://api.resend.com/emails");
    assert.equal(sentCalls[0].auth, "Bearer re_test_key_12345");
    assert.deepEqual(sentCalls[0].body.to, ["gastondana627@gmail.com"]);
    assert.ok(sentCalls[0].body.subject.includes("GROQ_API_KEY"));
    assert.ok(sentCalls[0].body.text.includes("https://console.groq.com/keys"));
    console.log("✓ Test 1 passed: Rejected key dispatches Resend email + webhook with console link");

    // Test 2: Cooldown suppresses duplicate reminder emails for the same provider
    const ev2 = await notifyApiKeyFailure(
      {
        provider: "groq",
        model: "openai/gpt-oss-120b",
        errorCategory: "auth_error",
        statusCode: 401,
        errorMessage: "Duplicate failure within cooldown window",
      },
      { fetchFn: mockFetch }
    );
    assert.ok(ev2);
    assert.equal(ev2.suppressedByCooldown, true);
    assert.equal(ev2.delivered, false);
    assert.equal(sentCalls.length, 2, "Cooldown must prevent duplicate emails");
    console.log("✓ Test 2 passed: 60-minute cooldown prevents duplicate reminder spam");

    // Test 3: 429 quota_error does NOT email by default unless ALERT_ON_QUOTA_ERRORS=true
    const evQuotaOff = await notifyApiKeyFailure(
      {
        provider: "gemini",
        model: "gemini-3.7-flash",
        errorCategory: "quota_error",
        statusCode: 429,
        errorMessage: "GEMINI quota exceeded",
      },
      { fetchFn: mockFetch }
    );
    assert.equal(evQuotaOff, null, "429 quota errors must stay silent when ALERT_ON_QUOTA_ERRORS=false");

    process.env.ALERT_ON_QUOTA_ERRORS = "true";
    const evQuotaOn = await notifyApiKeyFailure(
      {
        provider: "gemini",
        model: "gemini-3.7-flash",
        errorCategory: "quota_error",
        statusCode: 429,
        errorMessage: "GEMINI quota exceeded",
      },
      { fetchFn: mockFetch }
    );
    assert.ok(evQuotaOn && evQuotaOn.delivered === true, "429 quota alerts fire when explicitly opted in");
    console.log("✓ Test 3 passed: Quota alerts respect ALERT_ON_QUOTA_ERRORS opt-in flag");

    // Test 4: Forced test alert & masked status diagnostics
    const testEv = await sendTestApiKeyAlert({ fetchFn: mockFetch });
    assert.equal(testEv.delivered, true);
    const status = getAlertNotifierStatus();
    assert.equal(status.emailConfigured, true);
    assert.equal(status.emailRecipientsMasked[0], "ga***@gmail.com");
    assert.ok(status.recentAlertsCount >= 3);
    console.log("✓ Test 4 passed: Test alert dispatch & privacy-masked admin status verified");

    // Test 5: Groq production model cascade includes openai/gpt-oss-120b & gpt-oss-20b
    const groqList = getGroqModelCandidates("groq/llama-3.3-70b-versatile");
    assert.ok(groqList.includes("openai/gpt-oss-120b"), "Groq cascade must include live openai/gpt-oss-120b");
    assert.ok(groqList.includes("openai/gpt-oss-20b"), "Groq cascade must include live openai/gpt-oss-20b");
    assert.ok(groqList.includes("llama-3.1-8b-instant"), "Groq cascade must include llama-3.1-8b-instant");
    console.log("✓ Test 5 passed: Groq live production model cascade verified");

    console.log("\nAll 5 API Key Alert & Groq Cascade tests passed!");
  } finally {
    resetAlertNotifierStateForTests();
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

runTests().catch((err) => {
  console.error("Alert notifier test failed:", err);
  process.exit(1);
});
