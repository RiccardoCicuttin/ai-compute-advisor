import { describe, expect, it } from "vitest";
import { buildOpportunityMap } from "../opportunityMapEngine";
import type { RecommendationInput } from "../recommendationEngine";

const capabilityTiers = [
  { id: "basic", labels: { en: "Basic", "zh-CN": "基础" }, rank: 0 },
  {
    id: "advanced",
    labels: { en: "Advanced", "zh-CN": "高级" },
    rank: 1,
  },
];

const recommendationInput: RecommendationInput = {
  complete: true,
  privacy: "medium" as const,
  intelligence: "advanced",
  latency: "interactive" as const,
  localFit: "recommended" as const,
  localPerformanceAvailable: true,
  localRuntimeCompatible: true,
  localModelMeetsRequirements: true,
  cloudOfferingAvailable: true,
  localCoverageRatio: 0.75,
  utilizationRatio: 1.8,
  breakEven: null,
  localMonthlyCostUSD: 300,
  hybridMonthlyCostUSD: 240,
  cloudMonthlyCostUSD: 200,
  assumptions: {
    lowUtilizationRatio: 0.25,
    highUtilizationRatio: 0.6,
    maximumPreferredBreakEvenMonths: 24,
    highPrivacyLevels: ["high", "critical"],
    minimumHybridLocalCoverageRatio: 0.5,
    minimumMeaningfulSavingsRatio: 0.1,
    costTieToleranceRatio: 0.05,
  },
};

describe("opportunity map current point", () => {
  it("preserves utilization above local capacity for transparent overflow presentation", () => {
    const result = buildOpportunityMap({
      recommendationInput,
      localModelIntelligence: "advanced",
      capabilityTiers,
      currentUtilizationRatio: 1.8,
      utilizationMethod: "derived",
    });

    expect(result.currentPoint.utilizationRatio).toBe(1.8);
    expect(result.currentPoint.deployment).toBe("cloud");
  });

  it("still clamps invalid negative utilization at zero", () => {
    const result = buildOpportunityMap({
      recommendationInput: { ...recommendationInput, utilizationRatio: 0 },
      localModelIntelligence: "advanced",
      capabilityTiers,
      currentUtilizationRatio: -0.25,
      utilizationMethod: "assumed",
    });

    expect(result.currentPoint.utilizationRatio).toBe(0);
  });
});
