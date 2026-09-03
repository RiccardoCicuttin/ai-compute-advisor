"""Extract architecture fields from a raw HF config.json and derive the
hardware-relevant catalog fields from them.

The field-candidate lookup is ported from llm-specs-pipeline's
clean/parse_hf_configs.py: different model families spell the same concept
differently (num_hidden_layers vs n_layer vs n_layers, ...), and some
multimodal releases nest the real decoder config under a wrapper key.
"""

from __future__ import annotations

from dataclasses import dataclass

# Canonical name -> HF config keys to try, in order.
FIELD_CANDIDATES: dict[str, list[str]] = {
    "n_layers": ["num_hidden_layers", "n_layer", "n_layers", "num_layers"],
    "hidden_dim": ["hidden_size", "d_model", "n_embd", "dim"],
    "n_heads_q": ["num_attention_heads", "n_head", "num_heads", "n_heads"],
    "n_heads_kv": [
        "num_key_value_heads",
        "n_kv_heads",
        "num_kv_heads",
        "num_multi_query_heads",
    ],
    "head_dim": ["head_dim", "d_head"],
    "context_length": [
        "max_position_embeddings",
        "max_sequence_length",
        "n_positions",
        "seq_length",
        "max_seq_len",
    ],
    "n_experts": [
        "num_experts",
        "num_local_experts",
        "n_routed_experts",
        "moe_num_experts",
        "num_experts_total",
    ],
    # Per-layer attention-type list for hybrid local/global-attention models
    # (Gemma 3/4's config.json spells it "layer_types"; no other spelling has
    # been observed in this catalog's repos yet — add one here, not guessed,
    # once a config using a different key turns up).
    "layer_types": ["layer_types"],
    "sliding_window": ["sliding_window"],
    # Full/global-attention layers can use a different head count/dim than
    # the windowed layers (Gemma splits these); absent in configs that don't
    # make that split, in which case the windowed-layer config is reused.
    "global_n_heads_kv": ["num_global_key_value_heads"],
    "global_head_dim": ["global_head_dim"],
    # Multi-head Latent Attention (DeepSeek-V2/V3/R1): the cache holds a
    # compressed low-rank latent per token, not per-KV-head K/V vectors, so
    # num_key_value_heads/head_dim above don't describe its cache shape at
    # all. kv_lora_rank's presence is the signal that a config is MLA;
    # num_key_value_heads and head_dim must not be used for these configs.
    "kv_lora_rank": ["kv_lora_rank"],
    "qk_rope_head_dim": ["qk_rope_head_dim"],
}

NESTED_CONFIG_KEYS = (
    "text_config",
    "language_config",
    "model_config",
    "llm_config",
    "decoder_config",
)

# Fields that signal a state-space/Mamba-family architecture, a linear/
# recurrent-attention hybrid (e.g. Qwen3-Next/3.5/3.6's Gated DeltaNet-style
# layers, whose config carries linear_key_head_dim/linear_num_key_heads/
# linear_value_head_dim/linear_conv_kernel_dim), a chunked-local + NoPE
# hybrid (Llama 4's attention_chunk_size/no_rope_layers), or any other
# architecture we haven't built a kv_cache_model() formula for yet. Unlike
# FIELD_CANDIDATES, this isn't about extracting a value — the field names
# themselves are the signal, checked by exact match or (for the ssm_/mamba_/
# linear_ families) by prefix, on both the top-level config and any nested
# one.
NOVEL_ARCHITECTURE_SIGNAL_FIELDS = (
    "state_size",
    "mamba_expand",
    "ssm_cfg",
    "attention_chunk_size",
    "no_rope_layers",
)
NOVEL_ARCHITECTURE_SIGNAL_PREFIXES = ("ssm_", "mamba_", "linear_")


def _get_field(cfg: dict[str, object], candidates: list[str]) -> object:
    for key in candidates:
        if key in cfg:
            return cfg[key]
    for nest_key in NESTED_CONFIG_KEYS:
        nested = cfg.get(nest_key)
        if isinstance(nested, dict):
            for key in candidates:
                if key in nested:
                    return nested[key]
    return None


def _as_int(value: object) -> int | None:
    return int(value) if isinstance(value, (int, float)) else None


def _as_layer_types(value: object) -> tuple[str, ...] | None:
    if not isinstance(value, list) or not value:
        return None
    if not all(isinstance(item, str) for item in value):
        return None
    return tuple(value)


def _detect_novel_architecture_fields(cfg: dict[str, object]) -> tuple[str, ...]:
    """Scans the raw config (and any nested sub-config) for field names that
    signal an architecture kv_cache_model() has no formula for yet.

    This deliberately doesn't try to interpret the fields' values — their
    mere presence is the signal, the same way kv_lora_rank's presence alone
    (not its value) signals MLA. Returns the field names found, in the order
    first seen, for use in the gap message; an empty tuple means no signal.
    """
    found: list[str] = []
    configs = [cfg] + [
        nested for nest_key in NESTED_CONFIG_KEYS if isinstance(nested := cfg.get(nest_key), dict)
    ]
    for config in configs:
        for key in config:
            is_signal = isinstance(key, str) and (
                key in NOVEL_ARCHITECTURE_SIGNAL_FIELDS
                or key.startswith(NOVEL_ARCHITECTURE_SIGNAL_PREFIXES)
            )
            if is_signal and key not in found:
                found.append(key)
    return tuple(found)


@dataclass(frozen=True)
class Architecture:
    n_layers: int | None
    hidden_dim: int | None
    n_heads_q: int | None
    n_heads_kv: int | None
    head_dim: int | None
    context_length: int | None
    is_moe: bool
    layer_types: tuple[str, ...] | None
    sliding_window: int | None
    global_n_heads_kv: int | None
    global_head_dim: int | None
    kv_lora_rank: int | None
    qk_rope_head_dim: int | None
    novel_architecture_fields: tuple[str, ...]

    @property
    def is_mla(self) -> bool:
        """True for Multi-head Latent Attention configs (DeepSeek-V2/V3/R1).

        kv_lora_rank's presence is the signal: MLA caches a compressed
        latent per token instead of per-KV-head K/V vectors, so
        effective_kv_heads/effective_head_dim below don't apply to it.
        """
        return self.kv_lora_rank is not None

    @property
    def effective_kv_heads(self) -> int | None:
        """Falls back to n_heads_q when the config has no GQA/MQA split."""
        return self.n_heads_kv if self.n_heads_kv is not None else self.n_heads_q

    @property
    def effective_head_dim(self) -> int | None:
        """head_dim isn't in every config family; derive it when absent."""
        if self.head_dim is not None:
            return self.head_dim
        if self.hidden_dim is not None and self.n_heads_q:
            return self.hidden_dim // self.n_heads_q
        return None


def extract_architecture(cfg: dict[str, object]) -> Architecture:
    values = {name: _get_field(cfg, candidates) for name, candidates in FIELD_CANDIDATES.items()}
    return Architecture(
        n_layers=_as_int(values["n_layers"]),
        hidden_dim=_as_int(values["hidden_dim"]),
        n_heads_q=_as_int(values["n_heads_q"]),
        n_heads_kv=_as_int(values["n_heads_kv"]),
        head_dim=_as_int(values["head_dim"]),
        context_length=_as_int(values["context_length"]),
        is_moe=values["n_experts"] is not None,
        layer_types=_as_layer_types(values["layer_types"]),
        sliding_window=_as_int(values["sliding_window"]),
        global_n_heads_kv=_as_int(values["global_n_heads_kv"]),
        global_head_dim=_as_int(values["global_head_dim"]),
        kv_lora_rank=_as_int(values["kv_lora_rank"]),
        qk_rope_head_dim=_as_int(values["qk_rope_head_dim"]),
        novel_architecture_fields=_detect_novel_architecture_fields(cfg),
    )


def _classify_layer_types(layer_types: tuple[str, ...] | None) -> tuple[int, int] | None:
    """Splits a per-layer attention-type list into (n_windowed, n_unwindowed).

    Classification is by substring, not an exact enum: HF config families
    spell this differently (Gemma's layer_types uses "full_attention" /
    "sliding_attention"). A type containing "full" or "global" is unwindowed
    (attends over the whole context); one containing "sliding", "local", or
    "window" is windowed (its KV cache caps out at the model's window size).
    Any entry that matches neither means this config's convention isn't
    understood yet (e.g. Qwen3.5/3.6's "linear_attention" recurrent layers),
    and the whole list is treated as unclassifiable — the caller must refuse
    to guess rather than fall back to the homogeneous-architecture formula,
    since silently pricing an unrecognized layer type as full-attention can
    be wrong in either direction.
    """
    if layer_types is None:
        return None
    n_windowed = 0
    n_unwindowed = 0
    for layer_type in layer_types:
        lowered = layer_type.lower()
        if "full" in lowered or "global" in lowered:
            n_unwindowed += 1
        elif "sliding" in lowered or "local" in lowered or "window" in lowered:
            n_windowed += 1
        else:
            return None
    return n_windowed, n_unwindowed


@dataclass(frozen=True)
class KvCacheModel:
    """KV-cache footprint decomposed by whether it scales with context length.

    bytes_per_token scales linearly with the actual context length in use —
    contributed only by layers that attend over the whole sequence.
    bytes_fixed is a constant, contributed by windowed (sliding/local
    -attention) layers: their cache caps out at the layer's own window size
    and stops growing once context exceeds it, so it does not belong in a
    per-token rate.

    For an architecture with no detected windowed/unwindowed split,
    bytes_fixed is 0 and bytes_per_token is exactly the flat formula below —
    homogeneous architectures (the common case) are computed identically to
    before this model existed.
    """

    bytes_per_token: float
    bytes_fixed: float


def kv_cache_model(arch: Architecture, bytes_per_element: float = 2.0) -> KvCacheModel | None:
    """KV-cache footprint per model, split into a linear and a fixed term.

    Homogeneous case — every layer attends over the full context, one K and
    one V vector cached per layer per KV head:
        bytes/token = 2 (K and V) * n_layers * n_kv_heads * head_dim * bytes_per_element

    bytes_per_element defaults to 2 (bf16/fp16), matching this catalog's
    existing convention of sizing the KV cache independent of the weight
    quantization (see AGENTS.md: fit is derived from weights plus configured
    KV-cache/runtime/safety overhead).

    The homogeneous formula overstates the true cost for hybrid local/global
    -attention architectures (e.g. Gemma 3/4's config, which interleaves a
    minority of full-attention layers among sliding-window layers capped at
    a small window): it prices every layer as if it were full-attention over
    the entire context. When the config exposes a classifiable layer_types
    split and a sliding_window size, this instead prices:
      - unwindowed (full/global) layers as a per-token rate, using their own
        head config when the config splits one out (Gemma's
        num_global_key_value_heads/global_head_dim), else the regular one;
      - windowed layers as a one-time cost capped at sliding_window tokens,
        using the regular head config.

    Validated against the two dense Llama 3.1 entries already committed to
    public/data/models.json, and against Gemma 4's own published configs —
    see tests/test_architecture.py for both.

    Returns None when the config doesn't expose enough architecture fields
    to compute it (e.g. n_layers or head_dim missing), or when it exposes a
    layer_types split this function can't fully resolve — an unrecognized
    per-layer attention-type convention, or a recognized windowed component
    with no sliding_window size to cap it at — since guessing there risks a
    silently wrong number in either direction. Callers must treat None as
    "leave the existing value alone", never as zero.
    """
    if arch.novel_architecture_fields:
        # State-space/Mamba-family fields (or any other architecture we
        # haven't built a formula for) don't cache per-head K/V at all — an
        # SSM carries a fixed-size recurrent state instead, which this
        # formula (and the MLA one below) both assume isn't the case. Same
        # discipline as MLA before its formula existed: refuse to guess:
        # the caller must treat this exactly like "not enough info yet".
        return None

    if arch.is_mla:
        # DeepSeek-V2/V3/R1 (Multi-head Latent Attention): num_key_value_heads
        # and head_dim above do not describe this architecture's cache shape
        # and must not be used here. See Architecture.is_mla.
        if arch.n_layers is None or arch.kv_lora_rank is None or arch.qk_rope_head_dim is None:
            return None
        # MLA compresses K and V into one shared low-rank latent per token
        # per layer (kv_lora_rank) plus a decoupled RoPE component
        # (qk_rope_head_dim) — there's no separate K and V to cache, so
        # unlike the standard formula below, bytes_per_element here is
        # purely the dtype size (BF16 = 2 bytes/element), not a "times 2 for
        # K and V" factor. Uniform across layers, so no fixed/windowed term.
        bytes_per_token = (
            arch.n_layers * (arch.kv_lora_rank + arch.qk_rope_head_dim) * bytes_per_element
        )
        return KvCacheModel(bytes_per_token=bytes_per_token, bytes_fixed=0.0)

    kv_heads = arch.effective_kv_heads
    head_dim = arch.effective_head_dim
    if arch.n_layers is None or kv_heads is None or head_dim is None:
        return None

    if arch.layer_types is None:
        # No hybrid-attention signal at all — ordinary homogeneous
        # architecture, computed exactly as before this model existed.
        return KvCacheModel(
            bytes_per_token=2 * arch.n_layers * kv_heads * head_dim * bytes_per_element,
            bytes_fixed=0.0,
        )

    classification = _classify_layer_types(arch.layer_types)
    if classification is None:
        # layer_types is present but uses a convention _classify_layer_types
        # doesn't recognize — refuse to guess rather than silently pricing
        # every layer as full-attention (see _classify_layer_types).
        return None

    n_windowed, n_unwindowed = classification
    if n_windowed > 0 and arch.sliding_window is None:
        # There's a recognized windowed component but no window size to cap
        # its fixed cost at — can't safely compute bytes_fixed, so refuse
        # rather than guess.
        return None

    global_kv_heads = arch.global_n_heads_kv if arch.global_n_heads_kv is not None else kv_heads
    global_head_dim = arch.global_head_dim if arch.global_head_dim is not None else head_dim
    sliding_window = arch.sliding_window if arch.sliding_window is not None else 0

    bytes_per_token = 2 * n_unwindowed * global_kv_heads * global_head_dim * bytes_per_element
    bytes_fixed = 2 * n_windowed * kv_heads * head_dim * bytes_per_element * sliding_window
    return KvCacheModel(bytes_per_token=bytes_per_token, bytes_fixed=bytes_fixed)


def kv_cache_bytes_per_token(arch: Architecture, bytes_per_element: float = 2.0) -> float | None:
    """Backward-compatible accessor for just the context-scaling component.

    Equal to kv_cache_model(arch, bytes_per_element).bytes_per_token; see
    that function for the full model, including the fixed component that
    hybrid-attention architectures need and this alone can't represent.
    """
    model = kv_cache_model(arch, bytes_per_element)
    return model.bytes_per_token if model is not None else None
