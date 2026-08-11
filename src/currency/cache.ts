import { CachedExchangeRateCatalogSchema } from "./schemas";
import type {
  CachedExchangeRateCatalog,
  ExchangeRateCatalog,
} from "./types";

export const EXCHANGE_RATE_CACHE_KEY = "aca:v1:exchange-rates";
export const EXCHANGE_RATE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export type ExchangeRateStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export function getBrowserExchangeRateStorage(): ExchangeRateStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readCachedExchangeRateCatalog(
  storage: ExchangeRateStorage | null = getBrowserExchangeRateStorage(),
): CachedExchangeRateCatalog | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(EXCHANGE_RATE_CACHE_KEY);
    if (!raw) return null;
    const parsed = CachedExchangeRateCatalogSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeCachedExchangeRateCatalog(
  catalog: ExchangeRateCatalog,
  checkedAt = new Date(),
  storage: ExchangeRateStorage | null = getBrowserExchangeRateStorage(),
): boolean {
  if (!storage || Number.isNaN(checkedAt.getTime())) return false;
  const entry = CachedExchangeRateCatalogSchema.parse({
    schemaVersion: 1,
    checkedAt: checkedAt.toISOString(),
    catalog,
  });
  try {
    storage.setItem(EXCHANGE_RATE_CACHE_KEY, JSON.stringify(entry));
    return true;
  } catch {
    return false;
  }
}

export function isExchangeRateCacheFresh(
  entry: CachedExchangeRateCatalog | null,
  now = new Date(),
  maxAgeMs = EXCHANGE_RATE_MAX_AGE_MS,
): boolean {
  if (!entry || Number.isNaN(now.getTime()) || maxAgeMs < 0) return false;
  const checkedAt = new Date(entry.checkedAt).getTime();
  const age = now.getTime() - checkedAt;
  return Number.isFinite(age) && age >= 0 && age < maxAgeMs;
}

export function clearCachedExchangeRateCatalog(
  storage: ExchangeRateStorage | null = getBrowserExchangeRateStorage(),
): void {
  try {
    storage?.removeItem(EXCHANGE_RATE_CACHE_KEY);
  } catch {
    // Cache cleanup must never block the calculator.
  }
}
