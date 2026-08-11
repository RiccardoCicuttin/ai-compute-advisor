import { describe, expect, it } from "vitest";
import systems from "../../../public/data/systems.json";
import { normalizeDesktopSystem, parseDesktopSystemsCatalog } from "../index";

describe("desktop-system model sharding", () => {
  it("uses only one device's dedicated memory when sharding is not supported", () => {
    const catalog = parseDesktopSystemsCatalog(systems);
    const multiDevice = catalog.data.find(
      (system) =>
        system.memoryArchitecture === "dedicated" && system.acceleratorCount > 1,
    );
    expect(multiDevice).toBeDefined();
    if (!multiDevice || multiDevice.memoryArchitecture !== "dedicated") return;

    const normalized = normalizeDesktopSystem({
      ...multiDevice,
      supportsModelSharding: false,
    });

    expect(normalized.physicalAcceleratorCount).toBeGreaterThan(1);
    expect(normalized.totalInstalledAcceleratorMemoryGB).toBe(
      multiDevice.dedicatedMemoryGBPerDevice * multiDevice.acceleratorCount,
    );
    expect(normalized.totalAvailableMemoryGB).toBe(
      multiDevice.dedicatedMemoryGBPerDevice,
    );
    expect(normalized.engineGpu.vramGB).toBe(
      multiDevice.dedicatedMemoryGBPerDevice,
    );
    expect(normalized.engineGpu.supportsTensorParallel).toBe(false);
  });
});
