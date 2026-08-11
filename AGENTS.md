# AI Compute Advisor repository contract

This file applies to the entire repository. It is intentionally short: the
project is a portable static calculator, not an enterprise application.

## Product invariants

- Keep the app static-first: no backend, database, login, CMS, or required
  server API.
- The calculator owns formulas. Data Packs own products, observations,
  assumptions, labels, and prices.
- All authoritative calculation values use USD and full numerical precision.
  Currency conversion and rounding happen only at input/display boundaries.
- Missing evidence is `unavailable`, never an invented zero.
- Recommendations must remain explainable through reason codes, warnings, and
  calculation traces.
- A complete desktop system is one cost and power object. Never multiply its
  whole-system price or power by its accelerator count.
- TOPS is not LLM tokens per second. Use only model-bound performance evidence
  for TPS or latency.

## Dependency boundaries

- `src/calculator/**` is the functional core. Production files there must not
  import React, browser APIs, UI, pages, state hooks, or data loaders.
- `src/data/schemas/**` and `src/data/validators/**` define trust boundaries.
  Every external JSON, URL value, localStorage value, and adapter result must be
  parsed before it reaches calculation code.
- `src/data/adapters/**` converts optional external snapshots to internal
  records. UI and calculator code must not import provider adapters directly.
- `src/state/**` owns URL/local persistence and catalog-reference
  reconciliation. UI components must not reproduce fallback or migration
  rules.
- `src/currency/**` owns USD/display conversion and reference-rate fallback.
  Only the React hook file may depend on React.
- `src/components/**` and `src/features/**` render data and emit user actions;
  they must not implement cost, capacity, fit, or recommendation formulas.
- `src/pages/**` is the composition shell and may connect the preceding layers.

Prefer pure functions with explicit inputs over service classes or a dependency
injection container. Add a formal port only when a second implementation
actually exists or is being introduced.

## Data and compatibility rules

- Treat bundled JSON, imported Full Data Packs, future Patch Packs, URL state,
  and localStorage as untrusted input.
- Keep IDs stable. An ID rename is a delete plus an add and requires updating
  every reference.
- Update catalog and record dates plus truthful source/methodology metadata when
  data changes.
- After parsing individual schemas, always run duplicate-ID and cross-catalog
  relationship validation before activation.
- Data Pack activation is atomic: a rejected import must not replace active
  catalogs or the current scenario.
- URL, localStorage, and pack formats are versioned contracts. Do not silently
  reinterpret an old version. Add a tested migration or fail safely.
- After active catalogs change, reconcile every AdvisorConfig catalog reference
  before calculation or persistence.
- Dynamic Simple-mode IDs and capability tiers come from assumptions data;
  labels do not become identifiers and must never be stored in URLs.

`docs/configuration-v2.md` is a design contract for the next configurable-data
iteration. Do not assume its Patch Pack API is implemented until corresponding
schemas, pure functions, and tests exist.

## Change procedure

For a formula change:

1. Change the smallest calculator module.
2. Add boundary and business-invariant tests.
3. Confirm traces and method labels still describe the actual calculation.

For a schema, catalog, URL, or persistence change:

1. Update the runtime schema and relationship rules.
2. Add valid, invalid, legacy/fallback, and round-trip tests.
3. Check Data Pack import/export parity and catalog-reference reconciliation.
4. Document any compatibility or authoring impact.

For UI work, preserve accessible labels, keyboard behavior, responsive layout,
and the distinction between directional estimates and verified observations.

## Required verification

Run the narrowest relevant test while editing. Before handing off a completed
schema, formula, state, or data change, run:

```bash
npm run lint
npm test
npm run build
```

For release-facing changes, also serve `dist/` over HTTP, recreate a copied URL,
exercise Full Data Pack import/restore, test one mobile and one desktop viewport,
and verify the app still starts when the FX refresh request fails.

Do not add Redux, a backend, a repository/service-container layer, a plugin
framework, or broad snapshots merely to make the architecture look formal.
