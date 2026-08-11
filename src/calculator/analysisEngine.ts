import type {
  AdvisorConfig,
  AnalysisResult,
  CloudPricingRecord,
  ComputeHardwareRecord,
  EconomicsReadyComputeHardwareRecord,
  InferenceProfileRecord,
  NormalizedCatalogs,
  RecommendationResult,
  WorkloadConfig,
} from "../types";
import { calculateBreakEven } from "./breakEvenCalculator";
import {
  highestCapabilityTierId,
  lowestCapabilityTierId,
} from "./capabilityTiers";
import { calculateCloudCost } from "./cloudCostCalculator";
import { calculateHardwareFit, rankHardwareOptions } from "./hardwareFitCalculator";
import { calculateHybridCost } from "./hybridCostCalculator";
import { calculateLocalCost } from "./localCostCalculator";
import { modelMeetsWorkload, resolveModelRequirement } from "./modelRequirementEngine";
import { buildOpportunityMap } from "./opportunityMapEngine";
import { calculatePerformanceCapacity } from "./performanceCalculator";
import {
  buildDeploymentComparisons,
  createRecommendationTrace,
  recommendDeployment,
  type RecommendationInput,
} from "./recommendationEngine";
import { calculateTokenDemand, resolveSimpleWorkload } from "./tokenCalculator";
import { calculateVramRequirement } from "./vramCalculator";
import { resolveDesktopSystem } from "./desktopSystemCalculator";
import { selectConfigurationFirstModel } from "./configurationFirstModelSelector";

function defaultWorkload(catalogs: NormalizedCatalogs): WorkloadConfig {
  const defaultCapabilityTierId =
    highestCapabilityTierId(catalogs.assumptions.capabilityTiers);
  if (!defaultCapabilityTierId) {
    throw new Error("At least one capability tier is required to create an advisor config.");
  }
  return {
    mode: "simple",
    useCase: "ai-assistant",
    usageFrequency: "daily",
    users: 1,
    privacyRequirement: "medium",
    capabilityRequirementTierId: defaultCapabilityTierId,
    latencyRequirement: "interactive",
    monthlyRequests: 0,
    averageInputTokens: 1,
    averageOutputTokens: 1,
    averageAgentSteps: 1,
    peakConcurrentUsers: 1,
    averageContextLength: 4096,
    peakContextLength: 8192,
    workingHoursPerDay: 8,
    workingDaysPerMonth: 22,
  };
}

export function createDefaultAdvisorConfig(
  catalogs: NormalizedCatalogs,
  presetId = "personal-ai-assistant",
): AdvisorConfig {
  const preset = catalogs.presets.find((candidate) => candidate.id === presetId) ?? catalogs.presets[0];
  const workload = resolveSimpleWorkload(
    { ...defaultWorkload(catalogs), ...(preset?.workload ?? {}) },
    catalogs.assumptions,
  );
  const pricingForRequirement = catalogs.cloudPricing.find((pricing) => {
    const model = pricing.modelId
      ? catalogs.models.find((candidate) => candidate.id === pricing.modelId)
      : undefined;
    return model?.capabilityTierId === workload.capabilityRequirementTierId;
  });

  return {
    stateVersion: 1,
    analysisMode: "workload-first",
    presetId: preset?.id,
    workload,
    modelSelection: { mode: "recommended" },
    hardwareSelection: { mode: "recommended", gpuCount: 1 },
    economics: {
      displayCurrency: "USD",
      hardwareUtilizationRatio: catalogs.assumptions.economics.defaultUtilizationRatio,
      localCoverageRatio: preset?.suggestedLocalCoverageRatio ?? 0.8,
      cloudPricingId: (pricingForRequirement ?? catalogs.cloudPricing[0])?.id,
      cachedInputRatio: catalogs.assumptions.economics.defaultCachedInputRatio,
      electricityPricePerKWh: catalogs.assumptions.economics.electricityPricePerKWh,
      hardwareLifetimeMonths: catalogs.assumptions.economics.hardwareLifetimeMonths,
      maintenanceCostMonthly: catalogs.assumptions.economics.maintenanceCostMonthly,
    },
  };
}

function resolvePricing(
  config: AdvisorConfig,
  catalogs: NormalizedCatalogs,
  selectedModelId: string | null,
): { pricing: CloudPricingRecord | null; warnings: string[] } {
  const selectedModel = selectedModelId
    ? catalogs.models.find((model) => model.id === selectedModelId)
    : undefined;
  if (config.economics.customCloudPricing) {
    return {
      pricing: {
        id: "custom-pricing",
        provider: "Custom pricing",
        modelId: selectedModelId ?? undefined,
        modelName: selectedModel?.name ?? "Custom cloud model",
        currency: "USD",
        inputPricePerMillionTokens:
          config.economics.customCloudPricing.inputPricePerMillionTokens,
        outputPricePerMillionTokens:
          config.economics.customCloudPricing.outputPricePerMillionTokens,
        cachedInputPricePerMillionTokens:
          config.economics.customCloudPricing.cachedInputPricePerMillionTokens,
        lastUpdated: catalogs.metadata.cloudPricing.lastUpdated,
      },
      warnings: [],
    };
  }

  if (!selectedModelId) return { pricing: null, warnings: [] };

  const configuredPricing = catalogs.cloudPricing.find(
    (pricing) => pricing.id === config.economics.cloudPricingId,
  );
  if (configuredPricing?.modelId === selectedModelId) {
    return { pricing: configuredPricing, warnings: [] };
  }

  const matchingPricing = catalogs.cloudPricing.find(
    (pricing) => pricing.modelId === selectedModelId,
  );
  const warnings: string[] = [];
  if (configuredPricing) {
    const configuredBinding = configuredPricing.modelId
      ? `model '${configuredPricing.modelId}'`
      : "no model";
    warnings.push(
      `CLOUD_PRICE_MODEL_MISMATCH: configured cloud price '${configuredPricing.id}' is bound to ${configuredBinding} and was not applied to selected model '${selectedModelId}'.`,
    );
  } else if (config.economics.cloudPricingId) {
    warnings.push(
      `CLOUD_PRICE_NOT_FOUND: configured cloud price '${config.economics.cloudPricingId}' is not present in the active catalog.`,
    );
  }

  if (matchingPricing) {
    if (warnings.length > 0) {
      warnings.push(
        `MODEL_BOUND_CLOUD_PRICE_FALLBACK: using '${matchingPricing.id}', which is explicitly bound to selected model '${selectedModelId}'.`,
      );
    }
    return { pricing: matchingPricing, warnings };
  }

  warnings.push(
    `MODEL_BOUND_CLOUD_PRICE_UNAVAILABLE: no cloud price in the active catalog is bound to selected model '${selectedModelId}'; cloud and hybrid costs are unavailable.`,
  );
  return { pricing: null, warnings };
}

function incompleteRecommendation(): RecommendationResult {
  return {
    status: "incomplete",
    deployment: null,
    matchedRuleId: "incomplete-inputs",
    reasonCodes: ["INCOMPLETE_INPUTS"],
    warnings: [],
    changeConditions: [],
  };
}

function hasHardwareEconomics(
  hardware: ComputeHardwareRecord,
): hardware is EconomicsReadyComputeHardwareRecord {
  return hardware.tdpWatts !== null && hardware.streetPriceUSD !== null;
}

export function calculateAnalysis(
  config: AdvisorConfig,
  catalogs: NormalizedCatalogs,
): AnalysisResult {
  const workload = resolveSimpleWorkload(config.workload, catalogs.assumptions);
  let resolvedConfig: AdvisorConfig = { ...config, workload };
  const tokenDemand = calculateTokenDemand(workload);
  const manualModelId =
    config.modelSelection.mode === "manual" ? config.modelSelection.modelId : undefined;
  const configurationSelection =
    config.analysisMode === "configuration-first" && !manualModelId
      ? selectConfigurationFirstModel({ config, catalogs, workload, tokenDemand })
      : null;
  const requestedModelId = manualModelId ?? configurationSelection?.selectedModelId ?? undefined;
  const modelRequirement = resolveModelRequirement(
    workload,
    catalogs.models,
    catalogs.assumptions.capabilityTiers,
    requestedModelId,
    manualModelId ? "manual" : "configuration",
    {
      inferenceProfiles: catalogs.inferenceProfiles,
      cloudPricing: catalogs.cloudPricing,
    },
  );
  const selectedModel = modelRequirement.selectedModelId
    ? catalogs.models.find((model) => model.id === modelRequirement.selectedModelId) ?? null
    : null;
  const selectedQuantization = selectedModel
    ? selectedModel.quantizations.find(
        (quantization) =>
          quantization.id ===
          (manualModelId
            ? config.modelSelection.quantizationId ?? selectedModel.recommendedQuantizationId
            : selectedModel.recommendedQuantizationId),
      ) ?? null
    : null;

  if (selectedModel && selectedQuantization) {
    resolvedConfig = {
      ...resolvedConfig,
      modelSelection: {
        ...resolvedConfig.modelSelection,
        modelId: selectedModel.id,
        quantizationId: selectedQuantization.id,
      },
    };
  }

  const vram =
    selectedModel && selectedQuantization
      ? calculateVramRequirement({
          model: selectedModel,
          quantization: selectedQuantization,
          peakContextTokens: workload.peakContextLength,
          peakConcurrentUsers: workload.peakConcurrentUsers,
          assumptions: catalogs.assumptions.vram,
        })
      : null;

  const systemResolution = resolveDesktopSystem(
    config,
    catalogs,
    selectedModel?.id ?? null,
    selectedQuantization?.id ?? null,
    workload,
  );
  const selectedSystem = systemResolution.hardware;
  let selectedGpu =
    config.hardwareSelection.mode === "system"
      ? selectedSystem?.engineGpu ?? null
      : config.hardwareSelection.gpuId
        ? catalogs.gpus.find((gpu) => gpu.id === config.hardwareSelection.gpuId) ?? null
        : null;
  let selectedGpuCount = config.hardwareSelection.gpuCount;
  const hardwareRecommendationWarnings: string[] = [];
  if (selectedSystem) {
    selectedGpuCount = selectedSystem.engineGpuCount;
    if (
      systemResolution.record &&
      config.hardwareSelection.systemId !== systemResolution.record.id
    ) {
      resolvedConfig = {
        ...resolvedConfig,
        hardwareSelection: {
          ...resolvedConfig.hardwareSelection,
          systemInputMode: "catalog",
          systemId: systemResolution.record.id,
        },
      };
    }
  } else if (
    config.hardwareSelection.mode === "recommended" &&
    vram &&
    selectedModel &&
    selectedQuantization
  ) {
    const rankedOptions = rankHardwareOptions(
      catalogs.gpus,
      vram,
      catalogs.assumptions,
    );
    const evidenceBackedOptions = rankedOptions.filter(
      (option) =>
        option.fit.status !== "cannot-run" &&
        catalogs.inferenceProfiles.some(
          (profile) =>
            profile.modelId === selectedModel.id &&
            profile.quantizationId === selectedQuantization.id &&
            profile.gpuId === option.gpu.id &&
            profile.gpuCount === option.gpuCount,
        ),
    );
    const recommendedOption = evidenceBackedOptions[0] ?? rankedOptions[0];
    if (recommendedOption) {
      selectedGpu = recommendedOption.gpu;
      selectedGpuCount = recommendedOption.gpuCount;
      if (evidenceBackedOptions.length === 0) {
        hardwareRecommendationWarnings.push(
          `RECOMMENDED_HARDWARE_PROFILE_FALLBACK: no hardware option that can fit '${selectedModel.id}' has an inference profile matching quantization '${selectedQuantization.id}', GPU and card count. Hardware remains selected by fit and price; no exact-profile evidence supports this choice, so downstream TPS is unavailable or explicitly estimated under separate scaling rules.`,
        );
      }
      resolvedConfig = {
        ...resolvedConfig,
        hardwareSelection: {
          ...resolvedConfig.hardwareSelection,
          gpuId: selectedGpu.id,
          gpuCount: selectedGpuCount,
        },
      };
    }
  }

  const hardwareFit =
    selectedGpu && vram
      ? calculateHardwareFit({
          gpu: selectedGpu,
          gpuCount: selectedGpuCount,
          vram,
          assumptions: catalogs.assumptions,
        })
      : null;
  const performanceOverride = selectedSystem?.performanceOverride;
  const performanceOverrideMatches = Boolean(
    selectedSystem &&
      performanceOverride &&
      selectedModel &&
      selectedQuantization &&
      performanceOverride.modelId === selectedModel.id &&
      performanceOverride.quantizationId === selectedQuantization.id &&
      performanceOverride.contextTokens === workload.averageContextLength &&
      performanceOverride.concurrency === workload.peakConcurrentUsers,
  );
  const overrideProfile: InferenceProfileRecord | null =
    selectedSystem &&
    performanceOverrideMatches &&
    performanceOverride?.effectiveTokensPerSecond &&
    selectedModel &&
    selectedQuantization
      ? {
          id: `system-profile-${selectedSystem.id}`,
          modelId: selectedModel.id,
          gpuId: selectedSystem.engineGpu.id,
          quantizationId: selectedQuantization.id,
          gpuCount: 1,
          inputTokens: workload.averageInputTokens,
          outputTokens: workload.averageOutputTokens,
          contextTokens:
            performanceOverride.contextTokens ?? workload.averageContextLength,
          concurrency:
            performanceOverride.concurrency ?? workload.peakConcurrentUsers,
          effectiveTokensPerSecond:
            performanceOverride.effectiveTokensPerSecond,
          ...(performanceOverride.timeToFirstTokenSeconds !== undefined
            ? {
                timeToFirstTokenSeconds:
                  performanceOverride.timeToFirstTokenSeconds,
              }
            : {}),
          framework: "Complete-system observation",
          method: performanceOverride.method,
          lastUpdated:
            systemResolution.record?.lastUpdated ??
            catalogs.metadata.systems.lastUpdated,
        }
      : null;
  const calculatedPerformance =
    selectedModel && selectedQuantization && selectedGpu
      ? calculatePerformanceCapacity({
          modelId: selectedModel.id,
          quantizationId: selectedQuantization.id,
          gpu: selectedGpu,
          gpuCount: selectedGpuCount,
          workload,
          tokenDemand,
          profiles: overrideProfile
            ? [overrideProfile, ...catalogs.inferenceProfiles]
            : catalogs.inferenceProfiles,
          assumptions: catalogs.assumptions,
        })
      : null;
  const performance =
    calculatedPerformance &&
    performanceOverrideMatches &&
    performanceOverride?.timeToFirstTokenSeconds !== undefined &&
    calculatedPerformance.timeToFirstTokenSeconds === null
      ? {
          ...calculatedPerformance,
          timeToFirstTokenSeconds:
            performanceOverride.timeToFirstTokenSeconds,
          warnings: [
            ...calculatedPerformance.warnings,
            "TTFT comes from an exact model-bound complete-system observation; token capacity remains unavailable without effective TPS.",
          ],
        }
      : calculatedPerformance;
  const localEconomicsAssumptions = selectedSystem
    ? selectedSystem.engineEconomicsOverrides
      ? {
          ...catalogs.assumptions.economics,
          ...selectedSystem.engineEconomicsOverrides,
        }
      : null
    : catalogs.assumptions.economics;
  const localCost =
    selectedGpu &&
    hasHardwareEconomics(selectedGpu) &&
    localEconomicsAssumptions
    ? calculateLocalCost({
        gpu: selectedGpu,
        gpuCount: selectedGpuCount,
        workload,
        locallyServedTokens: tokenDemand.monthlyTotalTokens,
        utilizationRatio: config.economics.hardwareUtilizationRatio,
        electricityPricePerKWh: config.economics.electricityPricePerKWh,
        hardwareLifetimeMonths: config.economics.hardwareLifetimeMonths,
        maintenanceCostMonthly: config.economics.maintenanceCostMonthly,
        assumptions: localEconomicsAssumptions,
      })
    : null;
  const pricingResolution = resolvePricing(config, catalogs, selectedModel?.id ?? null);
  const pricing = pricingResolution.pricing;
  if (!config.economics.customCloudPricing) {
    if (pricing && pricing.id !== resolvedConfig.economics.cloudPricingId) {
      resolvedConfig = {
        ...resolvedConfig,
        economics: {
          ...resolvedConfig.economics,
          cloudPricingId: pricing.id,
        },
      };
    } else if (!pricing && resolvedConfig.economics.cloudPricingId !== undefined) {
      const { cloudPricingId: _unmatchedPricingId, ...economics } =
        resolvedConfig.economics;
      resolvedConfig = { ...resolvedConfig, economics };
    }
  }
  const cloudCost = pricing
    ? calculateCloudCost(tokenDemand, pricing, config.economics.cachedInputRatio)
    : null;
  const hybridCost =
    localCost && cloudCost
      ? calculateHybridCost({
          local: localCost,
          cloud: cloudCost,
          localCoverageRatio: config.economics.localCoverageRatio,
          totalTokens: tokenDemand.monthlyTotalTokens,
        })
      : null;
  const breakEven =
    localCost && cloudCost
      ? calculateBreakEven({
          local: localCost,
          cloud: cloudCost,
          performance,
          hardwareLifetimeMonths: config.economics.hardwareLifetimeMonths,
        })
      : null;
  const localModelMeetsRequirements = selectedModel
    ? modelMeetsWorkload(selectedModel, workload, catalogs.assumptions.capabilityTiers)
    : false;
  const decisionUtilizationRatio =
    performance?.workloadComputeUtilizationRatio ??
    config.economics.hardwareUtilizationRatio;
  const localPerformanceAvailable =
    performance?.method !== undefined &&
    performance.method !== "unavailable" &&
    performance.effectiveTokensPerSecond !== null;
  const localPerformanceSufficient =
    localPerformanceAvailable &&
    performance.workloadComputeUtilizationRatio !== null &&
    performance.workloadComputeUtilizationRatio <= 1;
  const localRuntimeCompatible =
    !selectedSystem || selectedSystem.runtimeSupport.status === "supported";

  const complete = Boolean(
    selectedModel &&
      selectedQuantization &&
      selectedGpu &&
      vram &&
      hardwareFit &&
      localCost &&
      cloudCost &&
      hybridCost &&
      breakEven,
  );
  const recommendationInput: RecommendationInput = {
    complete,
    privacy: workload.privacyRequirement,
    intelligence: workload.capabilityRequirementTierId,
    latency: workload.latencyRequirement,
    localFit: hardwareFit?.status ?? null,
    localPerformanceAvailable,
    localRuntimeCompatible,
    localModelMeetsRequirements,
    cloudOfferingAvailable: Boolean(pricing),
    localCoverageRatio: config.economics.localCoverageRatio,
    utilizationRatio: decisionUtilizationRatio,
    breakEven,
    localMonthlyCostUSD: localCost?.monthlyTcoUSD ?? null,
    hybridMonthlyCostUSD: hybridCost?.monthlyCostUSD ?? null,
    cloudMonthlyCostUSD: cloudCost?.monthlyCostUSD ?? null,
    assumptions: catalogs.assumptions.recommendation,
  };
  const recommendation = complete
    ? recommendDeployment(recommendationInput)
    : incompleteRecommendation();
  const recommendationTrace = createRecommendationTrace(
    recommendationInput,
    recommendation,
  );
  const comparisons = buildDeploymentComparisons({
    privacy: workload.privacyRequirement,
    localFit: hardwareFit?.status ?? null,
    localModelMeetsRequirements,
    localPerformanceSufficient,
    localRuntimeCompatible,
    localIntelligence: selectedModel?.capabilityTierId ?? workload.capabilityRequirementTierId,
    highestCapabilityTierId:
      highestCapabilityTierId(catalogs.assumptions.capabilityTiers) ??
      workload.capabilityRequirementTierId,
    local: localCost,
    hybrid: hybridCost,
    cloud: cloudCost,
  });
  const opportunityMap = buildOpportunityMap({
    recommendationInput,
    localModelIntelligence:
      selectedModel?.capabilityTierId ??
      lowestCapabilityTierId(catalogs.assumptions.capabilityTiers) ??
      workload.capabilityRequirementTierId,
    capabilityTiers: catalogs.assumptions.capabilityTiers,
    currentUtilizationRatio: decisionUtilizationRatio,
    utilizationMethod:
      performance?.workloadComputeUtilizationRatio !== null &&
      performance?.workloadComputeUtilizationRatio !== undefined
        ? "derived"
        : "assumed",
  });
  const traces = [
    tokenDemand.trace,
    ...(vram ? [vram.trace] : []),
    ...(hardwareFit ? [hardwareFit.trace] : []),
    ...(performance ? [performance.trace] : []),
    ...(localCost ? [localCost.trace] : []),
    ...(cloudCost ? [cloudCost.trace] : []),
    ...(hybridCost ? [hybridCost.trace] : []),
    ...(breakEven ? breakEven.traces : []),
    recommendationTrace,
  ];
  const warnings = [
    ...modelRequirement.warnings,
    ...(configurationSelection?.warnings ?? []),
    ...systemResolution.warnings,
    ...(performanceOverride && !performanceOverrideMatches
      ? [
          "The complete-system performance observation does not exactly match the active model, quantization, context and concurrency, so it is not reused.",
        ]
      : []),
    ...Object.values(systemResolution.errors),
    ...hardwareRecommendationWarnings,
    ...(vram?.trace.warnings ?? []),
    ...(hardwareFit?.warnings ?? []),
    ...(performance?.warnings ?? []),
    ...pricingResolution.warnings,
    ...(cloudCost?.warnings ?? []),
    ...(hybridCost?.warnings ?? []),
    ...recommendation.warnings,
  ].filter((warning, index, all) => all.indexOf(warning) === index);

  return {
    status: complete ? "complete" : "incomplete",
    config: resolvedConfig,
    tokenDemand,
    modelRequirement,
    selectedModel,
    selectedQuantization,
    selectedGpu,
    selectedSystem,
    systemValidationErrors: systemResolution.errors,
    vram,
    hardwareFit,
    performance,
    localCost,
    cloudCost,
    hybridCost,
    breakEven,
    comparisons,
    recommendation,
    opportunityMap,
    traces,
    warnings,
  };
}
