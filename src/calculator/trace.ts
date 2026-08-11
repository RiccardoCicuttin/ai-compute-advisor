import type { CalculationTrace, CalculationUnit, CalculationValue } from "../types";

type ValueSource = CalculationValue["source"];

export function value(
  key: string,
  label: string,
  rawValue: number | string | null,
  unit: CalculationUnit,
  source: ValueSource,
): CalculationValue {
  return { key, label, rawValue, unit, source };
}

export function trace(input: CalculationTrace): CalculationTrace {
  return input;
}

export function safeCostPerMillion(cost: number, tokens: number): number | null {
  return tokens > 0 ? cost / (tokens / 1_000_000) : null;
}

export function assertFiniteNonNegative(valueToCheck: number, name: string): void {
  if (!Number.isFinite(valueToCheck) || valueToCheck < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`);
  }
}

export function assertRatio(valueToCheck: number, name: string): void {
  if (!Number.isFinite(valueToCheck) || valueToCheck < 0 || valueToCheck > 1) {
    throw new RangeError(`${name} must be between 0 and 1`);
  }
}
