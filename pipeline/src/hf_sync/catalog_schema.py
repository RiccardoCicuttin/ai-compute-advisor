"""Python-side mirror of ai-compute-advisor's ModelRecordSchema (zod).

This is a defense-in-depth check so build_catalog.py can skip a broken
record and keep going, before the record ever reaches the app. It is not
a replacement for the real gate: CI still runs `npm test`, which is the
authoritative schema (src/data/schemas/catalogSchemas.ts). Keep this in
sync with that file's ModelRecordBaseSchema by hand — there is no shared
source of truth across the TS/Python boundary.
"""

from __future__ import annotations

import re

_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
_MODALITIES = {"text", "image", "audio", "video"}
_COMMERCIAL_USE = {"allowed", "restricted", "unknown"}


def validate_record(record: dict[str, object]) -> list[str]:
    """Returns a list of human-readable issues; empty means the record is valid."""
    issues: list[str] = []

    def require(condition: bool, message: str) -> None:
        if not condition:
            issues.append(message)

    model_id = record.get("id")
    require(
        isinstance(model_id, str) and bool(_ID_RE.match(model_id)), "id: missing or invalid format"
    )
    require(bool(record.get("name")), "name: required")
    require(bool(record.get("provider")), "provider: required")
    require(record.get("modelType") in ("dense", "moe"), "modelType: must be 'dense' or 'moe'")

    total = record.get("totalParametersB")
    active = record.get("activeParametersB")
    require(isinstance(total, (int, float)) and total > 0, "totalParametersB: must be > 0")
    require(isinstance(active, (int, float)) and active > 0, "activeParametersB: must be > 0")
    if isinstance(total, (int, float)) and isinstance(active, (int, float)):
        require(active <= total, "activeParametersB cannot exceed totalParametersB")
        if record.get("modelType") == "dense":
            require(active == total, "dense models must use totalParametersB as activeParametersB")

    context = record.get("contextWindowTokens")
    require(
        isinstance(context, int) and context > 0, "contextWindowTokens: required positive integer"
    )

    raw_quantizations = record.get("quantizations")
    require(
        isinstance(raw_quantizations, list) and len(raw_quantizations) > 0,
        "quantizations: must be non-empty",
    )
    quantizations: list[dict[str, object]] = [
        q
        for q in (raw_quantizations if isinstance(raw_quantizations, list) else [])
        if isinstance(q, dict)
    ]
    quant_ids = [q.get("id") for q in quantizations]
    require(len(set(quant_ids)) == len(quant_ids), "quantizations: duplicate ids")
    for q in quantizations:
        bits = q.get("bitsPerParameter")
        overhead = q.get("packingOverheadRatio")
        require(
            isinstance(bits, (int, float)) and 0 < bits <= 32,
            f"quantizations[{q.get('id')}]: bitsPerParameter must be in (0, 32]",
        )
        require(
            isinstance(overhead, (int, float)) and 0 <= overhead <= 1,
            f"quantizations[{q.get('id')}]: packingOverheadRatio must be in [0, 1]",
        )

    require(
        record.get("recommendedQuantizationId") in quant_ids,
        "recommendedQuantizationId must reference a quantization",
    )
    require(bool(record.get("capabilityTierId")), "capabilityTierId: required")
    require(isinstance(record.get("reasoning"), bool), "reasoning: required boolean")

    raw_modalities = record.get("modalities")
    require(
        isinstance(raw_modalities, list) and len(raw_modalities) > 0,
        "modalities: must be non-empty",
    )
    modalities: list[object] = raw_modalities if isinstance(raw_modalities, list) else []
    require(all(m in _MODALITIES for m in modalities), "modalities: contains an invalid value")

    require(isinstance(record.get("openWeight"), bool), "openWeight: required boolean")
    require(record.get("commercialUse") in _COMMERCIAL_USE, "commercialUse: invalid value")

    kv = record.get("kvCacheBytesPerToken")
    if kv is not None:
        require(
            isinstance(kv, (int, float)) and kv > 0,
            "kvCacheBytesPerToken: must be > 0 when present",
        )

    kv_fixed = record.get("kvCacheFixedBytes")
    if kv_fixed is not None:
        require(
            isinstance(kv_fixed, (int, float)) and kv_fixed >= 0,
            "kvCacheFixedBytes: must be >= 0 when present",
        )

    max_output = record.get("maxOutputTokens")
    if max_output is not None:
        require(
            isinstance(max_output, int) and max_output > 0,
            "maxOutputTokens: must be > 0 when present",
        )

    return issues
