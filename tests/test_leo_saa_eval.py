"""Unit tests for LEO Dosimetry SAA/GCR frozen pass-level evaluator (`scripts/leo_saa_eval.py`)."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import leo_saa_eval as evaluator  # noqa: E402

DEMO_CSV = REPO_ROOT / "scripts" / "sample_data" / "leo_saa_gcr_demo_passes.csv"


def _assert_valid_eval_schema(payload: dict) -> None:
    assert set(payload.keys()) == {"schema_version", "summary", "rules", "pass_traces", "provenance"}
    assert payload["summary"]["total_passes"] >= 1
    assert set(payload["rules"].keys()) == {"hysteresis", "merge"}

    for rule_name in ("hysteresis", "merge"):
        rule_obj = payload["rules"][rule_name]
        assert set(rule_obj["scoreboard"].keys()) == {"nasa_flag", "model_a", "model_b", "hybrid"}
        for det_key, stats in rule_obj["scoreboard"].items():
            assert 0.0 <= stats["precision"] <= 1.0
            assert 0.0 <= stats["recall"] <= 1.0
            assert 0.0 <= stats["f1"] <= 1.0
            ci_f1 = stats["ci_95"]["f1"]
            assert len(ci_f1) == 2 and 0.0 <= ci_f1[0] <= ci_f1[1] <= 1.0
            assert stats["false_alarms_per_day"] >= 0.0
            assert 0.0 <= stats["saa_dose_fraction_pct"] <= 100.0


def test_demo_csv_exists_and_evaluates_deterministically() -> None:
    assert DEMO_CSV.exists(), "Sample demo CSV must be present in scripts/sample_data/"
    run_a = evaluator.evaluate_leo_file(DEMO_CSV, bootstrap_resamples=400, seed=42)
    run_b = evaluator.evaluate_leo_file(DEMO_CSV, bootstrap_resamples=400, seed=42)
    _assert_valid_eval_schema(run_a)
    assert json.dumps(run_a, sort_keys=True) == json.dumps(run_b, sort_keys=True)
    assert run_a["summary"]["total_passes"] == 12


def test_hybrid_arm_and_confirm_beats_nasa_exit_tail_and_false_alarms() -> None:
    res = evaluator.evaluate_leo_file(DEMO_CSV, bootstrap_resamples=1000, seed=42)
    sb = res["rules"]["hysteresis"]["scoreboard"]

    nasa = sb["nasa_flag"]
    mb = sb["model_b"]
    hy = sb["hybrid"]

    # NASA provides early warning (< 0), long exit tail (~4.5 min), and multiple false alarms/day
    assert nasa["entry_lead_lag_min"] < -0.3
    assert nasa["exit_lag_min"] > 3.5
    assert nasa["false_alarms_per_day"] >= 3.0

    # Model B has positive entry lag (+1.0..+1.5 min) but clean exit and far fewer false alarms
    assert mb["entry_lead_lag_min"] > 0.5
    assert mb["exit_lag_min"] < nasa["exit_lag_min"] - 2.5

    # Hybrid inherits NASA's early warning (< 0) AND Model B's crisp exit + low false alarms!
    assert hy["entry_lead_lag_min"] < -0.3
    assert hy["exit_lag_min"] < nasa["exit_lag_min"] - 2.5
    assert hy["false_alarms_per_day"] < nasa["false_alarms_per_day"] - 2.0
    assert hy["f1"] > nasa["f1"]

    # Paired Delta F1 vs NASA Flag (95% pass-level bootstrap CI)
    assert nasa["delta_f1_vs_nasa"] is None
    for det_key in ("model_a", "model_b", "hybrid"):
        df = sb[det_key]["delta_f1_vs_nasa"]
        assert df is not None
        expected_delta = round(sb[det_key]["f1"] - nasa["f1"], 4)
        assert abs(df["delta"] - expected_delta) <= 2e-4
        lo, hi = df["ci_95"]
        assert lo <= df["delta"] <= hi
        assert df["significant"] is (lo > 0.0 or hi < 0.0)

    # Verify significance detection when NASA false alarm gap is strong across 24 passes (2x cohort)
    base_rows = evaluator.generate_illustrative_demo_rows()
    doubled_rows = list(base_rows)
    for r in base_rows:
        cloned = dict(r)
        cloned["pass_id"] = f"{r['pass_id']}_B"
        cloned["time_min"] = r["time_min"] + 1500.0
        doubled_rows.append(cloned)
    res_24 = evaluator.evaluate_leo_rows(doubled_rows, bootstrap_resamples=1000, seed=42)
    hy_df_24 = res_24["rules"]["hysteresis"]["scoreboard"]["hybrid"]["delta_f1_vs_nasa"]
    assert hy_df_24["ci_95"][0] > 0.0
    assert hy_df_24["significant"] is True

    # Realistic SAA dose fraction (~70% - 85% of total mission dose)
    assert 68.0 <= hy["saa_dose_fraction_pct"] <= 85.0


def test_merge_vs_hysteresis_boundary_differences() -> None:
    res = evaluator.evaluate_leo_file(DEMO_CSV, bootstrap_resamples=300, seed=42)
    hyst_pass6 = next(p for p in res["rules"]["hysteresis"]["passes"] if p["pass_id"] == "PASS_06")
    merge_pass6 = next(p for p in res["rules"]["merge"]["passes"] if p["pass_id"] == "PASS_06")

    # On PASS_06, Model A has a post-exit 0.54 flutter inside merge_gap_min=2.0
    # Hysteresis (enter=0.65) ignores it; Merge (threshold=0.50, gap=2.0) extends the interval!
    assert merge_pass6["events"]["model_a"][0]["end"] > hyst_pass6["events"]["model_a"][0]["end"]

    # On PASS_04, Model B has a 0.53 skirt flutter so Merge extends Hybrid/Model B exit slightly vs Hysteresis
    hyst_pass4 = next(p for p in res["rules"]["hysteresis"]["passes"] if p["pass_id"] == "PASS_04")
    merge_pass4 = next(p for p in res["rules"]["merge"]["passes"] if p["pass_id"] == "PASS_04")
    assert merge_pass4["events"]["model_b"][0]["end"] > hyst_pass4["events"]["model_b"][0]["end"]


def test_automated_discrepancy_auditor_flags_missed_human_pass() -> None:
    res = evaluator.evaluate_leo_file(DEMO_CSV, bootstrap_resamples=300, seed=42)
    discrepancies = res["rules"]["hysteresis"]["discrepancies"]
    assert len(discrepancies) >= 2

    # Priority 1 must flag PASS_08 where 3/3 detectors fired and human_label was missing
    top = discrepancies[0]
    assert top["pass_id"] == "PASS_08"
    assert top["code"] == "MISSING_HUMAN_LABEL"
    assert top["severity"] == "high"
    assert top["detectors_active"] == 3
    assert isinstance(top["window_start"], (int, float))
    assert isinstance(top["window_end"], (int, float))
    assert top["window_end"] > top["window_start"]

    codes = {d["code"] for d in discrepancies}
    assert "BOUNDARY_DIVERGENCE" in codes
    assert "NASA_UNCONFIRMED_ARM" in codes


def test_hybrid_state_machine_disarms_unconfirmed_nasa_arm_and_respects_cooldown() -> None:
    times = [i * 0.5 for i in range(25)]  # 0.0 .. 12.0 min
    # Case 1: NASA flag turns ON without Model B -> silently disarms, 0 events emitted
    nasa_only = [1.0 if 2.0 <= t <= 6.0 else 0.0 for t in times]
    res_disarm = evaluator.run_hybrid_arm_and_confirm(
        times, nasa_only, [None] * len(times), [None] * len(times), []
    )
    assert res_disarm["events"] == []
    assert len(res_disarm["disarmed_arms"]) == 1

    # Case 2: NASA arms at 2.0, Model B confirms 3.0..6.0, NASA lingers until 10.5 -> 1 clean exit at 6.0, no re-arm!
    nasa_long = [1.0 if 2.0 <= t <= 10.5 else 0.0 for t in times]
    mb_events = [{"start": 3.0, "end": 6.0}]
    res_confirm = evaluator.run_hybrid_arm_and_confirm(
        times, nasa_long, [None] * len(times), [None] * len(times), mb_events
    )
    assert len(res_confirm["events"]) == 1
    ev = res_confirm["events"][0]
    assert ev["armed_start"] == 2.0
    assert ev["confirm_start"] == 3.0
    assert ev["end"] == 6.0
    assert res_confirm["disarmed_arms"] == []


def test_tsv_timestamp_utc_and_cli_execution(tmp_path: Path) -> None:
    tsv_path = tmp_path / "utc_passes.tsv"
    lines = ["pass_id\ttimestamp_utc\tflux\tnasa_flag\tmodel_a\tmodel_b\thuman_label"]
    for i in range(20):
        mm = i
        flag = 1 if 4 <= i <= 12 else 0
        flux = 40.0 if 5 <= i <= 11 else 1.8
        lines.append(f"ORB_01\t2025-01-01T00:{mm:02d}:00Z\t{flux}\t{flag}\t{0.9 if 6 <= i <= 11 else 0.1}\t{0.95 if 5 <= i <= 11 else 0.05}\t{1 if 5 <= i <= 11 else 0}")
    tsv_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    out_json = tmp_path / "leo_eval_out.json"
    proc = subprocess.run(
        [
            sys.executable,
            str(REPO_ROOT / "scripts" / "leo_saa_eval.py"),
            "--input",
            str(tsv_path),
            "--bootstrap",
            "100",
            "--seed",
            "42",
            "--out",
            str(out_json),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    assert proc.returncode == 0
    parsed = json.loads(out_json.read_text(encoding="utf-8"))
    _assert_valid_eval_schema(parsed)
    assert parsed["rules"]["hysteresis"]["scoreboard"]["hybrid"]["f1"] == 1.0
