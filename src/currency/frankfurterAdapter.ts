import { z } from "zod";
import { ExchangeRateCatalogSchema } from "./schemas";
import type { ExchangeRateCatalog } from "./types";

export const FRANKFURTER_V1_LATEST_ENDPOINT =
  "https://api.frankfurter.dev/v1/latest";
export const FRANKFURTER_V1_LATEST_URL =
  "https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,CNY";

export function buildFrankfurterLatestUrl(
  definitions: ExchangeRateCatalog,
  endpointOrUrl = definitions.source.apiUrl,
): string {
  const endpoint = new URL(endpointOrUrl);
  endpoint.search = "";
  endpoint.hash = "";
  const symbols = definitions.currencies
    .map((currency) => currency.code)
    .filter((code) => code !== "USD");
  return `${endpoint.toString()}?base=USD${
    symbols.length > 0 ? `&symbols=${symbols.join(",")}` : ""
  }`;
}

export function isFrankfurterLatestUrl(
  value: string,
  definitions: ExchangeRateCatalog,
): boolean {
  try {
    const candidate = new URL(value);
    const endpoint = new URL(FRANKFURTER_V1_LATEST_ENDPOINT);
    const parameterNames = [...candidate.searchParams.keys()];
    const symbols = candidate.searchParams.get("symbols");
    const actualSymbols = symbols ? symbols.split(",") : [];
    const expectedSymbols = definitions.currencies
      .map((currency) => currency.code)
      .filter((code) => code !== "USD");
    return (
      candidate.username === "" &&
      candidate.password === "" &&
      candidate.origin === endpoint.origin &&
      candidate.pathname === endpoint.pathname &&
      candidate.hash === "" &&
      candidate.searchParams.getAll("base").length === 1 &&
      candidate.searchParams.get("base") === "USD" &&
      candidate.searchParams.getAll("symbols").length ===
        (expectedSymbols.length > 0 ? 1 : 0) &&
      parameterNames.every((name) => name === "base" || name === "symbols") &&
      new Set(actualSymbols).size === actualSymbols.length &&
      actualSymbols.length === expectedSymbols.length &&
      expectedSymbols.every((code) => actualSymbols.includes(code))
    );
  } catch {
    return false;
  }
}

export const FrankfurterLatestResponseSchema = z.object({
  amount: z.number().finite().positive(),
  base: z.literal("USD"),
  date: z.iso.date(),
  rates: z.record(z.string().regex(/^[A-Z]{3}$/), z.number().finite().positive()),
});

export function adaptFrankfurterLatestResponse(
  raw: unknown,
  definitions: ExchangeRateCatalog,
  apiUrl = buildFrankfurterLatestUrl(definitions),
): ExchangeRateCatalog {
  const response = FrankfurterLatestResponseSchema.parse(raw);

  return ExchangeRateCatalogSchema.parse({
    ...definitions,
    lastUpdated: response.date,
    source: {
      ...definitions.source,
      label: "Frankfurter v1 daily reference rates",
      url: "https://frankfurter.dev/v1/",
      apiUrl,
    },
    currencies: definitions.currencies.map((currency) => ({
      ...currency,
      ratePerUSD:
        currency.code === "USD"
          ? 1
          : requiredRate(response.rates, currency.code) / response.amount,
    })),
  });
}

function requiredRate(rates: Record<string, number>, code: string): number {
  const rate = rates[code];
  if (rate === undefined) {
    throw new RangeError(
      `Exchange-rate response did not include requested currency '${code}'.`,
    );
  }
  return rate;
}

export async function fetchFrankfurterLatestRates(
  definitions: ExchangeRateCatalog,
  options: {
    fetcher?: typeof fetch;
    apiUrl?: string;
    signal?: AbortSignal;
  } = {},
): Promise<ExchangeRateCatalog> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) throw new Error("This environment does not provide fetch().");
  const apiUrl = buildFrankfurterLatestUrl(
    definitions,
    options.apiUrl ?? definitions.source.apiUrl,
  );
  const response = await fetcher(apiUrl, {
    headers: { accept: "application/json" },
    cache: "no-cache",
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(
      `Exchange-rate request failed: HTTP ${response.status} ${response.statusText}.`,
    );
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new Error("Exchange-rate response was not valid JSON.");
  }
  return adaptFrankfurterLatestResponse(raw, definitions, apiUrl);
}
