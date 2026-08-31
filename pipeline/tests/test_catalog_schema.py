from __future__ import annotations

from hf_sync.catalog_schema import validate_record

VALID_RECORD = {
    "id": "llama-3.2-3b-instruct",
    "name": "Llama 3.2 3B Instruct",
    "provider": "Meta",
    "modelType": "dense",
    "totalParametersB": 3.21,
    "activeParametersB": 3.21,
    "contextWindowTokens": 131072,
    "recommendedQuantizationId": "q4",
    "quantizations": [
        {"id": "q4", "label": "4-bit", "bitsPerParameter": 4, "packingOverheadRatio": 0.05},
    ],
    "capabilityTierId": "basic",
    "reasoning": False,
    "modalities": ["text"],
    "openWeight": True,
    "commercialUse": "allowed",
}


def test_valid_record_has_no_issues() -> None:
    assert validate_record(VALID_RECORD) == []


def test_dense_model_requires_equal_active_and_total_params() -> None:
    record = {**VALID_RECORD, "activeParametersB": 2.0}
    issues = validate_record(record)
    assert any("dense models must use totalParametersB" in i for i in issues)


def test_missing_context_window_is_rejected() -> None:
    record = {k: v for k, v in VALID_RECORD.items() if k != "contextWindowTokens"}
    issues = validate_record(record)
    assert any("contextWindowTokens" in i for i in issues)


def test_recommended_quantization_must_exist() -> None:
    record = {**VALID_RECORD, "recommendedQuantizationId": "q99"}
    issues = validate_record(record)
    assert any("recommendedQuantizationId" in i for i in issues)


def test_active_cannot_exceed_total() -> None:
    record = {**VALID_RECORD, "modelType": "moe", "activeParametersB": 5.0, "totalParametersB": 3.0}
    issues = validate_record(record)
    assert any("cannot exceed" in i for i in issues)


def test_empty_modalities_rejected() -> None:
    record = {**VALID_RECORD, "modalities": []}
    issues = validate_record(record)
    assert any("modalities" in i for i in issues)


def test_invalid_commercial_use_rejected() -> None:
    record = {**VALID_RECORD, "commercialUse": "maybe"}
    issues = validate_record(record)
    assert any("commercialUse" in i for i in issues)
