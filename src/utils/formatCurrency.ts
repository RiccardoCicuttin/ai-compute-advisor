import { formatNumber, isFiniteNumber, NOT_AVAILABLE } from "./number";

export interface FormatCurrencyOptions {
  currency?: string;
  maximumFractionDigits?: number;
  minimumFractionDigits?: number;
  compact?: boolean;
}

export function formatCurrency(
  value: number | null | undefined,
  {
    currency = "USD",
    maximumFractionDigits,
    minimumFractionDigits,
    compact = false,
  }: FormatCurrencyOptions = {},
): string {
  if (!isFiniteNumber(value)) {
    return NOT_AVAILABLE;
  }

  const resolvedMaximumDigits =
    maximumFractionDigits ?? (Math.abs(value) < 100 ? 2 : 0);

  return formatNumber(value, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    notation: compact ? "compact" : "standard",
    compactDisplay: "short",
    maximumFractionDigits: resolvedMaximumDigits,
    minimumFractionDigits,
  });
}
