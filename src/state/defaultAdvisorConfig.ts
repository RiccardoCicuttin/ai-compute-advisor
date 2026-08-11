import { AdvisorConfigSchema, WorkloadConfigSchema } from "../data/schemas";
import type {
  AdvisorConfig,
  AssumptionsRecord,
  CapabilityTierId,
  NormalizedCatalogs,
  PresetRecord,
  UseCase,
  UsageFrequency,
  WorkloadConfig,
} from "../types";

const FALLBACK_WORKLOAD: WorkloadConfig = {
  mode: "simple",
  useCase: "ai-assistant",
  usageFrequency: "daily",
  users: 1,
  privacyRequirement: "medium",
  capabilityRequirementTierId: "",
  latencyRequirement: "interactive",
  monthlyRequests: 440,
  averageInputTokens: 800,
  averageOutputTokens: 350,
  averageAgentSteps: 1,
  peakConcurrentUsers: 1,
  averageContextLength: 4_096,
  peakContextLength: 8_192,
  workingHoursPerDay: 8,
  workingDaysPerMonth: 22,
};

export function findRecommendedCloudPricingId(
  catalogs: NormalizedCatalogs,
  requirement: CapabilityTierId,
): string | undefined {
  const ranks = new Map(
    catalogs.assumptions.capabilityTiers.map((tier) => [tier.id, tier.rank]),
  );
  const requiredRank = ranks.get(requirement) ?? Number.POSITIVE_INFINITY;
  const compatible = catalogs.cloudPricing
    .map((pricing) => ({
      pricing,
      model: pricing.modelId
        ? catalogs.models.find((model) => model.id === pricing.modelId)
        : undefined,
    }))
    .filter(
      (candidate) =>
        candidate.model &&
        (ranks.get(candidate.model.capabilityTierId) ?? Number.NEGATIVE_INFINITY) >= requiredRank,
    )
    .sort((left, right) => {
      const classDifference =
        (ranks.get(left.model!.capabilityTierId) ?? Number.NEGATIVE_INFINITY) -
        (ranks.get(right.model!.capabilityTierId) ?? Number.NEGATIVE_INFINITY);
      if (classDifference !== 0) return classDifference;
      const leftUnitPrice =
        left.pricing.inputPricePerMillionTokens +
        left.pricing.outputPricePerMillionTokens;
      const rightUnitPrice =
        right.pricing.inputPricePerMillionTokens +
        right.pricing.outputPricePerMillionTokens;
      return leftUnitPrice - rightUnitPrice;
    });

  return compatible[0]?.pricing.id ?? catalogs.cloudPricing[0]?.id;
}

function firstValue<T>(record: Record<string, T>): T | undefined {
  return Object.values(record)[0];
}

export function resolveWorkloadDefaults(
  partial: Partial<WorkloadConfig>,
  assumptions: AssumptionsRecord,
): WorkloadConfig {
  const requestedUseCase = (partial.useCase ?? FALLBACK_WORKLOAD.useCase) as UseCase;
  const requestedUsageFrequency = (
    partial.usageFrequency ?? FALLBACK_WORKLOAD.usageFrequency
  ) as UsageFrequency;
  const useCase = (
    assumptions.simpleModeMappings.useCases[requestedUseCase]
      ? requestedUseCase
      : Object.keys(assumptions.simpleModeMappings.useCases)[0]
  ) as UseCase;
  const usageFrequency = (
    assumptions.simpleModeMappings.usageFrequency[requestedUsageFrequency]
      ? requestedUsageFrequency
      : Object.keys(assumptions.simpleModeMappings.usageFrequency)[0]
  ) as UsageFrequency;
  const users = partial.users ?? FALLBACK_WORKLOAD.users;

  const useCaseDefaults =
    assumptions.simpleModeMappings.useCases[useCase] ??
    firstValue(assumptions.simpleModeMappings.useCases);
  const frequencyDefaults =
    assumptions.simpleModeMappings.usageFrequency[usageFrequency] ??
    firstValue(assumptions.simpleModeMappings.usageFrequency);

  const workingDaysPerMonth =
    partial.workingDaysPerMonth ??
    frequencyDefaults?.workingDaysPerMonth ??
    FALLBACK_WORKLOAD.workingDaysPerMonth;
  const requestsPerUserPerWorkingDay =
    frequencyDefaults?.requestsPerUserPerWorkingDay ?? 1;

  const candidate: WorkloadConfig = {
    ...FALLBACK_WORKLOAD,
    ...partial,
    capabilityRequirementTierId:
      partial.capabilityRequirementTierId ??
      assumptions.capabilityTiers.reduce((highest, candidate) =>
        candidate.rank > highest.rank ? candidate : highest,
      ).id,
    useCase,
    usageFrequency,
    users,
    monthlyRequests:
      partial.monthlyRequests ??
      Math.round(users * requestsPerUserPerWorkingDay * workingDaysPerMonth),
    averageInputTokens:
      partial.averageInputTokens ??
      useCaseDefaults?.averageInputTokens ??
      FALLBACK_WORKLOAD.averageInputTokens,
    averageOutputTokens:
      partial.averageOutputTokens ??
      useCaseDefaults?.averageOutputTokens ??
      FALLBACK_WORKLOAD.averageOutputTokens,
    averageAgentSteps:
      partial.averageAgentSteps ??
      useCaseDefaults?.averageAgentSteps ??
      FALLBACK_WORKLOAD.averageAgentSteps,
    peakConcurrentUsers:
      partial.peakConcurrentUsers ??
      Math.max(
        1,
        Math.ceil(
          users *
            (useCaseDefaults?.peakConcurrentUsersRatio ??
              1 / Math.max(users, 1)),
        ),
      ),
    averageContextLength:
      partial.averageContextLength ??
      useCaseDefaults?.averageContextLength ??
      FALLBACK_WORKLOAD.averageContextLength,
    peakContextLength:
      partial.peakContextLength ??
      useCaseDefaults?.peakContextLength ??
      FALLBACK_WORKLOAD.peakContextLength,
    workingHoursPerDay:
      partial.workingHoursPerDay ??
      frequencyDefaults?.workingHoursPerDay ??
      FALLBACK_WORKLOAD.workingHoursPerDay,
    workingDaysPerMonth,
  };

  return WorkloadConfigSchema.parse(candidate);
}

export function applyWorkloadPatch(
  current: WorkloadConfig,
  patch: Partial<WorkloadConfig>,
  assumptions: AssumptionsRecord,
): WorkloadConfig {
  const next = { ...current, ...patch };
  if (next.mode !== "simple") return WorkloadConfigSchema.parse(next);

  const useCaseChanged =
    patch.useCase !== undefined && patch.useCase !== current.useCase;
  const frequencyChanged =
    patch.usageFrequency !== undefined &&
    patch.usageFrequency !== current.usageFrequency;
  const usersChanged = patch.users !== undefined && patch.users !== current.users;

  // A mode-only change must preserve the normalized Advanced values. Simple
  // mappings are reapplied only when a Simple driver actually changes.
  if (!useCaseChanged && !frequencyChanged && !usersChanged) {
    return WorkloadConfigSchema.parse(next);
  }

  const useCaseDefaults =
    assumptions.simpleModeMappings.useCases[next.useCase] ??
    firstValue(assumptions.simpleModeMappings.useCases);
  const frequencyDefaults =
    assumptions.simpleModeMappings.usageFrequency[next.usageFrequency] ??
    firstValue(assumptions.simpleModeMappings.usageFrequency);
  const derived: Partial<WorkloadConfig> = {};

  if (useCaseChanged && useCaseDefaults) {
    derived.averageInputTokens = useCaseDefaults.averageInputTokens;
    derived.averageOutputTokens = useCaseDefaults.averageOutputTokens;
    derived.averageAgentSteps = useCaseDefaults.averageAgentSteps;
    derived.averageContextLength = useCaseDefaults.averageContextLength;
    derived.peakContextLength = useCaseDefaults.peakContextLength;
  }
  if (frequencyChanged && frequencyDefaults) {
    derived.workingHoursPerDay = frequencyDefaults.workingHoursPerDay;
    derived.workingDaysPerMonth = frequencyDefaults.workingDaysPerMonth;
  }
  if (useCaseChanged && useCaseDefaults) {
    derived.peakConcurrentUsers = Math.max(
      1,
      Math.ceil(next.users * useCaseDefaults.peakConcurrentUsersRatio),
    );
  } else if (usersChanged) {
    derived.peakConcurrentUsers = Math.max(
      1,
      Math.ceil((current.peakConcurrentUsers / current.users) * next.users),
    );
  }
  if (frequencyChanged && frequencyDefaults) {
    derived.monthlyRequests = Math.round(
      next.users *
        frequencyDefaults.requestsPerUserPerWorkingDay *
        (patch.workingDaysPerMonth ??
          derived.workingDaysPerMonth ??
          next.workingDaysPerMonth),
    );
  } else if (usersChanged) {
    derived.monthlyRequests = Math.round(
      (current.monthlyRequests / current.users) * next.users,
    );
  }

  // Explicit values in a compound patch win over derived defaults.
  return WorkloadConfigSchema.parse({ ...next, ...derived, ...patch });
}

export function applyPresetToConfig(
  config: AdvisorConfig,
  preset: PresetRecord,
  assumptions: AssumptionsRecord,
): AdvisorConfig {
  const presetWorkload: Partial<WorkloadConfig> = {
    mode: preset.workload.mode ?? config.workload.mode,
    useCase: preset.workload.useCase ?? config.workload.useCase,
    usageFrequency:
      preset.workload.usageFrequency ?? config.workload.usageFrequency,
    users: preset.workload.users ?? config.workload.users,
    privacyRequirement:
      preset.workload.privacyRequirement ??
      config.workload.privacyRequirement,
    capabilityRequirementTierId:
      preset.workload.capabilityRequirementTierId ??
      config.workload.capabilityRequirementTierId,
    latencyRequirement:
      preset.workload.latencyRequirement ?? config.workload.latencyRequirement,
    ...preset.workload,
  };
  // Do not spread current derived values into a new Simple preset. Doing so
  // would make its use-case/frequency drivers appear to change while token and
  // context assumptions remained from the previous scenario.
  const workload = resolveWorkloadDefaults(presetWorkload, assumptions);

  return AdvisorConfigSchema.parse({
    ...config,
    presetId: preset.id,
    workload,
    economics: {
      ...config.economics,
      localCoverageRatio:
        preset.suggestedLocalCoverageRatio ??
        config.economics.localCoverageRatio,
    },
  });
}

export function createDefaultAdvisorConfig(
  catalogs: NormalizedCatalogs,
  preferredPresetId = "personal-ai-assistant",
): AdvisorConfig {
  const preset =
    catalogs.presets.find((item) => item.id === preferredPresetId) ??
    catalogs.presets[0];
  const workload = resolveWorkloadDefaults(
    preset?.workload ?? {},
    catalogs.assumptions,
  );
  const economics = catalogs.assumptions.economics;
  const cloudPricingId = findRecommendedCloudPricingId(
    catalogs,
    workload.capabilityRequirementTierId,
  );

  return AdvisorConfigSchema.parse({
    stateVersion: 1,
    analysisMode: "workload-first",
    ...(preset ? { presetId: preset.id } : {}),
    workload,
    modelSelection: {
      mode: "recommended",
    },
    hardwareSelection: {
      mode: "recommended",
      gpuCount: 1,
    },
    economics: {
      displayCurrency: "USD",
      hardwareUtilizationRatio: economics.defaultUtilizationRatio,
      localCoverageRatio: preset?.suggestedLocalCoverageRatio ?? 0.5,
      ...(cloudPricingId ? { cloudPricingId } : {}),
      cachedInputRatio: economics.defaultCachedInputRatio,
      electricityPricePerKWh: economics.electricityPricePerKWh,
      hardwareLifetimeMonths: economics.hardwareLifetimeMonths,
      maintenanceCostMonthly: economics.maintenanceCostMonthly,
    },
  });
}
