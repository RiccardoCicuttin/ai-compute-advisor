import type { CapabilityTierId, GpuCount } from "./catalog";
import type { CurrencyCode } from "../currency/types";

export type CustomSystemMemoryArchitecture = "dedicated" | "unified";
export type CustomSystemAcceleratorBehaviorCategory =
  | "gpu"
  | "ai-accelerator"
  | "npu"
  | "other";

/**
 * Editable whole-system draft. Nullable numeric fields preserve an in-progress
 * browser form; the calculator only normalizes it once all required values are
 * valid. Catalog records use the stricter DesktopSystemRecord contract.
 */
export interface CustomDesktopSystemDraft {
  name: string;
  memoryArchitecture: CustomSystemMemoryArchitecture;
  systemMemoryType: string;
  systemRamGB: number | null;
  /** User-facing label, for example GPU, NPU, or a vendor-defined engine name. */
  acceleratorType: string;
  /** Stable behavior key used by calculator policy; never inferred from the display label. */
  acceleratorBehaviorCategory: CustomSystemAcceleratorBehaviorCategory;
  acceleratorName: string;
  acceleratorCount: number | null;
  supportsModelSharding: boolean;
  dedicatedMemoryPerUnitGB: number | null;
  allocatableUnifiedMemoryGB: number | null;
  memoryBandwidthGBps: number | null;
  idlePowerWatts: number | null;
  loadPowerWatts: number | null;
  purchasePriceUSD: number | null;
  tops: number | null;
  topsPrecision: string;
  effectiveTokensPerSecond: number | null;
  timeToFirstTokenSeconds: number | null;
  runtimeSupportStatus: "supported" | "partial" | "experimental" | "unknown";
  runtimeSupportMethod:
    | "measured"
    | "vendor-documented"
    | "community-reported"
    | "estimated";
  runtimeNames: string;
  performanceModelId: string | null;
  performanceQuantizationId: string | null;
  performanceContextTokens: number | null;
  performanceConcurrency: number | null;
}

/** Data-pack defined simple-mode mapping identifiers. */
export type UseCase = string;
export type UsageFrequency = string;
export type PrivacyRequirement = "low" | "medium" | "high" | "critical";
export type LatencyRequirement = "best-effort" | "interactive" | "fast" | "real-time";
export type AnalysisMode = "workload-first" | "configuration-first";

export interface WorkloadConfig {
  mode: "simple" | "advanced";
  useCase: UseCase;
  usageFrequency: UsageFrequency;
  users: number;
  privacyRequirement: PrivacyRequirement;
  capabilityRequirementTierId: CapabilityTierId;
  latencyRequirement: LatencyRequirement;
  monthlyRequests: number;
  averageInputTokens: number;
  averageOutputTokens: number;
  averageAgentSteps: number;
  peakConcurrentUsers: number;
  averageContextLength: number;
  peakContextLength: number;
  workingHoursPerDay: number;
  workingDaysPerMonth: number;
}

export interface AdvisorConfig {
  stateVersion: 1;
  analysisMode: AnalysisMode;
  presetId?: string;
  workload: WorkloadConfig;
  modelSelection: {
    mode: "recommended" | "manual";
    modelId?: string;
    quantizationId?: string;
  };
  hardwareSelection: {
    mode: "existing" | "recommended" | "system";
    gpuId?: string;
    gpuCount: GpuCount;
    systemInputMode?: "catalog" | "custom";
    systemId?: string;
    customSystem?: CustomDesktopSystemDraft;
  };
  economics: {
    displayCurrency: CurrencyCode;
    manualExchangeRateOverride?: Record<CurrencyCode, number>;
    hardwareUtilizationRatio: number;
    localCoverageRatio: number;
    cloudPricingId?: string;
    customCloudPricing?: {
      inputPricePerMillionTokens: number;
      outputPricePerMillionTokens: number;
      cachedInputPricePerMillionTokens?: number;
    };
    cachedInputRatio: number;
    electricityPricePerKWh: number;
    hardwareLifetimeMonths: number;
    maintenanceCostMonthly: number;
  };
}
