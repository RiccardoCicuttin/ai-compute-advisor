import { describe, expect, it } from "vitest";
import assumptions from "../../../public/data/assumptions.json";
import cloudPricing from "../../../public/data/cloud-pricing.json";
import gpus from "../../../public/data/gpus.json";
import inferenceProfiles from "../../../public/data/inference-profiles.json";
import manifest from "../../../public/data/manifest.json";
import modelBenchmarks from "../../../public/data/model-benchmarks.json";
import models from "../../../public/data/models.json";
import presets from "../../../public/data/presets.json";
import systems from "../../../public/data/systems.json";
import exchangeRates from "../../../public/data/exchange-rates.json";
import { loadCatalogs } from "./loadCatalogs";

const files: Record<string, unknown> = {
  "/app/data/manifest.json": manifest,
  "/app/data/models.json": models,
  "/app/data/model-benchmarks.json": modelBenchmarks,
  "/app/data/gpus.json": gpus,
  "/app/data/inference-profiles.json": inferenceProfiles,
  "/app/data/cloud-pricing.json": cloudPricing,
  "/app/data/assumptions.json": assumptions,
  "/app/data/presets.json": presets,
  "/app/data/systems.json": systems,
  "/app/data/exchange-rates.json": exchangeRates,
};

const fetcher = (async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const data = files[url.pathname];
  return data === undefined
    ? new Response("Not found", { status: 404 })
    : Response.json(data);
}) as typeof fetch;

describe("loadCatalogs", () => {
  it("loads and validates every catalog relative to a static subpath", async () => {
    const catalogs = await loadCatalogs({
      baseUrl: "https://example.com/app/",
      fetcher,
    });

    expect(catalogs.dataVersion).toBe(manifest.dataVersion);
    expect(catalogs.models.length).toBeGreaterThan(0);
    expect(catalogs.gpus.length).toBeGreaterThan(0);
    expect(catalogs.systems.length).toBeGreaterThan(0);
    expect(catalogs.exchangeRates.base).toBe("USD");
    expect(catalogs.metadata.cloudPricing.lastUpdated).toBe(
      cloudPricing.lastUpdated,
    );
  });
});
