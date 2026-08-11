import { ExchangeRateCatalogSchema } from "./schemas";
import type { ExchangeRateCatalog } from "./types";

export const BUNDLED_EXCHANGE_RATE_PATH = "data/exchange-rates.json";

export class ExchangeRateCatalogError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ExchangeRateCatalogError";
  }
}

export async function loadBundledExchangeRateCatalog(
  options: {
    baseUrl?: string | URL;
    path?: string;
    fetcher?: typeof fetch;
  } = {},
): Promise<ExchangeRateCatalog> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) {
    throw new ExchangeRateCatalogError(
      "This environment does not provide fetch().",
    );
  }
  const defaultBase =
    typeof document === "undefined"
      ? new URL("http://localhost/")
      : new URL(document.baseURI);
  const url = new URL(options.path ?? BUNDLED_EXCHANGE_RATE_PATH, options.baseUrl ?? defaultBase);

  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { accept: "application/json" },
      cache: "no-cache",
    });
  } catch (error) {
    throw new ExchangeRateCatalogError(
      `Could not load bundled exchange rates from ${url.toString()}.`,
      error,
    );
  }
  if (!response.ok) {
    throw new ExchangeRateCatalogError(
      `Could not load bundled exchange rates: HTTP ${response.status} ${response.statusText}.`,
    );
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (error) {
    throw new ExchangeRateCatalogError(
      "Bundled exchange rates are not valid JSON.",
      error,
    );
  }

  const parsed = ExchangeRateCatalogSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`)
      .join("; ");
    throw new ExchangeRateCatalogError(
      `Bundled exchange rates failed validation. ${details}`,
      parsed.error,
    );
  }
  return parsed.data;
}
