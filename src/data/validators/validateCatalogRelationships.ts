import type { CatalogKey, NormalizedCatalogs } from "../../types";

export interface CatalogValidationIssue {
  severity: "error" | "warning";
  code: string;
  catalog: CatalogKey;
  path?: string;
  message: string;
}

const EXPECTED_CATALOG_IDS: Record<CatalogKey, string> = {
  models: "models",
  modelBenchmarks: "model-benchmarks",
  gpus: "gpus",
  inferenceProfiles: "inference-profiles",
  cloudPricing: "cloud-pricing",
  assumptions: "assumptions",
  presets: "presets",
  systems: "desktop-systems",
  exchangeRates: "exchange-rates",
};

export function validateCatalogRelationships(
  catalogs: NormalizedCatalogs,
): CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = [];

  for (const [key, expectedId] of Object.entries(EXPECTED_CATALOG_IDS) as Array<
    [CatalogKey, string]
  >) {
    const actualId = catalogs.metadata[key].catalogId;
    if (actualId !== expectedId) {
      issues.push({
        severity: "error",
        code: "CATALOG_ID_MISMATCH",
        catalog: key,
        path: "catalogId",
        message: `Expected catalogId '${expectedId}', received '${actualId}'.`,
      });
    }
  }

  const models = new Map(catalogs.models.map((model) => [model.id, model]));
  const gpus = new Map(catalogs.gpus.map((gpu) => [gpu.id, gpu]));
  const capabilityTierIds = new Set(
    catalogs.assumptions.capabilityTiers.map((tier) => tier.id),
  );
  const useCaseIds = new Set(
    Object.keys(catalogs.assumptions.simpleModeMappings.useCases),
  );
  const usageFrequencyIds = new Set(
    Object.keys(catalogs.assumptions.simpleModeMappings.usageFrequency),
  );

  for (const model of catalogs.models) {
    if (!capabilityTierIds.has(model.capabilityTierId)) {
      issues.push({
        severity: "error",
        code: "UNKNOWN_MODEL_CAPABILITY_TIER",
        catalog: "models",
        path: `${model.id}.capabilityTierId`,
        message: `Model '${model.id}' references unknown capability tier '${model.capabilityTierId}'.`,
      });
    }
  }

  for (const gpu of catalogs.gpus) {
    if (new Set(gpu.supportedCounts).size !== gpu.supportedCounts.length) {
      issues.push({
        severity: "error",
        code: "DUPLICATE_GPU_COUNT",
        catalog: "gpus",
        path: `${gpu.id}.supportedCounts`,
        message: `GPU '${gpu.id}' declares a supported count more than once.`,
      });
    }
    if (!gpu.supportsTensorParallel && gpu.supportedCounts.some((count) => count > 1)) {
      issues.push({
        severity: "error",
        code: "UNSUPPORTED_TENSOR_PARALLEL_COUNT",
        catalog: "gpus",
        path: `${gpu.id}.supportedCounts`,
        message: `GPU '${gpu.id}' cannot advertise multi-GPU counts when tensor parallelism is disabled.`,
      });
    }
    for (const count of gpu.supportedCounts) {
      if (catalogs.assumptions.multiGpuEfficiency[gpu.interconnect][String(count)] === undefined) {
        issues.push({
          severity: "warning",
          code: "MISSING_MULTI_GPU_EFFICIENCY",
          catalog: "assumptions",
          path: `multiGpuEfficiency.${gpu.interconnect}.${count}`,
          message: `No exact efficiency is configured for '${gpu.id}' count ${count}; calculations will use the conservative 1× aggregate fallback.`,
        });
      }
    }
  }

  for (const profile of catalogs.inferenceProfiles) {
    const model = models.get(profile.modelId);
    const gpu = gpus.get(profile.gpuId);

    if (!model) {
      issues.push({
        severity: "error",
        code: "UNKNOWN_PROFILE_MODEL",
        catalog: "inferenceProfiles",
        path: `${profile.id}.modelId`,
        message: `Inference profile '${profile.id}' references unknown model '${profile.modelId}'.`,
      });
    } else if (
      !model.quantizations.some(
        (quantization) => quantization.id === profile.quantizationId,
      )
    ) {
      issues.push({
        severity: "error",
        code: "UNKNOWN_PROFILE_QUANTIZATION",
        catalog: "inferenceProfiles",
        path: `${profile.id}.quantizationId`,
        message: `Inference profile '${profile.id}' references unknown quantization '${profile.quantizationId}'.`,
      });
    }

    if (!gpu) {
      issues.push({
        severity: "error",
        code: "UNKNOWN_PROFILE_GPU",
        catalog: "inferenceProfiles",
        path: `${profile.id}.gpuId`,
        message: `Inference profile '${profile.id}' references unknown GPU '${profile.gpuId}'.`,
      });
    } else if (!gpu.supportedCounts.includes(profile.gpuCount)) {
      issues.push({
        severity: "error",
        code: "UNSUPPORTED_PROFILE_GPU_COUNT",
        catalog: "inferenceProfiles",
        path: `${profile.id}.gpuCount`,
        message: `Inference profile '${profile.id}' uses unsupported count ${profile.gpuCount} for '${profile.gpuId}'.`,
      });
    }
  }

  for (const benchmark of catalogs.modelBenchmarks) {
    if (!models.has(benchmark.modelId)) {
      issues.push({
        severity: "error",
        code: "UNKNOWN_BENCHMARK_MODEL",
        catalog: "modelBenchmarks",
        path: `${benchmark.id}.modelId`,
        message: `Benchmark '${benchmark.id}' references unknown model '${benchmark.modelId}'.`,
      });
    }
  }

  for (const pricing of catalogs.cloudPricing) {
    if (pricing.modelId && !models.has(pricing.modelId)) {
      issues.push({
        severity: "error",
        code: "UNKNOWN_PRICING_MODEL",
        catalog: "cloudPricing",
        path: `${pricing.id}.modelId`,
        message: `Cloud price '${pricing.id}' references unknown model '${pricing.modelId}'.`,
      });
    }
  }

  for (const system of catalogs.systems) {
    const performance = system.performance;
    if (!performance) continue;
    const model = models.get(performance.modelId);
    if (!model) {
      issues.push({
        severity: "error",
        code: "UNKNOWN_SYSTEM_PERFORMANCE_MODEL",
        catalog: "systems",
        path: `${system.id}.performance.modelId`,
        message: `Desktop system '${system.id}' references unknown model '${performance.modelId}'.`,
      });
    } else if (
      performance.quantizationId &&
      !model.quantizations.some(
        (quantization) => quantization.id === performance.quantizationId,
      )
    ) {
      issues.push({
        severity: "error",
        code: "UNKNOWN_SYSTEM_PERFORMANCE_QUANTIZATION",
        catalog: "systems",
        path: `${system.id}.performance.quantizationId`,
        message: `Desktop system '${system.id}' references unknown quantization '${performance.quantizationId}'.`,
      });
    }
  }

  for (const preset of catalogs.presets) {
    if (preset.workload.useCase && !useCaseIds.has(preset.workload.useCase)) {
      issues.push({
        severity: "error",
        code: "UNKNOWN_PRESET_USE_CASE",
        catalog: "presets",
        path: `${preset.id}.workload.useCase`,
        message: `Preset '${preset.id}' references unknown use-case mapping '${preset.workload.useCase}'.`,
      });
    }
    if (
      preset.workload.usageFrequency &&
      !usageFrequencyIds.has(preset.workload.usageFrequency)
    ) {
      issues.push({
        severity: "error",
        code: "UNKNOWN_PRESET_USAGE_FREQUENCY",
        catalog: "presets",
        path: `${preset.id}.workload.usageFrequency`,
        message: `Preset '${preset.id}' references unknown usage-frequency mapping '${preset.workload.usageFrequency}'.`,
      });
    }
    if (
      preset.workload.capabilityRequirementTierId &&
      !capabilityTierIds.has(preset.workload.capabilityRequirementTierId)
    ) {
      issues.push({
        severity: "error",
        code: "UNKNOWN_PRESET_CAPABILITY_TIER",
        catalog: "presets",
        path: `${preset.id}.workload.capabilityRequirementTierId`,
        message: `Preset '${preset.id}' references unknown capability tier '${preset.workload.capabilityRequirementTierId}'.`,
      });
    }
  }

  if (catalogs.models.length === 0) {
    issues.push({
      severity: "error",
      code: "EMPTY_MODELS",
      catalog: "models",
      message: "At least one model is required.",
    });
  }
  if (catalogs.gpus.length === 0) {
    issues.push({
      severity: "error",
      code: "EMPTY_GPUS",
      catalog: "gpus",
      message: "At least one GPU is required.",
    });
  }

  return issues;
}
