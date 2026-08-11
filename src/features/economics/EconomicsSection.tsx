import { Banknote, Cloud, Factory, GitMerge, RotateCcw, Scale } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  AdvisorConfig,
  AnalysisResult,
  CalculationTrace,
  CloudPricingRecord,
} from "../../types";
import { formatPercentage } from "../../utils";
import { useI18n } from "../../i18n";
import type { ExchangeRateCatalog, ExchangeRateOrigin } from "../../currency";
import {
  applyExchangeRateOverrides,
  convertDisplayToUsd,
  convertUsdToDisplay,
  formatUsdAsCurrency,
} from "../../currency";
import { EconomicsChart } from "../../components/charts/EconomicsChart";
import { CurrencyControl } from "../currency";
import {
  Button,
  controlClassName,
  Field,
  InlineNotice,
  Metric,
  Panel,
  SectionHeading,
  StatusBadge,
} from "../../components/ui/AdvisorUI";
import type { DeploymentComparisonView } from "../advisor-ui/viewModels";
import { formatNumber, reasonLabel } from "../advisor-ui/presentation";

type EconomicsPatch = Partial<AdvisorConfig["economics"]>;

function NumberInput({
  label,
  value,
  min,
  max,
  step,
  suffix,
  integer = false,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  integer?: boolean;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || draft.trim() === "") {
      setDraft(String(value));
      return;
    }
    const bounded = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
    onChange(integer ? Math.round(bounded) : bounded);
  };
  return (
    <Field label={label}>
      <div className="relative">
        <input
          aria-label={label}
          type="number"
          min={min}
          max={max}
          step={step}
          value={draft}
          className={`${controlClassName} ${suffix ? "pr-14" : ""}`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        {suffix ? <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-xs font-semibold text-slate-400">{suffix}</span> : null}
      </div>
    </Field>
  );
}

function PercentageInput({
  label,
  hint,
  value,
  min,
  max,
  accentClassName,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  accentClassName: string;
  onChange: (ratio: number) => void;
}) {
  const percentage = Math.round(value * 100);
  const [draft, setDraft] = useState(String(percentage));

  useEffect(() => setDraft(String(percentage)), [percentage]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || draft.trim() === "") {
      setDraft(String(percentage));
      return;
    }

    const bounded = Math.min(max, Math.max(min, Math.round(parsed)));
    setDraft(String(bounded));
    if (bounded !== percentage) onChange(bounded / 100);
  };

  const updateFromRange = (next: number) => {
    if (!Number.isFinite(next)) return;
    const bounded = Math.min(max, Math.max(min, Math.round(next)));
    setDraft(String(bounded));
    onChange(bounded / 100);
  };

  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-3">
        <input
          aria-label={label}
          type="range"
          min={min}
          max={max}
          step={1}
          value={percentage}
          onChange={(event) => updateFromRange(event.target.valueAsNumber)}
          className={`min-w-0 flex-1 ${accentClassName}`}
        />
        <div className="relative w-24 shrink-0">
          <input
            aria-label={`${label} percentage`}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setDraft(String(percentage));
                event.currentTarget.blur();
              }
            }}
            className={`${controlClassName} pr-8 text-right`}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-xs font-semibold text-slate-400">%</span>
        </div>
      </div>
    </Field>
  );
}

function CalculationAction({
  trace,
  onView,
}: {
  trace?: CalculationTrace;
  onView: (trace: CalculationTrace) => void;
}) {
  const { t } = useI18n();
  return (
    <Button variant="ghost" className="mt-3 w-full" disabled={!trace} onClick={() => trace && onView(trace)}>
      {t("economics.calculationDetails")}
    </Button>
  );
}

export function EconomicsSection({
  analysis,
  cloudPricing,
  pricingLastUpdated,
  exchangeRates,
  exchangeRateOrigin,
  exchangeRateRefreshing,
  exchangeRateWarning,
  exchangeRateError,
  onRefreshExchangeRates,
  onChange,
  onViewCalculation,
}: {
  analysis: AnalysisResult;
  cloudPricing: CloudPricingRecord[];
  pricingLastUpdated?: string;
  exchangeRates: ExchangeRateCatalog;
  exchangeRateOrigin: ExchangeRateOrigin | null;
  exchangeRateRefreshing: boolean;
  exchangeRateWarning?: string | null;
  exchangeRateError?: string | null;
  onRefreshExchangeRates: () => void | Promise<void>;
  onChange: (patch: EconomicsPatch) => void;
  onViewCalculation: (trace: CalculationTrace) => void;
}) {
  const { locale, t } = useI18n();
  const economics = analysis.config.economics;
  const local = analysis.localCost;
  const hybrid = analysis.hybridCost;
  const cloud = analysis.cloudCost;
  const breakEven = analysis.breakEven;
  const selectedPricing = cloudPricing.find((item) => item.id === economics.cloudPricingId) ?? cloud?.pricing ?? null;
  const customPricing = economics.customCloudPricing;
  const effectiveExchangeRates = applyExchangeRateOverrides(
    exchangeRates,
    economics.manualExchangeRateOverride,
  );
  const currency = economics.displayCurrency;
  const formatUsd = (value: number | null | undefined) =>
    value === null || value === undefined
      ? t("common.notAvailable")
      : formatUsdAsCurrency(value, currency, effectiveExchangeRates, { locale });
  const formatRatio = (value: number | null | undefined) =>
    value === null || value === undefined || !Number.isFinite(value)
      ? t("common.notAvailable")
      : formatPercentage(value);
  const toDisplay = (valueUSD: number) =>
    convertUsdToDisplay(valueUSD, currency, effectiveExchangeRates);
  const toUsd = (value: number) =>
    convertDisplayToUsd(value, currency, effectiveExchangeRates);
  const comparisons: DeploymentComparisonView[] = analysis.comparisons.map((item) => ({
    deployment: item.deployment,
    feasible: item.feasible,
    monthlyCost: item.monthlyCostUSD,
    threeYearTco: item.threeYearTcoUSD,
    costPerMillion: item.costPerMillionTokensUSD,
    privacy: item.privacy,
    latency: item.latency,
    scalability: item.scalability,
    intelligenceCeiling: item.intelligenceCeiling,
    upfrontInvestment: item.upfrontInvestmentUSD,
  }));
  const localFeasible =
    analysis.comparisons.find((item) => item.deployment === "local")
      ?.feasible ?? false;
  const hybridFeasible =
    analysis.comparisons.find((item) => item.deployment === "hybrid")
      ?.feasible ?? false;
  const cloudFeasible =
    analysis.comparisons.find((item) => item.deployment === "cloud")
      ?.feasible ?? false;

  const enableCustomPricing = () => {
    onChange({
      customCloudPricing: {
        inputPricePerMillionTokens: selectedPricing?.inputPricePerMillionTokens ?? 0,
        outputPricePerMillionTokens: selectedPricing?.outputPricePerMillionTokens ?? 0,
        cachedInputPricePerMillionTokens: selectedPricing?.cachedInputPricePerMillionTokens,
      },
    });
  };

  return (
    <section id="economics" className="advisor-section">
      <SectionHeading
        id="economics-heading"
        title={t("economics.title")}
        description={t("economics.description")}
      />

      <div className="mb-5">
        <CurrencyControl
          currency={currency}
          snapshot={{
            ratesPerUSD: Object.fromEntries(
              exchangeRates.currencies.map(({ code, ratePerUSD }) => [code, ratePerUSD]),
            ),
            status: exchangeRateError
              ? "error"
              : exchangeRateOrigin === "daily-reference"
                ? "live"
                : exchangeRateOrigin === "cache"
                  ? "cached"
                  : "bundled",
            rateDate: exchangeRates.lastUpdated,
            source: exchangeRates.source.label,
            ...(exchangeRateError ? { errorMessage: exchangeRateError } : {}),
          }}
          manualOverride={economics.manualExchangeRateOverride}
          refreshing={exchangeRateRefreshing}
          onCurrencyChange={(displayCurrency) => onChange({ displayCurrency })}
          onRefresh={onRefreshExchangeRates}
          onManualOverrideChange={(manualExchangeRateOverride) =>
            onChange({ manualExchangeRateOverride })
          }
        />
        {exchangeRateWarning ? (
          <div className="mt-3">
            <InlineNotice tone="amber" title={t("economics.rateNotice")}>
              {exchangeRateWarning}
            </InlineNotice>
          </div>
        ) : null}
      </div>

      <Panel className="mb-5 p-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1.5fr] xl:items-end">
          <NumberInput
            label={t("economics.hardwareLifetime")}
            value={economics.hardwareLifetimeMonths}
            min={1}
            max={120}
            integer
            suffix={t("common.months")}
            onChange={(hardwareLifetimeMonths) => onChange({ hardwareLifetimeMonths })}
          />
          <NumberInput
            label={t("economics.electricityPrice")}
            value={toDisplay(economics.electricityPricePerKWh)}
            min={0}
            step={0.01}
            suffix={`${currency}/kWh`}
            onChange={(electricityPricePerKWh) => onChange({ electricityPricePerKWh: toUsd(electricityPricePerKWh) })}
          />
          <NumberInput
            label={t("economics.maintenanceMonth")}
            value={toDisplay(economics.maintenanceCostMonthly)}
            min={0}
            step={1}
            suffix={currency}
            onChange={(maintenanceCostMonthly) => onChange({ maintenanceCostMonthly: toUsd(maintenanceCostMonthly) })}
          />
          <PercentageInput
            label={t("economics.hardwareUtilization")}
            hint={t("economics.hardwareUtilizationHint")}
            value={economics.hardwareUtilizationRatio}
            min={10}
            max={100}
            accentClassName="accent-blue-700"
            onChange={(hardwareUtilizationRatio) => onChange({ hardwareUtilizationRatio })}
          />
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-3">
        <Panel className="overflow-hidden border-t-[3px] border-t-emerald-600">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-2">
              <Factory className="size-4.5 text-emerald-700" aria-hidden="true" />
              <h3 className="font-bold text-slate-950">{t("common.local")}</h3>
            </div>
            <StatusBadge tone={localFeasible ? "green" : "red"}>
              {localFeasible ? t("economics.feasibleLocal") : t("common.notFeasible")}
            </StatusBadge>
          </div>
          <dl className="divide-y divide-slate-100 px-5">
            {[
              [t("economics.purchasePrice"), formatUsd(local?.hardwarePurchasePriceUSD)],
              [t("economics.monthlyDepreciation"), formatUsd(local?.monthlyDepreciationUSD)],
              [t("economics.electricity"), formatUsd(local?.monthlyElectricityUSD)],
              [t("economics.maintenance"), formatUsd(local?.monthlyMaintenanceUSD)],
              [t("economics.costPerMillion"), local?.costPerMillionTokensUSD == null ? t("common.notAvailable") : `${formatUsd(local.costPerMillionTokensUSD)} / 1M`],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <dt className="text-slate-600">{label}</dt>
                <dd className="font-bold tabular-nums text-slate-950">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-slate-200 bg-slate-50 px-5 py-4">
            <Metric label={t("economics.estimatedMonthlyTco")} value={formatUsd(local?.monthlyTcoUSD)} emphasis />
          </div>
          <div className="px-4 pb-3"><CalculationAction trace={local?.trace} onView={onViewCalculation} /></div>
        </Panel>

        <Panel className="overflow-hidden border-t-[3px] border-t-amber-600">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-2">
              <GitMerge className="size-4.5 text-amber-700" aria-hidden="true" />
              <h3 className="font-bold text-slate-950">{t("common.hybrid")}</h3>
            </div>
            <StatusBadge tone={hybridFeasible ? "amber" : "red"}>{hybridFeasible ? t("economics.localBaseCloud") : t("common.notFeasible")}</StatusBadge>
          </div>
          <div className="px-5 py-4">
            <PercentageInput
              label={t("economics.localCoverage")}
              hint={t("economics.localCoverageHint")}
              value={economics.localCoverageRatio}
              min={0}
              max={100}
              accentClassName="accent-amber-600"
              onChange={(localCoverageRatio) => onChange({ localCoverageRatio })}
            />
          </div>
          <dl className="divide-y divide-slate-100 border-t border-slate-100 px-5">
            {[
              [t("economics.localCoverageRow"), formatRatio(hybrid?.localCoverageRatio)],
              [t("economics.cloudEscalation"), formatRatio(hybrid?.cloudEscalationRatio)],
              [t("economics.cloudEscalationCost"), formatUsd(hybrid?.cloudEscalationCostUSD)],
              [t("economics.savingVsCloud"), formatRatio(hybrid?.savingVsCloudRatio)],
              [t("economics.costPerMillion"), hybrid?.costPerMillionTokensUSD == null ? t("common.notAvailable") : `${formatUsd(hybrid.costPerMillionTokensUSD)} / 1M`],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <dt className="text-slate-600">{label}</dt>
                <dd className="font-bold tabular-nums text-slate-950">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-slate-200 bg-slate-50 px-5 py-4">
            <Metric label={t("economics.estimatedMonthlyCost")} value={formatUsd(hybrid?.monthlyCostUSD)} emphasis />
          </div>
          <div className="px-4 pb-3"><CalculationAction trace={hybrid?.trace} onView={onViewCalculation} /></div>
        </Panel>

        <Panel className="overflow-hidden border-t-[3px] border-t-blue-600">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-2">
              <Cloud className="size-4.5 text-blue-700" aria-hidden="true" />
              <h3 className="font-bold text-slate-950">{t("common.cloud")}</h3>
            </div>
            {!cloudFeasible ? <StatusBadge tone="red">{t("common.notFeasible")}</StatusBadge> : customPricing ? <StatusBadge tone="amber">{t("economics.customPricing")}</StatusBadge> : <StatusBadge tone="blue">{t("economics.usageBased")}</StatusBadge>}
          </div>
          <div className="grid gap-4 px-5 py-4">
            <Field label={t("economics.providerModel")} hint={pricingLastUpdated ? t("economics.pricingUpdated", { date: pricingLastUpdated }) : undefined}>
              <select aria-label={t("economics.providerModel")} className={controlClassName} value={economics.cloudPricingId ?? ""} onChange={(event) => onChange({ cloudPricingId: event.target.value, customCloudPricing: undefined })}>
                <option value="" disabled>{t("economics.selectCloudPricing")}</option>
                {cloudPricing.map((item) => (
                  <option key={item.id} value={item.id}>{item.provider} · {item.modelName}</option>
                ))}
              </select>
            </Field>

            {customPricing ? (
              <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                <NumberInput label={t("economics.inputPerMillion")} value={toDisplay(customPricing.inputPricePerMillionTokens)} min={0} step={0.01} suffix={currency} onChange={(value) => onChange({ customCloudPricing: { ...customPricing, inputPricePerMillionTokens: toUsd(value) } })} />
                <NumberInput label={t("economics.outputPerMillion")} value={toDisplay(customPricing.outputPricePerMillionTokens)} min={0} step={0.01} suffix={currency} onChange={(value) => onChange({ customCloudPricing: { ...customPricing, outputPricePerMillionTokens: toUsd(value) } })} />
                <NumberInput label={t("economics.cachedPerMillion")} value={toDisplay(customPricing.cachedInputPricePerMillionTokens ?? customPricing.inputPricePerMillionTokens)} min={0} step={0.01} suffix={currency} onChange={(value) => onChange({ customCloudPricing: { ...customPricing, cachedInputPricePerMillionTokens: toUsd(value) } })} />
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <Metric label={t("economics.inputPerMillion")} value={formatUsd(selectedPricing?.inputPricePerMillionTokens)} />
                <Metric label={t("economics.outputPerMillion")} value={formatUsd(selectedPricing?.outputPricePerMillionTokens)} />
                <Metric label={t("economics.cachedPerMillion")} value={formatUsd(selectedPricing?.cachedInputPricePerMillionTokens ?? selectedPricing?.inputPricePerMillionTokens)} />
              </div>
            )}

            {customPricing ? (
              <Button variant="secondary" onClick={() => onChange({ customCloudPricing: undefined })}>
                <RotateCcw className="size-4" /> {t("economics.resetCatalogPricing")}
              </Button>
            ) : (
              <Button variant="secondary" onClick={enableCustomPricing} disabled={!selectedPricing}>
                <Banknote className="size-4" /> {t("economics.enterCustomPricing")}
              </Button>
            )}
          </div>
          <div className="border-t border-slate-200 bg-slate-50 px-5 py-4">
            <Metric label={t("economics.estimatedMonthlyCost")} value={formatUsd(cloud?.monthlyCostUSD)} emphasis />
          </div>
          <div className="px-4 pb-3"><CalculationAction trace={cloud?.trace} onView={onViewCalculation} /></div>
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
        <Panel className="p-4 sm:p-5">
          <EconomicsChart comparisons={comparisons} currency={currency} exchangeRates={effectiveExchangeRates} />
        </Panel>

        <Panel tone={breakEven?.month.status === "none" ? "amber" : "blue"} className="p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="grid size-10 place-items-center rounded-lg bg-white text-slate-700 shadow-sm ring-1 ring-slate-200">
              <Scale className="size-5" aria-hidden="true" />
            </span>
            <StatusBadge tone={breakEven?.month.status === "available" ? "blue" : "amber"}>
              {t("economics.cashInvestmentLens")}
            </StatusBadge>
          </div>
          <h3 className="mt-5 text-xs font-extrabold tracking-[0.08em] text-slate-500 uppercase">{t("economics.breakEvenTitle")}</h3>
          {breakEven?.month.status === "available" ? (
            <p className="mt-1 text-4xl font-bold tracking-[-0.04em] tabular-nums text-slate-950">
              {formatNumber(breakEven.month.months, 1, locale)} <span className="text-xl text-slate-500">{t("common.months")}</span>
            </p>
          ) : (
            <p className="mt-2 text-xl font-bold leading-7 text-slate-950">
              {breakEven?.month.status === "none" ? t("economics.noBreakEven") : t("economics.breakEvenUnavailable")}
            </p>
          )}
          <div className="mt-5 border-t border-slate-200 pt-4">
            <Metric
              label={t("economics.requiredUtilization")}
              value={breakEven?.requiredUtilization.status === "available" ? formatRatio(breakEven.requiredUtilization.ratio) : t("common.notAvailable")}
              note={breakEven?.requiredUtilization.reason ? reasonLabel(breakEven.requiredUtilization.reason, locale) : undefined}
            />
          </div>
          {breakEven?.month.reason ? <InlineNotice tone="amber" title={t("common.why")}>{reasonLabel(breakEven.month.reason, locale)}</InlineNotice> : null}
          <CalculationAction trace={breakEven?.traces[0]} onView={onViewCalculation} />
        </Panel>
      </div>
    </section>
  );
}
