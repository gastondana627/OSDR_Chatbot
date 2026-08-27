import { createExpressApp } from "../server/app";
import http from "http";

async function runTests() {
  console.log("=== Running Vercel Deployment & API Routing Verification Tests ===");
  const app = createExpressApp();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 1. GET /api/health
    console.log("\n1. Testing /api/health and /health endpoint resolution...");
    const r1 = await fetch(`${baseUrl}/api/health`);
    if (r1.status !== 200) throw new Error(`/api/health failed with status ${r1.status}`);
    const data1 = await r1.json();
    console.log("   ✓ /api/health returned 200 OK:", data1.status);

    // 2. GET /health (rewritten path without /api)
    const r2 = await fetch(`${baseUrl}/health`);
    if (r2.status !== 200) throw new Error(`/health failed with status ${r2.status}`);
    console.log("   ✓ /health (stripped rewrite) returned 200 OK");

    // 3. GET /api/models
    const r3 = await fetch(`${baseUrl}/api/models`);
    if (r3.status !== 200) throw new Error(`/api/models failed with status ${r3.status}`);
    const data3 = await r3.json();
    if (!Array.isArray(data3.models) || data3.models.length === 0) {
      throw new Error("/api/models did not return models array");
    }
    console.log("   ✓ /api/models returned models:", data3.models.join(", "));

    // 4. GET /api/studies
    const r4 = await fetch(`${baseUrl}/api/studies`);
    if (r4.status !== 200) throw new Error(`/api/studies failed with status ${r4.status}`);
    const data4 = await r4.json();
    console.log(`   ✓ /api/studies returned ${data4.count} studies`);

    // 5. POST /api/chat with simple non-AWG prompt ("Hi")
    console.log("\n2. Testing POST /api/chat with simple greeting ('Hi')...");
    const r5 = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hi", history: [], model: "gemini-3.7-flash" }),
    });
    if (r5.status !== 200) throw new Error(`POST /api/chat returned status ${r5.status}`);
    const sseText = await r5.text();
    if (!sseText.includes("event: sources") || !sseText.includes("event: done")) {
      throw new Error(`POST /api/chat did not return valid SSE event stream. Got: ${sseText.slice(0, 200)}`);
    }
    console.log("   ✓ POST /api/chat succeeded with SSE stream for simple query");

    // 6. POST /api/chat with /awg compare OSD-679 OSD-680
    console.log("\n3. Testing POST /api/chat with '/awg compare OSD-679 OSD-680'...");
    const r6 = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "/awg compare OSD-679 OSD-680",
        history: [],
        model: "gemini-3.7-flash",
      }),
    });
    if (r6.status !== 200) throw new Error(`POST /api/chat compare returned status ${r6.status}`);
    const sseCompare = await r6.text();
    if (!sseCompare.includes("OSD-679") || !sseCompare.includes("OSD-680")) {
      throw new Error(`POST /api/chat compare missing grounded study sources: ${sseCompare.slice(0, 300)}`);
    }
    console.log("   ✓ POST /api/chat successfully processed '/awg compare OSD-679 OSD-680' and set grounded study state");

    // 7. GET /api/awg/suggestions
    const r7 = await fetch(`${baseUrl}/api/awg/suggestions`);
    if (r7.status !== 200) throw new Error(`/api/awg/suggestions failed with status ${r7.status}`);
    const data7 = await r7.json();
    console.log(`   ✓ /api/awg/suggestions returned ${data7.suggestions?.length || 0} suggested pairs`);

    // 8. Test handler export from api/index.ts
    console.log("\n4. Testing /api/index.ts handler export...");
    const vercelHandler = (await import("../api/index")).default;
    if (typeof vercelHandler !== "function") {
      throw new Error("api/index.ts does not export default function");
    }
    console.log("   ✓ /api/index.ts exports valid default request handler");

    console.log("\n=======================================================");
    console.log("🎉 ALL VERCEL DEPLOYMENT & API ROUTING TESTS PASSED!");
    console.log("=======================================================\n");
  } finally {
    server.close();
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
