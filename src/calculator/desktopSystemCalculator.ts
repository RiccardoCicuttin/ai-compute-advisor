import { CustomDesktopSystemConfigSchema, normalizeDesktopSystem } from "../systems";
import type {
  CustomDesktopSystemConfig,
  DesktopSystemRecord,
  NormalizedDesktopHardware,
} from "../systems";
import type {
  AdvisorConfig,
  CustomDesktopSystemDraft,
  NormalizedCatalogs,
  WorkloadConfig,
} from "../types";

export interface DesktopSystemResolution {
  source: "catalog" | "custom" | null;
  record: DesktopSystemRecord | null;
  hardware: NormalizedDesktopHardware | null;
  errors: Partial<Record<keyof CustomDesktopSystemDraft | "systemId", string>>;
  warnings: string[];
}

function isPositive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function isNonNegative(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0;
}

function resolveCustomSystem(
  draft: CustomDesktopSystemDraft | undefined,
  selectedModelId: string | null,
  selectedQuantizationId: string | null,
  workload: WorkloadConfig,
): DesktopSystemResolution {
  const errors: DesktopSystemResolution["errors"] = {};
  if (!draft) {
    return {
      source: "custom",
      record: null,
      hardware: null,
      errors: { systemId: "Enter a complete custom system configuration." },
      warnings: [],
    };
  }

  if (!draft.name.trim()) errors.name = "Enter a system name.";
  if (!draft.acceleratorName.trim()) {
    errors.acceleratorName = "Enter an accelerator name.";
  }
  if (!draft.acceleratorType.trim()) {
    errors.acceleratorType = "Enter an accelerator display label.";
  }
  if (isPositive(draft.tops) && !draft.topsPrecision.trim()) {
    errors.topsPrecision = "Enter the precision used for the TOPS rating.";
  }
  if (
    draft.runtimeSupportStatus === "supported" &&
    !draft.runtimeNames.trim()
  ) {
    errors.runtimeNames = "Name the runtime or framework that confirms support.";
  }
  if (!draft.systemMemoryType.trim()) {
    errors.systemMemoryType = "Enter a system memory type.";
  }
  if (!isPositive(draft.systemRamGB)) errors.systemRamGB = "Enter installed system memory.";
  if (!isPositive(draft.acceleratorCount) || !Number.isSafeInteger(draft.acceleratorCount)) {
    errors.acceleratorCount = "Accelerator count must be a positive whole number.";
  }
  if (!isPositive(draft.memoryBandwidthGBps)) {
    errors.memoryBandwidthGBps = "Enter aggregate memory bandwidth.";
  }
  if (!isNonNegative(draft.idlePowerWatts)) {
    errors.idlePowerWatts = "Enter whole-system idle power.";
  }
  if (!isPositive(draft.loadPowerWatts)) {
    errors.loadPowerWatts = "Enter whole-system load power.";
  } else if (
    isNonNegative(draft.idlePowerWatts) &&
    draft.loadPowerWatts < draft.idlePowerWatts
  ) {
    errors.loadPowerWatts = "Load power cannot be below idle power.";
  }
  if (!isNonNegative(draft.purchasePriceUSD)) {
    errors.purchasePriceUSD = "Enter the whole-system purchase price.";
  }
  if (draft.memoryArchitecture === "dedicated") {
    if (!isPositive(draft.dedicatedMemoryPerUnitGB)) {
      errors.dedicatedMemoryPerUnitGB = "Enter dedicated memory per accelerator.";
    }
  } else {
    if (!isPositive(draft.allocatableUnifiedMemoryGB)) {
      errors.allocatableUnifiedMemoryGB = "Enter allocatable unified memory.";
    } else if (
      isPositive(draft.systemRamGB) &&
      draft.allocatableUnifiedMemoryGB > draft.systemRamGB
    ) {
      errors.allocatableUnifiedMemoryGB = "Allocatable memory cannot exceed installed memory.";
    }
  }

  if (Object.keys(errors).length > 0) {
    return { source: "custom", record: null, hardware: null, errors, warnings: [] };
  }

  const hasPerformanceObservation =
    isPositive(draft.effectiveTokensPerSecond) ||
    isNonNegative(draft.timeToFirstTokenSeconds);
  const performanceBindingMatches =
    hasPerformanceObservation &&
    selectedModelId !== null &&
    selectedQuantizationId !== null &&
    draft.performanceModelId === selectedModelId &&
    draft.performanceQuantizationId === selectedQuantizationId &&
    draft.performanceContextTokens === workload.averageContextLength &&
    draft.performanceConcurrency === workload.peakConcurrentUsers;
  const common = {
    name: draft.name.trim(),
    vendor: "Custom",
    acceleratorType: draft.acceleratorType.trim(),
    acceleratorBehaviorCategory: draft.acceleratorBehaviorCategory,
    acceleratorModel: draft.acceleratorName.trim(),
    acceleratorCount: draft.acceleratorCount as number,
    supportsModelSharding: draft.supportsModelSharding,
    systemMemoryType: draft.systemMemoryType.trim(),
    systemMemoryGB: draft.systemRamGB as number,
    memoryBandwidthGBps: draft.memoryBandwidthGBps as number,
    interconnect: draft.memoryArchitecture === "unified" ? "unified" as const : "pcie" as const,
    systemIdleWatts: draft.idlePowerWatts as number,
    systemLoadWatts: draft.loadPowerWatts as number,
    purchasePriceUSD: draft.purchasePriceUSD as number,
    ...(isPositive(draft.tops)
      ? { peakTops: { value: draft.tops, precision: draft.topsPrecision.trim() } }
      : {}),
    runtimeSupport: {
      status: draft.runtimeSupportStatus,
      runtimes: draft.runtimeNames
        .split(",")
        .map((runtime) => runtime.trim())
        .filter(Boolean),
      method: draft.runtimeSupportMethod,
      notes: "Custom entry; verify model and runtime compatibility before deployment.",
    },
    ...(performanceBindingMatches
      ? {
          performance: {
            modelId: draft.performanceModelId!,
            quantizationId: draft.performanceQuantizationId!,
            contextTokens: draft.performanceContextTokens!,
            concurrency: draft.performanceConcurrency!,
            ...(isPositive(draft.effectiveTokensPerSecond)
              ? {
                  effectiveTokensPerSecond:
                    draft.effectiveTokensPerSecond,
                }
              : {}),
            ...(isNonNegative(draft.timeToFirstTokenSeconds)
              ? {
                  timeToFirstTokenSeconds:
                    draft.timeToFirstTokenSeconds,
                }
              : {}),
            method: "estimated" as const,
            notes: "User-supplied observation bound to the recorded model, quantization, context and concurrency; not derived from TOPS.",
          },
        }
      : {}),
  };
  const candidate: CustomDesktopSystemConfig =
    draft.memoryArchitecture === "dedicated"
      ? {
          ...common,
          memoryArchitecture: "dedicated",
          dedicatedMemoryGBPerDevice: draft.dedicatedMemoryPerUnitGB as number,
        }
      : {
          ...common,
          memoryArchitecture: "unified",
          allocatableUnifiedMemoryGB: draft.allocatableUnifiedMemoryGB as number,
        };
  const parsed = CustomDesktopSystemConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path.at(-1);
      if (typeof field === "string" && field in draft) {
        errors[field as keyof CustomDesktopSystemDraft] = issue.message;
      } else {
        errors.systemId = issue.message;
      }
    }
    return { source: "custom", record: null, hardware: null, errors, warnings: [] };
  }

  const warnings = [
    "Custom desktop specifications are user-supplied and should be verified before a purchase decision.",
  ];
  if (draft.tops !== null) {
    warnings.push("Peak TOPS is shown as a specification and is never converted into LLM TPS.");
  }
  if (draft.acceleratorCount! > 1 && !draft.supportsModelSharding) {
    warnings.push("Multi-device model sharding is not confirmed, so one device's memory is used for model fit.");
  }
  if (!hasPerformanceObservation) {
    warnings.push("No model-bound TPS observation was supplied, so local performance remains unavailable.");
  } else if (!performanceBindingMatches) {
    warnings.push("The saved performance observation does not match the active model, quantization, context and concurrency, so it is not reused.");
  }
  return {
    source: "custom",
    record: null,
    hardware: normalizeDesktopSystem(parsed.data),
    errors: {},
    warnings,
  };
}

export function resolveDesktopSystem(
  config: AdvisorConfig,
  catalogs: NormalizedCatalogs,
  selectedModelId: string | null,
  selectedQuantizationId: string | null,
  workload: WorkloadConfig,
): DesktopSystemResolution {
  if (config.hardwareSelection.mode !== "system") {
    return { source: null, record: null, hardware: null, errors: {}, warnings: [] };
  }
  if (config.hardwareSelection.systemInputMode === "custom") {
    return resolveCustomSystem(
      config.hardwareSelection.customSystem,
      selectedModelId,
      selectedQuantizationId,
      workload,
    );
  }

  const requestedSystemId = config.hardwareSelection.systemId;
  const matchedRecord = catalogs.systems.find(
    (system) => system.id === requestedSystemId,
  );
  const record = matchedRecord ?? catalogs.systems[0] ?? null;
  if (!record) {
    return {
      source: "catalog",
      record: null,
      hardware: null,
      errors: { systemId: "No desktop system is available in the current data pack." },
      warnings: [],
    };
  }
  const warnings = [
    ...(requestedSystemId && !matchedRecord
      ? [`Desktop system '${requestedSystemId}' is not in this data pack; the first available system is used.`]
      : []),
    record.dataQuality === "directional"
      ? "The selected desktop system uses directional sample data; replace it with verified product data before quoting."
      : "Verify the selected system against the deployment runtime and model build.",
  ];
  if (record.peakTops) {
    warnings.push("Peak TOPS is shown as a specification and is never converted into LLM TPS.");
  }
  return {
    source: "catalog",
    record,
    hardware: normalizeDesktopSystem(record),
    errors: {},
    warnings,
  };
}
