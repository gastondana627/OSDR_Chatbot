import assert from "assert";
import {
  parseRawAccessions,
  normalizeAccession,
  validateAwgAccessions,
} from "../server/accessionValidator";
import { parseAwgQuery, resolveAwgStudies } from "../server/awg";

async function runAccessionValidationTests() {
  console.log("=== Running AWG Accession Validation & Anti-Substitution Tests ===\n");

  // 1. Test parsing & normalization of raw accessions
  console.log("1. Testing parseRawAccessions with various connectors and punctuation...");
  {
    const p1 = parseRawAccessions("/awg compare OSD-681 OSD-681");
    assert.deepStrictEqual(p1, ["OSD-681", "OSD-681"], "Must parse two identical accessions separated by space");

    const p2 = parseRawAccessions("/awg compare OSD-681 & OSD-681");
    assert.deepStrictEqual(p2, ["OSD-681", "OSD-681"], "Must parse two identical accessions with '&' connector");

    const p3 = parseRawAccessions("/awg compare OSD-681 and OSD-679");
    assert.deepStrictEqual(p3, ["OSD-681", "OSD-679"], "Must parse with 'and' connector");

    const p4 = parseRawAccessions("/awg compare OSD-681 with OSD-680");
    assert.deepStrictEqual(p4, ["OSD-681", "OSD-680"], "Must parse with 'with' connector");

    const p5 = parseRawAccessions("/awg compare OSD-681, OSD-680");
    assert.deepStrictEqual(p5, ["OSD-681", "OSD-680"], "Must parse with comma separator");

    const p6 = parseRawAccessions("/awg compare OSD-681 × OSD-680");
    assert.deepStrictEqual(p6, ["OSD-681", "OSD-680"], "Must parse with '×' multiplier connector");

    const p7 = parseRawAccessions("/awg meme OSD-681 & OSD-681");
    assert.deepStrictEqual(p7, ["OSD-681", "OSD-681"], "Must parse meme mode raw accessions with '&'");
  }
  console.log("   ✓ parseRawAccessions normalized connectors and preserved exact sequence.\n");

  // 2. Test identical accession rejection without fallback or silent substitution
  console.log("2. Testing rejection of identical accessions (/awg compare OSD-681 OSD-681 & /awg compare OSD-681 & OSD-681)...");
  {
    const val1 = await validateAwgAccessions(["OSD-681", "OSD-681"]);
    assert.strictEqual(val1.isValid, false, "Validation must fail for identical accessions");
    assert.strictEqual(val1.validationStatus, "identical_accessions", "Status must be identical_accessions");
    assert.deepStrictEqual(val1.requestedPair, ["OSD-681", "OSD-681"], "requestedPair must preserve both entered accessions");
    assert.strictEqual(val1.resolvedPair, null, "resolvedPair must be null (no silent substitution)");
    assert.strictEqual(val1.failedAccession, "OSD-681");
    assert.strictEqual(
      val1.errorMessage,
      "Choose two distinct OSDR studies. You selected OSD-681 twice."
    );
    assert.strictEqual(
      val1.userMessage,
      "Choose two distinct OSDR studies. You selected OSD-681 twice."
    );
    assert.ok(val1.contextualMatches && val1.contextualMatches.length > 0, "Must provide contextual matches for explicit user choice");
    // Ensure duplicate study is filtered from suggestions
    assert.ok(val1.contextualMatches.every((m) => m.study_id !== "OSD-681"));
  }
  console.log("   ✓ Identical accessions strictly rejected with inline validation state and zero silent substitution.\n");

  // 3. Test malformed accession rejection
  console.log("3. Testing malformed accession detection...");
  {
    const valMalformed = await validateAwgAccessions(["OSD-681", "NOT_A_STUDY"]);
    assert.strictEqual(valMalformed.isValid, false);
    assert.strictEqual(valMalformed.validationStatus, "malformed_accession");
    assert.strictEqual(valMalformed.failedAccession, "NOT_A_STUDY");
    assert.strictEqual(valMalformed.resolvedPair, null);
    assert.ok(valMalformed.errorMessage?.includes("not a valid OSDR study format"));
  }
  console.log("   ✓ Malformed accession correctly identified and rejected.\n");

  // 4. Test unavailable/unresolved accession rejection
  console.log("4. Testing unavailable accession rejection...");
  {
    const valUnresolved = await validateAwgAccessions(["OSD-681", "OSD-99999999"]);
    assert.strictEqual(valUnresolved.isValid, false);
    assert.strictEqual(valUnresolved.validationStatus, "unresolved_accession");
    assert.strictEqual(valUnresolved.failedAccession, "OSD-99999999");
    assert.strictEqual(valUnresolved.resolvedPair, null);
    assert.ok(valUnresolved.errorMessage?.includes("could not be resolved in the NASA OSDR repository"));
    assert.ok(valUnresolved.userMessage?.includes("Never substituting studies silently"));
    assert.ok(valUnresolved.contextualMatches && valUnresolved.contextualMatches.length > 0);
  }
  console.log("   ✓ Unavailable accession clearly states which accession failed and never substitutes silently.\n");

  // 5. Test valid distinct accession pair
  console.log("5. Testing valid distinct accession pair (OSD-681 × OSD-679)...");
  {
    const valValid = await validateAwgAccessions(["OSD-681", "OSD-679"]);
    assert.strictEqual(valValid.isValid, true);
    assert.strictEqual(valValid.validationStatus, "valid");
    assert.deepStrictEqual(valValid.requestedPair, ["OSD-681", "OSD-679"]);
    assert.deepStrictEqual(valValid.resolvedPair, ["OSD-681", "OSD-679"]);
    assert.ok(valValid.studyA && valValid.studyA.study_id === "OSD-681");
    assert.ok(valValid.studyB && valValid.studyB.study_id === "OSD-679");
  }
  console.log("   ✓ Valid distinct pair verified; resolvedPair exactly matches requestedPair.\n");

  // 6. Test AWG integration with resolveAwgStudies
  console.log("6. Testing AWG query resolver integration...");
  {
    // Case A: /awg compare OSD-681 & OSD-681
    const qDuplicate = parseAwgQuery("/awg compare OSD-681 & OSD-681");
    assert.deepStrictEqual(qDuplicate.rawRequestedAccessions, ["OSD-681", "OSD-681"]);
    const pairDuplicate = await resolveAwgStudies(qDuplicate);
    assert.ok(pairDuplicate !== null);
    assert.strictEqual(pairDuplicate.validationStatus, "identical_accessions");
    assert.strictEqual(pairDuplicate.resolvedPair, null);
    assert.deepStrictEqual(pairDuplicate.requestedPair, ["OSD-681", "OSD-681"]);
    assert.ok(pairDuplicate.validationError !== undefined);
    assert.strictEqual(
      pairDuplicate.validationError.userMessage,
      "Choose two distinct OSDR studies. You selected OSD-681 twice."
    );

    // Case B: Explicit confirmed replacement /awg compare OSD-681 OSD-680
    const qConfirmed = parseAwgQuery("/awg compare OSD-681 OSD-680");
    const pairConfirmed = await resolveAwgStudies(qConfirmed);
    assert.ok(pairConfirmed !== null);
    assert.strictEqual(pairConfirmed.validationStatus, "valid");
    assert.deepStrictEqual(pairConfirmed.requestedPair, ["OSD-681", "OSD-680"]);
    assert.deepStrictEqual(pairConfirmed.resolvedPair, ["OSD-681", "OSD-680"]);
    assert.strictEqual(pairConfirmed.validationError, undefined);
  }
  console.log("   ✓ resolveAwgStudies returns structured validationError on duplicates and preserves provenance.\n");

  console.log("All AWG Accession Validation tests passed successfully!");
}

runAccessionValidationTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
