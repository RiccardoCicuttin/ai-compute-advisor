import type {
  CurrencyCode,
  CurrencyDefinition,
  ExchangeRateCatalog,
} from "./types";

function finiteAmount(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}

export function getCurrencyDefinition(
  catalog: ExchangeRateCatalog,
  currency: CurrencyCode,
): CurrencyDefinition {
  const definition = catalog.currencies.find((item) => item.code === currency);
  if (!definition) {
    throw new RangeError(`Currency '${currency}' is not available.`);
  }
  if (!Number.isFinite(definition.ratePerUSD) || definition.ratePerUSD <= 0) {
    throw new RangeError(`Currency '${currency}' has an invalid exchange rate.`);
  }
  return definition;
}

export function applyExchangeRateOverrides(
  catalog: ExchangeRateCatalog,
  override?: Partial<Record<CurrencyCode, number>>,
): ExchangeRateCatalog {
  if (!override || Object.keys(override).length === 0) return catalog;
  return {
    ...catalog,
    currencies: catalog.currencies.map((definition) => ({
      ...definition,
      // USD is the immutable base of all calculator prices.
      ratePerUSD:
        definition.code !== "USD" &&
        override[definition.code] !== undefined &&
        Number.isFinite(override[definition.code]) &&
        override[definition.code]! > 0
          ? override[definition.code]!
          : definition.ratePerUSD,
    })),
  };
}

export function convertUsdToDisplay(
  amountUSD: number,
  currency: CurrencyCode,
  catalog: ExchangeRateCatalog,
): number {
  return (
    finiteAmount(amountUSD, "USD amount") *
    getCurrencyDefinition(catalog, currency).ratePerUSD
  );
}

export function convertDisplayToUsd(
  amount: number,
  currency: CurrencyCode,
  catalog: ExchangeRateCatalog,
): number {
  return (
    finiteAmount(amount, "Display amount") /
    getCurrencyDefinition(catalog, currency).ratePerUSD
  );
}

export function convertCurrency(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
  catalog: ExchangeRateCatalog,
): number {
  if (from === to) return finiteAmount(amount, "Amount");
  return convertUsdToDisplay(
    convertDisplayToUsd(amount, from, catalog),
    to,
    catalog,
  );
}

export interface FormatCurrencyAmountOptions {
  locale?: string;
  useGrouping?: boolean;
}

export function formatCurrencyAmount(
  amount: number,
  currency: CurrencyCode,
  catalog: ExchangeRateCatalog,
  {
    locale = "en-US",
    useGrouping = true,
  }: FormatCurrencyAmountOptions = {},
): string {
  const value = finiteAmount(amount, "Amount");
  const definition = getCurrencyDefinition(catalog, currency);

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: definition.decimals,
      maximumFractionDigits: definition.decimals,
      useGrouping,
    }).format(value);
  } catch {
    return `${definition.symbol}${value.toFixed(definition.decimals)}`;
  }
}

export function formatUsdAsCurrency(
  amountUSD: number,
  currency: CurrencyCode,
  catalog: ExchangeRateCatalog,
  options?: FormatCurrencyAmountOptions,
): string {
  return formatCurrencyAmount(
    convertUsdToDisplay(amountUSD, currency, catalog),
    currency,
    catalog,
    options,
  );
}
