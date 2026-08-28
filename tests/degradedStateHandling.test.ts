import { createExpressApp } from "../server/app";
import http from "http";

async function testDegradedStates() {
  console.log("=== Testing Degraded State & Exception Handling ===");
  const app = createExpressApp();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 1. Diagnostics endpoint degraded check
    console.log("1. Checking /api/diagnostics structure...");
    const rDiag = await fetch(`${baseUrl}/api/diagnostics`);
    if (rDiag.status !== 200) throw new Error(`/api/diagnostics returned ${rDiag.status}`);
    const dataDiag = await rDiag.json();
    if (dataDiag.routeEntered !== true) throw new Error(`routeEntered is not true in /api/diagnostics`);
    if (typeof dataDiag.providerRegistryLoaded !== "boolean") throw new Error(`providerRegistryLoaded is not boolean`);
    console.log("   ✓ /api/diagnostics returned valid structured metadata");

    // 2. OSDR Diagnostics structure check
    console.log("2. Checking /api/osdr/diagnostics structure...");
    const rOsdr = await fetch(`${baseUrl}/api/osdr/diagnostics`);
    if (rOsdr.status !== 200) throw new Error(`/api/osdr/diagnostics returned ${rOsdr.status}`);
    const dataOsdr = await rOsdr.json();
    if (dataOsdr.routeEntered !== true || dataOsdr.providerRegistryLoaded !== true) {
      throw new Error(`Invalid structured fields in /api/osdr/diagnostics`);
    }
    console.log("   ✓ /api/osdr/diagnostics returned valid structured metadata");

    // 3. POST /api/chat with empty payload (should be 400 with structured JSON, never 500)
    console.log("3. Checking /api/chat with empty message payload...");
    const rChatEmpty = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "", history: [] }),
    });
    if (rChatEmpty.status !== 400) throw new Error(`/api/chat with empty body returned status ${rChatEmpty.status} instead of 400`);
    const dataChatEmpty = await rChatEmpty.json();
    if (dataChatEmpty.routeEntered !== true || dataChatEmpty.errorCategory !== "payload_error") {
      throw new Error(`Invalid structured error for empty chat payload: ${JSON.stringify(dataChatEmpty)}`);
    }
    console.log("   ✓ /api/chat empty payload returned safe 400 with structured metadata");

    // 4. POST /api/osdr/test-connection
    console.log("4. Checking /api/osdr/test-connection structure...");
    const rTestConn = await fetch(`${baseUrl}/api/osdr/test-connection`, { method: "POST" });
    if (rTestConn.status !== 200) throw new Error(`/api/osdr/test-connection returned status ${rTestConn.status}`);
    const dataTest = await rTestConn.json();
    if (dataTest.osdrPingAttempted !== true) throw new Error(`osdrPingAttempted is not true`);
    console.log("   ✓ /api/osdr/test-connection returned structured response with osdrPingAttempted=true");

    console.log("\n🎉 ALL DEGRADED STATE TESTS PASSED!\n");
  } finally {
    server.close();
  }
}

testDegradedStates().catch((err) => {
  console.error("Degraded test failure:", err);
  process.exit(1);
});
