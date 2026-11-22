"""Unit tests for Brain AWG scikit-bio 3D ordination adapter (`scripts/skbio_to_3d.py`)."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import skbio_to_3d as adapter  # noqa: E402

SAMPLE_DATA_DIR = REPO_ROOT / "scripts" / "sample_data"
DEMO_COUNTS = SAMPLE_DATA_DIR / "drosophila_mito_demo_counts.csv"
DEMO_META = SAMPLE_DATA_DIR / "drosophila_mito_demo_metadata.csv"
DEMO_COMBINED = SAMPLE_DATA_DIR / "drosophila_mito_demo_combined.csv"


def _assert_valid_schema(payload: dict, expected_n: int) -> None:
    assert set(payload.keys()) == {"samples", "variance_explained", "permanova", "provenance"}

    samples = payload["samples"]
    assert isinstance(samples, list)
    assert len(samples) == expected_n
    for sample in samples:
        assert set(sample.keys()) == {"id", "group", "pc1", "pc2", "pc3", "metadata"}
        assert isinstance(sample["id"], str) and sample["id"]
        assert isinstance(sample["group"], str) and sample["group"]
        for axis in ("pc1", "pc2", "pc3"):
            assert isinstance(sample[axis], (int, float))
            assert np.isfinite(sample[axis])
        assert isinstance(sample["metadata"], dict)

    ve = payload["variance_explained"]
    assert isinstance(ve, list) and len(ve) == 3
    for val in ve:
        assert isinstance(val, (int, float))
        assert 0.0 <= val <= 1.0
    assert sum(ve) <= 1.0001
    # Eigenvalues are sorted descending
    assert ve[0] >= ve[1] - 1e-6 >= ve[2] - 1e-6

    perm = payload["permanova"]
    assert set(perm.keys()) == {"f_stat", "p_value", "permutations"}
    assert isinstance(perm["f_stat"], (int, float)) and perm["f_stat"] >= 0.0
    assert isinstance(perm["p_value"], (int, float)) and 0.0 < perm["p_value"] <= 1.0
    assert isinstance(perm["permutations"], int) and perm["permutations"] >= 0

    prov = payload["provenance"]
    assert set(prov.keys()) == {"method", "dataset_label", "note"}
    assert all(isinstance(prov[k], str) and prov[k] for k in ("method", "dataset_label", "note"))


def test_paired_csv_schema_and_valid_stats() -> None:
    result = adapter.ordinate_files(
        DEMO_COUNTS,
        DEMO_META,
        group_col="condition",
        dataset_label="Illustrative Demo Drosophila OxPhos/ROS",
        note="Illustrative Demo - synthetic matrix for unit validation.",
        permutations=199,
        seed=42,
    )
    _assert_valid_schema(result, expected_n=18)
    # Three cleanly separated demo cohorts must yield strong pseudo-F and small p-value
    assert result["permanova"]["f_stat"] > 10.0
    assert result["permanova"]["p_value"] <= 0.02
    assert result["permanova"]["permutations"] == 199
    assert result["variance_explained"][0] > 0.5


def test_strict_determinism_across_runs() -> None:
    run_a = adapter.ordinate_files(DEMO_COUNTS, DEMO_META, permutations=199, seed=3903)
    run_b = adapter.ordinate_files(DEMO_COUNTS, DEMO_META, permutations=199, seed=3903)
    assert json.dumps(run_a, sort_keys=True) == json.dumps(run_b, sort_keys=True)


def test_tsv_and_zero_inflated_rclr_handling(tmp_path: Path) -> None:
    counts_tsv = tmp_path / "exosome_counts.tsv"
    meta_tsv = tmp_path / "exosome_meta.tsv"

    counts_tsv.write_text(
        "\n".join(
            [
                "sample_id\tfeat_a\tfeat_b\tfeat_c\tfeat_d\tfeat_e",
                "EXO_1\t0\t120\t45\t0\t30",
                "EXO_2\t0\t135\t50\t2\t28",
                "EXO_3\t5\t110\t42\t0\t33",
                "EXO_4\t95\t12\t0\t88\t10",
                "EXO_5\t102\t10\t3\t92\t8",
                "EXO_6\t88\t15\t0\t84\t11",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    meta_tsv.write_text(
        "\n".join(
            [
                "sample_id\tgroup\tassay",
                "EXO_1\tFlight\tExosome RNA",
                "EXO_2\tFlight\tExosome RNA",
                "EXO_3\tFlight\tExosome RNA",
                "EXO_4\tControl\tExosome RNA",
                "EXO_5\tControl\tExosome RNA",
                "EXO_6\tControl\tExosome RNA",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    result = adapter.ordinate_files(counts_tsv, meta_tsv, permutations=99, seed=7)
    _assert_valid_schema(result, expected_n=6)
    assert result["permanova"]["f_stat"] > 5.0
    assert result["samples"][0]["metadata"]["assay"] == "Exosome RNA"


def test_single_combined_csv_mode() -> None:
    result = adapter.ordinate_files(DEMO_COMBINED, permutations=99, seed=42)
    _assert_valid_schema(result, expected_n=18)
    assert {s["group"] for s in result["samples"]} == {
        "Ground Control",
        "Spaceflight",
        "Alzheimer's Model",
    }


def test_skbio_and_numpy_fallback_mathematical_parity() -> None:
    res_np = adapter.ordinate_files(
        DEMO_COUNTS, DEMO_META, permutations=199, seed=42, engine="numpy"
    )
    _assert_valid_schema(res_np, expected_n=18)
    assert "numpy/scipy fallback" in res_np["provenance"]["method"]

    if not adapter.HAS_SKBIO:
        pytest.skip("scikit-bio not installed in this Python interpreter")

    res_sk = adapter.ordinate_files(
        DEMO_COUNTS, DEMO_META, permutations=199, seed=42, engine="skbio"
    )
    _assert_valid_schema(res_sk, expected_n=18)
    assert "scikit-bio" in res_sk["provenance"]["method"]

    coords_np = np.array([[s["pc1"], s["pc2"], s["pc3"]] for s in res_np["samples"]])
    coords_sk = np.array([[s["pc1"], s["pc2"], s["pc3"]] for s in res_sk["samples"]])
    assert np.allclose(coords_np, coords_sk, atol=1e-5)
    assert np.allclose(res_np["variance_explained"], res_sk["variance_explained"], atol=1e-5)
    assert np.isclose(
        res_np["permanova"]["f_stat"],
        res_sk["permanova"]["f_stat"],
        rtol=1e-5,
    )


def test_optional_skbio_embedding_export_and_cli(tmp_path: Path) -> None:
    out_json = tmp_path / "brain_awg_ordination.json"
    out_emb = tmp_path / "brain_awg_embedding.json"
    out_tsv = tmp_path / "brain_awg_embedding.tsv"

    cmd = [
        sys.executable,
        str(REPO_ROOT / "scripts" / "skbio_to_3d.py"),
        "--counts",
        str(DEMO_COUNTS),
        "--metadata",
        str(DEMO_META),
        "--group-col",
        "condition",
        "--dataset-label",
        "Illustrative Demo Drosophila OxPhos/ROS",
        "--permutations",
        "99",
        "--seed",
        "42",
        "--out",
        str(out_json),
        "--export-embedding",
        str(out_emb),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=True)
    assert proc.returncode == 0
    assert out_json.exists()
    assert out_emb.exists() and out_emb.stat().st_size > 0

    parsed = json.loads(out_json.read_text(encoding="utf-8"))
    _assert_valid_schema(parsed, expected_n=18)

    emb_parsed = json.loads(out_emb.read_text(encoding="utf-8"))
    assert len(emb_parsed["ids"]) == 18
    assert len(emb_parsed["embedding"]) == 18
    assert len(emb_parsed["embedding"][0]) == 3

    if adapter.HAS_SKBIO:
        assert emb_parsed["format"] == "skbio.embedding.Embedding"
        # Also verify skbio.embedding.embed_vec_to_dataframe TSV export
        adapter.ordinate_files(
            DEMO_COUNTS,
            DEMO_META,
            permutations=49,
            seed=42,
            engine="skbio",
            embedding_out=out_tsv,
        )
        tsv_lines = out_tsv.read_text(encoding="utf-8").strip().splitlines()
        assert len(tsv_lines) == 19  # header + 18 samples
        assert "PC1\tPC2\tPC3" in tsv_lines[0]
