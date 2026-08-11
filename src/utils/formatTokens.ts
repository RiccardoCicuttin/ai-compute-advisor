import { formatNumber, isFiniteNumber, NOT_AVAILABLE } from "./number";

export interface FormatTokensOptions {
  maximumFractionDigits?: number;
  compact?: boolean;
}

export function formatTokens(
  value: number | null | undefined,
  { maximumFractionDigits = 1, compact = true }: FormatTokensOptions = {},
): string {
  if (!isFiniteNumber(value)) {
    return NOT_AVAILABLE;
  }

  return formatNumber(value, {
    notation: compact ? "compact" : "standard",
    compactDisplay: "short",
    maximumFractionDigits,
  });
}
