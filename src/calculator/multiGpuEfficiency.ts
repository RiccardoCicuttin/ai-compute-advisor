import type { AssumptionsRecord, GpuCount, Interconnect } from "../types";

export type MultiGpuEfficiencyMethod = "configured" | "conservative-fallback";

export interface MultiGpuEfficiencyResolution {
  gpuCount: GpuCount;
  efficiency: number;
  aggregateScale: number;
  method: MultiGpuEfficiencyMethod;
  warning: string | null;
}

/**
 * Resolves only an exact data-pack entry. Missing counts are deliberately not
 * interpolated: the conservative fallback assumes no aggregate throughput
 * gain (scale = 1) and emits a warning that is surfaced in the calculation.
 */
export function resolveMultiGpuEfficiency(
  assumptions: Pick<AssumptionsRecord, "multiGpuEfficiency">,
  interconnect: Interconnect,
  gpuCount: GpuCount,
): MultiGpuEfficiencyResolution {
  if (!Number.isSafeInteger(gpuCount) || gpuCount <= 0) {
    throw new RangeError("gpuCount must be a positive safe integer");
  }
  const configured = assumptions.multiGpuEfficiency[interconnect]?.[String(gpuCount)];
  if (configured !== undefined && Number.isFinite(configured) && configured > 0) {
    return {
      gpuCount,
      efficiency: configured,
      aggregateScale: gpuCount * configured,
      method: "configured",
      warning: null,
    };
  }

  const efficiency = 1 / gpuCount;
  return {
    gpuCount,
    efficiency,
    aggregateScale: 1,
    method: "conservative-fallback",
    warning:
      `MULTI_GPU_EFFICIENCY_MISSING: no exact ${interconnect}/${gpuCount} efficiency is configured; ` +
      "aggregate performance is conservatively held at 1×.",
  };
}
