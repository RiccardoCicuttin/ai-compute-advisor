# AI Compute Advisor

[中文运行与部署说明](README.zh-CN.md)

**From AI workload to the right compute architecture.**

AI Compute Advisor is a static decision tool for comparing Local, Hybrid, and Cloud AI deployment from either a customer workload or an existing compute configuration. It estimates model and VRAM requirements, hardware fit, monthly and three-year cost, break-even, and the trade-offs behind a deployment recommendation.

For a field-by-field update path, see `outputs/configuration-guide.md`. For architectural invariants, see `AGENTS.md` and `outputs/architecture.md`.

The application has no backend, database, login, or runtime pricing API. Catalogs are plain JSON files, calculations run in the browser, and the production output is a normal static `dist/` directory. An optional browser-side request refreshes daily currency reference rates; a bundled fallback keeps the calculator usable when that external FX service is unavailable.

## What the tool answers

- Can the selected model run on the selected local hardware?
- How much VRAM is required, including weights, KV cache, runtime overhead, and safety margin?
- What effective throughput, monthly token capacity, concurrency, and workload compute utilization does the matching profile imply?
- How does a complete desktop system with dedicated or unified memory compare with a GPU-card build?
- What do Local, Hybrid, and Cloud cost per month and over three years?
- At what utilization does local hardware make economic sense?
- When does the local cash investment break even against Cloud?
- Which deployment strategy best matches the workload, privacy, intelligence, and cost constraints?
- Which inputs, assumptions, and formulas produced each result?

All estimates are directional. See [Method labels and limitations](#method-labels-and-limitations) before using a result in a customer proposal.

## Requirements

- Node.js 22.13 or later
- npm

## Install and run

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, normally <http://localhost:5173/>. This is
the quickest way to run the Demo. To make the Demo reachable from another
device on the same trusted network, use `npm run dev -- --host 0.0.0.0` and
open the network URL printed by Vite.

Useful commands:

```bash
npm run dev        # Start the local development server
npm test           # Run the Vitest suite once
npm run test:watch # Run tests while editing
npm run lint       # Run the TypeScript checks
npm run build      # Type-check and create dist/
npm run check      # Run type checks, tests, and the production build
npm run preview    # Preview the completed dist/ build locally
```

`npm run preview` is a local build check, not a production server. Do not double-click `dist/index.html`; browsers restrict ES modules and JSON requests opened through `file://`. Serve `dist/` through an HTTP static host instead.

## Project shape

```text
public/data/                 Editable catalog JSON
src/data/schemas/            Zod schemas for untrusted JSON and saved state
src/data/loaders/            Manifest-based static catalog loading
src/data/validators/         Cross-catalog ID and relationship checks
src/data/adapters/           Optional external-source normalization seams
src/types/                   Shared domain contracts
src/calculator/              Pure calculation and recommendation engines
src/systems/                 Complete desktop schemas and engine adapter
src/currency/                USD-base conversion, daily refresh, cache, and fallback
src/i18n/                    English/Chinese UI messages and locale preference
src/state/                   URL state, browser-local libraries, and React state hooks
src/components/              Reusable UI and chart components
src/pages/                   Single-page product composition
src/utils/                   Number and unit formatters
```

Dependency direction is intentionally one way:

```text
Static JSON -> Zod schemas -> normalized catalogs
User inputs -> pure calculator -> traceable results -> React UI
```

Calculator files do not import React. Components do not contain formulas. Calculation results are derived from current inputs and are never treated as saved source data.

`src/architecture.test.ts` is a small maintenance harness that fails if the calculator starts importing React/UI state or feature components begin calling calculator modules directly. `AGENTS.md` records the same boundary for future human or AI maintainers.

## Two analysis starting points

The same calculation engine supports two presentation flows:

- **Workload-first** starts from demand, then selects a suitable model and hardware path.
- **Configuration-first** starts from an existing GPU build or desktop system. Unless the user manually pins a model, the engine checks context/privacy, memory fit, runtime support, and performance capacity against that hardware before selecting the highest-ranked runnable model.

Changing the starting point reorders the single page; it does not create a second calculator or duplicate formulas. Manual model selection always wins. If the selected configuration has no defensible runnable profile, the engine reports the limitation and transparently falls back to workload-first model selection.

Simple Mode is also a presentation layer, not a hidden formula. Use-case and frequency choices load editable starting values. Requests per user/day, users, tokens, steps, concurrency, context, hours, and working days remain visible and editable in Simple Mode. Advanced Mode accepts the normalized monthly request total directly.

The header switches the full static UI between English and Simplified Chinese. The preference is local to the browser and does not alter scenario math or shared URLs. Product/vendor names remain source data; presets, Simple templates, and capability tiers carry `en` and `zh-CN` labels in the Data Pack so newly added options can be bilingual without a React edit.

## How static data loads

The browser first loads `public/data/manifest.json`, then resolves every catalog URL relative to the page's base URL. This is what allows one build to work at a root domain and under a GitHub Pages repository subpath.

The manifest points to:

- `models.json`: stable model identity, architecture, data-defined quantizations, capability tier, context, and licensing facts
- `model-benchmarks.json`: dated, methodology-specific model observations
- `gpus.json`: VRAM, bandwidth, power, price, interconnect, and supported GPU counts
- `inference-profiles.json`: model/GPU/quantization performance observations
- `cloud-pricing.json`: dated input, output, and cached-input token prices
- `assumptions.json`: capability tiers, bilingual Simple templates, economics, VRAM, multi-GPU, and recommendation thresholds
- `presets.json`: bilingual workload scenarios that populate the calculator
- `systems.json`: complete desktop/workstation configurations, including host memory, accelerators, whole-system power, price, and optional model-bound performance
- `exchange-rates.json`: USD-base currency definitions and the bundled daily-reference fallback; the sample pack starts with USD/EUR/CNY

Each catalog is runtime-validated with Zod. A second validation pass checks duplicate IDs and references between files. Invalid or missing data is reported as an issue; it is not silently converted to zero.

Catalog envelopes carry their own metadata:

```json
{
  "schemaVersion": 1,
  "catalogId": "models",
  "lastUpdated": "2026-08-10",
  "source": {
    "label": "Example directional data",
    "methodology": "Maintained manually"
  },
  "data": []
}
```

Keep `lastUpdated`, source attribution, methodology, and license information truthful. The Data Status area reads these values directly; there is no CMS.

## Import and export a portable Data Pack

The nine static catalog files remain the easiest source-controlled maintenance format. The Data Status area can also export the active catalogs as one portable JSON file and import that file into another copy of the calculator.

A portable Data Pack contains:

- `packSchemaVersion` and `exportedAt`
- the versioned manifest
- all nine embedded catalogs, including desktop systems and exchange-rate definitions

Imports are treated as untrusted input. Before a pack becomes active, the browser checks the outer pack schema, every catalog schema, duplicate IDs, catalog IDs, and all cross-catalog relationships. This includes model/quantization references in desktop performance records and supported GPU counts in inference profiles. A rejected pack never replaces the currently active data.

The import boundary also applies these safeguards:

- maximum JSON size: 4 MiB
- maximum records per enveloped catalog: 10,000
- fixed portable manifest filenames
- no arbitrary runtime exchange-rate endpoint from an imported file
- sanitized download filenames

A valid imported pack is stored only in this browser under `aca:v1:data-pack`; it is not uploaded. It remains active after refresh until **Use bundled data** is selected or that local entry is cleared. Export always writes the complete active, normalized catalog set, so an imported pack can be reviewed or transferred without relying on the original host's files.

To add a product without changing application code, export the active pack, add the new complete records to the relevant embedded catalogs, update `dataVersion`/dates, and import the resulting file. A model, benchmark, inference profile, price, GPU, and desktop can be added together in one atomic pack. Cross-catalog references are checked before activation. After a pack changes, saved model/GPU/system/price/currency/template IDs are reconciled; stale IDs cannot silently price or benchmark a different product.

## Full Data Pack versus Browser Library

These are two deliberately separate portable files:

| | Full Data Pack | Browser Library |
|---|---|---|
| Purpose | The authoritative shared catalog and planning assumptions for one deployment | A user's reusable local additions and imported comparison snapshots |
| Contents | Models, benchmarks, GPUs, inference profiles, cloud prices, assumptions, presets, complete systems, and FX definitions | Browser-added models, browser-added complete systems, and optional Artificial Analysis comparison records |
| Editing model | Source-controlled JSON or one validated Full Data Pack import | Add, edit, and delete directly in the calculator UI |
| Storage | `aca:v1:data-pack` in the current browser when imported | Separate versioned browser-local libraries |
| Portable file | Export/Import Full Data Pack | Export/Import Browser Library |
| Precedence | Authoritative | Layered over the active Data Pack; it cannot overwrite a colliding Data Pack ID |

The **Browser Library** controls are in Data Status. Exporting it creates a
separate JSON file containing the locally saved model and whole-system
libraries and, when present, imported Artificial Analysis comparison data. An
import is size-limited and schema-validated before activation. Clearing the
Browser Library does not alter the bundled or imported Full Data Pack.

The separation keeps team-owned product facts reviewable while still allowing
a salesperson or Solution PM to maintain several personal model and machine
records. A Full Data Pack export deliberately omits Browser Library overlays;
export both files when a recipient needs the shared catalog and the local
additions. A shared scenario URL can reference a browser-local ID, so the
recipient must import the matching Browser Library before that local product is
available.

In the Model section, Data Pack models are read-only. Browser models support
add, select, edit, save, and delete, including parameter counts, context,
capability tier, quantizations, modalities, optional KV-cache metadata, notes,
and an independently sourced cloud price. Missing benchmark or performance
evidence remains **Not available**; it is not inferred from parameter count.

In the Local hardware section, a custom complete system can be saved to the
Browser Library, selected again later, edited, or deleted. Multiple local
machines may coexist. A complete system remains one price and power object;
accelerator count never multiplies whole-system price or power.

## Add or update a model

For a personal or draft model, use **Model → Add model** and save it to the
Browser Library. Use the JSON steps below when the model should become part of
the authoritative, source-controlled Data Pack distributed to every user.

1. Open `public/data/models.json`.
2. Add a record with a unique, stable `id`. Do not reuse an old ID for a different model.
3. Record `totalParametersB` and `activeParametersB` separately. For MoE models, total parameters determine stored model weight; active parameters only describe inference compute.
4. Add at least one quantization with its bit width and packing overhead.
5. Set `capabilityTierId` to an ID declared in `assumptions.json`. Tier names and rank are data, not React constants.
6. Update the catalog envelope's `lastUpdated` and source metadata.
7. If comparison evidence exists, add a dated observation to `model-benchmarks.json`.
8. If local performance evidence exists, add an entry to `inference-profiles.json`.
9. Run `npm run check`.

Do not place provider-specific speed or latency in the base model record. Those measurements belong in a benchmark or inference profile with the source and methodology that produced them.

Scores from different benchmark sources or methodology versions must not be compared on the same numerical axis without an explicit normalization method.

## Add or update a GPU

1. Open `public/data/gpus.json`.
2. Add a unique stable `id`, display name, vendor, `vramGB`, `memoryBandwidthGBps`, `tdpWatts`, `streetPriceUSD`, and interconnect.
3. Declare any supported positive integer counts (for example `1`, `2`, `4`, or `8`) and whether tensor parallelism is supported. The UI reads this list directly.
4. Update the catalog date and source.
5. Add defensible combinations to `inference-profiles.json` when measured or derived performance evidence is available.
6. Check the matching interconnect/count efficiency factors in `assumptions.json`.
7. Run `npm run check`.

Total memory capacity may scale with GPU count. Performance never assumes perfect linear scaling; the calculator looks up the exact interconnect/count efficiency in `assumptions.json`. If a new count has no factor, it uses a conservative aggregate `1×` fallback and emits a visible warning instead of interpolating or assuming linear scale.

## Add or update a complete desktop system

Edit `public/data/systems.json` when the product being compared is a complete workstation or desktop rather than an individual GPU card.

1. Use a stable `id`, product name, vendor, source, date, and honest `dataQuality` (`directional` or `verified`).
2. Choose `memoryArchitecture: "dedicated"` or `"unified"`.
3. For dedicated memory, enter `dedicatedMemoryGBPerDevice`; for unified memory, enter `allocatableUnifiedMemoryGB`. Also record installed `systemMemoryGB` and a non-empty memory-type label such as `DDR5`, `DDR5-ECC`, `LPDDR5X`, or `Unified`; the list is data-defined.
4. Set a user-facing `acceleratorType`, a stable `acceleratorBehaviorCategory` (`gpu`, `ai-accelerator`, `npu`, or `other`), and any positive integer physical count. The label can evolve without changing calculation behavior.
5. Record aggregate memory bandwidth plus whole-system idle/load watts and the whole-system USD purchase price. These values are treated as one machine and are not multiplied by accelerator count.
6. Record runtime support and its evidence method. Runtime support is separate from memory fit.
7. `peakTops` is optional and remains a specification only. Never derive LLM TPS from TOPS.
8. Add `performance` only when it is bound to a model and, when known, quantization, context, concurrency, TPS, TTFT, and evidence method.
9. Run `npm run check`.

The Custom System form stores the same planning concepts in the URL and local
browser state. A custom TPS value is explicitly treated as a user-supplied
estimate for the active model scenario. Selecting **Save to browser library**
creates a reusable local system record; it does not modify the Full Data Pack.

Catalog desktop systems are part of every portable Full Data Pack. Unsaved
Custom System form values remain scenario inputs that travel with URL/local
scenario state. Saved browser systems travel only in a separately exported
Browser Library.

## Currency and daily reference rates

All catalog prices and calculator formulas use USD as the stable base currency. The bundled Data Pack starts with USD, EUR, and CNY; changing the display currency does not change recommendation math. A replacement Data Pack can add another three-letter uppercase currency code, such as JPY, without a React or calculator code change.

- Definitions and the bundled fallback are in `public/data/exchange-rates.json`.
- Rates are stored as units of currency per 1 USD, for example `1 USD = 6.7444 CNY`.
- The browser can refresh the latest working-day reference rate from the configured Frankfurter v1 URL.
- A successful response is validated, cached in localStorage for 24 hours, and dated in the UI.
- A failed request leaves the last valid cache or bundled fallback active.
- A portable Data Pack carries its own validated static fallback rates, but cannot redirect the browser to an arbitrary refresh host; imported packs use the calculator's approved Frankfurter endpoint and a symbol list that must exactly match the pack's currencies.
- Manual overrides for configured non-USD currencies affect display conversion only and travel with URL/local state through the generic `fx` parameter. Older EUR/CNY links remain supported.

Reference rates are not intraday trading quotes or guaranteed transaction rates. Update the static fallback date and values when preparing a new self-contained data pack.

The fallback removes the dependency on the external FX service; it does not turn the site into a cold-start offline PWA. The static application and catalog files must still be available from an HTTP host.

## Add an inference profile

Edit `public/data/inference-profiles.json` and provide:

- stable model, GPU, and quantization IDs
- GPU count
- input, output, and context token conditions
- concurrency
- effective tokens per second
- framework and source where known
- `method`: `measured`, `derived`, or `estimated`
- observation date

An exact profile is preferred. When no defensible profile exists, compute utilization and utilization-based break-even remain unavailable instead of inventing throughput.

## Update Cloud pricing

1. Open `public/data/cloud-pricing.json`.
2. Update or add the provider/model offering.
3. Keep all MVP records in USD.
4. Record input, output, and cached-input prices per one million tokens.
5. Update both the record date and catalog date, with a source URL where available.
6. Run `npm test` and `npm run build`.

If cached-input pricing is absent, the calculator falls back to normal input pricing and adds that fact to the calculation trace. Users can temporarily override catalog prices in the UI without modifying JSON.

## Change assumptions

Edit `public/data/assumptions.json`. The file contains:

- electricity, maintenance, host cost, lifetime, and default utilization
- runtime overhead, minimum runtime memory, safety margin, and KV-cache fallbacks
- VRAM fit thresholds
- interconnect-specific multi-GPU efficiency
- ordered capability tiers with `en` / `zh-CN` labels
- Simple Mode use-case and frequency mappings with `en` / `zh-CN` labels
- recommendation thresholds and preferred break-even horizon

Ratios are stored as decimals from `0` to `1`; for example, `0.65` means 65%. Money is USD, memory is decimal GB, power is watts, electricity is USD/kWh, and token prices are USD per one million tokens.

Changing an assumption can alter every recommendation. Run the complete test and build commands, then inspect at least one Local, Hybrid, Cloud, and no-break-even scenario.

### Privacy and capability labels are planning policy

Labels such as **Low / Medium / High / Critical privacy** and **Basic /
Balanced / Advanced / Frontier capability** are not universal industry
classifications. They are bilingual, ordered, configurable planning policies
owned by `assumptions.json`. Their descriptions, examples, recommendation
impact, and latency targets are displayed directly beneath the selected
options.

The bundled privacy policy currently means:

- **Low**: public, synthetic, or non-sensitive content; external cloud processing is normally acceptable.
- **Medium**: routine internal data without regulated or high-value secrets; approved providers and retention controls are required.
- **High**: raw sensitive content stays inside an organization-controlled local or private boundary; Hybrid may send only redacted/minimized context or a non-sensitive subtask to an approved cloud.
- **Critical**: prompts, context, retrieved data, outputs, and inference telemetry stay inside the approved local, on-premises, or sovereign boundary; public-cloud inference is prohibited by this planning policy.

This mapping is a product default, not a legal conclusion. NIST's Privacy
Framework asks organizations to build profiles from their business/mission,
data-processing roles, processing types, and individuals' privacy needs;
FIPS 199's Low/Moderate/High terms instead describe potential impact after a
loss of confidentiality, integrity, or availability. Map the Data Pack policy
to the customer's own security classification, contracts, jurisdiction, and
legal review before using it in a proposal. See the
[NIST Privacy Framework getting-started guide](https://www.nist.gov/privacy-framework/getting-started-0)
and [FIPS 199](https://csrc.nist.gov/pubs/fips/199/final).

## Add or update a preset

Edit `public/data/presets.json`. A preset supplies a partial normalized workload, bilingual `name`/`description`, and may suggest a Local Coverage ratio. Adding a preset must not require editing a React component.

Use a stable ID because shared URLs may reference it. Applying a preset should not silently replace an explicit manual model or GPU selection.

## Formula locations

All formulas are pure functions under `src/calculator/`:

| File | Responsibility |
|---|---|
| `tokenCalculator.ts` | Monthly input, output, and total token demand |
| `modelRequirementEngine.ts` | Required model class and eligible models |
| `configurationFirstModelSelector.ts` | Highest runnable model for an existing GPU/desktop configuration |
| `vramCalculator.ts` | Model weights, KV cache, runtime overhead, and safety margin |
| `hardwareFitCalculator.ts` | Available VRAM, fit verdict, and GPU count rules |
| `multiGpuEfficiency.ts` | Exact data-defined multi-device efficiency lookup and conservative fallback |
| `performanceCalculator.ts` | Profile matching, token capacity, and compute utilization |
| `localCostCalculator.ts` | Purchase price, depreciation, power, electricity, maintenance, and Local TCO |
| `cloudCostCalculator.ts` | Input, output, cache, and Cloud monthly cost |
| `hybridCostCalculator.ts` | Full Local infrastructure plus uncovered Cloud escalation |
| `breakEvenCalculator.ts` | Cash break-even month and required utilization parity |
| `recommendationEngine.ts` | Prioritized Local, Hybrid, Cloud, and constraint-conflict rules |
| `opportunityMapEngine.ts` | Recommendation-consistent opportunity regions |
| `analysisEngine.ts` | Orchestrates the engines and returns the complete traceable result |
| `desktopSystemCalculator.ts` | Validates custom desktops and adapts whole-system memory, price, power, and explicit performance into the engines |

Engines retain full numerical precision in USD. `src/currency/` converts only at the input/display boundary; `src/utils/` formats tokens, GB, and percentages.

## How recommendation logic works

The recommendation is a prioritized rule system, not an opaque weighted score:

1. Stop on incomplete required input rather than showing a stale decision.
2. Treat Critical privacy as a hard constraint. Return a constraint conflict if no capable Local path exists.
3. Prefer Cloud when Local cannot run and privacy permits Cloud.
4. Handle a capability-tier gap explicitly; do not claim a lower-ranked local model is equivalent to the requested tier.
5. Prefer Local or Hybrid when privacy is high and the local model is capable, while exposing unfavorable economics as a trade-off.
6. Apply Local and Hybrid economic thresholds from `assumptions.json`.
7. Use latency only as a stated network-path preference unless measured inference data supports a stronger claim.
8. Default to Cloud when Local and Hybrid are feasible but do not meet the economic and workload-density conditions.

The engine returns short reason codes and change conditions. The UI only translates these returned reasons into readable copy; it does not implement a second recommendation system.

Capability tier IDs and ranks come from the active Data Pack. The bundled names Basic/Balanced/Advanced/Frontier are examples, not a closed enum. The opportunity map and comparison UI use the same ordered tier definitions.

## URL sharing and local persistence

Core inputs and stable catalog IDs are encoded in versioned query parameters. The URL can be bookmarked or copied to a colleague. It does not contain catalogs or calculated results.

The query parameter `v` identifies the URL-state schema. `dv` records the catalog data version that created the link; a mismatch warns that current data may produce a different answer. The query also carries the analysis starting point and data-defined use-case, frequency, tier, and hardware-count IDs.

The browser stores the last valid scenario under `aca:v1:last-scenario`,
preferences under `aca:v1:preferences`, the last valid daily reference rates
under `aca:v1:exchange-rates`, and an optional imported catalog set under
`aca:v1:data-pack`. Browser-added models, systems, and Artificial Analysis
comparison records use their own versioned library entries. Saved values are
validated before use. A corrupt or incompatible value cannot prevent bundled
data from starting.

Active catalog precedence is:

1. A valid locally imported Data Pack
2. The bundled manifest and static catalogs

After the authoritative base is selected, non-conflicting Browser Library
models and systems are layered over it for this browser. A Data Pack record
always wins an ID collision. Artificial Analysis snapshot records remain in a
separate comparison-only library and never enter calculator catalogs.

Scenario precedence inside the active catalogs is:

1. A valid URL containing at least one recognized scenario field
2. The valid local draft
3. Bundled defaults

Results, default catalogs, and customer data are not uploaded or duplicated into a backend.

## Deploy to Vercel

The repository includes `vercel.json`.

1. Import the repository into Vercel.
2. Keep the Vite framework preset.
3. Confirm Build Command is `npm run build`.
4. Confirm Output Directory is `dist`.
5. Deploy.

No Functions, server runtime, environment variable, or SPA pathname rewrite is required for the current one-path application.

## Deploy to Netlify

The repository includes `netlify.toml`.

1. Add a site from the Git repository.
2. Netlify reads `npm run build` and `dist` from the configuration.
3. Deploy.

The application uses the root pathname plus query state, so it does not need an SPA fallback redirect. If pathname-based routing is added later, add and test the appropriate rewrite separately.

## Deploy to GitHub Pages

The repository includes `.github/workflows/deploy-pages.yml`.

1. Push the repository to GitHub with `main` as the default branch.
2. Open **Settings → Pages**.
3. Select **GitHub Actions** as the source.
4. Run the workflow manually or push to `main`.

The workflow installs dependencies, runs tests, builds the static site, and deploys `dist`. Vite uses a relative base and the application uses query-only state, so assets work under `https://USER.github.io/REPOSITORY/` without a pathname router.

If the default branch is not `main`, change the workflow trigger before deploying.

## Import an Artificial Analysis comparison snapshot safely

The model comparison panel accepts the unmodified JSON response from the
supported official Artificial Analysis models endpoint. This is a
**comparison-only snapshot** stored in the Browser Library; it does not create
a calculator `ModelRecord`, invent parameter counts, or replace the Data Pack's
models, benchmarks, or prices.

The static browser app intentionally never asks for, receives, stores, or sends
an Artificial Analysis API key. Obtain the snapshot on a trusted workstation,
CI job, or server-side build step. For example, after placing the key in that
environment's secret store as `ARTIFICIAL_ANALYSIS_API_KEY`:

```bash
curl --fail --show-error --silent \
  --header "x-api-key: ${ARTIFICIAL_ANALYSIS_API_KEY:?set this secret outside the browser}" \
  "https://artificialanalysis.ai/api/v2/language/models/free" \
  --output artificial-analysis-models.json
```

Do not paste a key into frontend source, Vite environment files, a scenario
URL, localStorage, or the browser developer console. Review Artificial
Analysis's current access and licensing terms before redistributing a snapshot;
the [official API documentation](https://artificialanalysis.ai/data-api/docs)
is the authority for endpoint and field changes.

Then:

1. Open **Model requirement → Artificial Analysis comparison snapshot**.
2. Select **Import JSON snapshot** and choose `artificial-analysis-models.json`.
3. Search and select up to six imported models for comparison.
4. Delete individual local records, clear the snapshot, or use **Data Status → Export Browser Library** to carry the normalized comparison records with the other browser-local data.

The import is size-limited, validates the provider response, maps stable
external IDs into its own namespace, and stores only strict normalized fields.
Missing source values remain **Not available**, never zero. Intelligence,
coding, and math values are index points; speed is output tokens per second;
latency is median time to first token in seconds. Input, output, cache-read, and
cache-write prices are source-reported **USD per 1 million tokens**. The UI
shows the source link and import date so the age and provenance remain visible.

The source boundary remains isolated:

```text
Authenticated server/build fetch
  -> unmodified JSON snapshot
  -> browser file import and validation
  -> strict comparison-only records
  -> separate Browser Library persistence/export
```

The calculator continues to run without this snapshot and makes no Artificial
Analysis network request at runtime. Its only optional runtime external request
is the isolated daily currency-reference refresh described above.

## Method labels and limitations

- **Measured**: tied to an observation and its stated conditions.
- **Derived**: produced directly from visible data and formulas.
- **Estimated**: uses a fallback or scaled observation and includes a warning.
- **Not available**: the catalog lacks enough defensible information. Missing data is never displayed as zero.

Model fit is not the same as acceptable performance. A model may fit in VRAM and still be too slow for the workload. Multi-GPU capacity may scale while inference performance does not scale linearly. Cloud prices and street prices become stale, and benchmark results depend on workload, implementation, framework, quantization, context, and concurrency.

The same rule applies to GPU, AI accelerator, and NPU desktop products: arithmetic TOPS across different precisions and runtimes is not interchangeable with tokens per second. Without a model-bound observation, performance is reported as unavailable.

> Estimates are directional and depend on model implementation, inference framework, quantization, context length, concurrency and actual hardware performance.

## Maintenance checklist

Before publishing a data or formula change:

- Update catalog and record dates.
- Preserve stable IDs and valid cross-file references.
- Include source and methodology information.
- Do not replace unknown values with zero.
- Run `npm test`.
- Run `npm run build`.
- Preview `dist/` through `npm run preview`.
- Recreate a scenario from a copied URL.
- Check one mobile and one desktop viewport.
- Confirm Data Status reflects the new dates.
