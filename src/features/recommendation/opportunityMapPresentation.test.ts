import { describe, expect, it } from "vitest";
import type {
  OpportunityPointView,
  OpportunityRegionView,
} from "../advisor-ui/viewModels";
import {
  buildOpportunityBandRows,
  findOpportunityDeployment,
  findUniformOpportunityDeployment,
} from "./opportunityMapPresentation";

const regions: OpportunityRegionView[] = [
  {
    id: "basic-0",
    deployment: "cloud",
    capabilityTierId: "basic",
    x1: 0,
    x2: 0.125,
  },
  {
    id: "basic-25",
    deployment: "hybrid",
    capabilityTierId: "basic",
    x1: 0.125,
    x2: 0.375,
  },
  {
    id: "basic-50",
    deployment: "hybrid",
    capabilityTierId: "basic",
    x1: 0.375,
    x2: 0.625,
  },
  {
    id: "advanced-0",
    deployment: "constraint",
    capabilityTierId: "advanced",
    x1: 0,
    x2: 1,
  },
];

describe("opportunity map presentation", () => {
  it("merges adjacent cells without moving their outer boundaries", () => {
    expect(buildOpportunityBandRows(regions)).toEqual([
      {
        capabilityTierId: "basic",
        bands: [
          {
            id: "basic-0",
            deployment: "cloud",
            x1: 0,
            x2: 0.125,
          },
          {
            id: "basic-25+basic-50",
            deployment: "hybrid",
            x1: 0.125,
            x2: 0.625,
          },
        ],
      },
      {
        capabilityTierId: "advanced",
        bands: [
          {
            id: "advanced-0",
            deployment: "constraint",
            x1: 0,
            x2: 1,
          },
        ],
      },
    ]);
  });

  it("resolves the current recommendation from its tier and utilization", () => {
    const rows = buildOpportunityBandRows(regions);
    const point: OpportunityPointView = {
      utilization: 0.45,
      capabilityTierId: "basic",
      method: "derived",
    };

    expect(findOpportunityDeployment(point, rows)).toBe("hybrid");
    expect(
      findOpportunityDeployment(
        { ...point, capabilityTierId: "advanced" },
        rows,
      ),
    ).toBe("constraint");
    expect(
      findOpportunityDeployment(
        { ...point, capabilityTierId: "unknown" },
        rows,
      ),
    ).toBeNull();
  });

  it("assigns an exact shared boundary to the band on its right", () => {
    const rows = buildOpportunityBandRows(regions);
    expect(
      findOpportunityDeployment(
        {
          utilization: 0.125,
          capabilityTierId: "basic",
          method: "assumed",
        },
        rows,
      ),
    ).toBe("hybrid");
  });

  it("does not misclassify utilization above the displayed 100% domain", () => {
    const rows = buildOpportunityBandRows(regions);
    expect(
      findOpportunityDeployment(
        {
          utilization: 1.8,
          capabilityTierId: "basic",
          method: "derived",
        },
        rows,
      ),
    ).toBeNull();
  });

  it("identifies a map whose recommendation never changes", () => {
    expect(
      findUniformOpportunityDeployment(buildOpportunityBandRows(regions)),
    ).toBeNull();
    expect(
      findUniformOpportunityDeployment(
        buildOpportunityBandRows([
          {
            id: "basic-all",
            deployment: "cloud",
            capabilityTierId: "basic",
            x1: 0,
            x2: 1,
          },
          {
            id: "advanced-all",
            deployment: "cloud",
            capabilityTierId: "advanced",
            x1: 0,
            x2: 1,
          },
        ]),
      ),
    ).toBe("cloud");
    expect(findUniformOpportunityDeployment([])).toBeNull();
  });
});
