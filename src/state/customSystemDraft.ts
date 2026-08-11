import type { CustomDesktopSystemDraft } from "../types";

export function createDefaultCustomSystemDraft(): CustomDesktopSystemDraft {
  return {
    name: "Custom inference workstation",
    memoryArchitecture: "dedicated",
    systemMemoryType: "DDR5",
    systemRamGB: 128,
    acceleratorType: "GPU",
    acceleratorBehaviorCategory: "gpu",
    acceleratorName: "Custom accelerator",
    acceleratorCount: 1,
    supportsModelSharding: false,
    dedicatedMemoryPerUnitGB: 24,
    allocatableUnifiedMemoryGB: null,
    memoryBandwidthGBps: 900,
    idlePowerWatts: 85,
    loadPowerWatts: 500,
    purchasePriceUSD: 4_500,
    tops: null,
    topsPrecision: "mixed",
    effectiveTokensPerSecond: null,
    timeToFirstTokenSeconds: null,
    runtimeSupportStatus: "unknown",
    runtimeSupportMethod: "estimated",
    runtimeNames: "",
    performanceModelId: null,
    performanceQuantizationId: null,
    performanceContextTokens: null,
    performanceConcurrency: null,
  };
}
