import { z } from "zod";
import { CurrencyCodeSchema } from "../../currency/schemas";

const finite = z.number().finite();
const nonNegative = finite.nonnegative();
const positive = finite.positive();
const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const ratio = finite.min(0).max(1);

const dataPackId = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/);
export const UseCaseSchema = dataPackId;
export const UsageFrequencySchema = dataPackId;
export const PrivacyRequirementSchema = z.enum(["low", "medium", "high", "critical"]);
export const CapabilityTierIdSchema = dataPackId;
/** @deprecated Use CapabilityTierIdSchema. */
export const IntelligenceClassSchema = CapabilityTierIdSchema;
export const LatencyRequirementSchema = z.enum(["best-effort", "interactive", "fast", "real-time"]);
export const AnalysisModeSchema = z.enum(["workload-first", "configuration-first"]);
export const GpuCountSchema = positiveInteger;
export { CurrencyCodeSchema };

function inferLegacyCustomAcceleratorCategory(value: unknown) {
  if (value === "gpu" || value === "GPU") return "gpu";
  if (value === "ai-accelerator" || value === "AI accelerator") return "ai-accelerator";
  if (value === "npu" || value === "NPU") return "npu";
  return "other";
}

function migrateLegacyCustomSystemDraft(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const migrated = { ...(value as Record<string, unknown>) };
  if (migrated.acceleratorBehaviorCategory === undefined) {
    migrated.acceleratorBehaviorCategory = inferLegacyCustomAcceleratorCategory(
      migrated.acceleratorType,
    );
  }
  if (migrated.acceleratorType === "gpu") migrated.acceleratorType = "GPU";
  if (migrated.acceleratorType === "ai-accelerator") {
    migrated.acceleratorType = "AI accelerator";
  }
  if (migrated.acceleratorType === "npu") migrated.acceleratorType = "NPU";
  migrated.topsPrecision ??= "mixed";
  return migrated;
}

const CustomDesktopSystemDraftBaseSchema = z.strictObject({
  name: z.string(),
  memoryArchitecture: z.enum(["dedicated", "unified"]),
  systemMemoryType: z.string(),
  systemRamGB: positive.nullable(),
  acceleratorType: z.string(),
  acceleratorBehaviorCategory: z.enum(["gpu", "ai-accelerator", "npu", "other"]),
  acceleratorName: z.string(),
  acceleratorCount: positiveInteger.nullable(),
  supportsModelSharding: z.boolean().default(false),
  dedicatedMemoryPerUnitGB: positive.nullable(),
  allocatableUnifiedMemoryGB: positive.nullable(),
  memoryBandwidthGBps: positive.nullable(),
  idlePowerWatts: nonNegative.nullable(),
  loadPowerWatts: positive.nullable(),
  purchasePriceUSD: nonNegative.nullable(),
  tops: positive.nullable(),
  topsPrecision: z.string(),
  effectiveTokensPerSecond: positive.nullable(),
  timeToFirstTokenSeconds: nonNegative.nullable().default(null),
  runtimeSupportStatus: z
    .enum(["supported", "partial", "experimental", "unknown"])
    .default("unknown"),
  runtimeSupportMethod: z
    .enum(["measured", "vendor-documented", "community-reported", "estimated"])
    .default("estimated"),
  runtimeNames: z.string().default(""),
  performanceModelId: z.string().min(1).nullable().default(null),
  performanceQuantizationId: z.string().min(1).nullable().default(null),
  performanceContextTokens: positiveInteger.nullable().default(null),
  performanceConcurrency: positiveInteger.nullable().default(null),
});

export const CustomDesktopSystemDraftSchema = z.preprocess(
  migrateLegacyCustomSystemDraft,
  CustomDesktopSystemDraftBaseSchema,
);

export const WorkloadConfigBaseSchema = z.strictObject({
    mode: z.enum(["simple", "advanced"]),
    useCase: UseCaseSchema,
    usageFrequency: UsageFrequencySchema,
    users: positiveInteger,
    privacyRequirement: PrivacyRequirementSchema,
    capabilityRequirementTierId: CapabilityTierIdSchema,
    latencyRequirement: LatencyRequirementSchema,
    monthlyRequests: z.number().int().nonnegative(),
    averageInputTokens: nonNegative,
    averageOutputTokens: nonNegative,
    averageAgentSteps: positive,
    peakConcurrentUsers: positiveInteger,
    averageContextLength: positiveInteger,
    peakContextLength: positiveInteger,
    workingHoursPerDay: positive.max(24),
    workingDaysPerMonth: positive.max(31),
  });

export function migrateLegacyWorkload(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const migrated = { ...(value as Record<string, unknown>) };
  if (
    migrated.capabilityRequirementTierId === undefined &&
    typeof migrated.intelligenceRequirement === "string"
  ) {
    migrated.capabilityRequirementTierId = migrated.intelligenceRequirement;
  }
  delete migrated.intelligenceRequirement;
  return migrated;
}

export const WorkloadConfigSchema = z
  .preprocess(migrateLegacyWorkload, WorkloadConfigBaseSchema)
  .superRefine((workload, ctx) => {
    if (workload.averageContextLength > workload.peakContextLength) {
      ctx.addIssue({
        code: "custom",
        path: ["averageContextLength"],
        message: "averageContextLength cannot exceed peakContextLength",
      });
    }
    const inputTokens =
      workload.monthlyRequests * workload.averageAgentSteps * workload.averageInputTokens;
    const outputTokens =
      workload.monthlyRequests * workload.averageAgentSteps * workload.averageOutputTokens;
    if (!Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens)) {
      ctx.addIssue({
        code: "custom",
        path: ["monthlyRequests"],
        message: "Token demand exceeds JavaScript's safe integer range",
      });
    }
  });

export const CustomCloudPricingSchema = z.strictObject({
  inputPricePerMillionTokens: nonNegative,
  outputPricePerMillionTokens: nonNegative,
  cachedInputPricePerMillionTokens: nonNegative.optional(),
});

export const AdvisorConfigSchema = z.strictObject({
  stateVersion: z.literal(1),
  analysisMode: AnalysisModeSchema.default("workload-first"),
  presetId: z.string().min(1).optional(),
  workload: WorkloadConfigSchema,
  modelSelection: z.strictObject({
    mode: z.enum(["recommended", "manual"]),
    modelId: z.string().min(1).optional(),
    quantizationId: z.string().min(1).optional(),
  }),
  hardwareSelection: z.strictObject({
    mode: z.enum(["existing", "recommended", "system"]),
    gpuId: z.string().min(1).optional(),
    gpuCount: GpuCountSchema,
    systemInputMode: z.enum(["catalog", "custom"]).optional(),
    systemId: z.string().min(1).optional(),
    customSystem: CustomDesktopSystemDraftSchema.optional(),
  }),
  economics: z.strictObject({
    displayCurrency: CurrencyCodeSchema.default("USD"),
    manualExchangeRateOverride: z.record(CurrencyCodeSchema, positive).optional(),
    hardwareUtilizationRatio: ratio.min(0.1),
    localCoverageRatio: ratio,
    cloudPricingId: z.string().min(1).optional(),
    customCloudPricing: CustomCloudPricingSchema.optional(),
    cachedInputRatio: ratio,
    electricityPricePerKWh: nonNegative,
    hardwareLifetimeMonths: positiveInteger,
    maintenanceCostMonthly: nonNegative,
  }),
});

export type ParsedAdvisorConfig = z.infer<typeof AdvisorConfigSchema>;
