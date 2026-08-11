import { formatNumber, isFiniteNumber, NOT_AVAILABLE } from "./number";

export interface FormatPercentageOptions {
  maximumFractionDigits?: number;
}

export function formatPercentage(
  value: number | null | undefined,
  { maximumFractionDigits = 0 }: FormatPercentageOptions = {},
): string {
  if (!isFiniteNumber(value)) {
    return NOT_AVAILABLE;
  }

  return formatNumber(value, {
    style: "percent",
    maximumFractionDigits,
  });
}
