import assert from "assert";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import {
  LEO_DEMO_BADGE,
  LEO_PROVENANCE_BROWSER,
  LEO_PROVENANCE_PYTHON,
  buildLeoDemoDataset,
  evaluateLeoCsvText,
  evaluateLeoRows,
  generateIllustrativeLeoDemoRows,
  generateLeoSvgSnapshot,
  getLeoProvenanceBadgeText,
  runHybridArmAndConfirm,
  serializeDiscrepanciesToCsv,
  validateLeoEvalJson,
} from "../src/utils/leoDosimetry.js";
import { SYSTEM_PROMPT } from "../server/rag";
import { AWG_SYSTEM_PROMPT, createAwgHelpMessage } from "../server/awg";

function runLeoDosimetryTests() {
  console.log("▶ Running LEO Dosimetry SAA/GCR Pass-Audit & Parity Tests...\n");

  const demoCsvPath = path.join(
    process.cwd(),
    "scripts/sample_data/leo_saa_gcr_demo_passes.csv"
  );
  const csvText = fs.readFileSync(demoCsvPath, "utf-8");

  // 1. Client-side JS evaluation & Merge vs. Hysteresis
  console.log("Test 1: Client-side Pass-Level Evaluation, Merge vs. Hysteresis & Hybrid Metrics");
  {
    const jsA = evaluateLeoCsvText(csvText, {
      filename: "leo_saa_gcr_demo_passes.csv",
      bootstrapResamples: 400,
      seed: 42,
    });
    const jsB = evaluateLeoCsvText(csvText, {
      filename: "leo_saa_gcr_demo_passes.csv",
      bootstrapResamples: 400,
      seed: 42,
    });
    assert.deepStrictEqual(jsA, jsB, "Browser JS evaluation must be strictly deterministic");
    assert.strictEqual(jsA.summary.total_passes, 12);

    const hystSb = jsA.rules.hysteresis.scoreboard;
    const mergeSb = jsA.rules.merge.scoreboard;
    assert.ok(hystSb.hybrid.entry_lead_lag_min < -0.3, "Hybrid must provide early warning (< -0.3m)");
    assert.ok(hystSb.nasa_flag.exit_lag_min > 3.5, "NASA flag must show long exit tail (> 3.5m)");
    assert.ok(
      hystSb.hybrid.exit_lag_min < hystSb.nasa_flag.exit_lag_min - 2.5,
      "Hybrid must cut NASA's exit tail dramatically"
    );
    assert.ok(
      hystSb.hybrid.false_alarms_per_day < hystSb.nasa_flag.false_alarms_per_day - 2.0,
      "Hybrid must eliminate NASA's position-only false alarms"
    );
    assert.ok(
      mergeSb.model_a.exit_lag_min > hystSb.model_a.exit_lag_min,
      "Merge rule should differ from Hysteresis on Model A boundary flutter"
    );
    console.log("  ✔ Deterministic pass-level scoring, Merge vs. Hysteresis, and Hybrid advantages verified");
  }

  // 2. Python leo_saa_eval.py <-> Browser JS Exact Parity
  console.log("\nTest 2: Python scripts/leo_saa_eval.py <-> Browser JS Mathematical Parity");
  {
    const venvPy = path.join(process.cwd(), ".venv/bin/python");
    const pyBin = fs.existsSync(venvPy) ? venvPy : "python3";
    const pyStdout = execFileSync(
      pyBin,
      [
        path.join(process.cwd(), "scripts/leo_saa_eval.py"),
        "--input",
        demoCsvPath,
        "--bootstrap",
        "1000",
        "--seed",
        "42",
      ],
      { encoding: "utf-8" }
    );
    const pyEval = validateLeoEvalJson(JSON.parse(pyStdout), "leo_eval.json");
    const jsEval = evaluateLeoCsvText(csvText, {
      filename: "leo_saa_gcr_demo_passes.csv",
      bootstrapResamples: 1000,
      seed: 42,
    });

    for (const rule of ["hysteresis", "merge"]) {
      for (const det of ["nasa_flag", "model_a", "model_b", "hybrid"]) {
        const p = pyEval.rules[rule].scoreboard[det];
        const j = jsEval.rules[rule].scoreboard[det];
        assert.strictEqual(p.tp, j.tp, `${rule}.${det} TP mismatch`);
        assert.strictEqual(p.fp, j.fp, `${rule}.${det} FP mismatch`);
        assert.strictEqual(p.fn, j.fn, `${rule}.${det} FN mismatch`);
        assert.ok(Math.abs(p.f1 - j.f1) < 1e-4, `${rule}.${det} F1 mismatch`);
        assert.ok(
          Math.abs(p.entry_lead_lag_min - j.entry_lead_lag_min) < 1e-3,
          `${rule}.${det} entry lag mismatch`
        );
        assert.ok(
          Math.abs(p.exit_lag_min - j.exit_lag_min) < 1e-3,
          `${rule}.${det} exit lag mismatch`
        );
        assert.ok(
          Math.abs(p.false_alarms_per_day - j.false_alarms_per_day) < 1e-3,
          `${rule}.${det} FA/day mismatch`
        );
        assert.ok(
          Math.abs(p.saa_dose_fraction_pct - j.saa_dose_fraction_pct) < 1e-2,
          `${rule}.${det} SAA dose % mismatch`
        );
        if (det === "nasa_flag") {
          assert.strictEqual(p.delta_f1_vs_nasa, null);
          assert.strictEqual(j.delta_f1_vs_nasa, null);
        } else {
          assert.ok(
            Math.abs(p.delta_f1_vs_nasa.delta - j.delta_f1_vs_nasa.delta) < 1e-4,
            `${rule}.${det} paired delta_f1_vs_nasa point estimate mismatch`
          );
          assert.strictEqual(
            p.delta_f1_vs_nasa.ci_95[0] <= p.delta_f1_vs_nasa.delta &&
              p.delta_f1_vs_nasa.delta <= p.delta_f1_vs_nasa.ci_95[1],
            true
          );
          assert.strictEqual(
            j.delta_f1_vs_nasa.ci_95[0] <= j.delta_f1_vs_nasa.delta &&
              j.delta_f1_vs_nasa.delta <= j.delta_f1_vs_nasa.ci_95[1],
            true
          );
          assert.strictEqual(
            j.delta_f1_vs_nasa.significant,
            j.delta_f1_vs_nasa.ci_95[0] > 0 || j.delta_f1_vs_nasa.ci_95[1] < 0
          );
        }
      }

      // Exact Discrepancy Auditor parity
      assert.deepStrictEqual(
        pyEval.rules[rule].discrepancies.map((d: any) => `${d.pass_id}:${d.code}`),
        jsEval.rules[rule].discrepancies.map((d: any) => `${d.pass_id}:${d.code}`),
        `${rule} discrepancy queue must match identically between Python and JS`
      );
    }

    assert.strictEqual(
      getLeoProvenanceBadgeText(pyEval),
      LEO_PROVENANCE_PYTHON,
      "Python JSON import must display leo_saa_eval.py Python badge"
    );
    assert.strictEqual(
      getLeoProvenanceBadgeText(jsEval),
      LEO_PROVENANCE_BROWSER,
      "Direct CSV drop must display Local Browser Eval badge"
    );
    console.log("  ✔ Exact Python <-> Browser JS parity verified across Hysteresis, Merge, Scoreboard & Discrepancies");
  }

  // 3. Discrepancy Auditor, Hybrid State Machine, Demo Badge & SVG Export
  console.log("\nTest 3: Discrepancy Auditor, Hybrid State Machine, Demo Provenance & SVG Export");
  {
    const demo = buildLeoDemoDataset();
    assert.strictEqual(demo.isIllustrativeDemo, true);
    assert.strictEqual(getLeoProvenanceBadgeText(demo), LEO_DEMO_BADGE);

    const topFlag = demo.rules.hysteresis.discrepancies[0];
    assert.strictEqual(topFlag.pass_id, "PASS_08");
    assert.strictEqual(topFlag.code, "MISSING_HUMAN_LABEL");
    assert.strictEqual(topFlag.severity, "high");

    // Verify 24-pass cohort produces statistically significant Paired Delta F1 vs NASA (CI excludes 0)
    const baseRows = generateIllustrativeLeoDemoRows();
    const doubled = [
      ...baseRows,
      ...baseRows.map((r: any) => ({
        ...r,
        pass_id: `${r.pass_id}_B`,
        time_min: r.time_min + 1500,
      })),
    ];
    const eval24 = evaluateLeoRows(doubled, { bootstrapResamples: 1000, seed: 42 });
    const hyDf24 = eval24.rules.hysteresis.scoreboard.hybrid.delta_f1_vs_nasa;
    assert.ok(hyDf24.ci_95[0] > 0, `Expected significant 95% CI > 0 on 24 passes, got ${hyDf24.ci_95}`);
    assert.strictEqual(hyDf24.significant, true);

    // Verify Export Discrepancies CSV columns & content
    const discCsv = serializeDiscrepanciesToCsv(
      demo.rules.hysteresis.discrepancies,
      demo.rules.hysteresis.passes
    );
    const csvLines = discCsv.trim().split("\n");
    assert.strictEqual(
      csvLines[0],
      "pass_id,priority,code,reason,peak_flux,window_start,window_end",
      "Discrepancy CSV header must match exact required schema"
    );
    assert.strictEqual(csvLines.length, demo.rules.hysteresis.discrepancies.length + 1);
    assert.ok(csvLines[1].startsWith("PASS_08,1,MISSING_HUMAN_LABEL,"));

    const times = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
    const nasa = [0, 1, 1, 1, 1, 1, 1, 1, 0];
    const unconfirmed = runHybridArmAndConfirm(
      times,
      nasa,
      times.map(() => null),
      times.map(() => null),
      []
    );
    assert.strictEqual(unconfirmed.events.length, 0, "Unconfirmed NASA arm must emit 0 events");
    assert.strictEqual(unconfirmed.disarmed_arms.length, 1, "Unconfirmed NASA arm must be recorded as disarmed");

    const svg = generateLeoSvgSnapshot(demo, { rule: "hysteresis", passId: "PASS_08" });
    assert.ok(svg.startsWith("<?xml"), "SVG export must start with XML prolog");
    assert.ok(svg.includes("PASS_08"), "SVG export must include selected pass ID");
    assert.ok(svg.includes("PASS-LEVEL SCOREBOARD"), "SVG export must include scoreboard");
    console.log("  ✔ Discrepancy auditor, Hybrid state machine, provenance badges, and SVG export verified");
  }

  // 4. Route, Sidebar & LicenseHudOverlay Suppression Check
  console.log("\nTest 4: Dedicated /leo-dosimetry Route, Sidebar Nav & LicenseHudOverlay Suppression");
  {
    const appSrc = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf-8");
    const sidebarSrc = fs.readFileSync(
      path.join(process.cwd(), "src/components/chat/Sidebar.jsx"),
      "utf-8"
    );
    assert.ok(appSrc.includes('"/leo-dosimetry"'), "src/App.jsx must handle /leo-dosimetry");
    assert.ok(appSrc.includes("LeoDosimetryExplorer"), "src/App.jsx must lazy-load LeoDosimetryExplorer");
    assert.ok(
      appSrc.includes('activeRoute !== "/brain-awg" && activeRoute !== "/leo-dosimetry" && <LicenseHudOverlay'),
      "src/App.jsx must suppress LicenseHudOverlay on both /brain-awg and /leo-dosimetry"
    );
    assert.ok(
      sidebarSrc.includes("onOpenLeoDosimetry"),
      "Sidebar must render LEO Dosimetry navigation entry"
    );
    assert.ok(
      sidebarSrc.includes("<strong>LEO Dosimetry</strong>") &&
        sidebarSrc.includes('<span className="sidebar-leo-tag">SAA/GCR</span>'),
      "Sidebar LEO Dosimetry button must use concise label with SAA/GCR pill to prevent truncation"
    );
    console.log("  ✔ /leo-dosimetry route, lazy loading, Sidebar entry, and LicenseHudOverlay suppression verified");
  }

  // 5. System Prompts Briefed on Thread #3665 & Epistemic Guardrails
  console.log("\nTest 5: System Prompts Briefed on /leo-dosimetry & Thread #3665 Guardrails");
  {
    for (const [name, promptText] of [
      ["SYSTEM_PROMPT", SYSTEM_PROMPT],
      ["AWG_SYSTEM_PROMPT", AWG_SYSTEM_PROMPT],
    ]) {
      assert.ok(promptText.includes("/leo-dosimetry"), `${name} must mention /leo-dosimetry`);
      assert.ok(promptText.includes("#3665"), `${name} must reference AWG Thread #3665`);
      assert.ok(promptText.includes("leo_saa_eval.py"), `${name} must reference scripts/leo_saa_eval.py`);
      assert.ok(promptText.includes("Hysteresis"), `${name} must mention Hysteresis`);
      assert.ok(promptText.includes("Arm-and-Confirm"), `${name} must mention Hybrid Arm-and-Confirm`);
      assert.ok(
        promptText.includes("RadLab") || promptText.includes("SPACEDOS"),
        `${name} must guard against fabricating RadLab/SPACEDOS telemetry`
      );
    }
    const help = createAwgHelpMessage();
    assert.ok(help.includes("/leo-dosimetry"), "AWG help message must document /leo-dosimetry");
    console.log("  ✔ System prompts briefed on /leo-dosimetry with strict anti-fabrication guardrails");
  }

  console.log("\n============================================================");
  console.log("🎉 ALL LEO DOSIMETRY SAA/GCR PASS-AUDIT TESTS PASSED!");
  console.log("============================================================\n");
}

runLeoDosimetryTests();
