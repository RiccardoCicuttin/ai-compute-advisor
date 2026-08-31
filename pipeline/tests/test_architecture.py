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

from hf_sync.architecture import extract_architecture, kv_cache_bytes_per_token

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
