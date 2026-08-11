/** The currencies shipped in the bundled catalog, not an exhaustive allow-list. */
export const CURRENCY_CODES = ["USD", "EUR", "CNY"] as const;

/**
 * Runtime values are validated as three-letter uppercase ISO-style codes by
 * CurrencyCodeSchema. Keeping the TypeScript type open lets a Data Pack add a
 * currency without requiring an application rebuild.
 */
export type CurrencyCode = string;

export interface CurrencyDefinition {
  code: CurrencyCode;
  ratePerUSD: number;
  symbol: string;
  name: string;
  decimals: number;
}

export interface ExchangeRateSource {
  label: string;
  url: string;
  apiUrl: string;
  methodology?: string;
}

export interface ExchangeRateCatalog {
  schemaVersion: 1;
  base: "USD";
  lastUpdated: string;
  source: ExchangeRateSource;
  currencies: CurrencyDefinition[];
}

export interface CachedExchangeRateCatalog {
  schemaVersion: 1;
  checkedAt: string;
  catalog: ExchangeRateCatalog;
}

export type ExchangeRateOrigin = "bundled" | "cache" | "daily-reference";
