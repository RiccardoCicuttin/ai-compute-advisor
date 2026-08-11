import type { CloudCostResult, HybridCostResult, LocalCostResult } from "../types";
import { assertRatio, safeCostPerMillion, trace, value } from "./trace";

export function calculateHybridCost(input: {
  local: LocalCostResult;
  cloud: CloudCostResult;
  localCoverageRatio: number;
  totalTokens: number;
}): HybridCostResult {
  assertRatio(input.localCoverageRatio, "localCoverageRatio");
  const cloudEscalationRatio = 1 - input.localCoverageRatio;
  const localInfrastructureEnabled = input.localCoverageRatio > 0;
  const localMonthlyCost = localInfrastructureEnabled ? input.local.monthlyTcoUSD : 0;
  const localThreeYearCost = localInfrastructureEnabled ? input.local.threeYearTcoUSD : 0;
  const cloudEscalationCostUSD = input.cloud.monthlyCostUSD * cloudEscalationRatio;
  const monthlyCostUSD = localMonthlyCost + cloudEscalationCostUSD;
  const threeYearTcoUSD =
    localThreeYearCost + input.cloud.threeYearTcoUSD * cloudEscalationRatio;
  const warnings: string[] = [];
  if (input.localCoverageRatio === 0 || input.localCoverageRatio === 1) {
    warnings.push("Hybrid is at a boundary and is economically equivalent to a single deployment mode.");
  }

  return {
    localCoverageRatio: input.localCoverageRatio,
    cloudEscalationRatio,
    cloudTokenAvoidanceRatio: input.localCoverageRatio,
    locallyServedTokens: input.totalTokens * input.localCoverageRatio,
    cloudEscalationCostUSD,
    monthlyCostUSD,
    costPerMillionTokensUSD: safeCostPerMillion(monthlyCostUSD, input.totalTokens),
    savingVsCloudRatio:
      input.cloud.monthlyCostUSD > 0
        ? 1 - monthlyCostUSD / input.cloud.monthlyCostUSD
        : null,
    threeYearTcoUSD,
    warnings,
    trace: trace({
      id: "hybrid-cost",
      title: "Hybrid monthly cost",
      formula: "Local infrastructure TCO + cloud cost × cloud escalation rate",
      inputs: [
        value("localTco", "Local infrastructure TCO", localMonthlyCost, "USD/month", "derived"),
        value("localCoverage", "Local coverage", input.localCoverageRatio, "ratio", "user"),
        value("cloudOnly", "Cloud-only monthly cost", input.cloud.monthlyCostUSD, "USD/month", "derived"),
      ],
      intermediateValues: [
        value("cloudEscalation", "Cloud escalation rate", cloudEscalationRatio, "ratio", "derived"),
        value("cloudEscalationCost", "Cloud escalation cost", cloudEscalationCostUSD, "USD/month", "derived"),
      ],
      result: value("hybridMonthly", "Hybrid monthly cost", monthlyCostUSD, "USD/month", "derived"),
      method: "derived",
      warnings,
      sourceIds: input.cloud.pricing ? [input.cloud.pricing.id] : [],
    }),
  };
}
