import { describe, expect, it } from "vitest";
import gpus from "../../../public/data/gpus.json";
import inferenceProfiles from "../../../public/data/inference-profiles.json";
import { GpusCatalogSchema } from "./catalogSchemas";

const expectedThinkCentreGpuInputs = {
  "rtx-pro-5000-blackwell-48gb": {
    vramGB: 48,
    memoryBandwidthGBps: 1344,
    tdpWatts: 300,
    streetPriceUSD: 5929.99,
    supportedCounts: [1, 2],
    peakAiTops: { value: 2064 },
  },
  "rtx-pro-5000-blackwell-72gb": {
    vramGB: 72,
    memoryBandwidthGBps: 1344,
    tdpWatts: 300,
    streetPriceUSD: 8229.99,
    supportedCounts: [1, 2],
    peakAiTops: { value: 2064 },
  },
  "rtx-5090-32gb": {
    vramGB: 32,
    memoryBandwidthGBps: 1792,
    tdpWatts: 575,
    streetPriceUSD: 1999,
    supportedCounts: [1],
    peakAiTops: { value: 3352 },
  },
  "rtx-5090-d-v2-24gb": {
    vramGB: 24,
    memoryBandwidthGBps: 1344,
    tdpWatts: 575,
    streetPriceUSD: 16499 / 6.7444,
    supportedCounts: [1],
    peakAiTops: { value: 2375 },
  },
  "rtx-5080-16gb": {
    vramGB: 16,
    memoryBandwidthGBps: 960,
    tdpWatts: 360,
    streetPriceUSD: 999,
    supportedCounts: [1],
    peakAiTops: { value: 1801 },
  },
  "rtx-5060-ti-16gb": {
    vramGB: 16,
    memoryBandwidthGBps: 448,
    tdpWatts: 180,
    streetPriceUSD: 429,
    supportedCounts: [1, 2],
    peakAiTops: { value: 759 },
  },
} as const;

describe("ThinkCentre X Tower GPU catalog defaults", () => {
  it("parses the records and preserves the official board inputs", () => {
    const parsed = GpusCatalogSchema.parse(gpus);

    for (const [id, expected] of Object.entries(expectedThinkCentreGpuInputs)) {
      const gpu = parsed.data.find((candidate) => candidate.id === id);
      expect(gpu, id).toMatchObject({
        id,
        vendor: "NVIDIA",
        interconnect: "pcie",
        supportsTensorParallel: false,
        ...expected,
      });
      expect(gpu?.peakAiTops?.precision).toMatch(/FP4/);
      expect(gpu?.evidence?.some((item) => item.kind === "specification" && item.url)).toBe(true);
      expect(gpu?.evidence?.every((item) => item.observedAt === "2026-08-11")).toBe(true);
    }
  });

  it("does not turn a pre-release dual-card BOM option into pooled memory", () => {
    const parsed = GpusCatalogSchema.parse(gpus);
    const dualOptionIds = [
      "rtx-pro-5000-blackwell-48gb",
      "rtx-pro-5000-blackwell-72gb",
      "rtx-5060-ti-16gb",
    ];

    for (const id of dualOptionIds) {
      const gpu = parsed.data.find((candidate) => candidate.id === id);
      expect(gpu?.supportedCounts).toEqual([1, 2]);
      expect(gpu?.supportsTensorParallel).toBe(false);
      expect(gpu?.notes).toMatch(/does not pool/);
      const qualification = gpu?.evidence?.find(
        (item) => item.kind === "system-qualification",
      );
      expect(qualification?.notes).toMatch(/dual cards/);
      expect(qualification?.notes).toMatch(/riser/);
    }
  });

  it("adds no inferred LLM performance profiles", () => {
    const newGpuIds = new Set(Object.keys(expectedThinkCentreGpuInputs));
    const inferredProfiles = inferenceProfiles.data.filter((profile) =>
      newGpuIds.has(profile.gpuId),
    );

    expect(inferredProfiles).toEqual([]);
  });
});
