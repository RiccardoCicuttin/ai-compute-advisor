export type Deployment = "local" | "hybrid" | "cloud";
export type FitStatus = "cannot-run" | "marginal" | "recommended" | "comfortable";

export interface TraceValueView {
  label: string;
  value: string;
  source?: string;
}

export interface CalculationTraceView {
  id: string;
  title: string;
  result: string;
  formula: string;
  method: "measured" | "derived" | "estimated" | "unavailable";
  inputs: TraceValueView[];
  intermediates: TraceValueView[];
  warnings: string[];
  sourceIds: string[];
}

export interface DeploymentComparisonView {
  deployment: Deployment;
  feasible: boolean;
  monthlyCost: number | null;
  threeYearTco: number | null;
  costPerMillion: number | null;
  privacy: string;
  latency: string;
  scalability: string;
  intelligenceCeiling: string;
  upfrontInvestment: number | null;
}

export interface ModelComparisonView {
  id: string;
  name: string;
  provider: string;
  selected: boolean;
  recommended: boolean;
  intelligence: number | null;
  context: number | null;
  size: number | null;
  price: number | null;
  speed: number | null;
  latency: number | null;
}

export interface OpportunityPointView {
  utilization: number;
  capabilityTierId: string;
  method: string;
}

export interface OpportunityRegionView {
  id: string;
  deployment: Deployment | "constraint";
  x1: number;
  x2: number;
  capabilityTierId: string;
  label?: string;
}
