import {
  AlertCircle,
  Archive,
  CalendarClock,
  ChevronRight,
  Database,
  PackageOpen,
  RefreshCw,
  Wifi,
} from "lucide-react";
import {
  Button,
  controlClassName,
  Field,
  InlineNotice,
  Panel,
  SegmentedControl,
  StatusBadge,
  type Tone,
} from "../../components/ui/AdvisorUI";
import type { CurrencyCode } from "../../currency/types";
import { useI18n, type TranslationKey } from "../../i18n";

export type ExchangeRateStatus = "live" | "cached" | "bundled" | "error";

export interface ExchangeRateSnapshot {
  /** Units of target currency for 1 USD. USD should normally be 1. */
  ratesPerUSD: Record<CurrencyCode, number>;
  status: ExchangeRateStatus;
  rateDate: string;
  source: string;
  errorMessage?: string;
}

export type ManualExchangeRateOverride = Record<CurrencyCode, number>;

export interface CurrencyControlProps {
  currency: CurrencyCode;
  snapshot: ExchangeRateSnapshot;
  manualOverride?: ManualExchangeRateOverride;
  refreshing?: boolean;
  disabled?: boolean;
  onCurrencyChange: (currency: CurrencyCode) => void;
  onRefresh: () => void | Promise<void>;
  onManualOverrideChange: (override: ManualExchangeRateOverride | undefined) => void;
}

const statusMeta: Record<
  ExchangeRateStatus,
  { labelKey: TranslationKey; tone: Tone; icon: typeof Wifi }
> = {
  live: {
    labelKey: "currency.dailyReference",
    tone: "green",
    icon: Wifi,
  },
  cached: {
    labelKey: "currency.cached",
    tone: "blue",
    icon: Archive,
  },
  bundled: {
    labelKey: "currency.bundled",
    tone: "neutral",
    icon: PackageOpen,
  },
  error: {
    labelKey: "currency.error",
    tone: "red",
    icon: AlertCircle,
  },
};

function formatRate(value: number | undefined, locale: string) {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

function RateInput({
  currency,
  value,
  fallback,
  disabled,
  onChange,
}: {
  currency: CurrencyCode;
  value?: number;
  fallback: number;
  disabled?: boolean;
  onChange: (value: number | undefined) => void;
}) {
  const { locale, t } = useI18n();
  const formattedFallback = formatRate(fallback, locale) ?? t("common.notAvailable");
  return (
    <Field
      label={t("currency.rateInputLabel", { code: currency })}
      hint={t("currency.sourceRate", { rate: formattedFallback, code: currency })}
    >
      <div className="relative">
        <input
          aria-label={t("currency.manualRateAria", { code: currency })}
          type="number"
          min="0.0001"
          step="0.0001"
          value={value ?? ""}
          disabled={disabled}
          placeholder={formattedFallback}
          className={`${controlClassName} pr-14 tabular-nums`}
          onChange={(event) => {
            const next = event.target.valueAsNumber;
            onChange(Number.isFinite(next) && next > 0 ? next : undefined);
          }}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-xs font-bold text-slate-400">
          {currency}
        </span>
      </div>
    </Field>
  );
}

export function CurrencyControl({
  currency,
  snapshot,
  manualOverride,
  refreshing = false,
  disabled = false,
  onCurrencyChange,
  onRefresh,
  onManualOverrideChange,
}: CurrencyControlProps) {
  const { locale, t } = useI18n();
  const status = statusMeta[snapshot.status];
  const StatusIcon = status.icon;
  const availableCurrencies = Object.entries(snapshot.ratesPerUSD);
  const referenceCurrencies = availableCurrencies.filter(([code]) => code !== "USD");
  const overrideActive = Object.keys(manualOverride ?? {}).length > 0;

  const updateOverride = (
    code: CurrencyCode,
    value: number | undefined,
  ) => {
    const next = { ...manualOverride };
    if (value === undefined) delete next[code];
    else next[code] = value;
    if (Object.keys(next).length === 0) {
      onManualOverrideChange(undefined);
      return;
    }
    onManualOverrideChange(next);
  };

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-slate-950">{t("currency.displayTitle")}</h3>
            <StatusBadge tone={status.tone}>
              <StatusIcon className="size-3.5" aria-hidden="true" />
              {t(status.labelKey)}
            </StatusBadge>
            {overrideActive ? <StatusBadge tone="amber">{t("currency.manualOverride")}</StatusBadge> : null}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {t("currency.description")}
          </p>
        </div>
        <SegmentedControl
          label={t("currency.displayTitle")}
          value={currency}
          onChange={onCurrencyChange}
          disabled={disabled}
          className="flex w-full sm:w-auto"
          options={availableCurrencies.map(([code]) => ({ value: code, label: code }))}
        />
      </div>

      <div className="grid gap-px bg-slate-200 sm:grid-cols-2 xl:grid-cols-3">
        {referenceCurrencies.map(([code, sourceRate]) => (
          <div key={code} className="bg-white px-4 py-4 sm:px-5">
            <p className="text-xs font-semibold text-slate-500">{t("currency.referenceRate", { code })}</p>
            <p className="mt-1 text-lg font-bold tracking-[-0.02em] tabular-nums text-slate-950">
              {t("currency.rateEquation", {
                rate: formatRate(manualOverride?.[code] ?? sourceRate, locale) ?? t("common.notAvailable"),
                code,
              })}
            </p>
          </div>
        ))}
        <div className="flex min-w-52 items-center justify-between gap-4 bg-slate-50 px-4 py-4 sm:px-5">
          <div className="min-w-0 text-xs leading-5 text-slate-500">
            <p className="flex items-center gap-1.5">
              <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{snapshot.rateDate}</span>
            </p>
            <p className="mt-0.5 flex items-center gap-1.5">
              <Database className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate" title={snapshot.source}>{snapshot.source}</span>
            </p>
          </div>
          <Button
            variant="secondary"
            className="px-3"
            disabled={disabled || refreshing}
            onClick={() => void onRefresh()}
            aria-busy={refreshing}
          >
            <RefreshCw
              className={`size-4 ${refreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {refreshing ? t("currency.refreshing") : t("currency.refresh")}
          </Button>
        </div>
      </div>

      {snapshot.status === "error" ? (
        <div className="border-t border-red-200 px-4 py-3 sm:px-5">
          <InlineNotice tone="red" title={t("currency.refreshErrorTitle")}>
            {snapshot.errorMessage ?? t("currency.refreshErrorFallback")}
          </InlineNotice>
        </div>
      ) : null}

      <details className="group border-t border-slate-200">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 sm:px-5">
          <span>{t("currency.overrideTitle")}</span>
          <ChevronRight
            className="size-4 text-slate-400 transition group-open:rotate-90"
            aria-hidden="true"
          />
        </summary>
        <div className="border-t border-slate-200 bg-slate-50 px-4 py-4 sm:px-5">
          <p className="mb-4 max-w-3xl text-xs leading-5 text-slate-600">
            {t("currency.overrideDescription")}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {referenceCurrencies.map(([code, sourceRate]) => (
              <RateInput
                key={code}
                currency={code}
                value={manualOverride?.[code]}
                fallback={sourceRate}
                disabled={disabled}
                onChange={(value) => updateOverride(code, value)}
              />
            ))}
          </div>
          {overrideActive ? (
            <Button
              variant="secondary"
              className="mt-4"
              disabled={disabled}
              onClick={() => onManualOverrideChange(undefined)}
            >
              {t("currency.clearOverrides")}
            </Button>
          ) : null}
        </div>
      </details>
    </Panel>
  );
}
