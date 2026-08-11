import { useCallback, useEffect, useRef, useState } from "react";
import {
  EXCHANGE_RATE_MAX_AGE_MS,
  getBrowserExchangeRateStorage,
  isExchangeRateCacheFresh,
  readCachedExchangeRateCatalog,
  writeCachedExchangeRateCatalog,
  type ExchangeRateStorage,
} from "./cache";
import { loadBundledExchangeRateCatalog } from "./catalog";
import { refreshExchangeRatesWithFallback } from "./refresh";
import type {
  CachedExchangeRateCatalog,
  ExchangeRateCatalog,
  ExchangeRateOrigin,
} from "./types";

const DEFAULT_REFRESH_CHECK_INTERVAL_MS = 60 * 60 * 1_000;
const systemNow = () => new Date();

export interface UseExchangeRatesOptions {
  initialCatalog?: ExchangeRateCatalog;
  baseUrl?: string | URL;
  bundledPath?: string;
  apiUrl?: string;
  fetcher?: typeof fetch;
  storage?: ExchangeRateStorage | null;
  now?: () => Date;
  maxAgeMs?: number;
  refreshCheckIntervalMs?: number;
}

export interface UseExchangeRatesResult {
  catalog: ExchangeRateCatalog | null;
  status: "loading" | "ready" | "error";
  origin: ExchangeRateOrigin | null;
  isRefreshing: boolean;
  lastCheckedAt: string | null;
  warning: string | null;
  error: Error | null;
  refresh: () => Promise<void>;
}

function chooseStartingCatalog(
  bundled: ExchangeRateCatalog,
  cached: CachedExchangeRateCatalog | null,
): {
  catalog: ExchangeRateCatalog;
  origin: Exclude<ExchangeRateOrigin, "daily-reference">;
} {
  if (cached && cached.catalog.lastUpdated >= bundled.lastUpdated) {
    return { catalog: cached.catalog, origin: "cache" };
  }
  return { catalog: bundled, origin: "bundled" };
}

export function useExchangeRates(
  options: UseExchangeRatesOptions = {},
): UseExchangeRatesResult {
  const {
    baseUrl,
    initialCatalog,
    bundledPath,
    apiUrl,
    fetcher,
    storage: providedStorage,
    now = systemNow,
    maxAgeMs = EXCHANGE_RATE_MAX_AGE_MS,
    refreshCheckIntervalMs = DEFAULT_REFRESH_CHECK_INTERVAL_MS,
  } = options;
  const [state, setState] = useState<
    Omit<UseExchangeRatesResult, "refresh">
  >({
    catalog: null,
    status: "loading",
    origin: null,
    isRefreshing: false,
    lastCheckedAt: null,
    warning: null,
    error: null,
  });
  const mounted = useRef(false);
  const catalogRef = useRef<ExchangeRateCatalog | null>(null);
  const originRef = useRef<
    Exclude<ExchangeRateOrigin, "daily-reference">
  >("bundled");
  const cacheRef = useRef<CachedExchangeRateCatalog | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);

  const storage =
    providedStorage === undefined
      ? getBrowserExchangeRateStorage()
      : providedStorage;

  const performRefresh = useCallback(async (): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const fallback = catalogRef.current;
    if (!fallback) return;

    const task = (async () => {
      if (mounted.current) {
        setState((current) => ({ ...current, isRefreshing: true }));
      }
      const checkedAt = now();
      const result = await refreshExchangeRatesWithFallback(fallback, {
        fallbackOrigin: originRef.current,
        fetcher,
        apiUrl,
      });
      if (!mounted.current) return;

      catalogRef.current = result.catalog;
      originRef.current =
        result.origin === "daily-reference" ? "cache" : result.origin;
      const cacheWritten = result.refreshed
        ? writeCachedExchangeRateCatalog(result.catalog, checkedAt, storage)
        : false;
      if (result.refreshed) {
        cacheRef.current = {
          schemaVersion: 1,
          checkedAt: checkedAt.toISOString(),
          catalog: result.catalog,
        };
      }
      setState({
        catalog: result.catalog,
        status: "ready",
        origin: result.origin,
        isRefreshing: false,
        lastCheckedAt: result.refreshed
          ? checkedAt.toISOString()
          : cacheRef.current?.checkedAt ?? null,
        warning:
          result.warning ??
          (result.refreshed && !cacheWritten
            ? "Reference rates were refreshed but could not be cached locally."
            : null),
        error: null,
      });
    })().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = task;
    return task;
  }, [apiUrl, fetcher, now, storage]);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;

    void (async () => {
      try {
        const bundled =
          initialCatalog ??
          (await loadBundledExchangeRateCatalog({
            baseUrl,
            path: bundledPath,
            fetcher,
          }));
        if (cancelled || !mounted.current) return;

        const cached = readCachedExchangeRateCatalog(storage);
        const starting = chooseStartingCatalog(bundled, cached);
        catalogRef.current = starting.catalog;
        originRef.current = starting.origin;
        cacheRef.current = cached;
        setState({
          catalog: starting.catalog,
          status: "ready",
          origin: starting.origin,
          isRefreshing: false,
          lastCheckedAt: cached?.checkedAt ?? null,
          warning: null,
          error: null,
        });

        const canUseFreshCache =
          starting.origin === "cache" &&
          isExchangeRateCacheFresh(cached, now(), maxAgeMs);
        if (!canUseFreshCache) await performRefresh();
      } catch (error) {
        if (cancelled || !mounted.current) return;
        setState({
          catalog: null,
          status: "error",
          origin: null,
          isRefreshing: false,
          lastCheckedAt: null,
          warning: null,
          error:
            error instanceof Error
              ? error
              : new Error("Bundled exchange rates could not be loaded."),
        });
      }
    })();

    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [baseUrl, bundledPath, fetcher, initialCatalog, maxAgeMs, now, performRefresh, storage]);

  useEffect(() => {
    if (refreshCheckIntervalMs <= 0) return;
    const interval = window.setInterval(() => {
      if (!isExchangeRateCacheFresh(cacheRef.current, now(), maxAgeMs)) {
        void performRefresh();
      }
    }, refreshCheckIntervalMs);
    return () => window.clearInterval(interval);
  }, [maxAgeMs, now, performRefresh, refreshCheckIntervalMs]);

  const refresh = useCallback(async () => {
    await performRefresh();
  }, [performRefresh]);

  return { ...state, refresh };
}
