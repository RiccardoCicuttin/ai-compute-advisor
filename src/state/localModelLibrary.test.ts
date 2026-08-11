import { describe, expect, it } from "vitest";
import assumptions from "../../public/data/assumptions.json";
import cloudPricing from "../../public/data/cloud-pricing.json";
import exchangeRates from "../../public/data/exchange-rates.json";
import gpus from "../../public/data/gpus.json";
import inferenceProfiles from "../../public/data/inference-profiles.json";
import manifest from "../../public/data/manifest.json";
import modelBenchmarks from "../../public/data/model-benchmarks.json";
import models from "../../public/data/models.json";
import presets from "../../public/data/presets.json";
import systems from "../../public/data/systems.json";
import { createPortableDataPack } from "../data/dataPack";
import { parseCatalogBundle } from "../data/schemas";
import type { NormalizedCatalogs } from "../types";
import {
  LOCAL_MODEL_LIBRARY_STORAGE_KEY,
  LOCAL_MODEL_LIBRARY_MAX_BYTES,
  LocalModelLibraryError,
  addLocalModel,
  buildLocalModelLibraryEntry,
  clearLocalModelLibrary,
  createBrowserLibraryModelsSection,
  createDefaultLocalModelDraft,
  createEmptyLocalModelLibrary,
  deleteLocalModel,
  localModelEntryToDraft,
  mergeLocalModelLibraryIntoCatalogs,
  readLocalModelLibrary,
  parseBrowserLibraryModelsSection,
  parseLocalModelLibraryJson,
  reconcileLocalModelLibrary,
  removeLocalModelLibraryOverlay,
  serializeLocalModelLibrary,
  updateLocalModel,
  writeLocalModelLibrary,
  type LocalModelLibrary,
  type LocalModelLibraryStorage,
} from "./localModelLibrary";

const catalogs = parseCatalogBundle({
  manifest,
  models,
  modelBenchmarks,
  gpus,
  inferenceProfiles,
  cloudPricing,
  assumptions,
  presets,
  systems,
  exchangeRates,
});

const timestamp = "2026-08-11T00:00:00.000Z";

function modelEntry(
  id: string,
  options: { pricing?: boolean; tier?: string } = {},
) {
  const draft = createDefaultLocalModelDraft(catalogs, new Date(timestamp));
  draft.id = id;
  draft.name = `Model ${id}`;
  draft.provider = "Example Lab";
  draft.totalParametersB = 8;
  draft.activeParametersB = 8;
  draft.contextWindowTokens = 32_768;
  draft.capabilityTierId = options.tier ?? catalogs.assumptions.capabilityTiers[0]!.id;
  if (options.pricing) {
    draft.cloudPricing = {
      enabled: true,
      provider: "Example API",
      inputPricePerMillionTokens: 0.2,
      outputPricePerMillionTokens: 0.8,
      cachedInputPricePerMillionTokens: 0.05,
      cacheWritePricePerMillionTokens: null,
      sourceUrl: "https://example.com/pricing",
      lastUpdated: "2026-08-11",
    };
  }
  return buildLocalModelLibraryEntry(draft, timestamp);
}

class MemoryStorage implements LocalModelLibraryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("browser-local model library", () => {
  it("builds complete namespaced model and separate sourced USD pricing records", () => {
    const entry = modelEntry("private-8b", { pricing: true });
    expect(entry.model.id).toBe("local.model.private-8b");
    expect(entry.model.quantizations).toEqual([
      { id: "q4", label: "4-bit", bitsPerParameter: 4, packingOverheadRatio: 0.1 },
    ]);
    expect(entry.cloudPricing).toMatchObject({
      id: "local.price.private-8b",
      modelId: "local.model.private-8b",
      provider: "Example API",
      sourceUrl: "https://example.com/pricing",
      lastUpdated: "2026-08-11",
      currency: "USD",
    });
    expect("intelligenceScore" in entry.model).toBe(false);
  });

  it("rejects enabled cloud pricing without an explicit source", () => {
    const draft = createDefaultLocalModelDraft(catalogs, new Date(timestamp));
    Object.assign(draft, {
      totalParametersB: 8,
      activeParametersB: 8,
      contextWindowTokens: 4096,
    });
    Object.assign(draft.cloudPricing, {
      enabled: true,
      provider: "Example API",
      inputPricePerMillionTokens: 1,
      outputPricePerMillionTokens: 2,
      sourceUrl: "",
    });
    expect(() => buildLocalModelLibraryEntry(draft, timestamp)).toThrow();
  });

  it("adds multiple records immutably, rejects replacement by collision, deletes and clears", () => {
    const empty = createEmptyLocalModelLibrary(timestamp);
    const first = addLocalModel(empty, modelEntry("one"), timestamp);
    const second = addLocalModel(first, modelEntry("two"), timestamp);

    expect(empty.entries).toHaveLength(0);
    expect(second.entries.map((entry) => entry.model.id)).toEqual([
      "local.model.one",
      "local.model.two",
    ]);
    expect(() => addLocalModel(second, modelEntry("one"), timestamp)).toThrow(
      LocalModelLibraryError,
    );
    expect(deleteLocalModel(second, "local.model.one", timestamp).entries).toHaveLength(1);
    expect(clearLocalModelLibrary(timestamp).entries).toEqual([]);
  });

  it("updates only an existing stable ID while preserving createdAt", () => {
    const createdAt = "2026-08-10T00:00:00.000Z";
    const updatedAt = "2026-08-12T00:00:00.000Z";
    const existing = modelEntry("editable", { pricing: true });
    existing.createdAt = createdAt;
    existing.updatedAt = createdAt;
    const library = addLocalModel(
      createEmptyLocalModelLibrary(createdAt),
      existing,
      createdAt,
    );
    const replacement = modelEntry("editable", { pricing: false });
    replacement.model.name = "Edited model";
    const updated = updateLocalModel(
      library,
      "local.model.editable",
      replacement,
      updatedAt,
    );

    expect(updated.updatedAt).toBe(updatedAt);
    expect(updated.entries[0]).toMatchObject({
      createdAt,
      updatedAt,
      model: { id: "local.model.editable", name: "Edited model" },
    });
    expect(updated.entries[0]?.cloudPricing).toBeUndefined();
    expect(library.entries[0]?.model.name).not.toBe("Edited model");

    expect(() =>
      updateLocalModel(library, "local.model.editable", modelEntry("changed-id"), updatedAt),
    ).toThrowError(/cannot change/);
    expect(() =>
      updateLocalModel(library, "local.model.missing", modelEntry("missing"), updatedAt),
    ).toThrowError(/does not exist/);
  });

  it("round-trips complete entries to editable drafts with and without cloud pricing", () => {
    const pricedEntry = modelEntry("round-trip", { pricing: true });
    const pricedDraft = localModelEntryToDraft(pricedEntry);
    const rebuilt = buildLocalModelLibraryEntry(pricedDraft, "2026-08-13T00:00:00.000Z");
    expect(rebuilt.model).toEqual(pricedEntry.model);
    expect(rebuilt.cloudPricing).toEqual(pricedEntry.cloudPricing);

    const modelOnly = modelEntry("round-trip-model-only");
    const modelOnlyDraft = localModelEntryToDraft(modelOnly);
    expect(modelOnlyDraft.cloudPricing.enabled).toBe(false);
    expect(buildLocalModelLibraryEntry(modelOnlyDraft, timestamp).cloudPricing).toBeUndefined();
  });

  it("round-trips versioned browser storage and rejects incompatible input at the Zod boundary", () => {
    const storage = new MemoryStorage();
    const library = addLocalModel(
      createEmptyLocalModelLibrary(timestamp),
      modelEntry("stored"),
      timestamp,
    );
    writeLocalModelLibrary(library, storage);
    expect(readLocalModelLibrary(storage)).toEqual({ library, issue: null });

    storage.setItem(
      LOCAL_MODEL_LIBRARY_STORAGE_KEY,
      JSON.stringify({ ...library, schemaVersion: 2 }),
    );
    const incompatible = readLocalModelLibrary(storage);
    expect(incompatible.library.entries).toEqual([]);
    expect(incompatible.issue?.code).toBe("invalid-value");
  });

  it("exports and strictly parses standalone JSON with a 4 MiB boundary", () => {
    const library = addLocalModel(
      createEmptyLocalModelLibrary(timestamp),
      modelEntry("portable", { pricing: true }),
      timestamp,
    );
    expect(LOCAL_MODEL_LIBRARY_MAX_BYTES).toBe(4 * 1024 * 1024);
    const json = serializeLocalModelLibrary(library);
    expect(parseLocalModelLibraryJson(json)).toEqual(library);
    expect(() => parseLocalModelLibraryJson(json, { maxBytes: 10 })).toThrowError(
      /limit/,
    );
    expect(() => parseLocalModelLibraryJson("{not json}")).toThrow(
      LocalModelLibraryError,
    );
  });

  it("creates a strict embeddable model section for a combined Browser Library Pack", () => {
    const library = addLocalModel(
      createEmptyLocalModelLibrary(timestamp),
      modelEntry("combined-pack"),
      timestamp,
    );
    const section = createBrowserLibraryModelsSection(library);
    expect(parseBrowserLibraryModelsSection(section)).toEqual(section);
    expect(() =>
      parseBrowserLibraryModelsSection({ ...section, unexpected: true }),
    ).toThrow();
  });

  it("rejects corrupt quantization and price references instead of silently rebinding them", () => {
    const storage = new MemoryStorage();
    const entry = modelEntry("broken-reference", { pricing: true });
    const invalidQuantization = structuredClone(entry);
    invalidQuantization.model.recommendedQuantizationId = "not-in-model";
    storage.setItem(
      LOCAL_MODEL_LIBRARY_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, updatedAt: timestamp, entries: [invalidQuantization] }),
    );
    expect(readLocalModelLibrary(storage).issue?.code).toBe("invalid-value");

    const invalidPricing = structuredClone(entry);
    invalidPricing.cloudPricing!.modelId = "local.model.some-other-model";
    storage.setItem(
      LOCAL_MODEL_LIBRARY_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, updatedAt: timestamp, entries: [invalidPricing] }),
    );
    expect(readLocalModelLibrary(storage).issue?.code).toBe("invalid-value");
  });

  it("explicitly rejects a local model when a switched Data Pack lacks its capability tier", () => {
    const library = addLocalModel(
      createEmptyLocalModelLibrary(timestamp),
      modelEntry("future-tier", { tier: "no-longer-present" }),
      timestamp,
    );
    const result = reconcileLocalModelLibrary(library, catalogs);
    expect(result.library.entries).toEqual([]);
    expect(result.issues).toMatchObject([
      {
        code: "capability-tier-not-in-data-pack",
        modelId: "local.model.future-tier",
        resolution: "reject-local-model",
      },
    ]);
  });

  it("never overwrites a Data Pack model or price with a colliding local ID", () => {
    const entry = modelEntry("collision", { pricing: true });
    const library: LocalModelLibrary = {
      schemaVersion: 1,
      updatedAt: timestamp,
      entries: [entry],
    };
    const modelCollision: NormalizedCatalogs = {
      ...catalogs,
      models: [...catalogs.models, entry.model],
    };
    const rejected = reconcileLocalModelLibrary(library, modelCollision);
    expect(rejected.library.entries).toEqual([]);
    expect(rejected.issues[0]?.code).toBe("model-id-conflicts-with-data-pack");

    const priceCollision: NormalizedCatalogs = {
      ...catalogs,
      cloudPricing: [...catalogs.cloudPricing, entry.cloudPricing!],
    };
    const modelOnly = reconcileLocalModelLibrary(library, priceCollision);
    expect(modelOnly.library.entries[0]?.model.id).toBe(entry.model.id);
    expect(modelOnly.library.entries[0]?.cloudPricing).toBeUndefined();
    expect(modelOnly.issues[0]?.code).toBe("pricing-id-conflicts-with-data-pack");
  });

  it("merges local models and prices for selection/calculation without inventing benchmarks", () => {
    const library = addLocalModel(
      createEmptyLocalModelLibrary(timestamp),
      modelEntry("overlay", { pricing: true }),
      timestamp,
    );
    const merged = mergeLocalModelLibraryIntoCatalogs(catalogs, library);
    expect(merged.catalogs.models.at(-1)?.id).toBe("local.model.overlay");
    expect(merged.catalogs.cloudPricing.at(-1)?.id).toBe("local.price.overlay");
    expect(
      merged.catalogs.modelBenchmarks.some(
        (benchmark) => benchmark.modelId === "local.model.overlay",
      ),
    ).toBe(false);
    expect(removeLocalModelLibraryOverlay(merged.catalogs).models).toEqual(catalogs.models);
  });

  it("omits browser-local overlay records from a Full Data Pack export", () => {
    const library = addLocalModel(
      createEmptyLocalModelLibrary(timestamp),
      modelEntry("not-exported", { pricing: true }),
      timestamp,
    );
    const merged = mergeLocalModelLibraryIntoCatalogs(catalogs, library).catalogs;
    const pack = createPortableDataPack(merged, new Date(timestamp));

    expect(pack.catalogs.models.data.some((model) => model.id.startsWith("local.model."))).toBe(false);
    expect(
      pack.catalogs.cloudPricing.data.some((pricing) => pricing.id.startsWith("local.price.")),
    ).toBe(false);
    expect(pack.catalogs.models.data).toHaveLength(catalogs.models.length);
  });
});
