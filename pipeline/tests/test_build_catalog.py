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

# A small synthetic hybrid local/global-attention config (Gemma 3/4's
# convention: layer_types + sliding_window, with a separate head config for
# the full-attention layers) — 5 sliding-attention layers and 1 full
# -attention layer, exercising the layer-aware kv_cache_model split rather
# than the flat single-attention-type formula.
HYBRID_ATTENTION_CONFIG = {
    "hidden_size": 512,
    "max_position_embeddings": 8192,
    "num_attention_heads": 8,
    "num_hidden_layers": 6,
    "num_key_value_heads": 4,
    "head_dim": 64,
    "layer_types": [
        "sliding_attention",
        "sliding_attention",
        "sliding_attention",
        "sliding_attention",
        "sliding_attention",
        "full_attention",
    ],
    "sliding_window": 100,
    "num_global_key_value_heads": 2,
    "global_head_dim": 128,
}
# bytes_per_token = 2 * 1 full layer * 2 global KV heads * 128 global head_dim = 1024
# bytes_fixed = 2 * 5 sliding layers * 4 KV heads * 64 head_dim * 100-token window = 512000

# Synthetic Mamba/Jamba-style config: state_size is a novel-architecture
# signal field kv_cache_model() has no formula for, even though the rest of
# the config looks like an ordinary dense Llama config that would otherwise
# satisfy the ordinary formula.
NOVEL_ARCHITECTURE_CONFIG = {**LLAMA_3_1_8B_CONFIG, "state_size": 16}


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


def test_diverging_context_window_is_held_back_and_flagged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # config.json now reports a different max_position_embeddings than what's
    # committed (e.g. a RoPE-scaling ceiling) — must not silently overwrite.
    monkeypatch.setattr(build_catalog, "fetch_config", lambda repo_id: LLAMA_3_1_8B_CONFIG)

    seed = [make_seed_model()]
    previous = {"test-model": {"contextWindowTokens": 4096}}
    result = build_catalog.build(seed, previous)

    assert len(result.records) == 1
    record = result.records[0]
    assert record["contextWindowTokens"] == 4096  # kept, not overwritten with 131072
    # previous fixture has no kvCacheBytesPerToken entry, so there's nothing
    # to diverge from — the derived value is used as-is.
    assert record["kvCacheBytesPerToken"] == 131072
    assert len(result.gaps) == 1
    assert result.gaps[0].action == "carried-forward-stale"
    assert "131072" in result.gaps[0].reason
    assert "4096" in result.gaps[0].reason


def test_diverging_kv_cache_is_held_back_and_flagged(monkeypatch: pytest.MonkeyPatch) -> None:
    # config.json-derived kvCacheBytesPerToken disagrees with what's
    # committed — must not silently overwrite.
    monkeypatch.setattr(build_catalog, "fetch_config", lambda repo_id: LLAMA_3_1_8B_CONFIG)

    seed = [make_seed_model()]
    previous = {"test-model": {"contextWindowTokens": 131072, "kvCacheBytesPerToken": 983040}}
    result = build_catalog.build(seed, previous)

    assert len(result.records) == 1
    record = result.records[0]
    assert record["contextWindowTokens"] == 131072  # matches, unaffected
    assert record["kvCacheBytesPerToken"] == 983040  # kept, not overwritten with 131072
    assert len(result.gaps) == 1
    assert result.gaps[0].action == "carried-forward-stale"
    assert "131072" in result.gaps[0].reason
    assert "983040" in result.gaps[0].reason


def test_kv_cache_override_wins_over_derived_and_previous(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(build_catalog, "fetch_config", lambda repo_id: LLAMA_3_1_8B_CONFIG)

    seed = [make_seed_model(kvCacheBytesPerTokenOverride=55555)]
    previous = {"test-model": {"contextWindowTokens": 131072, "kvCacheBytesPerToken": 983040}}
    result = build_catalog.build(seed, previous)

    assert len(result.records) == 1
    assert result.records[0]["kvCacheBytesPerToken"] == 55555
    assert result.gaps == []


def test_matching_kv_cache_raises_no_gap(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(build_catalog, "fetch_config", lambda repo_id: LLAMA_3_1_8B_CONFIG)

    seed = [make_seed_model()]
    previous = {"test-model": {"contextWindowTokens": 131072, "kvCacheBytesPerToken": 131072}}
    result = build_catalog.build(seed, previous)

    assert result.records[0]["kvCacheBytesPerToken"] == 131072
    assert result.gaps == []


def test_novel_architecture_falls_back_to_previous_kv_cache_and_is_flagged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(build_catalog, "fetch_config", lambda repo_id: NOVEL_ARCHITECTURE_CONFIG)

    seed = [make_seed_model()]
    previous = {"test-model": {"contextWindowTokens": 131072, "kvCacheBytesPerToken": 983040}}
    result = build_catalog.build(seed, previous)

    assert len(result.records) == 1
    record = result.records[0]
    # Must not apply the standard per-KV-head formula despite the config
    # otherwise looking like an ordinary dense Llama config — kv_cache_model()
    # refuses to guess, so the previously committed value is kept.
    assert record["kvCacheBytesPerToken"] == 983040
    assert len(result.gaps) == 1
    assert result.gaps[0].action == "carried-forward-stale"
    assert "novel-looking architecture, pending formula review" in result.gaps[0].reason
    assert "state_size" in result.gaps[0].reason


def test_novel_architecture_with_no_previous_value_omits_kv_cache_but_still_flags(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(build_catalog, "fetch_config", lambda repo_id: NOVEL_ARCHITECTURE_CONFIG)

    seed = [make_seed_model()]
    result = build_catalog.build(seed, previous={})

    assert len(result.records) == 1
    # No previous value to fall back to — the record is still published
    # (kvCacheBytesPerToken is an optional field), just without one, rather
    # than being excluded outright.
    assert "kvCacheBytesPerToken" not in result.records[0]
    assert len(result.gaps) == 1
    assert result.gaps[0].action == "carried-forward-stale"
    assert "novel-looking architecture, pending formula review" in result.gaps[0].reason


def test_kv_cache_override_wins_over_novel_architecture_signal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(build_catalog, "fetch_config", lambda repo_id: NOVEL_ARCHITECTURE_CONFIG)

    seed = [make_seed_model(kvCacheBytesPerTokenOverride=12345)]
    previous = {"test-model": {"contextWindowTokens": 131072, "kvCacheBytesPerToken": 983040}}
    result = build_catalog.build(seed, previous)

    assert result.records[0]["kvCacheBytesPerToken"] == 12345
    assert result.gaps == []


def test_hybrid_attention_architecture_splits_kv_cache_into_linear_and_fixed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(build_catalog, "fetch_config", lambda repo_id: HYBRID_ATTENTION_CONFIG)

    seed = [make_seed_model()]
    result = build_catalog.build(seed, previous={})

    assert result.gaps == []
    assert len(result.records) == 1
    record = result.records[0]
    assert record["kvCacheBytesPerToken"] == 1024
    assert record["kvCacheFixedBytes"] == 512000


def test_homogeneous_architecture_omits_kv_cache_fixed_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # No layer_types/sliding_window in this config, so there's no fixed
    # component to report — the field shouldn't appear at all rather than
    # every ordinary model carrying an explicit kvCacheFixedBytes: 0.
    monkeypatch.setattr(build_catalog, "fetch_config", lambda repo_id: LLAMA_3_1_8B_CONFIG)

    seed = [make_seed_model()]
    result = build_catalog.build(seed, previous={})

    assert "kvCacheFixedBytes" not in result.records[0]


def test_diverging_kv_cache_fixed_bytes_is_held_back_and_flagged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(build_catalog, "fetch_config", lambda repo_id: HYBRID_ATTENTION_CONFIG)

    seed = [make_seed_model()]
    previous = {
        "test-model": {
            "contextWindowTokens": 8192,
            "kvCacheBytesPerToken": 1024,
            "kvCacheFixedBytes": 999,
        }
    }
    result = build_catalog.build(seed, previous)

    assert len(result.records) == 1
    record = result.records[0]
    assert record["kvCacheBytesPerToken"] == 1024  # matches, unaffected
    assert record["kvCacheFixedBytes"] == 999  # kept, not overwritten with 512000
    assert len(result.gaps) == 1
    assert result.gaps[0].action == "carried-forward-stale"
    assert "512000" in result.gaps[0].reason
    assert "999" in result.gaps[0].reason


def test_kv_cache_fixed_bytes_override_wins_over_derived_and_previous(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(build_catalog, "fetch_config", lambda repo_id: HYBRID_ATTENTION_CONFIG)

    seed = [make_seed_model(kvCacheFixedBytesOverride=7)]
    previous = {"test-model": {"contextWindowTokens": 8192, "kvCacheFixedBytes": 999}}
    result = build_catalog.build(seed, previous)

    assert len(result.records) == 1
    assert result.records[0]["kvCacheFixedBytes"] == 7
    assert result.gaps == []


def test_matching_kv_cache_fixed_bytes_raises_no_gap(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(build_catalog, "fetch_config", lambda repo_id: HYBRID_ATTENTION_CONFIG)

    seed = [make_seed_model()]
    previous = {
        "test-model": {
            "contextWindowTokens": 8192,
            "kvCacheBytesPerToken": 1024,
            "kvCacheFixedBytes": 512000,
        }
    }
    result = build_catalog.build(seed, previous)

    assert result.records[0]["kvCacheFixedBytes"] == 512000
    assert result.gaps == []


def test_context_window_override_wins_over_derived_and_previous(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(build_catalog, "fetch_config", lambda repo_id: LLAMA_3_1_8B_CONFIG)

    seed = [make_seed_model(contextWindowTokensOverride=99999)]
    previous = {"test-model": {"contextWindowTokens": 4096}}
    result = build_catalog.build(seed, previous)

    assert len(result.records) == 1
    assert result.records[0]["contextWindowTokens"] == 99999
    assert result.gaps == []


def test_matching_context_window_raises_no_gap(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(build_catalog, "fetch_config", lambda repo_id: LLAMA_3_1_8B_CONFIG)

    seed = [make_seed_model()]
    previous = {"test-model": {"contextWindowTokens": 131072}}
    result = build_catalog.build(seed, previous)

    assert result.records[0]["contextWindowTokens"] == 131072
    assert result.gaps == []


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
