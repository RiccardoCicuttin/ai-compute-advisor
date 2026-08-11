export const NOT_AVAILABLE = "Not available";

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function safeDivide(
  numerator: number,
  denominator: number,
): number | null {
  if (
    !isFiniteNumber(numerator) ||
    !isFiniteNumber(denominator) ||
    denominator === 0
  ) {
    return null;
  }

  const result = numerator / denominator;
  return isFiniteNumber(result) ? result : null;
}

export function roundTo(value: number, fractionDigits = 2): number {
  if (!isFiniteNumber(value)) {
    throw new TypeError("roundTo expects a finite number.");
  }

  if (!Number.isInteger(fractionDigits) || fractionDigits < 0) {
    throw new RangeError("fractionDigits must be a non-negative integer.");
  }

  const factor = 10 ** fractionDigits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function formatNumber(
  value: number | null | undefined,
  options: Intl.NumberFormatOptions = {},
): string {
  if (!isFiniteNumber(value)) {
    return NOT_AVAILABLE;
  }

  return new Intl.NumberFormat("en-US", options).format(value);
}
