"""Refresh public/data/models.json from models.seed.yaml + live Hugging Face configs.

For every model in the seed file:
  1. Pull its HF repo's config.json (cached under pipeline/.cache/hf_configs/).
  2. Derive contextWindowTokens, kvCacheBytesPerToken, and kvCacheFixedBytes
     from the architecture.
  3. Merge those onto the seed's curated fields (capability tier, license,
     quantizations, etc. — never touched by this script).
  4. Validate the merged record against catalog_schema.validate_record.

A model whose pull fails or whose merged record is invalid is EXCLUDED from
this run's output; its previous entry in the committed models.json (if any)
is carried forward unchanged rather than dropped or zeroed. Every exclusion
and carry-forward is written to gaps_report.txt so nothing fails silently —
this mirrors llm-specs-pipeline's report_gaps.py.

This script only ever touches the architecture-derived fields. It does not
add models that aren't in the seed, and it does not invent editorial fields
for models the seed doesn't fully describe.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

from loguru import logger

from hf_sync.architecture import extract_architecture, kv_cache_model
from hf_sync.catalog_schema import validate_record
from hf_sync.hf_configs import HfPullError, fetch_config
from hf_sync.seed import SeedModel, load_seed

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
MODELS_JSON_PATH = REPO_ROOT / "public" / "data" / "models.json"
MANIFEST_PATH = REPO_ROOT / "public" / "data" / "manifest.json"
GAPS_REPORT_PATH = Path(__file__).resolve().parent.parent.parent / "gaps_report.txt"

METHODOLOGY_SUFFIX = (
    " Architecture-derived fields (context window, KV-cache bytes per token) are "
    "refreshed on a weekly schedule from each model's published Hugging Face "
    "config.json. Parameter counts, capability tier, license and commercial-use "
    "terms remain human-curated in pipeline/models.seed.yaml."
)


@dataclass
class Gap:
    model_id: str
    reason: str
    action: str  # "excluded" | "carried-forward-stale"


@dataclass
class BuildResult:
    records: list[dict[str, Any]]
    gaps: list[Gap] = field(default_factory=list)


def _load_previous_records() -> dict[str, dict[str, Any]]:
    if not MODELS_JSON_PATH.exists():
        return {}
    envelope = json.loads(MODELS_JSON_PATH.read_text(encoding="utf-8"))
    return {record["id"]: record for record in envelope.get("data", [])}


def _refresh_fields(
    seed_model: SeedModel, previous_record: dict[str, Any] | None
) -> tuple[dict[str, Any], str | None, list[str]]:
    """Returns (field overrides from HF, pull-failure reason, divergence notes).

    For both contextWindowTokens and kvCacheBytesPerToken: an override,
    "matches previous", and "no previous entry yet" all resolve to using the
    freshly derived value with no divergence note. Only a derived value that
    actually disagrees with the previously committed one — and isn't pinned
    by an override — is held back; see the two branches below.
    """
    try:
        config = fetch_config(seed_model.hfRepoId)
    except HfPullError as e:
        return {}, str(e), []

    arch = extract_architecture(config)
    overrides: dict[str, Any] = {}
    divergences: list[str] = []

    if arch.context_length:
        derived = int(arch.context_length)
        previous_context = (previous_record or {}).get("contextWindowTokens")
        if seed_model.contextWindowTokensOverride is not None:
            overrides["contextWindowTokens"] = seed_model.contextWindowTokensOverride
        elif previous_context is not None and previous_context != derived:
            # config.json's max_position_embeddings (or equivalent) isn't
            # always the vendor-documented context window — it can be a
            # RoPE-scaling ceiling, or require a config change the vendor
            # documents but doesn't ship by default. Don't silently trust a
            # value that disagrees with what's already committed; keep the
            # known-good one and ask a human to check the model's actual
            # docs (not config.json) and set contextWindowTokensOverride.
            overrides["contextWindowTokens"] = previous_context
            divergences.append(
                f"HF config now derives contextWindowTokens={derived}, which disagrees with "
                f"the committed value {previous_context}; kept {previous_context}. Verify "
                "against the model's HF README/model card (not config.json) and set "
                "contextWindowTokensOverride in models.seed.yaml to the confirmed value"
            )
        else:
            overrides["contextWindowTokens"] = derived

    # kv_cache_model splits the KV-cache footprint into a per-token rate
    # (bytes_per_token, scales with actual context length) and a fixed
    # component (bytes_fixed, contributed by windowed/local-attention layers
    # whose cache caps out at their window size). This is layer-type-aware
    # for hybrid local/global-attention architectures (e.g. a sliding-window
    # config) — see hf_sync.architecture.kv_cache_model — but a divergence
    # can still surface a real upstream architecture change, or a
    # layer_types convention the classifier doesn't yet recognize; either
    # way, don't trust it silently.
    kv_model = kv_cache_model(arch)
    kv = kv_model.bytes_per_token if kv_model is not None else None
    kv_fixed = kv_model.bytes_fixed if kv_model is not None else None
    previous_kv = (previous_record or {}).get("kvCacheBytesPerToken")
    previous_kv_fixed = (previous_record or {}).get("kvCacheFixedBytes")

    if seed_model.kvCacheBytesPerTokenOverride is not None:
        overrides["kvCacheBytesPerToken"] = seed_model.kvCacheBytesPerTokenOverride
    elif kv is not None:
        if previous_kv is not None and previous_kv != kv:
            overrides["kvCacheBytesPerToken"] = previous_kv
            divergences.append(
                f"HF config now derives kvCacheBytesPerToken={kv}, which disagrees with "
                f"the committed value {previous_kv}; kept {previous_kv}. Verify by hand and "
                "set kvCacheBytesPerTokenOverride in models.seed.yaml to the confirmed value"
            )
        else:
            overrides["kvCacheBytesPerToken"] = kv

    if seed_model.kvCacheFixedBytesOverride is not None:
        overrides["kvCacheFixedBytes"] = seed_model.kvCacheFixedBytesOverride
    elif kv_fixed is not None:
        if previous_kv_fixed is not None and previous_kv_fixed != kv_fixed:
            overrides["kvCacheFixedBytes"] = previous_kv_fixed
            divergences.append(
                f"HF config now derives kvCacheFixedBytes={kv_fixed}, which disagrees with "
                f"the committed value {previous_kv_fixed}; kept {previous_kv_fixed}. Verify by "
                "hand and set kvCacheFixedBytesOverride in models.seed.yaml to the confirmed value"
            )
        elif kv_fixed != 0 or previous_kv_fixed is not None:
            # Skip writing a zero fixed component for an ordinary
            # (non-hybrid-attention) model — the field simply doesn't apply,
            # rather than every homogeneous model in the catalog carrying an
            # explicit kvCacheFixedBytes: 0. Still written when there's a
            # previously-committed value to preserve (even a zero one).
            overrides["kvCacheFixedBytes"] = kv_fixed

    if arch.is_moe != (seed_model.modelType == "moe"):
        logger.warning(
            "{}: HF config suggests modelType={}, seed says {} — keeping seed value, please review",
            seed_model.id,
            "moe" if arch.is_moe else "dense",
            seed_model.modelType,
        )

    return overrides, None, divergences


def build(seed: list[SeedModel], previous: dict[str, dict[str, Any]]) -> BuildResult:
    records: list[dict[str, Any]] = []
    gaps: list[Gap] = []

    for seed_model in seed:
        prior = previous.get(seed_model.id)
        base = seed_model.model_dump(
            exclude={
                "hfRepoId",
                "contextWindowTokensOverride",
                "kvCacheBytesPerTokenOverride",
                "kvCacheFixedBytesOverride",
            },
            exclude_none=True,
        )
        overrides, pull_failure, divergences = _refresh_fields(seed_model, prior)
        candidate = {**base, **overrides}

        issues = validate_record(candidate)
        if not issues:
            records.append(candidate)
            if pull_failure:
                gaps.append(
                    Gap(
                        seed_model.id,
                        f"HF pull failed ({pull_failure}); used seed/previous values",
                        "carried-forward-stale",
                    )
                )
            for note in divergences:
                gaps.append(Gap(seed_model.id, note, "carried-forward-stale"))
            continue

        # Merged record is invalid — fall back to the previously committed
        # entry rather than publish something that would fail npm test.
        # Report the HF pull failure when there was one: it's the actual
        # root cause, and "invalid merged record" alone would hide it.
        reason = (
            f"HF pull failed ({pull_failure}), and no seed/previous fallback covers "
            f"the gap ({'; '.join(issues)})"
            if pull_failure
            else f"invalid merged record ({'; '.join(issues)})"
        )
        if prior is not None:
            records.append(prior)
            gaps.append(Gap(seed_model.id, reason, "carried-forward-stale"))
        else:
            gaps.append(
                Gap(seed_model.id, f"{reason}, and no previous entry to fall back on", "excluded")
            )

    return BuildResult(records=records, gaps=gaps)


def _write_gaps_report(gaps: list[Gap], path: Path = GAPS_REPORT_PATH) -> None:
    if not gaps:
        path.unlink(missing_ok=True)
        return
    lines = [f"HF sync gaps report — {date.today().isoformat()}", ""]
    for gap in gaps:
        lines.append(f"[{gap.action}] {gap.model_id}: {gap.reason}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    logger.warning("Wrote {} ({} gaps)", path, len(gaps))


def _write_models_json(records: list[dict[str, Any]], path: Path = MODELS_JSON_PATH) -> None:
    previous_envelope = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    source = previous_envelope.get("source", {})
    methodology = source.get("methodology", "")
    if METHODOLOGY_SUFFIX not in methodology:
        source["methodology"] = methodology + METHODOLOGY_SUFFIX

    envelope = {
        "schemaVersion": 1,
        "catalogId": "models",
        "lastUpdated": date.today().isoformat(),
        "source": source,
        "data": records,
    }
    path.write_text(json.dumps(envelope, indent=2) + "\n", encoding="utf-8")
    logger.success("Wrote {} ({} models)", path, len(records))


def _bump_manifest(path: Path = MANIFEST_PATH) -> None:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    today = date.today().isoformat()
    manifest["lastUpdated"] = today
    manifest["dataVersion"] = f"{today}-hf-sync"
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    logger.success("Bumped {} to dataVersion {}", path, manifest["dataVersion"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build and validate in memory, print a summary, but don't write any files.",
    )
    args = parser.parse_args()

    seed = load_seed()
    previous = _load_previous_records()
    result = build(seed, previous)

    if args.dry_run:
        logger.info("[dry-run] {} models, {} gaps", len(result.records), len(result.gaps))
        for gap in result.gaps:
            logger.warning("[dry-run] [{}] {}: {}", gap.action, gap.model_id, gap.reason)
        return 1 if any(g.action == "excluded" for g in result.gaps) else 0

    _write_models_json(result.records)
    _bump_manifest()
    _write_gaps_report(result.gaps)

    return 1 if any(g.action == "excluded" for g in result.gaps) else 0


if __name__ == "__main__":
    raise SystemExit(main())
