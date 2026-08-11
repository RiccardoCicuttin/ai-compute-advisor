import { describe, expect, it } from "vitest";
import bundledRates from "../../public/data/exchange-rates.json";
import {
  EXCHANGE_RATE_CACHE_KEY,
  adaptFrankfurterLatestResponse,
  buildFrankfurterLatestUrl,
  convertCurrency,
  convertDisplayToUsd,
  convertUsdToDisplay,
  ExchangeRateCatalogSchema,
  formatUsdAsCurrency,
  isExchangeRateCacheFresh,
  readCachedExchangeRateCatalog,
  refreshExchangeRatesWithFallback,
  writeCachedExchangeRateCatalog,
  type ExchangeRateStorage,
} from ".";

const catalog = ExchangeRateCatalogSchema.parse(bundledRates);

class MemoryStorage implements ExchangeRateStorage {
  private values = new Map<string, string>();

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

describe("currency catalog and conversion", () => {
  it("validates the bundled USD-base fallback catalog", () => {
    expect(catalog.base).toBe("USD");
    expect(catalog.lastUpdated).toBe("2026-08-10");
    expect(catalog.currencies.map((currency) => currency.code)).toEqual([
      "USD",
      "EUR",
      "CNY",
    ]);
  });

  it("adapts the Frankfurter v1 latest response", () => {
    const adapted = adaptFrankfurterLatestResponse(
      {
        amount: 1,
        base: "USD",
        date: "2026-08-11",
        rates: { EUR: 0.87, CNY: 6.75 },
      },
      catalog,
    );
    expect(adapted.lastUpdated).toBe("2026-08-11");
    expect(
      adapted.currencies.find((currency) => currency.code === "EUR")
        ?.ratePerUSD,
    ).toBe(0.87);
    expect(
      adapted.currencies.find((currency) => currency.code === "USD")
        ?.ratePerUSD,
    ).toBe(1);
  });

  it("converts without rounding and formats only at the display boundary", () => {
    const eur = convertUsdToDisplay(123.45, "EUR", catalog);
    expect(convertDisplayToUsd(eur, "EUR", catalog)).toBeCloseTo(123.45, 12);
    expect(convertCurrency(100, "EUR", "CNY", catalog)).toBeCloseTo(
      (100 / 0.86543) * 6.7444,
      12,
    );
    expect(formatUsdAsCurrency(10, "EUR", catalog)).toContain("8.65");
  });

  it("accepts a Data Pack-defined JPY code and uses it for refresh and conversion", () => {
    const withJpy = ExchangeRateCatalogSchema.parse({
      ...catalog,
      currencies: [
        ...catalog.currencies,
        {
          code: "JPY",
          ratePerUSD: 150,
          symbol: "¥",
          name: "Japanese Yen",
          decimals: 0,
        },
      ],
    });

    expect(buildFrankfurterLatestUrl(withJpy)).toBe(
      "https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,CNY,JPY",
    );
    const adapted = adaptFrankfurterLatestResponse(
      {
        amount: 1,
        base: "USD",
        date: "2026-08-11",
        rates: { EUR: 0.87, CNY: 6.75, JPY: 151.25 },
      },
      withJpy,
    );
    expect(convertUsdToDisplay(2, "JPY", adapted)).toBe(302.5);
    expect(convertDisplayToUsd(302.5, "JPY", adapted)).toBe(2);
  });

  it("rejects currency codes that are not three uppercase letters", () => {
    expect(() =>
      ExchangeRateCatalogSchema.parse({
        ...catalog,
        currencies: [
          ...catalog.currencies,
          {
            code: "jpy",
            ratePerUSD: 150,
            symbol: "¥",
            name: "Japanese Yen",
            decimals: 0,
          },
        ],
      }),
    ).toThrow();
  });
});

describe("daily reference-rate fallback and cache", () => {
  it("falls back without throwing when the reference-rate request fails", async () => {
    const result = await refreshExchangeRatesWithFallback(catalog, {
      fetcher: async () => {
        throw new Error("offline");
      },
    });
    expect(result.catalog).toBe(catalog);
    expect(result.origin).toBe("bundled");
    expect(result.refreshed).toBe(false);
    expect(result.warning).toContain("using bundled rates");
  });

  it("stores a validated successful catalog and expires it after 24 hours", () => {
    const storage = new MemoryStorage();
    const checkedAt = new Date("2026-08-11T00:00:00.000Z");
    expect(writeCachedExchangeRateCatalog(catalog, checkedAt, storage)).toBe(true);
    expect(storage.getItem(EXCHANGE_RATE_CACHE_KEY)).not.toBeNull();

    const cached = readCachedExchangeRateCatalog(storage);
    expect(cached?.catalog).toEqual(catalog);
    expect(
      isExchangeRateCacheFresh(
        cached,
        new Date("2026-08-11T23:59:59.000Z"),
      ),
    ).toBe(true);
    expect(
      isExchangeRateCacheFresh(
        cached,
        new Date("2026-08-12T00:00:00.000Z"),
      ),
    ).toBe(false);
  });
});
