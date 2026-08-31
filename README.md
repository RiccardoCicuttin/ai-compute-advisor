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
| `contextWindowTokens`, `kvCacheBytesPerToken` | Each model's live Hugging Face `config.json` | The pipeline, automatically |

### What's automated

A weekly GitHub Actions workflow (`.github/workflows/sync-models.yml`, Mondays 06:00 UTC, or manual dispatch):

1. Installs the pipeline (`uv sync --project pipeline`) and runs its own lint/type/test suite.
2. Runs `python -m hf_sync.build_catalog`: for every model in `models.seed.yaml`, pulls `config.json` from its Hugging Face repo, derives `contextWindowTokens` and `kvCacheBytesPerToken` from the architecture, and merges those onto the curated seed fields.
3. Re-validates the regenerated `models.json` against the app's own schema (`npm run lint && npm test && npm run build`) — this is the real gate, not the pipeline's own Python-side check.
4. If anything changed, opens a pull request with the diff and attaches `pipeline/gaps_report.txt` (see below) so a reviewer sees exactly what moved and why.

A model whose Hugging Face pull fails, or whose merged record fails validation, is never dropped or zeroed out — its previously committed entry is carried forward unchanged, and the reason is logged to `gaps_report.txt`. Nothing fails silently; a stale or misspelled `hfRepoId` shows up as a reported gap, not a missing or broken model.

### What's manual

To add, remove, or re-describe a tracked model, edit `pipeline/models.seed.yaml` by hand. Every field there except the two architecture-derived ones above is editorial and is never touched by the pipeline:

- `id`, `hfRepoId`, `name`, `provider`, `family`
- `totalParametersB`, `activeParametersB`, `modelType` (`dense`/`moe`)
- `capabilityTierId`, `reasoning`, `modalities`, `openWeight`, `commercialUse`
- `recommendedQuantizationId` and the `quantizations` list
- `notes`

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

- **人工维护**（`pipeline/models.seed.yaml`）：能力分级、许可证、商用条款、量化档位、显示名称、备注等编辑性字段。新增模型时必须手动填写全部字段，包括正确拼写的 `hfRepoId`；流水线不会替你猜测能力分级或许可证。
- **自动同步**：`contextWindowTokens` 与 `kvCacheBytesPerToken` 来自模型在 Hugging Face 上的实时 `config.json`，由每周一 06:00 UTC 运行的 GitHub Actions 工作流（`.github/workflows/sync-models.yml`，也可手动触发）拉取、推导并合并到人工字段之上，再用 `npm run lint && npm test && npm run build` 做最终校验，通过后自动开 PR。

某个模型的 Hugging Face 拉取失败或合并后校验不通过时，不会被清零或从目录中移除——会保留上一次提交的记录，并把原因写入 `pipeline/gaps_report.txt`，不会静默失败。

本地运行：

```bash
cd pipeline
uv sync
uv run python -m hf_sync.build_catalog --dry-run   # 仅校验并生成报告，不写文件
uv run python -m hf_sync.build_catalog              # 写入 models.json、manifest.json、gaps_report.txt
```

拉取受限（gated）仓库（如 `meta-llama/*`）需要设置环境变量 `HF_TOKEN`；未设置时该模型会静默回退为上一次的记录，并记为一条 gap，而不会导致运行失败。重新生成 `models.json` 后，仍需在仓库根目录运行 `npm run check` 才能提交——`catalog_schema.py` 只是 `src/data/schemas/catalogSchemas.ts` 的人工同步镜像，不能替代真正的校验。
