import { z } from "zod";

const isoDate = z.iso.date();

export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
export const CurrencyCodeSchema = z.string().regex(
  CURRENCY_CODE_PATTERN,
  "Currency code must be exactly three uppercase letters.",
);

export const CurrencyDefinitionSchema = z.strictObject({
  code: CurrencyCodeSchema,
  ratePerUSD: z.number().finite().positive(),
  symbol: z.string().min(1),
  name: z.string().min(1),
  decimals: z.number().int().min(0).max(4),
});

export const ExchangeRateSourceSchema = z.strictObject({
  label: z.string().min(1),
  url: z.url(),
  apiUrl: z.url(),
  methodology: z.string().min(1).optional(),
});

export const ExchangeRateCatalogSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    base: z.literal("USD"),
    lastUpdated: isoDate,
    source: ExchangeRateSourceSchema,
    currencies: z.array(CurrencyDefinitionSchema).min(1),
  })
  .superRefine((catalog, context) => {
    const codes = catalog.currencies.map((currency) => currency.code);
    if (new Set(codes).size !== codes.length) {
      context.addIssue({
        code: "custom",
        path: ["currencies"],
        message: "Currency codes must be unique.",
      });
    }

    if (!codes.includes("USD")) {
      context.addIssue({
        code: "custom",
        path: ["currencies"],
        message: "Missing required base currency 'USD'.",
      });
    }

    const usd = catalog.currencies.find((currency) => currency.code === "USD");
    if (usd && usd.ratePerUSD !== 1) {
      context.addIssue({
        code: "custom",
        path: ["currencies", codes.indexOf("USD"), "ratePerUSD"],
        message: "USD ratePerUSD must equal 1.",
      });
    }
  });

export const CachedExchangeRateCatalogSchema = z.strictObject({
  schemaVersion: z.literal(1),
  checkedAt: z.iso.datetime(),
  catalog: ExchangeRateCatalogSchema,
});

export type ParsedExchangeRateCatalog = z.infer<
  typeof ExchangeRateCatalogSchema
>;
