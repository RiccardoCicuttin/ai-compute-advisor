import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  Check,
  ExternalLink,
  FileJson,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { ArtificialAnalysisComparisonRecord } from "../../data/schemas/artificialAnalysisComparisonSchemas";
import { useI18n, type TranslationKey } from "../../i18n";
import { Button, Panel } from "../../components/ui/AdvisorUI";

const MAX_SELECTED_RECORDS = 6;
const DEFAULT_SELECTED_RECORDS = 5;
const ARTIFICIAL_ANALYSIS_API_DOCS =
  "https://artificialanalysis.ai/data-api/docs";

interface ArtificialAnalysisComparisonPanelProps {
  records: ArtificialAnalysisComparisonRecord[];
  onImportSnapshot: (file: File) => Promise<void>;
  onDeleteRecord: (id: string) => void;
  onClear: () => void;
}

function compareForDefaultSelection(
  left: ArtificialAnalysisComparisonRecord,
  right: ArtificialAnalysisComparisonRecord,
) {
  if (left.intelligenceScore === null && right.intelligenceScore === null) {
    return left.name.localeCompare(right.name);
  }
  if (left.intelligenceScore === null) return 1;
  if (right.intelligenceScore === null) return -1;
  return right.intelligenceScore - left.intelligenceScore;
}

function getDefaultSelection(records: ArtificialAnalysisComparisonRecord[]) {
  return new Set(
    [...records]
      .sort(compareForDefaultSelection)
      .slice(0, DEFAULT_SELECTED_RECORDS)
      .map((record) => record.id),
  );
}

function formatMetric(value: number | null, locale: string) {
  if (value === null) return null;
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 3,
  }).format(value);
}

function formatDate(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function ArtificialAnalysisComparisonPanel({
  records,
  onImportSnapshot,
  onDeleteRecord,
  onClear,
}: ArtificialAnalysisComparisonPanelProps) {
  const { locale, t } = useI18n();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() =>
    getDefaultSelection(records),
  );
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<"idle" | "success" | "error">(
    "idle",
  );
  const [confirmClear, setConfirmClear] = useState(false);

  const key = (value: string) => value as TranslationKey;

  useEffect(() => {
    const availableIds = new Set(records.map((record) => record.id));
    setSelectedIds((current) => {
      const retained = new Set(
        [...current].filter((recordId) => availableIds.has(recordId)),
      );
      return retained.size > 0 ? retained : getDefaultSelection(records);
    });
  }, [records]);

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    if (!normalizedQuery) return records;
    return records.filter((record) =>
      [record.name, record.creator.name, record.slug]
        .join(" ")
        .toLocaleLowerCase(locale)
        .includes(normalizedQuery),
    );
  }, [locale, query, records]);

  const selectedRecords = useMemo(
    () =>
      records
        .filter((record) => selectedIds.has(record.id))
        .sort(compareForDefaultSelection),
    [records, selectedIds],
  );

  const toggleSelection = (recordId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(recordId)) {
        next.delete(recordId);
      } else if (next.size < MAX_SELECTED_RECORDS) {
        next.add(recordId);
      }
      return next;
    });
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsImporting(true);
    setImportStatus("idle");
    try {
      await onImportSnapshot(file);
      setImportStatus("success");
    } catch {
      setImportStatus("error");
    } finally {
      setIsImporting(false);
    }
  };

  const valueOrUnavailable = (value: number | null) =>
    formatMetric(value, locale) ?? t("common.notAvailable");

  return (
    <Panel className="overflow-hidden">
      <div className="border-b border-slate-200 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <h3 className="text-base font-bold text-slate-950">
              {t(key("aaComparison.title"))}
            </h3>
            <p className="mt-1.5 text-sm leading-6 text-slate-600">
              {t(key("aaComparison.description"))}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              {t(key("aaComparison.securityNote"))}{" "}
              <a
                href={ARTIFICIAL_ANALYSIS_API_DOCS}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2"
              >
                {t(key("aaComparison.officialDocs"))}
                <ExternalLink aria-hidden="true" className="size-3" />
              </a>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              id={fileInputId}
              className="sr-only"
              type="file"
              accept="application/json,.json"
              onChange={handleFileChange}
            />
            <Button
              variant="secondary"
              disabled={isImporting}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileJson aria-hidden="true" className="size-4" />
              {isImporting
                ? t(key("aaComparison.importing"))
                : t(key("aaComparison.importSnapshot"))}
            </Button>
            {records.length > 0 && !confirmClear ? (
              <Button variant="danger" onClick={() => setConfirmClear(true)}>
                <Trash2 aria-hidden="true" className="size-4" />
                {t(key("aaComparison.clear"))}
              </Button>
            ) : null}
          </div>
        </div>

        {importStatus !== "idle" ? (
          <p
            role={importStatus === "error" ? "alert" : "status"}
            className={`mt-3 flex items-center gap-1.5 text-xs font-semibold ${
              importStatus === "error" ? "text-red-700" : "text-emerald-700"
            }`}
          >
            {importStatus === "success" ? (
              <Check aria-hidden="true" className="size-4" />
            ) : (
              <X aria-hidden="true" className="size-4" />
            )}
            {t(
              key(
                importStatus === "success"
                  ? "aaComparison.importSuccess"
                  : "aaComparison.importError",
              ),
            )}
          </p>
        ) : null}

        {confirmClear ? (
          <div
            role="alert"
            className="mt-4 flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="text-sm font-semibold text-red-900">
              {t(key("aaComparison.clearConfirm"))}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setConfirmClear(false)}>
                {t(key("aaComparison.cancel"))}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  onClear();
                  setConfirmClear(false);
                }}
              >
                {t(key("aaComparison.confirmClear"))}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {records.length === 0 ? (
        <div className="p-8 text-center">
          <FileJson aria-hidden="true" className="mx-auto size-8 text-slate-300" />
          <p className="mt-3 text-sm font-bold text-slate-800">
            {t(key("aaComparison.emptyTitle"))}
          </p>
          <p className="mx-auto mt-1 max-w-xl text-xs leading-5 text-slate-500">
            {t(key("aaComparison.emptyDescription"))}
          </p>
        </div>
      ) : (
        <>
          <div className="border-b border-slate-200 bg-slate-50/60 p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <label className="block w-full max-w-md" htmlFor={`${fileInputId}-search`}>
                <span className="text-xs font-bold text-slate-600">
                  {t(key("aaComparison.searchLabel"))}
                </span>
                <span className="relative mt-1.5 block">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    id={`${fileInputId}-search`}
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t(key("aaComparison.searchPlaceholder"))}
                    className="min-h-10 w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </span>
              </label>
              <p className="text-xs font-semibold text-slate-600">
                {t(key("aaComparison.selectionCount"), {
                  selected: selectedRecords.length,
                  maximum: MAX_SELECTED_RECORDS,
                })}
              </p>
            </div>

            <div className="mt-4 grid max-h-64 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
              {filteredRecords.map((record) => {
                const isSelected = selectedIds.has(record.id);
                const selectionIsFull =
                  !isSelected && selectedIds.size >= MAX_SELECTED_RECORDS;
                return (
                  <div
                    key={record.id}
                    className={`flex min-w-0 items-start gap-2 rounded-lg border p-3 ${
                      isSelected
                        ? "border-blue-300 bg-blue-50"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={selectionIsFull}
                      onChange={() => toggleSelection(record.id)}
                      aria-label={t(key("aaComparison.toggleModel"), {
                        model: record.name,
                      })}
                      className="mt-0.5 size-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                    />
                    <button
                      type="button"
                      disabled={selectionIsFull}
                      onClick={() => toggleSelection(record.id)}
                      className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="block truncate text-sm font-bold text-slate-900">
                        {record.name}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {record.creator.name}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteRecord(record.id)}
                      aria-label={t(key("aaComparison.deleteModel"), {
                        model: record.name,
                      })}
                      title={t(key("aaComparison.delete"))}
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-red-50 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-200"
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </button>
                  </div>
                );
              })}
            </div>

            {filteredRecords.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                {t(key("aaComparison.noSearchResults"))}
              </p>
            ) : null}
          </div>

          <div className="p-5 sm:p-6">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-950">
                  {t(key("aaComparison.tableTitle"))}
                </h4>
                <p className="mt-0.5 text-xs text-slate-500">
                  {t(key("aaComparison.tableUnits"))}
                </p>
              </div>
              <p className="text-xs text-slate-500">
                {t(key("aaComparison.nullMeaning"))}
              </p>
            </div>

            {selectedRecords.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                {t(key("aaComparison.noneSelected"))}
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[1680px] text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="sticky left-0 z-10 min-w-52 border-r border-slate-200 bg-slate-50 px-3 py-2.5 font-bold">
                        {t(key("aaComparison.column.model"))}
                      </th>
                      <th className="px-3 py-2.5 text-right font-bold">
                        {t(key("aaComparison.column.intelligence"))}
                      </th>
                      <th className="px-3 py-2.5 text-right font-bold">
                        {t(key("aaComparison.column.coding"))}
                      </th>
                      <th className="px-3 py-2.5 text-right font-bold">
                        {t(key("aaComparison.column.math"))}
                      </th>
                      <th className="px-3 py-2.5 text-right font-bold">
                        {t(key("aaComparison.column.inputPrice"))}
                      </th>
                      <th className="px-3 py-2.5 text-right font-bold">
                        {t(key("aaComparison.column.outputPrice"))}
                      </th>
                      <th className="px-3 py-2.5 text-right font-bold">
                        {t(key("aaComparison.column.cacheReadPrice"))}
                      </th>
                      <th className="px-3 py-2.5 text-right font-bold">
                        {t(key("aaComparison.column.cacheWritePrice"))}
                      </th>
                      <th className="px-3 py-2.5 text-right font-bold">
                        {t(key("aaComparison.column.speed"))}
                      </th>
                      <th className="px-3 py-2.5 text-right font-bold">
                        {t(key("aaComparison.column.ttft"))}
                      </th>
                      <th className="px-3 py-2.5 font-bold">
                        {t(key("aaComparison.column.source"))}
                      </th>
                      <th className="px-3 py-2.5 font-bold">
                        {t(key("aaComparison.column.importedAt"))}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedRecords.map((record) => (
                      <tr key={record.id} className="bg-white align-top">
                        <th className="sticky left-0 z-[1] border-r border-slate-200 bg-white px-3 py-3 font-bold text-slate-900">
                          <span className="block">{record.name}</span>
                          <span className="mt-0.5 block font-normal text-slate-500">
                            {record.creator.name}
                          </span>
                        </th>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-900">
                          {valueOrUnavailable(record.intelligenceScore)}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-900">
                          {valueOrUnavailable(record.codingScore)}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-900">
                          {valueOrUnavailable(record.mathScore)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-700">
                          {valueOrUnavailable(
                            record.inputPriceUsdPerMillionTokens,
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-700">
                          {valueOrUnavailable(
                            record.outputPriceUsdPerMillionTokens,
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-700">
                          {valueOrUnavailable(
                            record.cacheHitPriceUsdPerMillionTokens,
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-700">
                          {valueOrUnavailable(
                            record.cacheWritePriceUsdPerMillionTokens,
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-700">
                          {valueOrUnavailable(record.medianOutputTokensPerSecond)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-700">
                          {valueOrUnavailable(
                            record.medianTimeToFirstTokenSeconds,
                          )}
                        </td>
                        <td className="px-3 py-3 text-slate-600">
                          <a
                            href={record.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2"
                          >
                            {t(key("aaComparison.openModelSource"))}
                            <ExternalLink aria-hidden="true" className="size-3" />
                          </a>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-slate-600">
                          {formatDate(record.importedAt, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="mt-3 text-xs leading-5 text-slate-500">
              {t(key("aaComparison.methodNote"))}
            </p>
          </div>
        </>
      )}
    </Panel>
  );
}

