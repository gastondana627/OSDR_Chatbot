import assert from "assert";
import { createEvidenceBundle } from "../server/evidenceBundle";

const timestamp = new Date("2026-11-20T10:00:00.000Z");
const entries = [
  {
    prompt: "Compare OSD_255 and OSD-557",
    response: "The analysis cites OSD-583 as additional context.",
    citedAccessions: ["OSD-255", { study_id: "OSD_685" }, "not-an-accession"],
    model: "gemini-3.7-flash",
    provider: "gemini",
  },
];

const markdown = createEvidenceBundle(entries, "markdown", timestamp);
assert.strictEqual(markdown.extension, "md");
assert.match(markdown.contentType, /text\/markdown/);
assert.ok(markdown.body.includes("2026-11-20T10:00:00.000Z"));
assert.match(markdown.body, /Compare OSD_255 and OSD-557/);
assert.match(markdown.body, /The analysis cites OSD-583 as additional context/);
assert.match(markdown.body, /OSD-255, OSD-685, OSD-557, OSD-583/);
assert.match(markdown.body, /gemini-3\.7-flash/);
assert.match(markdown.body, /Provider:\*\* gemini/);

const jsonBundle = createEvidenceBundle(entries, "json", timestamp);
assert.strictEqual(jsonBundle.extension, "json");
const parsed = JSON.parse(jsonBundle.body);
assert.strictEqual(parsed.generatedAt, "2026-11-20T10:00:00.000Z");
assert.strictEqual(parsed.activeModel, "gemini-3.7-flash");
assert.strictEqual(parsed.activeProvider, "gemini");
assert.deepStrictEqual(parsed.entries[0].citedAccessions, ["OSD-255", "OSD-685", "OSD-557", "OSD-583"]);
assert.strictEqual(parsed.entries[0].userPrompt, entries[0].prompt);
assert.strictEqual(parsed.entries[0].assistantResponse, entries[0].response);

console.log("Evidence bundle formatting tests passed.");
