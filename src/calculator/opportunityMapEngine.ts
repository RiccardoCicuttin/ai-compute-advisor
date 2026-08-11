import type {
  CapabilityTierDefinition,
  CapabilityTierId,
  OpportunityMapCell,
  OpportunityMapResult,
} from "../types";
import { compareCapabilityTiers, orderedCapabilityTiers } from "./capabilityTiers";
import { recommendDeployment, type RecommendationInput } from "./recommendationEngine";

const utilizationSamples = [0, 0.25, 0.5, 0.75, 1];

export function buildOpportunityMap(input: {
  recommendationInput: RecommendationInput;
  localModelIntelligence: CapabilityTierId;
  capabilityTiers: CapabilityTierDefinition[];
  currentUtilizationRatio: number;
  utilizationMethod: "derived" | "assumed";
}): OpportunityMapResult {
  const cells: OpportunityMapCell[] = orderedCapabilityTiers(input.capabilityTiers).flatMap(
    (tier) =>
      utilizationSamples.map((utilizationRatio) => {
        const recommendation = recommendDeployment({
          ...input.recommendationInput,
          intelligence: tier.id,
          utilizationRatio,
          localModelMeetsRequirements:
            compareCapabilityTiers(
              input.localModelIntelligence,
              tier.id,
              input.capabilityTiers,
            ) >= 0,
        });
        return {
          utilizationRatio,
          intelligenceClass: tier.id,
          deployment: recommendation.deployment ?? "constraint-conflict",
        };
      }),
  );
  const currentRecommendation = recommendDeployment(input.recommendationInput);

  return {
    cells,
    currentPoint: {
      // Preserve overload instead of pinning every value above capacity to 100%.
      // The presentation may anchor an overflow marker at the chart edge, but it
      // still needs the real ratio to explain how far demand exceeds capacity.
      utilizationRatio: Math.max(0, input.currentUtilizationRatio),
      intelligenceClass: input.recommendationInput.intelligence,
      method: input.utilizationMethod,
      deployment: currentRecommendation.deployment ?? "constraint-conflict",
    },
    boundaryReasonCodes: currentRecommendation.reasonCodes.slice(0, 2),
  };
}
