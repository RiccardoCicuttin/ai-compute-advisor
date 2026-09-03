"""kv_cache_bytes_per_token validated against real, published HF configs.

These aren't synthetic numbers: llama-3.1-8b and llama-3.1-70b are the exact
config.json contents publicher-side for meta-llama/Llama-3.1-8B and
meta-llama/Llama-3.1-70B (mirrored from llm-specs-pipeline's already-pulled
cache). The expected kvCacheBytesPerToken values are copied verbatim from
this app's own currently committed public/data/models.json (llama-3.2-3b-instruct
and llama-3.1-70b-instruct entries) — i.e. this test checks the formula against
values a human already authored and shipped, not against a number this
formula produced itself.
"""

from __future__ import annotations

import json
from pathlib import Path

from hf_sync.architecture import extract_architecture, kv_cache_bytes_per_token, kv_cache_model

CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache" / "hf_configs"


def _load_cached_config(filename: str) -> dict[str, object]:
    return json.loads((CACHE_DIR / filename).read_text(encoding="utf-8"))


LLAMA_3_1_8B_CONFIG = {
    "architectures": ["LlamaForCausalLM"],
    "hidden_size": 4096,
    "intermediate_size": 14336,
    "max_position_embeddings": 131072,
    "model_type": "llama",
    "num_attention_heads": 32,
    "num_hidden_layers": 32,
    "num_key_value_heads": 8,
    "torch_dtype": "bfloat16",
    "vocab_size": 128256,
}

LLAMA_3_1_70B_CONFIG = {
    "architectures": ["LlamaForCausalLM"],
    "hidden_size": 8192,
    "intermediate_size": 28672,
    "max_position_embeddings": 131072,
    "model_type": "llama",
    "num_attention_heads": 64,
    "num_hidden_layers": 80,
    "num_key_value_heads": 8,
    "torch_dtype": "bfloat16",
    "vocab_size": 128256,
}

# Llama 3.2 3B Instruct's public config (hidden_size=3072, 24 heads -> head_dim
# 128 via the hidden_dim/n_heads_q fallback, since Llama configs don't publish
# head_dim explicitly).
LLAMA_3_2_3B_CONFIG = {
    "hidden_size": 3072,
    "intermediate_size": 8192,
    "max_position_embeddings": 131072,
    "num_attention_heads": 24,
    "num_hidden_layers": 28,
    "num_key_value_heads": 8,
}


def test_kv_cache_matches_committed_llama_3_1_70b_instruct() -> None:
    arch = extract_architecture(LLAMA_3_1_70B_CONFIG)
    assert (
        kv_cache_bytes_per_token(arch) == 327680
    )  # public/data/models.json: llama-3.1-70b-instruct


def test_kv_cache_matches_committed_llama_3_2_3b_instruct() -> None:
    arch = extract_architecture(LLAMA_3_2_3B_CONFIG)
    assert (
        kv_cache_bytes_per_token(arch) == 114688
    )  # public/data/models.json: llama-3.2-3b-instruct


def test_head_dim_falls_back_to_hidden_dim_over_heads() -> None:
    arch = extract_architecture(LLAMA_3_1_8B_CONFIG)
    assert arch.head_dim is None
    assert arch.effective_head_dim == 128  # 4096 / 32


def test_context_length_extracted() -> None:
    arch = extract_architecture(LLAMA_3_1_8B_CONFIG)
    assert arch.context_length == 131072


def test_returns_none_when_architecture_fields_missing() -> None:
    arch = extract_architecture({"model_type": "some-future-format"})
    assert kv_cache_bytes_per_token(arch) is None


def test_nested_config_is_searched() -> None:
    wrapped = {"text_config": LLAMA_3_1_8B_CONFIG, "vision_config": {"hidden_size": 1024}}
    arch = extract_architecture(wrapped)
    assert arch.n_layers == 32
    assert arch.context_length == 131072


def test_moe_detected_from_expert_count() -> None:
    arch = extract_architecture({**LLAMA_3_1_8B_CONFIG, "num_local_experts": 8})
    assert arch.is_moe is True


def test_homogeneous_architecture_kv_cache_model_has_no_fixed_component() -> None:
    # No layer_types/sliding_window in this config, so kv_cache_model must
    # reduce to exactly the flat formula kv_cache_bytes_per_token computes —
    # the two-term model must not change behavior for ordinary architectures.
    arch = extract_architecture(LLAMA_3_1_70B_CONFIG)
    model = kv_cache_model(arch)
    assert model is not None
    assert model.bytes_per_token == 327680
    assert model.bytes_fixed == 0.0


# google/gemma-4-31B-it's published config.json (pipeline/.cache/hf_configs/
# google__gemma-4-31B-it.json): 60 layers, 5:1 sliding:full-attention ratio
# (50 sliding, 10 full), sliding_window=1024, and — this is what the flat
# formula misses — full-attention layers use a *different* head config
# (num_global_key_value_heads=4, global_head_dim=512) than the sliding
# layers (num_key_value_heads=16, head_dim=256).
GEMMA_4_31B_CONFIG = _load_cached_config("google__gemma-4-31B-it.json")

# google/gemma-4-26b-a4b-it (MoE): 30 layers, same 5:1 ratio (25 sliding, 5
# full), sliding_window=1024, num_global_key_value_heads=2, global_head_dim=512.
GEMMA_4_26B_A4B_CONFIG = _load_cached_config("google__gemma-4-26b-a4b-it.json")


def test_gemma_4_31b_kv_cache_model_splits_linear_and_fixed_terms() -> None:
    arch = extract_architecture(GEMMA_4_31B_CONFIG)
    assert arch.layer_types is not None
    assert arch.layer_types.count("full_attention") == 10
    assert arch.layer_types.count("sliding_attention") == 50
    assert arch.sliding_window == 1024

    model = kv_cache_model(arch)
    assert model is not None
    # 10 full-attention layers * 4 global KV heads * 512 global head_dim:
    # bytes/token = 2*10*4*512*2 = 81920 — the flat formula's own 983040
    # figure (2*60*16*256*2, pricing every layer as full attention with the
    # sliding layers' head config) overstates this by ~12x.
    assert model.bytes_per_token == 81920
    # 50 sliding-attention layers, capped at the 1024-token window:
    # 2*50*16*256*2*1024 = 838860800 bytes (800 MiB), fixed regardless of
    # how long the actual context is.
    assert model.bytes_fixed == 838860800

    # The flat (backward-compatible) accessor must still return only the
    # linear component, not the old inflated whole-model value.
    assert kv_cache_bytes_per_token(arch) == 81920


def test_gemma_4_26b_a4b_kv_cache_model_splits_linear_and_fixed_terms() -> None:
    arch = extract_architecture(GEMMA_4_26B_A4B_CONFIG)
    assert arch.layer_types is not None
    assert arch.layer_types.count("full_attention") == 5
    assert arch.layer_types.count("sliding_attention") == 25
    assert arch.sliding_window == 1024

    model = kv_cache_model(arch)
    assert model is not None
    # 5 full-attention layers * 2 global KV heads * 512 global head_dim:
    # bytes/token = 2*5*2*512*2 = 20480.
    assert model.bytes_per_token == 20480
    # 25 sliding-attention layers, capped at the 1024-token window:
    # 2*25*8*256*2*1024 = 209715200 bytes (200 MiB).
    assert model.bytes_fixed == 209715200


# deepseek-ai/DeepSeek-R1's published config.json (pipeline/.cache/hf_configs/
# deepseek-ai__DeepSeek-R1.json): Multi-head Latent Attention (model_type
# deepseek_v3). num_key_value_heads (128) equals num_attention_heads here —
# a red herring left over from the base transformers config schema, not a
# real GQA split — because MLA doesn't cache per-head K/V at all; it caches
# a compressed low-rank latent per token (kv_lora_rank=512) plus a decoupled
# RoPE component (qk_rope_head_dim=64), independent of head count.
DEEPSEEK_R1_CONFIG = _load_cached_config("deepseek-ai__DeepSeek-R1.json")


def test_mla_detected_from_kv_lora_rank() -> None:
    arch = extract_architecture(DEEPSEEK_R1_CONFIG)
    assert arch.kv_lora_rank == 512
    assert arch.qk_rope_head_dim == 64
    assert arch.is_mla is True


def test_non_mla_config_is_not_flagged_mla() -> None:
    arch = extract_architecture(LLAMA_3_1_8B_CONFIG)
    assert arch.kv_lora_rank is None
    assert arch.is_mla is False


def test_mla_kv_cache_model_uses_latent_rank_not_per_head_formula() -> None:
    # kv_cache_model() must not apply the standard per-KV-head formula to
    # num_key_value_heads=128 / head_dim=56 (hidden_size/n_heads fallback) —
    # that combination is meaningless for MLA and previously produced a
    # wrong committed value (kvCacheBytesPerToken=1748992 for
    # deepseek-r1-671b in public/data/models.json). MLA caches one
    # compressed latent per token per layer instead: kv_lora_rank(512) +
    # qk_rope_head_dim(64) = 576 elements, BF16 (2 bytes), 61 layers:
    #   61 * 576 * 2 = 70272 bytes/token, uniform across layers (no fixed
    # component — MLA doesn't have windowed/full-attention layers to split).
    arch = extract_architecture(DEEPSEEK_R1_CONFIG)
    model = kv_cache_model(arch)
    assert model is not None
    assert model.bytes_per_token == 70272
    assert model.bytes_fixed == 0.0
    assert kv_cache_bytes_per_token(arch) == 70272


def test_unclassifiable_layer_types_falls_back_to_homogeneous_formula() -> None:
    # A layer_types value using a convention this catalog hasn't seen yet
    # (neither "full"/"global" nor "sliding"/"local"/"window") must not be
    # guessed at — fall back to treating every layer as full-attention,
    # exactly like a config with no layer_types at all.
    cfg = {**LLAMA_3_1_8B_CONFIG, "layer_types": ["mystery_attention"] * 32, "sliding_window": 4096}
    arch = extract_architecture(cfg)
    model = kv_cache_model(arch)
    assert model is not None
    assert model.bytes_fixed == 0.0
    assert model.bytes_per_token == kv_cache_bytes_per_token(
        extract_architecture(LLAMA_3_1_8B_CONFIG)
    )
