import type { ComputeHardwareRecord, Interconnect, MetricMethod } from "../types";

export type MemoryArchitecture = "dedicated" | "unified";
/** Data-pack display label; memory architecture carries calculation behavior. */
export type SystemMemoryType = string;
/** User/data-pack display label; calculations use acceleratorBehaviorCategory. */
export type AcceleratorType = string;
export type AcceleratorBehaviorCategory = "gpu" | "ai-accelerator" | "npu" | "other";
export type AcceleratorCount = number;
export type RuntimeSupportStatus = "supported" | "partial" | "experimental" | "unknown";
export type RuntimeSupportMethod =
  | "measured"
  | "vendor-documented"
  | "community-reported"
  | "estimated";

export interface PeakTopsSpecification {
  value: number;
  precision: string;
}

export interface RuntimeSupport {
  status: RuntimeSupportStatus;
  runtimes: string[];
  operatingSystems?: string[];
  method: RuntimeSupportMethod;
  notes?: string;
}

export interface SystemPerformanceOverride {
  modelId: string;
  quantizationId?: string;
  contextTokens?: number;
  concurrency?: number;
  effectiveTokensPerSecond?: number;
  timeToFirstTokenSeconds?: number;
  method: Exclude<MetricMethod, "unavailable">;
  notes?: string;
}

interface DesktopSystemCommon {
  name: string;
  vendor: string;
  acceleratorType: AcceleratorType;
  acceleratorBehaviorCategory: AcceleratorBehaviorCategory;
  acceleratorModel: string;
  acceleratorCount: AcceleratorCount;
  supportsModelSharding: boolean;
  systemMemoryType: SystemMemoryType;
  systemMemoryGB: number;
  memoryBandwidthGBps: number;
  interconnect: Interconnect;
  peakTops?: PeakTopsSpecification;
  runtimeSupport: RuntimeSupport;
  performance?: SystemPerformanceOverride;
  notes?: string;
}

export interface DesktopSystemEconomicsEvidence {
  systemIdleWatts: number | null;
  systemLoadWatts: number | null;
  purchasePriceUSD: number | null;
}

export interface CompleteDesktopSystemEconomics {
  systemIdleWatts: number;
  systemLoadWatts: number;
  purchasePriceUSD: number;
}

export type DesktopMemoryConfiguration =
  | {
      memoryArchitecture: "dedicated";
      dedicatedMemoryGBPerDevice: number;
      allocatableUnifiedMemoryGB?: never;
    }
  | {
      memoryArchitecture: "unified";
      dedicatedMemoryGBPerDevice?: never;
      allocatableUnifiedMemoryGB: number;
    };

export type DesktopSystemRecord = DesktopSystemCommon &
  DesktopSystemEconomicsEvidence &
  DesktopMemoryConfiguration & {
    id: string;
    dataQuality: "directional" | "verified";
    lastUpdated: string;
    source?: {
      label: string;
      url?: string;
    };
  };

export type CustomDesktopSystemConfig = DesktopSystemCommon &
  CompleteDesktopSystemEconomics &
  DesktopMemoryConfiguration & {
    id?: string;
  };

export interface DesktopSystemsCatalog {
  schemaVersion: 1;
  catalogId: "desktop-systems";
  lastUpdated: string;
  source: {
    label: string;
    methodology?: string;
    url?: string;
  };
  data: DesktopSystemRecord[];
}

export interface NormalizedSystemPerformanceOverride {
  modelId: string;
  quantizationId?: string;
  contextTokens?: number;
  concurrency?: number;
  effectiveTokensPerSecond?: number;
  timeToFirstTokenSeconds?: number;
  method: Exclude<MetricMethod, "unavailable">;
  notes?: string;
}

/**
 * Adapter result for the existing calculator. `engineGpu` represents the
 * complete desktop as one logical hardware unit, so consumers must pass
 * `engineGpuCount` (always 1) rather than the physical accelerator count.
 */
export interface NormalizedDesktopHardware {
  id: string;
  name: string;
  vendor: string;
  completeSystem: true;
  memoryArchitecture: MemoryArchitecture;
  systemMemoryType: SystemMemoryType;
  acceleratorType: AcceleratorType;
  acceleratorBehaviorCategory: AcceleratorBehaviorCategory;
  acceleratorModel: string;
  physicalAcceleratorCount: AcceleratorCount;
  supportsModelSharding: boolean;
  totalInstalledAcceleratorMemoryGB: number;
  totalAvailableMemoryGB: number;
  memoryBandwidthGBps: number;
  wholeSystemPurchasePriceUSD: number | null;
  wholeSystemIdleWatts: number | null;
  wholeSystemLoadWatts: number | null;
  economicsEvidenceAvailable: boolean;
  peakTops: PeakTopsSpecification | null;
  runtimeSupport: RuntimeSupport;
  performanceOverride: NormalizedSystemPerformanceOverride | null;

  engineGpu: ComputeHardwareRecord;
  engineGpuCount: 1;
  engineEconomicsOverrides: {
    hostPurchasePriceUSD: 0;
    hostIdlePowerWatts: 0;
    hostLoadPowerWatts: 0;
    gpuIdlePowerRatio: number;
  } | null;
}
