/**
 * Brain AWG · 3D Omics Ordination Engine (Client-Side JS + skbio_to_3d.py Schema Validator)
 *
 * Implements a mathematically equivalent browser-native pipeline to `scripts/skbio_to_3d.py`:
 *   rclr (Robust Centered Log-Ratio) -> Euclidean/Aitchison DistanceMatrix -> 3D PCoA -> PERMANOVA
 *
 * Also validates deterministic JSON exports produced by `scripts/skbio_to_3d.py` and provides
 * an explicitly badged Illustrative Demo dataset (Drosophila melanogaster OxPhos/ROS spaceflight
 * vs. Ground Control vs. Alzheimer's-model) that is NEVER presented as empirical NASA OSDR data.
 */

export const GROUP_PALETTE = [
  "#38bdf8", // Cyan - Spaceflight
  "#34d399", // Emerald - Ground Control
  "#f472b6", // Rose - Alzheimer's Model
  "#a78bfa", // Violet
  "#fbbf24", // Amber
  "#fb7185", // Coral
  "#2dd4bf", // Teal
  "#60a5fa", // Sky
];

export const ILLUSTRATIVE_DEMO_BADGE =
  "Illustrative Demo - drop your own OSDR table to analyze real cohorts";

export const PROVENANCE_BADGE_SKBIO_PYTHON =
  "User-Loaded Cohort · scikit-bio Python";

export const PROVENANCE_BADGE_BROWSER_LOCAL =
  "User-Loaded Cohort · Local Browser rclr + PCoA";

/**
 * Return the accurate provenance pill text distinguishing:
 *   1. Built-in Illustrative Demo
 *   2. Python `skbio_to_3d.py` JSON import
 *   3. Direct browser CSV/TSV upload (client-side JS rclr + PCoA)
 */
export function getProvenanceBadgeText(dataset) {
  if (!dataset || dataset.isIllustrativeDemo) {
    return ILLUSTRATIVE_DEMO_BADGE;
  }
  const method = String(dataset.provenance?.method || "").toLowerCase();
  if (
    dataset.sourceKind === "skbio_json" ||
    ((method.includes("scikit-bio") || method.includes("numpy/scipy") || method.includes("json import")) &&
      !method.includes("client-side js"))
  ) {
    return PROVENANCE_BADGE_SKBIO_PYTHON;
  }
  return PROVENANCE_BADGE_BROWSER_LOCAL;
}

const SAMPLE_ID_CANDIDATES = [
  "sample_id",
  "sample",
  "id",
  "sample_name",
  "specimen",
  "specimen_id",
  "run_id",
];

const GROUP_COL_CANDIDATES = [
  "condition",
  "group",
  "treatment",
  "cohort",
  "phenotype",
  "status",
  "arm",
  "factor",
];

function round6(value) {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Deterministic PRNG (Mulberry32) so client-side PERMANOVA p-values are reproducible.
 */
function mulberry32(seed) {
  let state = (seed >>> 0) || 1;
  return function nextRandom() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Robust Centered Log-Ratio (rclr) transform on a sample-by-feature matrix.
 * Matches skbio.stats.composition.rclr on strictly positive entries, with zeros mapped to 0.0
 * (the centered log-ratio mean) for dense Euclidean/Aitchison distance computation.
 *
 * @param {number[][]} matrix - rows = samples, cols = features
 * @returns {number[][]}
 */
export function rclrTransform(matrix) {
  return matrix.map((row) => {
    const logVals = new Array(row.length).fill(0);
    let logSum = 0;
    let posCount = 0;

    for (let j = 0; j < row.length; j += 1) {
      const v = Number(row[j]);
      if (Number.isFinite(v) && v > 0) {
        const lv = Math.log(v);
        logVals[j] = lv;
        logSum += lv;
        posCount += 1;
      } else {
        logVals[j] = Number.NaN;
      }
    }

    if (posCount === 0) {
      return new Array(row.length).fill(0);
    }

    const meanLog = logSum / posCount;
    return logVals.map((lv) => (Number.isNaN(lv) ? 0 : lv - meanLog));
  });
}

/**
 * Compute symmetric n x n pairwise Euclidean distance matrix (Aitchison distance on rclr matrix).
 *
 * @param {number[][]} matrix
 * @returns {number[][]}
 */
export function pairwiseEuclideanDistanceMatrix(matrix) {
  const n = matrix.length;
  const dist = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    const rowI = matrix[i];
    for (let j = i + 1; j < n; j += 1) {
      const rowJ = matrix[j];
      let sumSq = 0;
      for (let k = 0; k < rowI.length; k += 1) {
        const diff = (rowI[k] || 0) - (rowJ[k] || 0);
        sumSq += diff * diff;
      }
      const d = Math.sqrt(sumSq);
      dist[i][j] = d;
      dist[j][i] = d;
    }
  }
  return dist;
}

/**
 * Classical cyclic Jacobi eigendecomposition for real symmetric matrices.
 * Returns eigenvalues and column eigenvectors (V[row][col]).
 *
 * @param {number[][]} symmetricMatrix
 * @returns {{ eigenvalues: number[], eigenvectors: number[][] }}
 */
export function jacobiEigenSymmetric(symmetricMatrix) {
  const n = symmetricMatrix.length;
  const a = symmetricMatrix.map((row) => row.slice());
  const v = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => (i === j ? 1 : 0))
  );

  if (n <= 1) {
    return {
      eigenvalues: n === 1 ? [a[0][0]] : [],
      eigenvectors: v,
    };
  }

  const maxSweeps = Math.max(50, n * n * 4);
  const eps = 1e-12;

  for (let iter = 0; iter < maxSweeps; iter += 1) {
    let p = 0;
    let q = 1;
    let maxOffDiag = 0;

    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const absVal = Math.abs(a[i][j]);
        if (absVal > maxOffDiag) {
          maxOffDiag = absVal;
          p = i;
          q = j;
        }
      }
    }

    if (maxOffDiag < eps) break;

    const app = a[p][p];
    const aqq = a[q][q];
    const apq = a[p][q];
    const tau = (aqq - app) / (2 * apq);
    const t =
      tau >= 0
        ? 1 / (tau + Math.sqrt(1 + tau * tau))
        : -1 / (-tau + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;

    a[p][p] = app - t * apq;
    a[q][q] = aqq + t * apq;
    a[p][q] = 0;
    a[q][p] = 0;

    for (let r = 0; r < n; r += 1) {
      if (r !== p && r !== q) {
        const arp = a[r][p];
        const arq = a[r][q];
        a[r][p] = c * arp - s * arq;
        a[p][r] = a[r][p];
        a[r][q] = s * arp + c * arq;
        a[q][r] = a[r][q];
      }
    }

    for (let r = 0; r < n; r += 1) {
      const vrp = v[r][p];
      const vrq = v[r][q];
      v[r][p] = c * vrp - s * vrq;
      v[r][q] = s * vrp + c * vrq;
    }
  }

  const eigenvalues = Array.from({ length: n }, (_, i) => a[i][i]);
  return { eigenvalues, eigenvectors: v };
}

/**
 * Principal Coordinate Analysis (PCoA / Classical MDS) returning top 3 axes with
 * canonical deterministic sign orientation and proportion of variance explained.
 *
 * @param {number[][]} distMatrix
 * @returns {{ coords: number[][], varianceExplained: [number, number, number] }}
 */
export function runPcoa3d(distMatrix) {
  const n = distMatrix.length;
  if (n === 0) {
    return { coords: [], varianceExplained: [0, 0, 0] };
  }
  if (n === 1) {
    return { coords: [[0, 0, 0]], varianceExplained: [0, 0, 0] };
  }

  // A = -0.5 * D^2
  const A = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => -0.5 * distMatrix[i][j] * distMatrix[i][j])
  );

  // Double-center: B_ij = A_ij - rowMean_i - colMean_j + grandMean
  const rowMeans = new Array(n).fill(0);
  let grandSum = 0;
  for (let i = 0; i < n; i += 1) {
    let rowSum = 0;
    for (let j = 0; j < n; j += 1) {
      rowSum += A[i][j];
    }
    rowMeans[i] = rowSum / n;
    grandSum += rowSum;
  }
  const grandMean = grandSum / (n * n);

  const B = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => A[i][j] - rowMeans[i] - rowMeans[j] + grandMean)
  );

  // Enforce strict symmetry against floating-point noise
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const avg = 0.5 * (B[i][j] + B[j][i]);
      B[i][j] = avg;
      B[j][i] = avg;
    }
  }

  const { eigenvalues, eigenvectors } = jacobiEigenSymmetric(B);
  const order = eigenvalues
    .map((val, idx) => ({ val, idx }))
    .sort((x, y) => y.val - x.val);

  let positiveSum = 0;
  for (const item of order) {
    if (item.val > 1e-12) positiveSum += item.val;
  }

  const coords = Array.from({ length: n }, () => [0, 0, 0]);
  const varianceExplained = [0, 0, 0];

  for (let axis = 0; axis < 3; axis += 1) {
    if (axis >= order.length) break;
    const { val, idx } = order[axis];
    if (val <= 1e-12) {
      varianceExplained[axis] = 0;
      continue;
    }

    const scale = Math.sqrt(val);
    const axisVals = Array.from({ length: n }, (_, i) => eigenvectors[i][idx] * scale);

    // Deterministic canonical sign: anchor largest-magnitude element to be positive
    let maxAbs = -1;
    let sign = 1;
    for (let i = 0; i < n; i += 1) {
      const absVal = Math.abs(axisVals[i]);
      if (absVal > maxAbs + 1e-12) {
        maxAbs = absVal;
        sign = axisVals[i] < 0 ? -1 : 1;
      }
    }

    for (let i = 0; i < n; i += 1) {
      coords[i][axis] = round6(axisVals[i] * sign);
    }
    varianceExplained[axis] = positiveSum > 0 ? round6(val / positiveSum) : 0;
  }

  return { coords, varianceExplained };
}

/**
 * Compute Anderson (2001) PERMANOVA pseudo-F statistic and deterministic permutation p-value.
 *
 * @param {number[][]} distMatrix
 * @param {string[]} groups
 * @param {number} permutations
 * @param {number} seed
 * @returns {{ f_stat: number, p_value: number, permutations: number }}
 */
export function runPermanova(distMatrix, groups, permutations = 999, seed = 42) {
  const n = distMatrix.length;
  const uniqueGroups = Array.from(new Set(groups));
  const a = uniqueGroups.length;

  if (n < 3 || a < 2 || n <= a) {
    return { f_stat: 0, p_value: 1, permutations: 0 };
  }

  // Precompute squared distances
  const d2 = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => distMatrix[i][j] * distMatrix[i][j])
  );

  let sumAllD2 = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      sumAllD2 += d2[i][j];
    }
  }
  const ssTotal = sumAllD2 / n;

  function computePseudoF(labels) {
    const buckets = new Map();
    for (let i = 0; i < labels.length; i += 1) {
      const g = labels[i];
      if (!buckets.has(g)) buckets.set(g, []);
      buckets.get(g).push(i);
    }

    let ssWithin = 0;
    for (const idxs of buckets.values()) {
      const ng = idxs.length;
      if (ng <= 1) continue;
      let pairSum = 0;
      for (let i = 0; i < ng; i += 1) {
        const row = d2[idxs[i]];
        for (let j = i + 1; j < ng; j += 1) {
          pairSum += row[idxs[j]];
        }
      }
      ssWithin += pairSum / ng;
    }

    const ssAmong = ssTotal - ssWithin;
    if (ssWithin <= 1e-12) {
      return ssAmong > 1e-12 ? 999999 : 0;
    }
    return (ssAmong / (a - 1)) / (ssWithin / (n - a));
  }

  const observedF = computePseudoF(groups);
  const perms = Math.max(0, Math.floor(Number(permutations) || 0));
  if (perms === 0) {
    return { f_stat: round6(observedF), p_value: 1, permutations: 0 };
  }

  const rng = mulberry32(seed);
  const shuffled = groups.slice();
  let geCount = 0;

  for (let p = 0; p < perms; p += 1) {
    // Fisher-Yates shuffle
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    const permF = computePseudoF(shuffled);
    if (permF >= observedF - 1e-12) {
      geCount += 1;
    }
  }

  const pValue = (geCount + 1) / (perms + 1);
  return {
    f_stat: round6(observedF),
    p_value: round6(pValue),
    permutations: perms,
  };
}

/**
 * Parse CSV or TSV text into { headers: string[], rows: Record<string, string>[] }.
 * Handles quoted fields, escaped double-quotes, CRLF/LF newlines, and auto-detects delimiter.
 */
export function parseDelimitedTable(rawText, filename = "") {
  const cleaned = String(rawText || "").replace(/^\uFEFF/, "").trim();
  if (!cleaned) {
    throw new Error("Uploaded table is empty.");
  }

  const firstNewline = cleaned.indexOf("\n");
  const headerLine = firstNewline === -1 ? cleaned : cleaned.slice(0, firstNewline);
  const tabCount = (headerLine.match(/\t/g) || []).length;
  const commaCount = (headerLine.match(/,/g) || []).length;
  const isTsv = /\.tsv$|\.txt$/i.test(filename) || tabCount > commaCount;
  const delimiter = isTsv ? "\t" : ",";

  const matrix = [];
  let currentRow = [];
  let currentCell = "";
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inQuotes) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') {
          currentCell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      currentRow.push(currentCell.trim());
      currentCell = "";
    } else if (ch === "\n") {
      currentRow.push(currentCell.trim());
      if (currentRow.some((cell) => cell !== "")) {
        matrix.push(currentRow);
      }
      currentRow = [];
      currentCell = "";
    } else if (ch !== "\r") {
      currentCell += ch;
    }
  }

  currentRow.push(currentCell.trim());
  if (currentRow.some((cell) => cell !== "")) {
    matrix.push(currentRow);
  }

  if (matrix.length < 3) {
    throw new Error("Table must contain a header row and at least 2 sample rows.");
  }

  const headers = matrix[0].map((h, idx) => h || `col_${idx + 1}`);
  const rows = matrix.slice(1).map((cells) => {
    const obj = {};
    for (let j = 0; j < headers.length; j += 1) {
      obj[headers[j]] = cells[j] ?? "";
    }
    return obj;
  });

  return { headers, rows, delimiter };
}

function isNumericColumn(rows, colName) {
  let validCount = 0;
  let nonEmptyCount = 0;
  for (const row of rows) {
    const raw = String(row[colName] ?? "").trim();
    if (!raw) continue;
    nonEmptyCount += 1;
    const num = Number(raw);
    if (Number.isFinite(num)) validCount += 1;
  }
  return nonEmptyCount > 0 && validCount / nonEmptyCount >= 0.9;
}

/**
 * Run client-side rclr + 3D PCoA + PERMANOVA directly on a single CSV/TSV file
 * (containing sample ID, optional group/condition column, optional metadata, and numeric features).
 */
export function ordinateFromCsvText(csvText, options = {}) {
  const filename = options.filename || "uploaded-table.csv";
  const permutations = options.permutations ?? 499;
  const seed = options.seed ?? 42;
  const { headers, rows } = parseDelimitedTable(csvText, filename);

  const lowerMap = new Map(headers.map((h) => [h.toLowerCase(), h]));
  let idCol =
    (options.idCol && headers.includes(options.idCol) ? options.idCol : null) ||
    SAMPLE_ID_CANDIDATES.map((c) => lowerMap.get(c)).find(Boolean) ||
    headers[0];

  const numericCols = headers.filter((h) => h !== idCol && isNumericColumn(rows, h));
  const categoricalCols = headers.filter((h) => h !== idCol && !numericCols.includes(h));

  let groupCol =
    (options.groupCol && headers.includes(options.groupCol) ? options.groupCol : null) ||
    GROUP_COL_CANDIDATES.map((c) => lowerMap.get(c)).find(Boolean) ||
    categoricalCols[0] ||
    null;

  // Exclude groupCol from numericCols if user explicitly chose a numeric column as group
  const featureCols = numericCols.filter((c) => c !== groupCol);
  if (featureCols.length < 2) {
    throw new Error(
      `Expected at least 2 numeric abundance/expression feature columns; found ${featureCols.length}. Ensure rows are samples and columns are numeric features (with optional 'condition' or 'group' column).`
    );
  }

  // Detect if features contain negative values (e.g. already log-transformed) vs non-negative counts
  let hasNegative = false;
  const rawMatrix = rows.map((row) =>
    featureCols.map((col) => {
      const val = Number(row[col]);
      if (!Number.isFinite(val)) return 0;
      if (val < 0) hasNegative = true;
      return val;
    })
  );

  // If strictly non-negative, apply rclr; if already signed (e.g., z-scored or log2), mean-center per feature
  let transformed;
  let transformNote;
  if (!hasNegative) {
    transformed = rclrTransform(rawMatrix);
    transformNote = "rclr + Euclidean/Aitchison DistanceMatrix + 3D PCoA + PERMANOVA (client-side JS)";
  } else {
    const nRows = rawMatrix.length;
    const nCols = featureCols.length;
    const colMeans = new Array(nCols).fill(0);
    for (let j = 0; j < nCols; j += 1) {
      let s = 0;
      for (let i = 0; i < nRows; i += 1) s += rawMatrix[i][j];
      colMeans[j] = s / nRows;
    }
    transformed = rawMatrix.map((row) => row.map((v, j) => v - colMeans[j]));
    transformNote = "Centered Euclidean DistanceMatrix + 3D PCoA + PERMANOVA (client-side JS; signed input detected)";
  }

  const distMatrix = pairwiseEuclideanDistanceMatrix(transformed);
  const { coords, varianceExplained } = runPcoa3d(distMatrix);
  const groups = rows.map((row) => (groupCol ? String(row[groupCol] || "Unassigned") : "All Samples"));
  const permanova = runPermanova(distMatrix, groups, permutations, seed);

  const metaCols = categoricalCols.filter((c) => c !== idCol);
  const samples = rows.map((row, i) => {
    const metadata = {};
    for (const mc of metaCols) {
      if (row[mc] !== undefined && row[mc] !== "") {
        metadata[mc] = String(row[mc]);
      }
    }
    metadata.feature_count = featureCols.length;
    return {
      id: String(row[idCol] || `Sample_${i + 1}`),
      group: groups[i],
      pc1: coords[i][0],
      pc2: coords[i][1],
      pc3: coords[i][2],
      metadata,
    };
  });

  return {
    samples,
    variance_explained: varianceExplained,
    permanova,
    provenance: {
      method: transformNote,
      dataset_label: options.datasetLabel || filename.replace(/\.(csv|tsv|txt)$/i, ""),
      note: `Computed directly in browser from ${samples.length} samples x ${featureCols.length} numeric features (no server upload; data stays local).`,
    },
    isIllustrativeDemo: Boolean(options.isIllustrativeDemo),
    sourceKind: options.isIllustrativeDemo ? "illustrative_demo" : "browser_csv",
  };
}

/**
 * Validate and normalize a JSON ordination payload produced by `scripts/skbio_to_3d.py`.
 */
export function validateOrdinationJson(payload, sourceName = "ordination.json") {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid JSON: expected an object with 'samples', 'variance_explained', 'permanova', and 'provenance'.");
  }
  if (!Array.isArray(payload.samples) || payload.samples.length < 2) {
    throw new Error("Invalid ordination JSON: 'samples' must be an array with at least 2 sample entries.");
  }

  const samples = payload.samples.map((s, idx) => {
    const pc1 = Number(s?.pc1);
    const pc2 = Number(s?.pc2);
    const pc3 = Number(s?.pc3 ?? 0);
    if (!Number.isFinite(pc1) || !Number.isFinite(pc2) || !Number.isFinite(pc3)) {
      throw new Error(`Invalid coordinates for sample at index ${idx}.`);
    }
    const safeMeta = {};
    if (s?.metadata && typeof s.metadata === "object" && !Array.isArray(s.metadata)) {
      for (const [k, v] of Object.entries(s.metadata)) {
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          safeMeta[String(k)] = v;
        }
      }
    }
    return {
      id: String(s?.id || `Sample_${idx + 1}`),
      group: String(s?.group || "Unassigned"),
      pc1: round6(pc1),
      pc2: round6(pc2),
      pc3: round6(pc3),
      metadata: safeMeta,
    };
  });

  const veRaw = Array.isArray(payload.variance_explained) ? payload.variance_explained : [0, 0, 0];
  const variance_explained = [0, 1, 2].map((i) => {
    const v = Number(veRaw[i] ?? 0);
    return Number.isFinite(v) ? round6(Math.max(0, v)) : 0;
  });

  const permRaw = payload.permanova && typeof payload.permanova === "object" ? payload.permanova : {};
  const permanova = {
    f_stat: Number.isFinite(Number(permRaw.f_stat)) ? round6(Number(permRaw.f_stat)) : 0,
    p_value: Number.isFinite(Number(permRaw.p_value)) ? round6(Number(permRaw.p_value)) : 1,
    permutations: Number.isFinite(Number(permRaw.permutations)) ? Math.max(0, Math.round(Number(permRaw.permutations))) : 0,
  };

  const provRaw = payload.provenance && typeof payload.provenance === "object" ? payload.provenance : {};
  const provenance = {
    method: String(provRaw.method || "rclr + PCoA + PERMANOVA (JSON import)"),
    dataset_label: String(provRaw.dataset_label || sourceName.replace(/\.json$/i, "")),
    note: String(provRaw.note || "Loaded from external skbio_to_3d.py JSON export."),
  };

  const noteLower = `${provenance.dataset_label} ${provenance.note}`.toLowerCase();
  const isIllustrativeDemo =
    Boolean(payload.isIllustrativeDemo) || noteLower.includes("illustrative demo");
  const methodLower = provenance.method.toLowerCase();
  const sourceKind = isIllustrativeDemo
    ? "illustrative_demo"
    : methodLower.includes("client-side js")
      ? "browser_csv"
      : "skbio_json";

  return {
    samples,
    variance_explained,
    permanova,
    provenance,
    isIllustrativeDemo,
    sourceKind,
  };
}

/**
 * Compute per-group counts, centroids, dispersion, and assigned colors.
 */
export function computeGroupSummaries(samples) {
  const byGroup = new Map();
  for (const s of samples) {
    if (!byGroup.has(s.group)) byGroup.set(s.group, []);
    byGroup.get(s.group).push(s);
  }

  return Array.from(byGroup.entries()).map(([group, members], index) => {
    const n = members.length;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const m of members) {
      cx += m.pc1;
      cy += m.pc2;
      cz += m.pc3;
    }
    cx /= n;
    cy /= n;
    cz /= n;

    let radiusSum = 0;
    for (const m of members) {
      radiusSum += Math.hypot(m.pc1 - cx, m.pc2 - cy, m.pc3 - cz);
    }

    return {
      group,
      count: n,
      color: GROUP_PALETTE[index % GROUP_PALETTE.length],
      centroid: {
        pc1: round6(cx),
        pc2: round6(cy),
        pc3: round6(cz),
      },
      meanRadius: round6(radiusSum / n),
    };
  });
}

/**
 * Build the clearly badged Illustrative Demo dataset for Brain AWG Mitochondria Subgroup
 * (Drosophila melanogaster Spaceflight vs. Ground Control vs. Alzheimer's-model OxPhos/ROS).
 *
 * All 3D coordinates, variance explained, and PERMANOVA statistics are genuinely computed via
 * rclrTransform -> pairwiseEuclideanDistanceMatrix -> runPcoa3d -> runPermanova on a transparent
 * illustrative matrix (NEVER empirical OSDR data and NEVER associated with fabricated OSD IDs).
 */
export function buildBrainAwgDemoDataset() {
  const demoCsv = [
    "sample_id,condition,model_organism,pathway_panel,cohort_status,Complex_I_Module,Complex_III_Module,Complex_IV_Module,ATP_Synthase_Module,ROS_Detox_SOD_Module,Mitophagy_PINK1_Module,Mito_Dynamics_DRP1_Module,NAD_Salvage_Module",
    "DEMO_GC_01,Ground Control,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Synthetic Demo,860,810,940,880,410,520,390,910",
    "DEMO_GC_02,Ground Control,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Synthetic Demo,890,835,640,915,395,240,375,540",
    "DEMO_GC_03,Ground Control,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Synthetic Demo,820,775,990,855,435,560,415,960",
    "DEMO_GC_04,Ground Control,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Synthetic Demo,870,815,610,895,405,220,385,510",
    "DEMO_GC_05,Ground Control,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Synthetic Demo,805,760,890,840,445,480,420,840",
    "DEMO_GC_06,Ground Control,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Synthetic Demo,875,840,680,905,385,270,395,580",
    "DEMO_SF_01,Spaceflight,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Synthetic Demo,475,520,690,530,960,1120,780,680",
    "DEMO_SF_02,Spaceflight,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Synthetic Demo,445,490,340,510,1040,560,825,290",
    "DEMO_SF_03,Spaceflight,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Synthetic Demo,515,550,740,565,915,1180,745,730",
    "DEMO_SF_04,Spaceflight,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Synthetic Demo,465,500,320,515,995,530,810,275",
    "DEMO_SF_05,Spaceflight,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Synthetic Demo,495,535,650,545,940,1050,765,640",
    "DEMO_SF_06,Spaceflight,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Synthetic Demo,435,475,365,490,1080,590,850,310",
    "DEMO_AD_01,Alzheimer's Model,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Synthetic Demo,340,380,520,390,1180,680,1120,480",
    "DEMO_AD_02,Alzheimer's Model,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Synthetic Demo,310,350,210,365,1260,290,1190,180",
    "DEMO_AD_03,Alzheimer's Model,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Synthetic Demo,375,410,560,415,1120,730,1060,510",
    "DEMO_AD_04,Alzheimer's Model,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Synthetic Demo,325,360,195,375,1215,260,1155,165",
    "DEMO_AD_05,Alzheimer's Model,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Synthetic Demo,355,390,485,405,1150,640,1095,445",
    "DEMO_AD_06,Alzheimer's Model,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Synthetic Demo,295,335,230,350,1310,310,1235,195",
  ].join("\n");

  const result = ordinateFromCsvText(demoCsv, {
    filename: "drosophila_mito_demo_combined.csv",
    groupCol: "condition",
    permutations: 999,
    seed: 3903,
    isIllustrativeDemo: true,
    datasetLabel: "Illustrative Demo: Drosophila OxPhos / ROS Ordination (Thread #3903)",
  });

  result.provenance.method = "rclr + Euclidean/Aitchison DistanceMatrix + 3D PCoA + PERMANOVA";
  result.provenance.note = `${ILLUSTRATIVE_DEMO_BADGE}. Synthetic illustrative feature matrix only - not empirical NASA OSDR data and no OSD accession is claimed.`;
  result.isIllustrativeDemo = true;
  return result;
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
 * Generate a crisp, publication-ready vector SVG snapshot of the 3D ordination
 * using an isometric 3D-to-2D projection with axes, % variance explained, group centroids,
 * PERMANOVA statistics readout, and provenance/demo footer.
 */
export function generateOrdinationSvgSnapshot(dataset, options = {}) {
  const width = 1040;
  const height = 680;
  const plotLeft = 72;
  const plotTop = 88;
  const plotWidth = 650;
  const plotHeight = 485;
  const centerX = plotLeft + plotWidth / 2;
  const centerY = plotTop + plotHeight / 2 + 12;

  const hiddenGroups = new Set(options.hiddenGroups || []);
  const showCentroids = options.showCentroids !== false;
  const yaw = typeof options.yaw === "number" ? options.yaw : 0.62;
  const pitch = typeof options.pitch === "number" ? options.pitch : 0.42;

  const summaries = computeGroupSummaries(dataset.samples);
  const colorMap = new Map(summaries.map((g) => [g.group, g.color]));
  const visibleSamples = dataset.samples.filter((s) => !hiddenGroups.has(s.group));

  // Normalize coordinate scale
  let maxExtent = 0.001;
  for (const s of dataset.samples) {
    maxExtent = Math.max(maxExtent, Math.abs(s.pc1), Math.abs(s.pc2), Math.abs(s.pc3));
  }
  const scale = 185 / maxExtent;

  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);

  function project(x, y, z) {
    const nx = x * scale;
    const ny = y * scale;
    const nz = z * scale;
    const rx = nx * cosY - nz * sinY;
    const rz = nx * sinY + nz * cosY;
    const ry = ny * cosP - rz * sinP;
    const depth = ny * sinP + rz * cosP;
    return {
      sx: centerX + rx,
      sy: centerY - ry,
      depth,
    };
  }

  const origin = project(0, 0, 0);
  const axisLen = maxExtent * 1.14;
  const labelLen = axisLen * 1.24;
  const xPos = project(axisLen, 0, 0);
  const xNeg = project(-axisLen, 0, 0);
  const yPos = project(0, axisLen, 0);
  const yNeg = project(0, -axisLen, 0);
  const zPos = project(0, 0, axisLen);
  const zNeg = project(0, 0, -axisLen);
  const xLab = project(labelLen, 0, 0);
  const yLab = project(0, labelLen, 0);
  const zLab = project(0, 0, labelLen);

  const ve = dataset.variance_explained || [0, 0, 0];
  const pct = (v) => `${(Number(v || 0) * 100).toFixed(1)}%`;

  const projectedSamples = visibleSamples
    .map((s) => ({
      sample: s,
      color: colorMap.get(s.group) || "#38bdf8",
      ...project(s.pc1, s.pc2, s.pc3),
    }))
    .sort((a, b) => a.depth - b.depth);

  const centroidLines = [];
  const centroidMarkers = [];
  if (showCentroids) {
    for (const g of summaries) {
      if (hiddenGroups.has(g.group)) continue;
      const cp = project(g.centroid.pc1, g.centroid.pc2, g.centroid.pc3);
      for (const s of visibleSamples) {
        if (s.group !== g.group) continue;
        const sp = project(s.pc1, s.pc2, s.pc3);
        centroidLines.push(
          `<line x1="${cp.sx.toFixed(1)}" y1="${cp.sy.toFixed(1)}" x2="${sp.sx.toFixed(1)}" y2="${sp.sy.toFixed(1)}" stroke="${g.color}" stroke-opacity="0.28" stroke-width="1.2" stroke-dasharray="3 3" />`
        );
      }
      centroidMarkers.push(
        `<g>` +
          `<polygon points="${cp.sx.toFixed(1)},${(cp.sy - 8).toFixed(1)} ${(cp.sx + 8).toFixed(1)},${cp.sy.toFixed(1)} ${cp.sx.toFixed(1)},${(cp.sy + 8).toFixed(1)} ${(cp.sx - 8).toFixed(1)},${cp.sy.toFixed(1)}" fill="${g.color}" fill-opacity="0.25" stroke="${g.color}" stroke-width="2" />` +
          `<circle cx="${cp.sx.toFixed(1)}" cy="${cp.sy.toFixed(1)}" r="2.6" fill="#ffffff" />` +
        `</g>`
      );
    }
  }

  const sampleDots = projectedSamples
    .map((p) => {
      const r = Math.max(4.5, Math.min(8, 6.2 + p.depth / 120));
      return `<circle cx="${p.sx.toFixed(1)}" cy="${p.sy.toFixed(1)}" r="${r.toFixed(1)}" fill="${p.color}" fill-opacity="0.92" stroke="#080d17" stroke-width="1.4"><title>${escapeXml(p.sample.id)} (${escapeXml(p.sample.group)})</title></circle>`;
    })
    .join("\n      ");

  const legendRows = summaries
    .map((g, i) => {
      const y = 264 + i * 28;
      const opacity = hiddenGroups.has(g.group) ? "0.35" : "1";
      return `<g opacity="${opacity}">` +
        `<circle cx="766" cy="${y}" r="6" fill="${g.color}" />` +
        `<text x="782" y="${y + 4}" fill="#e2e8f0" font-size="12.5" font-weight="600">${escapeXml(g.group)}</text>` +
        `<text x="992" y="${y + 4}" fill="#94a3b8" font-size="12" text-anchor="end">n = ${g.count}</text>` +
      `</g>`;
    })
    .join("\n    ");

  const titleText = escapeXml(dataset.provenance?.dataset_label || "Brain AWG 3D Omics Ordination");
  const badgeText = escapeXml(getProvenanceBadgeText(dataset));
  const badgeStroke = dataset.isIllustrativeDemo ? "#f59e0b" : "#10b981";
  const badgeFill = dataset.isIllustrativeDemo ? "rgba(245, 158, 11, 0.14)" : "rgba(16, 185, 129, 0.14)";
  const badgeTextColor = dataset.isIllustrativeDemo ? "#fcd34d" : "#6ee7b7";

  const pValStr =
    dataset.permanova?.permutations > 0
      ? Number(dataset.permanova.p_value).toFixed(4)
      : "N/A";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${titleText}">
  <title>${titleText}</title>
  <rect width="${width}" height="${height}" fill="#080d17" rx="14" />
  <rect x="20" y="20" width="${width - 40}" height="${height - 40}" fill="#0d1424" stroke="#1e293b" stroke-width="1.2" rx="12" />

  <!-- Header -->
  <text x="42" y="54" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="700">Brain AWG · 3D Omics Ordination Explorer (scikit-bio rclr + PCoA)</text>
  <text x="42" y="75" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="12.5">${titleText}</text>

  <!-- Provenance Badge -->
  <rect x="520" y="34" width="480" height="28" rx="14" fill="${badgeFill}" stroke="${badgeStroke}" stroke-width="1" />
  <text x="760" y="52" fill="${badgeTextColor}" font-family="system-ui, -apple-system, sans-serif" font-size="11.5" font-weight="600" text-anchor="middle">${badgeText}</text>

  <!-- Plot Panel -->
  <rect x="${plotLeft - 30}" y="${plotTop}" width="${plotWidth + 30}" height="${plotHeight}" rx="10" fill="#060a12" stroke="#1e293b" stroke-width="1" />

  <!-- 3D Projected Axes -->
  <g stroke-linecap="round">
    <line x1="${xNeg.sx.toFixed(1)}" y1="${xNeg.sy.toFixed(1)}" x2="${xPos.sx.toFixed(1)}" y2="${xPos.sy.toFixed(1)}" stroke="#38bdf8" stroke-opacity="0.55" stroke-width="1.6" />
    <line x1="${yNeg.sx.toFixed(1)}" y1="${yNeg.sy.toFixed(1)}" x2="${yPos.sx.toFixed(1)}" y2="${yPos.sy.toFixed(1)}" stroke="#34d399" stroke-opacity="0.55" stroke-width="1.6" />
    <line x1="${zNeg.sx.toFixed(1)}" y1="${zNeg.sy.toFixed(1)}" x2="${zPos.sx.toFixed(1)}" y2="${zPos.sy.toFixed(1)}" stroke="#a78bfa" stroke-opacity="0.55" stroke-width="1.6" />
    <circle cx="${origin.sx.toFixed(1)}" cy="${origin.sy.toFixed(1)}" r="2.2" fill="#64748b" />
  </g>

  <!-- Axis Labels -->
  <g font-family="system-ui, -apple-system, sans-serif" font-size="11.5" font-weight="700">
    <text x="${xLab.sx.toFixed(1)}" y="${(xLab.sy + 4).toFixed(1)}" fill="#7dd3fc" text-anchor="middle">PC1 (${pct(ve[0])})</text>
    <text x="${yLab.sx.toFixed(1)}" y="${(yLab.sy - 4).toFixed(1)}" fill="#6ee7b7" text-anchor="middle">PC2 (${pct(ve[1])})</text>
    <text x="${zLab.sx.toFixed(1)}" y="${(zLab.sy + 4).toFixed(1)}" fill="#c4b5fd" text-anchor="middle">PC3 (${pct(ve[2])})</text>
  </g>

  <!-- Centroid Spokes -->
  <g>
    ${centroidLines.join("\n    ")}
  </g>

  <!-- Sample Points -->
  <g>
      ${sampleDots}
  </g>

  <!-- Centroid Diamonds -->
  <g>
    ${centroidMarkers.join("\n    ")}
  </g>

  <!-- Statistical Readout Card -->
  <g font-family="system-ui, -apple-system, sans-serif">
    <rect x="742" y="${plotTop}" width="268" height="132" rx="10" fill="#111827" stroke="#1e293b" stroke-width="1" />
    <text x="758" y="114" fill="#7dd3fc" font-size="11.5" font-weight="700" letter-spacing="0.6">ORDINATION STATISTICS</text>
    <text x="758" y="140" fill="#94a3b8" font-size="12">PERMANOVA F:</text>
    <text x="994" y="140" fill="#f8fafc" font-size="13" font-weight="700" text-anchor="end">${Number(dataset.permanova?.f_stat || 0).toFixed(3)}</text>
    <text x="758" y="164" fill="#94a3b8" font-size="12">PERMANOVA p-value:</text>
    <text x="994" y="164" fill="#34d399" font-size="13" font-weight="700" text-anchor="end">${pValStr}</text>
    <text x="758" y="188" fill="#94a3b8" font-size="12">Permutations / Samples:</text>
    <text x="994" y="188" fill="#e2e8f0" font-size="12.5" text-anchor="end">${dataset.permanova?.permutations || 0} / n=${dataset.samples.length}</text>
    <text x="758" y="208" fill="#64748b" font-size="11">Transform: rclr + Aitchison PCoA</text>

    <!-- Group Legend Card -->
    <rect x="742" y="232" width="268" height="${Math.max(120, 44 + summaries.length * 28)}" rx="10" fill="#111827" stroke="#1e293b" stroke-width="1" />
    <text x="758" y="252" fill="#7dd3fc" font-size="11.5" font-weight="700" letter-spacing="0.6">COHORT GROUPS (n PER GROUP)</text>
    ${legendRows}
  </g>

  <!-- Provenance Footer -->
  <text x="42" y="612" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="11">Method: ${escapeXml(dataset.provenance?.method || "rclr + PCoA + PERMANOVA")} · Variance (PC1-3): ${pct(ve[0])}, ${pct(ve[1])}, ${pct(ve[2])}</text>
  <text x="42" y="632" fill="#64748b" font-family="system-ui, -apple-system, sans-serif" font-size="10.5">Provenance: ${escapeXml(dataset.provenance?.note || "")}</text>
</svg>`;
}
