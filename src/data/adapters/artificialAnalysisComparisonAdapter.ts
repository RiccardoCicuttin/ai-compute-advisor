import { z } from "zod";
import {
  ARTIFICIAL_ANALYSIS_COMPARISON_ID_PREFIX,
  ArtificialAnalysisComparisonRecordSchema,
  type ArtificialAnalysisComparisonRecord,
} from "../schemas";

export const ARTIFICIAL_ANALYSIS_LEGACY_MODELS_ENDPOINT =
  "https://artificialanalysis.ai/api/v2/data/llms/models";
export const ARTIFICIAL_ANALYSIS_FREE_MODELS_ENDPOINT =
  "https://artificialanalysis.ai/api/v2/language/models/free";

const nullableFinite = z.number().finite().nullable().optional();
const nullableNonNegative = z.number().finite().nonnegative().nullable().optional();

// Provider payloads are intentionally passthrough: the API can add fields without
// breaking imports. Every known field is still type-checked, and the normalized
// browser-local record below is strict so unknown provider fields cannot leak in.
const CreatorSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    slug: z.string().trim().min(1).nullable().optional(),
  })
  .passthrough();

const EvaluationsSchema = z
  .object({
    artificial_analysis_intelligence_index: nullableFinite,
    artificial_analysis_coding_index: nullableFinite,
    artificial_analysis_math_index: nullableFinite,
  })
  .passthrough();

const PricingSchema = z
  .object({
    price_1m_input_tokens: nullableNonNegative,
    price_1m_output_tokens: nullableNonNegative,
    price_1m_cache_hit_tokens: nullableNonNegative,
    price_1m_cached_input_tokens: nullableNonNegative,
    price_1m_cache_write_tokens: nullableNonNegative,
  })
  .passthrough();

const PerformanceSchema = z
  .object({
    median_output_tokens_per_second: z.number().finite().positive().nullable().optional(),
    median_time_to_first_token_seconds: z.number().finite().nonnegative().nullable().optional(),
  })
  .passthrough();

const SourceModelSchema = z
  .object({
    id: z.string().trim().min(1).max(512),
    name: z.string().trim().min(1),
    slug: z.string().trim().min(1),
    model_creator: CreatorSchema,
    evaluations: EvaluationsSchema.nullable().optional(),
    pricing: PricingSchema.nullable().optional(),
    performance: PerformanceSchema.nullable().optional(),
    // The legacy endpoint exposed these two medians at model level.
    median_output_tokens_per_second: z.number().finite().positive().nullable().optional(),
    median_time_to_first_token_seconds: z.number().finite().nonnegative().nullable().optional(),
  })
  .passthrough();

export const ArtificialAnalysisModelsSnapshotSchema = z
  .object({
    status: z.number().int().optional(),
    tier: z.enum(["free", "pro", "commercial"]).optional(),
    intelligence_index_version: z.number().finite().positive().nullable().optional(),
    data: z.array(SourceModelSchema),
  })
  .passthrough()
  .superRefine((snapshot, context) => {
    if (snapshot.status !== undefined && snapshot.status !== 200) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Artificial Analysis snapshot status must be 200.",
      });
    }
  });

export interface AdaptArtificialAnalysisSnapshotOptions {
  importedAt: Date | string;
  /** Use the endpoint that produced the snapshot. No network request is made. */
  sourceEndpoint?: string;
}

function isoTimestamp(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("Artificial Analysis import timestamp must be a valid date.");
  }
  return date.toISOString();
}

/** Collision-free, deterministic namespace based on the stable external ID bytes. */
export function createArtificialAnalysisComparisonId(externalId: string): string {
  const normalized = externalId.trim();
  if (!normalized) throw new RangeError("Artificial Analysis external model ID is required.");
  const hex = Array.from(new TextEncoder().encode(normalized), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${ARTIFICIAL_ANALYSIS_COMPARISON_ID_PREFIX}${hex}`;
}

function nullable(value: number | null | undefined): number | null {
  return value ?? null;
}

/**
 * Converts an authenticated API response snapshot into comparison-only records.
 * This adapter never fetches, handles an API key, or creates calculator ModelRecords.
 */
export function adaptArtificialAnalysisModelsSnapshot(
  input: unknown,
  options: AdaptArtificialAnalysisSnapshotOptions,
): ArtificialAnalysisComparisonRecord[] {
  const snapshot = ArtificialAnalysisModelsSnapshotSchema.parse(input);
  const importedAt = isoTimestamp(options.importedAt);
  const sourceEndpoint = z.url().parse(
    options.sourceEndpoint ??
      (snapshot.status !== undefined
        ? ARTIFICIAL_ANALYSIS_LEGACY_MODELS_ENDPOINT
        : ARTIFICIAL_ANALYSIS_FREE_MODELS_ENDPOINT),
  );

  return snapshot.data.map((model) => {
    const evaluations = model.evaluations;
    const pricing = model.pricing;
    const performance = model.performance;
    return ArtificialAnalysisComparisonRecordSchema.parse({
      id: createArtificialAnalysisComparisonId(model.id),
      externalId: model.id,
      name: model.name,
      slug: model.slug,
      creator: {
        externalId: model.model_creator.id,
        name: model.model_creator.name,
        slug: model.model_creator.slug ?? null,
      },
      intelligenceScore: nullable(
        evaluations?.artificial_analysis_intelligence_index,
      ),
      codingScore: nullable(evaluations?.artificial_analysis_coding_index),
      mathScore: nullable(evaluations?.artificial_analysis_math_index),
      inputPriceUsdPerMillionTokens: nullable(pricing?.price_1m_input_tokens),
      outputPriceUsdPerMillionTokens: nullable(pricing?.price_1m_output_tokens),
      cacheHitPriceUsdPerMillionTokens: nullable(
        pricing?.price_1m_cache_hit_tokens ?? pricing?.price_1m_cached_input_tokens,
      ),
      cacheWritePriceUsdPerMillionTokens: nullable(
        pricing?.price_1m_cache_write_tokens,
      ),
      medianOutputTokensPerSecond: nullable(
        performance?.median_output_tokens_per_second ??
          model.median_output_tokens_per_second,
      ),
      medianTimeToFirstTokenSeconds: nullable(
        performance?.median_time_to_first_token_seconds ??
          model.median_time_to_first_token_seconds,
      ),
      intelligenceIndexVersion: nullable(snapshot.intelligence_index_version),
      sourceUrl: `https://artificialanalysis.ai/models/${encodeURIComponent(model.slug)}`,
      sourceEndpoint,
      importedAt,
    });
  });
}
