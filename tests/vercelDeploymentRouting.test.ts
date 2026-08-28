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
    // 1. GET /api/health - Minimal safe payload verification
    console.log("\n1. Testing /api/health and /health endpoint resolution...");
    const r1 = await fetch(`${baseUrl}/api/health`);
    if (r1.status !== 200) throw new Error(`/api/health failed with status ${r1.status}`);
    const data1 = await r1.json();
    if (data1.ok !== true || typeof data1.serverBoot !== "boolean" || typeof data1.geminiKeyPresent !== "boolean") {
      throw new Error(`/api/health payload structure invalid: ${JSON.stringify(data1)}`);
    }
    console.log("   ✓ /api/health returned 200 OK with minimal safe payload:", JSON.stringify(data1));

    // 2. GET /health (rewritten path without /api)
    const r2 = await fetch(`${baseUrl}/health`);
    if (r2.status !== 200) throw new Error(`/health failed with status ${r2.status}`);
    const data2 = await r2.json();
    if (data2.ok !== true) throw new Error(`/health did not return ok: true`);
    console.log("   ✓ /health (stripped rewrite) returned 200 OK");

    // 3. GET /api/diagnostics
    console.log("\n2. Testing /api/diagnostics endpoint...");
    const rDiag = await fetch(`${baseUrl}/api/diagnostics`);
    if (rDiag.status !== 200) throw new Error(`/api/diagnostics failed with status ${rDiag.status}`);
    const dataDiag = await rDiag.json();
    if (!dataDiag.systemDiagnostics || !dataDiag.osdrDiagnostics) {
      throw new Error(`/api/diagnostics missing diagnostics keys: ${JSON.stringify(dataDiag)}`);
    }
    console.log("   ✓ /api/diagnostics returned 200 OK with system and OSDR diagnostics");

    // 4. GET /api/osdr/diagnostics
    console.log("\n3. Testing /api/osdr/diagnostics endpoint...");
    const rOsdrDiag = await fetch(`${baseUrl}/api/osdr/diagnostics`);
    if (rOsdrDiag.status !== 200) throw new Error(`/api/osdr/diagnostics failed with status ${rOsdrDiag.status}`);
    const dataOsdrDiag = await rOsdrDiag.json();
    if (!dataOsdrDiag.sourceMode || !dataOsdrDiag.dataSources) {
      throw new Error(`/api/osdr/diagnostics missing expected fields: ${JSON.stringify(dataOsdrDiag)}`);
    }
    console.log("   ✓ /api/osdr/diagnostics returned 200 OK:", dataOsdrDiag.sourceMode);

    // 5. GET /api/models
    console.log("\n4. Testing /api/models endpoint...");
    const r3 = await fetch(`${baseUrl}/api/models`);
    if (r3.status !== 200) throw new Error(`/api/models failed with status ${r3.status}`);
    const data3 = await r3.json();
    if (!Array.isArray(data3.models) || data3.models.length === 0) {
      throw new Error("/api/models did not return models array");
    }
    console.log("   ✓ /api/models returned models:", data3.models.join(", "));

    // 6. GET /api/studies
    console.log("\n5. Testing /api/studies endpoint...");
    const r4 = await fetch(`${baseUrl}/api/studies`);
    if (r4.status !== 200) throw new Error(`/api/studies failed with status ${r4.status}`);
    const data4 = await r4.json();
    console.log(`   ✓ /api/studies returned ${data4.count} studies`);

    // 7. POST /api/chat with simple greeting ("Hi")
    console.log("\n6. Testing POST /api/chat with simple greeting ('Hi')...");
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

    // 8. POST /api/chat with /awg compare OSD-679 OSD-680
    console.log("\n7. Testing POST /api/chat with '/awg compare OSD-679 OSD-680'...");
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

    // 9. GET /api/awg/suggestions
    const r7 = await fetch(`${baseUrl}/api/awg/suggestions`);
    if (r7.status !== 200) throw new Error(`/api/awg/suggestions failed with status ${r7.status}`);
    const data7 = await r7.json();
    console.log(`   ✓ /api/awg/suggestions returned ${data7.suggestions?.length || 0} suggested pairs`);

    // 10. Test handler export from api/index.ts
    console.log("\n8. Testing /api/index.ts handler export...");
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
