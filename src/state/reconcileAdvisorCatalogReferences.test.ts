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
import { parseCatalogBundle } from "../data/schemas";
import type { AdvisorConfig, NormalizedCatalogs } from "../types";
import { createDefaultAdvisorConfig } from "./defaultAdvisorConfig";
import { createDefaultCustomSystemDraft } from "./customSystemDraft";
import { reconcileAdvisorCatalogReferences } from "./reconcileAdvisorCatalogReferences";

function loadCatalogs(): NormalizedCatalogs {
  return parseCatalogBundle({
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
}

function issueCodes(
  result: ReturnType<typeof reconcileAdvisorCatalogReferences>,
) {
  return result.issues.map((issue) => issue.code);
}

describe("reconcileAdvisorCatalogReferences", () => {
  it("reconciles all active catalog references and preserves workload numbers", () => {
    const catalogs = loadCatalogs();
    const nextCatalogs = structuredClone(catalogs);
    const config: AdvisorConfig = structuredClone(
      createDefaultAdvisorConfig(catalogs),
    );

    const previousUseCase = config.workload.useCase;
    const previousFrequency = config.workload.usageFrequency;
    delete nextCatalogs.assumptions.simpleModeMappings.useCases[
      previousUseCase
    ];
    delete nextCatalogs.assumptions.simpleModeMappings.usageFrequency[
      previousFrequency
    ];
    const expectedUseCase = Object.keys(
      nextCatalogs.assumptions.simpleModeMappings.useCases,
    )[0]!;
    const expectedFrequency = Object.keys(
      nextCatalogs.assumptions.simpleModeMappings.usageFrequency,
    )[0]!;
    const expectedCapabilityTier = nextCatalogs.assumptions.capabilityTiers.at(
      -1,
    )!;
    const originalWorkload = structuredClone(config.workload);

    config.presetId = "missing-preset";
    config.workload.capabilityRequirementTierId = "missing-tier";
    config.modelSelection = {
      mode: "manual",
      modelId: "missing-model",
      quantizationId: "missing-quantization",
    };
    config.hardwareSelection = {
      mode: "existing",
      gpuId: "missing-gpu",
      gpuCount: 99,
      systemId: "missing-inactive-system",
    };
    config.economics.cloudPricingId = "missing-cloud-price";
    config.economics.displayCurrency = "JPY";
    config.economics.manualExchangeRateOverride = {
      EUR: 0.9,
      JPY: 150,
    };
    const inputSnapshot = structuredClone(config);

    const result = reconcileAdvisorCatalogReferences(config, nextCatalogs);

    expect(config).toEqual(inputSnapshot);
    expect(result.changed).toBe(true);
    expect(result.config.workload).toEqual({
      ...originalWorkload,
      useCase: expectedUseCase,
      usageFrequency: expectedFrequency,
      capabilityRequirementTierId: expectedCapabilityTier.id,
    });
    expect(result.config.presetId).toBeUndefined();
    expect(result.config.modelSelection).toEqual({ mode: "recommended" });
    expect(result.config.hardwareSelection.mode).toBe("recommended");
    expect(result.config.hardwareSelection.gpuId).toBeUndefined();
    expect(result.config.hardwareSelection.systemId).toBeUndefined();
    expect(result.config.economics.cloudPricingId).not.toBe(
      "missing-cloud-price",
    );
    expect(result.config.economics.displayCurrency).toBe("USD");
    expect(result.config.economics.manualExchangeRateOverride).toEqual({
      EUR: 0.9,
    });
    expect(issueCodes(result)).toEqual(
      expect.arrayContaining([
        "simple-use-case-not-in-assumptions",
        "usage-frequency-not-in-assumptions",
        "capability-tier-not-in-catalog",
        "preset-not-in-catalog",
        "model-not-in-catalog",
        "gpu-not-in-catalog",
        "system-not-in-catalog",
        "cloud-pricing-not-in-catalog",
        "currency-not-in-catalog",
        "exchange-rate-override-not-in-catalog",
      ]),
    );

    const secondPass = reconcileAdvisorCatalogReferences(
      result.config,
      nextCatalogs,
    );
    expect(secondPass).toEqual({
      config: result.config,
      issues: [],
      changed: false,
    });
  });

  it("keeps valid manual products while repairing their dependent IDs", () => {
    const catalogs = loadCatalogs();
    const config = structuredClone(createDefaultAdvisorConfig(catalogs));
    const model = catalogs.models[0]!;
    const gpu = catalogs.gpus[0]!;
    const fallbackGpuCount = gpu.supportedCounts.includes(1)
      ? 1
      : gpu.supportedCounts[0]!;
    const customSystem = createDefaultCustomSystemDraft();
    customSystem.performanceModelId = "missing-performance-model";
    customSystem.performanceQuantizationId = "missing-quantization";
    customSystem.performanceContextTokens = 4_096;
    customSystem.performanceConcurrency = 2;
    customSystem.effectiveTokensPerSecond = 25;
    customSystem.timeToFirstTokenSeconds = 0.8;

    config.modelSelection = {
      mode: "manual",
      modelId: model.id,
      quantizationId: "missing-quantization",
    };
    config.hardwareSelection = {
      mode: "existing",
      gpuId: gpu.id,
      gpuCount: Math.max(...gpu.supportedCounts) + 100,
      customSystem,
    };

    const result = reconcileAdvisorCatalogReferences(config, catalogs);

    expect(result.config.modelSelection).toEqual({
      mode: "manual",
      modelId: model.id,
      quantizationId: model.recommendedQuantizationId,
    });
    expect(result.config.hardwareSelection).toMatchObject({
      mode: "existing",
      gpuId: gpu.id,
      gpuCount: fallbackGpuCount,
    });
    expect(result.config.hardwareSelection.customSystem).toMatchObject({
      performanceModelId: null,
      performanceQuantizationId: null,
      performanceContextTokens: null,
      performanceConcurrency: null,
      effectiveTokensPerSecond: null,
      timeToFirstTokenSeconds: null,
    });
    expect(issueCodes(result)).toEqual(
      expect.arrayContaining([
        "quantization-not-in-model",
        "gpu-count-not-supported",
        "custom-performance-reference-invalid",
      ]),
    );
  });

  it("does not silently replace a removed selected desktop system", () => {
    const catalogs = loadCatalogs();
    const config = structuredClone(createDefaultAdvisorConfig(catalogs));
    config.hardwareSelection = {
      mode: "system",
      systemInputMode: "catalog",
      systemId: "missing-system",
      gpuCount: 1,
    };

    const result = reconcileAdvisorCatalogReferences(config, catalogs);

    expect(result.config.hardwareSelection).toEqual({
      mode: "recommended",
      gpuCount: 1,
    });
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "system-not-in-catalog",
        resolution: "use-recommended",
      }),
    ]);
  });

  it("clears cached product IDs when recommendation modes are authoritative", () => {
    const catalogs = loadCatalogs();
    const config = structuredClone(createDefaultAdvisorConfig(catalogs));
    const model = catalogs.models[0]!;
    const gpu = catalogs.gpus[0]!;
    config.modelSelection = {
      mode: "recommended",
      modelId: model.id,
      quantizationId: model.recommendedQuantizationId,
    };
    config.hardwareSelection = {
      mode: "recommended",
      gpuId: gpu.id,
      gpuCount: gpu.supportedCounts[0]!,
    };

    const result = reconcileAdvisorCatalogReferences(config, catalogs);

    expect(result.config.modelSelection).toEqual({ mode: "recommended" });
    expect(result.config.hardwareSelection).toEqual({
      mode: "recommended",
      gpuCount: gpu.supportedCounts[0],
    });
    expect(issueCodes(result)).toEqual([
      "recommended-model-reference-cleared",
      "recommended-gpu-reference-cleared",
    ]);
  });
});
