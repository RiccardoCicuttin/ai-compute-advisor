import type { CapabilityTierId } from "./catalog";

export type Deployment = "local" | "hybrid" | "cloud";

export type RecommendationReasonCode =
  | "CRITICAL_PRIVACY_REQUIRES_LOCAL"
  | "LOCAL_HARDWARE_INFEASIBLE"
  | "LOCAL_PERFORMANCE_INSUFFICIENT"
  | "LOCAL_RUNTIME_UNVERIFIED"
  | "LOCAL_MODEL_MEETS_REQUIREMENTS"
  | "LOCAL_MODEL_INTELLIGENCE_GAP"
  | "CLOUD_CAPABILITY_REQUIRED"
  | "FRONTIER_CLOUD_REQUIRED"
  | "HIGH_LOCAL_COVERAGE"
  | "UTILIZATION_ABOVE_BREAK_EVEN"
  | "NO_ECONOMIC_BREAK_EVEN"
  | "LOCAL_ECONOMICS_UNFAVORABLE"
  | "LOCAL_LOWER_MONTHLY_COST"
  | "HYBRID_SAVES_VS_CLOUD"
  | "CLOUD_AVOIDS_CAPEX"
  | "REAL_TIME_NETWORK_LATENCY_PREFERENCE"
  | "INCOMPLETE_INPUTS"
  | "NO_CLOUD_OFFERING";

export interface ChangeCondition {
  target: Deployment;
  description: string;
  thresholdValue?: number;
  unit?: string;
}

export interface RecommendationResult {
  status: "recommended" | "tradeoff" | "constraint-conflict" | "incomplete";
  deployment: Deployment | null;
  matchedRuleId: string;
  reasonCodes: RecommendationReasonCode[];
  warnings: string[];
  changeConditions: ChangeCondition[];
}

export interface DeploymentComparison {
  deployment: Deployment;
  feasible: boolean;
  monthlyCostUSD: number | null;
  threeYearTcoUSD: number | null;
  costPerMillionTokensUSD: number | null;
  privacy: "highest" | "controlled" | "provider-dependent";
  latency: "local-path" | "mixed-path" | "network-dependent";
  scalability: "hardware-limited" | "elastic-with-local-base" | "elastic";
  intelligenceCeiling: CapabilityTierId;
  upfrontInvestmentUSD: number;
  warnings: string[];
}
