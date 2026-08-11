import { z } from "zod";

const finite = z.number().finite();
const positive = finite.positive();
const nonNegative = finite.nonnegative();
const id = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/);
const isoDate = z.iso.date();
const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const MemoryArchitectureSchema = z.enum(["dedicated", "unified"]);
export const SystemMemoryTypeSchema = z.string().min(1);
export const AcceleratorTypeSchema = z.string().min(1);
export const AcceleratorBehaviorCategorySchema = z.enum([
  "gpu",
  "ai-accelerator",
  "npu",
  "other",
]);
export const AcceleratorCountSchema = positiveInteger;
export const InterconnectSchema = z.enum(["pcie", "nvlink", "unified", "other"]);

export const PeakTopsSpecificationSchema = z.strictObject({
  value: positive,
  precision: z.string().min(1),
});

export const RuntimeSupportSchema = z.strictObject({
  status: z.enum(["supported", "partial", "experimental", "unknown"]),
  runtimes: z.array(z.string().min(1)),
  operatingSystems: z.array(z.string().min(1)).optional(),
  method: z.enum(["measured", "vendor-documented", "community-reported", "estimated"]),
  notes: z.string().min(1).optional(),
});

export const SystemPerformanceOverrideSchema = z
  .strictObject({
    modelId: id,
    quantizationId: id.optional(),
    contextTokens: z.number().int().positive().optional(),
    concurrency: z.number().int().positive().optional(),
    effectiveTokensPerSecond: positive.optional(),
    timeToFirstTokenSeconds: nonNegative.optional(),
    method: z.enum(["measured", "derived", "estimated"]),
    notes: z.string().min(1).optional(),
  })
  .refine(
    (performance) =>
      performance.effectiveTokensPerSecond !== undefined ||
      performance.timeToFirstTokenSeconds !== undefined,
    { message: "A performance override must provide effective TPS or TTFT" },
  );

const commonShape = {
  name: z.string().min(1),
  vendor: z.string().min(1),
  acceleratorType: AcceleratorTypeSchema,
  acceleratorBehaviorCategory: AcceleratorBehaviorCategorySchema,
  acceleratorModel: z.string().min(1),
  acceleratorCount: AcceleratorCountSchema,
  supportsModelSharding: z.boolean(),
  systemMemoryType: SystemMemoryTypeSchema,
  systemMemoryGB: positive,
  memoryBandwidthGBps: positive,
  interconnect: InterconnectSchema,
  peakTops: PeakTopsSpecificationSchema.optional(),
  runtimeSupport: RuntimeSupportSchema,
  performance: SystemPerformanceOverrideSchema.optional(),
  notes: z.string().min(1).optional(),
};

const catalogEconomicsShape = {
  systemIdleWatts: nonNegative.nullable(),
  systemLoadWatts: positive.nullable(),
  purchasePriceUSD: nonNegative.nullable(),
};

const completeEconomicsShape = {
  systemIdleWatts: nonNegative,
  systemLoadWatts: positive,
  purchasePriceUSD: nonNegative,
};

const recordIdentityShape = {
  id,
  dataQuality: z.enum(["directional", "verified"]),
  lastUpdated: isoDate,
  source: z
    .strictObject({
      label: z.string().min(1),
      url: z.url().optional(),
    })
    .optional(),
};

function inferLegacyBehaviorCategory(acceleratorType: unknown) {
  if (acceleratorType === "GPU") return "gpu";
  if (acceleratorType === "AI accelerator") return "ai-accelerator";
  if (acceleratorType === "NPU") return "npu";
  return "other";
}

function migrateLegacyAcceleratorBehavior(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const migrated = { ...(value as Record<string, unknown>) };
  migrated.acceleratorBehaviorCategory ??= inferLegacyBehaviorCategory(migrated.acceleratorType);
  return migrated;
}

function validateSystem(
  system: {
    memoryArchitecture: "dedicated" | "unified";
    systemMemoryType: string;
    systemMemoryGB: number;
    interconnect: "pcie" | "nvlink" | "unified" | "other";
    systemIdleWatts: number | null;
    systemLoadWatts: number | null;
    allocatableUnifiedMemoryGB?: number;
  },
  ctx: z.RefinementCtx,
): void {
  if (
    system.systemLoadWatts !== null &&
    system.systemIdleWatts !== null &&
    system.systemLoadWatts < system.systemIdleWatts
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["systemLoadWatts"],
      message: "systemLoadWatts cannot be below systemIdleWatts",
    });
  }
  if (
    system.memoryArchitecture === "unified" &&
    system.allocatableUnifiedMemoryGB !== undefined &&
    system.allocatableUnifiedMemoryGB > system.systemMemoryGB
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["allocatableUnifiedMemoryGB"],
      message: "Allocatable unified memory cannot exceed installed system memory",
    });
  }
  if (system.memoryArchitecture === "unified" && system.interconnect !== "unified") {
    ctx.addIssue({
      code: "custom",
      path: ["interconnect"],
      message: "Unified-memory systems must use the unified interconnect value",
    });
  }
  if (system.memoryArchitecture === "dedicated" && system.interconnect === "unified") {
    ctx.addIssue({
      code: "custom",
      path: ["interconnect"],
      message: "Dedicated-memory systems cannot use the unified interconnect value",
    });
  }
}

const dedicatedRecordSchema = z
  .strictObject({
    ...commonShape,
    ...catalogEconomicsShape,
    ...recordIdentityShape,
    memoryArchitecture: z.literal("dedicated"),
    dedicatedMemoryGBPerDevice: positive,
  })
  .superRefine(validateSystem);

const unifiedRecordSchema = z
  .strictObject({
    ...commonShape,
    ...catalogEconomicsShape,
    ...recordIdentityShape,
    memoryArchitecture: z.literal("unified"),
    allocatableUnifiedMemoryGB: positive,
  })
  .superRefine(validateSystem);

export const DesktopSystemRecordSchema = z.preprocess(
  migrateLegacyAcceleratorBehavior,
  z.union([dedicatedRecordSchema, unifiedRecordSchema]),
);

const dedicatedCustomSchema = z
  .strictObject({
    ...commonShape,
    ...completeEconomicsShape,
    id: id.optional(),
    memoryArchitecture: z.literal("dedicated"),
    dedicatedMemoryGBPerDevice: positive,
  })
  .superRefine(validateSystem);

const unifiedCustomSchema = z
  .strictObject({
    ...commonShape,
    ...completeEconomicsShape,
    id: id.optional(),
    memoryArchitecture: z.literal("unified"),
    allocatableUnifiedMemoryGB: positive,
  })
  .superRefine(validateSystem);

export const CustomDesktopSystemConfigSchema = z.preprocess(
  migrateLegacyAcceleratorBehavior,
  z.union([dedicatedCustomSchema, unifiedCustomSchema]),
);

export const DesktopSystemsCatalogSchema = z.strictObject({
  schemaVersion: z.literal(1),
  catalogId: z.literal("desktop-systems"),
  lastUpdated: isoDate,
  source: z.strictObject({
    label: z.string().min(1),
    methodology: z.string().min(1).optional(),
    url: z.url().optional(),
  }),
  data: z.array(DesktopSystemRecordSchema),
});

export function parseDesktopSystemsCatalog(raw: unknown) {
  return DesktopSystemsCatalogSchema.parse(raw);
}
