import { z } from "zod";
import {
  CloudPricingRecordSchema,
  ModelRecordSchema,
  QuantizationProfileSchema,
} from "./catalogSchemas";

export const LOCAL_MODEL_ID_PREFIX = "local.model.";
export const LOCAL_CLOUD_PRICING_ID_PREFIX = "local.price.";
export const LOCAL_MODEL_LIBRARY_MAX_RECORDS = 500;

const localModelId = z
  .string()
  .regex(/^local\.model\.[a-z0-9][a-z0-9._-]*$/);
const localPricingId = z
  .string()
  .regex(/^local\.price\.[a-z0-9][a-z0-9._-]*$/);
const nullablePositive = z.number().finite().positive().nullable();
const nullableNonNegative = z.number().finite().nonnegative().nullable();

export const LocalModelLibraryEntrySchema = z
  .strictObject({
    model: ModelRecordSchema,
    cloudPricing: CloudPricingRecordSchema.optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .superRefine((entry, context) => {
    if (!localModelId.safeParse(entry.model.id).success) {
      context.addIssue({
        code: "custom",
        path: ["model", "id"],
        message: `Browser-local model IDs must use the '${LOCAL_MODEL_ID_PREFIX}' namespace.`,
      });
    }

    const pricing = entry.cloudPricing;
    if (!pricing) return;
    if (!localPricingId.safeParse(pricing.id).success) {
      context.addIssue({
        code: "custom",
        path: ["cloudPricing", "id"],
        message: `Browser-local price IDs must use the '${LOCAL_CLOUD_PRICING_ID_PREFIX}' namespace.`,
      });
    }
    if (pricing.modelId !== entry.model.id) {
      context.addIssue({
        code: "custom",
        path: ["cloudPricing", "modelId"],
        message: "A browser-local price must reference its accompanying model.",
      });
    }
    if (pricing.modelName !== entry.model.name) {
      context.addIssue({
        code: "custom",
        path: ["cloudPricing", "modelName"],
        message: "A browser-local price must use its accompanying model name.",
      });
    }
    if (!pricing.sourceUrl) {
      context.addIssue({
        code: "custom",
        path: ["cloudPricing", "sourceUrl"],
        message: "Browser-local cloud pricing requires a source URL.",
      });
    }
  });

export const LocalModelLibrarySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    updatedAt: z.iso.datetime(),
    entries: z.array(LocalModelLibraryEntrySchema).max(LOCAL_MODEL_LIBRARY_MAX_RECORDS),
  })
  .superRefine((library, context) => {
    const modelIds = library.entries.map((entry) => entry.model.id);
    if (new Set(modelIds).size !== modelIds.length) {
      context.addIssue({
        code: "custom",
        path: ["entries"],
        message: "Browser-local model IDs must be unique.",
      });
    }
    const pricingIds = library.entries.flatMap((entry) =>
      entry.cloudPricing ? [entry.cloudPricing.id] : [],
    );
    if (new Set(pricingIds).size !== pricingIds.length) {
      context.addIssue({
        code: "custom",
        path: ["entries"],
        message: "Browser-local cloud price IDs must be unique.",
      });
    }
  });

/** Stable section shape for a future combined Browser Library Pack. */
export const BrowserLibraryModelsSectionSchema = z.strictObject({
  sectionSchemaVersion: z.literal(1),
  kind: z.literal("browser-local-model-library"),
  library: LocalModelLibrarySchema,
});

const LocalCloudPricingDraftSchema = z
  .strictObject({
    enabled: z.boolean(),
    provider: z.string(),
    inputPricePerMillionTokens: nullableNonNegative,
    outputPricePerMillionTokens: nullableNonNegative,
    cachedInputPricePerMillionTokens: nullableNonNegative,
    cacheWritePricePerMillionTokens: nullableNonNegative,
    sourceUrl: z.string(),
    lastUpdated: z.string(),
  })
  .superRefine((pricing, context) => {
    if (!pricing.enabled) return;
    if (!pricing.provider.trim()) {
      context.addIssue({ code: "custom", path: ["provider"], message: "Pricing provider is required." });
    }
    if (pricing.inputPricePerMillionTokens === null) {
      context.addIssue({ code: "custom", path: ["inputPricePerMillionTokens"], message: "Input price is required." });
    }
    if (pricing.outputPricePerMillionTokens === null) {
      context.addIssue({ code: "custom", path: ["outputPricePerMillionTokens"], message: "Output price is required." });
    }
    if (!z.url().safeParse(pricing.sourceUrl).success) {
      context.addIssue({ code: "custom", path: ["sourceUrl"], message: "A valid pricing source URL is required." });
    }
    if (!z.iso.date().safeParse(pricing.lastUpdated).success) {
      context.addIssue({ code: "custom", path: ["lastUpdated"], message: "A pricing observation date is required." });
    }
  });

/** Form-friendly input. Null numeric fields can represent an unfinished edit. */
export const LocalModelDraftSchema = z
  .strictObject({
    id: z.string().min(1),
    name: z.string().min(1),
    provider: z.string().min(1),
    family: z.string(),
    modelType: z.enum(["dense", "moe"]),
    totalParametersB: nullablePositive,
    activeParametersB: nullablePositive,
    contextWindowTokens: z.number().int().positive().nullable(),
    maxOutputTokens: z.number().int().positive().nullable(),
    recommendedQuantizationId: z.string().min(1),
    quantizations: z.array(QuantizationProfileSchema).min(1),
    capabilityTierId: z.string().min(1),
    reasoning: z.boolean(),
    modalities: z.array(z.enum(["text", "image", "audio"])).min(1),
    openWeight: z.boolean(),
    commercialUse: z.enum(["allowed", "restricted", "unknown"]),
    kvCacheBytesPerToken: nullablePositive,
    notes: z.string(),
    cloudPricing: LocalCloudPricingDraftSchema,
  })
  .superRefine((draft, context) => {
    if (draft.totalParametersB === null) {
      context.addIssue({ code: "custom", path: ["totalParametersB"], message: "Total parameters are required." });
    }
    if (draft.activeParametersB === null) {
      context.addIssue({ code: "custom", path: ["activeParametersB"], message: "Active parameters are required." });
    }
    if (draft.contextWindowTokens === null) {
      context.addIssue({ code: "custom", path: ["contextWindowTokens"], message: "Context window is required." });
    }
  });

export type LocalModelLibraryEntryInput = z.input<typeof LocalModelLibraryEntrySchema>;
export type LocalModelLibraryInput = z.input<typeof LocalModelLibrarySchema>;
export type BrowserLibraryModelsSectionInput = z.input<
  typeof BrowserLibraryModelsSectionSchema
>;
export type LocalModelDraft = z.infer<typeof LocalModelDraftSchema>;
