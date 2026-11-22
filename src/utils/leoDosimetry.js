/**
 * LEO Dosimetry · SAA/GCR Separation & Pass-Audit Client-Side Parity Engine
 *
 * Mathematically mirrors `scripts/leo_saa_eval.py` for NASA OSDR AWG Thread #3665
 * ("LEO Dosimetry - SAA/GCR Separation Using ML"):
 *   - Hysteresis (enter=0.65, exit=0.35) & Merge (threshold=0.50, gap=2.0 min) segmentation
 *   - Hybrid "Arm-and-Confirm" two-stage trigger state machine (IDLE -> ARMED -> ACTIVE_SAA -> COOLDOWN)
 *   - Pass-level Precision / Recall / F1 + seeded pass-level bootstrap 95% CIs (1,000 resamples, seed=42)
 *   - Entry Lead/Lag (min), Exit Lag (min), False Alarms/Day, SAA Dose Fraction (%)
 *   - Automated Label Discrepancy Auditor (flags 3/3 missing human labels, boundary divergence, NASA false alarms)
 *   - Vector SVG publication snapshot generator
 */

export const LEO_DEMO_BADGE =
  "Illustrative Synthetic LEO Demo - drop your own pass CSV/JSON to audit real telemetry";

export const LEO_PROVENANCE_PYTHON =
  "User-Loaded Cohort · leo_saa_eval.py Python";

export const LEO_PROVENANCE_BROWSER =
  "User-Loaded Cohort · Local Browser Eval";

export const DETECTOR_COLORS = {
  flux: "#f8fafc",
  human: "#34d399",      // Emerald
  nasa_flag: "#fb923c",  // Amber/Orange
  model_a: "#a78bfa",    // Violet
  model_b: "#38bdf8",    // Cyan
  hybrid: "#f472b6",     // Rose/Magenta (highlighted two-stage trigger)
};

const HARD_GAP_MIN = 5.0;
const DEFAULT_HYSTERESIS_ENTER = 0.65;
const DEFAULT_HYSTERESIS_EXIT = 0.35;
const DEFAULT_MERGE_THRESHOLD = 0.5;
const DEFAULT_MERGE_GAP_MIN = 2.0;
const DEFAULT_MIN_DURATION_MIN = 1.0;
const DEFAULT_BOOTSTRAP_RESAMPLES = 1000;
const DEFAULT_SEED = 42;

function roundN(val, decimals) {
  if (val === null || val === undefined || !Number.isFinite(val)) return null;
  const factor = Math.pow(10, decimals);
  const rounded = Math.round(val * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function round3(val) {
  return roundN(val, 3);
}

function round4(val) {
  return roundN(val, 4);
}

function round6(val) {
  const r = roundN(val, 6);
  return r === null ? 0 : r;
}

function mulberry32(seed) {
  let state = (seed >>> 0) || 1;
  return function nextRandom() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (idx - lo) * (sortedAsc[hi] - sortedAsc[lo]);
}

/**
 * Return the accurate provenance pill text distinguishing:
 *   1. Built-in Illustrative Synthetic LEO Demo
 *   2. Python `leo_saa_eval.py` JSON import
 *   3. Direct browser CSV/TSV drop
 */
export function getLeoProvenanceBadgeText(dataset) {
  if (!dataset || dataset.isIllustrativeDemo) {
    return LEO_DEMO_BADGE;
  }
  const method = String(dataset.provenance?.method || "").toLowerCase();
  if (
    dataset.sourceKind === "leo_python_json" ||
    ((method.includes("leo_saa_eval.py") || method.includes("python")) &&
      !method.includes("browser"))
  ) {
    return LEO_PROVENANCE_PYTHON;
  }
  return LEO_PROVENANCE_BROWSER;
}

export function segmentEventsHysteresis(
  times,
  scores,
  enterThreshold = DEFAULT_HYSTERESIS_ENTER,
  exitThreshold = DEFAULT_HYSTERESIS_EXIT,
  minDurationMin = DEFAULT_MIN_DURATION_MIN
) {
  const n = times.length;
  if (n === 0) return [];
  const events = [];
  let active = false;
  let startIdx = 0;

  for (let i = 0; i < n; i += 1) {
    if (active && i > 0 && times[i] - times[i - 1] > HARD_GAP_MIN) {
      const startT = times[startIdx];
      const endT = times[i - 1];
      if (endT - startT >= minDurationMin - 1e-9) {
        events.push({ start: round6(startT), end: round6(endT) });
      }
      active = false;
    }

    const s = Number(scores[i]);
    if (!active) {
      if (s >= enterThreshold) {
        active = true;
        startIdx = i;
      }
    } else if (s < exitThreshold) {
      const startT = times[startIdx];
      const endT = times[i - 1];
      if (endT - startT >= minDurationMin - 1e-9) {
        events.push({ start: round6(startT), end: round6(endT) });
      }
      active = false;
    }
  }

  if (active) {
    const startT = times[startIdx];
    const endT = times[n - 1];
    if (endT - startT >= minDurationMin - 1e-9) {
      events.push({ start: round6(startT), end: round6(endT) });
    }
  }
  return events;
}

export function segmentEventsMerge(
  times,
  scores,
  threshold = DEFAULT_MERGE_THRESHOLD,
  mergeGapMin = DEFAULT_MERGE_GAP_MIN,
  minDurationMin = DEFAULT_MIN_DURATION_MIN
) {
  const n = times.length;
  if (n === 0) return [];

  const rawIntervals = [];
  let active = false;
  let startIdx = 0;

  for (let i = 0; i < n; i += 1) {
    if (active && i > 0 && times[i] - times[i - 1] > HARD_GAP_MIN) {
      rawIntervals.push([times[startIdx], times[i - 1]]);
      active = false;
    }
    const on = Number(scores[i]) >= threshold;
    if (!active && on) {
      active = true;
      startIdx = i;
    } else if (active && !on) {
      rawIntervals.push([times[startIdx], times[i - 1]]);
      active = false;
    }
  }
  if (active) {
    rawIntervals.push([times[startIdx], times[n - 1]]);
  }
  if (!rawIntervals.length) return [];

  const merged = [rawIntervals[0].slice()];
  for (let i = 1; i < rawIntervals.length; i += 1) {
    const [startT, endT] = rawIntervals[i];
    if (startT - merged[merged.length - 1][1] <= mergeGapMin + 1e-9) {
      merged[merged.length - 1][1] = endT;
    } else {
      merged.push([startT, endT]);
    }
  }

  const events = [];
  for (const [startT, endT] of merged) {
    if (endT - startT >= minDurationMin - 1e-9) {
      events.push({ start: round6(startT), end: round6(endT) });
    }
  }
  return events;
}

function segmentSignal(times, scores, rule, isBinary = false) {
  if (isBinary) {
    if (rule === "merge") {
      return segmentEventsMerge(times, scores, 0.5, DEFAULT_MERGE_GAP_MIN);
    }
    return segmentEventsHysteresis(times, scores, 0.5, 0.5);
  }
  if (rule === "merge") {
    return segmentEventsMerge(times, scores, DEFAULT_MERGE_THRESHOLD, DEFAULT_MERGE_GAP_MIN);
  }
  return segmentEventsHysteresis(times, scores, DEFAULT_HYSTERESIS_ENTER, DEFAULT_HYSTERESIS_EXIT);
}

function eventsToMask(times, events) {
  return times.map((t) =>
    events.some((ev) => ev.start - 1e-9 <= t && t <= ev.end + 1e-9)
  );
}

export function runHybridArmAndConfirm(times, nasaFlags, bFields, lShells, modelBEvents) {
  const n = times.length;
  const mbMask = eventsToMask(times, modelBEvents);

  let state = "IDLE";
  let armedStart = null;
  let confirmStart = null;

  const confirmedEvents = [];
  const disarmedArms = [];
  const statesTrace = [];

  for (let i = 0; i < n; i += 1) {
    const t = times[i];
    let posArm = Number(nasaFlags[i]) >= 0.5;
    if (!posArm && bFields[i] !== null && lShells[i] !== null) {
      posArm = bFields[i] <= 27.5 && lShells[i] <= 1.75;
    }
    const mbOn = mbMask[i];

    if (state === "IDLE") {
      if (mbOn) {
        state = "ACTIVE_SAA";
        armedStart = t;
        confirmStart = t;
      } else if (posArm) {
        state = "ARMED";
        armedStart = t;
      }
    } else if (state === "ARMED") {
      if (mbOn) {
        state = "ACTIVE_SAA";
        confirmStart = t;
      } else if (!posArm) {
        if (armedStart !== null) {
          disarmedArms.push({
            start: round6(armedStart),
            end: round6(times[Math.max(0, i - 1)]),
          });
        }
        state = "IDLE";
        armedStart = null;
      }
    } else if (state === "ACTIVE_SAA") {
      if (!mbOn) {
        const endT = times[Math.max(0, i - 1)];
        confirmedEvents.push({
          start: round6(armedStart),
          armed_start: round6(armedStart),
          confirm_start: round6(confirmStart),
          end: round6(endT),
          pre_alert_lead_min: round4(confirmStart - armedStart),
        });
        armedStart = null;
        confirmStart = null;
        state = posArm ? "COOLDOWN" : "IDLE";
      }
    } else if (state === "COOLDOWN") {
      if (mbOn) {
        state = "ACTIVE_SAA";
        armedStart = t;
        confirmStart = t;
      } else if (!posArm) {
        state = "IDLE";
      }
    }
    statesTrace.push(state);
  }

  if (state === "ACTIVE_SAA" && armedStart !== null && confirmStart !== null) {
    const endT = times[n - 1];
    confirmedEvents.push({
      start: round6(armedStart),
      armed_start: round6(armedStart),
      confirm_start: round6(confirmStart),
      end: round6(endT),
      pre_alert_lead_min: round4(confirmStart - armedStart),
    });
  } else if (state === "ARMED" && armedStart !== null) {
    disarmedArms.push({ start: round6(armedStart), end: round6(times[n - 1]) });
  }

  return {
    events: confirmedEvents,
    disarmed_arms: disarmedArms,
    states: statesTrace,
  };
}

function intervalOverlap(a, b) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

function matchPassEvents(gtEvents, predEvents) {
  const pairs = [];
  for (let gi = 0; gi < gtEvents.length; gi += 1) {
    for (let pi = 0; pi < predEvents.length; pi += 1) {
      const ov = intervalOverlap(gtEvents[gi], predEvents[pi]);
      if (ov > 0) pairs.push({ ov, gi, pi });
    }
  }
  pairs.sort((a, b) => b.ov - a.ov);

  const matchedG = new Set();
  const matchedP = new Set();
  const entryLags = [];
  const exitLags = [];
  const ious = [];

  for (const { ov, gi, pi } of pairs) {
    if (matchedG.has(gi) || matchedP.has(pi)) continue;
    matchedG.add(gi);
    matchedP.add(pi);
    const g = gtEvents[gi];
    const p = predEvents[pi];
    const union = Math.max(g.end, p.end) - Math.min(g.start, p.start);
    ious.push(union > 0 ? ov / union : 1.0);
    entryLags.push(p.start - g.start);
    exitLags.push(p.end - g.end);
  }

  return {
    tp: matchedG.size,
    fp: predEvents.length - matchedP.size,
    fn: gtEvents.length - matchedG.size,
    entry_lags: entryLags,
    exit_lags: exitLags,
    ious,
  };
}

function computePrf(tp, fp, fn) {
  const prec = tp + fp > 0 ? tp / (tp + fp) : 0;
  const rec = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0;
  return { prec, rec, f1 };
}

function buildPassBootstrapIndices(nPasses, nBoot = DEFAULT_BOOTSTRAP_RESAMPLES, seed = DEFAULT_SEED) {
  if (nPasses === 0 || nBoot <= 0) return null;
  const rng = mulberry32(seed);
  const indices = new Array(nBoot);
  for (let b = 0; b < nBoot; b += 1) {
    const draw = new Array(nPasses);
    for (let k = 0; k < nPasses; k += 1) {
      draw[k] = Math.floor(rng() * nPasses);
    }
    indices[b] = draw;
  }
  return indices;
}

function passBootstrapCi(perPassCounts, bootIndices) {
  if (!bootIndices || !perPassCounts.length) {
    return {
      ci: { precision: [0, 0], recall: [0, 0], f1: [0, 0] },
      f1Draws: null,
    };
  }
  const nBoot = bootIndices.length;
  const precs = new Array(nBoot);
  const recs = new Array(nBoot);
  const f1Draws = new Array(nBoot);

  for (let b = 0; b < nBoot; b += 1) {
    const draw = bootIndices[b];
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (let k = 0; k < draw.length; k += 1) {
      const c = perPassCounts[draw[k]];
      tp += c[0];
      fp += c[1];
      fn += c[2];
    }
    const { prec, rec, f1 } = computePrf(tp, fp, fn);
    precs[b] = prec;
    recs[b] = rec;
    f1Draws[b] = f1;
  }

  const precsSorted = precs.slice().sort((a, b) => a - b);
  const recsSorted = recs.slice().sort((a, b) => a - b);
  const f1Sorted = f1Draws.slice().sort((a, b) => a - b);

  return {
    ci: {
      precision: [round4(percentile(precsSorted, 2.5)) || 0, round4(percentile(precsSorted, 97.5)) || 0],
      recall: [round4(percentile(recsSorted, 2.5)) || 0, round4(percentile(recsSorted, 97.5)) || 0],
      f1: [round4(percentile(f1Sorted, 2.5)) || 0, round4(percentile(f1Sorted, 97.5)) || 0],
    },
    f1Draws,
  };
}

function computePassSampleDts(times) {
  const n = times.length;
  if (n === 0) return [];
  if (n === 1) return [0.5];
  const dts = new Array(n);
  for (let i = 0; i < n; i += 1) {
    let dt;
    if (i === 0) dt = times[1] - times[0];
    else if (i === n - 1) dt = times[n - 1] - times[n - 2];
    else dt = 0.5 * (times[i + 1] - times[i - 1]);
    dts[i] = Math.max(0, Math.min(dt, HARD_GAP_MIN));
  }
  return dts;
}

function evaluateRule(groupedPasses, rule, durationDays, nBoot, seed) {
  const detectorKeys = ["nasa_flag", "model_a", "model_b", "hybrid"];
  const detectorLabels = {
    nasa_flag: "NASA Flag",
    model_a: "Model A (Sensor)",
    model_b: "Model B (Sensor + B/L)",
    hybrid: "Hybrid (Arm & Confirm)",
  };

  const perPassCounts = Object.fromEntries(detectorKeys.map((k) => [k, []]));
  const entryLagsAll = Object.fromEntries(detectorKeys.map((k) => [k, []]));
  const exitLagsAll = Object.fromEntries(detectorKeys.map((k) => [k, []]));
  const detectorDose = Object.fromEntries(detectorKeys.map((k) => [k, 0]));
  let humanDose = 0;
  let totalDose = 0;

  const passSummaries = [];
  const discrepancies = [];

  for (const [passId, rows] of groupedPasses) {
    const times = rows.map((r) => r.time_min);
    const fluxes = rows.map((r) => r.flux);
    const bFields = rows.map((r) => r.b_field);
    const lShells = rows.map((r) => r.l_shell);
    const nasaArr = rows.map((r) => r.nasa_flag);
    const maArr = rows.map((r) => r.model_a);
    const mbArr = rows.map((r) => r.model_b);
    const humanArr = rows.map((r) => r.human_label);

    const humanEvents = segmentSignal(times, humanArr, rule, true);
    const nasaEvents = segmentSignal(times, nasaArr, rule, true);
    const maEvents = segmentSignal(times, maArr, rule, false);
    const mbEvents = segmentSignal(times, mbArr, rule, false);
    const hybridRes = runHybridArmAndConfirm(times, nasaArr, bFields, lShells, mbEvents);
    const hybridEvents = hybridRes.events;

    const eventsByDet = {
      human: humanEvents,
      nasa_flag: nasaEvents,
      model_a: maEvents,
      model_b: mbEvents,
      hybrid: hybridEvents,
    };

    const dts = computePassSampleDts(times);
    for (let i = 0; i < times.length; i += 1) {
      totalDose += fluxes[i] * dts[i];
    }

    const hMask = eventsToMask(times, humanEvents);
    for (let i = 0; i < times.length; i += 1) {
      if (hMask[i]) humanDose += fluxes[i] * dts[i];
    }

    const perDetMatch = {};
    for (const det of detectorKeys) {
      const m = matchPassEvents(humanEvents, eventsByDet[det]);
      perDetMatch[det] = m;
      perPassCounts[det].push([m.tp, m.fp, m.fn]);
      entryLagsAll[det].push(...m.entry_lags);
      exitLagsAll[det].push(...m.exit_lags);

      const dMask = eventsToMask(times, eventsByDet[det]);
      for (let i = 0; i < times.length; i += 1) {
        if (dMask[i]) detectorDose[det] += fluxes[i] * dts[i];
      }
    }

    const autoCount =
      (nasaEvents.length > 0 ? 1 : 0) +
      (maEvents.length > 0 ? 1 : 0) +
      (mbEvents.length > 0 ? 1 : 0);
    const peakFlux = fluxes.length ? Math.max(...fluxes) : 0;
    let discrepancyItem = null;

    if (autoCount === 3 && humanEvents.length === 0) {
      discrepancyItem = {
        pass_id: passId,
        code: "MISSING_HUMAN_LABEL",
        severity: "high",
        priority: 1,
        detectors_active: 3,
        peak_flux: round3(peakFlux),
        summary: "3/3 Automated Detectors Active · Missing Human Label",
        detail: `NASA Flag, Model A, and Model B all detected an SAA pass (peak flux ${peakFlux.toFixed(1)}) while human_label is absent. Flagged for expert annotation review.`,
      };
    } else if (humanEvents.length > 0 && mbEvents.length > 0) {
      const mbM = perDetMatch.model_b;
      const hyM = perDetMatch.hybrid;
      const maxExitDiv = Math.max(0, ...mbM.exit_lags.map((x) => Math.abs(x)));
      const maxEntryDiv = Math.max(0, ...mbM.entry_lags.map((x) => Math.abs(x)));
      const minIou = mbM.ious.length ? Math.min(...mbM.ious) : 0;
      if (maxExitDiv >= 2.5 || maxEntryDiv >= 2.5 || minIou < 0.65) {
        const signDelta = mbM.exit_lags.length
          ? `${mbM.exit_lags[0] >= 0 ? "+" : ""}${mbM.exit_lags[0].toFixed(1)} min`
          : "";
        discrepancyItem = {
          pass_id: passId,
          code: "BOUNDARY_DIVERGENCE",
          severity: "medium",
          priority: 2,
          detectors_active: autoCount,
          peak_flux: round3(peakFlux),
          summary: signDelta
            ? `Human vs. Model B Boundary Divergence (IoU ${minIou.toFixed(2)}, exit delta ${signDelta})`
            : `Human vs. Model B Boundary Divergence (IoU ${minIou.toFixed(2)})`,
          detail: `Human boundary and Model B / Hybrid boundary diverge strongly (Model B exit delta ${maxExitDiv.toFixed(1)} min, Hybrid exit delta ${(hyM.exit_lags.length ? Math.abs(hyM.exit_lags[0]) : 0).toFixed(1)} min). Inspect flux shoulder before freezing training labels.`,
        };
      }
    } else if (
      nasaEvents.length > 0 &&
      maEvents.length === 0 &&
      mbEvents.length === 0 &&
      humanEvents.length === 0
    ) {
      discrepancyItem = {
        pass_id: passId,
        code: "NASA_UNCONFIRMED_ARM",
        severity: "low",
        priority: 3,
        detectors_active: 1,
        peak_flux: round3(peakFlux),
        summary: "NASA Position False Alarm · Suppressed by Hybrid Arm-and-Confirm",
        detail: `NASA Flag activated on GCR-level background (peak flux ${peakFlux.toFixed(1)}) without Model A/B or Human confirmation; Hybrid entered ARMED and disarmed with 0 false alarm.`,
      };
    }

    if (discrepancyItem) {
      discrepancyItem.window_start = round4(times[0]);
      discrepancyItem.window_end = round4(times[times.length - 1]);
      discrepancies.push(discrepancyItem);
    }

    const validBs = bFields.filter((b) => b !== null);
    const validLs = lShells.filter((l) => l !== null);

    passSummaries.push({
      pass_id: passId,
      start_min: round4(times[0]),
      end_min: round4(times[times.length - 1]),
      peak_flux: round3(peakFlux),
      min_b_field: validBs.length ? round3(Math.min(...validBs)) : null,
      min_l_shell: validLs.length ? round3(Math.min(...validLs)) : null,
      has_human_saa: humanEvents.length > 0,
      events: eventsByDet,
      hybrid_disarmed_arms: hybridRes.disarmed_arms,
      metrics: {
        hybrid_entry_lag_min: perDetMatch.hybrid.entry_lags.length
          ? round3(perDetMatch.hybrid.entry_lags[0])
          : null,
        hybrid_exit_lag_min: perDetMatch.hybrid.exit_lags.length
          ? round3(perDetMatch.hybrid.exit_lags[0])
          : null,
        nasa_entry_lag_min: perDetMatch.nasa_flag.entry_lags.length
          ? round3(perDetMatch.nasa_flag.entry_lags[0])
          : null,
        nasa_exit_lag_min: perDetMatch.nasa_flag.exit_lags.length
          ? round3(perDetMatch.nasa_flag.exit_lags[0])
          : null,
      },
      discrepancy_code: discrepancyItem ? discrepancyItem.code : null,
      discrepancy_severity: discrepancyItem ? discrepancyItem.severity : null,
    });
  }

  discrepancies.sort((a, b) => a.priority - b.priority || a.pass_id.localeCompare(b.pass_id));

  const scoreboard = {};
  const sharedBootIndices = buildPassBootstrapIndices(groupedPasses.length, nBoot, seed);
  const bootF1ByDet = {};
  const f1PointByDet = {};

  for (const det of detectorKeys) {
    let tpSum = 0;
    let fpSum = 0;
    let fnSum = 0;
    for (const [tp, fp, fn] of perPassCounts[det]) {
      tpSum += tp;
      fpSum += fp;
      fnSum += fn;
    }
    const { prec, rec, f1 } = computePrf(tpSum, fpSum, fnSum);
    const { ci, f1Draws } = passBootstrapCi(perPassCounts[det], sharedBootIndices);
    bootF1ByDet[det] = f1Draws;
    f1PointByDet[det] = f1;

    const eLags = entryLagsAll[det];
    const xLags = exitLagsAll[det];
    const entryMean = eLags.length
      ? eLags.reduce((acc, v) => acc + v, 0) / eLags.length
      : null;
    const exitMean = xLags.length
      ? xLags.reduce((acc, v) => acc + v, 0) / xLags.length
      : null;
    const faPerDay = fpSum / Math.max(durationDays, 1 / 24);
    const dosePct = totalDose > 0 ? (100 * detectorDose[det]) / totalDose : 0;

    scoreboard[det] = {
      id: det,
      label: detectorLabels[det],
      tp: tpSum,
      fp: fpSum,
      fn: fnSum,
      precision: round4(prec),
      recall: round4(rec),
      f1: round4(f1),
      ci_95: ci,
      delta_f1_vs_nasa: null,
      entry_lead_lag_min: round3(entryMean),
      exit_lag_min: round3(exitMean),
      false_alarms_per_day: round3(faPerDay),
      saa_dose_fraction_pct: round3(dosePct),
    };
  }

  // Paired pass-level bootstrap Delta F1 vs. NASA Flag (CI excludes 0 => significant)
  const nasaF1Point = f1PointByDet.nasa_flag || 0;
  const nasaF1Draws = bootF1ByDet.nasa_flag;
  for (const det of ["model_a", "model_b", "hybrid"]) {
    const deltaPoint = round4(f1PointByDet[det] - nasaF1Point) || 0;
    const detDraws = bootF1ByDet[det];
    let lo = deltaPoint;
    let hi = deltaPoint;
    if (detDraws && nasaF1Draws) {
      const diffs = detDraws.map((v, i) => v - nasaF1Draws[i]).sort((a, b) => a - b);
      lo = round4(percentile(diffs, 2.5)) || 0;
      hi = round4(percentile(diffs, 97.5)) || 0;
    }
    scoreboard[det].delta_f1_vs_nasa = {
      delta: deltaPoint,
      ci_95: [lo, hi],
      significant: lo > 0 || hi < 0,
    };
  }

  return {
    rule,
    parameters:
      rule === "hysteresis"
        ? {
            enter_threshold: DEFAULT_HYSTERESIS_ENTER,
            exit_threshold: DEFAULT_HYSTERESIS_EXIT,
            min_duration_min: DEFAULT_MIN_DURATION_MIN,
          }
        : {
            threshold: DEFAULT_MERGE_THRESHOLD,
            merge_gap_min: DEFAULT_MERGE_GAP_MIN,
            min_duration_min: DEFAULT_MIN_DURATION_MIN,
          },
    scoreboard,
    human_saa_dose_fraction_pct: round3(totalDose > 0 ? (100 * humanDose) / totalDose : 0),
    passes: passSummaries,
    discrepancies,
  };
}

export function evaluateLeoRows(rows, options = {}) {
  const bootstrapResamples = options.bootstrapResamples ?? DEFAULT_BOOTSTRAP_RESAMPLES;
  const seed = options.seed ?? DEFAULT_SEED;
  const datasetLabel = options.datasetLabel || "LEO Dosimetry SAA/GCR Pass Cohort";
  const note =
    options.note ||
    `Computed locally in browser from ${rows.length} samples (pass-level bootstrap=${bootstrapResamples}, seed=${seed}; no server upload).`;

  const groupedMap = new Map();
  for (const row of rows) {
    const pid = String(row.pass_id);
    if (!groupedMap.has(pid)) groupedMap.set(pid, []);
    groupedMap.get(pid).push({ ...row });
  }
  const groupedPasses = Array.from(groupedMap.entries());

  let minT = Infinity;
  let maxT = -Infinity;
  for (const r of rows) {
    if (r.time_min < minT) minT = r.time_min;
    if (r.time_min > maxT) maxT = r.time_min;
  }
  const durationMin = Math.max(maxT - minT, 1.0);
  const durationDays = Math.max(durationMin / 1440.0, 1.0 / 24.0);

  const rules = {
    hysteresis: evaluateRule(groupedPasses, "hysteresis", durationDays, bootstrapResamples, seed),
    merge: evaluateRule(groupedPasses, "merge", durationDays, bootstrapResamples, seed),
  };

  const passTraces = {};
  for (const [pid, prows] of groupedPasses) {
    passTraces[pid] = prows.map((r) => ({
      time_min: round4(r.time_min),
      flux: round3(r.flux),
      b_field: round3(r.b_field),
      l_shell: round3(r.l_shell),
      nasa_flag: round3(r.nasa_flag),
      model_a: round3(r.model_a),
      model_b: round3(r.model_b),
      human_label: round3(r.human_label),
    }));
  }

  const isIllustrativeDemo = Boolean(options.isIllustrativeDemo);

  return {
    schema_version: "1.0.0",
    summary: {
      total_samples: rows.length,
      total_passes: groupedPasses.length,
      duration_min: round3(durationMin),
      duration_days: round4(durationDays),
      bootstrap_resamples: bootstrapResamples,
      seed,
    },
    rules,
    pass_traces: passTraces,
    provenance: {
      method:
        options.method ||
        "Pass-level SAA/GCR Eval · Merge & Hysteresis · Hybrid Arm-and-Confirm · Bootstrap 95% CI (local browser JS)",
      dataset_label: datasetLabel,
      note,
    },
    isIllustrativeDemo,
    sourceKind: isIllustrativeDemo ? "illustrative_demo" : "browser_csv",
  };
}

function parseDelimitedText(rawText, filename = "") {
  const cleaned = String(rawText || "").replace(/^\uFEFF/, "").trim();
  if (!cleaned) throw new Error("Uploaded radiation pass file is empty.");
  const firstNl = cleaned.indexOf("\n");
  const headerLine = firstNl === -1 ? cleaned : cleaned.slice(0, firstNl);
  const tabCount = (headerLine.match(/\t/g) || []).length;
  const commaCount = (headerLine.match(/,/g) || []).length;
  const delimiter = /\.tsv$|\.txt$/i.test(filename) || tabCount > commaCount ? "\t" : ",";

  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 7) {
    throw new Error("Radiation pass CSV/TSV must contain a header row and at least 6 telemetry rows.");
  }

  const parseLine = (line) => {
    const out = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };

  const headers = parseLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseLine(lines[i]);
    const obj = {};
    for (let j = 0; j < headers.length; j += 1) {
      obj[headers[j]] = cells[j] ?? "";
    }
    rows.push(obj);
  }
  return { headers, rows };
}

function toNumOrNull(val) {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function evaluateLeoCsvText(csvText, options = {}) {
  const filename = options.filename || "leo_passes.csv";
  const { headers, rows: rawDicts } = parseDelimitedText(csvText, filename);
  const hMap = new Map(headers.map((h) => [h.toLowerCase(), h]));
  const pick = (...cands) => cands.map((c) => hMap.get(c)).find(Boolean) || null;

  const timeCol = pick("time_min", "elapsed_min", "t_min", "minutes");
  const tsCol = pick("timestamp_utc", "timestamp", "time_utc", "utc");
  const fluxCol = pick("flux", "dose_rate", "count_rate", "proton_flux", "rate");
  const bCol = pick("b_field", "b_ut", "b_mag", "b");
  const lCol = pick("l_shell", "l_mcilwain", "l");
  const nasaCol = pick("nasa_flag", "nasa_saa", "ephemeris_flag", "saa_flag");
  const maCol = pick("model_a", "model_a_score", "sensor_model");
  const mbCol = pick("model_b", "model_b_score", "sensor_bl_model");
  const humanCol = pick("human_label", "human_saa", "ground_truth", "label");
  const passCol = pick("pass_id", "orbit_id", "pass", "orbit");

  if (!timeCol && !tsCol) {
    throw new Error("Input CSV/TSV must include a 'time_min' or 'timestamp_utc' column.");
  }
  if (!fluxCol) {
    throw new Error("Input CSV/TSV must include a numeric 'flux' column.");
  }

  let originMs = null;
  const parsed = [];
  for (const r of rawDicts) {
    let tVal = timeCol ? toNumOrNull(r[timeCol]) : null;
    if (tVal === null && tsCol && r[tsCol]) {
      const ms = Date.parse(r[tsCol]);
      if (Number.isFinite(ms)) {
        if (originMs === null) originMs = ms;
        tVal = (ms - originMs) / 60000;
      }
    }
    const fluxVal = toNumOrNull(r[fluxCol]);
    if (tVal === null || fluxVal === null) continue;

    parsed.push({
      time_min: tVal,
      flux: fluxVal,
      b_field: bCol ? toNumOrNull(r[bCol]) : null,
      l_shell: lCol ? toNumOrNull(r[lCol]) : null,
      nasa_flag: nasaCol ? toNumOrNull(r[nasaCol]) : null,
      model_a: maCol ? toNumOrNull(r[maCol]) : null,
      model_b: mbCol ? toNumOrNull(r[mbCol]) : null,
      human_label: humanCol ? toNumOrNull(r[humanCol]) : null,
      pass_id: passCol ? String(r[passCol] || "").trim() : "",
    });
  }

  if (parsed.length < 6) {
    throw new Error(`Expected at least 6 valid radiation telemetry rows; found ${parsed.length}.`);
  }

  parsed.sort((a, b) => a.time_min - b.time_min);

  const sortedFlux = parsed.map((r) => r.flux).sort((a, b) => a - b);
  const p25 = percentile(sortedFlux, 25);
  const p95 = percentile(sortedFlux, 95);
  const span = Math.max(p95 - p25, 1e-6);

  const hasExplicitPass = parsed.some((r) => Boolean(r.pass_id));
  let autoPassIdx = 1;
  const t0 = parsed[0].time_min;

  for (let i = 0; i < parsed.length; i += 1) {
    const row = parsed[i];
    if (!hasExplicitPass) {
      if (i > 0) {
        const dt = row.time_min - parsed[i - 1].time_min;
        if (
          dt > HARD_GAP_MIN ||
          Math.floor((row.time_min - t0) / 92) !== Math.floor((parsed[i - 1].time_min - t0) / 92)
        ) {
          autoPassIdx += 1;
        }
      }
      row.pass_id = `PASS_${String(autoPassIdx).padStart(2, "0")}`;
    } else if (!row.pass_id) {
      row.pass_id = i > 0 ? parsed[i - 1].pass_id : "PASS_01";
    }

    const normFlux = Math.max(0, Math.min(1, (row.flux - p25) / span));
    if (row.nasa_flag === null) {
      row.nasa_flag =
        row.b_field !== null && row.l_shell !== null && row.b_field <= 28.0 && row.l_shell <= 1.85
          ? 1.0
          : 0.0;
    }
    if (row.model_a === null) {
      row.model_a = round4(normFlux);
    }
    if (row.model_b === null) {
      const blBoost =
        row.b_field !== null && row.l_shell !== null && row.b_field <= 28.0 && row.l_shell <= 1.85
          ? 0.15
          : row.b_field !== null && row.b_field > 33.0
            ? -0.1
            : 0.0;
      row.model_b = round4(Math.max(0, Math.min(1, normFlux + blBoost)));
    }
    if (row.human_label === null) {
      row.human_label = 0.0;
    }
  }

  return evaluateLeoRows(parsed, {
    datasetLabel: options.datasetLabel || filename.replace(/\.(csv|tsv|txt)$/i, ""),
    note: options.note,
    bootstrapResamples: options.bootstrapResamples ?? DEFAULT_BOOTSTRAP_RESAMPLES,
    seed: options.seed ?? DEFAULT_SEED,
    isIllustrativeDemo: Boolean(options.isIllustrativeDemo),
  });
}

export function validateLeoEvalJson(payload, sourceName = "leo_eval.json") {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid LEO evaluation JSON: expected an object from scripts/leo_saa_eval.py.");
  }
  if (!payload.rules || !payload.rules.hysteresis || !payload.rules.merge) {
    throw new Error("Invalid LEO evaluation JSON: missing 'rules.hysteresis' and 'rules.merge'.");
  }
  if (!payload.pass_traces || typeof payload.pass_traces !== "object") {
    throw new Error("Invalid LEO evaluation JSON: missing 'pass_traces'.");
  }
  const passIds = Object.keys(payload.pass_traces);
  if (passIds.length === 0) {
    throw new Error("Invalid LEO evaluation JSON: 'pass_traces' has zero orbital passes.");
  }

  const prov = payload.provenance || {};
  const label = String(prov.dataset_label || sourceName.replace(/\.json$/i, ""));
  const note = String(prov.note || "Loaded from scripts/leo_saa_eval.py JSON export.");
  const method = String(
    prov.method || "Pass-level SAA/GCR Eval · leo_saa_eval.py (Python)"
  );
  const lower = `${label} ${note}`.toLowerCase();
  const isIllustrativeDemo =
    Boolean(payload.isIllustrativeDemo) || lower.includes("illustrative synthetic leo demo");
  const sourceKind = isIllustrativeDemo
    ? "illustrative_demo"
    : method.toLowerCase().includes("browser")
      ? "browser_csv"
      : "leo_python_json";

  return {
    ...payload,
    provenance: { method, dataset_label: label, note },
    isIllustrativeDemo,
    sourceKind,
  };
}

/**
 * Generate the exact same deterministic 12-pass synthetic LEO dataset as
 * `scripts/leo_saa_eval.py::generate_illustrative_demo_rows()` (explicitly synthetic demo).
 */
export function generateIllustrativeLeoDemoRows() {
  const passSpecs = [
    ["PASS_01", 0.0, "saa", 5.0, 13.0, 32.0, 0.5, 4.5, 1.5, 1.0, null],
    ["PASS_02", 129.0, "saa", 4.5, 13.5, 38.0, 1.0, 4.5, 1.5, 1.0, null],
    ["PASS_03", 258.0, "nasa_fa", 6.0, 11.5, 3.1, 0.0, 0.0, 0.0, 0.0, null],
    ["PASS_04", 387.0, "saa", 5.0, 13.5, 35.0, 0.5, 4.5, 2.0, 1.5, null],
    ["PASS_05", 516.0, "nasa_fa", 7.0, 12.0, 3.2, 0.0, 0.0, 0.0, 0.0, null],
    ["PASS_06", 645.0, "saa", 4.5, 14.0, 40.0, 1.0, 4.5, 1.5, 1.0, "ma_dip"],
    ["PASS_07", 774.0, "saa", 5.5, 13.0, 29.0, 0.5, 4.0, 2.0, 1.5, null],
    ["PASS_08", 903.0, "missed_human", 5.0, 13.0, 34.0, 0.5, 4.5, 1.5, 1.0, null],
    ["PASS_09", 1032.0, "saa", 4.5, 13.5, 39.0, 1.0, 4.5, 1.5, 1.0, null],
    ["PASS_10", 1161.0, "nasa_fa", 6.5, 11.5, 3.0, 0.0, 0.0, 0.0, 0.0, null],
    ["PASS_11", 1290.0, "saa", 4.5, 13.5, 36.0, 0.5, 4.5, 1.5, 1.0, "human_early_cut"],
    ["PASS_12", 1420.0, "quiet_gcr", 0.0, 0.0, 3.3, 0.0, 0.0, 0.0, 0.0, null],
  ];

  const rows = [];
  for (let pIdx = 0; pIdx < passSpecs.length; pIdx += 1) {
    const [pid, t0, kind, sStart, sEnd, peak, nLead, nTail, maLag, mbLag, special] = passSpecs[pIdx];
    const center = 0.5 * (sStart + sEnd);
    const halfW = Math.max(0.5 * (sEnd - sStart), 1.0);

    for (let step = 0; step < 41; step += 1) {
      const rel = step * 0.5;
      const tMin = t0 + rel;
      const gcr = 2.85 + 0.32 * Math.sin(0.37 * rel + pIdx * 1.1) + 0.14 * Math.cos(0.71 * rel + pIdx);

      let flux;
      let bField;
      let lShell;
      let humanFlag;
      let nasaFlag;
      let maScore;
      let mbScore;

      if (kind === "saa" || kind === "missed_human") {
        const z = (rel - center) / (halfW * 0.62);
        let saaBump = peak * Math.exp(-0.5 * z * z);
        if (rel > center) {
          saaBump += 0.14 * peak * Math.exp(-0.5 * Math.pow((rel - (sEnd - 0.8)) / 1.1, 2));
        }
        flux = gcr + saaBump;
        bField = 37.5 - 16.5 * Math.exp(-0.5 * Math.pow((rel - center) / (halfW * 0.88), 2));
        lShell = 2.65 - 1.32 * Math.exp(-0.5 * Math.pow((rel - center) / (halfW * 0.92), 2));

        const humanEnd = special === "human_early_cut" ? sEnd - 3.0 : sEnd;
        humanFlag = kind === "saa" && rel >= sStart && rel <= humanEnd ? 1 : 0;
        nasaFlag = rel >= sStart - nLead && rel <= sEnd + nTail ? 1 : 0;

        const maOnStart = sStart + maLag;
        const maOnEnd = sEnd + 0.5;
        const mbOnStart = sStart + mbLag;
        const mbOnEnd = sEnd + 0.5;

        if (rel >= maOnStart && rel <= maOnEnd) {
          maScore = 0.88 - 0.14 * Math.abs((rel - center) / Math.max(halfW, 1.0));
        } else if (rel >= maOnStart - 0.5 && rel < maOnStart) {
          maScore = 0.42;
        } else {
          maScore = 0.08 + 0.05 * Math.sin(rel + pIdx);
        }

        if (special === "ma_dip") {
          if (rel >= 8.5 && rel <= 9.5) {
            maScore = 0.40;
          } else if (Math.abs(rel - (maOnEnd + 0.5)) < 1e-6) {
            maScore = 0.22;
          } else if (rel >= maOnEnd + 1.0 && rel <= maOnEnd + 1.5) {
            maScore = 0.55;
          }
        }

        if (rel >= mbOnStart && rel <= mbOnEnd) {
          mbScore = 0.94 - 0.12 * Math.abs((rel - center) / Math.max(halfW, 1.0));
        } else if (rel >= mbOnStart - 0.5 && rel < mbOnStart) {
          mbScore = 0.44;
        } else {
          mbScore = 0.05 + 0.03 * Math.cos(rel + pIdx);
        }

        if (pid === "PASS_04") {
          if (Math.abs(rel - (mbOnEnd + 0.5)) < 1e-6) {
            mbScore = 0.20;
          } else if (rel >= mbOnEnd + 1.0 && rel <= mbOnEnd + 1.5) {
            mbScore = 0.54;
          }
        }
      } else if (kind === "nasa_fa") {
        flux = gcr + 0.18 * Math.exp(-0.5 * Math.pow((rel - center) / 2.2, 2));
        bField = 29.8 - 2.6 * Math.exp(-0.5 * Math.pow((rel - center) / 3.0, 2));
        lShell = 1.92 - 0.18 * Math.exp(-0.5 * Math.pow((rel - center) / 3.0, 2));
        humanFlag = 0;
        nasaFlag = rel >= sStart && rel <= sEnd ? 1 : 0;
        maScore = 0.11 + 0.04 * Math.sin(rel + pIdx);
        mbScore = 0.09 + 0.03 * Math.cos(rel + pIdx);
      } else {
        flux = gcr + 0.25 * Math.sin(0.25 * rel);
        bField = 43.2 + 1.4 * Math.cos(0.2 * rel);
        lShell = 3.35 + 0.25 * Math.sin(0.18 * rel);
        humanFlag = 0;
        nasaFlag = 0;
        maScore = 0.06 + 0.02 * Math.sin(rel);
        mbScore = 0.04 + 0.02 * Math.cos(rel);
      }

      rows.push({
        pass_id: pid,
        time_min: round4(tMin),
        flux: round3(Math.max(0.2, flux)),
        b_field: round3(bField),
        l_shell: round3(lShell),
        nasa_flag: nasaFlag,
        model_a: round3(Math.max(0.01, Math.min(0.99, maScore))),
        model_b: round3(Math.max(0.01, Math.min(0.99, mbScore))),
        human_label: humanFlag,
      });
    }
  }
  return rows;
}

export function serializeDemoRowsToCsv() {
  const rows = generateIllustrativeLeoDemoRows();
  const header = "pass_id,time_min,flux,b_field,l_shell,nasa_flag,model_a,model_b,human_label";
  const body = rows.map((r) =>
    [
      r.pass_id,
      r.time_min,
      r.flux,
      r.b_field,
      r.l_shell,
      r.nasa_flag,
      r.model_a,
      r.model_b,
      r.human_label,
    ].join(",")
  );
  return `${header}\n${body.join("\n")}\n`;
}

export function buildLeoDemoDataset() {
  const rows = generateIllustrativeLeoDemoRows();
  return evaluateLeoRows(rows, {
    datasetLabel: "Illustrative Synthetic LEO Demo: 12 Orbital Passes (Thread #3665)",
    note: `${LEO_DEMO_BADGE}. Synthetic 12-pass simulation only - not empirical RadLab, SPACEDOS, or ISS mission telemetry.`,
    method: "Pass-level SAA/GCR Eval · Merge & Hysteresis · Hybrid Arm-and-Confirm · Bootstrap 95% CI",
    bootstrapResamples: DEFAULT_BOOTSTRAP_RESAMPLES,
    seed: DEFAULT_SEED,
    isIllustrativeDemo: true,
  });
}

function csvCell(val) {
  const s = val === null || val === undefined ? "" : String(val);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Serialize flagged orbital pass discrepancies into a review-ready CSV table:
 *   pass_id,priority,code,reason,peak_flux,window_start,window_end
 */
export function serializeDiscrepanciesToCsv(discrepancies = [], passes = []) {
  const passById = new Map((passes || []).map((p) => [p.pass_id, p]));
  const header = "pass_id,priority,code,reason,peak_flux,window_start,window_end";
  const rows = (discrepancies || []).map((d) => {
    const passInfo = passById.get(d.pass_id);
    const winStart = d.window_start ?? passInfo?.start_min ?? "";
    const winEnd = d.window_end ?? passInfo?.end_min ?? "";
    const reason = d.summary || d.detail || "";
    return [
      d.pass_id,
      d.priority,
      d.code,
      reason,
      d.peak_flux ?? passInfo?.peak_flux ?? "",
      winStart,
      winEnd,
    ]
      .map(csvCell)
      .join(",");
  });
  return `${header}\n${rows.join("\n")}${rows.length ? "\n" : ""}`;
}

function escapeXml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Generate a crisp, publication-ready vector SVG snapshot for the selected LEO orbital pass
 * and pass-level detector scoreboard.
 */
export function generateLeoSvgSnapshot(dataset, options = {}) {
  const ruleKey = options.rule === "merge" ? "merge" : "hysteresis";
  const ruleData = dataset.rules[ruleKey];
  const passId = options.passId || ruleData.passes[0]?.pass_id;
  const passSummary =
    ruleData.passes.find((p) => p.pass_id === passId) || ruleData.passes[0];
  const trace = dataset.pass_traces[passSummary.pass_id] || [];
  const visibleLayers = new Set(
    options.visibleLayers || ["nasa_flag", "model_a", "model_b", "hybrid", "human"]
  );

  const width = 1120;
  const height = 700;
  const plotX = 74;
  const plotY = 104;
  const plotW = 670;
  const plotH = 380;

  const tStart = trace.length ? trace[0].time_min : 0;
  const tEnd = trace.length ? trace[trace.length - 1].time_min : 20;
  const tSpan = Math.max(tEnd - tStart, 1);
  const maxFlux = Math.max(10, ...trace.map((pt) => pt.flux)) * 1.12;

  const mapX = (t) => plotX + ((t - tStart) / tSpan) * plotW;
  const mapY = (f) => plotY + plotH - (f / maxFlux) * plotH;

  const fluxPoints = trace
    .map((pt) => `${mapX(pt.time_min).toFixed(1)},${mapY(pt.flux).toFixed(1)}`)
    .join(" ");
  const fluxArea =
    trace.length > 1
      ? `${mapX(trace[0].time_min).toFixed(1)},${(plotY + plotH).toFixed(1)} ${fluxPoints} ${mapX(trace[trace.length - 1].time_min).toFixed(1)},${(plotY + plotH).toFixed(1)}`
      : "";

  const layerTracks = [
    { key: "human", label: "Human", color: DETECTOR_COLORS.human, y: plotY + plotH + 22 },
    { key: "hybrid", label: "Hybrid", color: DETECTOR_COLORS.hybrid, y: plotY + plotH + 44 },
    { key: "model_b", label: "Model B", color: DETECTOR_COLORS.model_b, y: plotY + plotH + 66 },
    { key: "model_a", label: "Model A", color: DETECTOR_COLORS.model_a, y: plotY + plotH + 88 },
    { key: "nasa_flag", label: "NASA Flag", color: DETECTOR_COLORS.nasa_flag, y: plotY + plotH + 110 },
  ];

  const shadedRects = [];
  const laneBars = [];
  for (const lane of layerTracks) {
    if (!visibleLayers.has(lane.key)) continue;
    const evs = passSummary.events[lane.key] || [];
    laneBars.push(
      `<text x="${plotX - 8}" y="${lane.y + 10}" fill="${lane.color}" font-size="10.5" font-weight="700" text-anchor="end">${lane.label}</text>`
    );
    laneBars.push(
      `<rect x="${plotX}" y="${lane.y}" width="${plotW}" height="12" rx="3" fill="#0f172a" />`
    );
    for (const ev of evs) {
      const x1 = mapX(ev.start);
      const x2 = Math.max(x1 + 3, mapX(ev.end));
      if (lane.key === "hybrid" || lane.key === "human") {
        shadedRects.push(
          `<rect x="${x1.toFixed(1)}" y="${plotY}" width="${(x2 - x1).toFixed(1)}" height="${plotH}" fill="${lane.color}" fill-opacity="${lane.key === "hybrid" ? "0.14" : "0.10"}" />`
        );
      }
      if (lane.key === "hybrid" && ev.confirm_start > ev.armed_start) {
        const xc = mapX(ev.confirm_start);
        laneBars.push(
          `<rect x="${x1.toFixed(1)}" y="${lane.y}" width="${Math.max(3, xc - x1).toFixed(1)}" height="12" rx="3" fill="#fbbf24" fill-opacity="0.9" />`
        );
        laneBars.push(
          `<rect x="${xc.toFixed(1)}" y="${lane.y}" width="${Math.max(3, x2 - xc).toFixed(1)}" height="12" rx="3" fill="${lane.color}" fill-opacity="0.92" />`
        );
      } else {
        laneBars.push(
          `<rect x="${x1.toFixed(1)}" y="${lane.y}" width="${(x2 - x1).toFixed(1)}" height="12" rx="3" fill="${lane.color}" fill-opacity="0.9" />`
        );
      }
    }
  }

  const badgeText = escapeXml(getLeoProvenanceBadgeText(dataset));
  const badgeStroke = dataset.isIllustrativeDemo ? "#f59e0b" : "#10b981";
  const badgeFill = dataset.isIllustrativeDemo
    ? "rgba(245, 158, 11, 0.14)"
    : "rgba(16, 185, 129, 0.14)";
  const badgeTextColor = dataset.isIllustrativeDemo ? "#fcd34d" : "#6ee7b7";

  const sbOrder = ["nasa_flag", "model_a", "model_b", "hybrid"];
  const sbCards = sbOrder
    .map((key, idx) => {
      const s = ruleData.scoreboard[key];
      const y = 132 + idx * 108;
      const col = DETECTOR_COLORS[key];
      const entryTxt =
        s.entry_lead_lag_min !== null
          ? `${s.entry_lead_lag_min >= 0 ? "+" : ""}${s.entry_lead_lag_min.toFixed(2)}m`
          : "N/A";
      const exitTxt =
        s.exit_lag_min !== null
          ? `${s.exit_lag_min >= 0 ? "+" : ""}${s.exit_lag_min.toFixed(2)}m`
          : "N/A";
      const df = s.delta_f1_vs_nasa;
      const deltaLine = df
        ? `ΔF1 vs NASA: ${df.delta >= 0 ? "+" : ""}${df.delta.toFixed(3)} [${df.ci_95[0] >= 0 ? "+" : ""}${df.ci_95[0].toFixed(2)}, ${df.ci_95[1] >= 0 ? "+" : ""}${df.ci_95[1].toFixed(2)}]${df.significant ? " ★Sig" : ""}`
        : `95% Pass Bootstrap CI: [${s.ci_95.f1[0].toFixed(2)}, ${s.ci_95.f1[1].toFixed(2)}]`;
      return `<g>
      <rect x="766" y="${y}" width="318" height="96" rx="9" fill="#0f172a" stroke="${key === "hybrid" ? col : "#1e293b"}" stroke-width="${key === "hybrid" ? "1.6" : "1"}" />
      <circle cx="784" cy="${y + 20}" r="5" fill="${col}" />
      <text x="796" y="${y + 24}" fill="#f8fafc" font-size="12.5" font-weight="700">${escapeXml(s.label)}</text>
      <text x="1070" y="${y + 24}" fill="${col}" font-size="13" font-weight="800" text-anchor="end">F1 ${s.f1.toFixed(3)}</text>
      <text x="780" y="${y + 46}" fill="${df?.significant ? "#34d399" : "#94a3b8"}" font-size="10.8" font-weight="${df?.significant ? "700" : "500"}">${escapeXml(deltaLine)}</text>
      <text x="780" y="${y + 66}" fill="#cbd5e1" font-size="11">Entry: ${entryTxt} · Exit: ${exitTxt}</text>
      <text x="780" y="${y + 84}" fill="#cbd5e1" font-size="11">FA/Day: ${s.false_alarms_per_day.toFixed(2)} · SAA Dose: ${s.saa_dose_fraction_pct.toFixed(1)}%</text>
    </g>`;
    })
    .join("\n    ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="LEO Dosimetry SAA/GCR Pass ${escapeXml(passSummary.pass_id)}">
  <title>LEO Dosimetry · ${escapeXml(passSummary.pass_id)} (${ruleKey})</title>
  <rect width="${width}" height="${height}" fill="#080d17" rx="14" />
  <rect x="18" y="18" width="${width - 36}" height="${height - 36}" fill="#0d1424" stroke="#1e293b" stroke-width="1.2" rx="12" />

  <text x="38" y="52" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="750">LEO Dosimetry · SAA/GCR Pass-Audit (${escapeXml(passSummary.pass_id)} · ${ruleKey.toUpperCase()})</text>
  <text x="38" y="73" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="11.5">${escapeXml(dataset.provenance.dataset_label)}</text>

  <rect x="646" y="32" width="438" height="28" rx="14" fill="${badgeFill}" stroke="${badgeStroke}" stroke-width="1" />
  <text x="865" y="50" fill="${badgeTextColor}" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="650" text-anchor="middle">${badgeText}</text>

  <!-- Plot Panel -->
  <rect x="${plotX}" y="${plotY}" width="${plotW}" height="${plotH}" rx="8" fill="#060a12" stroke="#1e293b" />
  ${shadedRects.join("\n  ")}
  ${fluxArea ? `<polygon points="${fluxArea}" fill="#38bdf8" fill-opacity="0.14" />` : ""}
  ${fluxPoints ? `<polyline points="${fluxPoints}" fill="none" stroke="#f8fafc" stroke-width="2.2" stroke-linejoin="round" />` : ""}

  <text x="${plotX + 8}" y="${plotY + 18}" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="11">Peak Flux: ${Number(passSummary.peak_flux || 0).toFixed(1)} · Window: ${tStart.toFixed(1)}-${tEnd.toFixed(1)} min</text>

  <!-- Detector Span Lanes -->
  <g font-family="system-ui, -apple-system, sans-serif">
    ${laneBars.join("\n    ")}
  </g>

  <!-- Pass-Level Scoreboard -->
  <g font-family="system-ui, -apple-system, sans-serif">
    <text x="766" y="120" fill="#7dd3fc" font-size="10.8" font-weight="750" letter-spacing="0.4">PASS-LEVEL SCOREBOARD (${dataset.summary.total_passes} PASSES · ${ruleKey.toUpperCase()})</text>
    ${sbCards}
  </g>

  <text x="38" y="652" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="11">Method: ${escapeXml(dataset.provenance.method)}</text>
  <text x="38" y="670" fill="#64748b" font-family="system-ui, sans-serif" font-size="10.5">Provenance: ${escapeXml(dataset.provenance.note)}</text>
</svg>`;
}
