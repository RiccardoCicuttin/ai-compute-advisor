import { AdvisorConfigSchema } from "../data/schemas";
import type {
  AdvisorConfig,
  CustomDesktopSystemDraft,
  ModelRecord,
  NormalizedCatalogs,
  WorkloadConfig,
} from "../types";
import { findRecommendedCloudPricingId } from "./defaultAdvisorConfig";

export type AdvisorCatalogReferenceIssueCode =
  | "simple-use-case-not-in-assumptions"
  | "usage-frequency-not-in-assumptions"
  | "capability-tier-not-in-catalog"
  | "preset-not-in-catalog"
  | "model-not-in-catalog"
  | "recommended-model-reference-cleared"
  | "quantization-not-in-model"
  | "gpu-not-in-catalog"
  | "recommended-gpu-reference-cleared"
  | "gpu-count-not-supported"
  | "system-not-in-catalog"
  | "custom-performance-reference-invalid"
  | "cloud-pricing-not-in-catalog"
  | "currency-not-in-catalog"
  | "exchange-rate-override-not-in-catalog";

export type AdvisorCatalogReferenceResolution =
  | "use-first-simple-mapping"
  | "use-highest-capability-tier"
  | "unset"
  | "use-recommended"
  | "use-model-recommended-quantization"
  | "use-supported-gpu-count"
  | "clear-custom-performance-binding"
  | "use-recommended-cloud-pricing"
  | "use-usd"
  | "filter-invalid-values";

export interface AdvisorCatalogReferenceIssue {
  source: "catalog";
  severity: "warning";
  code: AdvisorCatalogReferenceIssueCode;
  path: string;
  message: string;
  previousValue?: string | number | string[];
  resolution: AdvisorCatalogReferenceResolution;
}

export interface ReconcileAdvisorCatalogReferencesResult {
  config: AdvisorConfig;
  issues: AdvisorCatalogReferenceIssue[];
  changed: boolean;
}

function cloneConfig(config: AdvisorConfig): AdvisorConfig {
  return {
    ...config,
    workload: { ...config.workload },
    modelSelection: { ...config.modelSelection },
    hardwareSelection: {
      ...config.hardwareSelection,
      ...(config.hardwareSelection.customSystem
        ? { customSystem: { ...config.hardwareSelection.customSystem } }
        : {}),
    },
    economics: {
      ...config.economics,
      ...(config.economics.manualExchangeRateOverride
        ? {
            manualExchangeRateOverride: {
              ...config.economics.manualExchangeRateOverride,
            },
          }
        : {}),
      ...(config.economics.customCloudPricing
        ? { customCloudPricing: { ...config.economics.customCloudPricing } }
        : {}),
    },
  };
}

function firstKey(record: Record<string, unknown>): string | undefined {
  return Object.keys(record)[0];
}

function highestCapabilityTier(catalogs: NormalizedCatalogs) {
  return catalogs.assumptions.capabilityTiers.reduce((highest, candidate) =>
    candidate.rank > highest.rank ? candidate : highest,
  );
}

function clearCustomPerformanceBinding(
  customSystem: CustomDesktopSystemDraft,
): void {
  customSystem.performanceModelId = null;
  customSystem.performanceQuantizationId = null;
  customSystem.performanceContextTokens = null;
  customSystem.performanceConcurrency = null;
  customSystem.effectiveTokensPerSecond = null;
  customSystem.timeToFirstTokenSeconds = null;
}

function isValidQuantization(
  model: ModelRecord,
  quantizationId: string | null | undefined,
): boolean {
  return (
    quantizationId === undefined ||
    quantizationId === null ||
    model.quantizations.some((quantization) => quantization.id === quantizationId)
  );
}

/**
 * Reconciles every AdvisorConfig reference against a newly active catalog set.
 *
 * The operation is pure and deterministic. It preserves user-entered numeric
 * workload and economic values, changes only stale catalog references (plus
 * their explicitly documented fallbacks), and is idempotent.
 */
export function reconcileAdvisorCatalogReferences(
  config: AdvisorConfig,
  catalogs: NormalizedCatalogs,
): ReconcileAdvisorCatalogReferencesResult {
  const next = cloneConfig(config);
  const issues: AdvisorCatalogReferenceIssue[] = [];
  let changed = false;

  const addIssue = (issue: Omit<AdvisorCatalogReferenceIssue, "source" | "severity">) => {
    issues.push({ source: "catalog", severity: "warning", ...issue });
    changed = true;
  };

  const useCaseMappings = catalogs.assumptions.simpleModeMappings.useCases;
  if (!(next.workload.useCase in useCaseMappings)) {
    const fallback = firstKey(useCaseMappings);
    if (fallback) {
      const previousValue = next.workload.useCase;
      next.workload.useCase = fallback as WorkloadConfig["useCase"];
      addIssue({
        code: "simple-use-case-not-in-assumptions",
        path: "workload.useCase",
        previousValue,
        resolution: "use-first-simple-mapping",
        message: `Use case '${previousValue}' is not configured by the active Data Pack; using '${fallback}' without changing the saved workload numbers.`,
      });
    }
  }

  const frequencyMappings =
    catalogs.assumptions.simpleModeMappings.usageFrequency;
  if (!(next.workload.usageFrequency in frequencyMappings)) {
    const fallback = firstKey(frequencyMappings);
    if (fallback) {
      const previousValue = next.workload.usageFrequency;
      next.workload.usageFrequency =
        fallback as WorkloadConfig["usageFrequency"];
      addIssue({
        code: "usage-frequency-not-in-assumptions",
        path: "workload.usageFrequency",
        previousValue,
        resolution: "use-first-simple-mapping",
        message: `Usage frequency '${previousValue}' is not configured by the active Data Pack; using '${fallback}' without changing the saved workload numbers.`,
      });
    }
  }

  const capabilityTierIds = new Set(
    catalogs.assumptions.capabilityTiers.map((tier) => tier.id),
  );
  if (!capabilityTierIds.has(next.workload.capabilityRequirementTierId)) {
    const previousValue = next.workload.capabilityRequirementTierId;
    const fallback = highestCapabilityTier(catalogs);
    next.workload.capabilityRequirementTierId = fallback.id;
    addIssue({
      code: "capability-tier-not-in-catalog",
      path: "workload.capabilityRequirementTierId",
      previousValue,
      resolution: "use-highest-capability-tier",
      message: `Capability tier '${previousValue}' is not configured by the active Data Pack; using its highest tier '${fallback.id}' to avoid understating the requirement.`,
    });
  }

  if (
    next.presetId !== undefined &&
    !catalogs.presets.some((preset) => preset.id === next.presetId)
  ) {
    const previousValue = next.presetId;
    delete next.presetId;
    addIssue({
      code: "preset-not-in-catalog",
      path: "presetId",
      previousValue,
      resolution: "unset",
      message: `Preset '${previousValue}' is not in the active Data Pack. The existing workload values were preserved.`,
    });
  }

  if (next.modelSelection.mode === "recommended") {
    const staleReferences = [
      next.modelSelection.modelId,
      next.modelSelection.quantizationId,
    ].filter((value): value is string => value !== undefined);
    if (staleReferences.length > 0) {
      delete next.modelSelection.modelId;
      delete next.modelSelection.quantizationId;
      addIssue({
        code: "recommended-model-reference-cleared",
        path: "modelSelection",
        previousValue: staleReferences,
        resolution: "use-recommended",
        message:
          "Cached model references were cleared so Recommended mode can resolve against the active Data Pack.",
      });
    }
  } else {
    const selectedModel = catalogs.models.find(
      (model) => model.id === next.modelSelection.modelId,
    );
    if (!selectedModel) {
      const previousValue = next.modelSelection.modelId;
      next.modelSelection.mode = "recommended";
      delete next.modelSelection.modelId;
      delete next.modelSelection.quantizationId;
      addIssue({
        code: "model-not-in-catalog",
        path: "modelSelection.modelId",
        ...(previousValue ? { previousValue } : {}),
        resolution: "use-recommended",
        message: previousValue
          ? `Model '${previousValue}' is not in the active Data Pack; using Recommended mode.`
          : "Manual model mode had no model reference; using Recommended mode.",
      });
    } else if (
      next.modelSelection.quantizationId !== undefined &&
      !isValidQuantization(
        selectedModel,
        next.modelSelection.quantizationId,
      )
    ) {
      const previousValue = next.modelSelection.quantizationId;
      next.modelSelection.quantizationId =
        selectedModel.recommendedQuantizationId;
      addIssue({
        code: "quantization-not-in-model",
        path: "modelSelection.quantizationId",
        previousValue,
        resolution: "use-model-recommended-quantization",
        message: `Quantization '${previousValue}' is not available for '${selectedModel.id}'; using '${selectedModel.recommendedQuantizationId}'.`,
      });
    }
  }

  const referencedGpu = next.hardwareSelection.gpuId
    ? catalogs.gpus.find((gpu) => gpu.id === next.hardwareSelection.gpuId)
    : undefined;
  if (next.hardwareSelection.gpuId && !referencedGpu) {
    const previousValue = next.hardwareSelection.gpuId;
    delete next.hardwareSelection.gpuId;
    if (next.hardwareSelection.mode === "existing") {
      next.hardwareSelection.mode = "recommended";
    }
    addIssue({
      code: "gpu-not-in-catalog",
      path: "hardwareSelection.gpuId",
      previousValue,
      resolution:
        config.hardwareSelection.mode === "existing" ? "use-recommended" : "unset",
      message:
        config.hardwareSelection.mode === "existing"
          ? `GPU '${previousValue}' is not in the active Data Pack; using Recommended hardware mode.`
          : `Inactive GPU reference '${previousValue}' is not in the active Data Pack and was removed.`,
    });
  } else if (
    next.hardwareSelection.mode === "existing" &&
    referencedGpu &&
    !referencedGpu.supportedCounts.includes(next.hardwareSelection.gpuCount)
  ) {
    const previousValue = next.hardwareSelection.gpuCount;
    const fallbackCount = referencedGpu.supportedCounts.includes(1)
      ? 1
      : referencedGpu.supportedCounts[0]!;
    next.hardwareSelection.gpuCount = fallbackCount;
    addIssue({
      code: "gpu-count-not-supported",
      path: "hardwareSelection.gpuCount",
      previousValue,
      resolution: "use-supported-gpu-count",
      message: `GPU count ${previousValue} is not supported by '${referencedGpu.id}'; using ${fallbackCount}.`,
    });
  } else if (
    next.hardwareSelection.mode === "existing" &&
    !next.hardwareSelection.gpuId
  ) {
    next.hardwareSelection.mode = "recommended";
    addIssue({
      code: "gpu-not-in-catalog",
      path: "hardwareSelection.gpuId",
      resolution: "use-recommended",
      message: "Existing hardware mode had no GPU reference; using Recommended hardware mode.",
    });
  } else if (
    next.hardwareSelection.mode === "recommended" &&
    next.hardwareSelection.gpuId !== undefined
  ) {
    // This branch is reachable only when the reference was valid. Recommended
    // mode must not carry an authoritative product ID from a previous catalog.
    const previousValue = next.hardwareSelection.gpuId;
    delete next.hardwareSelection.gpuId;
    addIssue({
      code: "recommended-gpu-reference-cleared",
      path: "hardwareSelection.gpuId",
      previousValue,
      resolution: "use-recommended",
      message:
        "Cached GPU selection was cleared so Recommended mode can resolve against the active Data Pack.",
    });
  }

  const referencedSystem = next.hardwareSelection.systemId
    ? catalogs.systems.find(
        (system) => system.id === next.hardwareSelection.systemId,
      )
    : undefined;
  const usesCatalogSystem =
    next.hardwareSelection.mode === "system" &&
    next.hardwareSelection.systemInputMode !== "custom";
  if (next.hardwareSelection.systemId && !referencedSystem) {
    const previousValue = next.hardwareSelection.systemId;
    delete next.hardwareSelection.systemId;
    if (usesCatalogSystem) {
      next.hardwareSelection.mode = "recommended";
      delete next.hardwareSelection.systemInputMode;
    }
    addIssue({
      code: "system-not-in-catalog",
      path: "hardwareSelection.systemId",
      previousValue,
      resolution: usesCatalogSystem ? "use-recommended" : "unset",
      message: usesCatalogSystem
        ? `Desktop system '${previousValue}' is not in the active Data Pack; using Recommended hardware mode.`
        : `Inactive desktop-system reference '${previousValue}' is not in the active Data Pack and was removed.`,
    });
  } else if (usesCatalogSystem && !next.hardwareSelection.systemId) {
    next.hardwareSelection.mode = "recommended";
    delete next.hardwareSelection.systemInputMode;
    addIssue({
      code: "system-not-in-catalog",
      path: "hardwareSelection.systemId",
      resolution: "use-recommended",
      message:
        "Catalog system mode had no desktop-system reference; using Recommended hardware mode.",
    });
  }

  const customSystem = next.hardwareSelection.customSystem;
  if (customSystem) {
    const performanceModel = customSystem.performanceModelId
      ? catalogs.models.find(
          (model) => model.id === customSystem.performanceModelId,
        )
      : undefined;
    const hasInvalidModelReference =
      customSystem.performanceModelId !== null && !performanceModel;
    const hasOrphanedQuantizationReference =
      customSystem.performanceModelId === null &&
      customSystem.performanceQuantizationId !== null;
    const hasInvalidQuantizationReference = Boolean(
      performanceModel &&
        !isValidQuantization(
          performanceModel,
          customSystem.performanceQuantizationId,
        ),
    );

    if (
      hasInvalidModelReference ||
      hasOrphanedQuantizationReference ||
      hasInvalidQuantizationReference
    ) {
      const previousValue = [
        customSystem.performanceModelId,
        customSystem.performanceQuantizationId,
      ].filter((value): value is string => value !== null);
      clearCustomPerformanceBinding(customSystem);
      addIssue({
        code: "custom-performance-reference-invalid",
        path: "hardwareSelection.customSystem.performanceModelId",
        ...(previousValue.length > 0 ? { previousValue } : {}),
        resolution: "clear-custom-performance-binding",
        message:
          "The custom system's model-bound performance observation does not reference the active Data Pack, so the complete performance binding was cleared.",
      });
    }
  }

  if (
    next.economics.cloudPricingId !== undefined &&
    !catalogs.cloudPricing.some(
      (pricing) => pricing.id === next.economics.cloudPricingId,
    )
  ) {
    const previousValue = next.economics.cloudPricingId;
    const fallback = findRecommendedCloudPricingId(
      catalogs,
      next.workload.capabilityRequirementTierId,
    );
    if (fallback) next.economics.cloudPricingId = fallback;
    else delete next.economics.cloudPricingId;
    addIssue({
      code: "cloud-pricing-not-in-catalog",
      path: "economics.cloudPricingId",
      previousValue,
      resolution: fallback ? "use-recommended-cloud-pricing" : "unset",
      message: fallback
        ? `Cloud price '${previousValue}' is not in the active Data Pack; using '${fallback}'.`
        : `Cloud price '${previousValue}' is not in the active Data Pack and no replacement is available.`,
    });
  }

  const currencyCodes = new Set(
    catalogs.exchangeRates.currencies.map((currency) => currency.code),
  );
  if (!currencyCodes.has(next.economics.displayCurrency)) {
    const previousValue = next.economics.displayCurrency;
    next.economics.displayCurrency = "USD";
    addIssue({
      code: "currency-not-in-catalog",
      path: "economics.displayCurrency",
      previousValue,
      resolution: "use-usd",
      message: `Display currency '${previousValue}' is not in the active Data Pack; using USD.`,
    });
  }

  const exchangeRateOverrides =
    next.economics.manualExchangeRateOverride ?? {};
  const removedCurrencyCodes = Object.keys(exchangeRateOverrides).filter(
    (code) => !currencyCodes.has(code),
  );
  if (removedCurrencyCodes.length > 0) {
    const retainedOverrides = Object.fromEntries(
      Object.entries(exchangeRateOverrides).filter(([code]) =>
        currencyCodes.has(code),
      ),
    );
    if (Object.keys(retainedOverrides).length > 0) {
      next.economics.manualExchangeRateOverride = retainedOverrides;
    } else {
      delete next.economics.manualExchangeRateOverride;
    }
    addIssue({
      code: "exchange-rate-override-not-in-catalog",
      path: "economics.manualExchangeRateOverride",
      previousValue: removedCurrencyCodes,
      resolution: "filter-invalid-values",
      message: `Manual exchange-rate overrides not in the active Data Pack were removed: ${removedCurrencyCodes.join(", ")}.`,
    });
  }

  const parsed = AdvisorConfigSchema.parse(next);
  return {
    // Preserve referential identity when no catalog reference changed. This
    // keeps React reconciliation from turning a pure audit into a state loop.
    config: changed ? parsed : config,
    issues,
    changed,
  };
}
