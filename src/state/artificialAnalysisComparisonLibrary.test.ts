import { describe, expect, it } from "vitest";
import {
  ARTIFICIAL_ANALYSIS_FREE_MODELS_ENDPOINT,
  ARTIFICIAL_ANALYSIS_LEGACY_MODELS_ENDPOINT,
  adaptArtificialAnalysisModelsSnapshot,
  createArtificialAnalysisComparisonId,
} from "../data/adapters";
import {
  ARTIFICIAL_ANALYSIS_COMPARISON_STORAGE_KEY,
  ArtificialAnalysisComparisonLibraryError,
  clearArtificialAnalysisComparisonLibrary,
  clearStoredArtificialAnalysisComparisonLibrary,
  createBrowserLibraryArtificialAnalysisSection,
  createEmptyArtificialAnalysisComparisonLibrary,
  deleteArtificialAnalysisComparisonRecord,
  parseArtificialAnalysisComparisonLibraryJson,
  parseArtificialAnalysisSnapshotJson,
  parseBrowserLibraryArtificialAnalysisSection,
  readArtificialAnalysisComparisonLibrary,
  replaceArtificialAnalysisComparisonLibrary,
  serializeArtificialAnalysisComparisonLibrary,
  upsertArtificialAnalysisComparisonRecords,
  writeArtificialAnalysisComparisonLibrary,
  type ArtificialAnalysisComparisonStorage,
} from "./artificialAnalysisComparisonLibrary";

const importedAt = "2026-08-11T09:00:00.000Z";

const currentSnapshot = {
  tier: "free",
  intelligence_index_version: 4.1,
  pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
  future_top_level_field: "accepted and stripped",
  data: [
    {
      id: "36f73aaf-d38a-4b56-a2b3-d04d17186910",
      name: "Example Reasoning Model",
      slug: "example-reasoning-model",
      release_date: "2026-08-01",
      model_creator: {
        id: "creator-stable-id",
        name: "Example Lab",
        future_creator_field: true,
      },
      evaluations: {
        artificial_analysis_intelligence_index: 24.5,
        artificial_analysis_coding_index: 18.5,
        artificial_analysis_math_index: null,
        future_benchmark: 0.9,
      },
      pricing: {
        price_1m_input_tokens: 0.06,
        price_1m_output_tokens: 0.2,
        price_1m_cache_hit_tokens: 0.015,
        price_1m_cache_write_tokens: 0.075,
        future_price: 1,
      },
      performance: {
        median_output_tokens_per_second: 296.47,
        median_time_to_first_token_seconds: 0.65,
        percentile_95_output_tokens_per_second: 858.3,
      },
      future_model_field: { anything: true },
    },
  ],
};

class MemoryStorage implements ArtificialAnalysisComparisonStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("Artificial Analysis comparison snapshot adapter", () => {
  it("preserves official units exactly and strips unknown provider fields", () => {
    const [record] = adaptArtificialAnalysisModelsSnapshot(currentSnapshot, {
      importedAt,
    });

    expect(record).toEqual({
      id: createArtificialAnalysisComparisonId(
        "36f73aaf-d38a-4b56-a2b3-d04d17186910",
      ),
      externalId: "36f73aaf-d38a-4b56-a2b3-d04d17186910",
      name: "Example Reasoning Model",
      slug: "example-reasoning-model",
      creator: {
        externalId: "creator-stable-id",
        name: "Example Lab",
        slug: null,
      },
      intelligenceScore: 24.5,
      codingScore: 18.5,
      mathScore: null,
      inputPriceUsdPerMillionTokens: 0.06,
      outputPriceUsdPerMillionTokens: 0.2,
      cacheHitPriceUsdPerMillionTokens: 0.015,
      cacheWritePriceUsdPerMillionTokens: 0.075,
      medianOutputTokensPerSecond: 296.47,
      medianTimeToFirstTokenSeconds: 0.65,
      intelligenceIndexVersion: 4.1,
      sourceUrl:
        "https://artificialanalysis.ai/models/example-reasoning-model",
      sourceEndpoint: ARTIFICIAL_ANALYSIS_FREE_MODELS_ENDPOINT,
      importedAt,
    });
    expect("future_model_field" in record!).toBe(false);
    expect("future_benchmark" in record!).toBe(false);
  });

  it("accepts the documented legacy top-level performance shape and nulls missing evidence", () => {
    const [record] = adaptArtificialAnalysisModelsSnapshot(
      {
        status: 200,
        prompt_options: { parallel_queries: 1, prompt_length: "medium" },
        data: [
          {
            id: "legacy-id",
            name: "Legacy Model",
            slug: "legacy-model",
            model_creator: {
              id: "legacy-creator",
              name: "Legacy Creator",
              slug: "legacy-creator",
            },
            evaluations: null,
            pricing: {
              price_1m_input_tokens: null,
              price_1m_output_tokens: 4.4,
              price_1m_cached_input_tokens: 0.2,
            },
            median_output_tokens_per_second: null,
            median_time_to_first_token_seconds: 14.939,
          },
        ],
      },
      { importedAt },
    );

    expect(record).toMatchObject({
      intelligenceScore: null,
      codingScore: null,
      mathScore: null,
      inputPriceUsdPerMillionTokens: null,
      outputPriceUsdPerMillionTokens: 4.4,
      cacheHitPriceUsdPerMillionTokens: 0.2,
      cacheWritePriceUsdPerMillionTokens: null,
      medianOutputTokensPerSecond: null,
      medianTimeToFirstTokenSeconds: 14.939,
      intelligenceIndexVersion: null,
      sourceEndpoint: ARTIFICIAL_ANALYSIS_LEGACY_MODELS_ENDPOINT,
    });
  });

  it("rejects malformed known fields and non-success legacy snapshots", () => {
    const malformed = structuredClone(currentSnapshot) as Record<string, unknown>;
    const data = malformed.data as Array<Record<string, unknown>>;
    data[0]!.pricing = { price_1m_input_tokens: "0.06" };
    expect(() =>
      adaptArtificialAnalysisModelsSnapshot(malformed, { importedAt }),
    ).toThrow();
    expect(() =>
      adaptArtificialAnalysisModelsSnapshot({ status: 429, data: [] }, { importedAt }),
    ).toThrow(/status must be 200/);
  });

  it("uses a collision-free namespace rather than lossy slugification", () => {
    expect(createArtificialAnalysisComparisonId("a/b")).not.toBe(
      createArtificialAnalysisComparisonId("a-b"),
    );
    expect(createArtificialAnalysisComparisonId("模型/a")).toMatch(
      /^aa\.comparison\.v1\.[0-9a-f]+$/,
    );
  });
});

describe("Artificial Analysis browser-local comparison library", () => {
  const records = adaptArtificialAnalysisModelsSnapshot(currentSnapshot, {
    importedAt,
  });

  it("imports snapshots with a 4 MiB boundary and rejects invalid JSON", () => {
    expect(
      parseArtificialAnalysisSnapshotJson(JSON.stringify(currentSnapshot), {
        importedAt,
      }),
    ).toEqual(records);
    expect(() =>
      parseArtificialAnalysisSnapshotJson("not json", { importedAt }),
    ).toThrowError(ArtificialAnalysisComparisonLibraryError);
    expect(() =>
      parseArtificialAnalysisSnapshotJson(
        JSON.stringify(currentSnapshot),
        { importedAt },
        { maxBytes: 10 },
      ),
    ).toThrowError(/limit/);
  });

  it("creates, upserts, deletes and clears records without mutating input", () => {
    const empty = createEmptyArtificialAnalysisComparisonLibrary(importedAt);
    const first = upsertArtificialAnalysisComparisonRecords(
      empty,
      records,
      importedAt,
    );
    const edited = { ...records[0]!, name: "Updated name" };
    const second = upsertArtificialAnalysisComparisonRecords(
      first,
      [edited],
      "2026-08-12T00:00:00.000Z",
    );

    expect(empty.records).toEqual([]);
    expect(first.records[0]?.name).toBe("Example Reasoning Model");
    expect(second.records).toHaveLength(1);
    expect(second.records[0]?.name).toBe("Updated name");
    expect(
      deleteArtificialAnalysisComparisonRecord(
        second,
        edited.id,
        "2026-08-13T00:00:00.000Z",
      ).records,
    ).toEqual([]);
    expect(() =>
      deleteArtificialAnalysisComparisonRecord(second, `${edited.id}00`, importedAt),
    ).toThrowError(/not found/);
    expect(clearArtificialAnalysisComparisonLibrary(importedAt).records).toEqual([]);
  });

  it("round-trips strict JSON, storage and the combined-pack section", () => {
    const library = replaceArtificialAnalysisComparisonLibrary(records, importedAt);
    const json = serializeArtificialAnalysisComparisonLibrary(library);
    expect(parseArtificialAnalysisComparisonLibraryJson(json)).toEqual(library);

    const storage = new MemoryStorage();
    expect(writeArtificialAnalysisComparisonLibrary(library, storage)).toBeNull();
    expect(storage.values.has(ARTIFICIAL_ANALYSIS_COMPARISON_STORAGE_KEY)).toBe(true);
    expect(readArtificialAnalysisComparisonLibrary(storage)).toEqual({
      library,
      issue: null,
    });
    expect(clearStoredArtificialAnalysisComparisonLibrary(storage)).toBeNull();
    expect(readArtificialAnalysisComparisonLibrary(storage).library.records).toEqual([]);

    const section = createBrowserLibraryArtificialAnalysisSection(library);
    expect(parseBrowserLibraryArtificialAnalysisSection(section)).toEqual(section);
    expect(() =>
      parseBrowserLibraryArtificialAnalysisSection({ ...section, extra: true }),
    ).toThrow();
    expect(() =>
      parseArtificialAnalysisComparisonLibraryJson(
        JSON.stringify({ ...library, extra: true }),
      ),
    ).toThrowError(/Unrecognized key/);
  });

  it("falls back safely when stored JSON is invalid", () => {
    const storage = new MemoryStorage();
    storage.setItem(ARTIFICIAL_ANALYSIS_COMPARISON_STORAGE_KEY, "{");
    const result = readArtificialAnalysisComparisonLibrary(storage);
    expect(result.library.records).toEqual([]);
    expect(result.issue?.code).toBe("invalid-json");
  });
});
