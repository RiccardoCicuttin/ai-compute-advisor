import type { CloudCostResult, CloudPricingRecord, TokenDemandResult } from "../types";
import { assertRatio, safeCostPerMillion, trace, value } from "./trace";

export function calculateCloudCost(
  tokenDemand: TokenDemandResult,
  pricing: CloudPricingRecord,
  cachedInputRatio: number,
): CloudCostResult {
  assertRatio(cachedInputRatio, "cachedInputRatio");
  const cachedInputTokens = tokenDemand.monthlyInputTokens * cachedInputRatio;
  const uncachedInputTokens = tokenDemand.monthlyInputTokens - cachedInputTokens;
  const cachedRate =
    pricing.cachedInputPricePerMillionTokens ?? pricing.inputPricePerMillionTokens;
  const inputCostUSD =
    (uncachedInputTokens / 1_000_000) * pricing.inputPricePerMillionTokens;
  const cachedInputCostUSD = (cachedInputTokens / 1_000_000) * cachedRate;
  const outputCostUSD =
    (tokenDemand.monthlyOutputTokens / 1_000_000) * pricing.outputPricePerMillionTokens;
  const monthlyCostUSD = inputCostUSD + cachedInputCostUSD + outputCostUSD;
  const warnings = pricing.cachedInputPricePerMillionTokens === undefined
    ? ["Cached input uses the standard input rate because no cached rate is available."]
    : [];

  return {
    pricing,
    cachedInputTokens,
    uncachedInputTokens,
    inputCostUSD,
    cachedInputCostUSD,
    outputCostUSD,
    monthlyCostUSD,
    costPerMillionTokensUSD: safeCostPerMillion(
      monthlyCostUSD,
      tokenDemand.monthlyTotalTokens,
    ),
    threeYearTcoUSD: monthlyCostUSD * 36,
    warnings,
    trace: trace({
      id: "cloud-cost",
      title: "Cloud monthly cost",
      formula: "Uncached input × input rate + cached input × cached rate + output × output rate",
      inputs: [
        value("inputTokens", "Monthly input tokens", tokenDemand.monthlyInputTokens, "tokens/month", "derived"),
        value("outputTokens", "Monthly output tokens", tokenDemand.monthlyOutputTokens, "tokens/month", "derived"),
        value("cachedRatio", "Cached input ratio", cachedInputRatio, "ratio", "user"),
      ],
      intermediateValues: [
        value("inputCost", "Uncached input cost", inputCostUSD, "USD/month", "derived"),
        value("cachedCost", "Cached input cost", cachedInputCostUSD, "USD/month", "derived"),
        value("outputCost", "Output cost", outputCostUSD, "USD/month", "derived"),
      ],
      result: value("cloudMonthly", "Cloud monthly cost", monthlyCostUSD, "USD/month", "derived"),
      method: "derived",
      warnings,
      sourceIds: [pricing.id],
    }),
  };
}
