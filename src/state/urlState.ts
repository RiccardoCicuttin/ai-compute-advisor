import { AdvisorConfigSchema } from "../data/schemas";
import { CurrencyCodeSchema } from "../currency";
import type { AdvisorConfig, AssumptionsRecord } from "../types";
import { resolveWorkloadDefaults } from "./defaultAdvisorConfig";
import { createDefaultCustomSystemDraft } from "./customSystemDraft";

export interface UrlStateIssue {
  source: "url";
  key?: string;
  code: "unsupported-version" | "invalid-value" | "invalid-config";
  message: string;
  value?: string;
}

export interface DecodedAdvisorUrl {
  config: AdvisorConfig | null;
  dataVersion?: string;
  hasScenarioState: boolean;
  issues: UrlStateIssue[];
}

export const URL_STATE_VERSION = 1;

const SCENARIO_KEYS = new Set([
  "preset",
  "analysisMode",
  "mode",
  "case",
  "freq",
  "users",
  "privacy",
  "intel",
  "latency",
  "requests",
  "input",
  "output",
  "steps",
  "peakUsers",
  "averageContext",
  "peakContext",
  "hours",
  "days",
  "model",
  "quant",
  "modelMode",
  "gpu",
  "count",
  "hardwareMode",
  "util",
  "coverage",
  "cloud",
  "cache",
  "electricity",
  "lifetime",
  "maintenance",
  "customInput",
  "customOutput",
  "customCached",
  "currency",
  "fx",
  "eurRate",
  "cnyRate",
  "systemInput",
  "system",
  "systemName",
  "memArch",
  "memType",
  "ram",
  "accelType",
  "accelCategory",
  "accelName",
  "accelCount",
  "sharding",
  "dedicatedMem",
  "unifiedMem",
  "bandwidth",
  "idleWatts",
  "loadWatts",
  "systemPrice",
  "tops",
  "topsPrecision",
  "systemTps",
  "systemTtft",
  "runtimeStatus",
  "runtimeMethod",
  "runtimes",
  "perfModel",
  "perfQuant",
  "perfContext",
  "perfConcurrency",
]);

function cloneConfig(config: AdvisorConfig): AdvisorConfig {
  return {
    ...config,
    workload: { ...config.workload },
    modelSelection: { ...config.modelSelection },
    hardwareSelection: {
      ...config.hardwareSelection,
      ...(config.hardwareSelection.customSystem
        ? { customSystem: { ...config.hardwareSelection.customSystem } }
        : {}),
    },
    economics: {
      ...config.economics,
      ...(config.economics.manualExchangeRateOverride
        ? {
            manualExchangeRateOverride: {
              ...config.economics.manualExchangeRateOverride,
            },
          }
        : {}),
      ...(config.economics.customCloudPricing
        ? { customCloudPricing: { ...config.economics.customCloudPricing } }
        : {}),
    },
  };
}

function parseNumber(
  params: URLSearchParams,
  key: string,
  issues: UrlStateIssue[],
  options: { integer?: boolean; min?: number; max?: number } = {},
): number | undefined {
  const raw = params.get(key);
  if (raw === null) return undefined;

  const value = Number(raw);
  const invalid =
    raw.trim() === "" ||
    !Number.isFinite(value) ||
    (options.integer === true && !Number.isInteger(value)) ||
    (options.min !== undefined && value < options.min) ||
    (options.max !== undefined && value > options.max);

  if (invalid) {
    issues.push({
      source: "url",
      key,
      code: "invalid-value",
      value: raw,
      message: `Ignored invalid URL value for '${key}'.`,
    });
    return undefined;
  }

  return value;
}

function parseNullableNumber(
  params: URLSearchParams,
  key: string,
  issues: UrlStateIssue[],
  options: { integer?: boolean; min?: number; max?: number } = {},
): number | null | undefined {
  const raw = params.get(key);
  if (raw === null) return undefined;
  if (raw.trim() === "") return null;
  return parseNumber(params, key, issues, options);
}

function parseEnum<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
  issues: UrlStateIssue[],
): T | undefined {
  const raw = params.get(key);
  if (raw === null) return undefined;
  if (allowed.includes(raw as T)) return raw as T;

  issues.push({
    source: "url",
    key,
    code: "invalid-value",
    value: raw,
    message: `Ignored invalid URL value for '${key}'.`,
  });
  return undefined;
}

function parseCurrencyCode(
  params: URLSearchParams,
  key: string,
  issues: UrlStateIssue[],
): string | undefined {
  const raw = params.get(key);
  if (raw === null) return undefined;
  const parsed = CurrencyCodeSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  issues.push({
    source: "url",
    key,
    code: "invalid-value",
    value: raw,
    message: `Ignored invalid URL value for '${key}'.`,
  });
  return undefined;
}

function parseDataPackId(
  params: URLSearchParams,
  key: string,
  issues: UrlStateIssue[],
): string | undefined {
  const raw = params.get(key);
  if (raw === null) return undefined;
  if (/^[a-z0-9][a-z0-9._-]*$/.test(raw)) return raw;
  issues.push({
    source: "url",
    key,
    code: "invalid-value",
    value: raw,
    message: `Ignored invalid URL value for '${key}'.`,
  });
  return undefined;
}

function parseExchangeRateOverrides(
  raw: string,
  issues: UrlStateIssue[],
): Record<string, number> {
  const overrides: Record<string, number> = {};
  if (raw.trim() === "") return overrides;

  for (const entry of raw.split(",")) {
    const separator = entry.indexOf(":");
    const code = separator >= 0 ? entry.slice(0, separator) : "";
    const rateText = separator >= 0 ? entry.slice(separator + 1) : "";
    const parsedCode = CurrencyCodeSchema.safeParse(code);
    const rate = Number(rateText);
    if (
      !parsedCode.success ||
      rateText.trim() === "" ||
      !Number.isFinite(rate) ||
      rate <= 0
    ) {
      issues.push({
        source: "url",
        key: "fx",
        code: "invalid-value",
        value: entry,
        message: `Ignored invalid URL exchange-rate override '${entry}'.`,
      });
      continue;
    }
    overrides[parsedCode.data] = rate;
  }
  return overrides;
}

function setString(
  params: URLSearchParams,
  key: string,
): string | undefined {
  const value = params.get(key)?.trim();
  return value ? value : undefined;
}

function resetInvalidPaths(
  candidate: AdvisorConfig,
  defaults: AdvisorConfig,
  issues: ReturnType<typeof AdvisorConfigSchema.safeParse> extends infer _T
    ? Array<{ path: PropertyKey[]; message: string }>
    : never,
  urlIssues: UrlStateIssue[],
): void {
  for (const issue of issues) {
    const [section, field] = issue.path;
    if (section === "workload" && typeof field === "string") {
      const target = candidate.workload as unknown as Record<string, unknown>;
      const source = defaults.workload as unknown as Record<string, unknown>;
      target[field] = source[field];
    } else if (section === "modelSelection" && typeof field === "string") {
      const target = candidate.modelSelection as unknown as Record<string, unknown>;
      const source = defaults.modelSelection as unknown as Record<string, unknown>;
      if (source[field] === undefined) delete target[field];
      else target[field] = source[field];
    } else if (
      section === "hardwareSelection" &&
      typeof field === "string"
    ) {
      const target = candidate.hardwareSelection as unknown as Record<
        string,
        unknown
      >;
      const source = defaults.hardwareSelection as unknown as Record<
        string,
        unknown
      >;
      if (source[field] === undefined) delete target[field];
      else target[field] = source[field];
    } else if (section === "economics" && typeof field === "string") {
      const target = candidate.economics as unknown as Record<string, unknown>;
      const source = defaults.economics as unknown as Record<string, unknown>;
      if (source[field] === undefined) delete target[field];
      else target[field] = source[field];
    } else if (section === "presetId") {
      candidate.presetId = defaults.presetId;
    }

    urlIssues.push({
      source: "url",
      code: "invalid-config",
      key: issue.path.map(String).join("."),
      message: `Ignored URL state that produced an invalid configuration: ${issue.message}`,
    });
  }
}

export function decodeAdvisorUrl(
  search: string | URLSearchParams,
  defaults: AdvisorConfig,
  assumptions?: AssumptionsRecord,
): DecodedAdvisorUrl {
  const params =
    typeof search === "string"
      ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
      : new URLSearchParams(search);
  const issues: UrlStateIssue[] = [];
  const hasScenarioState = [...SCENARIO_KEYS].some((key) => params.has(key));
  const dataVersion = setString(params, "dv");

  if (!hasScenarioState) {
    return { config: null, dataVersion, hasScenarioState: false, issues };
  }

  const rawVersion = params.get("v");
  if (rawVersion !== null && rawVersion !== String(URL_STATE_VERSION)) {
    issues.push({
      source: "url",
      key: "v",
      code: "unsupported-version",
      value: rawVersion,
      message: `URL state version '${rawVersion}' is not supported.`,
    });
    return { config: null, dataVersion, hasScenarioState: true, issues };
  }

  const candidate = cloneConfig(AdvisorConfigSchema.parse(defaults));
  const workload = candidate.workload;
  const economics = candidate.economics;

  const presetId = setString(params, "preset");
  if (presetId) candidate.presetId = presetId;
  candidate.analysisMode =
    parseEnum(
      params,
      "analysisMode",
      ["workload-first", "configuration-first"],
      issues,
    ) ?? candidate.analysisMode;

  workload.mode =
    parseEnum(params, "mode", ["simple", "advanced"], issues) ??
    workload.mode;
  workload.useCase = parseDataPackId(params, "case", issues) ?? workload.useCase;
  workload.usageFrequency =
    parseDataPackId(params, "freq", issues) ?? workload.usageFrequency;
  workload.privacyRequirement =
    parseEnum(
      params,
      "privacy",
      ["low", "medium", "high", "critical"],
      issues,
    ) ?? workload.privacyRequirement;
  workload.capabilityRequirementTierId =
    parseDataPackId(params, "intel", issues) ?? workload.capabilityRequirementTierId;
  workload.latencyRequirement =
    parseEnum(
      params,
      "latency",
      ["best-effort", "interactive", "fast", "real-time"],
      issues,
    ) ?? workload.latencyRequirement;

  workload.users =
    parseNumber(params, "users", issues, { integer: true, min: 1 }) ??
    workload.users;
  workload.monthlyRequests =
    parseNumber(params, "requests", issues, { integer: true, min: 0 }) ??
    workload.monthlyRequests;
  workload.averageInputTokens =
    parseNumber(params, "input", issues, { min: 0 }) ??
    workload.averageInputTokens;
  workload.averageOutputTokens =
    parseNumber(params, "output", issues, { min: 0 }) ??
    workload.averageOutputTokens;
  workload.averageAgentSteps =
    parseNumber(params, "steps", issues, { min: Number.EPSILON }) ??
    workload.averageAgentSteps;
  workload.peakConcurrentUsers =
    parseNumber(params, "peakUsers", issues, { integer: true, min: 1 }) ??
    workload.peakConcurrentUsers;
  workload.averageContextLength =
    parseNumber(params, "averageContext", issues, {
      integer: true,
      min: 1,
    }) ?? workload.averageContextLength;
  workload.peakContextLength =
    parseNumber(params, "peakContext", issues, {
      integer: true,
      min: 1,
    }) ?? workload.peakContextLength;
  workload.workingHoursPerDay =
    parseNumber(params, "hours", issues, {
      min: Number.EPSILON,
      max: 24,
    }) ?? workload.workingHoursPerDay;
  workload.workingDaysPerMonth =
    parseNumber(params, "days", issues, {
      min: Number.EPSILON,
      max: 31,
    }) ?? workload.workingDaysPerMonth;

  const modelId = setString(params, "model");
  const quantizationId = setString(params, "quant");
  candidate.modelSelection.mode =
    parseEnum(
      params,
      "modelMode",
      ["recommended", "manual"],
      issues,
    ) ?? (modelId ? "manual" : candidate.modelSelection.mode);
  if (modelId) candidate.modelSelection.modelId = modelId;
  if (quantizationId) candidate.modelSelection.quantizationId = quantizationId;

  const gpuId = setString(params, "gpu");
  candidate.hardwareSelection.mode =
    parseEnum(
      params,
      "hardwareMode",
      ["existing", "recommended", "system"],
      issues,
    ) ?? (gpuId ? "existing" : candidate.hardwareSelection.mode);
  if (gpuId) candidate.hardwareSelection.gpuId = gpuId;
  const gpuCount = parseNumber(params, "count", issues, {
    integer: true,
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
  });
  if (gpuCount !== undefined) {
    candidate.hardwareSelection.gpuCount = gpuCount;
  }

  const systemInputMode = parseEnum(
    params,
    "systemInput",
    ["catalog", "custom"],
    issues,
  );
  if (systemInputMode !== undefined) {
    candidate.hardwareSelection.systemInputMode = systemInputMode;
  }
  const systemId = setString(params, "system");
  if (systemId) candidate.hardwareSelection.systemId = systemId;

  const customSystemKeys = [
    "systemName",
    "memArch",
    "memType",
    "ram",
    "accelType",
    "accelCategory",
    "accelName",
    "accelCount",
    "sharding",
    "dedicatedMem",
    "unifiedMem",
    "bandwidth",
    "idleWatts",
    "loadWatts",
    "systemPrice",
    "tops",
    "topsPrecision",
    "systemTps",
    "systemTtft",
    "runtimeStatus",
    "runtimeMethod",
    "runtimes",
    "perfModel",
    "perfQuant",
    "perfContext",
    "perfConcurrency",
  ];
  if (
    candidate.hardwareSelection.systemInputMode === "custom" ||
    customSystemKeys.some((key) => params.has(key))
  ) {
    const custom = {
      ...createDefaultCustomSystemDraft(),
      ...candidate.hardwareSelection.customSystem,
    };
    const systemName = params.get("systemName");
    const memoryType = params.get("memType");
    const acceleratorType = setString(params, "accelType");
    const acceleratorName = params.get("accelName");
    const topsPrecision = params.get("topsPrecision");
    const runtimes = params.get("runtimes");
    const performanceModelId = params.get("perfModel");
    const performanceQuantizationId = params.get("perfQuant");
    if (systemName !== null) custom.name = systemName;
    if (memoryType !== null) custom.systemMemoryType = memoryType;
    if (acceleratorType !== undefined) custom.acceleratorType = acceleratorType;
    if (acceleratorName !== null) custom.acceleratorName = acceleratorName;
    if (topsPrecision !== null) custom.topsPrecision = topsPrecision;
    if (runtimes !== null) custom.runtimeNames = runtimes;
    if (performanceModelId !== null) {
      custom.performanceModelId = performanceModelId || null;
    }
    if (performanceQuantizationId !== null) {
      custom.performanceQuantizationId = performanceQuantizationId || null;
    }
    custom.memoryArchitecture =
      parseEnum(params, "memArch", ["dedicated", "unified"], issues) ??
      custom.memoryArchitecture;
    const parsedAcceleratorCategory = parseEnum(
      params,
      "accelCategory",
      ["gpu", "ai-accelerator", "npu", "other"],
      issues,
    );
    if (parsedAcceleratorCategory !== undefined) {
      custom.acceleratorBehaviorCategory = parsedAcceleratorCategory;
    } else if (acceleratorType !== undefined) {
      // Links written before display labels and behavior categories were split
      // stored the stable category in accelType.
      if (acceleratorType === "gpu") {
        custom.acceleratorType = "GPU";
        custom.acceleratorBehaviorCategory = "gpu";
      } else if (acceleratorType === "ai-accelerator") {
        custom.acceleratorType = "AI accelerator";
        custom.acceleratorBehaviorCategory = "ai-accelerator";
      } else if (acceleratorType === "npu") {
        custom.acceleratorType = "NPU";
        custom.acceleratorBehaviorCategory = "npu";
      }
    }
    const sharding = parseEnum(params, "sharding", ["true", "false"], issues);
    if (sharding !== undefined) custom.supportsModelSharding = sharding === "true";
    custom.runtimeSupportStatus =
      parseEnum(
        params,
        "runtimeStatus",
        ["supported", "partial", "experimental", "unknown"],
        issues,
      ) ?? custom.runtimeSupportStatus;
    custom.runtimeSupportMethod =
      parseEnum(
        params,
        "runtimeMethod",
        ["measured", "vendor-documented", "community-reported", "estimated"],
        issues,
      ) ?? custom.runtimeSupportMethod;
    const systemRamGB = parseNullableNumber(params, "ram", issues, {
      min: Number.EPSILON,
    });
    const acceleratorCount = parseNullableNumber(params, "accelCount", issues, {
      integer: true,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
    });
    const dedicatedMemory = parseNullableNumber(params, "dedicatedMem", issues, {
      min: Number.EPSILON,
    });
    const unifiedMemory = parseNullableNumber(params, "unifiedMem", issues, {
      min: Number.EPSILON,
    });
    const bandwidth = parseNullableNumber(params, "bandwidth", issues, {
      min: Number.EPSILON,
    });
    const idleWatts = parseNullableNumber(params, "idleWatts", issues, { min: 0 });
    const loadWatts = parseNullableNumber(params, "loadWatts", issues, {
      min: Number.EPSILON,
    });
    const systemPrice = parseNullableNumber(params, "systemPrice", issues, { min: 0 });
    const tops = parseNullableNumber(params, "tops", issues, {
      min: Number.EPSILON,
    });
    const systemTps = parseNullableNumber(params, "systemTps", issues, {
      min: Number.EPSILON,
    });
    const systemTtft = parseNullableNumber(params, "systemTtft", issues, {
      min: 0,
    });
    const performanceContext = parseNullableNumber(params, "perfContext", issues, {
      integer: true,
      min: 1,
    });
    const performanceConcurrency = parseNullableNumber(
      params,
      "perfConcurrency",
      issues,
      { integer: true, min: 1 },
    );
    if (systemRamGB !== undefined) custom.systemRamGB = systemRamGB;
    if (acceleratorCount !== undefined) custom.acceleratorCount = acceleratorCount;
    if (dedicatedMemory !== undefined) custom.dedicatedMemoryPerUnitGB = dedicatedMemory;
    if (unifiedMemory !== undefined) custom.allocatableUnifiedMemoryGB = unifiedMemory;
    if (bandwidth !== undefined) custom.memoryBandwidthGBps = bandwidth;
    if (idleWatts !== undefined) custom.idlePowerWatts = idleWatts;
    if (loadWatts !== undefined) custom.loadPowerWatts = loadWatts;
    if (systemPrice !== undefined) custom.purchasePriceUSD = systemPrice;
    if (tops !== undefined) custom.tops = tops;
    if (systemTps !== undefined) custom.effectiveTokensPerSecond = systemTps;
    if (systemTtft !== undefined) custom.timeToFirstTokenSeconds = systemTtft;
    if (performanceContext !== undefined) custom.performanceContextTokens = performanceContext;
    if (performanceConcurrency !== undefined) custom.performanceConcurrency = performanceConcurrency;
    candidate.hardwareSelection.customSystem = custom;
  }

  economics.displayCurrency =
    parseCurrencyCode(params, "currency", issues) ?? economics.displayCurrency;
  const encodedOverrides = params.get("fx");
  if (encodedOverrides !== null) {
    const overrides = parseExchangeRateOverrides(encodedOverrides, issues);
    if (Object.keys(overrides).length > 0) {
      economics.manualExchangeRateOverride = overrides;
    } else {
      delete economics.manualExchangeRateOverride;
    }
  } else {
    // Backward compatibility for links created before generic currency support.
    const eurRate = parseNumber(params, "eurRate", issues, {
      min: Number.EPSILON,
    });
    const cnyRate = parseNumber(params, "cnyRate", issues, {
      min: Number.EPSILON,
    });
    if (eurRate !== undefined || cnyRate !== undefined) {
      economics.manualExchangeRateOverride = {
        ...(eurRate !== undefined ? { EUR: eurRate } : {}),
        ...(cnyRate !== undefined ? { CNY: cnyRate } : {}),
      };
    }
  }

  economics.hardwareUtilizationRatio =
    parseNumber(params, "util", issues, { min: 0.1, max: 1 }) ??
    economics.hardwareUtilizationRatio;
  economics.localCoverageRatio =
    parseNumber(params, "coverage", issues, { min: 0, max: 1 }) ??
    economics.localCoverageRatio;
  economics.cachedInputRatio =
    parseNumber(params, "cache", issues, { min: 0, max: 1 }) ??
    economics.cachedInputRatio;
  economics.electricityPricePerKWh =
    parseNumber(params, "electricity", issues, { min: 0 }) ??
    economics.electricityPricePerKWh;
  economics.hardwareLifetimeMonths =
    parseNumber(params, "lifetime", issues, { integer: true, min: 1 }) ??
    economics.hardwareLifetimeMonths;
  economics.maintenanceCostMonthly =
    parseNumber(params, "maintenance", issues, { min: 0 }) ??
    economics.maintenanceCostMonthly;
  const cloudPricingId = setString(params, "cloud");
  if (cloudPricingId) economics.cloudPricingId = cloudPricingId;

  const customInput = parseNumber(params, "customInput", issues, { min: 0 });
  const customOutput = parseNumber(params, "customOutput", issues, { min: 0 });
  const customCached = parseNumber(params, "customCached", issues, { min: 0 });
  if (customInput !== undefined || customOutput !== undefined) {
    if (customInput !== undefined && customOutput !== undefined) {
      economics.customCloudPricing = {
        inputPricePerMillionTokens: customInput,
        outputPricePerMillionTokens: customOutput,
        ...(customCached !== undefined
          ? { cachedInputPricePerMillionTokens: customCached }
          : {}),
      };
    } else {
      issues.push({
        source: "url",
        key: "customInput/customOutput",
        code: "invalid-value",
        message: "Custom Cloud input and output prices must be provided together.",
      });
    }
  }

  if (workload.mode === "simple" && assumptions) {
    candidate.workload = resolveWorkloadDefaults(
      [
        "requests",
        "input",
        "output",
        "steps",
        "peakUsers",
        "averageContext",
        "peakContext",
        "hours",
        "days",
      ].some((key) => params.has(key))
        ? workload
        : {
            mode: workload.mode,
            useCase: workload.useCase,
            usageFrequency: workload.usageFrequency,
            users: workload.users,
            privacyRequirement: workload.privacyRequirement,
            capabilityRequirementTierId: workload.capabilityRequirementTierId,
            latencyRequirement: workload.latencyRequirement,
          },
      assumptions,
    );
  }

  let parsed = AdvisorConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    resetInvalidPaths(candidate, defaults, parsed.error.issues, issues);
    parsed = AdvisorConfigSchema.safeParse(candidate);
  }

  if (!parsed.success) {
    issues.push({
      source: "url",
      code: "invalid-config",
      message: "URL state could not be converted into a valid scenario.",
    });
    return { config: null, dataVersion, hasScenarioState: true, issues };
  }

  return {
    config: parsed.data,
    dataVersion,
    hasScenarioState: true,
    issues,
  };
}

function setOptional(
  params: URLSearchParams,
  key: string,
  value: string | number | undefined,
): void {
  if (value !== undefined && value !== "") params.set(key, String(value));
}

function setNullable(
  params: URLSearchParams,
  key: string,
  value: number | null,
): void {
  params.set(key, value === null ? "" : String(value));
}

export function encodeAdvisorConfig(
  config: AdvisorConfig,
  dataVersion?: string,
): URLSearchParams {
  const value = AdvisorConfigSchema.parse(config);
  const params = new URLSearchParams();

  params.set("v", String(URL_STATE_VERSION));
  setOptional(params, "dv", dataVersion);
  setOptional(params, "preset", value.presetId);
  params.set("analysisMode", value.analysisMode);
  params.set("mode", value.workload.mode);
  params.set("case", value.workload.useCase);
  params.set("freq", value.workload.usageFrequency);
  params.set("users", String(value.workload.users));
  params.set("privacy", value.workload.privacyRequirement);
  params.set("intel", value.workload.capabilityRequirementTierId);
  params.set("latency", value.workload.latencyRequirement);

  params.set("requests", String(value.workload.monthlyRequests));
  params.set("input", String(value.workload.averageInputTokens));
  params.set("output", String(value.workload.averageOutputTokens));
  params.set("steps", String(value.workload.averageAgentSteps));
  params.set("peakUsers", String(value.workload.peakConcurrentUsers));
  params.set("averageContext", String(value.workload.averageContextLength));
  params.set("peakContext", String(value.workload.peakContextLength));
  params.set("hours", String(value.workload.workingHoursPerDay));
  params.set("days", String(value.workload.workingDaysPerMonth));

  params.set("modelMode", value.modelSelection.mode);
  setOptional(params, "model", value.modelSelection.modelId);
  setOptional(params, "quant", value.modelSelection.quantizationId);
  params.set("hardwareMode", value.hardwareSelection.mode);
  setOptional(params, "gpu", value.hardwareSelection.gpuId);
  params.set("count", String(value.hardwareSelection.gpuCount));
  setOptional(params, "systemInput", value.hardwareSelection.systemInputMode);
  setOptional(params, "system", value.hardwareSelection.systemId);
  if (value.hardwareSelection.customSystem) {
    const custom = value.hardwareSelection.customSystem;
    params.set("systemName", custom.name);
    params.set("memArch", custom.memoryArchitecture);
    params.set("memType", custom.systemMemoryType);
    setNullable(params, "ram", custom.systemRamGB);
    params.set("accelType", custom.acceleratorType);
    params.set("accelCategory", custom.acceleratorBehaviorCategory);
    params.set("accelName", custom.acceleratorName);
    setNullable(params, "accelCount", custom.acceleratorCount);
    params.set("sharding", String(custom.supportsModelSharding));
    setNullable(params, "dedicatedMem", custom.dedicatedMemoryPerUnitGB);
    setNullable(params, "unifiedMem", custom.allocatableUnifiedMemoryGB);
    setNullable(params, "bandwidth", custom.memoryBandwidthGBps);
    setNullable(params, "idleWatts", custom.idlePowerWatts);
    setNullable(params, "loadWatts", custom.loadPowerWatts);
    setNullable(params, "systemPrice", custom.purchasePriceUSD);
    setNullable(params, "tops", custom.tops);
    params.set("topsPrecision", custom.topsPrecision);
    setNullable(params, "systemTps", custom.effectiveTokensPerSecond);
    setNullable(params, "systemTtft", custom.timeToFirstTokenSeconds);
    params.set("runtimeStatus", custom.runtimeSupportStatus);
    params.set("runtimeMethod", custom.runtimeSupportMethod);
    params.set("runtimes", custom.runtimeNames);
    params.set("perfModel", custom.performanceModelId ?? "");
    params.set("perfQuant", custom.performanceQuantizationId ?? "");
    setNullable(params, "perfContext", custom.performanceContextTokens);
    setNullable(params, "perfConcurrency", custom.performanceConcurrency);
  }
  params.set("currency", value.economics.displayCurrency);
  params.set(
    "fx",
    Object.entries(value.economics.manualExchangeRateOverride ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([code, rate]) => `${code}:${rate}`)
      .join(","),
  );
  params.set("util", String(value.economics.hardwareUtilizationRatio));
  params.set("coverage", String(value.economics.localCoverageRatio));
  setOptional(params, "cloud", value.economics.cloudPricingId);
  params.set("cache", String(value.economics.cachedInputRatio));
  params.set("electricity", String(value.economics.electricityPricePerKWh));
  params.set("lifetime", String(value.economics.hardwareLifetimeMonths));
  params.set("maintenance", String(value.economics.maintenanceCostMonthly));

  if (value.economics.customCloudPricing) {
    params.set(
      "customInput",
      String(value.economics.customCloudPricing.inputPricePerMillionTokens),
    );
    params.set(
      "customOutput",
      String(value.economics.customCloudPricing.outputPricePerMillionTokens),
    );
    setOptional(
      params,
      "customCached",
      value.economics.customCloudPricing.cachedInputPricePerMillionTokens,
    );
  }

  return params;
}

export function createAdvisorUrl(
  config: AdvisorConfig,
  dataVersion?: string,
  currentUrl?: string | URL,
): string {
  const fallback =
    typeof window === "undefined" ? "http://localhost/" : window.location.href;
  const url = new URL(currentUrl ?? fallback);
  url.search = encodeAdvisorConfig(config, dataVersion).toString();
  url.hash = "";
  return url.toString();
}

export function replaceAdvisorUrl(
  config: AdvisorConfig,
  dataVersion?: string,
): void {
  if (typeof window === "undefined") return;
  const url = createAdvisorUrl(config, dataVersion, window.location.href);
  window.history.replaceState(window.history.state, "", url);
}

export function clearAdvisorUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const key of ["v", "dv", ...SCENARIO_KEYS]) url.searchParams.delete(key);
  window.history.replaceState(window.history.state, "", url);
}
