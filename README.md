# AI Compute Advisor

[简体中文](#简体中文) · [Live Calculator](https://joyzhou123123.github.io/ai-compute-advisor/)

AI Compute Advisor is a pre-sales deployment advisor for matching open-weight models to available devices. It supports both directions of work:

- **Find Hardware for Model**: choose a model, quantization, context, concurrency, and service target, then review eligible device deployment options.
- **Find Models for Hardware**: start from available devices and derive capacity-fit models, remaining VRAM, deployment constraints, and validation requirements.

The calculator is designed for explainable proposal work. It separates model weights, KV Cache, runtime safety headroom, AI accelerator tiering, and device capacity so that a pre-sales engineer can explain the basis of a recommendation.

## Data-source policy

- **Models**: Hugging Face is the authoritative model-directory source. Model cards, configuration, context limits, license, and revisions should be synchronized from official Hugging Face repositories.
- **Hardware**: GPU and platform specifications are maintained from official vendor sources. VRAM bandwidth, peak AI TOPS, precision label, and TDP are hardware metadata only. AI TOPS must not be converted directly into LLM TPS.
- **Performance**: TPS, TTFT, and maximum concurrency require a matching model-device-runtime profile or measurement. Missing evidence is shown as pending rather than inferred.

## Using the calculator

1. Open the [Live Calculator](https://joyzhou123123.github.io/ai-compute-advisor/).
2. Select **Find Hardware for Model** to evaluate deployment options for a target model.
3. Select **Find Models for Hardware** to assess existing devices.
4. Enter context length and peak concurrency before treating a capacity result as a proposal basis.
5. Use the optional AI accelerator tier only when the selected runtime supports the required tiering path. The result distinguishes standard inference from AI-accelerated quantization and labels unverified runtime behavior.
6. Treat throughput and latency as proposal-ready only when a matching performance profile is recorded as measured.

## Local data and maintenance

The intended maintenance model is **official base data plus a local user overlay**:

- Engineering maintains the official model directory, standard device library, calculation rules, and verified performance records once.
- A user can keep customer-specific devices, prices, test results, and custom configurations locally without changing official recommendations.
- Every resulting option should identify whether it uses official data, a local custom configuration, or an unverified profile.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Production verification:

```bash
npm run check
```

## Model catalog: manual vs. automated

`public/data/models.json` is a **generated file** — don't hand-edit it. It's produced by `pipeline/`, a small Python job (`hf_sync`) that merges two kinds of data:

| Field group | Source | Edited by |
|---|---|---|
| Capability tier, license, commercial-use terms, quantization presets, display name, notes | `pipeline/models.seed.yaml` | A human, by hand |
| `contextWindowTokens`, `kvCacheBytesPerToken`, `kvCacheFixedBytes` | Each model's live Hugging Face `config.json` | The pipeline, automatically |

### What's automated

A weekly GitHub Actions workflow (`.github/workflows/sync-models.yml`, Mondays 06:00 UTC, or manual dispatch):

1. Installs the pipeline (`uv sync --project pipeline`) and runs its own lint/type/test suite.
2. Runs `python -m hf_sync.build_catalog`: for every model in `models.seed.yaml`, pulls `config.json` from its Hugging Face repo, derives `contextWindowTokens` and the KV-cache footprint from the architecture, and merges those onto the curated seed fields.
3. Re-validates the regenerated `models.json` against the app's own schema (`npm run lint && npm test && npm run build`) — this is the real gate, not the pipeline's own Python-side check.
4. If anything changed, opens a pull request with the diff and attaches `pipeline/gaps_report.txt` (see below) so a reviewer sees exactly what moved and why.

A model whose Hugging Face pull fails, or whose merged record fails validation, is never dropped or zeroed out — its previously committed entry is carried forward unchanged, and the reason is logged to `gaps_report.txt`. Nothing fails silently; a stale or misspelled `hfRepoId` shows up as a reported gap, not a missing or broken model.

**KV-cache footprint** (`kvCacheBytesPerToken`, plus `kvCacheFixedBytes` where it applies) is derived per-architecture, not a flat multiplier. Most models attend over the full context on every layer, so their KV cache is purely linear in tokens (`kvCacheBytesPerToken` only, `kvCacheFixedBytes` omitted). Hybrid local/global-attention architectures — Gemma 3/4 and gpt-oss are examples already in the catalog — cap most layers at a small sliding window and run only a minority over the full context. For those, the pipeline splits the estimate into a linear term (`kvCacheBytesPerToken`, from the full-attention layers) plus a fixed term (`kvCacheFixedBytes`, from the windowed layers, capped at the window size) instead of overstating the whole cache as linear. See `kv_cache_model()` in `pipeline/src/hf_sync/architecture.py` for the formula.

**Novel-architecture guard**: some architectures don't fit either formula above — state-space/Mamba-family models, hybrid attention with a linear/recurrent-attention component (e.g. Qwen3-Next-style Gated DeltaNet layers), or a chunked-local + NoPE split (Llama 4). The pipeline detects these by specific field names in the config (`state_size`, `mamba_expand`, `ssm_cfg`, `attention_chunk_size`, `no_rope_layers`, or any field prefixed `ssm_`, `mamba_`, or `linear_`) and refuses to derive a KV-cache value at all rather than misapply the wrong formula to it — it holds the previously committed value and logs `novel-looking architecture, pending formula review` to `gaps_report.txt`. Extending `kv_cache_model()` with a real formula for one of these families (and then removing the matching signal) is a deliberate, manual fix — the weekly sync will never do it on its own.

**Divergence guard**: if a freshly-derived `contextWindowTokens`, `kvCacheBytesPerToken`, or `kvCacheFixedBytes` disagrees with the value already committed in `models.json`, the pipeline does not silently overwrite it — it keeps the committed value and logs the disagreement to `gaps_report.txt` for a human to review. To force a specific value regardless of what the pipeline derives, set the matching field in `models.seed.yaml`: `contextWindowTokensOverride`, `kvCacheBytesPerTokenOverride`, or `kvCacheFixedBytesOverride`. An override always wins and is never reported as a gap.

### What's manual

To add, remove, or re-describe a tracked model, edit `pipeline/models.seed.yaml` by hand. Every field there except the architecture-derived ones above is editorial and is never touched by the pipeline:

- `id`, `hfRepoId`, `name`, `provider`, `family`
- `totalParametersB`, `activeParametersB`, `modelType` (`dense`/`moe`)
- `capabilityTierId`, `reasoning`, `modalities`, `openWeight`, `commercialUse`
- `recommendedQuantizationId` and the `quantizations` list
- `notes`
- Optionally, `contextWindowTokensOverride`, `kvCacheBytesPerTokenOverride`, `kvCacheFixedBytesOverride` — force a specific derived value when the divergence guard is holding back a value you know is correct (see above)

A new model needs every field filled in — the pipeline won't invent capability tier, license, or quantization data on your behalf. `hfRepoId` must be a real, correctly spelled Hugging Face repo id, or the sync will just log a gap and carry the previous entry forward (or exclude the model outright if there is no previous entry).

### Running the pipeline locally

```bash
cd pipeline
uv sync
uv run python -m hf_sync.build_catalog --dry-run   # validate + report only, writes nothing
uv run python -m hf_sync.build_catalog              # writes models.json, manifest.json, gaps_report.txt
```

Set `HF_TOKEN` in the environment to pull gated repos (e.g. `meta-llama/*`); without it, gated models silently fall back to their previous entry and show up as a gap instead of failing the run.

```bash
uv run ruff check src tests
uv run mypy
uv run pytest -q
```

After regenerating `models.json`, still run `npm run check` from the repo root before committing. `pipeline/src/hf_sync/catalog_schema.py` is a hand-maintained, defense-in-depth mirror of the real schema in `src/data/schemas/catalogSchemas.ts` — not a replacement for it.

---

## 简体中文

AI Compute Advisor 是面向售前的模型与设备部署顾问。它支持从模型反推设备，也支持从已有设备反推可部署模型，并把模型权重、KV Cache、运行时安全余量、AI 加速卡分层容量与设备余量分开呈现。

### 使用方式

1. 打开 [Live Calculator](https://joyzhou123123.github.io/ai-compute-advisor/)。
2. 在“模型找硬件”中选择模型、量化、上下文、峰值并发和服务目标，查看可行设备部署方案。
3. 在“硬件找模型”中选择已有设备与台数，查看可部署模型、显存余量、AI 加速量化能力与待验证项。
4. 没有同模型、同量化、同上下文、同运行时的性能资料时，TPS、TTFT 和最大并发必须显示为待测，不能做对外承诺。

### 数据规则

- 模型目录以 Hugging Face 官方仓库为唯一模型数据源。
- 显卡规格以 NVIDIA、AMD、Lenovo 等厂商官方来源为准。
- AI TOPS 仅作为硬件规格，不直接换算为 LLM TPS。
- 官方模型与设备库统一维护；用户可在本地保存客户设备、报价和实测数据，默认不回传或改写官方结论。

### 模型目录：人工维护与自动同步

`public/data/models.json` 是**自动生成的文件**，请勿手工编辑。它由 `pipeline/`（一个名为 `hf_sync` 的小型 Python 任务）合并两类数据生成：

- **人工维护**（`pipeline/models.seed.yaml`）：能力分级、许可证、商用条款、量化档位、显示名称、备注等编辑性字段。新增模型时必须手动填写全部字段，包括正确拼写的 `hfRepoId`；流水线不会替你猜测能力分级或许可证。此外还可以按需添加 `contextWindowTokensOverride`、`kvCacheBytesPerTokenOverride`、`kvCacheFixedBytesOverride`——当自动推导值被下方的“分歧保护”拦截、而你确认新值才是对的时，用它强制覆盖。
- **自动同步**：`contextWindowTokens`、`kvCacheBytesPerToken`（以及适用时的 `kvCacheFixedBytes`）来自模型在 Hugging Face 上的实时 `config.json`，由每周一 06:00 UTC 运行的 GitHub Actions 工作流（`.github/workflows/sync-models.yml`，也可手动触发）拉取、推导并合并到人工字段之上，再用 `npm run lint && npm test && npm run build` 做最终校验，通过后自动开 PR。

KV 缓存占用的推导按架构而定，不是固定倍数。多数模型每一层都对全部上下文做注意力计算，因此其 KV 缓存与 token 数量成线性关系（只有 `kvCacheBytesPerToken`，不含 `kvCacheFixedBytes`）。像 Gemma 3/4、gpt-oss 这类混合局部/全局注意力架构，大部分层只在一个较小的滑动窗口内计算注意力，只有少数层覆盖全部上下文；针对这类模型，流水线把估算拆成线性项（`kvCacheBytesPerToken`，来自全注意力层）加固定项（`kvCacheFixedBytes`，来自窗口层，按窗口大小封顶），而不是把整个缓存都按线性处理导致高估。具体公式见 `pipeline/src/hf_sync/architecture.py` 中的 `kv_cache_model()`。

**新架构保护**：部分架构不适用于以上任何一种公式——状态空间/Mamba 系列模型、带有线性/循环注意力分量的混合注意力结构（如 Qwen3-Next 风格的 Gated DeltaNet 层），或分块局部注意力 + NoPE 混合结构（Llama 4）。流水线通过配置中的特定字段名识别这些架构（`state_size`、`mamba_expand`、`ssm_cfg`、`attention_chunk_size`、`no_rope_layers`，或任何以 `ssm_`、`mamba_`、`linear_` 为前缀的字段），并拒绝为其推导 KV 缓存值，而不是套用错误的公式——会保留此前提交的值，并在 `gaps_report.txt` 中记录“novel-looking architecture, pending formula review”。为这些架构族实现真正的公式（并移除对应的信号字段）需要人工一次性修改，不会由每周自动同步完成。

**分歧保护**：如果新推导出的 `contextWindowTokens`、`kvCacheBytesPerToken` 或 `kvCacheFixedBytes` 与 `models.json` 中已提交的值不一致，流水线不会静默覆盖——会保留已提交的值，并把分歧记录到 `gaps_report.txt` 供人工复核。如需强制使用某个值，可在 `models.seed.yaml` 中设置对应的 override 字段，override 的值始终优先生效，且不会被记为 gap。

某个模型的 Hugging Face 拉取失败或合并后校验不通过时，不会被清零或从目录中移除——会保留上一次提交的记录，并把原因写入 `pipeline/gaps_report.txt`，不会静默失败。

本地运行：

```bash
cd pipeline
uv sync
uv run python -m hf_sync.build_catalog --dry-run   # 仅校验并生成报告，不写文件
uv run python -m hf_sync.build_catalog              # 写入 models.json、manifest.json、gaps_report.txt
```

拉取受限（gated）仓库（如 `meta-llama/*`）需要设置环境变量 `HF_TOKEN`；未设置时该模型会静默回退为上一次的记录，并记为一条 gap，而不会导致运行失败。重新生成 `models.json` 后，仍需在仓库根目录运行 `npm run check` 才能提交——`catalog_schema.py` 只是 `src/data/schemas/catalogSchemas.ts` 的人工同步镜像，不能替代真正的校验。
