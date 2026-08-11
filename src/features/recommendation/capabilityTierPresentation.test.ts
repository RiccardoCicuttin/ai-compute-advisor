import { describe, expect, it } from "vitest";
import type {
  CapabilityTierDefinition,
  OpportunityMapCell,
} from "../../types";
import {
  buildOpportunityRegionViews,
  capabilityTierLabel,
  createCapabilityTierScale,
} from "./capabilityTierPresentation";

const capabilityTiers: CapabilityTierDefinition[] = [
  {
    id: "expert",
    labels: { en: "Expert", "zh-CN": "专家级" },
    rank: 90,
  },
  {
    id: "starter",
    labels: { en: "Starter", "zh-CN": "入门级" },
    rank: 10,
  },
  {
    id: "specialist",
    labels: { en: "Specialist", "zh-CN": "专业级" },
    rank: 40,
  },
];

describe("dynamic capability-tier presentation", () => {
  it("sorts by rank and creates an ordinal chart domain for any tier count", () => {
    const scale = createCapabilityTierScale(capabilityTiers, "zh-CN");

    expect(scale.tiers).toEqual([
      { id: "starter", label: "入门级", rank: 10, position: 0 },
      { id: "specialist", label: "专业级", rank: 40, position: 1 },
      { id: "expert", label: "专家级", rank: 90, position: 2 },
    ]);
    expect(scale.ticks).toEqual([0, 1, 2]);
    expect(scale.domain).toEqual([-0.5, 2.5]);
  });

  it("uses the active locale label and exposes an unknown ID transparently", () => {
    expect(capabilityTierLabel("specialist", capabilityTiers, "en")).toBe(
      "Specialist",
    );
    expect(capabilityTierLabel("specialist", capabilityTiers, "zh-CN")).toBe(
      "专业级",
    );
    expect(capabilityTierLabel("missing", capabilityTiers, "en")).toBe(
      "missing",
    );
  });

  it("keeps semantic tier IDs in opportunity regions", () => {
    const cells: OpportunityMapCell[] = [
      {
        utilizationRatio: 0,
        intelligenceClass: "starter",
        deployment: "local",
      },
      {
        utilizationRatio: 0.5,
        intelligenceClass: "expert",
        deployment: "constraint-conflict",
      },
    ];

    expect(buildOpportunityRegionViews(cells)).toEqual([
      expect.objectContaining({
        capabilityTierId: "starter",
        deployment: "local",
        x1: 0,
        x2: 0.25,
      }),
      expect.objectContaining({
        capabilityTierId: "expert",
        deployment: "constraint",
        x1: 0.25,
        x2: 0.75,
      }),
    ]);
  });
});
