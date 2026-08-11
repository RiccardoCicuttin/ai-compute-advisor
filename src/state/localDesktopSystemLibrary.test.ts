import { describe, expect, it } from "vitest";
import type { DesktopSystemRecord } from "../systems";
import type { CustomDesktopSystemDraft, ModelRecord } from "../types";
import { LocalDesktopSystemRecordSchema } from "../data/schemas";
import { createDefaultCustomSystemDraft } from "./customSystemDraft";
import {
  LOCAL_DESKTOP_SYSTEM_LIBRARY_STORAGE_KEY,
  LocalDesktopSystemLibraryError,
  addLocalDesktopSystem,
  clearLocalDesktopSystemLibrary,
  createBrowserLibrarySystemsSection,
  createEmptyLocalDesktopSystemLibrary,
  deleteLocalDesktopSystem,
  draftToLocalDesktopSystemRecord,
  mergeLocalDesktopSystemLibrary,
  parseLocalDesktopSystemLibraryJson,
  parseBrowserLibrarySystemsSection,
  readLocalDesktopSystemLibrary,
  reconcileLocalDesktopSystemLibrary,
  serializeLocalDesktopSystemLibrary,
  systemRecordToDraft,
  updateLocalDesktopSystem,
  writeLocalDesktopSystemLibrary,
  type LocalDesktopSystemLibraryStorage,
  type LocalDesktopSystemRecord,
} from "./localDesktopSystemLibrary";

const model: ModelRecord = {
  id: "test-model",
  name: "Test model",
  provider: "Test",
  modelType: "dense",
  totalParametersB: 8,
  activeParametersB: 8,
  contextWindowTokens: 32_768,
  recommendedQuantizationId: "q4",
  quantizations: [
    {
      id: "q4",
      label: "4-bit",
      bitsPerParameter: 4,
      packingOverheadRatio: 0.1,
    },
  ],
  capabilityTierId: "balanced",
  reasoning: false,
  modalities: ["text"],
  openWeight: true,
  commercialUse: "allowed",
};

function completeDraft(
  patch: Partial<CustomDesktopSystemDraft> = {},
): CustomDesktopSystemDraft {
  return {
    ...createDefaultCustomSystemDraft(),
    name: "Local inference workstation",
    acceleratorType: "Vendor Matrix Engine",
    acceleratorBehaviorCategory: "ai-accelerator",
    acceleratorName: "VME-1",
    acceleratorCount: 2,
    supportsModelSharding: true,
    idlePowerWatts: 90,
    loadPowerWatts: 540,
    purchasePriceUSD: 5_500,
    tops: 120,
    topsPrecision: "INT8",
    runtimeSupportStatus: "supported",
    runtimeSupportMethod: "vendor-documented",
    runtimeNames: "ONNX Runtime, llama.cpp, ONNX Runtime",
    effectiveTokensPerSecond: 31,
    timeToFirstTokenSeconds: 0,
    performanceModelId: model.id,
    performanceQuantizationId: "q4",
    performanceContextTokens: 4_096,
    performanceConcurrency: 2,
    ...patch,
  };
}

function recordFromDraft(
  patch: Partial<CustomDesktopSystemDraft> = {},
  id = "local.system.fixture",
): LocalDesktopSystemRecord {
  const result = draftToLocalDesktopSystemRecord(completeDraft(patch), {
    models: [model],
    id,
    now: "2026-08-11T00:00:00.000Z",
  });
  if (!result.success) throw new Error(JSON.stringify(result.issues));
  return result.record;
}

function createMemoryStorage(initial?: string): LocalDesktopSystemLibraryStorage & {
  value(): string | null;
} {
  let value = initial ?? null;
  return {
    getItem: (key) =>
      key === LOCAL_DESKTOP_SYSTEM_LIBRARY_STORAGE_KEY ? value : null,
    setItem: (key, nextValue) => {
      if (key === LOCAL_DESKTOP_SYSTEM_LIBRARY_STORAGE_KEY) value = nextValue;
    },
    removeItem: (key) => {
      if (key === LOCAL_DESKTOP_SYSTEM_LIBRARY_STORAGE_KEY) value = null;
    },
    value: () => value,
  };
}

describe("draftToLocalDesktopSystemRecord", () => {
  it("does not allow unavailable economics in the browser-local library", () => {
    const record = recordFromDraft();

    for (const field of [
      "systemIdleWatts",
      "systemLoadWatts",
      "purchasePriceUSD",
    ] as const) {
      expect(
        LocalDesktopSystemRecordSchema.safeParse({
          ...record,
          [field]: null,
        }).success,
        field,
      ).toBe(false);
    }
  });

  it("preserves whole-system, runtime, TOPS and exact model-bound performance fields", () => {
    const result = draftToLocalDesktopSystemRecord(completeDraft(), {
      models: [model],
      idFactory: () => "stable-id",
      now: "2026-08-11T12:00:00.000Z",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.record).toMatchObject({
      id: "local.system.stable-id",
      vendor: "Custom",
      acceleratorType: "Vendor Matrix Engine",
      acceleratorBehaviorCategory: "ai-accelerator",
      acceleratorModel: "VME-1",
      acceleratorCount: 2,
      memoryArchitecture: "dedicated",
      dedicatedMemoryGBPerDevice: 24,
      systemIdleWatts: 90,
      systemLoadWatts: 540,
      purchasePriceUSD: 5_500,
      peakTops: { value: 120, precision: "INT8" },
      runtimeSupport: {
        status: "supported",
        runtimes: ["ONNX Runtime", "llama.cpp"],
        method: "vendor-documented",
      },
      performance: {
        modelId: "test-model",
        quantizationId: "q4",
        contextTokens: 4_096,
        concurrency: 2,
        effectiveTokensPerSecond: 31,
        timeToFirstTokenSeconds: 0,
        method: "estimated",
      },
      dataQuality: "directional",
      lastUpdated: "2026-08-11",
    });
  });

  it("keeps a stable ID during edits and never derives TPS from TOPS", () => {
    const result = draftToLocalDesktopSystemRecord(
      completeDraft({
        name: "Renamed workstation",
        effectiveTokensPerSecond: null,
        timeToFirstTokenSeconds: null,
        performanceModelId: null,
        performanceQuantizationId: null,
        performanceContextTokens: null,
        performanceConcurrency: null,
      }),
      {
        models: [model],
        id: "local.system.existing-id",
        idFactory: () => "must-not-be-used",
        now: "2026-08-11",
      },
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.record.id).toBe("local.system.existing-id");
    expect(result.record.name).toBe("Renamed workstation");
    expect(result.record.peakTops).toEqual({ value: 120, precision: "INT8" });
    expect(result.record.performance).toBeUndefined();
  });

  it("round-trips a saved local record through an editable draft", () => {
    const record = recordFromDraft();
    const restoredDraft = systemRecordToDraft(record);
    const rebuilt = draftToLocalDesktopSystemRecord(restoredDraft, {
      models: [model],
      id: record.id,
      now: record.lastUpdated,
    });

    expect(rebuilt).toEqual({ success: true, record });
  });

  it("strictly rejects incomplete bindings and invalid whole-system relationships", () => {
    const incompleteBinding = draftToLocalDesktopSystemRecord(
      completeDraft({ performanceQuantizationId: null }),
      { models: [model], idFactory: () => "binding", now: "2026-08-11" },
    );
    expect(incompleteBinding.success).toBe(false);
    if (!incompleteBinding.success) {
      expect(incompleteBinding.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "performanceQuantizationId" }),
        ]),
      );
    }

    const invalidUnified = draftToLocalDesktopSystemRecord(
      completeDraft({
        memoryArchitecture: "unified",
        dedicatedMemoryPerUnitGB: null,
        systemRamGB: 64,
        allocatableUnifiedMemoryGB: 96,
        loadPowerWatts: 50,
        idlePowerWatts: 80,
        runtimeSupportStatus: "supported",
        runtimeNames: "",
      }),
      { models: [model], idFactory: () => "unified", now: "2026-08-11" },
    );
    expect(invalidUnified.success).toBe(false);
    if (!invalidUnified.success) {
      expect(invalidUnified.issues.map((item) => item.path)).toEqual(
        expect.arrayContaining([
          "allocatableUnifiedMemoryGB",
          "loadPowerWatts",
          "runtimeNames",
        ]),
      );
    }
  });
});

describe("local desktop system library persistence and CRUD", () => {
  it("adds, updates, deletes and clears without mutating Data Pack IDs", () => {
    const empty = createEmptyLocalDesktopSystemLibrary(
      "2026-08-11T00:00:00.000Z",
    );
    const record = recordFromDraft();
    const added = addLocalDesktopSystem(empty, record, {
      reservedSystemIds: ["catalog-system"],
      updatedAt: "2026-08-11T01:00:00.000Z",
    });
    expect(empty.records).toEqual([]);
    expect(added.records).toEqual([record]);

    const renamed = { ...record, name: "Renamed local workstation" };
    const updated = updateLocalDesktopSystem(added, renamed, {
      updatedAt: "2026-08-11T02:00:00.000Z",
    });
    expect(updated.records[0]).toMatchObject({
      id: record.id,
      name: "Renamed local workstation",
    });
    expect(() => addLocalDesktopSystem(updated, renamed)).toThrowError(
      expect.objectContaining({ code: "duplicate-system" }),
    );

    const builtInDelete = deleteLocalDesktopSystem(
      updated,
      "catalog-system",
      { updatedAt: "2026-08-11T03:00:00.000Z" },
    );
    expect(builtInDelete).toEqual(updated);
    const deleted = deleteLocalDesktopSystem(updated, record.id, {
      updatedAt: "2026-08-11T03:00:00.000Z",
    });
    expect(deleted.records).toEqual([]);
    expect(clearLocalDesktopSystemLibrary("2026-08-11").records).toEqual([]);
  });

  it("round-trips storage and standalone JSON, with corrupt values falling back safely", () => {
    const library = addLocalDesktopSystem(
      createEmptyLocalDesktopSystemLibrary("2026-08-11"),
      recordFromDraft(),
      { updatedAt: "2026-08-11T01:00:00.000Z" },
    );
    const storage = createMemoryStorage();
    writeLocalDesktopSystemLibrary(library, storage);
    expect(readLocalDesktopSystemLibrary(storage)).toEqual({
      library,
      issue: null,
    });

    const exported = serializeLocalDesktopSystemLibrary(library, {
      pretty: true,
    });
    expect(parseLocalDesktopSystemLibraryJson(exported)).toEqual(library);

    const section = createBrowserLibrarySystemsSection(library);
    expect(parseBrowserLibrarySystemsSection(section)).toEqual(section);
    expect(() =>
      parseBrowserLibrarySystemsSection({ ...section, unexpected: true }),
    ).toThrow();

    const badJson = readLocalDesktopSystemLibrary(createMemoryStorage("{"));
    expect(badJson.library.records).toEqual([]);
    expect(badJson.issue?.code).toBe("invalid-json");

    const wrongVersion = readLocalDesktopSystemLibrary(
      createMemoryStorage(
        JSON.stringify({ schemaVersion: 2, updatedAt: new Date().toISOString(), records: [] }),
      ),
    );
    expect(wrongVersion.library.records).toEqual([]);
    expect(wrongVersion.issue?.code).toBe("invalid-value");
  });

  it("rejects a write failure without changing the previous stored value", () => {
    const previous = "previous-value";
    const storage = createMemoryStorage(previous);
    const failingStorage: LocalDesktopSystemLibraryStorage = {
      getItem: storage.getItem,
      removeItem: storage.removeItem,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    };

    expect(() =>
      writeLocalDesktopSystemLibrary(
        createEmptyLocalDesktopSystemLibrary("2026-08-11"),
        failingStorage,
      ),
    ).toThrowError(LocalDesktopSystemLibraryError);
    expect(storage.value()).toBe(previous);
  });
});

describe("local desktop system catalog reconciliation", () => {
  it("removes stale model or quantization evidence while preserving the whole system", () => {
    const record = recordFromDraft();
    const library = addLocalDesktopSystem(
      createEmptyLocalDesktopSystemLibrary("2026-08-11"),
      record,
      { updatedAt: "2026-08-11" },
    );

    const missingModel = reconcileLocalDesktopSystemLibrary(library, []);
    expect(missingModel.changed).toBe(true);
    expect(missingModel.library.records[0]).toEqual({
      ...record,
      performance: undefined,
    });
    expect(missingModel.library.records[0]).not.toHaveProperty("performance");
    expect(missingModel.library.records[0]).toMatchObject({
      id: record.id,
      purchasePriceUSD: 5_500,
      peakTops: { value: 120, precision: "INT8" },
    });

    const modelWithoutQuantization: ModelRecord = {
      ...model,
      quantizations: [
        {
          id: "q8",
          label: "8-bit",
          bitsPerParameter: 8,
          packingOverheadRatio: 0.1,
        },
      ],
      recommendedQuantizationId: "q8",
    };
    const staleQuantization = reconcileLocalDesktopSystemLibrary(library, [
      modelWithoutQuantization,
    ]);
    expect(staleQuantization.library.records[0]).not.toHaveProperty("performance");
    expect(staleQuantization.issues[0]?.code).toBe(
      "performance-quantization-not-in-active-catalog",
    );
  });

  it("keeps Data Pack records authoritative on an ID collision", () => {
    const local = recordFromDraft();
    const library = addLocalDesktopSystem(
      createEmptyLocalDesktopSystemLibrary("2026-08-11"),
      local,
      { updatedAt: "2026-08-11" },
    );
    const dataPackRecord: DesktopSystemRecord = {
      ...local,
      name: "Authoritative Data Pack system",
      dataQuality: "verified",
      source: { label: "Data Pack" },
    };
    const merged = mergeLocalDesktopSystemLibrary(
      [dataPackRecord],
      library,
      [model],
    );

    expect(merged.systems).toEqual([dataPackRecord]);
    expect(merged.activeLocalSystemIds).toEqual([]);
    expect(merged.issues).toEqual([
      expect.objectContaining({
        code: "system-id-conflicts-with-data-pack",
        resolution: "data-pack-system-wins",
      }),
    ]);
  });
});
