#!/usr/bin/env python3
"""
LEO Dosimetry · SAA/GCR Separation & Pass-Audit Frozen Evaluation Harness (`scripts/leo_saa_eval.py`)

Deterministic CLI and library for NASA OSDR AWG Thread #3665 ("LEO Dosimetry - SAA/GCR
Separation Using ML"). Evaluates radiation pass detectors at the ORBITAL PASS level
(eliminating sample-level autocorrelation bias in confidence intervals):

  1. Boundary Segmentation Rules:
     - `hysteresis`: Schmitt-trigger enter/exit thresholds (`enter=0.65`, `exit=0.35`)
     - `merge`: single threshold (`threshold=0.50`) + gap-merging (`merge_gap_min=2.0`)
  2. Hybrid "Arm-and-Confirm" State Machine:
     - Uses NASA ephemeris flag (or B/L coordinates) as an early `ARMED` pre-alert
     - Confirms `ACTIVE_SAA` when Model B fires (suppressing position-only false alarms)
     - Triggers a clean `EXIT` + post-exit cooldown when Model B drops (cutting NASA's exit tail)
  3. Pass-Level Scoring + Seeded Pass-Level Bootstrap 95% CIs (default 1,000 resamples, seed=42):
     - Precision, Recall, F1 (+ 95% bootstrap CI)
     - Entry Lead/Lag (min; negative = early warning, positive = late)
     - Exit Lag (min)
     - False Alarms / Day
     - SAA Dose Fraction (%)
  4. Automated Label Discrepancy Auditor:
     - Flags orbital passes where 3/3 automated detectors fire while `human_label` is absent,
       where human vs. model boundaries diverge strongly, or where NASA triggers an unconfirmed arm.

Outputs a deterministic, public-safe JSON payload directly loadable into `/leo-dosimetry`.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

HARD_GAP_MIN = 5.0
DEFAULT_HYSTERESIS_ENTER = 0.65
DEFAULT_HYSTERESIS_EXIT = 0.35
DEFAULT_MERGE_THRESHOLD = 0.50
DEFAULT_MERGE_GAP_MIN = 2.0
DEFAULT_MIN_DURATION_MIN = 1.0
DEFAULT_BOOTSTRAP_RESAMPLES = 1000
DEFAULT_SEED = 42


def _round4(val: Optional[float]) -> Optional[float]:
    if val is None or not math.isfinite(val):
        return None
    r = round(float(val), 4)
    return 0.0 if r == 0.0 else r


def _round3(val: Optional[float]) -> Optional[float]:
    if val is None or not math.isfinite(val):
        return None
    r = round(float(val), 3)
    return 0.0 if r == 0.0 else r


def _round6(val: float) -> float:
    if not math.isfinite(val):
        return 0.0
    r = round(float(val), 6)
    return 0.0 if r == 0.0 else r


def _detect_delimiter(path: Path, text: str) -> str:
    if path.suffix.lower() in {".tsv", ".txt"}:
        return "\t"
    first = text.splitlines()[0] if text else ""
    return "\t" if first.count("\t") > first.count(",") else ","


def _parse_iso_timestamp_minutes(ts: str, origin_epoch: Optional[float]) -> Tuple[float, float]:
    cleaned = ts.strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(cleaned)
    epoch = dt.timestamp()
    if origin_epoch is None:
        return 0.0, epoch
    return (epoch - origin_epoch) / 60.0, origin_epoch


def _to_float_or_none(raw: Optional[str]) -> Optional[float]:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    try:
        v = float(s)
        return v if math.isfinite(v) else None
    except ValueError:
        return None


def load_leo_table(path: Path) -> List[Dict[str, Any]]:
    """Load any LEO radiation pass CSV/TSV into sorted, normalized sample rows."""
    text = path.read_text(encoding="utf-8-sig")
    if not text.strip():
        raise ValueError(f"Input table is empty: {path}")
    delimiter = _detect_delimiter(path, text)
    reader = csv.DictReader(text.splitlines(), delimiter=delimiter)
    if not reader.fieldnames:
        raise ValueError(f"Could not read headers from {path}")

    header_map = {h.strip().lower(): h.strip() for h in reader.fieldnames if h is not None}

    def pick(*names: str) -> Optional[str]:
        for name in names:
            if name in header_map:
                return header_map[name]
        return None

    time_col = pick("time_min", "elapsed_min", "t_min", "minutes")
    ts_col = pick("timestamp_utc", "timestamp", "time_utc", "utc")
    flux_col = pick("flux", "dose_rate", "count_rate", "proton_flux", "rate")
    b_col = pick("b_field", "b_ut", "b_mag", "b")
    l_col = pick("l_shell", "l_mcilwain", "l")
    nasa_col = pick("nasa_flag", "nasa_saa", "ephemeris_flag", "saa_flag")
    ma_col = pick("model_a", "model_a_score", "sensor_model")
    mb_col = pick("model_b", "model_b_score", "sensor_bl_model")
    human_col = pick("human_label", "human_saa", "ground_truth", "label")
    pass_col = pick("pass_id", "orbit_id", "pass", "orbit")

    if time_col is None and ts_col is None:
        raise ValueError("Input table must contain 'time_min' or 'timestamp_utc'.")
    if flux_col is None:
        raise ValueError("Input table must contain a numeric 'flux' column.")

    raw_rows: List[Dict[str, Any]] = []
    origin_epoch: Optional[float] = None

    for raw in reader:
        cleaned = {
            (k.strip() if k is not None else ""): (v.strip() if v is not None else "")
            for k, v in raw.items()
        }
        if not any(cleaned.values()):
            continue

        t_val: Optional[float] = None
        if time_col is not None:
            t_val = _to_float_or_none(cleaned.get(time_col))
        if t_val is None and ts_col is not None and cleaned.get(ts_col):
            t_val, origin_epoch = _parse_iso_timestamp_minutes(cleaned[ts_col], origin_epoch)

        flux_val = _to_float_or_none(cleaned.get(flux_col))
        if t_val is None or flux_val is None:
            continue

        b_val = _to_float_or_none(cleaned.get(b_col)) if b_col else None
        l_val = _to_float_or_none(cleaned.get(l_col)) if l_col else None
        nasa_val = _to_float_or_none(cleaned.get(nasa_col)) if nasa_col else None
        ma_val = _to_float_or_none(cleaned.get(ma_col)) if ma_col else None
        mb_val = _to_float_or_none(cleaned.get(mb_col)) if mb_col else None
        human_val = _to_float_or_none(cleaned.get(human_col)) if human_col else None
        pid = cleaned.get(pass_col, "") if pass_col else ""

        raw_rows.append(
            {
                "time_min": float(t_val),
                "flux": float(flux_val),
                "b_field": b_val,
                "l_shell": l_val,
                "nasa_flag": nasa_val,
                "model_a": ma_val,
                "model_b": mb_val,
                "human_label": human_val,
                "pass_id": pid,
            }
        )

    if len(raw_rows) < 6:
        raise ValueError(f"Expected at least 6 valid radiation telemetry rows; found {len(raw_rows)}.")

    raw_rows.sort(key=lambda r: r["time_min"])

    # Derive fallback scores cleanly if optional detector columns were omitted
    flux_vals = np.array([r["flux"] for r in raw_rows], dtype=np.float64)
    p25 = float(np.percentile(flux_vals, 25))
    p95 = float(np.percentile(flux_vals, 95))
    span = max(p95 - p25, 1e-6)

    # Assign pass_id cleanly if omitted (group contiguous segments separated by > HARD_GAP_MIN or 92-min orbit windows)
    has_explicit_pass = any(bool(r["pass_id"]) for r in raw_rows)
    auto_pass_idx = 1
    t0 = raw_rows[0]["time_min"]

    for idx, row in enumerate(raw_rows):
        if not has_explicit_pass:
            if idx > 0:
                dt = row["time_min"] - raw_rows[idx - 1]["time_min"]
                if dt > HARD_GAP_MIN or int((row["time_min"] - t0) // 92.0) != int(
                    (raw_rows[idx - 1]["time_min"] - t0) // 92.0
                ):
                    auto_pass_idx += 1
            row["pass_id"] = f"PASS_{auto_pass_idx:02d}"
        elif not row["pass_id"]:
            row["pass_id"] = raw_rows[idx - 1]["pass_id"] if idx > 0 else "PASS_01"

        norm_flux = max(0.0, min(1.0, (row["flux"] - p25) / span))
        if row["nasa_flag"] is None:
            if row["b_field"] is not None and row["l_shell"] is not None:
                row["nasa_flag"] = 1.0 if (row["b_field"] <= 28.0 and row["l_shell"] <= 1.85) else 0.0
            else:
                row["nasa_flag"] = 0.0
        if row["model_a"] is None:
            row["model_a"] = _round4(norm_flux)
        if row["model_b"] is None:
            bl_boost = (
                0.15
                if (row["b_field"] is not None and row["l_shell"] is not None and row["b_field"] <= 28.0 and row["l_shell"] <= 1.85)
                else -0.10
                if (row["b_field"] is not None and row["b_field"] > 33.0)
                else 0.0
            )
            row["model_b"] = _round4(max(0.0, min(1.0, norm_flux + bl_boost)))
        if row["human_label"] is None:
            row["human_label"] = 0.0

    return raw_rows


def segment_events_hysteresis(
    times: Sequence[float],
    scores: Sequence[float],
    enter_threshold: float = DEFAULT_HYSTERESIS_ENTER,
    exit_threshold: float = DEFAULT_HYSTERESIS_EXIT,
    min_duration_min: float = DEFAULT_MIN_DURATION_MIN,
) -> List[Dict[str, float]]:
    """Two-threshold Schmitt-trigger segmentation within a single pass."""
    n = len(times)
    if n == 0:
        return []
    events: List[Dict[str, float]] = []
    active = False
    start_idx = 0

    for i in range(n):
        if active and i > 0 and (times[i] - times[i - 1]) > HARD_GAP_MIN:
            end_t = times[i - 1]
            start_t = times[start_idx]
            if (end_t - start_t) >= min_duration_min - 1e-9:
                events.append({"start": _round6(start_t), "end": _round6(end_t)})
            active = False

        s = float(scores[i])
        if not active:
            if s >= enter_threshold:
                active = True
                start_idx = i
        else:
            if s < exit_threshold:
                end_t = times[i - 1]
                start_t = times[start_idx]
                if (end_t - start_t) >= min_duration_min - 1e-9:
                    events.append({"start": _round6(start_t), "end": _round6(end_t)})
                active = False

    if active:
        end_t = times[n - 1]
        start_t = times[start_idx]
        if (end_t - start_t) >= min_duration_min - 1e-9:
            events.append({"start": _round6(start_t), "end": _round6(end_t)})

    return events


def segment_events_merge(
    times: Sequence[float],
    scores: Sequence[float],
    threshold: float = DEFAULT_MERGE_THRESHOLD,
    merge_gap_min: float = DEFAULT_MERGE_GAP_MIN,
    min_duration_min: float = DEFAULT_MIN_DURATION_MIN,
) -> List[Dict[str, float]]:
    """Single-threshold segmentation with temporal gap merging within a single pass."""
    n = len(times)
    if n == 0:
        return []

    raw_intervals: List[List[float]] = []
    active = False
    start_idx = 0

    for i in range(n):
        if active and i > 0 and (times[i] - times[i - 1]) > HARD_GAP_MIN:
            raw_intervals.append([float(times[start_idx]), float(times[i - 1])])
            active = False

        on = float(scores[i]) >= threshold
        if not active and on:
            active = True
            start_idx = i
        elif active and not on:
            raw_intervals.append([float(times[start_idx]), float(times[i - 1])])
            active = False

    if active:
        raw_intervals.append([float(times[start_idx]), float(times[n - 1])])

    if not raw_intervals:
        return []

    merged: List[List[float]] = [raw_intervals[0]]
    for start_t, end_t in raw_intervals[1:]:
        if (start_t - merged[-1][1]) <= merge_gap_min + 1e-9:
            merged[-1][1] = end_t
        else:
            merged.append([start_t, end_t])

    events: List[Dict[str, float]] = []
    for start_t, end_t in merged:
        if (end_t - start_t) >= min_duration_min - 1e-9:
            events.append({"start": _round6(start_t), "end": _round6(end_t)})
    return events


def segment_signal(
    times: Sequence[float],
    scores: Sequence[float],
    rule: str,
    *,
    is_binary: bool = False,
) -> List[Dict[str, float]]:
    if is_binary:
        if rule == "merge":
            return segment_events_merge(times, scores, threshold=0.5, merge_gap_min=DEFAULT_MERGE_GAP_MIN)
        return segment_events_hysteresis(times, scores, enter_threshold=0.5, exit_threshold=0.5)

    if rule == "merge":
        return segment_events_merge(
            times,
            scores,
            threshold=DEFAULT_MERGE_THRESHOLD,
            merge_gap_min=DEFAULT_MERGE_GAP_MIN,
        )
    return segment_events_hysteresis(
        times,
        scores,
        enter_threshold=DEFAULT_HYSTERESIS_ENTER,
        exit_threshold=DEFAULT_HYSTERESIS_EXIT,
    )


def _events_to_mask(times: Sequence[float], events: Sequence[Dict[str, float]]) -> List[bool]:
    mask = [False] * len(times)
    for i, t in enumerate(times):
        for ev in events:
            if ev["start"] - 1e-9 <= t <= ev["end"] + 1e-9:
                mask[i] = True
                break
    return mask


def run_hybrid_arm_and_confirm(
    times: Sequence[float],
    nasa_flags: Sequence[float],
    b_fields: Sequence[Optional[float]],
    l_shells: Sequence[Optional[float]],
    model_b_events: Sequence[Dict[str, float]],
) -> Dict[str, Any]:
    """
    Two-stage Hybrid Arm-and-Confirm state machine within a single pass:
      IDLE -> ARMED (on NASA flag or B/L SAA region)
      ARMED -> ACTIVE_SAA (confirmed when Model B fires)
      ARMED -> IDLE (silently disarmed if Model B never fires -> 0 false alarms!)
      ACTIVE_SAA -> POST_EXIT_COOLDOWN (clean exit immediately when Model B drops)
      POST_EXIT_COOLDOWN -> IDLE (once lingering NASA position tail drops)
    """
    n = len(times)
    mb_mask = _events_to_mask(times, model_b_events)

    state = "IDLE"
    armed_start: Optional[float] = None
    confirm_start: Optional[float] = None

    confirmed_events: List[Dict[str, Any]] = []
    disarmed_arms: List[Dict[str, float]] = []
    states_trace: List[str] = []

    for i in range(n):
        t = float(times[i])
        pos_arm = bool(nasa_flags[i] >= 0.5)
        if not pos_arm and b_fields[i] is not None and l_shells[i] is not None:
            pos_arm = bool(b_fields[i] <= 27.5 and l_shells[i] <= 1.75)
        mb_on = mb_mask[i]

        if state == "IDLE":
            if mb_on:
                state = "ACTIVE_SAA"
                armed_start = t
                confirm_start = t
            elif pos_arm:
                state = "ARMED"
                armed_start = t
        elif state == "ARMED":
            if mb_on:
                state = "ACTIVE_SAA"
                confirm_start = t
            elif not pos_arm:
                if armed_start is not None:
                    disarmed_arms.append({"start": _round6(armed_start), "end": _round6(times[max(0, i - 1)])})
                state = "IDLE"
                armed_start = None
        elif state == "ACTIVE_SAA":
            if not mb_on:
                end_t = float(times[max(0, i - 1)])
                assert armed_start is not None and confirm_start is not None
                confirmed_events.append(
                    {
                        "start": _round6(armed_start),
                        "armed_start": _round6(armed_start),
                        "confirm_start": _round6(confirm_start),
                        "end": _round6(end_t),
                        "pre_alert_lead_min": _round4(confirm_start - armed_start),
                    }
                )
                armed_start = None
                confirm_start = None
                state = "COOLDOWN" if pos_arm else "IDLE"
        elif state == "COOLDOWN":
            if mb_on:
                state = "ACTIVE_SAA"
                armed_start = t
                confirm_start = t
            elif not pos_arm:
                state = "IDLE"

        states_trace.append(state)

    if state == "ACTIVE_SAA" and armed_start is not None and confirm_start is not None:
        end_t = float(times[n - 1])
        confirmed_events.append(
            {
                "start": _round6(armed_start),
                "armed_start": _round6(armed_start),
                "confirm_start": _round6(confirm_start),
                "end": _round6(end_t),
                "pre_alert_lead_min": _round4(confirm_start - armed_start),
            }
        )
    elif state == "ARMED" and armed_start is not None:
        disarmed_arms.append({"start": _round6(armed_start), "end": _round6(times[n - 1])})

    return {
        "events": confirmed_events,
        "disarmed_arms": disarmed_arms,
        "states": states_trace,
    }


def _interval_overlap(a: Dict[str, float], b: Dict[str, float]) -> float:
    return max(0.0, min(a["end"], b["end"]) - max(a["start"], b["start"]))


def _match_pass_events(
    gt_events: Sequence[Dict[str, float]],
    pred_events: Sequence[Dict[str, float]],
) -> Dict[str, Any]:
    """1-to-1 greedy overlap matching between ground-truth and predicted events in one pass."""
    pairs: List[Tuple[float, int, int]] = []
    for gi, g in enumerate(gt_events):
        for pi, p in enumerate(pred_events):
            ov = _interval_overlap(g, p)
            if ov > 0.0:
                pairs.append((ov, gi, pi))
    pairs.sort(key=lambda x: x[0], reverse=True)

    matched_g = set()
    matched_p = set()
    entry_lags: List[float] = []
    exit_lags: List[float] = []
    ious: List[float] = []

    for ov, gi, pi in pairs:
        if gi in matched_g or pi in matched_p:
            continue
        matched_g.add(gi)
        matched_p.add(pi)
        g = gt_events[gi]
        p = pred_events[pi]
        union = max(g["end"], p["end"]) - min(g["start"], p["start"])
        ious.append(ov / union if union > 0 else 1.0)
        entry_lags.append(float(p["start"] - g["start"]))
        exit_lags.append(float(p["end"] - g["end"]))

    tp = len(matched_g)
    fp = len(pred_events) - len(matched_p)
    fn = len(gt_events) - len(matched_g)
    return {
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "entry_lags": entry_lags,
        "exit_lags": exit_lags,
        "ious": ious,
    }


def _compute_prf(tp: int, fp: int, fn: int) -> Tuple[float, float, float]:
    prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = (2.0 * prec * rec / (prec + rec)) if (prec + rec) > 0 else 0.0
    return prec, rec, f1


def _pass_bootstrap_indices(
    n_passes: int,
    n_boot: int = DEFAULT_BOOTSTRAP_RESAMPLES,
    seed: int = DEFAULT_SEED,
) -> Optional[np.ndarray]:
    if n_passes == 0 or n_boot <= 0:
        return None
    rng = np.random.default_rng(int(seed))
    return rng.integers(0, n_passes, size=(n_boot, n_passes))


def _bootstrap_f1_series(
    per_pass_counts: Sequence[Tuple[int, int, int]],
    boot_indices: np.ndarray,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    counts_arr = np.asarray(per_pass_counts, dtype=np.int64)
    sampled = counts_arr[boot_indices]  # shape (n_boot, n_passes, 3)
    totals = sampled.sum(axis=1)  # shape (n_boot, 3)
    tp = totals[:, 0].astype(np.float64)
    fp = totals[:, 1].astype(np.float64)
    fn = totals[:, 2].astype(np.float64)
    prec = np.where((tp + fp) > 0, tp / np.maximum(tp + fp, 1.0), 0.0)
    rec = np.where((tp + fn) > 0, tp / np.maximum(tp + fn, 1.0), 0.0)
    f1 = np.where((prec + rec) > 0, 2.0 * prec * rec / np.maximum(prec + rec, 1e-12), 0.0)
    return prec, rec, f1


def _pass_bootstrap_ci(
    per_pass_counts: Sequence[Tuple[int, int, int]],
    n_boot: int = DEFAULT_BOOTSTRAP_RESAMPLES,
    seed: int = DEFAULT_SEED,
    boot_indices: Optional[np.ndarray] = None,
) -> Tuple[Dict[str, List[float]], Optional[np.ndarray]]:
    """Seeded pass-level bootstrap 95% CIs (resamples whole orbital passes, not samples)."""
    n_passes = len(per_pass_counts)
    idx = boot_indices if boot_indices is not None else _pass_bootstrap_indices(n_passes, n_boot, seed)
    if idx is None:
        return {"precision": [0.0, 0.0], "recall": [0.0, 0.0], "f1": [0.0, 0.0]}, None

    prec, rec, f1 = _bootstrap_f1_series(per_pass_counts, idx)
    ci = {
        "precision": [_round4(float(np.percentile(prec, 2.5))) or 0.0, _round4(float(np.percentile(prec, 97.5))) or 0.0],
        "recall": [_round4(float(np.percentile(rec, 2.5))) or 0.0, _round4(float(np.percentile(rec, 97.5))) or 0.0],
        "f1": [_round4(float(np.percentile(f1, 2.5))) or 0.0, _round4(float(np.percentile(f1, 97.5))) or 0.0],
    }
    return ci, f1


def _compute_pass_sample_dts(times: Sequence[float]) -> List[float]:
    n = len(times)
    if n == 0:
        return []
    if n == 1:
        return [0.5]
    dts: List[float] = []
    for i in range(n):
        if i == 0:
            dt = times[1] - times[0]
        elif i == n - 1:
            dt = times[n - 1] - times[n - 2]
        else:
            dt = 0.5 * (times[i + 1] - times[i - 1])
        dts.append(max(0.0, min(dt, HARD_GAP_MIN)))
    return dts


def evaluate_rule(
    grouped_passes: Sequence[Tuple[str, List[Dict[str, Any]]]],
    rule: str,
    duration_days: float,
    *,
    n_boot: int = DEFAULT_BOOTSTRAP_RESAMPLES,
    seed: int = DEFAULT_SEED,
) -> Dict[str, Any]:
    """Evaluate all 4 detectors + Human baseline + Discrepancy Auditor under one boundary rule."""
    detector_keys = ("nasa_flag", "model_a", "model_b", "hybrid")
    detector_labels = {
        "nasa_flag": "NASA Flag",
        "model_a": "Model A (Sensor)",
        "model_b": "Model B (Sensor + B/L)",
        "hybrid": "Hybrid (Arm & Confirm)",
    }

    per_pass_counts: Dict[str, List[Tuple[int, int, int]]] = {k: [] for k in detector_keys}
    entry_lags_all: Dict[str, List[float]] = {k: [] for k in detector_keys}
    exit_lags_all: Dict[str, List[float]] = {k: [] for k in detector_keys}
    detector_dose: Dict[str, float] = {k: 0.0 for k in detector_keys}
    human_dose = 0.0
    total_dose = 0.0

    pass_summaries: List[Dict[str, Any]] = []
    discrepancies: List[Dict[str, Any]] = []

    for pass_id, rows in grouped_passes:
        times = [r["time_min"] for r in rows]
        fluxes = [r["flux"] for r in rows]
        b_fields = [r["b_field"] for r in rows]
        l_shells = [r["l_shell"] for r in rows]
        nasa_arr = [r["nasa_flag"] for r in rows]
        ma_arr = [r["model_a"] for r in rows]
        mb_arr = [r["model_b"] for r in rows]
        human_arr = [r["human_label"] for r in rows]

        human_events = segment_signal(times, human_arr, rule, is_binary=True)
        nasa_events = segment_signal(times, nasa_arr, rule, is_binary=True)
        ma_events = segment_signal(times, ma_arr, rule, is_binary=False)
        mb_events = segment_signal(times, mb_arr, rule, is_binary=False)
        hybrid_res = run_hybrid_arm_and_confirm(times, nasa_arr, b_fields, l_shells, mb_events)
        hybrid_events = hybrid_res["events"]

        events_by_det = {
            "human": human_events,
            "nasa_flag": nasa_events,
            "model_a": ma_events,
            "model_b": mb_events,
            "hybrid": hybrid_events,
        }

        # Dose integration within this pass
        dts = _compute_pass_sample_dts(times)
        pass_total_dose = sum(fluxes[i] * dts[i] for i in range(len(times)))
        total_dose += pass_total_dose

        h_mask = _events_to_mask(times, human_events)
        human_dose += sum(fluxes[i] * dts[i] for i in range(len(times)) if h_mask[i])

        per_det_match: Dict[str, Dict[str, Any]] = {}
        for det in detector_keys:
            m = _match_pass_events(human_events, events_by_det[det])
            per_det_match[det] = m
            per_pass_counts[det].append((m["tp"], m["fp"], m["fn"]))
            entry_lags_all[det].extend(m["entry_lags"])
            exit_lags_all[det].extend(m["exit_lags"])

            d_mask = _events_to_mask(times, events_by_det[det])
            detector_dose[det] += sum(fluxes[i] * dts[i] for i in range(len(times)) if d_mask[i])

        # Automated Label Discrepancy Auditor
        auto_count = int(len(nasa_events) > 0) + int(len(ma_events) > 0) + int(len(mb_events) > 0)
        peak_flux = max(fluxes) if fluxes else 0.0
        discrepancy_item: Optional[Dict[str, Any]] = None

        if auto_count == 3 and len(human_events) == 0:
            discrepancy_item = {
                "pass_id": pass_id,
                "code": "MISSING_HUMAN_LABEL",
                "severity": "high",
                "priority": 1,
                "detectors_active": 3,
                "peak_flux": _round3(peak_flux),
                "summary": "3/3 Automated Detectors Active · Missing Human Label",
                "detail": (
                    f"NASA Flag, Model A, and Model B all detected an SAA pass (peak flux {peak_flux:.1f}) "
                    f"while human_label is absent. Flagged for expert annotation review."
                ),
            }
        elif len(human_events) > 0 and len(mb_events) > 0:
            mb_m = per_det_match["model_b"]
            hy_m = per_det_match["hybrid"]
            max_exit_div = max([abs(x) for x in mb_m["exit_lags"]] + [0.0])
            max_entry_div = max([abs(x) for x in mb_m["entry_lags"]] + [0.0])
            min_iou = min(mb_m["ious"]) if mb_m["ious"] else 0.0
            if max_exit_div >= 2.5 or max_entry_div >= 2.5 or min_iou < 0.65:
                discrepancy_item = {
                    "pass_id": pass_id,
                    "code": "BOUNDARY_DIVERGENCE",
                    "severity": "medium",
                    "priority": 2,
                    "detectors_active": auto_count,
                    "peak_flux": _round3(peak_flux),
                    "summary": f"Human vs. Model B Boundary Divergence (IoU {min_iou:.2f}, exit delta {mb_m['exit_lags'][0]:+.1f} min)"
                    if mb_m["exit_lags"]
                    else f"Human vs. Model B Boundary Divergence (IoU {min_iou:.2f})",
                    "detail": (
                        f"Human boundary and Model B / Hybrid boundary diverge strongly "
                        f"(Model B exit delta {max_exit_div:.1f} min, Hybrid exit delta "
                        f"{(abs(hy_m['exit_lags'][0]) if hy_m['exit_lags'] else 0.0):.1f} min). "
                        f"Inspect flux shoulder before freezing training labels."
                    ),
                }
        elif len(nasa_events) > 0 and len(ma_events) == 0 and len(mb_events) == 0 and len(human_events) == 0:
            discrepancy_item = {
                "pass_id": pass_id,
                "code": "NASA_UNCONFIRMED_ARM",
                "severity": "low",
                "priority": 3,
                "detectors_active": 1,
                "peak_flux": _round3(peak_flux),
                "summary": "NASA Position False Alarm · Suppressed by Hybrid Arm-and-Confirm",
                "detail": (
                    f"NASA Flag activated on GCR-level background (peak flux {peak_flux:.1f}) without "
                    f"Model A/B or Human confirmation; Hybrid entered ARMED and disarmed with 0 false alarm."
                ),
            }

        if discrepancy_item is not None:
            discrepancy_item["window_start"] = _round4(times[0])
            discrepancy_item["window_end"] = _round4(times[-1])
            discrepancies.append(discrepancy_item)

        hy_entry = per_det_match["hybrid"]["entry_lags"][0] if per_det_match["hybrid"]["entry_lags"] else None
        hy_exit = per_det_match["hybrid"]["exit_lags"][0] if per_det_match["hybrid"]["exit_lags"] else None
        nasa_entry = per_det_match["nasa_flag"]["entry_lags"][0] if per_det_match["nasa_flag"]["entry_lags"] else None
        nasa_exit = per_det_match["nasa_flag"]["exit_lags"][0] if per_det_match["nasa_flag"]["exit_lags"] else None

        pass_summaries.append(
            {
                "pass_id": pass_id,
                "start_min": _round4(times[0]),
                "end_min": _round4(times[-1]),
                "peak_flux": _round3(peak_flux),
                "min_b_field": _round3(min(b for b in b_fields if b is not None))
                if any(b is not None for b in b_fields)
                else None,
                "min_l_shell": _round3(min(l for l in l_shells if l is not None))
                if any(l is not None for l in l_shells)
                else None,
                "has_human_saa": len(human_events) > 0,
                "events": events_by_det,
                "hybrid_disarmed_arms": hybrid_res["disarmed_arms"],
                "metrics": {
                    "hybrid_entry_lag_min": _round3(hy_entry),
                    "hybrid_exit_lag_min": _round3(hy_exit),
                    "nasa_entry_lag_min": _round3(nasa_entry),
                    "nasa_exit_lag_min": _round3(nasa_exit),
                },
                "discrepancy_code": discrepancy_item["code"] if discrepancy_item else None,
                "discrepancy_severity": discrepancy_item["severity"] if discrepancy_item else None,
            }
        )

    discrepancies.sort(key=lambda d: (d["priority"], d["pass_id"]))

    scoreboard: Dict[str, Any] = {}
    shared_boot_indices = _pass_bootstrap_indices(len(grouped_passes), n_boot=n_boot, seed=seed)
    boot_f1_by_det: Dict[str, Optional[np.ndarray]] = {}
    f1_point_by_det: Dict[str, float] = {}

    for det in detector_keys:
        tp_sum = sum(c[0] for c in per_pass_counts[det])
        fp_sum = sum(c[1] for c in per_pass_counts[det])
        fn_sum = sum(c[2] for c in per_pass_counts[det])
        prec, rec, f1 = _compute_prf(tp_sum, fp_sum, fn_sum)
        ci, f1_draws = _pass_bootstrap_ci(
            per_pass_counts[det],
            n_boot=n_boot,
            seed=seed,
            boot_indices=shared_boot_indices,
        )
        boot_f1_by_det[det] = f1_draws
        f1_point_by_det[det] = f1

        e_lags = entry_lags_all[det]
        x_lags = exit_lags_all[det]
        entry_mean = float(np.mean(e_lags)) if e_lags else None
        exit_mean = float(np.mean(x_lags)) if x_lags else None
        fa_per_day = fp_sum / max(duration_days, 1.0 / 24.0)
        dose_pct = (100.0 * detector_dose[det] / total_dose) if total_dose > 0 else 0.0

        scoreboard[det] = {
            "id": det,
            "label": detector_labels[det],
            "tp": tp_sum,
            "fp": fp_sum,
            "fn": fn_sum,
            "precision": _round4(prec),
            "recall": _round4(rec),
            "f1": _round4(f1),
            "ci_95": ci,
            "delta_f1_vs_nasa": None,
            "entry_lead_lag_min": _round3(entry_mean),
            "exit_lag_min": _round3(exit_mean),
            "false_alarms_per_day": _round3(fa_per_day),
            "saa_dose_fraction_pct": _round3(dose_pct),
        }

    # Compute paired pass-level bootstrap Delta F1 vs. NASA Flag (CI excludes 0 => significant)
    nasa_f1_point = f1_point_by_det.get("nasa_flag", 0.0)
    nasa_f1_draws = boot_f1_by_det.get("nasa_flag")
    for det in ("model_a", "model_b", "hybrid"):
        delta_point = _round4(f1_point_by_det[det] - nasa_f1_point) or 0.0
        det_draws = boot_f1_by_det.get(det)
        if det_draws is not None and nasa_f1_draws is not None:
            diff_draws = det_draws - nasa_f1_draws
            lo = _round4(float(np.percentile(diff_draws, 2.5))) or 0.0
            hi = _round4(float(np.percentile(diff_draws, 97.5))) or 0.0
        else:
            lo, hi = delta_point, delta_point
        scoreboard[det]["delta_f1_vs_nasa"] = {
            "delta": delta_point,
            "ci_95": [lo, hi],
            "significant": bool(lo > 0.0 or hi < 0.0),
        }

    return {
        "rule": rule,
        "parameters": (
            {
                "enter_threshold": DEFAULT_HYSTERESIS_ENTER,
                "exit_threshold": DEFAULT_HYSTERESIS_EXIT,
                "min_duration_min": DEFAULT_MIN_DURATION_MIN,
            }
            if rule == "hysteresis"
            else {
                "threshold": DEFAULT_MERGE_THRESHOLD,
                "merge_gap_min": DEFAULT_MERGE_GAP_MIN,
                "min_duration_min": DEFAULT_MIN_DURATION_MIN,
            }
        ),
        "scoreboard": scoreboard,
        "human_saa_dose_fraction_pct": _round3((100.0 * human_dose / total_dose) if total_dose > 0 else 0.0),
        "passes": pass_summaries,
        "discrepancies": discrepancies,
    }


def evaluate_leo_rows(
    rows: Sequence[Dict[str, Any]],
    *,
    dataset_label: str = "LEO Dosimetry SAA/GCR Pass Cohort",
    note: str = "Evaluated via scripts/leo_saa_eval.py (pass-level bootstrap, seed=42).",
    bootstrap_resamples: int = DEFAULT_BOOTSTRAP_RESAMPLES,
    seed: int = DEFAULT_SEED,
) -> Dict[str, Any]:
    """Run full frozen pass-level evaluation across both Hysteresis and Merge rules."""
    grouped_map: Dict[str, List[Dict[str, Any]]] = {}
    pass_order: List[str] = []
    for row in rows:
        pid = str(row["pass_id"])
        if pid not in grouped_map:
            grouped_map[pid] = []
            pass_order.append(pid)
        grouped_map[pid].append(dict(row))

    grouped_passes = [(pid, grouped_map[pid]) for pid in pass_order]
    min_t = min(r["time_min"] for r in rows)
    max_t = max(r["time_min"] for r in rows)
    duration_min = max(max_t - min_t, 1.0)
    duration_days = max(duration_min / 1440.0, 1.0 / 24.0)

    rules_out = {
        "hysteresis": evaluate_rule(
            grouped_passes,
            "hysteresis",
            duration_days,
            n_boot=bootstrap_resamples,
            seed=seed,
        ),
        "merge": evaluate_rule(
            grouped_passes,
            "merge",
            duration_days,
            n_boot=bootstrap_resamples,
            seed=seed,
        ),
    }

    # Compact per-pass telemetry traces for the interactive /leo-dosimetry scrubber
    pass_traces: Dict[str, List[Dict[str, Any]]] = {}
    for pid, prows in grouped_passes:
        pass_traces[pid] = [
            {
                "time_min": _round4(r["time_min"]),
                "flux": _round3(r["flux"]),
                "b_field": _round3(r["b_field"]),
                "l_shell": _round3(r["l_shell"]),
                "nasa_flag": _round3(r["nasa_flag"]),
                "model_a": _round3(r["model_a"]),
                "model_b": _round3(r["model_b"]),
                "human_label": _round3(r["human_label"]),
            }
            for r in prows
        ]

    return {
        "schema_version": "1.0.0",
        "summary": {
            "total_samples": len(rows),
            "total_passes": len(grouped_passes),
            "duration_min": _round3(duration_min),
            "duration_days": _round4(duration_days),
            "bootstrap_resamples": int(bootstrap_resamples),
            "seed": int(seed),
        },
        "rules": rules_out,
        "pass_traces": pass_traces,
        "provenance": {
            "method": "Pass-level SAA/GCR Eval · Merge & Hysteresis · Hybrid Arm-and-Confirm · Bootstrap 95% CI (leo_saa_eval.py)",
            "dataset_label": str(dataset_label),
            "note": str(note),
        },
    }


def evaluate_leo_file(
    input_path: Path,
    *,
    dataset_label: Optional[str] = None,
    note: Optional[str] = None,
    bootstrap_resamples: int = DEFAULT_BOOTSTRAP_RESAMPLES,
    seed: int = DEFAULT_SEED,
) -> Dict[str, Any]:
    rows = load_leo_table(input_path)
    resolved_label = dataset_label or input_path.stem
    resolved_note = (
        note
        or f"Computed from {len(rows)} radiation telemetry rows across {len({r['pass_id'] for r in rows})} orbital passes (pass-level bootstrap={bootstrap_resamples}, seed={seed})."
    )
    return evaluate_leo_rows(
        rows,
        dataset_label=resolved_label,
        note=resolved_note,
        bootstrap_resamples=bootstrap_resamples,
        seed=seed,
    )


def generate_illustrative_demo_rows() -> List[Dict[str, Any]]:
    """
    Generate a deterministic, clearly synthetic 12-pass LEO radiation dataset (1.000 day,
    0.5-min resolution) modeling SAA proton spikes (~75-78% of total dose), GCR background,
    NASA early-arm (~-0.7 min) + late-exit (~+4.5 min) + 3.0/day false alarms, Model A/B
    entry lag (+1.0-1.8 min), Model A boundary dip (distinguishing Merge vs. Hysteresis),
    1 intentionally missed human-label pass (PASS_08), and 1 boundary-divergence pass (PASS_11).

    STRICTLY SYNTHETIC DEMO DATA - NEVER EMPIRICAL RADLAB / SPACEDOS / ISS TELEMETRY.
    """
    # Pass specifications over 24h (1440 min = 1.000 day):
    # Each pass spans 20.0 min at 0.5 min cadence (41 samples).
    # Pass start times spaced so PASS_01 starts at 0.0 and PASS_12 ends at 1440.0 min.
    pass_specs = [
        # (pass_id, t0, kind, saa_start, saa_end, peak_flux, nasa_lead, nasa_tail, ma_lag, mb_lag, special)
        ("PASS_01", 0.0, "saa", 5.0, 13.0, 32.0, 0.5, 4.5, 1.5, 1.0, None),
        ("PASS_02", 129.0, "saa", 4.5, 13.5, 38.0, 1.0, 4.5, 1.5, 1.0, None),
        ("PASS_03", 258.0, "nasa_fa", 6.0, 11.5, 3.1, 0.0, 0.0, 0.0, 0.0, None),
        ("PASS_04", 387.0, "saa", 5.0, 13.5, 35.0, 0.5, 4.5, 2.0, 1.5, None),
        ("PASS_05", 516.0, "nasa_fa", 7.0, 12.0, 3.2, 0.0, 0.0, 0.0, 0.0, None),
        ("PASS_06", 645.0, "saa", 4.5, 14.0, 40.0, 1.0, 4.5, 1.5, 1.0, "ma_dip"),
        ("PASS_07", 774.0, "saa", 5.5, 13.0, 29.0, 0.5, 4.0, 2.0, 1.5, None),
        ("PASS_08", 903.0, "missed_human", 5.0, 13.0, 34.0, 0.5, 4.5, 1.5, 1.0, None),
        ("PASS_09", 1032.0, "saa", 4.5, 13.5, 39.0, 1.0, 4.5, 1.5, 1.0, None),
        ("PASS_10", 1161.0, "nasa_fa", 6.5, 11.5, 3.0, 0.0, 0.0, 0.0, 0.0, None),
        ("PASS_11", 1290.0, "saa", 4.5, 13.5, 36.0, 0.5, 4.5, 1.5, 1.0, "human_early_cut"),
        ("PASS_12", 1420.0, "quiet_gcr", 0.0, 0.0, 3.3, 0.0, 0.0, 0.0, 0.0, None),
    ]

    rows: List[Dict[str, Any]] = []
    for p_idx, (pid, t0, kind, s_start, s_end, peak, n_lead, n_tail, ma_lag, mb_lag, special) in enumerate(
        pass_specs
    ):
        center = 0.5 * (s_start + s_end)
        half_w = max(0.5 * (s_end - s_start), 1.0)
        for step in range(41):
            rel = step * 0.5
            t_min = t0 + rel
            # Deterministic smooth GCR modulation (~2.6 - 3.3) so SAA represents ~75-78% of total dose
            gcr = 2.85 + 0.32 * math.sin(0.37 * rel + p_idx * 1.1) + 0.14 * math.cos(0.71 * rel + p_idx)

            if kind in ("saa", "missed_human"):
                z = (rel - center) / (half_w * 0.62)
                saa_bump = peak * math.exp(-0.5 * z * z)
                # Asymmetric exit shoulder
                if rel > center:
                    saa_bump += 0.14 * peak * math.exp(-0.5 * ((rel - (s_end - 0.8)) / 1.1) ** 2)
                flux = gcr + saa_bump
                b_field = 37.5 - 16.5 * math.exp(-0.5 * ((rel - center) / (half_w * 0.88)) ** 2)
                l_shell = 2.65 - 1.32 * math.exp(-0.5 * ((rel - center) / (half_w * 0.92)) ** 2)

                human_end = (s_end - 3.0) if special == "human_early_cut" else s_end
                human_flag = 1 if (kind == "saa" and s_start <= rel <= human_end) else 0
                nasa_flag = 1 if ((s_start - n_lead) <= rel <= (s_end + n_tail)) else 0

                # Smooth continuous ML scores (0..1)
                ma_on_start = s_start + ma_lag
                ma_on_end = s_end + 0.5
                mb_on_start = s_start + mb_lag
                mb_on_end = s_end + 0.5

                if ma_on_start <= rel <= ma_on_end:
                    ma_score = 0.88 - 0.14 * abs((rel - center) / max(half_w, 1.0))
                elif (ma_on_start - 0.5) <= rel < ma_on_start:
                    ma_score = 0.42
                else:
                    ma_score = 0.08 + 0.05 * math.sin(rel + p_idx)

                # PASS_06: brief mid-pass sensor dip (0.40) + post-exit skirt flutter (0.55 after drop to 0.22)
                # Hysteresis stays ON through 0.40, exits cleanly at ma_on_end, and ignores 0.55 (<0.65).
                # Merge drops/re-merges across the 1.0-min gap into the 0.55 flutter!
                if special == "ma_dip":
                    if 8.5 <= rel <= 9.5:
                        ma_score = 0.40
                    elif abs(rel - (ma_on_end + 0.5)) < 1e-6:
                        ma_score = 0.22
                    elif (ma_on_end + 1.0) <= rel <= (ma_on_end + 1.5):
                        ma_score = 0.55

                if mb_on_start <= rel <= mb_on_end:
                    mb_score = 0.94 - 0.12 * abs((rel - center) / max(half_w, 1.0))
                elif (mb_on_start - 0.5) <= rel < mb_on_start:
                    mb_score = 0.44
                else:
                    mb_score = 0.05 + 0.03 * math.cos(rel + p_idx)

                # PASS_04: clean drop (0.20) then 0.54 skirt flutter for Model B -> Merge extends, Hysteresis ignores
                if pid == "PASS_04":
                    if abs(rel - (mb_on_end + 0.5)) < 1e-6:
                        mb_score = 0.20
                    elif (mb_on_end + 1.0) <= rel <= (mb_on_end + 1.5):
                        mb_score = 0.54
            elif kind == "nasa_fa":
                flux = gcr + 0.18 * math.exp(-0.5 * ((rel - center) / 2.2) ** 2)
                b_field = 29.8 - 2.6 * math.exp(-0.5 * ((rel - center) / 3.0) ** 2)
                l_shell = 1.92 - 0.18 * math.exp(-0.5 * ((rel - center) / 3.0) ** 2)
                human_flag = 0
                nasa_flag = 1 if (s_start <= rel <= s_end) else 0
                ma_score = 0.11 + 0.04 * math.sin(rel + p_idx)
                mb_score = 0.09 + 0.03 * math.cos(rel + p_idx)
            else:
                flux = gcr + 0.25 * math.sin(0.25 * rel)
                b_field = 43.2 + 1.4 * math.cos(0.2 * rel)
                l_shell = 3.35 + 0.25 * math.sin(0.18 * rel)
                human_flag = 0
                nasa_flag = 0
                ma_score = 0.06 + 0.02 * math.sin(rel)
                mb_score = 0.04 + 0.02 * math.cos(rel)

            rows.append(
                {
                    "pass_id": pid,
                    "time_min": _round4(t_min),
                    "flux": _round3(max(0.2, flux)),
                    "b_field": _round3(b_field),
                    "l_shell": _round3(l_shell),
                    "nasa_flag": int(nasa_flag),
                    "model_a": _round3(max(0.01, min(0.99, ma_score))),
                    "model_b": _round3(max(0.01, min(0.99, mb_score))),
                    "human_label": int(human_flag),
                }
            )
    return rows


def write_demo_csv(out_path: Path) -> None:
    rows = generate_illustrative_demo_rows()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "pass_id",
        "time_min",
        "flux",
        "b_field",
        "l_shell",
        "nasa_flag",
        "model_a",
        "model_b",
        "human_label",
    ]
    with out_path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Frozen pass-level evaluator for LEO Dosimetry SAA/GCR separation (NASA OSDR AWG Thread #3665)."
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=None,
        help="Path to LEO radiation pass CSV/TSV (`time_min` or `timestamp_utc`, `flux`, optional `b_field`, `l_shell`, `nasa_flag`, `model_a`, `model_b`, `human_label`, `pass_id`).",
    )
    parser.add_argument("--out", type=Path, default=None, help="Output JSON path (stdout if omitted).")
    parser.add_argument("--dataset-label", default=None, help="Human-readable dataset label.")
    parser.add_argument("--note", default=None, help="Provenance note.")
    parser.add_argument(
        "--bootstrap",
        type=int,
        default=DEFAULT_BOOTSTRAP_RESAMPLES,
        help="Number of pass-level bootstrap resamples (default: 1000).",
    )
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED, help="Deterministic RNG seed (default: 42).")
    parser.add_argument(
        "--generate-demo-csv",
        type=Path,
        default=None,
        help="Optional helper: write the illustrative synthetic 12-pass demo CSV to this path.",
    )
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    if args.generate_demo_csv is not None:
        write_demo_csv(args.generate_demo_csv)
        if args.input is None:
            return 0

    if args.input is None:
        parser.error("--input is required unless --generate-demo-csv is specified.")

    payload = evaluate_leo_file(
        args.input,
        dataset_label=args.dataset_label,
        note=args.note,
        bootstrap_resamples=args.bootstrap,
        seed=args.seed,
    )
    serialized = json.dumps(payload, indent=2) + "\n"
    if args.out is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(serialized, encoding="utf-8")
    else:
        sys.stdout.write(serialized)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
