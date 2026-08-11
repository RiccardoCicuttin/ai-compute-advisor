import { describe, expect, it } from "vitest";
import assumptionsCatalog from "../../../public/data/assumptions.json";
import type { UsageFrequencyDefaults } from "../../types";
import { summarizeUsageFrequency } from "./usageFrequencySummary";

describe("usage-frequency explanations", () => {
  it("derives the bundled daily and always-on monthly request starting points", () => {
    const assumptions = assumptionsCatalog.data[0]!;

    expect(
      summarizeUsageFrequency(
        assumptions.simpleModeMappings.usageFrequency
          .daily as UsageFrequencyDefaults,
      ),
    ).toEqual({
      requestsPerUserPerWorkingDay: 12,
      workingHoursPerDay: 8,
      workingDaysPerMonth: 22,
      monthlyRequestsPerUser: 264,
    });

    expect(
      summarizeUsageFrequency(
        assumptions.simpleModeMappings.usageFrequency[
          "always-on"
        ] as UsageFrequencyDefaults,
      ).monthlyRequestsPerUser,
    ).toBe(3_000);
  });

  it("works for a custom Data Pack frequency instead of relying on known IDs", () => {
    expect(
      summarizeUsageFrequency({
        labels: { en: "Field shifts", "zh-CN": "现场班次" },
        requestsPerUserPerWorkingDay: 7.5,
        workingHoursPerDay: 6,
        workingDaysPerMonth: 18,
      }),
    ).toEqual({
      requestsPerUserPerWorkingDay: 7.5,
      workingHoursPerDay: 6,
      workingDaysPerMonth: 18,
      monthlyRequestsPerUser: 135,
    });
  });
});
