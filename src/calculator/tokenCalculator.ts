import type { AssumptionsRecord, TokenDemandResult, WorkloadConfig } from "../types";
import { assertFiniteNonNegative, trace, value } from "./trace";

export function resolveSimpleWorkload(
  workload: WorkloadConfig,
  assumptions: AssumptionsRecord,
): WorkloadConfig {
  if (workload.mode !== "simple") return { ...workload };

  const useCaseDefaults = assumptions.simpleModeMappings.useCases[workload.useCase];
  const frequencyDefaults = assumptions.simpleModeMappings.usageFrequency[workload.usageFrequency];
  if (!useCaseDefaults || !frequencyDefaults) {
    throw new Error(`Missing Simple Mode mapping for ${workload.useCase}/${workload.usageFrequency}`);
  }

  const monthlyRequests = Math.round(
    workload.users *
      frequencyDefaults.requestsPerUserPerWorkingDay *
      frequencyDefaults.workingDaysPerMonth,
  );

  return {
    ...workload,
    monthlyRequests,
    averageInputTokens: useCaseDefaults.averageInputTokens,
    averageOutputTokens: useCaseDefaults.averageOutputTokens,
    averageAgentSteps: useCaseDefaults.averageAgentSteps,
    peakConcurrentUsers: Math.max(
      1,
      Math.ceil(workload.users * useCaseDefaults.peakConcurrentUsersRatio),
    ),
    averageContextLength: useCaseDefaults.averageContextLength,
    peakContextLength: useCaseDefaults.peakContextLength,
    workingHoursPerDay: frequencyDefaults.workingHoursPerDay,
    workingDaysPerMonth: frequencyDefaults.workingDaysPerMonth,
  };
}

export function calculateTokenDemand(workload: WorkloadConfig): TokenDemandResult {
  assertFiniteNonNegative(workload.monthlyRequests, "monthlyRequests");
  assertFiniteNonNegative(workload.averageInputTokens, "averageInputTokens");
  assertFiniteNonNegative(workload.averageOutputTokens, "averageOutputTokens");
  assertFiniteNonNegative(workload.averageAgentSteps, "averageAgentSteps");

  const monthlyInputTokens =
    workload.monthlyRequests * workload.averageAgentSteps * workload.averageInputTokens;
  const monthlyOutputTokens =
    workload.monthlyRequests * workload.averageAgentSteps * workload.averageOutputTokens;
  const monthlyTotalTokens = monthlyInputTokens + monthlyOutputTokens;

  if (
    !Number.isSafeInteger(monthlyInputTokens) ||
    !Number.isSafeInteger(monthlyOutputTokens) ||
    !Number.isSafeInteger(monthlyTotalTokens)
  ) {
    throw new RangeError("Calculated token demand exceeds JavaScript's safe integer range");
  }

  return {
    monthlyInputTokens,
    monthlyOutputTokens,
    monthlyTotalTokens,
    monthlyRequests: workload.monthlyRequests,
    trace: trace({
      id: "token-demand",
      title: "Monthly token demand",
      formula:
        "Requests × agent steps × input tokens + Requests × agent steps × output tokens",
      inputs: [
        value("monthlyRequests", "Monthly requests", workload.monthlyRequests, "tokens/month", "user"),
        value("agentSteps", "Average agent steps", workload.averageAgentSteps, "ratio", "user"),
        value("inputPerStep", "Input tokens per step", workload.averageInputTokens, "tokens", "user"),
        value("outputPerStep", "Output tokens per step", workload.averageOutputTokens, "tokens", "user"),
      ],
      intermediateValues: [
        value("monthlyInput", "Monthly input tokens", monthlyInputTokens, "tokens/month", "derived"),
        value("monthlyOutput", "Monthly output tokens", monthlyOutputTokens, "tokens/month", "derived"),
      ],
      result: value("monthlyTotal", "Monthly total tokens", monthlyTotalTokens, "tokens/month", "derived"),
      method: "derived",
      warnings: [],
      sourceIds: [],
    }),
  };
}
