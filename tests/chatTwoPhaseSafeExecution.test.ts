import { createExpressApp } from "../server/app";
import http from "http";

async function testChatTwoPhaseExecution() {
  console.log("=== Testing /api/chat Two-Phase Preflight & Stream Separation ===");
  const app = createExpressApp();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 1. Phase 1 validation rejection with Accept: application/json (returns HTTP 400 JSON without SSE headers)
    console.log("1. Testing empty payload with JSON client...");
    const rEmptyJson = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ message: "" }),
    });
    if (rEmptyJson.status !== 400) throw new Error(`Expected 400, got ${rEmptyJson.status}`);
    const cTypeJson = rEmptyJson.headers.get("content-type") || "";
    if (!cTypeJson.includes("application/json")) throw new Error(`Expected application/json, got ${cTypeJson}`);
    const dataEmptyJson = await rEmptyJson.json();
    if (dataEmptyJson.failureStage !== "payload_validation" || dataEmptyJson.errorCategory !== "payload_error") {
      throw new Error(`Unexpected payload error body: ${JSON.stringify(dataEmptyJson)}`);
    }
    console.log("   ✓ Empty payload with JSON Accept returned HTTP 400 JSON with structured failureStage");

    // 2. Phase 1 validation rejection with Accept: text/event-stream (returns SSE error event without 500)
    console.log("2. Testing empty payload with SSE client...");
    const rEmptySse = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
      body: JSON.stringify({ message: "" }),
    });
    const textEmptySse = await rEmptySse.text();
    if (!textEmptySse.includes("event: error") || !textEmptySse.includes("ERR_INVALID_PAYLOAD")) {
      throw new Error(`Expected SSE error event, got: ${textEmptySse}`);
    }
    console.log("   ✓ Empty payload with SSE Accept returned safe SSE error stream");

    // 3. Simple greeting ("hi") fast-path execution (Phase 1 local deterministic bypass -> Phase 2 stream)
    console.log("3. Testing simple greeting 'hello' fast-path stream...");
    const rGreeting = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
      body: JSON.stringify({ message: "hello" }),
    });
    if (rGreeting.status !== 200) throw new Error(`Expected 200, got ${rGreeting.status}`);
    const greetingBody = await rGreeting.text();
    if (!greetingBody.includes("event: sources") || !greetingBody.includes("event: token") || !greetingBody.includes("event: done")) {
      throw new Error(`Invalid greeting SSE stream: ${greetingBody}`);
    }
    console.log("   ✓ Simple greeting returned complete SSE stream instantly");

    console.log("\n🎉 ALL CHAT TWO-PHASE TESTS PASSED!\n");
  } finally {
    server.close();
  }
}

testChatTwoPhaseExecution().catch((err) => {
  console.error("Two-phase test failure:", err);
  process.exit(1);
});
