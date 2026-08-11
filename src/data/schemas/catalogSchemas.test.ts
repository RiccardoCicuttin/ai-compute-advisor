import { describe, expect, it } from "vitest";
import assumptions from "../../../public/data/assumptions.json";
import cloudPricing from "../../../public/data/cloud-pricing.json";
import gpus from "../../../public/data/gpus.json";
import inferenceProfiles from "../../../public/data/inference-profiles.json";
import manifest from "../../../public/data/manifest.json";
import modelBenchmarks from "../../../public/data/model-benchmarks.json";
import models from "../../../public/data/models.json";
import presets from "../../../public/data/presets.json";
import systems from "../../../public/data/systems.json";
import exchangeRates from "../../../public/data/exchange-rates.json";
import {
  CatalogIntegrityError,
  GpuRecordSchema,
  ModelRecordSchema,
  PresetRecordSchema,
  parseCatalogBundle,
} from "./catalogSchemas";

const rawBundle = {
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
};

describe("catalog schemas", () => {
  it("validates and normalizes every bundled catalog", () => {
    const parsed = parseCatalogBundle(rawBundle);
    expect(parsed.dataVersion).toBe("2026.08-sample.3");
    expect(parsed.models.length).toBeGreaterThanOrEqual(5);
    expect(parsed.gpus.length).toBeGreaterThanOrEqual(4);
    expect(parsed.systems.length).toBeGreaterThanOrEqual(4);
    expect(parsed.exchangeRates.base).toBe("USD");
    expect(parsed.assumptions.currency).toBe("USD");
    expect(parsed.metadata.cloudPricing.lastUpdated).toBe("2026-08-10");
  });

  it("rejects broken cross-catalog references", () => {
    const broken = structuredClone(rawBundle);
    broken.inferenceProfiles.data[0]!.modelId = "missing-model";
    expect(() => parseCatalogBundle(broken)).toThrow(CatalogIntegrityError);
  });

  it("rejects unknown data-pack capability tier references", () => {
    const broken = structuredClone(rawBundle);
    broken.models.data[0]!.capabilityTierId = "not-configured";
    expect(() => parseCatalogBundle(broken)).toThrow(CatalogIntegrityError);
  });

  it("uses total and active parameters independently for MoE records", () => {
    const parsed = parseCatalogBundle(rawBundle);
    const model = parsed.models.find((candidate) => candidate.modelType === "moe");
    expect(model).toBeDefined();
    expect(model!.totalParametersB).toBeGreaterThan(model!.activeParametersB);
  });

  it("accepts a dynamic positive GPU count", () => {
    const parsed = GpuRecordSchema.parse({
      ...gpus.data[0],
      supportedCounts: [1, 3, 8],
    });
    expect(parsed.supportedCounts).toEqual([1, 3, 8]);
    expect(() =>
      GpuRecordSchema.parse({ ...gpus.data[0], supportedCounts: [0] }),
    ).toThrow();
  });

  it("migrates legacy model and preset fields to canonical capability/localized fields", () => {
    const canonicalModel = models.data[0]!;
    const { capabilityTierId, ...legacyModel } = canonicalModel;
    const parsedModel = ModelRecordSchema.parse({
      ...legacyModel,
      intelligenceClass: capabilityTierId,
    });
    expect(parsedModel.capabilityTierId).toBe(capabilityTierId);
    expect("intelligenceClass" in parsedModel).toBe(false);

    const canonicalPreset = presets.data[0]!;
    const parsedPreset = PresetRecordSchema.parse({
      ...canonicalPreset,
      name: "Legacy preset",
      description: "Legacy description",
      workload: {
        ...canonicalPreset.workload,
        capabilityRequirementTierId: undefined,
        intelligenceRequirement: "balanced",
      },
    });
    expect(parsedPreset.name).toEqual({ en: "Legacy preset", "zh-CN": "Legacy preset" });
    expect(parsedPreset.workload.capabilityRequirementTierId).toBe("balanced");
  });
});
