import type {
  CustomDesktopSystemConfig,
  DesktopSystemRecord,
  NormalizedDesktopHardware,
} from "./types";
import {
  CustomDesktopSystemConfigSchema,
  DesktopSystemRecordSchema,
} from "./schemas";

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "desktop-system";
}

function isCatalogRecord(
  input: DesktopSystemRecord | CustomDesktopSystemConfig,
): input is DesktopSystemRecord {
  return "dataQuality" in input && "lastUpdated" in input && "id" in input;
}

/**
 * Converts a physical desktop into one logical engine hardware unit.
 *
 * TOPS is preserved only as a specification. It is never converted to TPS.
 * If effective TPS or TTFT is provided, it travels as an explicit model-bound
 * performance override with its original evidence method.
 */
export function normalizeDesktopSystem(
  input: DesktopSystemRecord | CustomDesktopSystemConfig,
): NormalizedDesktopHardware {
  const system = isCatalogRecord(input)
    ? DesktopSystemRecordSchema.parse(input)
    : CustomDesktopSystemConfigSchema.parse(input);
  const id = system.id ?? `custom-${slugify(system.name)}`;
  const totalInstalledAcceleratorMemoryGB =
    system.memoryArchitecture === "dedicated"
      ? system.dedicatedMemoryGBPerDevice * system.acceleratorCount
      : system.allocatableUnifiedMemoryGB;
  const totalAvailableMemoryGB =
    system.memoryArchitecture === "dedicated" &&
    system.acceleratorCount > 1 &&
    !system.supportsModelSharding
      ? system.dedicatedMemoryGBPerDevice
      : totalInstalledAcceleratorMemoryGB;
  const gpuIdlePowerRatio =
    system.systemLoadWatts > 0
      ? Math.min(1, system.systemIdleWatts / system.systemLoadWatts)
      : 0;

  return {
    id,
    name: system.name,
    vendor: system.vendor,
    completeSystem: true,
    memoryArchitecture: system.memoryArchitecture,
    systemMemoryType: system.systemMemoryType,
    acceleratorType: system.acceleratorType,
    acceleratorBehaviorCategory: system.acceleratorBehaviorCategory,
    acceleratorModel: system.acceleratorModel,
    physicalAcceleratorCount: system.acceleratorCount,
    supportsModelSharding: system.supportsModelSharding,
    totalInstalledAcceleratorMemoryGB,
    totalAvailableMemoryGB,
    memoryBandwidthGBps: system.memoryBandwidthGBps,
    wholeSystemPurchasePriceUSD: system.purchasePriceUSD,
    wholeSystemIdleWatts: system.systemIdleWatts,
    wholeSystemLoadWatts: system.systemLoadWatts,
    peakTops: system.peakTops ?? null,
    runtimeSupport: system.runtimeSupport,
    performanceOverride: system.performance ?? null,
    engineGpu: {
      id: `system-${id}`,
      name: system.name,
      vendor: system.vendor,
      vramGB: totalAvailableMemoryGB,
      memoryBandwidthGBps: system.memoryBandwidthGBps,
      tdpWatts: system.systemLoadWatts,
      streetPriceUSD: system.purchasePriceUSD,
      interconnect: system.interconnect,
      supportedCounts: [1],
      supportsTensorParallel: system.supportsModelSharding,
      notes:
        "Complete-system adapter record. Use engineGpuCount=1 and apply engineEconomicsOverrides.",
    },
    engineGpuCount: 1,
    engineEconomicsOverrides: {
      hostPurchasePriceUSD: 0,
      hostIdlePowerWatts: 0,
      hostLoadPowerWatts: 0,
      gpuIdlePowerRatio,
    },
  };
}
