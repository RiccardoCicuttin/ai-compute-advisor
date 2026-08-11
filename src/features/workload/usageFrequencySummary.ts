import type { UsageFrequencyDefaults } from "../../types";

export interface UsageFrequencySummary {
  requestsPerUserPerWorkingDay: number;
  workingHoursPerDay: number;
  workingDaysPerMonth: number;
  monthlyRequestsPerUser: number;
}

export function summarizeUsageFrequency(
  definition: UsageFrequencyDefaults,
): UsageFrequencySummary {
  return {
    requestsPerUserPerWorkingDay:
      definition.requestsPerUserPerWorkingDay,
    workingHoursPerDay: definition.workingHoursPerDay,
    workingDaysPerMonth: definition.workingDaysPerMonth,
    monthlyRequestsPerUser:
      definition.requestsPerUserPerWorkingDay *
      definition.workingDaysPerMonth,
  };
}
