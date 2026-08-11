import type {
  BreakEvenResult,
  CloudCostResult,
  LocalCostResult,
  PerformanceResult,
} from "../types";
import { trace, value } from "./trace";

export function calculateBreakEven(input: {
  local: LocalCostResult;
  cloud: CloudCostResult;
  performance: PerformanceResult | null;
  hardwareLifetimeMonths: number;
}): BreakEvenResult {
  const monthlyCashSavings =
    input.cloud.monthlyCostUSD - input.local.monthlyOperatingCostUSD;
  const breakEvenMonths =
    monthlyCashSavings > 0
      ? input.local.hardwarePurchasePriceUSD / monthlyCashSavings
      : null;

  const month: BreakEvenResult["month"] = breakEvenMonths === null
    ? {
        status: "none",
        months: null,
        withinHardwareLifetime: null,
        reason: "NON_POSITIVE_MONTHLY_SAVING",
      }
    : {
        status: "available",
        months: breakEvenMonths,
        withinHardwareLifetime: breakEvenMonths <= input.hardwareLifetimeMonths,
      };

  let requiredUtilization: BreakEvenResult["requiredUtilization"];
  const capacity = input.performance?.monthlyTokenCapacity ?? null;
  const cloudUnitCost = input.cloud.costPerMillionTokensUSD;
  if (capacity === null || cloudUnitCost === null) {
    requiredUtilization = {
      status: "unavailable",
      ratio: null,
      reason: "PERFORMANCE_CAPACITY_UNAVAILABLE",
    };
  } else {
    const cloudCostSlope = (capacity / 1_000_000) * cloudUnitCost;
    const fixedLocalMonthlyCost =
      input.local.monthlyDepreciationUSD +
      input.local.monthlyMaintenanceUSD +
      input.local.monthlyBaseElectricityUSD;
    const denominator =
      cloudCostSlope - input.local.monthlyDynamicElectricityAtFullUtilizationUSD;
    const ratio = denominator > 0 ? fixedLocalMonthlyCost / denominator : null;
    if (ratio === null) {
      requiredUtilization = {
        status: "none",
        ratio: null,
        reason: "LOCAL_VARIABLE_COST_EXCEEDS_CLOUD",
      };
    } else if (ratio > 1) {
      requiredUtilization = { status: "none", ratio: null, reason: "ABOVE_100_PERCENT" };
    } else {
      requiredUtilization = { status: "available", ratio };
    }
  }

  return {
    month,
    requiredUtilization,
    traces: [
      trace({
        id: "cash-break-even",
        title: "Local vs cloud break-even",
        formula: "Hardware purchase price ÷ (cloud cost avoided − local cash operating cost)",
        inputs: [
          value("capex", "Hardware purchase price", input.local.hardwarePurchasePriceUSD, "USD", "gpu-data"),
          value("cloud", "Cloud monthly cost avoided", input.cloud.monthlyCostUSD, "USD/month", "derived"),
          value("localOpex", "Local cash operating cost", input.local.monthlyOperatingCostUSD, "USD/month", "derived"),
        ],
        intermediateValues: [
          value("monthlySavings", "Monthly cash savings", monthlyCashSavings, "USD/month", "derived"),
        ],
        result: value("breakEven", "Break-even month", breakEvenMonths, "months", "derived"),
        method: "derived",
        warnings: breakEvenMonths === null ? ["No economic break-even under current assumptions."] : [],
        sourceIds: [],
      }),
      trace({
        id: "required-utilization",
        title: "Required utilization for local parity",
        formula: "Fixed monthly local cost ÷ (cloud cost slope − local energy slope)",
        inputs: [],
        intermediateValues: [],
        result: value("requiredUtilization", "Required utilization", requiredUtilization.ratio, "ratio", "derived"),
        method: requiredUtilization.status === "unavailable" ? "unavailable" : "derived",
        warnings: requiredUtilization.status === "available" ? [] : [requiredUtilization.reason ?? "Unavailable"],
        sourceIds: input.performance?.profileId ? [input.performance.profileId] : [],
      }),
    ],
  };
}
