"""Load and validate models.seed.yaml.

The seed file is the editorial source of truth for *which* models are
tracked and for the fields Hugging Face's config.json cannot supply
(capability tier, license/commercial-use terms, quantization presets,
display name, notes). build_catalog.py refreshes the architecture-derived
fields (context window, KV-cache bytes per token) on top of whatever a
seed row provides; nothing here is inferred or guessed.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field, model_validator

SEED_PATH = Path(__file__).resolve().parent.parent.parent / "models.seed.yaml"


class QuantizationProfile(BaseModel):
    id: str
    label: str
    bitsPerParameter: float = Field(gt=0, le=32)
    packingOverheadRatio: float = Field(ge=0, le=1)


class SeedModel(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9._-]*$")
    hfRepoId: str
    name: str
    provider: str
    family: str | None = None
    modelType: Literal["dense", "moe"]
    totalParametersB: float = Field(gt=0)
    activeParametersB: float = Field(gt=0)
    maxOutputTokens: int | None = Field(default=None, gt=0)
    recommendedQuantizationId: str
    quantizations: list[QuantizationProfile] = Field(min_length=1)
    capabilityTierId: str
    reasoning: bool
    modalities: list[Literal["text", "image", "audio", "video"]] = Field(min_length=1)
    openWeight: bool
    commercialUse: Literal["allowed", "restricted", "unknown"]
    notes: str | None = None

    # Fallback values used only when the HF pull fails or the config lacks
    # the field. Once a live pull succeeds these are superseded, never
    # overwritten in the seed file itself.
    contextWindowTokens: int | None = Field(default=None, gt=0)
    kvCacheBytesPerToken: float | None = Field(default=None, gt=0)
    kvCacheFixedBytes: float | None = Field(default=None, ge=0)

    # Manual pin that always wins over a live HF pull, unlike the fallback
    # above. Some repos' config.json reports a context length that doesn't
    # match the model's documented/supported context window (a RoPE-scaling
    # ceiling rather than the vendor-validated figure, or a value that
    # requires a config change the vendor documents but doesn't ship by
    # default) — see pipeline/gaps_report.txt when build_catalog flags one.
    # Set this by hand after checking the model's actual HF README/model
    # card, not config.json.
    contextWindowTokensOverride: int | None = Field(default=None, gt=0)

    # Same escape hatch as contextWindowTokensOverride, for kvCacheBytesPerToken
    # and kvCacheFixedBytes. build_catalog.py derives both from the model's HF
    # config via hf_sync.architecture.kv_cache_model, which is layer-type-aware
    # for hybrid local/global-attention architectures (e.g. a config with a
    # sliding_window and a per-layer layer_types split); set these by hand only
    # if that derivation needs correcting.
    kvCacheBytesPerTokenOverride: float | None = Field(default=None, gt=0)
    kvCacheFixedBytesOverride: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _check_consistency(self) -> SeedModel:
        if self.activeParametersB > self.totalParametersB:
            raise ValueError(f"{self.id}: activeParametersB exceeds totalParametersB")
        if self.modelType == "dense" and self.activeParametersB != self.totalParametersB:
            raise ValueError(
                f"{self.id}: dense models must have activeParametersB == totalParametersB"
            )
        ids = [q.id for q in self.quantizations]
        if len(set(ids)) != len(ids):
            raise ValueError(f"{self.id}: duplicate quantization ids")
        if self.recommendedQuantizationId not in ids:
            raise ValueError(f"{self.id}: recommendedQuantizationId must reference a quantization")
        return self


def load_seed(path: Path = SEED_PATH) -> list[SeedModel]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    models = raw.get("models", []) if isinstance(raw, dict) else raw
    seed = [SeedModel.model_validate(entry) for entry in models]

    ids = [m.id for m in seed]
    if len(set(ids)) != len(ids):
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        raise ValueError(f"Duplicate ids in {path}: {dupes}")

    return seed
