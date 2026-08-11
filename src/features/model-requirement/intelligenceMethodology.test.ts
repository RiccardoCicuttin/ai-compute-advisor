import { describe, expect, it } from "vitest";
import type { ModelBenchmarkRecord } from "../../types";
import {
  ARTIFICIAL_ANALYSIS_CATEGORY_WEIGHTS,
  ARTIFICIAL_ANALYSIS_CURRENT_INTELLIGENCE_VERSION,
  ARTIFICIAL_ANALYSIS_EVALUATION_COUNT,
  isSameArtificialAnalysisSnapshotCohort,
  isSameBenchmarkCohort,
} from "./intelligenceMethodology";
import type { ArtificialAnalysisComparisonRecord } from "../../data/schemas/artificialAnalysisComparisonSchemas";

const benchmark: ModelBenchmarkRecord = {
  id: "benchmark-a",
  modelId: "model-a",
  sourceId: "source-a",
  methodologyVersion: "method-a",
  measuredAt: "2026-08-11",
  intelligenceScore: 50,
  intelligenceScale: { min: 0, max: 100 },
  method: "measured",
};

const importedRecord: ArtificialAnalysisComparisonRecord = {
  id: "aa.comparison.v1.61",
  externalId: "a",
  name: "Model A",
  slug: "model-a",
  creator: { externalId: "creator-a", name: "Creator", slug: null },
  intelligenceScore: 50,
  codingScore: null,
  mathScore: null,
  inputPriceUsdPerMillionTokens: null,
  outputPriceUsdPerMillionTokens: null,
  cacheHitPriceUsdPerMillionTokens: null,
  cacheWritePriceUsdPerMillionTokens: null,
  medianOutputTokensPerSecond: null,
  medianTimeToFirstTokenSeconds: null,
  intelligenceIndexVersion: 4.1,
  sourceUrl: "https://artificialanalysis.ai/models/model-a",
  sourceEndpoint: "https://artificialanalysis.ai/api/v2/models",
  importedAt: "2026-08-11T00:00:00.000Z",
};

describe("intelligence methodology evidence", () => {
  it("keeps the documented v4.1.1 category weights explicit and complete", () => {
    expect(ARTIFICIAL_ANALYSIS_CURRENT_INTELLIGENCE_VERSION).toBe("4.1.1");
    expect(ARTIFICIAL_ANALYSIS_EVALUATION_COUNT).toBe(9);
    expect(ARTIFICIAL_ANALYSIS_CATEGORY_WEIGHTS).toEqual({
      agents: 34,
      coding: 24,
      scientificReasoning: 24,
      general: 18,
    });
    expect(
      Object.values(ARTIFICIAL_ANALYSIS_CATEGORY_WEIGHTS).reduce(
        (total, weight) => total + weight,
        0,
      ),
    ).toBe(100);
  });

  it("allows comparison only inside the same source, methodology and scale cohort", () => {
    expect(
      isSameBenchmarkCohort(benchmark, {
        ...benchmark,
        id: "benchmark-b",
        modelId: "model-b",
      }),
    ).toBe(true);
    expect(
      isSameBenchmarkCohort(benchmark, {
        ...benchmark,
        id: "benchmark-b",
        sourceId: "source-b",
      }),
    ).toBe(false);
    expect(
      isSameBenchmarkCohort(benchmark, {
        ...benchmark,
        id: "benchmark-b",
        methodologyVersion: "method-b",
      }),
    ).toBe(false);
    expect(
      isSameBenchmarkCohort(benchmark, {
        ...benchmark,
        id: "benchmark-b",
        intelligenceScale: { min: 0, max: 1 },
      }),
    ).toBe(false);
  });

  it("does not treat two different records with unreported scales as comparable", () => {
    const withoutScale = { ...benchmark, intelligenceScale: undefined };
    expect(
      isSameBenchmarkCohort(withoutScale, {
        ...withoutScale,
        id: "benchmark-b",
      }),
    ).toBe(false);
  });

  it("keeps imported snapshots in one declared endpoint and index version cohort", () => {
    expect(
      isSameArtificialAnalysisSnapshotCohort(importedRecord, {
        ...importedRecord,
        id: "aa.comparison.v1.62",
        externalId: "b",
      }),
    ).toBe(true);
    expect(
      isSameArtificialAnalysisSnapshotCohort(importedRecord, {
        ...importedRecord,
        id: "aa.comparison.v1.62",
        sourceEndpoint: "https://artificialanalysis.ai/api/v1/models",
      }),
    ).toBe(false);
    expect(
      isSameArtificialAnalysisSnapshotCohort(importedRecord, {
        ...importedRecord,
        id: "aa.comparison.v1.62",
        intelligenceIndexVersion: 4.2,
      }),
    ).toBe(false);
    expect(
      isSameArtificialAnalysisSnapshotCohort(
        { ...importedRecord, intelligenceIndexVersion: null },
        {
          ...importedRecord,
          id: "aa.comparison.v1.62",
          intelligenceIndexVersion: null,
        },
      ),
    ).toBe(false);
  });
});
