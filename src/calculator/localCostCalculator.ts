import type {
  AssumptionsRecord,
  EconomicsReadyComputeHardwareRecord,
  GpuCount,
  LocalCostResult,
  WorkloadConfig,
} from "../types";
import { assertRatio, safeCostPerMillion, trace, value } from "./trace";

export interface LocalCostInput {
  gpu: EconomicsReadyComputeHardwareRecord;
  gpuCount: GpuCount;
  workload: WorkloadConfig;
  locallyServedTokens: number;
  utilizationRatio: number;
  electricityPricePerKWh: number;
  hardwareLifetimeMonths: number;
  maintenanceCostMonthly: number;
  assumptions: AssumptionsRecord["economics"];
}

export function calculateLocalCost(input: LocalCostInput): LocalCostResult {
  assertRatio(input.utilizationRatio, "utilizationRatio");
  const operatingHours = input.workload.workingHoursPerDay * input.workload.workingDaysPerMonth;
  const hardwarePurchasePriceUSD =
    input.gpu.streetPriceUSD * input.gpuCount + input.assumptions.hostPurchasePriceUSD;
  const monthlyDepreciationUSD = hardwarePurchasePriceUSD / input.hardwareLifetimeMonths;

  const gpuIdleWatts =
    input.gpuCount * input.gpu.tdpWatts * input.assumptions.gpuIdlePowerRatio;
  const gpuDynamicWatts =
    input.gpuCount * input.gpu.tdpWatts * (1 - input.assumptions.gpuIdlePowerRatio);
  const hostDynamicWatts =
    input.assumptions.hostLoadPowerWatts - input.assumptions.hostIdlePowerWatts;
  const baseSystemPowerWatts = gpuIdleWatts + input.assumptions.hostIdlePowerWatts;
  const dynamicSystemPowerWatts = gpuDynamicWatts + hostDynamicWatts;
  const averageSystemPowerWatts =
    baseSystemPowerWatts + dynamicSystemPowerWatts * input.utilizationRatio;
  const monthlyBaseElectricityUSD =
    (baseSystemPowerWatts / 1000) * operatingHours * input.electricityPricePerKWh;
  const monthlyDynamicElectricityAtFullUtilizationUSD =
    (dynamicSystemPowerWatts / 1000) * operatingHours * input.electricityPricePerKWh;
  const monthlyElectricityUSD =
    monthlyBaseElectricityUSD +
    monthlyDynamicElectricityAtFullUtilizationUSD * input.utilizationRatio;
  const monthlyMaintenanceUSD = input.maintenanceCostMonthly;
  const monthlyOperatingCostUSD = monthlyElectricityUSD + monthlyMaintenanceUSD;
  const monthlyTcoUSD = monthlyDepreciationUSD + monthlyOperatingCostUSD;
  const costPerMillionTokensUSD = safeCostPerMillion(monthlyTcoUSD, input.locallyServedTokens);
  const hardwarePurchases = Math.ceil(36 / input.hardwareLifetimeMonths);
  const threeYearTcoUSD =
    hardwarePurchasePriceUSD * hardwarePurchases + 36 * monthlyOperatingCostUSD;

  return {
    hardwarePurchasePriceUSD,
    monthlyDepreciationUSD,
    averageSystemPowerWatts,
    monthlyBaseElectricityUSD,
    monthlyDynamicElectricityAtFullUtilizationUSD,
    monthlyElectricityUSD,
    monthlyMaintenanceUSD,
    monthlyOperatingCostUSD,
    monthlyTcoUSD,
    costPerMillionTokensUSD,
    threeYearTcoUSD,
    trace: trace({
      id: "local-cost",
      title: "Local monthly TCO",
      formula: "Hardware depreciation + estimated electricity + maintenance",
      inputs: [
        value("purchasePrice", "Hardware purchase price", hardwarePurchasePriceUSD, "USD", "gpu-data"),
        value("lifetime", "Hardware lifetime", input.hardwareLifetimeMonths, "months", "user"),
        value("utilization", "Hardware utilization", input.utilizationRatio, "ratio", "user"),
        value("operatingHours", "Operating hours", operatingHours, "hours", "user"),
      ],
      intermediateValues: [
        value("depreciation", "Monthly depreciation", monthlyDepreciationUSD, "USD/month", "derived"),
        value("power", "Average system power", averageSystemPowerWatts, "watts", "derived"),
        value("electricity", "Monthly electricity", monthlyElectricityUSD, "USD/month", "derived"),
        value("maintenance", "Monthly maintenance", monthlyMaintenanceUSD, "USD/month", "user"),
      ],
      result: value("monthlyTco", "Local monthly TCO", monthlyTcoUSD, "USD/month", "derived"),
      method: "estimated",
      warnings: ["Power cost is directional and depends on actual system idle and load behavior."],
      sourceIds: [input.gpu.id],
    }),
  };
}
