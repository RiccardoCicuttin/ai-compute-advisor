from __future__ import annotations

import json
from pathlib import Path

import pytest

from hf_sync import build_catalog
from hf_sync.hf_configs import HfPullError
from hf_sync.seed import QuantizationProfile, SeedModel

LLAMA_3_1_8B_CONFIG = {
    "hidden_size": 4096,
    "max_position_embeddings": 131072,
    "num_attention_heads": 32,
    "num_hidden_layers": 32,
    "num_key_value_heads": 8,
}


def make_seed_model(**overrides: object) -> SeedModel:
    defaults: dict[str, object] = {
        "id": "test-model",
        "hfRepoId": "org/test-model",
        "name": "Test Model",
        "provider": "Test Org",
        "modelType": "dense",
        "totalParametersB": 8.0,
        "activeParametersB": 8.0,
        "recommendedQuantizationId": "q4",
        "quantizations": [
            QuantizationProfile(
                id="q4", label="4-bit", bitsPerParameter=4, packingOverheadRatio=0.05
            )
        ],
        "capabilityTierId": "balanced",
        "reasoning": False,
        "modalities": ["text"],
        "openWeight": True,
        "commercialUse": "allowed",
    }
    defaults.update(overrides)
    return SeedModel.model_validate(defaults)


def test_successful_pull_refreshes_architecture_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(build_catalog, "fetch_config", lambda repo_id: LLAMA_3_1_8B_CONFIG)

    seed = [make_seed_model()]
    result = build_catalog.build(seed, previous={})

    assert result.gaps == []
    assert len(result.records) == 1
    record = result.records[0]
    assert record["contextWindowTokens"] == 131072
    assert record["kvCacheBytesPerToken"] == 131072  # 2*32*8*128*2


def test_pull_failure_carries_forward_previous_entry(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(repo_id: str) -> dict:
        raise HfPullError(f"repo not found: {repo_id}")

    monkeypatch.setattr(build_catalog, "fetch_config", fail)

    seed = [make_seed_model()]
    previous = {
        "test-model": {
            "id": "test-model",
            "name": "Test Model",
            "provider": "Test Org",
            "modelType": "dense",
            "totalParametersB": 8.0,
            "activeParametersB": 8.0,
            "contextWindowTokens": 8192,
            "recommendedQuantizationId": "q4",
            "quantizations": [
                {"id": "q4", "label": "4-bit", "bitsPerParameter": 4, "packingOverheadRatio": 0.05}
            ],
            "capabilityTierId": "balanced",
            "reasoning": False,
            "modalities": ["text"],
            "openWeight": True,
            "commercialUse": "allowed",
        }
    }

    # The seed itself has no contextWindowTokens fallback, so the merged
    # candidate is invalid — build() must fall back to the previous entry
    # rather than publish an incomplete record.
    result = build_catalog.build(seed, previous)

    assert len(result.records) == 1
    assert result.records[0] == previous["test-model"]
    assert len(result.gaps) == 1
    assert result.gaps[0].action == "carried-forward-stale"


def test_pull_failure_with_no_previous_entry_excludes_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail(repo_id: str) -> dict:
        raise HfPullError("repo not found")

    monkeypatch.setattr(build_catalog, "fetch_config", fail)

    seed = [make_seed_model()]
    result = build_catalog.build(seed, previous={})

    assert result.records == []
    assert len(result.gaps) == 1
    assert result.gaps[0].action == "excluded"


def test_seed_supplied_context_window_used_when_pull_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(repo_id: str) -> dict:
        raise HfPullError("repo not found")

    monkeypatch.setattr(build_catalog, "fetch_config", fail)

    seed = [make_seed_model(contextWindowTokens=4096)]
    result = build_catalog.build(seed, previous={})

    assert len(result.records) == 1
    assert result.records[0]["contextWindowTokens"] == 4096
    assert result.gaps[0].action == "carried-forward-stale"


def test_write_models_json_round_trips(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "models.json"
    path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "catalogId": "models",
                "lastUpdated": "2020-01-01",
                "source": {
                    "label": "old",
                    "url": "https://example.com",
                    "methodology": "old text",
                    "license": "MIT",
                },
                "data": [],
            }
        ),
        encoding="utf-8",
    )

    records = [
        {
            "id": "test-model",
            "name": "Test Model",
            "provider": "Test Org",
            "modelType": "dense",
            "totalParametersB": 8.0,
            "activeParametersB": 8.0,
            "contextWindowTokens": 8192,
            "recommendedQuantizationId": "q4",
            "quantizations": [
                {"id": "q4", "label": "4-bit", "bitsPerParameter": 4, "packingOverheadRatio": 0.05}
            ],
            "capabilityTierId": "balanced",
            "reasoning": False,
            "modalities": ["text"],
            "openWeight": True,
            "commercialUse": "allowed",
        }
    ]

    build_catalog._write_models_json(records, path=path)

    written = json.loads(path.read_text(encoding="utf-8"))
    assert written["data"] == records
    assert build_catalog.METHODOLOGY_SUFFIX in written["source"]["methodology"]
    assert written["source"]["label"] == "old"  # untouched, editorial field
