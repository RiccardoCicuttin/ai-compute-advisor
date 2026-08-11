import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { AdvisorConfigSchema } from "../data/schemas";
import type { ExchangeRateCatalog } from "../currency";
import type {
  AdvisorConfig,
  NormalizedCatalogs,
  PresetRecord,
  WorkloadConfig,
} from "../types";
import {
  applyWorkloadPatch,
  applyPresetToConfig,
  createDefaultAdvisorConfig,
  findRecommendedCloudPricingId,
} from "./defaultAdvisorConfig";
import {
  clearAdvisorStorage,
  readLastScenario,
  writeLastScenario,
  type StorageStateIssue,
} from "./localStorageState";
import {
  clearAdvisorUrl,
  createAdvisorUrl,
  decodeAdvisorUrl,
  replaceAdvisorUrl,
  type UrlStateIssue,
} from "./urlState";
import {
  reconcileAdvisorCatalogReferences,
  type AdvisorCatalogReferenceIssue,
} from "./reconcileAdvisorCatalogReferences";

export interface AdvisorStateIssue {
  source: "url" | "storage" | "state" | "catalog";
  code: string;
  message: string;
  key?: string;
}

export interface UseAdvisorStateOptions {
  initialConfig?: AdvisorConfig;
  preferredPresetId?: string;
  debounceMs?: number;
  syncUrl?: boolean;
  persistLocal?: boolean;
}

export interface UseAdvisorStateResult {
  config: AdvisorConfig;
  setConfig: Dispatch<SetStateAction<AdvisorConfig>>;
  updateWorkload: (patch: Partial<WorkloadConfig>) => void;
  updateAnalysisMode: (mode: AdvisorConfig["analysisMode"]) => void;
  updateModelSelection: (patch: Partial<AdvisorConfig["modelSelection"]>) => void;
  updateHardwareSelection: (patch: Partial<AdvisorConfig["hardwareSelection"]>) => void;
  updateEconomics: (patch: Partial<AdvisorConfig["economics"]>) => void;
  applyPreset: (preset: PresetRecord | string) => void;
  reset: () => void;
  saveNow: () => boolean;
  saveStatus: "pending" | "saved" | "error" | "not-saved";
  lastSavedAt: string | null;
  shareUrl: string;
  issues: AdvisorStateIssue[];
}

export function reconcileAdvisorCurrency(
  config: AdvisorConfig,
  exchangeRates: ExchangeRateCatalog,
  source: AdvisorStateIssue["source"] = "state",
): { config: AdvisorConfig; issues: AdvisorStateIssue[] } {
  const available = new Set(
    exchangeRates.currencies.map((currency) => currency.code),
  );
  const issues: AdvisorStateIssue[] = [];
  const displayCurrency = available.has(config.economics.displayCurrency)
    ? config.economics.displayCurrency
    : "USD";

  if (displayCurrency !== config.economics.displayCurrency) {
    issues.push({
      source,
      code: "currency-not-in-catalog",
      key: "economics.displayCurrency",
      message: `Display currency '${config.economics.displayCurrency}' is not available in the current Data Pack; using USD.`,
    });
  }

  const overrides = Object.entries(
    config.economics.manualExchangeRateOverride ?? {},
  );
  const retainedOverrides = Object.fromEntries(
    overrides.filter(([code]) => available.has(code)),
  );
  const removedCodes = overrides
    .map(([code]) => code)
    .filter((code) => !available.has(code));
  if (removedCodes.length > 0) {
    issues.push({
      source,
      code: "exchange-rate-override-not-in-catalog",
      key: "economics.manualExchangeRateOverride",
      message: `Ignored manual exchange-rate overrides that are not in the current Data Pack: ${removedCodes.join(", ")}.`,
    });
  }

  if (
    displayCurrency === config.economics.displayCurrency &&
    removedCodes.length === 0
  ) {
    return { config, issues };
  }

  const { manualExchangeRateOverride: _removed, ...economics } =
    config.economics;
  return {
    config: {
      ...config,
      economics: {
        ...economics,
        displayCurrency,
        ...(Object.keys(retainedOverrides).length > 0
          ? { manualExchangeRateOverride: retainedOverrides }
          : {}),
      },
    },
    issues,
  };
}

function asStateIssue(
  issue: UrlStateIssue | StorageStateIssue,
): AdvisorStateIssue {
  return {
    source: issue.source,
    code: issue.code,
    message: issue.message,
    ...(issue.key ? { key: issue.key } : {}),
  };
}

function asCatalogStateIssue(
  issue: AdvisorCatalogReferenceIssue,
): AdvisorStateIssue {
  return {
    source: "catalog",
    code: issue.code,
    message: issue.message,
    key: issue.path,
  };
}

function initialize(
  defaults: AdvisorConfig,
  catalogs: NormalizedCatalogs,
): { config: AdvisorConfig; issues: AdvisorStateIssue[] } {
  const issues: AdvisorStateIssue[] = [];

  if (typeof window !== "undefined") {
    const decoded = decodeAdvisorUrl(
      window.location.search,
      defaults,
      catalogs.assumptions,
    );
    issues.push(...decoded.issues.map(asStateIssue));
    if (
      decoded.dataVersion &&
      decoded.dataVersion !== catalogs.dataVersion
    ) {
      issues.push({
        source: "url",
        code: "data-version-mismatch",
        key: "dv",
        message: `This link used data version '${decoded.dataVersion}'. Current data version is '${catalogs.dataVersion}', so results may differ.`,
      });
    }
    if (decoded.config) {
      const reconciled = reconcileAdvisorCatalogReferences(decoded.config, catalogs);
      return {
        config: reconciled.config,
        issues: [...issues, ...reconciled.issues.map(asCatalogStateIssue)],
      };
    }
  }

  const stored = readLastScenario();
  if (stored.issue) issues.push(asStateIssue(stored.issue));
  if (stored.value) {
    const reconciled = reconcileAdvisorCatalogReferences(stored.value, catalogs);
    return {
      config: reconciled.config,
      issues: [...issues, ...reconciled.issues.map(asCatalogStateIssue)],
    };
  }

  const reconciled = reconcileAdvisorCatalogReferences(defaults, catalogs);
  return {
    config: reconciled.config,
    issues: [...issues, ...reconciled.issues.map(asCatalogStateIssue)],
  };
}

export function useAdvisorState(
  catalogs: NormalizedCatalogs,
  options: UseAdvisorStateOptions = {},
): UseAdvisorStateResult {
  const {
    preferredPresetId,
    debounceMs = 300,
    syncUrl = true,
    persistLocal = true,
  } = options;
  const defaults = useMemo(
    () =>
      options.initialConfig
        ? AdvisorConfigSchema.parse(options.initialConfig)
        : createDefaultAdvisorConfig(catalogs, preferredPresetId),
    [catalogs, options.initialConfig, preferredPresetId],
  );
  const initial = useMemo(
    () => initialize(defaults, catalogs),
    [catalogs, defaults],
  );
  const [config, setConfig] = useState<AdvisorConfig>(initial.config);
  const [issues, setIssues] = useState<AdvisorStateIssue[]>(initial.issues);
  const [saveStatus, setSaveStatus] = useState<UseAdvisorStateResult["saveStatus"]>(
    "not-saved",
  );
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const suppressNextSync = useRef(false);

  const addIssue = useCallback((issue: AdvisorStateIssue) => {
    setIssues((current) =>
      current.some(
        (item) =>
          item.source === issue.source &&
          item.code === issue.code &&
          item.key === issue.key &&
          item.message === issue.message,
      )
        ? current
        : [...current, issue],
    );
  }, []);

  const reconciledReferences = useMemo(
    () => reconcileAdvisorCatalogReferences(config, catalogs),
    [catalogs, config],
  );
  const effectiveConfig = reconciledReferences.config;

  useEffect(() => {
    if (effectiveConfig === config) return;
    setConfig(effectiveConfig);
    for (const issue of reconciledReferences.issues) {
      addIssue(asCatalogStateIssue(issue));
    }
  }, [addIssue, config, effectiveConfig, reconciledReferences.issues]);

  const commit = useCallback(
    (updater: (current: AdvisorConfig) => AdvisorConfig) => {
      setConfig((current) => {
        const parsed = AdvisorConfigSchema.safeParse(updater(current));
        if (parsed.success) return parsed.data;
        addIssue({
          source: "state",
          code: "invalid-update",
          message: parsed.error.issues[0]?.message ?? "Ignored an invalid input.",
          key: parsed.error.issues[0]?.path.map(String).join("."),
        });
        return current;
      });
    },
    [addIssue],
  );

  const updateWorkload = useCallback(
    (patch: Partial<WorkloadConfig>) =>
      commit((current) => ({
        ...current,
        presetId: undefined,
        workload: applyWorkloadPatch(
          current.workload,
          patch,
          catalogs.assumptions,
        ),
      })),
    [catalogs.assumptions, commit],
  );
  const updateAnalysisMode = useCallback(
    (analysisMode: AdvisorConfig["analysisMode"]) =>
      commit((current) => ({ ...current, analysisMode })),
    [commit],
  );
  const updateModelSelection = useCallback(
    (patch: Partial<AdvisorConfig["modelSelection"]>) =>
      commit((current) => ({
        ...current,
        modelSelection: { ...current.modelSelection, ...patch },
      })),
    [commit],
  );
  const updateHardwareSelection = useCallback(
    (patch: Partial<AdvisorConfig["hardwareSelection"]>) =>
      commit((current) => ({
        ...current,
        hardwareSelection: { ...current.hardwareSelection, ...patch },
      })),
    [commit],
  );
  const updateEconomics = useCallback(
    (patch: Partial<AdvisorConfig["economics"]>) =>
      commit((current) => ({
        ...current,
        economics: { ...current.economics, ...patch },
      })),
    [commit],
  );
  const applyPreset = useCallback(
    (presetOrId: PresetRecord | string) => {
      const preset =
        typeof presetOrId === "string"
          ? catalogs.presets.find((item) => item.id === presetOrId)
          : presetOrId;
      if (!preset) {
        addIssue({
          source: "state",
          code: "unknown-preset",
          key: String(presetOrId),
          message: "The selected preset is not available in the current data.",
        });
        return;
      }
      commit((current) => {
        const next = applyPresetToConfig(
          current,
          preset,
          catalogs.assumptions,
        );
        const cloudPricingId = findRecommendedCloudPricingId(
          catalogs,
          next.workload.capabilityRequirementTierId,
        );
        return {
          ...next,
          economics: {
            ...next.economics,
            ...(cloudPricingId ? { cloudPricingId } : {}),
            customCloudPricing: undefined,
          },
        };
      });
    },
    [addIssue, catalogs, commit],
  );

  const reset = useCallback(() => {
    suppressNextSync.current = effectiveConfig !== defaults;
    clearAdvisorStorage();
    clearAdvisorUrl();
    setIssues([]);
    setSaveStatus("not-saved");
    setLastSavedAt(null);
    setConfig(defaults);
  }, [defaults, effectiveConfig]);

  const saveNow = useCallback(() => {
    const issue = persistLocal ? writeLastScenario(effectiveConfig) : null;
    if (issue) {
      addIssue(asStateIssue(issue));
      setSaveStatus("error");
      return false;
    }
    if (syncUrl) replaceAdvisorUrl(effectiveConfig, catalogs.dataVersion);
    setSaveStatus("saved");
    setLastSavedAt(new Date().toISOString());
    return true;
  }, [addIssue, catalogs.dataVersion, effectiveConfig, persistLocal, syncUrl]);

  useEffect(() => {
    if (suppressNextSync.current) {
      suppressNextSync.current = false;
      return;
    }

    setSaveStatus("pending");

    const timeout = window.setTimeout(() => {
      if (persistLocal) {
        const issue = writeLastScenario(effectiveConfig);
        if (issue) {
          addIssue(asStateIssue(issue));
          setSaveStatus("error");
        } else {
          setSaveStatus("saved");
          setLastSavedAt(new Date().toISOString());
        }
      } else {
        setSaveStatus("saved");
      }
      if (syncUrl) replaceAdvisorUrl(effectiveConfig, catalogs.dataVersion);
    }, debounceMs);

    return () => window.clearTimeout(timeout);
  }, [
    addIssue,
    catalogs.dataVersion,
    effectiveConfig,
    debounceMs,
    persistLocal,
    syncUrl,
  ]);

  const shareUrl = useMemo(
    () => createAdvisorUrl(effectiveConfig, catalogs.dataVersion),
    [catalogs.dataVersion, effectiveConfig],
  );

  return {
    config: effectiveConfig,
    setConfig,
    updateWorkload,
    updateAnalysisMode,
    updateModelSelection,
    updateHardwareSelection,
    updateEconomics,
    applyPreset,
    reset,
    saveNow,
    saveStatus,
    lastSavedAt,
    shareUrl,
    issues,
  };
}
