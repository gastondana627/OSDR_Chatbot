#!/usr/bin/env python3
"""
Brain AWG · scikit-bio 3D Omics Ordination Adapter (`scripts/skbio_to_3d.py`)

Converts any sample-by-feature expression/abundance CSV or TSV plus sample metadata
CSV/TSV (with a grouping column such as `condition` or `group`) into a deterministic,
public-safe 3D ordination JSON file for the OSDR ChatBot Brain AWG Explorer (`/brain-awg`).

Pipeline:
  1. Robust Centered Log-Ratio (`rclr`) transform (handles zero-inflated omics matrices)
  2. Pairwise Euclidean/Aitchison `DistanceMatrix`
  3. 3D Principal Coordinate Analysis (`pcoa`, exact `eigh` with canonical sign orientation)
  4. `permanova` pseudo-F statistic and deterministic permutation p-value
  5. Optional `skbio.embedding.Embedding` export when `--export-embedding` is supplied

Uses `scikit-bio` (`skbio`) when installed, with a mathematically equivalent NumPy/SciPy
fallback when run in a minimal Python environment (or when `--engine numpy` is requested).
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import warnings
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

try:
    from scipy.spatial.distance import pdist, squareform

    HAS_SCIPY = True
except Exception:  # pragma: no cover
    HAS_SCIPY = False

try:
    import skbio
    from skbio.embedding import (
        Embedding as SkbioEmbedding,
        EmbeddingVector as SkbioEmbeddingVector,
        embed_vec_to_dataframe as skbio_embed_vec_to_dataframe,
        embed_vec_to_ordination as skbio_embed_vec_to_ordination,
    )
    from skbio.stats.composition import rclr as skbio_rclr
    from skbio.stats.distance import DistanceMatrix as SkbioDistanceMatrix
    from skbio.stats.distance import permanova as skbio_permanova
    from skbio.stats.ordination import pcoa as skbio_pcoa

    HAS_SKBIO = True
except Exception:  # pragma: no cover
    HAS_SKBIO = False
    SkbioEmbedding = None  # type: ignore[assignment]
    SkbioEmbeddingVector = None  # type: ignore[assignment]
    skbio_embed_vec_to_dataframe = None  # type: ignore[assignment]
    skbio_embed_vec_to_ordination = None  # type: ignore[assignment]


SAMPLE_ID_CANDIDATES = (
    "sample_id",
    "sample",
    "id",
    "sample_name",
    "specimen",
    "specimen_id",
    "run_id",
)

GROUP_COL_CANDIDATES = (
    "condition",
    "group",
    "treatment",
    "cohort",
    "phenotype",
    "status",
    "arm",
    "factor",
)


def _round6(val: float) -> float:
    if not math.isfinite(val):
        return 0.0
    rounded = round(float(val), 6)
    return 0.0 if rounded == 0.0 else rounded


def _detect_delimiter(path: Path, sample_text: str) -> str:
    if path.suffix.lower() in {".tsv", ".txt"}:
        return "\t"
    first_line = sample_text.splitlines()[0] if sample_text else ""
    if first_line.count("\t") > first_line.count(","):
        return "\t"
    return ","


def _read_delimited_rows(path: Path) -> Tuple[List[str], List[Dict[str, str]]]:
    text = path.read_text(encoding="utf-8-sig")
    if not text.strip():
        raise ValueError(f"Input table is empty: {path}")
    delimiter = _detect_delimiter(path, text)
    reader = csv.DictReader(text.splitlines(), delimiter=delimiter)
    if not reader.fieldnames:
        raise ValueError(f"Could not read column headers from: {path}")
    headers = [h.strip() for h in reader.fieldnames if h is not None]
    rows: List[Dict[str, str]] = []
    for raw_row in reader:
        cleaned = {
            (k.strip() if k is not None else ""): (v.strip() if v is not None else "")
            for k, v in raw_row.items()
        }
        if any(val != "" for val in cleaned.values()):
            rows.append(cleaned)
    if len(rows) < 2:
        raise ValueError(f"Expected at least 2 sample rows in {path}; found {len(rows)}.")
    return headers, rows


def _pick_column(
    headers: Sequence[str],
    explicit: Optional[str],
    candidates: Sequence[str],
    fallback_first: bool = False,
) -> Optional[str]:
    if explicit:
        if explicit in headers:
            return explicit
        lower_map = {h.lower(): h for h in headers}
        if explicit.lower() in lower_map:
            return lower_map[explicit.lower()]
        raise ValueError(f"Requested column '{explicit}' not found in headers: {list(headers)}")
    lower_map = {h.lower(): h for h in headers}
    for cand in candidates:
        if cand in lower_map:
            return lower_map[cand]
    return headers[0] if (fallback_first and headers) else None


def _is_numeric_col(rows: Sequence[Dict[str, str]], col: str) -> bool:
    non_empty = 0
    numeric = 0
    for row in rows:
        raw = row.get(col, "")
        if raw == "":
            continue
        non_empty += 1
        try:
            val = float(raw)
            if math.isfinite(val):
                numeric += 1
        except ValueError:
            pass
    return non_empty > 0 and (numeric / non_empty) >= 0.9


def _sanitize_metadata_dict(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Keep metadata strictly JSON-serializable and public-safe (primitives only)."""
    safe: Dict[str, Any] = {}
    for k in sorted(raw.keys()):
        v = raw[k]
        if v is None or v == "":
            continue
        key_str = str(k).strip()
        if not key_str:
            continue
        if isinstance(v, bool):
            safe[key_str] = v
        elif isinstance(v, (int, float)):
            safe[key_str] = _round6(float(v)) if isinstance(v, float) else int(v)
        else:
            safe[key_str] = str(v).strip()
    return safe


def _rclr_numpy(matrix: np.ndarray) -> np.ndarray:
    """Mathematically equivalent NumPy rclr with zero entries mapped to 0.0."""
    arr = np.asarray(matrix, dtype=np.float64)
    if np.any(arr < 0):
        raise ValueError("rclr requires non-negative feature abundances/counts.")
    out = np.zeros_like(arr, dtype=np.float64)
    for i in range(arr.shape[0]):
        row = arr[i]
        pos = row > 0.0
        if np.any(pos):
            log_pos = np.log(row[pos])
            out[i, pos] = log_pos - np.mean(log_pos)
    return out


def _pairwise_euclidean(matrix: np.ndarray) -> np.ndarray:
    arr = np.asarray(matrix, dtype=np.float64)
    if HAS_SCIPY:
        dist = squareform(pdist(arr, metric="euclidean"))
    else:  # pragma: no cover
        diff = arr[:, None, :] - arr[None, :, :]
        dist = np.sqrt(np.sum(diff * diff, axis=-1))
    dist = 0.5 * (dist + dist.T)
    np.fill_diagonal(dist, 0.0)
    return dist


def _canonicalize_axis_signs(coords: np.ndarray) -> np.ndarray:
    """Force deterministic eigenvector sign: largest-magnitude coordinate on each axis is positive."""
    aligned = np.array(coords, dtype=np.float64, copy=True)
    for axis in range(aligned.shape[1]):
        col = aligned[:, axis]
        if col.size == 0:
            continue
        idx = int(np.argmax(np.abs(col)))
        if col[idx] < -1e-12:
            aligned[:, axis] = -col
    return aligned


def _pcoa_3d_numpy(dist_matrix: np.ndarray) -> Tuple[np.ndarray, List[float]]:
    """Exact Classical MDS / PCoA matching skbio.stats.ordination.pcoa(method='eigh')."""
    n = dist_matrix.shape[0]
    if n < 2:
        return np.zeros((n, 3), dtype=np.float64), [0.0, 0.0, 0.0]

    a_mat = -0.5 * (dist_matrix ** 2)
    row_means = np.mean(a_mat, axis=1, keepdims=True)
    col_means = np.mean(a_mat, axis=0, keepdims=True)
    grand_mean = float(np.mean(a_mat))
    b_mat = a_mat - row_means - col_means + grand_mean
    b_mat = 0.5 * (b_mat + b_mat.T)

    eigvals, eigvecs = np.linalg.eigh(b_mat)
    order = np.argsort(eigvals)[::-1]
    eigvals = eigvals[order]
    eigvecs = eigvecs[:, order]

    pos_mask = eigvals > 1e-12
    pos_sum = float(np.sum(eigvals[pos_mask]))

    coords = np.zeros((n, 3), dtype=np.float64)
    var_exp = [0.0, 0.0, 0.0]
    for axis in range(min(3, n)):
        lam = float(eigvals[axis])
        if lam > 1e-12:
            coords[:, axis] = eigvecs[:, axis] * math.sqrt(lam)
            var_exp[axis] = (lam / pos_sum) if pos_sum > 0.0 else 0.0

    coords = _canonicalize_axis_signs(coords)
    return coords, [_round6(v) for v in var_exp]


def _permanova_pseudo_f(d2: np.ndarray, group_codes: np.ndarray, n_groups: int, ss_total: float) -> float:
    n = d2.shape[0]
    ss_within = 0.0
    for g in range(n_groups):
        idx = np.flatnonzero(group_codes == g)
        ng = idx.size
        if ng <= 1:
            continue
        sub = d2[np.ix_(idx, idx)]
        # sum of upper triangle = 0.5 * sum of all elements (diagonal is 0)
        ss_within += (0.5 * float(np.sum(sub))) / ng

    ss_among = ss_total - ss_within
    if ss_within <= 1e-12:
        return 999999.0 if ss_among > 1e-12 else 0.0
    return (ss_among / (n_groups - 1)) / (ss_within / (n - n_groups))


def _permanova_numpy(
    dist_matrix: np.ndarray,
    groups: Sequence[str],
    permutations: int = 999,
    seed: int = 42,
) -> Dict[str, Any]:
    n = dist_matrix.shape[0]
    unique_groups = sorted(set(groups))
    n_groups = len(unique_groups)
    if n < 3 or n_groups < 2 or n <= n_groups:
        return {"f_stat": 0.0, "p_value": 1.0, "permutations": 0}

    label_to_code = {g: i for i, g in enumerate(unique_groups)}
    codes = np.array([label_to_code[g] for g in groups], dtype=np.int64)

    d2 = dist_matrix ** 2
    ss_total = (0.5 * float(np.sum(d2))) / n
    obs_f = _permanova_pseudo_f(d2, codes, n_groups, ss_total)

    perms = max(0, int(permutations))
    if perms == 0:
        return {"f_stat": _round6(obs_f), "p_value": 1.0, "permutations": 0}

    rng = np.random.default_rng(seed)
    ge_count = 0
    for _ in range(perms):
        perm_codes = rng.permutation(codes)
        perm_f = _permanova_pseudo_f(d2, perm_codes, n_groups, ss_total)
        if perm_f >= obs_f - 1e-12:
            ge_count += 1

    p_val = (ge_count + 1) / (perms + 1)
    return {
        "f_stat": _round6(obs_f),
        "p_value": _round6(p_val),
        "permutations": perms,
    }


def load_tables(
    counts_path: Path,
    metadata_path: Optional[Path] = None,
    id_col: Optional[str] = None,
    group_col: Optional[str] = None,
) -> Tuple[List[str], List[str], np.ndarray, List[str], List[Dict[str, Any]]]:
    """Load sample-by-feature table + optional metadata table and align samples cleanly."""
    c_headers, c_rows = _read_delimited_rows(counts_path)
    counts_id_col = _pick_column(c_headers, id_col, SAMPLE_ID_CANDIDATES, fallback_first=True)
    assert counts_id_col is not None

    if metadata_path is not None:
        m_headers, m_rows = _read_delimited_rows(metadata_path)
        meta_id_col = _pick_column(m_headers, id_col, SAMPLE_ID_CANDIDATES, fallback_first=True)
        assert meta_id_col is not None
        meta_group_col = _pick_column(
            [h for h in m_headers if h != meta_id_col],
            group_col,
            GROUP_COL_CANDIDATES,
            fallback_first=True,
        )
        if meta_group_col is None:
            raise ValueError(f"Could not find a grouping column in metadata table: {metadata_path}")

        meta_by_id = {row[meta_id_col]: row for row in m_rows if row.get(meta_id_col)}
        feature_cols = [h for h in c_headers if h != counts_id_col and _is_numeric_col(c_rows, h)]
        if len(feature_cols) < 2:
            raise ValueError(
                f"Expected at least 2 numeric feature columns in {counts_path}; found {len(feature_cols)}."
            )

        sample_ids: List[str] = []
        groups: List[str] = []
        matrix_rows: List[List[float]] = []
        meta_dicts: List[Dict[str, Any]] = []

        for row in c_rows:
            sid = row.get(counts_id_col, "")
            if not sid or sid not in meta_by_id:
                continue
            mrow = meta_by_id[sid]
            grp = mrow.get(meta_group_col, "") or "Unassigned"
            vals = [float(row.get(fc, "0") or "0") for fc in feature_cols]
            sample_ids.append(sid)
            groups.append(grp)
            matrix_rows.append(vals)
            raw_meta = {k: v for k, v in mrow.items() if k != meta_id_col}
            raw_meta["feature_count"] = len(feature_cols)
            meta_dicts.append(_sanitize_metadata_dict(raw_meta))

        if len(sample_ids) < 2:
            raise ValueError(
                "Fewer than 2 overlapping sample IDs between counts table and metadata table."
            )

        return sample_ids, groups, np.asarray(matrix_rows, dtype=np.float64), feature_cols, meta_dicts

    # Single combined table mode (metadata + numeric features in one CSV/TSV)
    numeric_cols = [h for h in c_headers if h != counts_id_col and _is_numeric_col(c_rows, h)]
    categorical_cols = [h for h in c_headers if h != counts_id_col and h not in numeric_cols]
    resolved_group_col = _pick_column(
        [h for h in c_headers if h != counts_id_col],
        group_col,
        GROUP_COL_CANDIDATES,
        fallback_first=False,
    )
    if resolved_group_col is None and categorical_cols:
        resolved_group_col = categorical_cols[0]

    feature_cols = [h for h in numeric_cols if h != resolved_group_col]
    if len(feature_cols) < 2:
        raise ValueError(
            f"Expected at least 2 numeric feature columns in {counts_path}; found {len(feature_cols)}."
        )

    sample_ids = []
    groups = []
    matrix_rows = []
    meta_dicts = []
    for idx, row in enumerate(c_rows):
        sid = row.get(counts_id_col, "") or f"Sample_{idx + 1}"
        grp = (row.get(resolved_group_col, "") if resolved_group_col else "") or "All Samples"
        vals = [float(row.get(fc, "0") or "0") for fc in feature_cols]
        sample_ids.append(sid)
        groups.append(grp)
        matrix_rows.append(vals)
        raw_meta = {k: row[k] for k in categorical_cols if k != counts_id_col}
        raw_meta["feature_count"] = len(feature_cols)
        meta_dicts.append(_sanitize_metadata_dict(raw_meta))

    return sample_ids, groups, np.asarray(matrix_rows, dtype=np.float64), feature_cols, meta_dicts


def compute_ordination_3d(
    sample_ids: Sequence[str],
    groups: Sequence[str],
    matrix: np.ndarray,
    metadata_list: Sequence[Dict[str, Any]],
    *,
    dataset_label: str = "Brain AWG Omics Cohort",
    note: str = "Generated via scripts/skbio_to_3d.py",
    permutations: int = 999,
    seed: int = 42,
    engine: str = "auto",
    embedding_out: Optional[Path] = None,
) -> Dict[str, Any]:
    """
    Execute rclr -> Euclidean/Aitchison DistanceMatrix -> 3D PCoA -> PERMANOVA
    and return the deterministic, public-safe Brain AWG 3D JSON dictionary.
    """
    arr = np.asarray(matrix, dtype=np.float64)
    if arr.ndim != 2 or arr.shape[0] < 2 or arr.shape[1] < 2:
        raise ValueError("Feature matrix must be 2D with at least 2 samples and 2 features.")

    use_skbio = (engine == "skbio") or (engine == "auto" and HAS_SKBIO)
    if engine == "skbio" and not HAS_SKBIO:
        raise RuntimeError("Requested engine='skbio', but scikit-bio is not installed.")

    has_negative = bool(np.any(arr < 0.0))

    if use_skbio:
        if not has_negative:
            rclr_raw = np.asarray(skbio_rclr(arr), dtype=np.float64)
            transformed = np.nan_to_num(rclr_raw, nan=0.0, posinf=0.0, neginf=0.0)
            transform_name = "rclr + Euclidean/Aitchison DistanceMatrix + 3D PCoA + PERMANOVA (scikit-bio)"
        else:
            transformed = arr - np.mean(arr, axis=0, keepdims=True)
            transform_name = "Centered Euclidean DistanceMatrix + 3D PCoA + PERMANOVA (scikit-bio)"

        dist_arr = _pairwise_euclidean(transformed)
        dm = SkbioDistanceMatrix(dist_arr, ids=list(sample_ids))

        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            ord_res = skbio_pcoa(dm, method="eigh", dimensions=0)

        samples_df = ord_res.samples
        coords = np.zeros((len(sample_ids), 3), dtype=np.float64)
        var_exp = [0.0, 0.0, 0.0]
        for axis_idx in range(3):
            col_name = f"PC{axis_idx + 1}"
            if col_name in samples_df.columns:
                coords[:, axis_idx] = samples_df[col_name].to_numpy(dtype=np.float64)
            if axis_idx < len(ord_res.proportion_explained):
                pe_val = float(ord_res.proportion_explained.iloc[axis_idx])
                var_exp[axis_idx] = _round6(max(0.0, pe_val))

        coords = _canonicalize_axis_signs(coords)

        unique_groups = sorted(set(groups))
        if len(sample_ids) >= 3 and len(unique_groups) >= 2 and len(sample_ids) > len(unique_groups):
            pm = skbio_permanova(
                dm,
                list(groups),
                permutations=max(0, int(permutations)),
                seed=int(seed),
            )
            f_stat = _round6(float(pm["test statistic"]))
            raw_p = float(pm["p-value"])
            p_val = _round6(raw_p if math.isfinite(raw_p) else 1.0)
            perm_result = {
                "f_stat": f_stat,
                "p_value": p_val,
                "permutations": int(pm["number of permutations"]),
            }
        else:
            perm_result = {"f_stat": 0.0, "p_value": 1.0, "permutations": 0}

        if embedding_out is not None and SkbioEmbedding is not None:
            embedding_out.parent.mkdir(parents=True, exist_ok=True)
            emb = SkbioEmbedding(coords.astype(np.float32), ids=list(sample_ids))
            vectors = [
                SkbioEmbeddingVector(coords[i : i + 1].astype(np.float32), [str(sid).encode("utf-8")])
                for i, sid in enumerate(sample_ids)
            ]
            suffix = embedding_out.suffix.lower()
            if suffix in {".tsv", ".csv"} and skbio_embed_vec_to_dataframe is not None:
                df = skbio_embed_vec_to_dataframe(vectors)
                df.columns = ["PC1", "PC2", "PC3"]
                df.to_csv(embedding_out, sep="\t" if suffix == ".tsv" else ",")
            elif suffix in {".ord", ".txt", ".ordination"} and skbio_embed_vec_to_ordination is not None:
                ord_emb = skbio_embed_vec_to_ordination(vectors)
                ord_emb.write(str(embedding_out), format="ordination")
            elif suffix == ".npz":
                np.savez(str(embedding_out), ids=emb.ids, embedding=emb.embedding)
            else:
                emb_payload = {
                    "format": "skbio.embedding.Embedding",
                    "skbio_version": getattr(skbio, "__version__", "unknown"),
                    "columns": ["PC1", "PC2", "PC3"],
                    "ids": [str(i) for i in emb.ids],
                    "embedding": [[_round6(float(x)) for x in row] for row in emb.embedding],
                }
                embedding_out.write_text(json.dumps(emb_payload, indent=2) + "\n", encoding="utf-8")
    else:
        if not has_negative:
            transformed = _rclr_numpy(arr)
            transform_name = "rclr + Euclidean/Aitchison DistanceMatrix + 3D PCoA + PERMANOVA (numpy/scipy fallback)"
        else:
            transformed = arr - np.mean(arr, axis=0, keepdims=True)
            transform_name = "Centered Euclidean DistanceMatrix + 3D PCoA + PERMANOVA (numpy/scipy fallback)"

        dist_arr = _pairwise_euclidean(transformed)
        coords, var_exp = _pcoa_3d_numpy(dist_arr)
        perm_result = _permanova_numpy(dist_arr, groups, permutations=permutations, seed=seed)

        if embedding_out is not None:
            embedding_out.parent.mkdir(parents=True, exist_ok=True)
            emb_payload = {
                "format": "numpy.embedding.fallback",
                "ids": [str(i) for i in sample_ids],
                "embedding": [[_round6(float(x)) for x in row] for row in coords],
            }
            embedding_out.write_text(json.dumps(emb_payload, indent=2) + "\n", encoding="utf-8")

    samples_out: List[Dict[str, Any]] = []
    for idx, sid in enumerate(sample_ids):
        samples_out.append(
            {
                "id": str(sid),
                "group": str(groups[idx]),
                "pc1": _round6(float(coords[idx, 0])),
                "pc2": _round6(float(coords[idx, 1])),
                "pc3": _round6(float(coords[idx, 2])),
                "metadata": _sanitize_metadata_dict(dict(metadata_list[idx])),
            }
        )

    return {
        "samples": samples_out,
        "variance_explained": [float(v) for v in var_exp],
        "permanova": perm_result,
        "provenance": {
            "method": transform_name,
            "dataset_label": str(dataset_label),
            "note": str(note),
        },
    }


def ordinate_files(
    counts_path: Path,
    metadata_path: Optional[Path] = None,
    *,
    id_col: Optional[str] = None,
    group_col: Optional[str] = None,
    dataset_label: Optional[str] = None,
    note: Optional[str] = None,
    permutations: int = 999,
    seed: int = 42,
    engine: str = "auto",
    embedding_out: Optional[Path] = None,
) -> Dict[str, Any]:
    sample_ids, groups, matrix, feature_cols, meta_dicts = load_tables(
        counts_path=counts_path,
        metadata_path=metadata_path,
        id_col=id_col,
        group_col=group_col,
    )
    resolved_label = dataset_label or counts_path.stem
    resolved_note = (
        note
        or f"Computed from {len(sample_ids)} samples x {len(feature_cols)} numeric features (deterministic seed={seed})."
    )
    return compute_ordination_3d(
        sample_ids=sample_ids,
        groups=groups,
        matrix=matrix,
        metadata_list=meta_dicts,
        dataset_label=resolved_label,
        note=resolved_note,
        permutations=permutations,
        seed=seed,
        engine=engine,
        embedding_out=embedding_out,
    )


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Convert sample-by-feature omics CSV/TSV + metadata CSV into Brain AWG 3D ordination JSON."
    )
    parser.add_argument(
        "--counts",
        required=True,
        type=Path,
        help="Path to sample-by-feature expression/abundance CSV or TSV.",
    )
    parser.add_argument(
        "--metadata",
        type=Path,
        default=None,
        help="Optional path to sample metadata CSV/TSV (with a group/condition column).",
    )
    parser.add_argument(
        "--id-col",
        default=None,
        help="Explicit sample ID column name (auto-detected if omitted).",
    )
    parser.add_argument(
        "--group-col",
        default=None,
        help="Explicit grouping column name such as 'condition' or 'group' (auto-detected if omitted).",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Output JSON path (prints JSON to stdout if omitted).",
    )
    parser.add_argument(
        "--dataset-label",
        default=None,
        help="Human-readable label written to provenance.dataset_label.",
    )
    parser.add_argument(
        "--note",
        default=None,
        help="Provenance note written to provenance.note.",
    )
    parser.add_argument(
        "--permutations",
        type=int,
        default=999,
        help="Number of PERMANOVA permutations (default: 999).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Deterministic random seed for PERMANOVA (default: 42).",
    )
    parser.add_argument(
        "--engine",
        choices=("auto", "skbio", "numpy"),
        default="auto",
        help="Ordination backend: 'auto' prefers scikit-bio with NumPy/SciPy fallback.",
    )
    parser.add_argument(
        "--export-embedding",
        type=Path,
        default=None,
        help="Optional output path for skbio.embedding.Embedding export (.embed or .json).",
    )
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    payload = ordinate_files(
        counts_path=args.counts,
        metadata_path=args.metadata,
        id_col=args.id_col,
        group_col=args.group_col,
        dataset_label=args.dataset_label,
        note=args.note,
        permutations=args.permutations,
        seed=args.seed,
        engine=args.engine,
        embedding_out=args.export_embedding,
    )
    serialized = json.dumps(payload, indent=2, sort_keys=False) + "\n"
    if args.out is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(serialized, encoding="utf-8")
    else:
        sys.stdout.write(serialized)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
