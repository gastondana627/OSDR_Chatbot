import assert from "assert";
import { getStudyById } from "../server/rag";
import {
  AWG_RESEARCH_PRESETS,
  CORE_AWG_ACCESSIONS,
  parseAwgQuery,
  resolveAwgResearchPreset,
} from "../server/awg";

for (const accession of CORE_AWG_ACCESSIONS) {
  const study = getStudyById(accession);
  assert.ok(study, `${accession} must be present in the curated study index`);
  assert.strictEqual(study?.study_id, accession, `${accession} must use its canonical accession key`);
  assert.ok(study?.title.trim(), `${accession} must have a title`);
  assert.ok(study?.organism.trim(), `${accession} must have organism metadata`);
  assert.ok(study?.material_type.trim(), `${accession} must have tissue/material metadata`);
  assert.ok(study?.assay_measurement.trim(), `${accession} must have assay metadata`);
}

for (const preset of AWG_RESEARCH_PRESETS) {
  const parsed = parseAwgQuery(`/awg preset ${preset.id}`);
  assert.strictEqual(parsed.action, "research_preset");
  assert.strictEqual(parsed.researchPresetId, preset.id);

  const resolved = resolveAwgResearchPreset(preset.id);
  assert.ok(resolved, `${preset.id} must resolve`);
  assert.deepStrictEqual(resolved?.missingAccessions, [], `${preset.id} must resolve every requested study`);
  assert.deepStrictEqual(
    resolved?.studies.map((study) => study.study_id),
    preset.accessions,
    `${preset.id} must preserve its curated accession order`
  );
}

const rr9 = resolveAwgResearchPreset("rr9-multimodal-retina");
assert.ok(rr9?.preset.analysisNotes.some((note) => note.includes("n=16") && note.includes("CC1/CC2")));

const rr18 = resolveAwgResearchPreset("rr18-brain-buoe");
assert.ok(rr18?.preset.analysisNotes.some((note) => note.includes("MICE-Elastic") && note.includes("KNN")));

console.log("AWG curated accession and research preset tests passed.");
