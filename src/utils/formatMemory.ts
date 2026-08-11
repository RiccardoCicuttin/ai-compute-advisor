import { formatNumber, isFiniteNumber, NOT_AVAILABLE } from "./number";

export interface FormatMemoryOptions {
  maximumFractionDigits?: number;
}

export function formatMemory(
  value: number | null | undefined,
  { maximumFractionDigits = 1 }: FormatMemoryOptions = {},
): string {
  if (!isFiniteNumber(value)) {
    return NOT_AVAILABLE;
  }

  return `${formatNumber(value, { maximumFractionDigits })} GB`;
}
