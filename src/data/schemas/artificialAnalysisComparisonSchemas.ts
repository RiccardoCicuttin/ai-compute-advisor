import { z } from "zod";

export const ARTIFICIAL_ANALYSIS_COMPARISON_ID_PREFIX =
  "aa.comparison.v1.";
export const ARTIFICIAL_ANALYSIS_COMPARISON_LIBRARY_MAX_RECORDS = 2_000;

const nullableMetric = z.number().finite().nullable();
const nullableNonNegativeMetric = z.number().finite().nonnegative().nullable();

export const ArtificialAnalysisComparisonRecordSchema = z.strictObject({
  id: z
    .string()
    .regex(/^aa\.comparison\.v1\.[0-9a-f]+$/),
  externalId: z.string().trim().min(1).max(512),
  name: z.string().trim().min(1),
  slug: z.string().trim().min(1),
  creator: z.strictObject({
    externalId: z.string().trim().min(1),
    name: z.string().trim().min(1),
    slug: z.string().trim().min(1).nullable(),
  }),
  intelligenceScore: nullableMetric,
  codingScore: nullableMetric,
  mathScore: nullableMetric,
  inputPriceUsdPerMillionTokens: nullableNonNegativeMetric,
  outputPriceUsdPerMillionTokens: nullableNonNegativeMetric,
  cacheHitPriceUsdPerMillionTokens: nullableNonNegativeMetric,
  cacheWritePriceUsdPerMillionTokens: nullableNonNegativeMetric,
  medianOutputTokensPerSecond: z.number().finite().positive().nullable(),
  medianTimeToFirstTokenSeconds: z.number().finite().nonnegative().nullable(),
  intelligenceIndexVersion: z.number().finite().positive().nullable(),
  sourceUrl: z.url(),
  sourceEndpoint: z.url(),
  importedAt: z.iso.datetime(),
});

export const ArtificialAnalysisComparisonLibrarySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    updatedAt: z.iso.datetime(),
    records: z
      .array(ArtificialAnalysisComparisonRecordSchema)
      .max(ARTIFICIAL_ANALYSIS_COMPARISON_LIBRARY_MAX_RECORDS),
  })
  .superRefine((library, context) => {
    const ids = library.records.map((record) => record.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["records"],
        message: "Artificial Analysis comparison record IDs must be unique.",
      });
    }
    const externalIds = library.records.map((record) => record.externalId);
    if (new Set(externalIds).size !== externalIds.length) {
      context.addIssue({
        code: "custom",
        path: ["records"],
        message: "Artificial Analysis external model IDs must be unique.",
      });
    }
  });

/** Strict section shape for embedding in the combined Browser Library Pack. */
export const BrowserLibraryArtificialAnalysisSectionSchema = z.strictObject({
  sectionSchemaVersion: z.literal(1),
  kind: z.literal("artificial-analysis-comparison-library"),
  library: ArtificialAnalysisComparisonLibrarySchema,
});

export type ArtificialAnalysisComparisonRecord = z.infer<
  typeof ArtificialAnalysisComparisonRecordSchema
>;
export type ArtificialAnalysisComparisonLibrary = z.infer<
  typeof ArtificialAnalysisComparisonLibrarySchema
>;
export type BrowserLibraryArtificialAnalysisSection = z.infer<
  typeof BrowserLibraryArtificialAnalysisSectionSchema
>;
