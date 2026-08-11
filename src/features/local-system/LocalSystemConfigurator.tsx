import {
  Banknote,
  Boxes,
  CircuitBoard,
  Cpu,
  Gauge,
  LoaderCircle,
  LockKeyhole,
  MemoryStick,
  Pencil,
  Save,
  ServerCog,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { formatMemory } from "../../utils";
import { useI18n, type Locale, type Translate } from "../../i18n";
import {
  controlClassName,
  Button,
  Field,
  InlineNotice,
  Metric,
  Panel,
  SegmentedControl,
  StatusBadge,
} from "../../components/ui/AdvisorUI";
import { formatNumber } from "../advisor-ui/presentation";

export type LocalSystemMode = "catalog" | "custom";
export type MemoryArchitecture = "dedicated" | "unified";
export type AcceleratorBehaviorCategory = "gpu" | "ai-accelerator" | "npu" | "other";

export interface LocalSystemSpecification {
  name: string;
  memoryArchitecture: MemoryArchitecture;
  systemMemoryType: string;
  systemRamGB: number;
  acceleratorType: string;
  acceleratorBehaviorCategory: AcceleratorBehaviorCategory;
  acceleratorName: string;
  acceleratorCount: number;
  supportsModelSharding: boolean;
  dedicatedMemoryPerUnitGB?: number;
  allocatableUnifiedMemoryGB?: number;
  memoryBandwidthGBps: number;
  idlePowerWatts: number | null;
  loadPowerWatts: number | null;
  purchasePriceUSD: number | null;
  tops?: number;
  topsPrecision?: string;
  effectiveTokensPerSecond?: number | null;
  runtimeSupportStatus?: "supported" | "partial" | "experimental" | "unknown";
}

export interface CatalogLocalSystem extends LocalSystemSpecification {
  id: string;
  vendor?: string;
  notes?: string;
  lastUpdated?: string;
}

/** Nullable numbers allow an empty field while a custom draft is being edited. */
export interface CustomLocalSystemDraft {
  name: string;
  memoryArchitecture: MemoryArchitecture;
  systemMemoryType: string;
  systemRamGB: number | null;
  acceleratorType: string;
  acceleratorBehaviorCategory: AcceleratorBehaviorCategory;
  acceleratorName: string;
  acceleratorCount: number | null;
  supportsModelSharding: boolean;
  dedicatedMemoryPerUnitGB: number | null;
  allocatableUnifiedMemoryGB: number | null;
  memoryBandwidthGBps: number | null;
  idlePowerWatts: number | null;
  loadPowerWatts: number | null;
  purchasePriceDisplay: number | null;
  tops: number | null;
  topsPrecision: string;
  effectiveTokensPerSecond: number | null;
  timeToFirstTokenSeconds: number | null;
  runtimeSupportStatus: "supported" | "partial" | "experimental" | "unknown";
  runtimeSupportMethod: "measured" | "vendor-documented" | "community-reported" | "estimated";
  runtimeNames: string;
}

export interface LocalSystemConfiguratorProps {
  mode: LocalSystemMode;
  /** Systems supplied by the active Data Pack. These records are read-only. */
  catalogSystems: CatalogLocalSystem[];
  /** User-created systems persisted by the parent in this browser. */
  browserSystems?: CatalogLocalSystem[];
  selectedSystemId?: string;
  customSystem: CustomLocalSystemDraft;
  errors?: Partial<Record<keyof CustomLocalSystemDraft, string>>;
  disabled?: boolean;
  onModeChange: (mode: LocalSystemMode) => void;
  onCatalogSystemChange: (systemId: string) => void;
  onCustomSystemChange: (patch: Partial<CustomLocalSystemDraft>) => void;
  onSaveCustomSystem?: () => void;
  onEditBrowserSystem?: (systemId: string) => void;
  onCancelBrowserSystemEdit?: () => void;
  onDeleteBrowserSystem?: (systemId: string) => void;
  editingBrowserSystemId?: string | null;
  customSystemSaveDisabled?: boolean;
  savingCustomSystem?: boolean;
  deletingBrowserSystemId?: string | null;
  formatUsd?: (amountUSD: number | null | undefined) => string;
  purchaseCurrency?: string;
  performanceBindingLabel?: string;
}

const memoryTypeSuggestions = [
  "DDR5",
  "DDR5-ECC",
  "LPDDR5X",
  "Unified",
];

function formatMemoryValue(value: number | null | undefined, t: Translate) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? t("common.notAvailable")
    : formatMemory(value);
}

function formatPowerValue(
  value: number | null | undefined,
  locale: Locale,
  t: Translate,
) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? t("common.notAvailable")
    : `${formatNumber(value, 0, locale)} W`;
}

function TextInput({
  ariaLabel,
  value,
  disabled,
  placeholder,
  list,
  onChange,
}: {
  ariaLabel: string;
  value: string;
  disabled?: boolean;
  placeholder?: string;
  list?: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      aria-label={ariaLabel}
      type="text"
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      list={list}
      className={controlClassName}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function NumberInput({
  label,
  value,
  unit,
  min = 0,
  step = 1,
  optional = false,
  hint,
  error,
  disabled,
  onChange,
}: {
  label: string;
  value: number | null;
  unit: string;
  min?: number;
  step?: number;
  optional?: boolean;
  hint?: string;
  error?: string;
  disabled?: boolean;
  onChange: (value: number | null) => void;
}) {
  const { t } = useI18n();
  return (
    <Field label={label} hint={hint ?? (optional ? t("common.optional") : undefined)} error={error}>
      <div className="relative">
        <input
          aria-label={label}
          type="number"
          value={value ?? ""}
          min={min}
          step={step}
          disabled={disabled}
          className={`${controlClassName} pr-20 tabular-nums`}
          onChange={(event) => {
            const next = event.target.valueAsNumber;
            onChange(Number.isFinite(next) ? next : null);
          }}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-xs font-bold text-slate-400">
          {unit}
        </span>
      </div>
    </Field>
  );
}

function CatalogSystemSummary({
  system,
  formatUsd,
}: {
  system: CatalogLocalSystem;
  formatUsd: (amountUSD: number | null | undefined) => string;
}) {
  const { locale, t } = useI18n();
  const memoryValue = system.memoryArchitecture === "unified"
    ? system.allocatableUnifiedMemoryGB
    : system.dedicatedMemoryPerUnitGB;
  const memoryLabel = system.memoryArchitecture === "unified"
    ? t("localSystem.allocatableUnifiedMemory")
    : t("localSystem.dedicatedMemoryUnit");
  const idlePower = formatPowerValue(system.idlePowerWatts, locale, t);
  const loadPower = formatPowerValue(system.loadPowerWatts, locale, t);

  return (
    <div className="grid gap-px bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
      <div className="bg-white p-4">
        <Metric label={t("localSystem.memoryArchitecture")} value={system.memoryArchitecture === "unified" ? t("localSystem.unified") : t("localSystem.dedicated")} note={`${system.systemMemoryType} · ${formatMemoryValue(system.systemRamGB, t)} ${t("localSystem.systemRam")}`} />
      </div>
      <div className="bg-white p-4">
        <Metric label={memoryLabel} value={formatMemoryValue(memoryValue, t)} note={`${formatNumber(system.acceleratorCount, 0, locale)} × ${system.acceleratorName}`} />
      </div>
      <div className="bg-white p-4">
        <Metric label={t("localSystem.memoryBandwidth")} value={`${formatNumber(system.memoryBandwidthGBps, 0, locale)} GB/s`} note={t("localSystem.idleLoad", { idle: idlePower, load: loadPower })} />
      </div>
      <div className="bg-white p-4">
        <Metric label={t("localSystem.purchasePrice")} value={formatUsd(system.purchasePriceUSD)} note={system.lastUpdated ? t("localSystem.updated", { date: system.lastUpdated }) : undefined} />
      </div>
    </div>
  );
}

export function LocalSystemConfigurator({
  mode,
  catalogSystems,
  browserSystems = [],
  selectedSystemId,
  customSystem,
  errors = {},
  disabled = false,
  onModeChange,
  onCatalogSystemChange,
  onCustomSystemChange,
  onSaveCustomSystem,
  onEditBrowserSystem,
  onCancelBrowserSystemEdit,
  onDeleteBrowserSystem,
  editingBrowserSystemId = null,
  customSystemSaveDisabled = false,
  savingCustomSystem = false,
  deletingBrowserSystemId = null,
  formatUsd,
  purchaseCurrency = "USD",
  performanceBindingLabel,
}: LocalSystemConfiguratorProps) {
  const { locale, t } = useI18n();
  const memoryTypeListId = useId();
  const [pendingDeleteSystemId, setPendingDeleteSystemId] = useState<string | null>(null);
  const selectedCatalogSystem = catalogSystems.find(
    (system) => system.id === selectedSystemId,
  );
  const selectedBrowserSystem = selectedCatalogSystem
    ? undefined
    : browserSystems.find((system) => system.id === selectedSystemId);
  const selectedSystem = selectedCatalogSystem ?? selectedBrowserSystem;
  const selectedOrigin = selectedCatalogSystem
    ? "data-pack"
    : selectedBrowserSystem
      ? "browser"
      : null;
  const availableSystemCount = catalogSystems.length + browserSystems.length;
  const displayUsd = formatUsd ?? ((amountUSD: number | null | undefined) =>
    amountUSD == null
      ? t("common.notAvailable")
      : new Intl.NumberFormat(locale, {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 2,
        }).format(amountUSD));
  const selectedSystemEconomicsUnavailable = selectedSystem
    ? selectedSystem.idlePowerWatts == null ||
      selectedSystem.loadPowerWatts == null ||
      selectedSystem.purchasePriceUSD == null
    : false;
  const selectedSystemPerformanceUnavailable = selectedSystem
    ? selectedSystem.effectiveTokensPerSecond === undefined ||
      selectedSystem.effectiveTokensPerSecond === null
    : false;

  useEffect(() => {
    setPendingDeleteSystemId(null);
  }, [mode, selectedSystemId]);

  const confirmDeleteBrowserSystem = () => {
    if (!selectedBrowserSystem || !onDeleteBrowserSystem) return;
    setPendingDeleteSystemId(null);
    onDeleteBrowserSystem(selectedBrowserSystem.id);
  };

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-700">
            <ServerCog className="size-5" aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold text-slate-950">{t("localSystem.title")}</h3>
              <StatusBadge tone={mode === "custom" ? "amber" : "blue"}>
                {mode === "custom" ? t("localSystem.customSystem") : t("localSystem.catalogSystem")}
              </StatusBadge>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {t("localSystem.description")}
            </p>
          </div>
        </div>
        <SegmentedControl
          label={t("localSystem.inputMode")}
          value={mode}
          onChange={onModeChange}
          disabled={disabled}
          className="flex w-full sm:w-auto"
          options={[
            { value: "catalog", label: t("localSystem.catalogSystem") },
            { value: "custom", label: t("localSystem.customSystem") },
          ]}
        />
      </div>

      {mode === "catalog" ? (
        <div>
          <div className="grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:px-5">
            <Field label={t("localSystem.system")}>
              <select
                aria-label={t("localSystem.catalogAria")}
                className={controlClassName}
                value={selectedSystemId ?? ""}
                disabled={disabled || availableSystemCount === 0}
                onChange={(event) => onCatalogSystemChange(event.target.value)}
              >
                <option value="" disabled>
                  {availableSystemCount ? t("localSystem.selectCatalog") : t("localSystem.noCatalog")}
                </option>
                <optgroup label={t("localSystem.dataPackGroup")}>
                  {catalogSystems.length ? catalogSystems.map((system) => (
                    <option key={system.id} value={system.id}>
                      {system.vendor ? `${system.vendor} ` : ""}{system.name}
                    </option>
                  )) : (
                    <option value="__empty_data_pack__" disabled>{t("localSystem.noDataPackSystems")}</option>
                  )}
                </optgroup>
                <optgroup label={t("localSystem.browserGroup")}>
                  {browserSystems.length ? browserSystems.map((system) => (
                    <option key={system.id} value={system.id}>
                      {system.vendor ? `${system.vendor} ` : ""}{system.name}
                    </option>
                  )) : (
                    <option value="__empty_browser_library__" disabled>{t("localSystem.noBrowserSystems")}</option>
                  )}
                </optgroup>
              </select>
            </Field>
            {selectedSystem ? (
              <div className="flex flex-wrap gap-2 pb-0.5">
                <StatusBadge tone={selectedOrigin === "browser" ? "amber" : "blue"}>
                  {selectedOrigin === "browser" ? t("localSystem.browserGroup") : t("localSystem.dataPackGroup")}
                </StatusBadge>
                <StatusBadge>{selectedSystem.acceleratorType}</StatusBadge>
                <StatusBadge tone={selectedSystem.memoryArchitecture === "unified" ? "blue" : "neutral"}>{selectedSystem.memoryArchitecture === "unified" ? t("localSystem.unifiedMemory") : t("localSystem.dedicatedMemory")}</StatusBadge>
                {selectedSystem.acceleratorCount > 1 ? <StatusBadge tone={selectedSystem.supportsModelSharding ? "green" : "amber"}>{selectedSystem.supportsModelSharding ? t("localSystem.modelSharding") : t("localSystem.noPooledMemory")}</StatusBadge> : null}
              </div>
            ) : null}
          </div>
          {selectedSystem ? (
            <>
              <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-2 text-xs leading-5 text-slate-600">
                    {selectedOrigin === "browser" ? (
                      <ServerCog className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden="true" />
                    ) : (
                      <LockKeyhole className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden="true" />
                    )}
                    <span>
                      {selectedOrigin === "browser"
                        ? t("localSystem.browserSavedDescription")
                        : t("localSystem.dataPackReadOnly")}
                    </span>
                  </div>
                  {selectedOrigin === "browser" ? (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button
                        variant="secondary"
                        className="w-full sm:w-auto"
                        disabled={disabled || !onEditBrowserSystem}
                        onClick={() => onEditBrowserSystem?.(selectedSystem.id)}
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                        {t("localSystem.editFromLibrary")}
                      </Button>
                      <Button
                        variant="danger"
                        className="w-full sm:w-auto"
                        disabled={disabled || !onDeleteBrowserSystem || deletingBrowserSystemId === selectedSystem.id}
                        aria-busy={deletingBrowserSystemId === selectedSystem.id}
                        onClick={() => setPendingDeleteSystemId(selectedSystem.id)}
                      >
                        {deletingBrowserSystemId === selectedSystem.id ? (
                          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Trash2 className="size-4" aria-hidden="true" />
                        )}
                        {deletingBrowserSystemId === selectedSystem.id
                          ? t("localSystem.deletingFromLibrary")
                          : t("localSystem.deleteFromLibrary")}
                      </Button>
                    </div>
                  ) : null}
                </div>
                {selectedOrigin === "browser" && pendingDeleteSystemId === selectedSystem.id ? (
                  <div
                    role="group"
                    aria-label={t("localSystem.deleteConfirmationGroup")}
                    className="mt-3 rounded-lg border border-red-200 bg-white p-3"
                  >
                    <p className="text-sm font-semibold leading-5 text-red-800">
                      {t("localSystem.deleteConfirmation", { name: selectedSystem.name })}
                    </p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <Button
                        variant="danger"
                        autoFocus
                        disabled={disabled || !onDeleteBrowserSystem}
                        onClick={confirmDeleteBrowserSystem}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                        {t("localSystem.confirmDelete")}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setPendingDeleteSystemId(null)}
                      >
                        {t("localSystem.cancelDelete")}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
              <CatalogSystemSummary system={selectedSystem} formatUsd={displayUsd} />
              {(selectedSystem.tops !== undefined || selectedSystem.effectiveTokensPerSecond != null) ? (
                <div className="grid gap-3 border-t border-slate-200 bg-slate-50 px-4 py-4 sm:grid-cols-2 sm:px-5">
                  <Metric label={t("localSystem.tops")} value={selectedSystem.tops === undefined ? t("common.notAvailable") : formatNumber(selectedSystem.tops, 1, locale)} />
                  <Metric label={t("localSystem.effectiveLlmTps")} value={selectedSystem.effectiveTokensPerSecond == null ? t("common.notAvailable") : `${formatNumber(selectedSystem.effectiveTokensPerSecond, 1, locale)} tok/s`} />
                </div>
              ) : null}
              {(selectedSystem.notes || selectedSystemEconomicsUnavailable || selectedSystemPerformanceUnavailable) ? (
                <div className="grid gap-3 border-t border-slate-200 bg-white px-4 py-4 sm:px-5">
                  {selectedSystem.notes ? (
                    <InlineNotice tone="amber" title={t("localSystem.catalogCaveatsTitle")}>
                      {selectedSystem.notes}
                    </InlineNotice>
                  ) : null}
                  {selectedSystemEconomicsUnavailable ? (
                    <InlineNotice tone="amber" title={t("localSystem.economicsUnavailableTitle")}>
                      {t("localSystem.economicsUnavailableDescription")}
                    </InlineNotice>
                  ) : null}
                  {selectedSystemPerformanceUnavailable ? (
                    <InlineNotice tone="blue" title={t("localSystem.performanceEvidenceMissingTitle")}>
                      {t("localSystem.performanceEvidenceMissingDescription")}
                    </InlineNotice>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <div className="border-t border-slate-200 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
              {t("localSystem.reviewPrompt")}
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-5 p-4 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel className="p-4">
              <div className="mb-4 flex items-center gap-2">
                <Boxes className="size-4.5 text-slate-600" aria-hidden="true" />
                <h4 className="text-sm font-bold text-slate-950">{t("localSystem.systemMemorySection")}</h4>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("localSystem.systemName")} error={errors.name} className="sm:col-span-2">
                  <TextInput ariaLabel={t("localSystem.systemNameAria")} value={customSystem.name} disabled={disabled} placeholder={t("localSystem.systemNamePlaceholder")} onChange={(name) => onCustomSystemChange({ name })} />
                </Field>
                <Field label={t("localSystem.memoryArchitecture")} error={errors.memoryArchitecture}>
                  <select aria-label={t("localSystem.memoryArchitectureAria")} className={controlClassName} value={customSystem.memoryArchitecture} disabled={disabled} onChange={(event) => onCustomSystemChange({ memoryArchitecture: event.target.value as MemoryArchitecture })}>
                    <option value="dedicated">{t("localSystem.dedicatedAcceleratorMemory")}</option>
                    <option value="unified">{t("localSystem.unifiedSystemMemory")}</option>
                  </select>
                </Field>
                <Field label={t("localSystem.systemMemoryType")} error={errors.systemMemoryType}>
                  <TextInput
                    ariaLabel={t("localSystem.systemMemoryTypeAria")}
                    value={customSystem.systemMemoryType}
                    disabled={disabled}
                    list={memoryTypeListId}
                    onChange={(systemMemoryType) => onCustomSystemChange({ systemMemoryType })}
                  />
                  <datalist id={memoryTypeListId}>
                    {memoryTypeSuggestions.map((item) => <option key={item} value={item} />)}
                  </datalist>
                </Field>
                <NumberInput label={t("localSystem.systemRam")} value={customSystem.systemRamGB} unit="GB" min={1} error={errors.systemRamGB} disabled={disabled} onChange={(systemRamGB) => onCustomSystemChange({ systemRamGB })} />
                {customSystem.memoryArchitecture === "unified" ? (
                  <NumberInput label={t("localSystem.allocatableUnifiedMemory")} value={customSystem.allocatableUnifiedMemoryGB} unit="GB" min={1} error={errors.allocatableUnifiedMemoryGB} disabled={disabled} onChange={(allocatableUnifiedMemoryGB) => onCustomSystemChange({ allocatableUnifiedMemoryGB })} />
                ) : (
                  <NumberInput label={t("localSystem.dedicatedMemoryUnit")} value={customSystem.dedicatedMemoryPerUnitGB} unit="GB" min={1} error={errors.dedicatedMemoryPerUnitGB} disabled={disabled} onChange={(dedicatedMemoryPerUnitGB) => onCustomSystemChange({ dedicatedMemoryPerUnitGB })} />
                )}
              </div>
            </Panel>

            <Panel className="p-4">
              <div className="mb-4 flex items-center gap-2">
                <CircuitBoard className="size-4.5 text-slate-600" aria-hidden="true" />
                <h4 className="text-sm font-bold text-slate-950">{t("localSystem.acceleratorSection")}</h4>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("localSystem.acceleratorType")} error={errors.acceleratorType}>
                  <TextInput ariaLabel={t("localSystem.acceleratorTypeAria")} value={customSystem.acceleratorType} disabled={disabled} placeholder={t("localSystem.acceleratorTypePlaceholder")} onChange={(acceleratorType) => onCustomSystemChange({ acceleratorType })} />
                </Field>
                <Field label={t("localSystem.acceleratorBehaviorCategory")} hint={t("localSystem.acceleratorBehaviorCategoryHint")} error={errors.acceleratorBehaviorCategory}>
                  <select aria-label={t("localSystem.acceleratorBehaviorCategoryAria")} className={controlClassName} value={customSystem.acceleratorBehaviorCategory} disabled={disabled} onChange={(event) => onCustomSystemChange({ acceleratorBehaviorCategory: event.target.value as AcceleratorBehaviorCategory })}>
                    <option value="gpu">GPU</option>
                    <option value="ai-accelerator">{t("localSystem.aiAccelerator")}</option>
                    <option value="npu">NPU</option>
                    <option value="other">{t("localSystem.otherAccelerator")}</option>
                  </select>
                </Field>
                <NumberInput label={t("localSystem.acceleratorCount")} value={customSystem.acceleratorCount} unit={t("localSystem.unitSuffix")} min={1} step={1} error={errors.acceleratorCount} disabled={disabled} onChange={(acceleratorCount) => onCustomSystemChange({ acceleratorCount })} />
                <Field label={t("localSystem.sharding")} hint={t("localSystem.shardingHint")} error={errors.supportsModelSharding}>
                  <select aria-label={t("localSystem.shardingAria")} className={controlClassName} value={customSystem.supportsModelSharding ? "supported" : "unconfirmed"} disabled={disabled || (customSystem.acceleratorCount ?? 1) === 1} onChange={(event) => onCustomSystemChange({ supportsModelSharding: event.target.value === "supported" })}>
                    <option value="unconfirmed">{t("localSystem.notConfirmed")}</option>
                    <option value="supported">{t("localSystem.supportedRuntime")}</option>
                  </select>
                </Field>
                <Field label={t("localSystem.acceleratorName")} error={errors.acceleratorName} className="sm:col-span-2">
                  <TextInput ariaLabel={t("localSystem.acceleratorNameAria")} value={customSystem.acceleratorName} disabled={disabled} placeholder={t("localSystem.acceleratorNamePlaceholder")} onChange={(acceleratorName) => onCustomSystemChange({ acceleratorName })} />
                </Field>
                <NumberInput label={t("localSystem.aggregateBandwidth")} value={customSystem.memoryBandwidthGBps} unit="GB/s" min={0.0001} step={0.1} error={errors.memoryBandwidthGBps} disabled={disabled} onChange={(memoryBandwidthGBps) => onCustomSystemChange({ memoryBandwidthGBps })} />
                <NumberInput label={t("localSystem.effectiveTps")} value={customSystem.effectiveTokensPerSecond} unit="tok/s" min={0.0001} step={0.1} optional hint={performanceBindingLabel ? t("localSystem.boundTo", { binding: performanceBindingLabel }) : t("localSystem.optionalBoundSelected")} error={errors.effectiveTokensPerSecond} disabled={disabled} onChange={(effectiveTokensPerSecond) => onCustomSystemChange({ effectiveTokensPerSecond })} />
                <NumberInput label={t("localSystem.timeFirstToken")} value={customSystem.timeToFirstTokenSeconds} unit="s" min={0} step={0.01} optional hint={performanceBindingLabel ? t("localSystem.boundTo", { binding: performanceBindingLabel }) : t("localSystem.optionalBoundSelected")} error={errors.timeToFirstTokenSeconds} disabled={disabled} onChange={(timeToFirstTokenSeconds) => onCustomSystemChange({ timeToFirstTokenSeconds })} />
                <NumberInput label={t("localSystem.tops")} value={customSystem.tops} unit="TOPS" min={0.0001} step={0.1} optional error={errors.tops} disabled={disabled} onChange={(tops) => onCustomSystemChange({ tops })} />
                <Field label={t("localSystem.topsPrecision")} hint={t("localSystem.topsPrecisionHint")} error={errors.topsPrecision}>
                  <TextInput ariaLabel={t("localSystem.topsPrecisionAria")} value={customSystem.topsPrecision} disabled={disabled} placeholder={t("localSystem.topsPrecisionPlaceholder")} onChange={(topsPrecision) => onCustomSystemChange({ topsPrecision })} />
                </Field>
                <Field label={t("localSystem.runtimeSupport")} error={errors.runtimeSupportStatus}>
                  <select aria-label={t("localSystem.runtimeSupportAria")} className={controlClassName} value={customSystem.runtimeSupportStatus} disabled={disabled} onChange={(event) => onCustomSystemChange({ runtimeSupportStatus: event.target.value as CustomLocalSystemDraft["runtimeSupportStatus"] })}>
                    <option value="unknown">{t("localSystem.unknownNotVerified")}</option>
                    <option value="experimental">{t("status.experimental")}</option>
                    <option value="partial">{t("status.partial")}</option>
                    <option value="supported">{t("status.supported")}</option>
                  </select>
                </Field>
                <Field label={t("localSystem.runtimeEvidence")} error={errors.runtimeSupportMethod}>
                  <select aria-label={t("localSystem.runtimeEvidenceAria")} className={controlClassName} value={customSystem.runtimeSupportMethod} disabled={disabled} onChange={(event) => onCustomSystemChange({ runtimeSupportMethod: event.target.value as CustomLocalSystemDraft["runtimeSupportMethod"] })}>
                    <option value="estimated">{t("status.estimated")}</option>
                    <option value="vendor-documented">{t("status.vendor-documented")}</option>
                    <option value="community-reported">{t("status.community-reported")}</option>
                    <option value="measured">{t("status.measured")}</option>
                  </select>
                </Field>
                <Field label={t("localSystem.runtimeNames")} error={errors.runtimeNames} className="sm:col-span-2">
                  <TextInput ariaLabel={t("localSystem.runtimeNamesAria")} value={customSystem.runtimeNames} disabled={disabled} placeholder={t("localSystem.runtimeNamesPlaceholder")} onChange={(runtimeNames) => onCustomSystemChange({ runtimeNames })} />
                </Field>
              </div>
            </Panel>
          </div>

          <Panel className="p-4">
            <div className="mb-4 flex items-center gap-2">
              <Zap className="size-4.5 text-slate-600" aria-hidden="true" />
              <h4 className="text-sm font-bold text-slate-950">{t("localSystem.powerEconomics")}</h4>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <NumberInput label={t("localSystem.idlePower")} value={customSystem.idlePowerWatts} unit="W" min={0} error={errors.idlePowerWatts} disabled={disabled} onChange={(idlePowerWatts) => onCustomSystemChange({ idlePowerWatts })} />
              <NumberInput label={t("localSystem.loadPower")} value={customSystem.loadPowerWatts} unit="W" min={0.0001} step={0.1} error={errors.loadPowerWatts} disabled={disabled} onChange={(loadPowerWatts) => onCustomSystemChange({ loadPowerWatts })} />
              <NumberInput label={t("localSystem.purchasePriceCurrency", { currency: purchaseCurrency })} value={customSystem.purchasePriceDisplay} unit={purchaseCurrency} min={0} step={1} error={errors.purchasePriceDisplay} disabled={disabled} onChange={(purchasePriceDisplay) => onCustomSystemChange({ purchasePriceDisplay })} />
            </div>
          </Panel>

          <InlineNotice tone="amber" title={t("localSystem.topsNoticeTitle")}>
            {t("localSystem.topsNoticeDescription")}
          </InlineNotice>

          <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-4">
            <div className="flex items-start gap-2">
              <MemoryStick className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden="true" />
              <Metric label={t("localSystem.systemRam")} value={formatMemoryValue(customSystem.systemRamGB, t)} />
            </div>
            <div className="flex items-start gap-2">
              <Cpu className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden="true" />
              <Metric label={t("localSystem.accelerator")} value={customSystem.acceleratorName || t("common.notAvailable")} />
            </div>
            <div className="flex items-start gap-2">
              <Gauge className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden="true" />
              <Metric label={t("localSystem.effectiveTpsShort")} value={customSystem.effectiveTokensPerSecond === null ? t("common.notAvailable") : `${formatNumber(customSystem.effectiveTokensPerSecond, 1, locale)} tok/s`} />
            </div>
            <div className="flex items-start gap-2">
              <Banknote className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden="true" />
              <Metric label={t("localSystem.purchasePrice")} value={customSystem.purchasePriceDisplay === null ? t("common.notAvailable") : new Intl.NumberFormat(locale, { style: "currency", currency: purchaseCurrency, maximumFractionDigits: 2 }).format(customSystem.purchasePriceDisplay)} />
            </div>
          </div>

          <div className="flex flex-col gap-4 rounded-lg border border-blue-200 bg-blue-50/50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white text-blue-700 ring-1 ring-blue-200">
                <Save className="size-4" aria-hidden="true" />
              </span>
              <div>
                <h4 className="text-sm font-bold text-slate-950">
                  {editingBrowserSystemId
                    ? t("localSystem.editingBrowserSystem")
                    : t("localSystem.browserLibraryTitle")}
                </h4>
                <p className="mt-0.5 max-w-2xl text-xs leading-5 text-slate-600">
                  {t("localSystem.browserLibraryDescription")}
                </p>
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              {editingBrowserSystemId ? (
                <Button
                  variant="secondary"
                  disabled={disabled || savingCustomSystem || !onCancelBrowserSystemEdit}
                  onClick={onCancelBrowserSystemEdit}
                >
                  <X className="size-4" aria-hidden="true" />
                  {t("localSystem.cancelEdit")}
                </Button>
              ) : null}
              <Button
                className="w-full sm:w-auto"
                disabled={disabled || customSystemSaveDisabled || savingCustomSystem || !onSaveCustomSystem}
                aria-busy={savingCustomSystem}
                onClick={onSaveCustomSystem}
              >
                {savingCustomSystem ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="size-4" aria-hidden="true" />
                )}
                {savingCustomSystem
                  ? t("localSystem.savingToLibrary")
                  : editingBrowserSystemId
                    ? t("localSystem.updateLibrary")
                    : t("localSystem.saveToLibrary")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
