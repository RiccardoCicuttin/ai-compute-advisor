import { describe, expect, it } from "vitest";
import exchangeRatesJson from "../../public/data/exchange-rates.json";
import { AdvisorConfigSchema, AssumptionsRecordSchema } from "../data/schemas";
import { ExchangeRateCatalogSchema } from "../currency";
import type { AdvisorConfig, PresetRecord } from "../types";
import {
  applyWorkloadPatch,
  applyPresetToConfig,
  resolveWorkloadDefaults,
} from "./defaultAdvisorConfig";
import { decodeAdvisorUrl, encodeAdvisorConfig } from "./urlState";
import { reconcileAdvisorCurrency } from "./useAdvisorState";
import { createDefaultCustomSystemDraft } from "./customSystemDraft";

const assumptions = AssumptionsRecordSchema.parse({
  currency: "USD",
  economics: {
    electricityPricePerKWh: 0.15,
    hardwareLifetimeMonths: 36,
    maintenanceCostMonthly: 75,
    defaultUtilizationRatio: 0.45,
    defaultCachedInputRatio: 0.1,
    hostPurchasePriceUSD: 2_500,
    hostIdlePowerWatts: 80,
    hostLoadPowerWatts: 250,
    gpuIdlePowerRatio: 0.15,
  },
  vram: {
    defaultRuntimeOverheadRatio: 0.1,
    minimumRuntimeOverheadGB: 2,
    safetyMarginRatio: 0.15,
    fallbackKvCacheBytesPerTokenByClass: {
      basic: 1,
      balanced: 1,
      advanced: 1,
      frontier: 1,
    },
    fitThresholds: {
      marginalCapacityRatio: 0.85,
      recommendedCapacityRatio: 1,
      comfortableCapacityRatio: 1.25,
    },
  },
  multiGpuEfficiency: {
    pcie: { 1: 1, 2: 0.8, 4: 0.6 },
    nvlink: { 1: 1, 2: 0.9, 4: 0.8 },
    unified: { 1: 1, 2: 0.9, 4: 0.8 },
    other: { 1: 1, 2: 0.7, 4: 0.5 },
  },
  simpleModeMappings: {
    useCases: {
      "ai-assistant": {
        averageInputTokens: 900,
        averageOutputTokens: 350,
        averageAgentSteps: 1,
        peakConcurrentUsersRatio: 0.2,
        averageContextLength: 4_096,
        peakContextLength: 8_192,
      },
      "enterprise-agent": {
        averageInputTokens: 1_800,
        averageOutputTokens: 650,
        averageAgentSteps: 4,
        peakConcurrentUsersRatio: 0.35,
        averageContextLength: 8_192,
        peakContextLength: 16_384,
      },
    },
    usageFrequency: {
      daily: {
        requestsPerUserPerWorkingDay: 12,
        workingHoursPerDay: 8,
        workingDaysPerMonth: 22,
      },
      heavy: {
        requestsPerUserPerWorkingDay: 40,
        workingHoursPerDay: 10,
        workingDaysPerMonth: 22,
      },
    },
    intelligence: {
      basic: { startingClass: "basic" },
      balanced: { startingClass: "balanced" },
      advanced: { startingClass: "advanced" },
      frontier: { startingClass: "frontier" },
    },
  },
  recommendation: {
    lowUtilizationRatio: 0.25,
    highUtilizationRatio: 0.6,
    maximumPreferredBreakEvenMonths: 24,
    highPrivacyLevels: ["high", "critical"],
    minimumHybridLocalCoverageRatio: 0.5,
    minimumMeaningfulSavingsRatio: 0.1,
    costTieToleranceRatio: 0.05,
  },
});

const defaultConfig: AdvisorConfig = {
  stateVersion: 1,
  analysisMode: "workload-first",
  presetId: "personal-ai-assistant",
  workload: resolveWorkloadDefaults(
    {
      mode: "simple",
      useCase: "ai-assistant",
      usageFrequency: "daily",
      users: 1,
      privacyRequirement: "medium",
      capabilityRequirementTierId: "balanced",
      latencyRequirement: "interactive",
    },
    assumptions,
  ),
  modelSelection: { mode: "recommended" },
  hardwareSelection: { mode: "recommended", gpuCount: 1 },
  economics: {
    displayCurrency: "USD",
    hardwareUtilizationRatio: 0.45,
    localCoverageRatio: 0.85,
    cachedInputRatio: 0.1,
    electricityPricePerKWh: 0.15,
    hardwareLifetimeMonths: 36,
    maintenanceCostMonthly: 75,
  },
};
const bundledExchangeRates = ExchangeRateCatalogSchema.parse(exchangeRatesJson);

describe("advisor URL and preset state", () => {
  it("migrates legacy state fields and defaults analysis mode", () => {
    const { analysisMode: _analysisMode, ...legacyConfig } = defaultConfig;
    const { capabilityRequirementTierId, ...legacyWorkload } = legacyConfig.workload;
    const parsed = AdvisorConfigSchema.parse({
      ...legacyConfig,
      workload: {
        ...legacyWorkload,
        intelligenceRequirement: capabilityRequirementTierId,
      },
    });

    expect(parsed.analysisMode).toBe("workload-first");
    expect(parsed.workload.capabilityRequirementTierId).toBe(capabilityRequirementTierId);
  });

  it("rebuilds derived workload fields when a Simple preset changes", () => {
    const preset: PresetRecord = {
      id: "smb-agent-10",
      name: { en: "10-person SMB AI Agent", "zh-CN": "10 人中小企业 AI 智能体" },
      description: { en: "Test preset", "zh-CN": "测试预设" },
      workload: {
        mode: "simple",
        useCase: "enterprise-agent",
        usageFrequency: "daily",
        users: 10,
        privacyRequirement: "high",
        capabilityRequirementTierId: "balanced",
        latencyRequirement: "interactive",
      },
      suggestedLocalCoverageRatio: 0.8,
    };

    const result = applyPresetToConfig(defaultConfig, preset, assumptions);
    expect(result.workload.monthlyRequests).toBe(2_640);
    expect(result.workload.averageInputTokens).toBe(1_800);
    expect(result.workload.averageAgentSteps).toBe(4);
    expect(result.workload.peakConcurrentUsers).toBe(4);
  });

  it("round-trips every normalized Simple workload field", () => {
    const config: AdvisorConfig = {
      ...defaultConfig,
      presetId: "smb-agent-10",
      workload: resolveWorkloadDefaults(
        {
          mode: "simple",
          useCase: "enterprise-agent",
          usageFrequency: "heavy",
          users: 10,
          privacyRequirement: "high",
          capabilityRequirementTierId: "advanced",
          latencyRequirement: "fast",
        },
        assumptions,
      ),
    };

    const encoded = encodeAdvisorConfig(config, "test-data");
    const decoded = decodeAdvisorUrl(encoded, defaultConfig, assumptions);
    expect(decoded.config).toEqual(config);
    expect(decoded.dataVersion).toBe("test-data");
    expect(decoded.issues).toEqual([]);
  });

  it("round-trips display currency, manual rates and an in-progress desktop system", () => {
    const config: AdvisorConfig = {
      ...defaultConfig,
      hardwareSelection: {
        mode: "system",
        gpuCount: 1,
        systemInputMode: "custom",
        customSystem: {
          name: "Sales demo workstation",
          memoryArchitecture: "unified",
          systemMemoryType: "LPDDR5X",
          systemRamGB: 128,
          acceleratorType: "Demo inference engine",
          acceleratorBehaviorCategory: "npu",
          acceleratorName: "Demo NPU",
          acceleratorCount: 1,
          supportsModelSharding: false,
          dedicatedMemoryPerUnitGB: null,
          allocatableUnifiedMemoryGB: 96,
          memoryBandwidthGBps: 240,
          idlePowerWatts: 30,
          loadPowerWatts: 180,
          purchasePriceUSD: 3200,
          tops: 60,
          topsPrecision: "INT8-optimized",
          effectiveTokensPerSecond: null,
          timeToFirstTokenSeconds: null,
          runtimeSupportStatus: "experimental",
          runtimeSupportMethod: "vendor-documented",
          runtimeNames: "ONNX Runtime",
          performanceModelId: null,
          performanceQuantizationId: null,
          performanceContextTokens: null,
          performanceConcurrency: null,
        },
      },
      economics: {
        ...defaultConfig.economics,
        displayCurrency: "CNY",
        manualExchangeRateOverride: { EUR: 0.9, CNY: 7.1 },
      },
    };

    const decoded = decodeAdvisorUrl(
      encodeAdvisorConfig(config, "test-data"),
      defaultConfig,
      assumptions,
    );
    expect(decoded.config).toEqual(config);
    expect(decoded.issues).toEqual([]);
  });

  it("migrates legacy custom-system URL accelerator categories and TOPS precision", () => {
    const decoded = decodeAdvisorUrl(
      "?v=1&hardwareMode=system&systemInput=custom&accelType=npu&tops=60",
      defaultConfig,
      assumptions,
    );

    expect(decoded.config?.hardwareSelection.customSystem).toMatchObject({
      acceleratorType: "NPU",
      acceleratorBehaviorCategory: "npu",
      tops: 60,
      topsPrecision: "mixed",
    });
    expect(decoded.issues).toEqual([]);
  });

  it("migrates legacy persisted custom-system drafts during schema parsing", () => {
    const legacyCustom = {
      ...createDefaultCustomSystemDraft(),
      acceleratorType: "ai-accelerator",
    } as Record<string, unknown>;
    delete legacyCustom.acceleratorBehaviorCategory;
    delete legacyCustom.topsPrecision;
    const legacy = {
      ...defaultConfig,
      hardwareSelection: {
        mode: "system",
        gpuCount: 1,
        systemInputMode: "custom",
        customSystem: legacyCustom,
      },
    };

    expect(
      AdvisorConfigSchema.parse(legacy).hardwareSelection.customSystem,
    ).toMatchObject({
      acceleratorType: "AI accelerator",
      acceleratorBehaviorCategory: "ai-accelerator",
      topsPrecision: "mixed",
    });
  });

  it("round-trips a Data Pack-defined display currency and generic manual rate", () => {
    const config: AdvisorConfig = {
      ...defaultConfig,
      economics: {
        ...defaultConfig.economics,
        displayCurrency: "JPY",
        manualExchangeRateOverride: { EUR: 0.9, JPY: 151.25 },
      },
    };

    const encoded = encodeAdvisorConfig(config, "jpy-data-pack");
    expect(encoded.get("currency")).toBe("JPY");
    expect(encoded.get("fx")).toBe("EUR:0.9,JPY:151.25");

    const decoded = decodeAdvisorUrl(encoded, defaultConfig, assumptions);
    expect(decoded.config).toEqual(config);
    expect(decoded.issues).toEqual([]);
  });

  it("round-trips configuration-first analysis mode and dynamic IDs/counts", () => {
    const config: AdvisorConfig = {
      ...defaultConfig,
      analysisMode: "configuration-first",
      workload: {
        ...defaultConfig.workload,
        useCase: "custom-pack.use-case",
        usageFrequency: "custom-pack.frequency",
        capabilityRequirementTierId: "custom-pack.tier",
      },
      hardwareSelection: {
        mode: "existing",
        gpuId: "custom-gpu",
        gpuCount: 8,
      },
    };
    const decoded = decodeAdvisorUrl(
      encodeAdvisorConfig(config, "dynamic-pack"),
      defaultConfig,
    );

    expect(decoded.config).toEqual(config);
    expect(decoded.issues).toEqual([]);
  });

  it("falls back a valid JPY URL to USD when the active catalog is bundled-only", () => {
    const encoded = encodeAdvisorConfig(
      {
        ...defaultConfig,
        economics: {
          ...defaultConfig.economics,
          displayCurrency: "JPY",
          manualExchangeRateOverride: { EUR: 0.9, JPY: 151.25 },
        },
      },
      "jpy-data-pack",
    );
    const decoded = decodeAdvisorUrl(encoded, defaultConfig, assumptions);
    const reconciled = reconcileAdvisorCurrency(
      decoded.config!,
      bundledExchangeRates,
      "url",
    );

    expect(reconciled.config.economics.displayCurrency).toBe("USD");
    expect(reconciled.config.economics.manualExchangeRateOverride).toEqual({
      EUR: 0.9,
    });
    expect(reconciled.issues.map((issue) => issue.code)).toEqual([
      "currency-not-in-catalog",
      "exchange-rate-override-not-in-catalog",
    ]);
  });

  it("preserves normalized workload values after Advanced switches to Simple", () => {
    const config: AdvisorConfig = {
      ...defaultConfig,
      workload: {
        ...defaultConfig.workload,
        mode: "simple",
        monthlyRequests: 9_999,
        averageInputTokens: 7_777,
        averageOutputTokens: 888,
        averageAgentSteps: 3,
        peakConcurrentUsers: 7,
        averageContextLength: 12_000,
        peakContextLength: 24_000,
        workingHoursPerDay: 9,
        workingDaysPerMonth: 21,
      },
    };

    const decoded = decodeAdvisorUrl(
      encodeAdvisorConfig(config, "test-data"),
      defaultConfig,
      assumptions,
    );

    expect(decoded.config?.workload).toEqual(config.workload);
    expect(decoded.issues).toEqual([]);
  });

  it("scales current per-user workload values when only users change", () => {
    const current = {
      ...defaultConfig.workload,
      monthlyRequests: 777,
      peakConcurrentUsers: 3,
      averageInputTokens: 12_345,
    };
    const result = applyWorkloadPatch(current, { users: 2 }, assumptions);

    expect(result.monthlyRequests).toBe(1_554);
    expect(result.peakConcurrentUsers).toBe(6);
    expect(result.averageInputTokens).toBe(12_345);
  });

  it("lets explicit numeric values win after template driver changes", () => {
    const result = applyWorkloadPatch(
      defaultConfig.workload,
      {
        useCase: "enterprise-agent",
        usageFrequency: "heavy",
        users: 3,
        averageInputTokens: 321,
        monthlyRequests: 654,
        peakConcurrentUsers: 2,
      },
      assumptions,
    );

    expect(result.averageInputTokens).toBe(321);
    expect(result.monthlyRequests).toBe(654);
    expect(result.peakConcurrentUsers).toBe(2);
    expect(result.workingHoursPerDay).toBe(10);
  });
});
