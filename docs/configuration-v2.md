# Configurable Data Workflow v0.2 — Design Contract

Status: proposal, except where an existing file is explicitly named as current.
This document does not claim that Patch Pack import or browser smoke tests are
already implemented.

## 1. Outcome and non-goals

v0.2 should let one maintainer update a small part of the active data without
copying an entire Full Data Pack, while keeping the same trust and validation
boundary as bundled data.

The workflow remains:

```text
Bundled or imported Full Data Pack
  + optional Patch Pack
  -> pure, atomic materialization
  -> all catalog schemas
  -> duplicate-ID and relationship validation
  -> AdvisorConfig reference reconciliation
  -> active normalized catalogs
```

Patch Packs change data, not TypeScript formulas. v0.2 does not add a backend,
remote patch registry, runtime plugin system, collaborative editor, arbitrary
JSON Patch interpreter, or a chain of mutable patches in localStorage.

## 2. Full Data Pack and Patch Pack roles

- A **Full Data Pack** is self-contained and remains the portable export and
  long-term archival format.
- A **Patch Pack** is base-dependent. It describes a small, reviewable change
  from one exact `dataVersion` to another.
- Applying a Patch Pack produces a complete normalized catalog bundle. The
  browser stores or exports that materialized result as a Full Data Pack.
- The runtime does not retain or replay an unbounded patch chain.

Recommended pure API:

```ts
parsePatchPack(raw: unknown): PatchPack
applyPatchPack(
  base: NormalizedCatalogs,
  patch: PatchPack,
): { catalogs: NormalizedCatalogs; report: PatchApplyReport }
diffCatalogBundles(
  base: NormalizedCatalogs,
  target: NormalizedCatalogs,
  metadata: PatchAuthoringMetadata,
): PatchPack
```

Browser file parsing should apply the same byte-size preflight as Full Data
Packs before calling `JSON.parse`.

## 3. Patch Pack envelope

The envelope is strict: unknown fields fail validation.

```ts
interface PatchPack {
  patchSchemaVersion: 1;
  patchId: string;                 // stable data-pack ID pattern
  baseDataVersion: string;         // exact-match precondition
  resultDataVersion: string;       // required and different from the base
  createdAt: string;               // ISO datetime
  source: CatalogSource;
  note?: string;
  catalogs: PatchCatalogOperations;
}
```

`baseDataVersion` must equal `base.dataVersion`. v0.2 does not attempt a fuzzy
three-way merge. Reusing one data version for different contents is an authoring
error; checksums can be added later only if that becomes a real operational
problem.

Use the existing 4 MiB input limit and record-count guards for the first
implementation. A patch larger than the Full Data Pack is valid but should
produce an authoring warning.

## 4. ID-based catalog operations

These catalogs have top-level record IDs and use the same operation shape:

- `models`
- `modelBenchmarks`
- `gpus`
- `inferenceProfiles`
- `cloudPricing`
- `presets`
- `systems`

```ts
interface RecordCatalogPatch<T extends { id: string }> {
  metadata: {
    lastUpdated: string;
    source: CatalogSource;
  };
  upsert?: T[];
  deleteIds?: string[];
  order?: string[];
}
```

Rules:

1. `upsert` items are complete records that pass the current catalog record
   schema. Merge means lookup by `id` and whole-record replacement; it is not a
   recursive field merge.
2. Replacing the whole record makes removing an optional property explicit and
   avoids ambiguous `null` versus missing behavior.
3. A matching ID is replaced in its current position. A new ID is appended in
   patch order.
4. `deleteIds` removes records by exact ID. Deleting an unknown ID is an error,
   not a silent no-op.
5. Duplicate IDs within `upsert` or `deleteIds`, or an ID present in both, are
   errors.
6. If `order` is absent, survivors keep their base order, replacements stay in
   place, and additions follow. If present, `order` must contain every final ID
   exactly once and no other ID.
7. An ID rename is represented as `deleteIds: [oldId]` plus a complete new
   record in `upsert`; all references must be updated in the same atomic patch.
8. Every touched catalog supplies new provenance metadata. `catalogId` and
   `schemaVersion` are inferred and cannot be changed by a record operation.

Nested IDs, such as model quantizations, are not independently patchable in
v0.2. Replace the containing model record. This keeps the operation language
small and ensures dependent quantization references are validated together.

### Singleton and coupled catalogs

`assumptions` has one record without an ID. Any assumptions change uses a full,
schema-valid replacement:

```ts
interface AssumptionsPatch {
  metadata: { lastUpdated: string; source: CatalogSource };
  replace: AssumptionsRecord;
}
```

`exchangeRates` is also replaced as a complete catalog. Currency definitions,
the USD base, source metadata, API symbol list, and approved endpoint must remain
coherent, so per-currency delete/upsert is intentionally deferred.

```ts
interface ExchangeRatesPatch {
  replace: ExchangeRateCatalog;
}
```

## 5. Atomic application algorithm

`applyPatchPack` performs these steps in order:

1. Parse the strict Patch Pack schema and enforce size/count limits.
2. Require an exact `baseDataVersion` match.
3. Clone the normalized base; never mutate the caller.
4. Validate operation-level conflicts.
5. Apply every catalog operation in memory. Do not validate relationships after
   each catalog because one patch may update both sides of a reference.
6. Rebuild complete catalog envelopes and a manifest using
   `resultDataVersion`.
7. Run the same individual schemas, normalization, duplicate-ID checks,
   `validateCatalogRelationships`, and exchange-rate endpoint allow-list as a
   Full Data Pack import.
8. Serialize/preflight the materialized Full Data Pack before browser storage.
9. Reconcile the current AdvisorConfig against the new catalogs.
10. Only after every step succeeds, persist the materialized Full Data Pack and
    make catalogs plus reconciled config active.

Any error leaves both the active catalogs and current scenario unchanged.
Because localStorage has no transaction primitive, write the validated Full Data
Pack before updating in-memory React state. A scenario persistence failure may
be reported separately; the next startup must reconcile again.

The report should be deterministic and review-friendly:

```ts
interface PatchApplyReport {
  patchId: string;
  baseDataVersion: string;
  resultDataVersion: string;
  catalogs: Partial<Record<CatalogKey, {
    addedIds: string[];
    updatedIds: string[];
    deletedIds: string[];
    orderChanged: boolean;
    metadataChanged: boolean;
  }>>;
}
```

## 6. Diff generation rules

Generate a diff only after both base and target Full Data Packs parse and pass
relationship validation.

- Compare schema-normalized values, not raw JSON text.
- Object property order is ignored. Array order is preserved.
- ID only in target: emit complete `upsert` record.
- ID in both with a semantic value change: emit complete `upsert` record.
- ID only in base: emit `deleteIds` entry.
- Emit catalog metadata when it changes or when its records change.
- Any assumptions or exchange-rate difference emits a full `replace`.
- Emit `order` only when the target order differs from the stable order that the
  upsert/delete algorithm would otherwise produce.
- `exportedAt` is not catalog content and does not create a diff.
- Reject an empty patch that changes only `resultDataVersion`.

The diff generator's primary invariant is:

```text
applyPatchPack(base, diffCatalogBundles(base, target)).catalogs
deep-equals target after normalization
```

Test additions, replacements, deletion with dependent-reference repair,
reordering, provenance-only changes, nested quantization replacement, singleton
replacement, conflicts, wrong base versions, and the round-trip invariant.

## 7. AdvisorConfig catalog-reference reconciliation

Current implementation seam:

```text
src/state/reconcileAdvisorCatalogReferences.ts
```

Recommended public contract:

```ts
reconcileAdvisorCatalogReferences(
  config: AdvisorConfig,
  catalogs: NormalizedCatalogs,
): {
  config: AdvisorConfig;
  issues: AdvisorCatalogReferenceIssue[];
  changed: boolean;
}
```

Call it after URL or localStorage parsing, after any Full/Patch Data Pack switch,
and before calculation/persistence. It must be pure, deterministic, and
idempotent; a second call on its result returns no issues and `changed: false`.

Reference policy:

| AdvisorConfig path | Target | Resolution when missing or incompatible |
|---|---|---|
| `presetId` | `presets[].id` | Unset only; keep the current workload values. |
| `workload.useCase` | assumptions use-case mapping key | Use the first current mapping ID; preserve every numeric workload value. |
| `workload.usageFrequency` | assumptions frequency mapping key | Use the first current mapping ID; preserve every numeric workload value. |
| `workload.capabilityRequirementTierId` | `capabilityTiers[].id` | Use the highest-rank current tier to avoid understating requirements. |
| manual `modelSelection.modelId` | `models[].id` | Switch to Recommended and clear model plus quantization. |
| manual `modelSelection.quantizationId` | selected model quantizations | Keep the model and use its recommended quantization. |
| IDs cached in Recommended model mode | derived, not authoritative | Clear them so the engine resolves against current catalogs. |
| existing `hardwareSelection.gpuId` | `gpus[].id` | Switch to Recommended; never silently choose a different product. |
| `hardwareSelection.gpuCount` | selected GPU `supportedCounts` | Prefer `1` when supported, otherwise the first supported count. |
| catalog `hardwareSelection.systemId` | `systems[].id` | Switch to Recommended; never silently choose the first complete system. |
| custom performance model/quantization | models and model quantizations | Clear the complete model-bound performance tuple, including TPS/TTFT. |
| `economics.cloudPricingId` | `cloudPricing[].id` | Select the recommendation-compatible price, or unset if none; preserve custom pricing. |
| display currency | exchange-rate currency code | Use USD. |
| manual FX override keys | exchange-rate currency codes | Remove only unknown keys. |

Inactive invalid catalog references may be removed without changing the active
selection mode. Preserve the custom system draft unless its model-bound
performance tuple becomes unsafe to reuse.

Issues use stable codes and include `path`, previous value, and machine-readable
resolution. The UI may translate the message but must not reimplement the
policy.

## 8. Configurable Simple-mode labels and numbers

Simple-mode IDs are stable, Data Pack-defined identifiers. They are not display
copy. Labels use the existing localized-text shape:

```ts
interface LocalizedText {
  en: string;
  "zh-CN": string;
}
```

Use BCP-47 `zh-CN` instead of an ambiguous `zh` key. Resolution order is the
requested locale, then English. Do not store labels in URL or localStorage.

Use-case and frequency mapping values carry labels alongside their editable
numbers:

```json
{
  "simpleModeMappings": {
    "useCases": {
      "ai-assistant": {
        "labels": {
          "en": "AI Assistant",
          "zh-CN": "AI 助手"
        },
        "averageInputTokens": 900,
        "averageOutputTokens": 350,
        "averageAgentSteps": 1,
        "peakConcurrentUsersRatio": 0.2,
        "averageContextLength": 4096,
        "peakContextLength": 8192
      }
    },
    "usageFrequency": {
      "daily": {
        "labels": {
          "en": "Daily",
          "zh-CN": "每天"
        },
        "requestsPerUserPerWorkingDay": 12,
        "workingHoursPerDay": 8,
        "workingDaysPerMonth": 22
      }
    }
  }
}
```

Capability tiers use the same labels and an explicit, unique ascending `rank`.
Preset `name` and `description` also use localized text. This provides bilingual
data labels, not full application-shell localization.

Changing a Simple driver through the UI re-derives its configured dependent
numbers. Reconciling a removed driver after a Data Pack switch changes only the
driver ID and preserves the scenario's existing numbers; these are deliberately
different operations.

For v0.2, assumptions remain a singleton replacement in Patch Packs. Adding a
separate Simple Templates catalog solely to make each nested mapping patchable
would add more manifest, loader, schema, and relationship surface than this MVP
needs.

## 9. Architecture boundary checks

Add one small Vitest architecture test using the already installed TypeScript
compiler API rather than another dependency. Scan production imports and fail
with the importing file plus forbidden target.

Minimum enforceable rules:

1. `src/calculator/**` cannot import React, pages, components, features, state,
   loaders, adapters, or browser-only modules.
2. `src/data/schemas/**` and `src/data/validators/**` cannot import UI, pages,
   state hooks, or calculation engines.
3. `src/data/adapters/**` cannot be imported from calculator, components,
   features, or pages.
4. React imports under `src/currency/**` are allowed only in
   `useExchangeRates.ts`.
5. `src/components/**` and `src/features/**` cannot import provider adapters.

Keep this as an import-boundary test, not a general style linter. “No formulas
in UI” is enforced by review plus calculator acceptance tests; regex cannot
reliably identify a formula.

## 10. Minimal browser smoke

Use Playwright with Chromium and two stable, accessibility-driven tests. Do not
start with visual snapshots or a large page-object framework.

The test server must mount the built `dist/` directory under a repository-like
subpath such as `/ai-compute-advisor/`; testing only `/` misses the main static
deployment risk.

### Smoke 1: cold start under a subpath

1. Abort the Frankfurter request to simulate offline reference-rate refresh.
2. Navigate to the subpath with no saved browser state.
3. Assert no uncaught page error or failed same-origin asset/catalog request.
4. Wait for bundled data status and a completed default recommendation.
5. Confirm the UI identifies the bundled FX fallback/reference date rather than
   claiming a live trading rate.

### Smoke 2: state and import guard

1. Load a URL containing a non-default scenario field and verify it is restored.
2. Reload and verify the same authoritative input remains.
3. Import a small invalid Data Pack and assert that an error appears while the
   current data version and recommendation remain unchanged.
4. Optionally import/export a known valid fixture only if stable file controls
   are already exposed; do not make the initial smoke depend on downloads.

Prefer roles and accessible labels. Add a `data-testid` only for a value with no
stable accessible identity, such as the active data version. CI should build
first, start the subpath static server, install only Chromium, and run these two
tests serially. This catches the browser integration gap without turning the MVP
into a full end-to-end test project.

## 11. Suggested implementation order

1. Integrate and test AdvisorConfig reference reconciliation on catalog switch
   and startup.
2. Implement Patch Pack schemas plus pure apply/diff functions and round-trip
   tests; do not add UI yet.
3. Add file import/dry-run report and store the materialized Full Data Pack.
4. Add the import-boundary test.
5. Add the two browser smoke tests.

Stop before introducing generalized repositories, service containers, patch
registries, or a second state framework. Reconsider formal ports only when a
second runtime implementation is real.
