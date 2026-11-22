import assert from "assert";
import fs from "fs";
import path from "path";
import {
  ILLUSTRATIVE_DEMO_BADGE,
  PROVENANCE_BADGE_BROWSER_LOCAL,
  PROVENANCE_BADGE_SKBIO_PYTHON,
  buildBrainAwgDemoDataset,
  computeGroupSummaries,
  generateOrdinationSvgSnapshot,
  getProvenanceBadgeText,
  ordinateFromCsvText,
  pairwiseEuclideanDistanceMatrix,
  rclrTransform,
  runPcoa3d,
  runPermanova,
  validateOrdinationJson,
} from "../src/utils/brainOrdination.js";
import { SYSTEM_PROMPT } from "../server/rag";
import { AWG_SYSTEM_PROMPT, createAwgHelpMessage } from "../server/awg";

function runBrainAwgTests() {
  console.log("▶ Running Brain AWG 3D Ordination Explorer & Epistemic Guardrails Tests...\n");

  // 1. Client-side rclr handles zero entries cleanly
  console.log("Test 1: Client-side rclr + Euclidean/Aitchison Distance + 3D PCoA + PERMANOVA");
  {
    const mat = [
      [10, 0, 5, 2],
      [12, 0, 4, 2.5],
      [11, 1, 5, 2],
      [1, 18, 2, 15],
      [0, 20, 1.5, 16],
      [1.2, 19, 2.2, 14],
    ];
    const rclr = rclrTransform(mat);
    assert.strictEqual(rclr[0][1], 0, "Zero abundance entry must map to 0.0 in rclr");
    assert.ok(Number.isFinite(rclr[0][0]) && rclr[0][0] > 0, "Largest positive entry has positive rclr");

    const dm = pairwiseEuclideanDistanceMatrix(rclr);
    assert.strictEqual(dm.length, 6);
    assert.strictEqual(dm[0][0], 0);
    assert.ok(Math.abs(dm[0][3] - dm[3][0]) < 1e-12, "Distance matrix must be symmetric");

    const pcoaA = runPcoa3d(dm);
    const pcoaB = runPcoa3d(dm);
    assert.deepStrictEqual(pcoaA, pcoaB, "3D PCoA must be deterministic");
    assert.strictEqual(pcoaA.coords.length, 6);
    assert.strictEqual(pcoaA.varianceExplained.length, 3);
    assert.ok(pcoaA.varianceExplained[0] > 0.5, "PC1 should capture primary group separation");

    const groups = ["Spaceflight", "Spaceflight", "Spaceflight", "Ground", "Ground", "Ground"];
    const pmA = runPermanova(dm, groups, 199, 42);
    const pmB = runPermanova(dm, groups, 199, 42);
    assert.deepStrictEqual(pmA, pmB, "PERMANOVA must be strictly deterministic with fixed seed");
    assert.ok(pmA.f_stat > 10, `Expected high PERMANOVA F for separated groups, got ${pmA.f_stat}`);
    assert.ok(pmA.p_value > 0 && pmA.p_value <= 0.12, `Expected valid p-value, got ${pmA.p_value}`);
    console.log("  ✔ Client-side rclr + 3D PCoA + PERMANOVA deterministic and accurate");
  }

  // 2. Illustrative Demo Dataset & Epistemic Labeling
  console.log("\nTest 2: Illustrative Demo Dataset Provenance & Zero Fabricated OSD IDs");
  {
    const demo = buildBrainAwgDemoDataset();
    assert.strictEqual(demo.isIllustrativeDemo, true, "Demo must be flagged isIllustrativeDemo=true");
    assert.ok(
      demo.provenance.note.includes(ILLUSTRATIVE_DEMO_BADGE),
      "Demo note must include explicit Illustrative Demo badge"
    );
    assert.strictEqual(demo.samples.length, 18);
    assert.strictEqual(demo.variance_explained.length, 3);
    assert.ok(demo.permanova.f_stat > 10, "Demo cohort should have well-defined group separation");
    assert.ok(demo.permanova.p_value > 0 && demo.permanova.p_value <= 0.01);
    assert.strictEqual(
      /OSD-\d+/i.test(JSON.stringify(demo)),
      false,
      "Illustrative demo must NEVER fabricate or claim an OSD-### accession"
    );

    const summaries = computeGroupSummaries(demo.samples);
    assert.strictEqual(summaries.length, 3);
    assert.deepStrictEqual(
      summaries.map((g) => g.group),
      ["Ground Control", "Spaceflight", "Alzheimer's Model"]
    );
    console.log("  ✔ Illustrative Demo explicitly badged and free of fabricated OSD accessions");
  }

  // 3. Direct Browser CSV Upload + JSON Validation + Publication SVG Snapshot
  console.log("\nTest 3: Direct CSV Ingestion, JSON Schema Validation & Vector SVG Export");
  {
    const sampleCsvPath = path.join(
      process.cwd(),
      "scripts/sample_data/drosophila_mito_demo_combined.csv"
    );
    const csvText = fs.readFileSync(sampleCsvPath, "utf-8");
    const parsedCsv = ordinateFromCsvText(csvText, {
      filename: "drosophila_mito_demo_combined.csv",
      permutations: 99,
      seed: 42,
    });
    assert.strictEqual(parsedCsv.samples.length, 18);
    assert.ok(parsedCsv.permanova.f_stat > 10);

    const validated = validateOrdinationJson(parsedCsv, "export.json");
    assert.strictEqual(validated.samples.length, 18);
    assert.throws(() => validateOrdinationJson({ samples: [] }), /at least 2 sample/);

    // Verify accurate provenance pills across all 3 cohort sources
    assert.strictEqual(
      getProvenanceBadgeText(buildBrainAwgDemoDataset()),
      ILLUSTRATIVE_DEMO_BADGE,
      "Demo dataset must use Illustrative Demo badge"
    );
    assert.strictEqual(
      getProvenanceBadgeText(parsedCsv),
      PROVENANCE_BADGE_BROWSER_LOCAL,
      "Browser CSV drop must show Local Browser rclr + PCoA badge"
    );
    const pySimulated = validateOrdinationJson(
      {
        samples: parsedCsv.samples,
        variance_explained: parsedCsv.variance_explained,
        permanova: parsedCsv.permanova,
        provenance: {
          method: "rclr + Euclidean/Aitchison DistanceMatrix + 3D PCoA + PERMANOVA (scikit-bio)",
          dataset_label: "Real Cohort Study",
          note: "Exported by skbio_to_3d.py",
        },
      },
      "real_cohort.json"
    );
    assert.strictEqual(
      getProvenanceBadgeText(pySimulated),
      PROVENANCE_BADGE_SKBIO_PYTHON,
      "Python skbio_to_3d.py JSON upload must show scikit-bio Python badge"
    );

    const svg = generateOrdinationSvgSnapshot(buildBrainAwgDemoDataset());
    assert.ok(svg.startsWith("<?xml"), "SVG snapshot must start with XML prolog");
    assert.ok(svg.includes("PC1 ("), "SVG must include PC1 variance label");
    assert.ok(svg.includes("PERMANOVA F:"), "SVG must include PERMANOVA F readout");
    assert.ok(svg.includes(ILLUSTRATIVE_DEMO_BADGE), "SVG must retain Illustrative Demo warning badge");
    assert.ok(
      generateOrdinationSvgSnapshot(pySimulated).includes(PROVENANCE_BADGE_SKBIO_PYTHON),
      "SVG snapshot for skbio JSON must retain scikit-bio Python badge"
    );
    console.log("  ✔ Direct CSV ingestion, JSON validator, provenance pills, and publication SVG snapshot verified");
  }

  // 4. Route & Sidebar Integration Check
  console.log("\nTest 4: Dedicated /brain-awg Route & Decoupled Workspace Wiring");
  {
    const appSrc = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf-8");
    const sidebarSrc = fs.readFileSync(
      path.join(process.cwd(), "src/components/chat/Sidebar.jsx"),
      "utf-8"
    );
    assert.ok(appSrc.includes('"/brain-awg"'), "src/App.jsx must handle /brain-awg route");
    assert.ok(
      /activeRoute !== "\/brain-awg"[\s\S]*?<LicenseHudOverlay/.test(appSrc),
      "src/App.jsx must hide fixed LicenseHudOverlay on /brain-awg to prevent overlap"
    );
    assert.ok(
      appSrc.includes("BrainAwgOrdinationExplorer"),
      "src/App.jsx must render BrainAwgOrdinationExplorer"
    );
    assert.ok(
      sidebarSrc.includes("onOpenBrainAwg"),
      "Sidebar must expose dedicated Brain AWG 3D Space navigation"
    );
    console.log("  ✔ /brain-awg route, LicenseHudOverlay suppression, and Sidebar navigation wired cleanly");
  }

  // 5. System Prompt & AWG Prompt Briefing + RR-10 v1.1 EC-01..EC-06 Guardrails
  console.log("\nTest 5: System Prompt Briefing & RR-10 v1.1 Epistemic Guardrails (EC-01..EC-06)");
  {
    for (const [name, promptText] of [
      ["SYSTEM_PROMPT", SYSTEM_PROMPT],
      ["AWG_SYSTEM_PROMPT", AWG_SYSTEM_PROMPT],
    ]) {
      assert.ok(promptText.includes("/brain-awg"), `${name} must mention /brain-awg`);
      assert.ok(promptText.includes("scikit-bio"), `${name} must mention scikit-bio`);
      assert.ok(promptText.includes("rclr"), `${name} must mention rclr`);
      assert.ok(promptText.includes("pcoa"), `${name} must mention pcoa`);
      assert.ok(promptText.includes("permanova"), `${name} must mention permanova`);
      assert.ok(promptText.includes("skbio.embedding"), `${name} must mention skbio.embedding`);
      assert.ok(promptText.includes("#3903"), `${name} must reference Mitochondria Subgroup Thread #3903`);
      assert.ok(promptText.includes("#2612"), `${name} must reference Exosome biomarkers #2612`);
      assert.ok(promptText.includes("EC-01..EC-06"), `${name} must reference EC-01..EC-06`);
      assert.ok(
        promptText.includes("10.5281/zenodo.24439497"),
        `${name} must reference Zenodo DOI 10.5281/zenodo.24439497`
      );
      assert.ok(promptText.includes("q < 0.05"), `${name} must enforce FDR q < 0.05 cross-study guardrail`);
      assert.ok(
        promptText.toLowerCase().includes("illustrative demo"),
        `${name} must distinguish illustrative demos from empirical OSDR datasets`
      );
    }

    const helpText = createAwgHelpMessage();
    assert.ok(helpText.includes("/brain-awg"), "AWG help message must document /brain-awg");
    assert.ok(helpText.includes("10.5281/zenodo.24439497"), "AWG help must cite Zenodo DOI");
    console.log("  ✔ System prompts briefed on Brain AWG Explorer and RR-10 v1.1 EC-01..EC-06 guardrails");
  }

  console.log("\n============================================================");
  console.log("🎉 ALL BRAIN AWG 3D ORDINATION & GUARDRAIL TESTS PASSED!");
  console.log("============================================================\n");
}

runBrainAwgTests();
