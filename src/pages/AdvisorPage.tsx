import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Database, LoaderCircle, RefreshCw } from "lucide-react";
import { calculateAnalysis } from "../calculator";
import {
  clearStoredDataPack,
  downloadPortableDataPack,
  loadCatalogs,
  parsePortableDataPackFile,
  readStoredDataPack,
  writeStoredDataPack,
  type CatalogLoadError,
} from "../data/loaders";
import {
  addLocalDesktopSystem,
  addLocalModel,
  ARTIFICIAL_ANALYSIS_COMPARISON_MAX_BYTES,
  buildLocalModelLibraryEntry,
  clearArtificialAnalysisComparisonLibrary,
  createDefaultCustomSystemDraft,
  createDefaultLocalModelDraft,
  deleteLocalDesktopSystem,
  deleteLocalModel,
  deleteArtificialAnalysisComparisonRecord,
  draftToLocalDesktopSystemRecord,
  localModelEntryToDraft,
  parseArtificialAnalysisSnapshotJson,
  systemRecordToDraft,
  updateLocalDesktopSystem,
  updateLocalModel,
  upsertArtificialAnalysisComparisonRecords,
  useAdvisorState,
  useBrowserCatalogs,
  type LocalModelDraft,
} from "../state";
import type {
  CalculationTrace,
  GpuCount,
  NormalizedCatalogs,
} from "../types";
import { formatMemory, formatPercentage, formatTokens } from "../utils";
import type { ExchangeRateCatalog } from "../currency";
import {
  applyExchangeRateOverrides,
  formatUsdAsCurrency,
  useExchangeRates,
} from "../currency";
import { AppHeader } from "../components/layout/AppHeader";
import { Hero } from "../components/layout/Hero";
import { PresetRail } from "../components/layout/PresetRail";
import { Button, InlineNotice, Panel } from "../components/ui/AdvisorUI";
import { WorkloadSection } from "../features/workload/WorkloadSection";
import { ModelSection } from "../features/model-requirement/ModelSection";
import { HardwareSection } from "../features/hardware-fit/HardwareSection";
import { EconomicsSection } from "../features/economics/EconomicsSection";
import { DecisionSection } from "../features/recommendation/DecisionSection";
import { CalculationDrawer } from "../features/transparency/CalculationDrawer";
import { TransparencySection } from "../features/transparency/TransparencySection";
import { reasonLabel, sentenceCase } from "../features/advisor-ui/presentation";
import { AnalysisModeControl } from "../features/workflow/AnalysisModeControl";
import { useI18n, type Locale, type Translate } from "../i18n";
import type {
  LocalModelEditorErrors,
  LocalModelEditorStatus,
} from "../features/model-requirement/ModelSection";
import { ArtificialAnalysisComparisonPanel } from "../features/model-requirement/ArtificialAnalysisComparisonPanel";

const sectionIds = ["workload", "model", "hardware", "economics", "decision"];

function useActiveSection() {
  const [active, setActive] = useState("workload");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setActive(visible.target.id);
      },
      { rootMargin: "-20% 0px -65%", threshold: [0, 0.15, 0.5] },
    );
    sectionIds.forEach((id) => {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, []);

  return active;
}

async function copyText(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall back for browsers that expose Clipboard API but deny permission.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

function buildSummary(
  analysis: ReturnType<typeof calculateAnalysis>,
  exchangeRates: ExchangeRateCatalog,
  catalogs: NormalizedCatalogs,
  locale: Locale,
  t: Translate,
) {
  const model = analysis.selectedModel;
  const gpu = analysis.selectedGpu;
  const recommendation = analysis.recommendation;
  const breakEven = analysis.breakEven;
  const fit = analysis.hardwareFit;
  const currency = analysis.config.economics.displayCurrency;
  const notAvailable = t("common.notAvailable");
  const formatUsd = (value: number | null | undefined) =>
    value == null
      ? notAvailable
      : formatUsdAsCurrency(value, currency, exchangeRates, { locale });
  const system = analysis.selectedSystem;
  const localCoverage =
    recommendation.deployment === "local"
      ? 1
      : recommendation.deployment === "cloud"
        ? 0
        : recommendation.deployment === "hybrid"
          ? analysis.hybridCost?.localCoverageRatio
          : null;
  const cloudEscalation =
    recommendation.deployment === "local"
      ? 0
      : recommendation.deployment === "cloud"
        ? 1
        : recommendation.deployment === "hybrid"
          ? analysis.hybridCost?.cloudEscalationRatio
          : null;
  const breakEvenLabel =
    breakEven?.month.status === "available"
      ? `${breakEven.month.months?.toFixed(1)} ${t("common.months")}`
      : breakEven?.month.status === "none"
        ? t("decision.noEconomicBreakEven")
        : notAvailable;
  const capabilityLabel =
    catalogs.assumptions.capabilityTiers.find(
      (tier) =>
        tier.id === analysis.config.workload.capabilityRequirementTierId,
    )?.labels[locale] ??
    analysis.config.workload.capabilityRequirementTierId;
  const deploymentLine = (deployment: "local" | "hybrid" | "cloud", value: number | null | undefined) =>
    t("summary.monthlyDeployment", {
      deployment: t(`common.${deployment}`),
      value: formatUsd(value),
    });

  return [
    t("summary.title"),
    "",
    t("summary.workload"),
    t("summary.users", { value: analysis.config.workload.users }),
    t("summary.monthlyRequests", {
      value: formatTokens(analysis.tokenDemand.monthlyRequests, { compact: false }),
    }),
    t("summary.monthlyTokens", {
      input: formatTokens(analysis.tokenDemand.monthlyInputTokens),
      output: formatTokens(analysis.tokenDemand.monthlyOutputTokens),
      total: formatTokens(analysis.tokenDemand.monthlyTotalTokens),
    }),
    t("summary.privacy", {
      value: sentenceCase(analysis.config.workload.privacyRequirement, locale),
    }),
    t("summary.intelligence", { value: capabilityLabel }),
    "",
    t("summary.model"),
    t("summary.selectedModel", {
      value: model ? `${model.provider} ${model.name}` : notAvailable,
    }),
    t("summary.quantization", {
      value: analysis.selectedQuantization?.label ?? notAvailable,
    }),
    t("summary.estimatedVram", {
      value: analysis.vram ? formatMemory(analysis.vram.recommendedVramGB) : notAvailable,
    }),
    "",
    t("summary.hardware"),
    t("summary.configuration", {
      value: system
        ? `${system.name} · ${system.physicalAcceleratorCount} × ${system.acceleratorModel} · ${system.totalAvailableMemoryGB} GB`
        : gpu
          ? `${analysis.config.hardwareSelection.gpuCount} × ${gpu.vendor} ${gpu.name}`
          : notAvailable,
    }),
    t("summary.localFit", {
      value: fit ? sentenceCase(fit.status, locale) : notAvailable,
    }),
    t("summary.effectiveThroughput", {
      value:
        analysis.performance?.effectiveTokensPerSecond == null
          ? notAvailable
          : `${analysis.performance.effectiveTokensPerSecond.toFixed(1)} tok/s`,
    }),
    t("summary.peakConcurrency", {
      value: analysis.config.workload.peakConcurrentUsers,
    }),
    t("summary.workloadUtilization", {
      value: formatPercentage(
        analysis.performance?.workloadComputeUtilizationRatio,
      ),
    }),
    "",
    t("summary.deploymentComparison"),
    deploymentLine("local", analysis.localCost?.monthlyTcoUSD),
    deploymentLine("hybrid", analysis.hybridCost?.monthlyCostUSD),
    deploymentLine("cloud", analysis.cloudCost?.monthlyCostUSD),
    "",
    t("summary.recommendation"),
    t("summary.strategy", {
      value: sentenceCase(
        recommendation.deployment ?? recommendation.status,
        locale,
      ),
    }),
    t("summary.localCoverage", { value: formatPercentage(localCoverage) }),
    t("summary.cloudEscalation", {
      value: formatPercentage(cloudEscalation),
    }),
    t("summary.breakEven", { value: breakEvenLabel }),
    t("summary.reasons"),
    ...recommendation.reasonCodes
      .slice(0, 4)
      .map((reason: string) => `- ${reasonLabel(reason, locale)}`),
    "",
    t("summary.displayCurrency", {
      currency,
      rate:
        exchangeRates.currencies.find((item) => item.code === currency)
          ?.ratePerUSD ?? 1,
      date: exchangeRates.lastUpdated,
    }),
    t("summary.currencyDisclaimer"),
    "",
    t("summary.disclaimer"),
  ].join("\n");
}

function LoadingState() {
  const { t } = useI18n();
  return (
    <main className="grid min-h-dvh place-items-center bg-white px-6">
      <div className="w-full max-w-lg text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-blue-700">
          <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-xl font-bold tracking-[-0.025em] text-slate-950">{t("page.loadingTitle")}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">{t("page.loadingDescription")}</p>
        <div className="mt-6 grid grid-cols-3 gap-2" aria-hidden="true">
          <div className="h-2 animate-pulse rounded bg-slate-200" />
          <div className="h-2 animate-pulse rounded bg-slate-200 [animation-delay:100ms]" />
          <div className="h-2 animate-pulse rounded bg-slate-200 [animation-delay:200ms]" />
        </div>
      </div>
    </main>
  );
}

function ErrorState({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useI18n();
  const issues = "issues" in error && Array.isArray((error as CatalogLoadError).issues)
    ? (error as CatalogLoadError).issues
    : [];
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 px-4 py-12">
      <Panel className="w-full max-w-2xl p-6 sm:p-8">
        <span className="grid size-11 place-items-center rounded-lg bg-red-50 text-red-700">
          <AlertTriangle className="size-5" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-2xl font-bold tracking-[-0.03em] text-slate-950">{t("page.errorTitle")}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{t("page.errorDescription")}</p>
        <div className="mt-5 max-h-64 overflow-y-auto rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {issues.length ? (
            <ul className="grid gap-2">
              {issues.map((issue, index) => <li key={`${issue.message}-${index}`}>{issue.catalog ? `${issue.catalog}: ` : ""}{issue.message}</li>)}
            </ul>
          ) : error.message}
        </div>
        <Button className="mt-5" onClick={onRetry}><RefreshCw className="size-4" /> {t("page.retry")}</Button>
      </Panel>
    </main>
  );
}

function AdvisorWorkspace({
  catalogs,
  dataPackOrigin,
  dataPackIssue,
  onImportDataPack,
  onExportDataPack,
  onResetDataPack,
}: {
  catalogs: NormalizedCatalogs;
  dataPackOrigin: "bundled" | "imported";
  dataPackIssue: string | null;
  onImportDataPack: (file: File) => Promise<void>;
  onExportDataPack: () => void;
  onResetDataPack: () => void;
}) {
  const { locale, t } = useI18n();
  const browserCatalogs = useBrowserCatalogs(catalogs);
  const activeCatalogs = browserCatalogs.catalogs;
  const state = useAdvisorState(activeCatalogs);
  const exchangeRateState = useExchangeRates({
    initialCatalog: activeCatalogs.exchangeRates,
    ...(dataPackOrigin === "imported" ? { storage: null } : {}),
  });
  const referenceExchangeRates = exchangeRateState.catalog ?? activeCatalogs.exchangeRates;
  const effectiveExchangeRates = useMemo(
    () =>
      applyExchangeRateOverrides(
        referenceExchangeRates,
        state.config.economics.manualExchangeRateOverride,
      ),
    [referenceExchangeRates, state.config.economics.manualExchangeRateOverride],
  );
  const analysis = useMemo(
    () => calculateAnalysis(state.config, activeCatalogs),
    [activeCatalogs, state.config],
  );
  const [trace, setTrace] = useState<CalculationTrace | null>(null);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [clipboardIssue, setClipboardIssue] = useState<string | null>(null);
  const [editingLocalSystemId, setEditingLocalSystemId] = useState<string | null>(null);
  const [localSystemSaveErrors, setLocalSystemSaveErrors] = useState<
    Partial<Record<keyof NonNullable<typeof state.config.hardwareSelection.customSystem>, string>>
  >({});
  const [localModelDraft, setLocalModelDraft] = useState<LocalModelDraft | null>(null);
  const [editingLocalModelId, setEditingLocalModelId] = useState<string | null>(null);
  const [localModelStatus, setLocalModelStatus] = useState<LocalModelEditorStatus>("idle");
  const [localModelErrors, setLocalModelErrors] = useState<LocalModelEditorErrors | null>(null);
  const activeSection = useActiveSection();

  const flash = (setter: (value: boolean) => void) => {
    setter(true);
    window.setTimeout(() => setter(false), 1800);
  };

  const copySummary = async () => {
    if (
      await copyText(
        buildSummary(
          analysis,
          effectiveExchangeRates,
          activeCatalogs,
          locale,
          t,
        ),
      )
    ) {
      setClipboardIssue(null);
      flash(setCopied);
    } else {
      setClipboardIssue(t("page.copySummaryError"));
    }
  };

  const share = async () => {
    if (await copyText(state.shareUrl)) {
      setClipboardIssue(null);
      flash(setShared);
    } else {
      setClipboardIssue(t("page.copyLinkError"));
    }
  };

  const reset = () => {
    if (window.confirm(t("page.resetConfirmation"))) state.reset();
  };

  const updateModel = (modelId: string) => {
    const model = activeCatalogs.models.find((item) => item.id === modelId);
    state.updateModelSelection({
      mode: "manual",
      modelId,
      quantizationId: model?.recommendedQuantizationId,
    });
  };

  const saveCustomSystemToLibrary = () => {
    const draft = state.config.hardwareSelection.customSystem;
    if (!draft) return;
    const converted = draftToLocalDesktopSystemRecord(draft, {
      models: activeCatalogs.models,
      ...(editingLocalSystemId ? { id: editingLocalSystemId } : {}),
      now: new Date(),
    });
    if (!converted.success) {
      setLocalSystemSaveErrors(
        Object.fromEntries(
          converted.issues.map((issue) => [issue.path, issue.message]),
        ),
      );
      return;
    }
    const saved = browserCatalogs.commitSystemLibrary((library) =>
      editingLocalSystemId
        ? updateLocalDesktopSystem(library, converted.record, {
            reservedSystemIds: catalogs.systems.map((system) => system.id),
            updatedAt: new Date(),
          })
        : addLocalDesktopSystem(library, converted.record, {
            reservedSystemIds: catalogs.systems.map((system) => system.id),
            updatedAt: new Date(),
          }),
    );
    if (!saved) return;
    setLocalSystemSaveErrors({});
    setEditingLocalSystemId(null);
    state.updateHardwareSelection({
      mode: "system",
      systemInputMode: "catalog",
      systemId: converted.record.id,
    });
  };

  const editBrowserSystem = (systemId: string) => {
    const system = browserCatalogs.localSystems.find((item) => item.id === systemId);
    if (!system) return;
    setEditingLocalSystemId(systemId);
    setLocalSystemSaveErrors({});
    state.updateHardwareSelection({
      mode: "system",
      systemInputMode: "custom",
      customSystem: systemRecordToDraft(system),
    });
  };

  const deleteBrowserSystem = (systemId: string) => {
    const saved = browserCatalogs.commitSystemLibrary((library) =>
      deleteLocalDesktopSystem(library, systemId, { updatedAt: new Date() }),
    );
    if (!saved) return;
    if (editingLocalSystemId === systemId) setEditingLocalSystemId(null);
    if (state.config.hardwareSelection.systemId === systemId) {
      const fallback = activeCatalogs.systems.find((system) => system.id !== systemId);
      state.updateHardwareSelection(
        fallback
          ? {
              mode: "system",
              systemInputMode: "catalog",
              systemId: fallback.id,
            }
          : { mode: "recommended", systemId: undefined },
      );
    }
  };

  const beginAddLocalModel = () => {
    setEditingLocalModelId(null);
    setLocalModelErrors(null);
    setLocalModelStatus("editing");
    setLocalModelDraft(createDefaultLocalModelDraft(activeCatalogs, new Date()));
  };

  const beginUpdateLocalModel = (modelId: string) => {
    const entry = browserCatalogs.localModelEntries.find(
      (candidate) => candidate.model.id === modelId,
    );
    if (!entry) return;
    setEditingLocalModelId(modelId);
    setLocalModelErrors(null);
    setLocalModelStatus("editing");
    setLocalModelDraft(localModelEntryToDraft(entry));
  };

  const saveLocalModel = (draft: LocalModelDraft, editingModelId: string | null) => {
    setLocalModelStatus("saving");
    setLocalModelErrors(null);
    try {
      const entry = buildLocalModelLibraryEntry(draft, new Date());
      const saved = browserCatalogs.commitModelLibrary((library) =>
        editingModelId
          ? updateLocalModel(library, editingModelId, entry, new Date())
          : addLocalModel(library, entry, new Date()),
      );
      if (!saved) {
        setLocalModelStatus("error");
        setLocalModelErrors({ summary: t("model.local.saveError") });
        return;
      }
      setLocalModelStatus("saved");
      setEditingLocalModelId(null);
      setLocalModelDraft(null);
      state.updateModelSelection({
        mode: "manual",
        modelId: entry.model.id,
        quantizationId: entry.model.recommendedQuantizationId,
      });
    } catch (caught) {
      const issues =
        caught && typeof caught === "object" && "issues" in caught && Array.isArray(caught.issues)
          ? caught.issues as Array<{ path?: PropertyKey[]; message?: string }>
          : [];
      setLocalModelStatus("error");
      setLocalModelErrors({
        summary: caught instanceof Error ? caught.message : t("model.local.saveError"),
        fields: Object.fromEntries(
          issues.map((issue) => [
            issue.path?.map(String).join(".") ?? "$",
            issue.message ?? t("model.local.checkFields"),
          ]),
        ),
      });
    }
  };

  const deleteBrowserModel = (modelId: string) => {
    setLocalModelStatus("deleting");
    const saved = browserCatalogs.commitModelLibrary((library) =>
      deleteLocalModel(library, modelId, new Date()),
    );
    if (!saved) {
      setLocalModelStatus("error");
      setLocalModelErrors({ summary: t("model.local.deleteError") });
      return;
    }
    if (editingLocalModelId === modelId) {
      setEditingLocalModelId(null);
      setLocalModelDraft(null);
    }
    if (state.config.modelSelection.modelId === modelId) {
      state.updateModelSelection({
        mode: "recommended",
        modelId: undefined,
        quantizationId: undefined,
      });
    }
    setLocalModelStatus("idle");
  };

  const importArtificialAnalysisSnapshot = async (file: File) => {
    if (file.size > ARTIFICIAL_ANALYSIS_COMPARISON_MAX_BYTES) {
      throw new Error(
        `Artificial Analysis snapshot exceeds the ${ARTIFICIAL_ANALYSIS_COMPARISON_MAX_BYTES.toLocaleString("en-US")} byte limit.`,
      );
    }
    const importedAt = new Date();
    const records = parseArtificialAnalysisSnapshotJson(await file.text(), {
      importedAt,
    });
    const saved = browserCatalogs.commitArtificialAnalysisLibrary((library) =>
      upsertArtificialAnalysisComparisonRecords(library, records, importedAt),
    );
    if (!saved) throw new Error("Artificial Analysis snapshot could not be saved.");
  };

  const deleteArtificialAnalysisRecord = (recordId: string) => {
    browserCatalogs.commitArtificialAnalysisLibrary((library) =>
      deleteArtificialAnalysisComparisonRecord(library, recordId, new Date()),
    );
  };

  const clearArtificialAnalysisRecords = () => {
    browserCatalogs.commitArtificialAnalysisLibrary(
      clearArtificialAnalysisComparisonLibrary(new Date()),
    );
  };

  const workloadSection = (
    <WorkloadSection
      workload={state.config.workload}
      tokenDemand={analysis.tokenDemand}
      assumptions={activeCatalogs.assumptions}
      analysisMode={state.config.analysisMode}
      onChange={state.updateWorkload}
      onViewCalculation={() => setTrace(analysis.tokenDemand.trace)}
    />
  );
  const modelSection = (
    <ModelSection
      analysis={analysis}
      capabilityTiers={activeCatalogs.assumptions.capabilityTiers}
      models={activeCatalogs.models}
      benchmarks={activeCatalogs.modelBenchmarks}
      pricing={activeCatalogs.cloudPricing}
      modelLastUpdated={activeCatalogs.metadata.models.lastUpdated}
      currency={state.config.economics.displayCurrency}
      exchangeRates={effectiveExchangeRates}
      onSelectModel={updateModel}
      onSelectQuantization={(quantizationId) =>
        state.updateModelSelection({ mode: "manual", quantizationId })
      }
      onUseRecommendation={() =>
        state.updateModelSelection({
          mode: "recommended",
          modelId: undefined,
          quantizationId: undefined,
        })
      }
      onViewCalculation={() => analysis.vram && setTrace(analysis.vram.trace)}
      localModelIds={browserCatalogs.localModelEntries.map((entry) => entry.model.id)}
      localModelDraft={localModelDraft}
      editingLocalModelId={editingLocalModelId}
      localModelStatus={localModelStatus}
      localModelErrors={localModelErrors}
      onLocalModelDraftChange={setLocalModelDraft}
      onBeginAddLocalModel={beginAddLocalModel}
      onBeginUpdateLocalModel={beginUpdateLocalModel}
      onSaveLocalModel={saveLocalModel}
      onDeleteLocalModel={deleteBrowserModel}
      onCancelLocalModelEdit={() => {
        setLocalModelDraft(null);
        setEditingLocalModelId(null);
        setLocalModelErrors(null);
        setLocalModelStatus("idle");
      }}
      externalComparisonPanel={
        <ArtificialAnalysisComparisonPanel
          records={browserCatalogs.artificialAnalysisLibrary.records}
          onImportSnapshot={importArtificialAnalysisSnapshot}
          onDeleteRecord={deleteArtificialAnalysisRecord}
          onClear={clearArtificialAnalysisRecords}
        />
      }
    />
  );
  const hardwareSection = (
    <HardwareSection
      analysis={analysis}
      gpus={activeCatalogs.gpus}
      systems={activeCatalogs.systems}
      browserSystems={browserCatalogs.localSystems}
      currency={state.config.economics.displayCurrency}
      exchangeRates={effectiveExchangeRates}
      onModeChange={(mode) =>
        state.updateHardwareSelection(
          mode === "existing"
            ? {
                mode,
                gpuId: analysis.selectedGpu?.id,
                gpuCount: analysis.config.hardwareSelection.gpuCount,
              }
            : mode === "system"
              ? {
                  mode,
                  systemInputMode:
                    state.config.hardwareSelection.systemInputMode ??
                    "catalog",
                  systemId:
                    state.config.hardwareSelection.systemId ??
                    activeCatalogs.systems[0]?.id,
                }
              : { mode },
        )
      }
      onGpuChange={(gpuId) =>
        state.updateHardwareSelection({ mode: "existing", gpuId })
      }
      onCountChange={(gpuCount: GpuCount) =>
        state.updateHardwareSelection({ mode: "existing", gpuCount })
      }
      onSystemInputModeChange={(systemInputMode) =>
        state.updateHardwareSelection({
          mode: "system",
          systemInputMode,
          ...(systemInputMode === "catalog"
            ? {
                systemId:
                  state.config.hardwareSelection.systemId ??
                  activeCatalogs.systems[0]?.id,
              }
            : {
                customSystem:
                  state.config.hardwareSelection.customSystem ??
                  createDefaultCustomSystemDraft(),
              }),
        })
      }
      onSystemChange={(systemId) =>
        state.updateHardwareSelection({
          mode: "system",
          systemInputMode: "catalog",
          systemId,
        })
      }
      onCustomSystemChange={(patch) =>
        state.updateHardwareSelection({
          mode: "system",
          systemInputMode: "custom",
          customSystem: {
            ...(state.config.hardwareSelection.customSystem ??
              createDefaultCustomSystemDraft()),
            ...patch,
          },
        })
      }
      customSystemLibraryErrors={localSystemSaveErrors}
      editingBrowserSystemId={editingLocalSystemId}
      onSaveCustomSystem={saveCustomSystemToLibrary}
      onEditBrowserSystem={editBrowserSystem}
      onCancelBrowserSystemEdit={() => {
        setEditingLocalSystemId(null);
        setLocalSystemSaveErrors({});
      }}
      onDeleteBrowserSystem={deleteBrowserSystem}
      onViewCalculation={() => analysis.vram && setTrace(analysis.vram.trace)}
    />
  );
  const presetItems = activeCatalogs.presets.map((preset) => ({
    id: preset.id,
    name: preset.name[locale] || preset.name.en,
    description: preset.description[locale] || preset.description.en,
  }));

  return (
    <div className="min-h-dvh bg-white text-slate-950">
      <AppHeader
        activeSection={activeSection}
        analysisMode={state.config.analysisMode}
        onSave={() => {
          state.saveNow();
        }}
        saveStatus={state.saveStatus}
        lastSavedAt={state.lastSavedAt}
        onReset={reset}
      />
      <main>
        <Hero
          startSection={
            state.config.analysisMode === "configuration-first"
              ? "hardware"
              : "workload"
          }
        />
        <AnalysisModeControl
          value={state.config.analysisMode}
          onChange={state.updateAnalysisMode}
        />
        <PresetRail
          presets={presetItems}
          selectedId={state.config.presetId}
          onSelect={state.applyPreset}
        />

        {state.issues.length ? (
          <div className="mx-auto max-w-[1440px] px-4 pt-5 sm:px-6 lg:px-8">
            <InlineNotice tone="amber" title={t("page.savedInputsAdjusted")}>
              {state.issues[0].message}
              {state.issues.length > 1
                ? ` ${t("page.moreIssues", { count: state.issues.length - 1 })}`
                : ""}
            </InlineNotice>
          </div>
        ) : null}

        {clipboardIssue ? (
          <div className="mx-auto max-w-[1440px] px-4 pt-5 sm:px-6 lg:px-8" aria-live="assertive">
            <InlineNotice tone="red" title={t("page.clipboardUnavailable")}>
              {clipboardIssue}
            </InlineNotice>
          </div>
        ) : null}

        {state.config.analysisMode === "configuration-first" ? (
          <>
            {hardwareSection}
            {modelSection}
            {workloadSection}
          </>
        ) : (
          <>
            {workloadSection}
            {modelSection}
            {hardwareSection}
          </>
        )}
        <EconomicsSection
          analysis={analysis}
          cloudPricing={activeCatalogs.cloudPricing}
          pricingLastUpdated={activeCatalogs.metadata.cloudPricing.lastUpdated}
          exchangeRates={referenceExchangeRates}
          exchangeRateOrigin={exchangeRateState.origin}
          exchangeRateRefreshing={exchangeRateState.isRefreshing}
          exchangeRateWarning={exchangeRateState.warning}
          exchangeRateError={exchangeRateState.error?.message}
          onRefreshExchangeRates={exchangeRateState.refresh}
          onChange={state.updateEconomics}
          onViewCalculation={setTrace}
        />
        <DecisionSection
          analysis={analysis}
          capabilityTiers={activeCatalogs.assumptions.capabilityTiers}
          copied={copied}
          shared={shared}
          currency={state.config.economics.displayCurrency}
          exchangeRates={effectiveExchangeRates}
          onCopySummary={copySummary}
          onShare={share}
          onViewCalculation={setTrace}
        />
        <TransparencySection
          catalogs={catalogs}
          traces={analysis.traces}
          warnings={analysis.warnings}
          dataPackOrigin={dataPackOrigin}
          dataPackIssue={dataPackIssue}
          onImportDataPack={onImportDataPack}
          onExportDataPack={onExportDataPack}
          onResetDataPack={onResetDataPack}
          browserLibraryCounts={{
            models: browserCatalogs.modelLibrary.entries.length,
            systems: browserCatalogs.systemLibrary.records.length,
            artificialAnalysis:
              browserCatalogs.artificialAnalysisLibrary.records.length,
          }}
          browserLibraryIssue={browserCatalogs.issues[0]?.message ?? null}
          onImportBrowserLibrary={async (file) => {
            const hasExistingRecords =
              browserCatalogs.modelLibrary.entries.length > 0 ||
              browserCatalogs.systemLibrary.records.length > 0 ||
              browserCatalogs.artificialAnalysisLibrary.records.length > 0;
            if (
              hasExistingRecords &&
              !window.confirm(
                t("transparency.browserLibraryReplaceConfirmation"),
              )
            ) {
              return;
            }
            await browserCatalogs.importPack(file);
          }}
          onExportBrowserLibrary={() => {
            browserCatalogs.exportPack();
          }}
          onClearBrowserLibrary={() => {
            if (
              window.confirm(
                t("transparency.browserLibraryClearConfirmation"),
              )
            ) {
              browserCatalogs.clearLibraries();
              setEditingLocalModelId(null);
              setLocalModelDraft(null);
              setEditingLocalSystemId(null);
            }
          }}
          onViewCalculation={setTrace}
        />

        <footer className="border-t border-slate-200 bg-slate-50">
          <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-4 py-7 text-xs leading-5 text-slate-500 sm:px-6 lg:flex-row lg:items-start lg:justify-between lg:px-8">
            <p className="max-w-4xl">
              {t("footer.disclaimer")}
            </p>
            <p className="flex shrink-0 items-center gap-1.5 font-semibold">
              <Database className="size-3.5" aria-hidden="true" />{" "}
              {t("footer.dataVersion", { version: catalogs.dataVersion })}
            </p>
          </div>
        </footer>
      </main>
      <CalculationDrawer trace={trace} onClose={() => setTrace(null)} />
    </div>
  );
}

export default function AdvisorPage() {
  const [catalogs, setCatalogs] = useState<NormalizedCatalogs | null>(null);
  const [bundledCatalogs, setBundledCatalogs] = useState<NormalizedCatalogs | null>(null);
  const [dataPackOrigin, setDataPackOrigin] = useState<"bundled" | "imported">("bundled");
  const [dataPackIssue, setDataPackIssue] = useState<string | null>(null);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setError(null);
    loadCatalogs()
      .then((loaded) => {
        if (!active) return;
        setBundledCatalogs(loaded);
        const stored = readStoredDataPack();
        if (stored.catalogs) {
          setCatalogs(stored.catalogs);
          setDataPackOrigin("imported");
          setDataPackIssue(null);
        } else {
          setCatalogs(loaded);
          setDataPackOrigin("bundled");
          setDataPackIssue(
            stored.error
              ? `The saved Data Pack was ignored because it is invalid: ${stored.error.message}`
              : null,
          );
        }
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught : new Error("Unknown catalog error"));
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setCatalogs(null);
    setBundledCatalogs(null);
    setAttempt((value) => value + 1);
  }, []);

  const importDataPack = useCallback(async (file: File) => {
    try {
      const imported = await parsePortableDataPackFile(file);
      writeStoredDataPack(imported.pack);
      setCatalogs(imported.catalogs);
      setDataPackOrigin("imported");
      setDataPackIssue(null);
      setWorkspaceRevision((value) => value + 1);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unknown Data Pack error";
      setDataPackIssue(`Import failed. The current data remains active. ${message}`);
    }
  }, []);

  const exportDataPack = useCallback(() => {
    if (catalogs) downloadPortableDataPack(catalogs);
  }, [catalogs]);

  const resetDataPack = useCallback(() => {
    clearStoredDataPack();
    if (bundledCatalogs) {
      setCatalogs(bundledCatalogs);
      setDataPackOrigin("bundled");
      setDataPackIssue(null);
      setWorkspaceRevision((value) => value + 1);
    }
  }, [bundledCatalogs]);

  if (error) return <ErrorState error={error} onRetry={retry} />;
  if (!catalogs) return <LoadingState />;
  return (
    <AdvisorWorkspace
      key={`${workspaceRevision}-${dataPackOrigin}-${catalogs.dataVersion}`}
      catalogs={catalogs}
      dataPackOrigin={dataPackOrigin}
      dataPackIssue={dataPackIssue}
      onImportDataPack={importDataPack}
      onExportDataPack={exportDataPack}
      onResetDataPack={resetDataPack}
    />
  );
}
