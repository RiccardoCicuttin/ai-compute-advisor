import type {
  AssumptionsRecord,
  BreakEvenResult,
  CalculationTrace,
  DeploymentComparison,
  HardwareFitStatus,
  HybridCostResult,
  CapabilityTierId,
  LocalCostResult,
  CloudCostResult,
  PrivacyRequirement,
  LatencyRequirement,
  RecommendationReasonCode,
  RecommendationResult,
} from "../types";
import { trace, value } from "./trace";

export interface RecommendationInput {
  complete: boolean;
  privacy: PrivacyRequirement;
  intelligence: CapabilityTierId;
  latency: LatencyRequirement;
  localFit: HardwareFitStatus | null;
  localPerformanceAvailable: boolean;
  localRuntimeCompatible: boolean;
  localModelMeetsRequirements: boolean;
  cloudOfferingAvailable: boolean;
  localCoverageRatio: number;
  utilizationRatio: number;
  breakEven: BreakEvenResult | null;
  localMonthlyCostUSD: number | null;
  hybridMonthlyCostUSD: number | null;
  cloudMonthlyCostUSD: number | null;
  assumptions: AssumptionsRecord["recommendation"];
}

function result(
  status: RecommendationResult["status"],
  deployment: RecommendationResult["deployment"],
  matchedRuleId: string,
  reasonCodes: RecommendationReasonCode[],
  warnings: string[] = [],
  changeConditions: RecommendationResult["changeConditions"] = [],
): RecommendationResult {
  return {
    status,
    deployment,
    matchedRuleId,
    reasonCodes: [...new Set(reasonCodes)].slice(0, 4),
    warnings,
    changeConditions,
  };
}

export function recommendDeployment(input: RecommendationInput): RecommendationResult {
  if (!input.complete || input.localFit === null || input.cloudMonthlyCostUSD === null) {
    return result("incomplete", null, "incomplete-inputs", ["INCOMPLETE_INPUTS"]);
  }

  const localMemoryRunnable = input.localFit !== "cannot-run";
  const localPerformanceSufficient =
    input.localPerformanceAvailable && input.utilizationRatio <= 1;
  const localRunnable =
    localMemoryRunnable &&
    input.localRuntimeCompatible &&
    localPerformanceSufficient;
  const localConstraintReason: RecommendationReasonCode = !localMemoryRunnable
    ? "LOCAL_HARDWARE_INFEASIBLE"
    : !input.localRuntimeCompatible
      ? "LOCAL_RUNTIME_UNVERIFIED"
      : "LOCAL_PERFORMANCE_INSUFFICIENT";
  const cloudAllowed = input.privacy !== "critical" && input.cloudOfferingAvailable;

  if (input.privacy === "critical") {
    if (localRunnable && input.localModelMeetsRequirements) {
      return result(
        "recommended",
        "local",
        "critical-privacy-local",
        ["CRITICAL_PRIVACY_REQUIRES_LOCAL", "LOCAL_MODEL_MEETS_REQUIREMENTS"],
      );
    }
    return result(
      "constraint-conflict",
      null,
      "critical-privacy-conflict",
      [
        "CRITICAL_PRIVACY_REQUIRES_LOCAL",
        localRunnable ? "LOCAL_MODEL_INTELLIGENCE_GAP" : localConstraintReason,
      ],
      ["Critical privacy and the current local configuration cannot both be satisfied."],
    );
  }

  if (!localRunnable) {
    if (cloudAllowed) {
      return result(
        "recommended",
        "cloud",
        "local-infeasible-cloud",
        [localConstraintReason, "CLOUD_AVOIDS_CAPEX"],
      );
    }
    return result("constraint-conflict", null, "no-feasible-deployment", [
      localConstraintReason,
      "NO_CLOUD_OFFERING",
    ]);
  }

  if (!input.localModelMeetsRequirements) {
    if (
      input.privacy === "high" &&
      input.localCoverageRatio >= input.assumptions.minimumHybridLocalCoverageRatio &&
      cloudAllowed
    ) {
      return result("tradeoff", "hybrid", "capability-gap-high-privacy", [
        "LOCAL_MODEL_INTELLIGENCE_GAP",
        "CLOUD_CAPABILITY_REQUIRED",
        "HIGH_LOCAL_COVERAGE",
      ]);
    }
    if (cloudAllowed) {
      return result("recommended", "cloud", "local-intelligence-gap", [
        "LOCAL_MODEL_INTELLIGENCE_GAP",
        "CLOUD_CAPABILITY_REQUIRED",
      ]);
    }
  }

  const breakEvenPreferred =
    input.breakEven?.month.status === "available" &&
    input.breakEven.month.months !== null &&
    input.breakEven.month.months <= input.assumptions.maximumPreferredBreakEvenMonths;
  const utilizationReached =
    input.breakEven?.requiredUtilization.status === "available" &&
    input.breakEven.requiredUtilization.ratio !== null &&
    input.utilizationRatio >= input.breakEven.requiredUtilization.ratio;
  const localCostAttractive =
    input.localMonthlyCostUSD !== null &&
    input.localMonthlyCostUSD <=
      input.cloudMonthlyCostUSD * (1 + input.assumptions.costTieToleranceRatio);
  const localAttractive = breakEvenPreferred && utilizationReached && localCostAttractive;

  if (input.privacy === "high" && input.localModelMeetsRequirements) {
    return result(
      localAttractive ? "recommended" : "tradeoff",
      "local",
      "high-privacy-capable-local",
      [
        "LOCAL_MODEL_MEETS_REQUIREMENTS",
        ...(localAttractive
          ? (["UTILIZATION_ABOVE_BREAK_EVEN", "LOCAL_LOWER_MONTHLY_COST"] as const)
          : ([
              input.breakEven?.month.status === "none"
                ? "NO_ECONOMIC_BREAK_EVEN"
                : "LOCAL_ECONOMICS_UNFAVORABLE",
            ] as const)),
      ],
      localAttractive ? [] : ["Local is preferred for privacy, but current economics are unfavorable."],
    );
  }

  if (localAttractive) {
    const reasons: RecommendationReasonCode[] = [
      "LOCAL_MODEL_MEETS_REQUIREMENTS",
      "UTILIZATION_ABOVE_BREAK_EVEN",
      "LOCAL_LOWER_MONTHLY_COST",
    ];
    if (input.latency === "real-time") reasons.push("REAL_TIME_NETWORK_LATENCY_PREFERENCE");
    return result("recommended", "local", "local-economic", reasons);
  }

  const hybridSavings =
    input.hybridMonthlyCostUSD !== null && input.cloudMonthlyCostUSD > 0
      ? 1 - input.hybridMonthlyCostUSD / input.cloudMonthlyCostUSD
      : null;
  const hybridAttractive =
    cloudAllowed &&
    input.localCoverageRatio >= input.assumptions.minimumHybridLocalCoverageRatio &&
    hybridSavings !== null &&
    hybridSavings >= input.assumptions.minimumMeaningfulSavingsRatio;
  if (hybridAttractive) {
    return result("recommended", "hybrid", "hybrid-economic", [
      "HIGH_LOCAL_COVERAGE",
      "HYBRID_SAVES_VS_CLOUD",
    ]);
  }

  return result(
    "recommended",
    "cloud",
    "cloud-default-economic",
    [
      input.breakEven?.month.status === "none"
        ? "NO_ECONOMIC_BREAK_EVEN"
        : "CLOUD_AVOIDS_CAPEX",
      "CLOUD_AVOIDS_CAPEX",
    ],
    [],
    input.breakEven?.requiredUtilization.ratio
      ? [
          {
            target: "local",
            description: "Local becomes more attractive above the required utilization.",
            thresholdValue: input.breakEven.requiredUtilization.ratio,
            unit: "ratio",
          },
        ]
      : [],
  );
}

export function createRecommendationTrace(
  input: RecommendationInput,
  recommendation: RecommendationResult,
): CalculationTrace {
  return trace({
    id: "recommendation-rules",
    title: "Deployment recommendation rules",
    formula: `Evaluate constraints and economics in priority order; matched rule: ${recommendation.matchedRuleId}`,
    inputs: [
      value("privacy", "Privacy requirement", input.privacy, "text", "user"),
      value("intelligence", "Intelligence requirement", input.intelligence, "text", "user"),
      value("latency", "Latency requirement", input.latency, "text", "user"),
      value("localFit", "Local VRAM fit", input.localFit ?? "unavailable", "text", "derived"),
      value("runtimeCompatible", "Local runtime confirmed", input.localRuntimeCompatible ? "yes" : "no", "text", "derived"),
      value("performanceAvailable", "Local performance profile available", input.localPerformanceAvailable ? "yes" : "no", "text", "derived"),
      value("localCoverage", "Local coverage", input.localCoverageRatio, "ratio", "user"),
      value("computeUtilization", "Workload compute utilization", input.utilizationRatio, "ratio", "derived"),
    ],
    intermediateValues: [
      value(
        "matchedRule",
        "Matched rule",
        recommendation.matchedRuleId,
        "text",
        "derived",
      ),
      value(
        "reasonCodes",
        "Reason codes",
        recommendation.reasonCodes.join(", "),
        "text",
        "derived",
      ),
      value(
        "breakEven",
        "Local cash break-even",
        input.breakEven?.month.months ?? null,
        "months",
        "derived",
      ),
    ],
    result: value(
      "deployment",
      "Recommended deployment",
      recommendation.deployment ?? recommendation.status,
      "text",
      "derived",
    ),
    method: "derived",
    warnings: recommendation.warnings,
    sourceIds: ["assumptions.recommendation"],
  });
}

export function buildDeploymentComparisons(input: {
  privacy: PrivacyRequirement;
  localFit: HardwareFitStatus | null;
  localModelMeetsRequirements: boolean;
  localPerformanceSufficient: boolean;
  localRuntimeCompatible: boolean;
  localIntelligence: CapabilityTierId;
  highestCapabilityTierId: CapabilityTierId;
  local: LocalCostResult | null;
  hybrid: HybridCostResult | null;
  cloud: CloudCostResult | null;
}): DeploymentComparison[] {
  const localFeasible =
    input.localFit !== null &&
    input.localFit !== "cannot-run" &&
    input.localModelMeetsRequirements &&
    input.localPerformanceSufficient &&
    input.localRuntimeCompatible;
  const cloudFeasible = input.privacy !== "critical" && input.cloud !== null;
  const hybridFeasible = localFeasible && cloudFeasible && input.hybrid !== null;
  const capex = input.local?.hardwarePurchasePriceUSD ?? 0;

  return [
    {
      deployment: "local",
      feasible: localFeasible,
      monthlyCostUSD: input.local?.monthlyTcoUSD ?? null,
      threeYearTcoUSD: input.local?.threeYearTcoUSD ?? null,
      costPerMillionTokensUSD: input.local?.costPerMillionTokensUSD ?? null,
      privacy: "highest",
      latency: "local-path",
      scalability: "hardware-limited",
      intelligenceCeiling: input.localIntelligence,
      upfrontInvestmentUSD: capex,
      warnings: localFeasible
        ? []
        : ["Current model, VRAM, or performance capacity does not satisfy the workload."],
    },
    {
      deployment: "hybrid",
      feasible: hybridFeasible,
      monthlyCostUSD: input.hybrid?.monthlyCostUSD ?? null,
      threeYearTcoUSD: input.hybrid?.threeYearTcoUSD ?? null,
      costPerMillionTokensUSD: input.hybrid?.costPerMillionTokensUSD ?? null,
      privacy: "controlled",
      latency: "mixed-path",
      scalability: "elastic-with-local-base",
      intelligenceCeiling: input.highestCapabilityTierId,
      upfrontInvestmentUSD: capex,
      warnings: hybridFeasible ? [] : ["Hybrid requires both a feasible local path and cloud processing."],
    },
    {
      deployment: "cloud",
      feasible: cloudFeasible,
      monthlyCostUSD: input.cloud?.monthlyCostUSD ?? null,
      threeYearTcoUSD: input.cloud?.threeYearTcoUSD ?? null,
      costPerMillionTokensUSD: input.cloud?.costPerMillionTokensUSD ?? null,
      privacy: "provider-dependent",
      latency: "network-dependent",
      scalability: "elastic",
      intelligenceCeiling: input.highestCapabilityTierId,
      upfrontInvestmentUSD: 0,
      warnings: cloudFeasible ? [] : ["Cloud is unavailable or conflicts with critical privacy."],
    },
  ];
}
