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
}

NESTED_CONFIG_KEYS = (
    "text_config",
    "language_config",
    "model_config",
    "llm_config",
    "decoder_config",
)


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


@dataclass(frozen=True)
class Architecture:
    n_layers: int | None
    hidden_dim: int | None
    n_heads_q: int | None
    n_heads_kv: int | None
    head_dim: int | None
    context_length: int | None
    is_moe: bool

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
    )


def kv_cache_bytes_per_token(arch: Architecture, bytes_per_element: float = 2.0) -> float | None:
    """KV-cache footprint per token, per model, in bytes.

    One K vector and one V vector are cached per layer per KV head:
        bytes/token = 2 (K and V) * n_layers * n_kv_heads * head_dim * bytes_per_element

    bytes_per_element defaults to 2 (bf16/fp16), matching this catalog's
    existing convention of sizing the KV cache independent of the weight
    quantization (see AGENTS.md: fit is derived from weights plus configured
    KV-cache/runtime/safety overhead).

    Validated against the two dense Llama 3.1 entries already committed to
    public/data/models.json (see tests/test_architecture.py): both reproduce
    the catalog's existing kvCacheBytesPerToken values exactly from their
    published HF configs, which is the strongest evidence available that the
    formula and byte convention match this app's authoring practice.

    Returns None when the config doesn't expose enough architecture fields
    to compute it (e.g. n_layers or head_dim missing) — callers must treat
    that as "leave the existing value alone", never as zero.
    """
    kv_heads = arch.effective_kv_heads
    head_dim = arch.effective_head_dim
    if arch.n_layers is None or kv_heads is None or head_dim is None:
        return None
    return 2 * arch.n_layers * kv_heads * head_dim * bytes_per_element
