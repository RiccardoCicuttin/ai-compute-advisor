import type {
  AssumptionsRecord,
  ComputeHardwareRecord,
  GpuCount,
  InferenceProfileRecord,
  PerformanceResult,
  TokenDemandResult,
  WorkloadConfig,
} from "../types";
import { trace, value } from "./trace";
import { resolveMultiGpuEfficiency } from "./multiGpuEfficiency";

export interface PerformanceInput {
  modelId: string;
  quantizationId: string;
  gpu: ComputeHardwareRecord;
  gpuCount: GpuCount;
  workload: WorkloadConfig;
  tokenDemand: TokenDemandResult;
  profiles: InferenceProfileRecord[];
  assumptions: Pick<AssumptionsRecord, "multiGpuEfficiency">;
}

export function calculatePerformanceCapacity(input: PerformanceInput): PerformanceResult {
  const candidates = input.profiles.filter(
    (profile) =>
      profile.modelId === input.modelId &&
      profile.gpuId === input.gpu.id &&
      profile.quantizationId === input.quantizationId,
  );
  const exact = candidates.find(
    (profile) =>
      profile.gpuCount === input.gpuCount &&
      profile.contextTokens === input.workload.averageContextLength &&
      profile.concurrency === input.workload.peakConcurrentUsers,
  );
  const sameCount = candidates.find((profile) => profile.gpuCount === input.gpuCount);
  const requiresMatchingPhysicalCountEvidence =
    input.gpuCount > 1 && !input.gpu.supportsTensorParallel;
  const baseProfile =
    exact ??
    sameCount ??
    (requiresMatchingPhysicalCountEvidence ? undefined : candidates[0]);
  const operatingHours = input.workload.workingHoursPerDay * input.workload.workingDaysPerMonth;

  if (!baseProfile) {
    const warnings = [
      requiresMatchingPhysicalCountEvidence
        ? "PHYSICAL_MULTI_GPU_PROFILE_UNAVAILABLE: no performance profile matches this physical card count, and tensor-parallel/model-sharding support is not validated; throughput is not scaled from a single-card profile."
        : "No matching local inference profile is available; compute utilization is not estimated.",
    ];
    return {
      method: "unavailable",
      profileId: null,
      effectiveTokensPerSecond: null,
      outputTokensPerSecond: null,
      timeToFirstTokenSeconds: null,
      monthlyTokenCapacity: null,
      workloadComputeUtilizationRatio: null,
      warnings,
      trace: trace({
        id: "performance-capacity",
        title: "Local performance capacity",
        formula: "Effective tokens per second × 3,600 × operating hours",
        inputs: [],
        intermediateValues: [],
        result: value("capacity", "Monthly token capacity", null, "tokens/month", "derived"),
        method: "unavailable",
        warnings,
        sourceIds: [],
      }),
    };
  }

  const baseEfficiency = resolveMultiGpuEfficiency(
    input.assumptions,
    input.gpu.interconnect,
    baseProfile.gpuCount,
  );
  const targetEfficiency = resolveMultiGpuEfficiency(
    input.assumptions,
    input.gpu.interconnect,
    input.gpuCount,
  );
  const scale = targetEfficiency.aggregateScale / baseEfficiency.aggregateScale;
  const effectiveTokensPerSecond = baseProfile.effectiveTokensPerSecond * scale;
  const outputTokensPerSecond = baseProfile.outputTokensPerSecond
    ? baseProfile.outputTokensPerSecond * scale
    : null;
  const monthlyTokenCapacity = effectiveTokensPerSecond * 3600 * operatingHours;
  const workloadComputeUtilizationRatio =
    monthlyTokenCapacity > 0 ? input.tokenDemand.monthlyTotalTokens / monthlyTokenCapacity : null;
  const isExact = Boolean(exact);
  const method = isExact && baseProfile.method !== "estimated" ? baseProfile.method : "estimated";
  const warnings: string[] = [];
  if (baseEfficiency.warning) warnings.push(baseEfficiency.warning);
  if (targetEfficiency.warning && targetEfficiency.warning !== baseEfficiency.warning) {
    warnings.push(targetEfficiency.warning);
  }
  if (!isExact) {
    warnings.push("Performance uses the nearest available profile and is scaled as an estimate.");
  }
  if (requiresMatchingPhysicalCountEvidence) {
    warnings.push(
      "The matching multi-card profile may describe aggregate serving capacity; it does not establish pooled model memory.",
    );
  }
  if (workloadComputeUtilizationRatio !== null && workloadComputeUtilizationRatio > 1) {
    warnings.push("Estimated workload demand exceeds the selected hardware profile capacity.");
  }

  return {
    method,
    profileId: baseProfile.id,
    effectiveTokensPerSecond,
    outputTokensPerSecond,
    timeToFirstTokenSeconds: baseProfile.timeToFirstTokenSeconds ?? null,
    monthlyTokenCapacity,
    workloadComputeUtilizationRatio,
    warnings,
    trace: trace({
      id: "performance-capacity",
      title: "Local performance capacity",
      formula: "Profile tokens/second × multi-GPU scale × 3,600 × operating hours",
      inputs: [
        value("profileTps", "Profile effective TPS", baseProfile.effectiveTokensPerSecond, "tokens/second", "model-data"),
        value("performanceScale", "Multi-GPU scale", scale, "ratio", "assumption"),
        value("operatingHours", "Operating hours", operatingHours, "hours", "user"),
      ],
      intermediateValues: [
        value("effectiveTps", "Effective TPS", effectiveTokensPerSecond, "tokens/second", "derived"),
        value("capacity", "Monthly token capacity", monthlyTokenCapacity, "tokens/month", "derived"),
      ],
      result: value("computeUtilization", "Workload compute utilization", workloadComputeUtilizationRatio, "ratio", "derived"),
      method,
      warnings,
      sourceIds: [baseProfile.id],
    }),
  };
}
