import { describe, expect, it } from "vitest";
import systems from "../../../public/data/systems.json";
import {
  normalizeDesktopSystem,
  parseDesktopSystemsCatalog,
} from "../../systems";

const towerPowerMatrix = {
  "lenovo-thinkcentre-x-tower-rtx-pro-5000-48gb-1x-tech-ready": 603,
  "lenovo-thinkcentre-x-tower-rtx-pro-5000-48gb-2x-tech-ready": 883,
  "lenovo-thinkcentre-x-tower-rtx-pro-5000-72gb-1x-tech-ready": 603,
  "lenovo-thinkcentre-x-tower-rtx-pro-5000-72gb-2x-tech-ready": 883,
  "lenovo-thinkcentre-x-tower-rtx-5090-32gb-mtm": 878,
  "lenovo-thinkcentre-x-tower-rtx-5090-d-v2-24gb": 878,
  "lenovo-thinkcentre-x-tower-rtx-5080-16gb": 663,
  "lenovo-thinkcentre-x-tower-rtx-5060-ti-16gb-1x": 483,
  "lenovo-thinkcentre-x-tower-rtx-5060-ti-16gb-2x": 663,
} as const;

describe("ThinkCentre bundled system defaults", () => {
  const catalog = parseDesktopSystemsCatalog(systems);

  it("models X Ultra as unified memory without inventing economics or TPS", () => {
    const ultra = catalog.data.find(
      (record) => record.id === "lenovo-thinkcentre-x-ultra-128gb-pre-release",
    );

    expect(ultra).toMatchObject({
      vendor: "Lenovo",
      dataQuality: "directional",
      memoryArchitecture: "unified",
      systemMemoryGB: 128,
      allocatableUnifiedMemoryGB: 96,
      acceleratorModel: "AMD Radeon 8065S",
      acceleratorCount: 1,
      supportsModelSharding: false,
      systemIdleWatts: null,
      systemLoadWatts: null,
      purchasePriceUSD: null,
    });
    expect(ultra).not.toHaveProperty("performance");
    expect(ultra).not.toHaveProperty("peakTops");
    expect(ultra?.notes).toContain("55 TOPS");
    expect(ultra?.notes).toContain("not converted to LLM TPS");
    expect(ultra?.notes).toContain("Qwen3.5-235B-A22B (Q2)");
  });

  it("preserves the U9/U7 Thermal Matrix calculated-power values as directional evidence", () => {
    for (const [id, calculatedPower] of Object.entries(towerPowerMatrix)) {
      const record = catalog.data.find((candidate) => candidate.id === id);
      expect(record, id).toMatchObject({
        vendor: "Lenovo",
        dataQuality: "directional",
        systemIdleWatts: null,
        systemLoadWatts: calculatedPower,
        purchasePriceUSD: null,
      });
      expect(record?.notes, id).toContain("calculated power");
      expect(record?.notes, id).toContain("not measured wall power");
      expect(record, id).not.toHaveProperty("performance");
    }
  });

  it("keeps dual-card installed memory separate from runnable model memory", () => {
    const dual48 = catalog.data.find(
      (record) =>
        record.id ===
        "lenovo-thinkcentre-x-tower-rtx-pro-5000-48gb-2x-tech-ready",
    );
    const dual72 = catalog.data.find(
      (record) =>
        record.id ===
        "lenovo-thinkcentre-x-tower-rtx-pro-5000-72gb-2x-tech-ready",
    );
    const dual5060 = catalog.data.find(
      (record) =>
        record.id === "lenovo-thinkcentre-x-tower-rtx-5060-ti-16gb-2x",
    );

    for (const [record, installed, available] of [
      [dual48, 96, 48],
      [dual72, 144, 72],
      [dual5060, 32, 16],
    ] as const) {
      expect(record?.acceleratorCount).toBe(2);
      expect(record?.supportsModelSharding).toBe(false);
      const normalized = normalizeDesktopSystem(record!);
      expect(normalized.totalInstalledAcceleratorMemoryGB).toBe(installed);
      expect(normalized.totalAvailableMemoryGB).toBe(available);
    }
  });
});
