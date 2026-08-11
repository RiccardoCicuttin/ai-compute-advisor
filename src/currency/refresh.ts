import { fetchFrankfurterLatestRates } from "./frankfurterAdapter";
import type { ExchangeRateCatalog, ExchangeRateOrigin } from "./types";

export interface ExchangeRateRefreshResult {
  catalog: ExchangeRateCatalog;
  origin: ExchangeRateOrigin;
  refreshed: boolean;
  warning: string | null;
}

export async function refreshExchangeRatesWithFallback(
  fallback: ExchangeRateCatalog,
  options: {
    fallbackOrigin?: Exclude<ExchangeRateOrigin, "daily-reference">;
    fetcher?: typeof fetch;
    apiUrl?: string;
    signal?: AbortSignal;
  } = {},
): Promise<ExchangeRateRefreshResult> {
  const fallbackOrigin = options.fallbackOrigin ?? "bundled";
  try {
    const live = await fetchFrankfurterLatestRates(fallback, options);
    if (live.lastUpdated < fallback.lastUpdated) {
      return {
        catalog: fallback,
        origin: fallbackOrigin,
        refreshed: true,
        warning:
          "The daily reference-rate service returned an older date, so the newer fallback catalog remains active.",
      };
    }
    return {
      catalog: live,
      origin: "daily-reference",
      refreshed: true,
      warning: null,
    };
  } catch (error) {
    return {
      catalog: fallback,
      origin: fallbackOrigin,
      refreshed: false,
      warning: `Daily reference rates could not be refreshed; using ${fallbackOrigin} rates dated ${fallback.lastUpdated}. ${error instanceof Error ? error.message : "Unknown error."}`,
    };
  }
}
