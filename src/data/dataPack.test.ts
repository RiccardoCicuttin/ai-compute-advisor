import { describe, expect, it } from "vitest";
import assumptions from "../../public/data/assumptions.json";
import cloudPricing from "../../public/data/cloud-pricing.json";
import exchangeRates from "../../public/data/exchange-rates.json";
import gpus from "../../public/data/gpus.json";
import inferenceProfiles from "../../public/data/inference-profiles.json";
import manifest from "../../public/data/manifest.json";
import modelBenchmarks from "../../public/data/model-benchmarks.json";
import models from "../../public/data/models.json";
import presets from "../../public/data/presets.json";
import systems from "../../public/data/systems.json";
import {
  buildFrankfurterLatestUrl,
  ExchangeRateCatalogSchema,
} from "../currency";
import { parseCatalogBundle } from "./schemas";
import {
  DATA_PACK_MAX_RECORDS_PER_CATALOG,
  DATA_PACK_STORAGE_KEY,
  createPortableDataPack,
  getPortableDataPackFilename,
  parsePortableDataPack,
  parsePortableDataPackJson,
  readStoredDataPack,
  serializePortableDataPack,
  writeStoredDataPack,
  type DataPackStorage,
} from "./dataPack";

const catalogs = parseCatalogBundle({
  manifest,
  models,
  modelBenchmarks,
  gpus,
  inferenceProfiles,
  cloudPricing,
  assumptions,
  presets,
  systems,
  exchangeRates,
});

class MemoryStorage implements DataPackStorage {
  private readonly values = new Map<string, string>();

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

describe("portable Data Packs", () => {
  it("exports a detached, strongly validated round-trip of all catalogs", () => {
    const pack = createPortableDataPack(
      catalogs,
      new Date("2026-08-11T00:00:00.000Z"),
    );
    const parsed = parsePortableDataPackJson(serializePortableDataPack(pack));

    expect(parsed.pack.exportedAt).toBe("2026-08-11T00:00:00.000Z");
    expect(parsed.catalogs.dataVersion).toBe(catalogs.dataVersion);
    expect(parsed.catalogs.models).toEqual(catalogs.models);
    expect(parsed.catalogs.systems).toEqual(catalogs.systems);
    expect(parsed.catalogs.exchangeRates).toEqual(catalogs.exchangeRates);
    expect(pack.catalogs.models.data).not.toBe(catalogs.models);
  });

  it("round-trips a Data Pack that adds JPY without changing application code", () => {
    const exchangeRatesWithJpy = ExchangeRateCatalogSchema.parse({
      ...catalogs.exchangeRates,
      currencies: [
        ...catalogs.exchangeRates.currencies,
        {
          code: "JPY",
          ratePerUSD: 150,
          symbol: "¥",
          name: "Japanese Yen",
          decimals: 0,
        },
      ],
    });
    exchangeRatesWithJpy.source.apiUrl =
      buildFrankfurterLatestUrl(exchangeRatesWithJpy);

    const pack = createPortableDataPack({
      ...catalogs,
      exchangeRates: exchangeRatesWithJpy,
    });
    const parsed = parsePortableDataPack(pack);

    expect(
      parsed.catalogs.exchangeRates.currencies.find(
        (currency) => currency.code === "JPY",
      ),
    ).toEqual(expect.objectContaining({ ratePerUSD: 150, decimals: 0 }));
  });

  it("applies loader-equivalent relationship and catalog-ID validation", () => {
    const pack = structuredClone(createPortableDataPack(catalogs));
    const system = pack.catalogs.systems.data.find(
      (candidate) => candidate.performance,
    );
    expect(system?.performance).toBeDefined();
    system!.performance!.modelId = "missing-model";

    expect(() => parsePortableDataPack(pack)).toThrowError(
      expect.objectContaining({
        code: "invalid-pack",
        message: expect.stringContaining("unknown model"),
      }),
    );

    const mislabeled = structuredClone(createPortableDataPack(catalogs));
    mislabeled.catalogs.gpus.catalogId = "models";
    expect(() => parsePortableDataPack(mislabeled)).toThrowError(
      expect.objectContaining({
        code: "invalid-pack",
        message: expect.stringContaining("Expected catalogId 'gpus'"),
      }),
    );
  });

  it("rejects arbitrary runtime endpoints and oversized input before activation", () => {
    const pack = structuredClone(createPortableDataPack(catalogs));
    pack.catalogs.exchangeRates.source.apiUrl =
      "https://example.invalid/collect";
    expect(() => parsePortableDataPack(pack)).toThrowError(
      expect.objectContaining({
        code: "invalid-pack",
        message: expect.stringContaining("arbitrary exchange-rate endpoint"),
      }),
    );

    expect(() =>
      parsePortableDataPackJson("{\"packSchemaVersion\":1}", { maxBytes: 8 }),
    ).toThrowError(
      expect.objectContaining({ code: "too-large" }),
    );

    const tooManyRecords = structuredClone(createPortableDataPack(catalogs));
    tooManyRecords.catalogs.models.data = Array.from(
      { length: DATA_PACK_MAX_RECORDS_PER_CATALOG + 1 },
      () => tooManyRecords.catalogs.models.data[0]!,
    );
    expect(() => parsePortableDataPack(tooManyRecords)).toThrowError(
      expect.objectContaining({ code: "too-large" }),
    );
  });

  it("validates storage reads and writes without replacing valid data", () => {
    const storage = new MemoryStorage();
    const pack = createPortableDataPack(catalogs);
    writeStoredDataPack(pack, storage);

    expect(storage.getItem(DATA_PACK_STORAGE_KEY)).not.toBeNull();
    expect(readStoredDataPack(storage).catalogs?.dataVersion).toBe(
      catalogs.dataVersion,
    );

    storage.setItem(DATA_PACK_STORAGE_KEY, "not-json");
    const corrupt = readStoredDataPack(storage);
    expect(corrupt.catalogs).toBeNull();
    expect(corrupt.error).toEqual(
      expect.objectContaining({ code: "invalid-json" }),
    );
  });

  it("sanitizes imported data versions before using them as filenames", () => {
    const filename = getPortableDataPackFilename("../../客户/ demo v1");
    expect(filename).toBe("ai-compute-advisor-data-pack-demo-v1.json");
    expect(filename).not.toContain("/");
  });
});
