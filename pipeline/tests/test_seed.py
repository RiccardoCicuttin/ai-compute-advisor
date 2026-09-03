from __future__ import annotations

import pytest
from pydantic import ValidationError

from hf_sync.seed import load_seed


def test_committed_seed_file_loads_and_validates() -> None:
    seed = load_seed()
    assert len(seed) >= 20, f"Seed shrank unexpectedly: {len(seed)} models"
    ids = [m.id for m in seed]
    assert len(set(ids)) == len(ids), "Duplicate model ids in seed"
    assert "gpt-oss-120b" in ids


def test_dense_model_with_mismatched_active_params_is_rejected() -> None:
    with pytest.raises(ValidationError):
        from hf_sync.seed import SeedModel

        SeedModel.model_validate(
            {
                "id": "bad-model",
                "hfRepoId": "org/bad-model",
                "name": "Bad Model",
                "provider": "Org",
                "modelType": "dense",
                "totalParametersB": 8.0,
                "activeParametersB": 4.0,
                "recommendedQuantizationId": "q4",
                "quantizations": [
                    {
                        "id": "q4",
                        "label": "4-bit",
                        "bitsPerParameter": 4,
                        "packingOverheadRatio": 0.05,
                    }
                ],
                "capabilityTierId": "balanced",
                "reasoning": False,
                "modalities": ["text"],
                "openWeight": True,
                "commercialUse": "allowed",
            }
        )
