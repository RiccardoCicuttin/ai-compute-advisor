import type {
  AssumptionsRecord,
  ComputeHardwareRecord,
  GpuCount,
  GpuRecord,
  HardwareFitResult,
  VramResult,
} from "../types";
import { trace, value } from "./trace";
import { resolveMultiGpuEfficiency } from "./multiGpuEfficiency";

export interface HardwareFitInput {
  gpu: ComputeHardwareRecord;
  gpuCount: GpuCount;
  vram: VramResult;
  assumptions: Pick<AssumptionsRecord, "vram" | "multiGpuEfficiency">;
}

export interface RankedHardwareOption {
  gpu: GpuRecord;
  gpuCount: GpuCount;
  fit: HardwareFitResult;
  purchasePriceUSD: number;
}

export function calculateHardwareFit(input: HardwareFitInput): HardwareFitResult {
  const canPoolModelMemory =
    input.gpuCount === 1 || input.gpu.supportsTensorParallel;
  const modelMemoryDeviceCount = canPoolModelMemory ? input.gpuCount : 1;
  const availableVramGB = input.gpu.vramGB * modelMemoryDeviceCount;
  const capacityRatio = availableVramGB / input.vram.recommendedVramGB;
  const headroomGB = availableVramGB - input.vram.recommendedVramGB;
  const thresholds = input.assumptions.vram.fitThresholds;
  const warnings: string[] = [];

  let status: HardwareFitResult["status"];
  if (availableVramGB < input.vram.hardMinimumGB) {
    status = "cannot-run";
  } else if (capacityRatio < thresholds.recommendedCapacityRatio) {
    status = "marginal";
  } else if (capacityRatio < thresholds.comfortableCapacityRatio) {
    status = "recommended";
  } else {
    status = "comfortable";
  }

  if (!input.gpu.supportedCounts.includes(input.gpuCount)) {
    status = "cannot-run";
    warnings.push(`${input.gpu.name} does not list ${input.gpuCount} GPUs as a supported configuration.`);
  }
  if (input.gpuCount > 1) {
    if (input.gpu.supportsTensorParallel) {
      warnings.push("Multi-GPU memory can scale, but inference performance does not scale linearly.");
    } else {
      warnings.push(
        "PHYSICAL_MULTI_GPU_WITHOUT_POOLING_EVIDENCE: this catalog count confirms a physical multi-card option, not validated tensor-parallel or model-sharding support; available memory for one model remains limited to one card.",
      );
    }
  }

  const efficiency = canPoolModelMemory
    ? resolveMultiGpuEfficiency(
        input.assumptions,
        input.gpu.interconnect,
        input.gpuCount,
      )
    : {
        gpuCount: input.gpuCount,
        efficiency: 1 / input.gpuCount,
        aggregateScale: 1,
        method: "conservative-fallback" as const,
        warning: null,
      };
  if (efficiency.warning) warnings.push(efficiency.warning);
  const multiGpuPerformanceScale = efficiency.aggregateScale;

  return {
    status,
    availableVramGB,
    requiredVramGB: input.vram.recommendedVramGB,
    capacityRatio,
    headroomGB,
    multiGpuEfficiency: efficiency.efficiency,
    multiGpuEfficiencyMethod: efficiency.method,
    multiGpuPerformanceScale,
    warnings,
    trace: trace({
      id: "hardware-fit",
      title: "Local hardware fit",
      formula: input.gpu.supportsTensorParallel
        ? "Available model VRAM = GPU VRAM × validated pooling count; compare with hard and recommended VRAM"
        : "Available model VRAM = VRAM on one GPU; physical card count is not pooled without tensor-parallel evidence",
      inputs: [
        value("gpuVram", "VRAM per GPU", input.gpu.vramGB, "GB", "gpu-data"),
        value("gpuCount", "Physical GPU count", input.gpuCount, "ratio", "user"),
        value("modelMemoryDeviceCount", "GPU count available to one model", modelMemoryDeviceCount, "ratio", "gpu-data"),
        value("required", "Recommended VRAM", input.vram.recommendedVramGB, "GB", "derived"),
      ],
      intermediateValues: [
        value("available", "Available VRAM", availableVramGB, "GB", "derived"),
        value("capacityRatio", "Capacity ratio", capacityRatio, "ratio", "derived"),
        value("multiGpuEfficiency", "Multi-GPU efficiency", efficiency.efficiency, "ratio", "assumption"),
      ],
      result: value("headroom", "VRAM headroom", headroomGB, "GB", "derived"),
      method: efficiency.method === "configured" ? "derived" : "estimated",
      warnings,
      sourceIds: [input.gpu.id],
    }),
  };
}

const statusRank: Record<HardwareFitResult["status"], number> = {
  recommended: 0,
  comfortable: 1,
  marginal: 2,
  "cannot-run": 3,
};

export function rankHardwareOptions(
  gpus: GpuRecord[],
  vram: VramResult,
  assumptions: Pick<AssumptionsRecord, "vram" | "multiGpuEfficiency">,
): RankedHardwareOption[] {
  const options: RankedHardwareOption[] = [];
  for (const gpu of gpus) {
    for (const gpuCount of gpu.supportedCounts) {
      const fit = calculateHardwareFit({ gpu, gpuCount, vram, assumptions });
      options.push({
        gpu,
        gpuCount,
        fit,
        purchasePriceUSD: gpu.streetPriceUSD * gpuCount,
      });
    }
  }

  return options.sort((left, right) => {
    const rankDifference = statusRank[left.fit.status] - statusRank[right.fit.status];
    if (rankDifference !== 0) return rankDifference;
    if (left.purchasePriceUSD !== right.purchasePriceUSD) {
      return left.purchasePriceUSD - right.purchasePriceUSD;
    }
    if (left.gpuCount !== right.gpuCount) return left.gpuCount - right.gpuCount;
    return right.fit.headroomGB - left.fit.headroomGB;
  });
}
