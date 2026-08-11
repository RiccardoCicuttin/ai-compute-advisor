import type {
  AdvisorConfig,
  InferenceProfileRecord,
  ModelRecord,
  NormalizedCatalogs,
  TokenDemandResult,
  WorkloadConfig,
} from "../types";
import type { NormalizedDesktopHardware } from "../systems";
import { compareCapabilityTiers } from "./capabilityTiers";
import { resolveDesktopSystem } from "./desktopSystemCalculator";
import { calculateHardwareFit } from "./hardwareFitCalculator";
import { calculatePerformanceCapacity } from "./performanceCalculator";
import { calculateVramRequirement } from "./vramCalculator";

export interface ConfigurationFirstModelSelectionResult {
  selectedModelId: string | null;
  evaluatedModelIds: string[];
  runnableModelIds: string[];
  warnings: string[];
}

function overrideProfile(
  system: NormalizedDesktopHardware,
  model: ModelRecord,
  quantizationId: string,
  workload: WorkloadConfig,
  lastUpdated: string,
): InferenceProfileRecord | null {
  const performance = system.performanceOverride;
  if (
    !performance?.effectiveTokensPerSecond ||
    performance.modelId !== model.id ||
    performance.quantizationId !== quantizationId ||
    performance.contextTokens !== workload.averageContextLength ||
    performance.concurrency !== workload.peakConcurrentUsers
  ) {
    return null;
  }
  return {
    id: `system-profile-${system.id}`,
    modelId: model.id,
    gpuId: system.engineGpu.id,
    quantizationId,
    gpuCount: 1,
    inputTokens: workload.averageInputTokens,
    outputTokens: workload.averageOutputTokens,
    contextTokens: workload.averageContextLength,
    concurrency: workload.peakConcurrentUsers,
    effectiveTokensPerSecond: performance.effectiveTokensPerSecond,
    ...(performance.timeToFirstTokenSeconds !== undefined
      ? { timeToFirstTokenSeconds: performance.timeToFirstTokenSeconds }
      : {}),
    framework: "Complete-system observation",
    method: performance.method,
    lastUpdated,
  };
}

/**
 * Selects the highest-ranked model that the explicitly selected hardware can
 * run with memory, runtime and throughput evidence. TOPS is never considered.
 */
export function selectConfigurationFirstModel(input: {
  config: AdvisorConfig;
  catalogs: NormalizedCatalogs;
  workload: WorkloadConfig;
  tokenDemand: TokenDemandResult;
}): ConfigurationFirstModelSelectionResult {
  const { config, catalogs, workload, tokenDemand } = input;
  if (config.hardwareSelection.mode === "recommended") {
    return {
      selectedModelId: null,
      evaluatedModelIds: [],
      runnableModelIds: [],
      warnings: [
        "CONFIGURATION_FIRST_REQUIRES_SELECTED_HARDWARE: falling back to workload-first model selection.",
      ],
    };
  }

  const rankedModels = [...catalogs.models].sort(
    (left, right) =>
      compareCapabilityTiers(
        right.capabilityTierId,
        left.capabilityTierId,
        catalogs.assumptions.capabilityTiers,
      ) ||
      right.totalParametersB - left.totalParametersB ||
      left.id.localeCompare(right.id),
  );
  const runnableModelIds: string[] = [];
  const evaluatedModelIds: string[] = [];

  for (const model of rankedModels) {
    evaluatedModelIds.push(model.id);
    if (model.contextWindowTokens < workload.peakContextLength) continue;
    if (workload.privacyRequirement === "critical" && !model.openWeight) continue;
    const quantization = model.quantizations.find(
      (candidate) => candidate.id === model.recommendedQuantizationId,
    );
    if (!quantization) continue;

    const vram = calculateVramRequirement({
      model,
      quantization,
      peakContextTokens: workload.peakContextLength,
      peakConcurrentUsers: workload.peakConcurrentUsers,
      assumptions: catalogs.assumptions.vram,
    });
    const systemResolution = resolveDesktopSystem(
      config,
      catalogs,
      model.id,
      quantization.id,
      workload,
    );
    const system = systemResolution.hardware;
    const gpu =
      config.hardwareSelection.mode === "system"
        ? system?.engineGpu ?? null
        : config.hardwareSelection.gpuId
          ? catalogs.gpus.find((candidate) => candidate.id === config.hardwareSelection.gpuId) ?? null
          : null;
    const gpuCount = system?.engineGpuCount ?? config.hardwareSelection.gpuCount;
    if (!gpu) continue;
    if (system && system.runtimeSupport.status !== "supported") continue;

    const fit = calculateHardwareFit({
      gpu,
      gpuCount,
      vram,
      assumptions: catalogs.assumptions,
    });
    if (fit.status === "cannot-run") continue;

    const exactOverride = system
      ? overrideProfile(
          system,
          model,
          quantization.id,
          workload,
          systemResolution.record?.lastUpdated ?? catalogs.metadata.systems.lastUpdated,
        )
      : null;
    const performance = calculatePerformanceCapacity({
      modelId: model.id,
      quantizationId: quantization.id,
      gpu,
      gpuCount,
      workload,
      tokenDemand,
      profiles: exactOverride
        ? [exactOverride, ...catalogs.inferenceProfiles]
        : catalogs.inferenceProfiles,
      assumptions: catalogs.assumptions,
    });
    if (
      performance.effectiveTokensPerSecond === null ||
      performance.workloadComputeUtilizationRatio === null ||
      performance.workloadComputeUtilizationRatio > 1
    ) {
      continue;
    }
    runnableModelIds.push(model.id);
  }

  const selectedModelId = runnableModelIds[0] ?? null;
  const runtimeAssumptionWarning =
    config.hardwareSelection.mode === "existing"
      ? [
          "CONFIGURATION_FIRST_GPU_RUNTIME_ASSUMED: standalone GPU records do not carry runtime compatibility metadata; runtime support is assumed and must be verified.",
        ]
      : [];
  return {
    selectedModelId,
    evaluatedModelIds,
    runnableModelIds,
    warnings: [
      ...runtimeAssumptionWarning,
      ...(selectedModelId
        ? [
            `CONFIGURATION_FIRST_SELECTION: '${selectedModelId}' is the highest capability model with sufficient memory and catalog performance capacity on the selected hardware.`,
          ]
        : [
            "CONFIGURATION_FIRST_NO_RUNNABLE_MODEL: no catalog model has sufficient memory and confirmed performance capacity on the selected hardware; falling back to workload-first model selection.",
          ]),
    ],
  };
}
