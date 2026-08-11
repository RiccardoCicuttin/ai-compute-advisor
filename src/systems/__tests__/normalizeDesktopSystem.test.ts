import { describe, expect, it } from "vitest";
import systemsJson from "../../../public/data/systems.json";
import {
  CustomDesktopSystemConfigSchema,
  DesktopSystemRecordSchema,
  normalizeDesktopSystem,
  parseDesktopSystemsCatalog,
  type CustomDesktopSystemConfig,
} from "../index";

describe("desktop system catalog", () => {
  it("parses four explicitly directional examples", () => {
    const catalog = parseDesktopSystemsCatalog(systemsJson);
    expect(catalog.data).toHaveLength(4);
    expect(catalog.data.every((system) => system.dataQuality === "directional")).toBe(true);
    expect(new Set(catalog.data.map((system) => system.acceleratorType))).toEqual(
      new Set(["GPU", "AI accelerator", "NPU"]),
    );
  });

  it("rejects incompatible memory fields and invalid whole-system power", () => {
    const dedicated = parseDesktopSystemsCatalog(systemsJson).data[0]!;
    expect(
      DesktopSystemRecordSchema.safeParse({
        ...dedicated,
        allocatableUnifiedMemoryGB: 64,
      }).success,
    ).toBe(false);
    expect(
      DesktopSystemRecordSchema.safeParse({
        ...dedicated,
        systemIdleWatts: dedicated.systemLoadWatts + 1,
      }).success,
    ).toBe(false);
  });
});

describe("normalizeDesktopSystem", () => {
  const catalog = parseDesktopSystemsCatalog(systemsJson);

  it("adds dedicated memory across physical accelerators once", () => {
    const system = catalog.data.find(
      (candidate) => candidate.id === "directional-discrete-ddr5-workstation",
    )!;
    const normalized = normalizeDesktopSystem(system);

    expect(normalized.totalAvailableMemoryGB).toBe(96);
    expect(normalized.physicalAcceleratorCount).toBe(2);
    expect(normalized.engineGpu.vramGB).toBe(96);
    expect(normalized.engineGpuCount).toBe(1);
    expect(normalized.completeSystem).toBe(true);
    expect(normalized.engineGpu.streetPriceUSD).toBe(system.purchasePriceUSD);
  });

  it("uses allocatable unified memory instead of installed system memory", () => {
    const system = catalog.data.find(
      (candidate) => candidate.id === "directional-unified-memory-desktop",
    )!;
    const normalized = normalizeDesktopSystem(system);

    expect(system.memoryArchitecture).toBe("unified");
    expect(normalized.totalAvailableMemoryGB).toBe(160);
    expect(normalized.totalAvailableMemoryGB).toBeLessThan(system.systemMemoryGB);
    expect(normalized.engineGpu.interconnect).toBe("unified");
  });

  it("encodes exact whole-system idle/load power for the existing cost formula", () => {
    const system = catalog.data[0]!;
    const normalized = normalizeDesktopSystem(system);
    const utilization = 0.4;
    const reconstructedPower =
      normalized.engineGpu.tdpWatts *
      (normalized.engineEconomicsOverrides.gpuIdlePowerRatio +
        (1 - normalized.engineEconomicsOverrides.gpuIdlePowerRatio) * utilization);
    const expectedPower =
      system.systemIdleWatts + (system.systemLoadWatts - system.systemIdleWatts) * utilization;

    expect(normalized.engineEconomicsOverrides.hostPurchasePriceUSD).toBe(0);
    expect(reconstructedPower).toBeCloseTo(expectedPower, 10);
  });

  it("never converts TOPS to TPS", () => {
    const npu = catalog.data.find(
      (candidate) => candidate.id === "directional-npu-desktop",
    )!;
    const normalized = normalizeDesktopSystem(npu);

    expect(normalized.peakTops?.value).toBe(50);
    expect(normalized.performanceOverride).toBeNull();
    expect("effectiveTokensPerSecond" in normalized.engineGpu).toBe(false);
  });

  it("preserves an explicit model-bound performance override", () => {
    const custom: CustomDesktopSystemConfig = {
      id: "custom-lab-system",
      name: "Custom Lab System",
      vendor: "Internal",
      memoryArchitecture: "unified",
      allocatableUnifiedMemoryGB: 96,
      systemMemoryType: "LPDDR5X",
      systemMemoryGB: 128,
      acceleratorType: "AI accelerator",
      acceleratorBehaviorCategory: "ai-accelerator",
      acceleratorModel: "Lab accelerator",
      acceleratorCount: 1,
      supportsModelSharding: false,
      memoryBandwidthGBps: 512,
      interconnect: "unified",
      systemIdleWatts: 30,
      systemLoadWatts: 240,
      purchasePriceUSD: 4200,
      peakTops: { value: 100, precision: "INT8" },
      runtimeSupport: {
        status: "partial",
        runtimes: ["Internal runtime"],
        method: "measured",
      },
      performance: {
        modelId: "qwen2.5-14b-instruct",
        quantizationId: "q4",
        effectiveTokensPerSecond: 31,
        timeToFirstTokenSeconds: 0.7,
        method: "measured",
      },
    };

    expect(CustomDesktopSystemConfigSchema.safeParse(custom).success).toBe(true);
    const normalized = normalizeDesktopSystem(custom);
    expect(normalized.performanceOverride?.effectiveTokensPerSecond).toBe(31);
    expect(normalized.performanceOverride?.method).toBe("measured");
    expect(normalized.peakTops?.value).toBe(100);
  });

  it("accepts data-pack accelerator labels, precision labels and dynamic counts", () => {
    const base = catalog.data[0]!;
    const parsed = DesktopSystemRecordSchema.parse({
      ...base,
      id: "directional-custom-accelerator",
      acceleratorType: "Vendor Matrix Engine X",
      acceleratorBehaviorCategory: "other",
      acceleratorCount: 3,
      peakTops: { value: 777, precision: "BF16-accumulate" },
    });

    expect(parsed.acceleratorType).toBe("Vendor Matrix Engine X");
    expect(parsed.acceleratorBehaviorCategory).toBe("other");
    expect(parsed.acceleratorCount).toBe(3);
    expect(parsed.peakTops?.precision).toBe("BF16-accumulate");
  });

  it("infers stable behavior for legacy accelerator labels", () => {
    const base = catalog.data[0]!;
    const { acceleratorBehaviorCategory: _removed, ...legacy } = base;
    const parsed = DesktopSystemRecordSchema.parse(legacy);
    expect(parsed.acceleratorBehaviorCategory).toBe("gpu");
  });
});
