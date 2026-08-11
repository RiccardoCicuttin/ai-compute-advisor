import { useRef, useState, type ChangeEvent } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Database,
  Download,
  FileText,
  LoaderCircle,
  RotateCcw,
  TriangleAlert,
  Upload,
} from "lucide-react";
import type { CalculationTrace, CatalogKey, CatalogMetadata, NormalizedCatalogs } from "../../types";
import { Button, InlineNotice, Panel, SectionHeading, StatusBadge } from "../../components/ui/AdvisorUI";
import { useI18n, type TranslationKey } from "../../i18n";
import { formatCalculationValue, sentenceCase } from "../advisor-ui/presentation";
import { warningLabel } from "../advisor-ui/warningPresentation";

const catalogLabelKeys: Record<CatalogKey, TranslationKey> = {
  models: "transparency.catalog.models",
  modelBenchmarks: "transparency.catalog.modelBenchmarks",
  gpus: "transparency.catalog.gpus",
  inferenceProfiles: "transparency.catalog.inferenceProfiles",
  cloudPricing: "transparency.catalog.cloudPricing",
  assumptions: "transparency.catalog.assumptions",
  presets: "transparency.catalog.presets",
  systems: "transparency.catalog.systems",
  exchangeRates: "transparency.catalog.exchangeRates",
};

function traceGroup(trace: CalculationTrace): TranslationKey {
  const id = trace.id.toLowerCase();
  if (id.includes("token")) return "transparency.group.token";
  if (id.includes("vram") || id.includes("weight") || id.includes("hardware")) return "transparency.group.vram";
  if (id.includes("local")) return "transparency.group.local";
  if (id.includes("cloud")) return "transparency.group.cloud";
  if (id.includes("hybrid")) return "transparency.group.hybrid";
  if (id.includes("break")) return "transparency.group.breakEven";
  if (id.includes("recommend")) return "transparency.group.recommendation";
  return "transparency.group.other";
}

export function TransparencySection({
  catalogs,
  traces,
  warnings,
  dataPackOrigin,
  dataPackIssue,
  onImportDataPack,
  onExportDataPack,
  onResetDataPack,
  browserLibraryCounts,
  browserLibraryIssue,
  onImportBrowserLibrary,
  onExportBrowserLibrary,
  onClearBrowserLibrary,
  onViewCalculation,
}: {
  catalogs: NormalizedCatalogs;
  traces: CalculationTrace[];
  warnings: string[];
  dataPackOrigin: "bundled" | "imported";
  dataPackIssue: string | null;
  onImportDataPack: (file: File) => Promise<void>;
  onExportDataPack: () => void;
  onResetDataPack: () => void;
  browserLibraryCounts: {
    models: number;
    systems: number;
    artificialAnalysis: number;
  };
  browserLibraryIssue: string | null;
  onImportBrowserLibrary: (file: File) => Promise<void>;
  onExportBrowserLibrary: () => void;
  onClearBrowserLibrary: () => void;
  onViewCalculation: (trace: CalculationTrace) => void;
}) {
  const { locale, t } = useI18n();
  const importInputRef = useRef<HTMLInputElement>(null);
  const browserLibraryInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importingBrowserLibrary, setImportingBrowserLibrary] = useState(false);
  const uniqueWarnings = [...new Set(warnings)];
  const groups = traces.reduce<Partial<Record<TranslationKey, CalculationTrace[]>>>((acc, trace) => {
    const key = traceGroup(trace);
    (acc[key] ??= []).push(trace);
    return acc;
  }, {});

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      await onImportDataPack(file);
    } finally {
      setImporting(false);
      input.value = "";
    }
  };

  const handleBrowserLibraryImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setImportingBrowserLibrary(true);
    try {
      await onImportBrowserLibrary(file);
    } finally {
      setImportingBrowserLibrary(false);
      input.value = "";
    }
  };
  const browserLibraryTotal =
    browserLibraryCounts.models +
    browserLibraryCounts.systems +
    browserLibraryCounts.artificialAnalysis;

  return (
    <section id="data-status" className="advisor-section">
      <SectionHeading
        id="assumptions-heading"
        title={t("transparency.title")}
        description={t("transparency.description")}
      />

      <Panel
        tone={uniqueWarnings.length ? "amber" : "green"}
        className="mb-5 p-4 sm:p-5"
      >
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
            {uniqueWarnings.length ? (
              <TriangleAlert className="size-4.5 text-amber-700" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="size-4.5 text-emerald-700" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-950">{t("transparency.warningsTitle")}</h3>
                <p className="mt-0.5 text-xs leading-5 text-slate-600">
                  {uniqueWarnings.length
                    ? t("transparency.warningsDescription")
                    : t("transparency.noWarningsDescription")}
                </p>
              </div>
              <StatusBadge tone={uniqueWarnings.length ? "amber" : "green"}>
                {uniqueWarnings.length
                  ? t("transparency.activeWarnings", { count: uniqueWarnings.length })
                  : t("transparency.noWarnings")}
              </StatusBadge>
            </div>
            {uniqueWarnings.length ? (
              <ul className="mt-3 grid max-h-56 gap-2 overflow-y-auto pr-1 text-sm leading-5 text-amber-950 sm:grid-cols-2">
                {uniqueWarnings.map((warning) => (
                  <li key={warning} className="rounded-lg border border-amber-200 bg-white/75 px-3 py-2">
                    {warningLabel(warning, locale)}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <Panel className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
            <FileText className="size-4.5 text-slate-600" aria-hidden="true" />
            <h3 className="font-bold text-slate-950">{t("transparency.calculationIndex")}</h3>
          </div>
          <div className="divide-y divide-slate-200">
            {(Object.entries(groups) as Array<[TranslationKey, CalculationTrace[]]>).map(([group, groupTraces]) => (
              <details key={group} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-bold text-slate-800 hover:bg-slate-50">
                  <span>{t(group)}</span>
                  <span className="flex items-center gap-2">
                    <StatusBadge>{groupTraces.length}</StatusBadge>
                    <ChevronRight className="size-4 text-slate-400 transition group-open:rotate-90" aria-hidden="true" />
                  </span>
                </summary>
                <div className="grid gap-2 bg-slate-50 px-4 py-3">
                  {groupTraces.map((trace) => (
                    <button
                      key={trace.id}
                      type="button"
                      onClick={() => onViewCalculation(trace)}
                      className="flex min-h-12 items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-blue-300 hover:bg-blue-50/30"
                    >
                      <span>
                        <span className="block text-sm font-bold text-slate-900">{trace.title}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">{sentenceCase(trace.method, locale)}</span>
                      </span>
                      <span className="shrink-0 text-sm font-bold tabular-nums text-slate-950">{formatCalculationValue(trace.result, locale)}</span>
                    </button>
                  ))}
                </div>
              </details>
            ))}
            {!traces.length ? <p className="px-5 py-8 text-sm text-slate-500">{t("transparency.completeAnalysis")}</p> : null}
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-2">
              <Database className="size-4.5 text-slate-600" aria-hidden="true" />
              <h3 className="font-bold text-slate-950">{t("transparency.dataStatus")}</h3>
            </div>
            <StatusBadge tone="blue">{t("common.version", { version: catalogs.dataVersion })}</StatusBadge>
          </div>
          <dl className="divide-y divide-slate-100 px-5">
            {(Object.entries(catalogs.metadata) as Array<[CatalogKey, CatalogMetadata]>).map(([key, metadata]) => (
              <div key={key} className="flex items-center justify-between gap-4 py-3">
                <dt>
                  <span className="block text-sm font-semibold text-slate-800">{t(catalogLabelKeys[key])}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{metadata.source.label}</span>
                </dt>
                <dd className="flex shrink-0 items-center gap-1.5 text-xs font-semibold tabular-nums text-slate-600">
                  <CalendarClock className="size-3.5" aria-hidden="true" />
                  {metadata.lastUpdated}
                </dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-slate-200 bg-slate-50 px-5 py-4 text-xs leading-5 text-slate-600">
            {t("transparency.staticCatalogs")}
          </div>
          <div className="border-t border-slate-200 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold text-slate-950">{t("transparency.dataPackTitle")}</h4>
                <p className="mt-1 max-w-md text-xs leading-5 text-slate-500">
                  {t("transparency.dataPackDescription")}
                </p>
              </div>
              <StatusBadge tone={dataPackOrigin === "imported" ? "blue" : "neutral"}>
                {dataPackOrigin === "imported" ? t("transparency.importedBrowser") : t("transparency.bundledBuild")}
              </StatusBadge>
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <h5 className="text-xs font-bold text-slate-900">
                {t("transparency.configScopeTitle")}
              </h5>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                {t("transparency.configScopeDescription")}
              </p>
              <ul className="mt-3 grid gap-2 text-xs leading-5 text-slate-700 sm:grid-cols-2">
                {[
                  "transparency.configScopeModels",
                  "transparency.configScopeHardware",
                  "transparency.configScopeTemplates",
                  "transparency.configScopeEvidence",
                ].map((key) => (
                  <li key={key} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-700" aria-hidden="true" />
                    {t(key as TranslationKey)}
                  </li>
                ))}
              </ul>
            </div>

            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              tabIndex={-1}
              className="sr-only"
              onChange={handleImport}
            />
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <Button
                variant="secondary"
                disabled={importing}
                onClick={() => importInputRef.current?.click()}
              >
                {importing ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="size-4" aria-hidden="true" />
                )}
                {importing ? t("transparency.importing") : t("transparency.importPack")}
              </Button>
              <Button variant="secondary" onClick={onExportDataPack}>
                <Download className="size-4" aria-hidden="true" />
                {t("transparency.exportPack")}
              </Button>
              <Button
                variant="danger"
                disabled={dataPackOrigin === "bundled" && !dataPackIssue}
                onClick={onResetDataPack}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                {dataPackOrigin === "imported" ? t("transparency.restorePack") : t("transparency.clearPack")}
              </Button>
            </div>

            {dataPackIssue ? (
              <div className="mt-3" role="alert">
                <InlineNotice tone="red" title={t("transparency.dataPackIssue")}>
                  {dataPackIssue}
                </InlineNotice>
              </div>
            ) : null}
          </div>

          <div className="border-t border-slate-200 bg-blue-50/30 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold text-slate-950">
                  {t("transparency.browserLibraryTitle")}
                </h4>
                <p className="mt-1 max-w-md text-xs leading-5 text-slate-600">
                  {t("transparency.browserLibraryDescription")}
                </p>
              </div>
              <StatusBadge tone={browserLibraryTotal ? "blue" : "neutral"}>
                {t("transparency.browserLibraryTotal", { count: browserLibraryTotal })}
              </StatusBadge>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-blue-100 bg-white p-3 text-center">
              <div>
                <dt className="text-[11px] font-semibold text-slate-500">{t("transparency.browserModels")}</dt>
                <dd className="mt-1 text-lg font-bold tabular-nums text-slate-950">{browserLibraryCounts.models}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold text-slate-500">{t("transparency.browserSystems")}</dt>
                <dd className="mt-1 text-lg font-bold tabular-nums text-slate-950">{browserLibraryCounts.systems}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold text-slate-500">{t("transparency.browserComparisons")}</dt>
                <dd className="mt-1 text-lg font-bold tabular-nums text-slate-950">{browserLibraryCounts.artificialAnalysis}</dd>
              </div>
            </dl>
            <input
              ref={browserLibraryInputRef}
              type="file"
              accept="application/json,.json"
              tabIndex={-1}
              className="sr-only"
              onChange={handleBrowserLibraryImport}
            />
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Button
                variant="secondary"
                disabled={importingBrowserLibrary}
                onClick={() => browserLibraryInputRef.current?.click()}
              >
                {importingBrowserLibrary ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="size-4" aria-hidden="true" />
                )}
                {importingBrowserLibrary
                  ? t("transparency.importingBrowserLibrary")
                  : t("transparency.importBrowserLibrary")}
              </Button>
              <Button variant="secondary" disabled={!browserLibraryTotal} onClick={onExportBrowserLibrary}>
                <Download className="size-4" aria-hidden="true" />
                {t("transparency.exportBrowserLibrary")}
              </Button>
              <Button variant="danger" disabled={!browserLibraryTotal} onClick={onClearBrowserLibrary}>
                <RotateCcw className="size-4" aria-hidden="true" />
                {t("transparency.clearBrowserLibrary")}
              </Button>
            </div>
            {browserLibraryIssue ? (
              <div className="mt-3" role="alert">
                <InlineNotice tone="red" title={t("transparency.browserLibraryIssue")}>
                  {browserLibraryIssue}
                </InlineNotice>
              </div>
            ) : null}
          </div>
        </Panel>
      </div>

      <Panel className="mt-5 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-950">{t("transparency.exactAssumptions")}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {t("transparency.exactAssumptionsDescription")}
          </p>
        </div>
        {traces[0] ? <Button variant="secondary" onClick={() => onViewCalculation(traces[0])}>{t("transparency.openDetails")}</Button> : null}
      </Panel>
    </section>
  );
}
