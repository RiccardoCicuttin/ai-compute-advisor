import { useEffect, useState, type KeyboardEvent } from "react";
import { Calculator, Info, SlidersHorizontal } from "lucide-react";
import type {
  AdvisorConfig,
  AssumptionsRecord,
  TokenDemandResult,
  WorkloadConfig,
} from "../../types";
import { useI18n } from "../../i18n";
import { formatTokens } from "../../utils";
import {
  Button,
  controlClassName,
  Field,
  Metric,
  Panel,
  SectionHeading,
  SegmentedControl,
  StatusBadge,
} from "../../components/ui/AdvisorUI";

type WorkloadPatch = Partial<WorkloadConfig>;

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <Field label={label}>
      <select
        aria-label={label}
        className={controlClassName}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function NumberField({
  label,
  value,
  min = 0,
  max,
  step = 1,
  suffix,
  hint,
  integer = step >= 1,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  hint?: string;
  integer?: boolean;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const bounded = Math.min(
      max ?? Number.POSITIVE_INFINITY,
      Math.max(min, parsed),
    );
    const next = integer ? Math.round(bounded) : bounded;
    setDraft(String(next));
    if (next !== value) onChange(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") {
      setDraft(String(value));
      event.currentTarget.blur();
    }
  };

  return (
    <Field label={label} hint={hint}>
      <div className="relative">
        <input
          aria-label={label}
          type="number"
          className={`${controlClassName} ${suffix ? "pr-28" : ""}`}
          value={draft}
          min={min}
          max={max}
          step={step}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
        {suffix ? (
          <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-xs font-semibold text-slate-400">
            {suffix}
          </span>
        ) : null}
      </div>
    </Field>
  );
}

export function WorkloadSection({
  workload,
  tokenDemand,
  assumptions,
  analysisMode,
  onChange,
  onViewCalculation,
}: {
  workload: WorkloadConfig;
  tokenDemand: TokenDemandResult;
  assumptions: AssumptionsRecord;
  analysisMode: AdvisorConfig["analysisMode"];
  onChange: (patch: WorkloadPatch) => void;
  onViewCalculation: () => void;
}) {
  const { locale, t } = useI18n();
  const [contextAdjustment, setContextAdjustment] = useState<
    | { kind: "peak-raised"; value: number }
    | { kind: "average-lowered"; value: number }
    | null
  >(null);
  const localized = (value: { en: string; "zh-CN": string }) =>
    value[locale] || value.en;
  const useCases = Object.entries(assumptions.simpleModeMappings.useCases).map(
    ([value, definition]) => ({ value, label: localized(definition.labels) }),
  );
  const frequencies = Object.entries(
    assumptions.simpleModeMappings.usageFrequency,
  ).map(([value, definition]) => ({
    value,
    label: localized(definition.labels),
  }));
  const capabilityTiers = [...assumptions.capabilityTiers]
    .sort((left, right) => left.rank - right.rank)
    .map((tier) => ({ value: tier.id, label: localized(tier.labels) }));
  const privacyOptions = Object.entries(
    assumptions.workloadDefinitions.privacy,
  ).map(([value, definition]) => ({
    value: value as WorkloadConfig["privacyRequirement"],
    label: localized(definition.labels),
  }));
  const latencyOptions = Object.entries(
    assumptions.workloadDefinitions.latency,
  ).map(([value, definition]) => ({
    value: value as WorkloadConfig["latencyRequirement"],
    label: localized(definition.labels),
  }));
  const privacyDefinition =
    assumptions.workloadDefinitions.privacy[workload.privacyRequirement];
  const latencyDefinition =
    assumptions.workloadDefinitions.latency[workload.latencyRequirement];
  const capabilityDefinition = assumptions.capabilityTiers.find(
    (tier) => tier.id === workload.capabilityRequirementTierId,
  );
  const capabilityLabel = capabilityDefinition
    ? localized(capabilityDefinition.labels)
    : workload.capabilityRequirementTierId;
  const localizedOptional = (
    value: { en: string; "zh-CN": string } | undefined,
    fallbackKey:
      | "workload.capabilityFallbackDescription"
      | "workload.capabilityFallbackExample"
      | "workload.capabilityFallbackImpact",
  ) => (value ? localized(value) : t(fallbackKey, { label: capabilityLabel }));
  const requestsPerUserDay =
    workload.monthlyRequests /
    Math.max(1, workload.users * workload.workingDaysPerMonth);
  const formatContextValue = (value: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);

  const qualitativeFields = (
    <>
      <NumberField
        label={t("workload.users")}
        value={workload.users}
        min={1}
        onChange={(users) => onChange({ users })}
      />
      <SelectField
        label={t("workload.privacyRequirement")}
        value={workload.privacyRequirement}
        options={privacyOptions}
        onChange={(privacyRequirement) => onChange({ privacyRequirement })}
      />
      <SelectField
        label={t("workload.intelligenceRequirement")}
        value={workload.capabilityRequirementTierId}
        options={capabilityTiers}
        onChange={(capabilityRequirementTierId) =>
          onChange({ capabilityRequirementTierId })
        }
      />
      <SelectField
        label={t("workload.latencyRequirement")}
        value={workload.latencyRequirement}
        options={latencyOptions}
        onChange={(latencyRequirement) => onChange({ latencyRequirement })}
      />
    </>
  );

  const numericFields = (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {workload.mode === "simple" ? (
        <NumberField
          label={t("workload.requestsPerUserDay")}
          value={Number(requestsPerUserDay.toFixed(2))}
          min={0}
          step={0.5}
          integer={false}
          onChange={(rate) =>
            onChange({
              monthlyRequests: Math.round(
                rate * workload.users * workload.workingDaysPerMonth,
              ),
            })
          }
        />
      ) : (
        <NumberField
          label={t("workload.monthlyRequests")}
          value={workload.monthlyRequests}
          onChange={(monthlyRequests) => onChange({ monthlyRequests })}
        />
      )}
      <NumberField
        label={t("workload.averageInputTokens")}
        value={workload.averageInputTokens}
        suffix={t("workload.tokensSuffix")}
        hint={t("workload.averageInputTokensHint")}
        onChange={(averageInputTokens) => onChange({ averageInputTokens })}
      />
      <NumberField
        label={t("workload.averageOutputTokens")}
        value={workload.averageOutputTokens}
        suffix={t("workload.tokensSuffix")}
        hint={t("workload.averageOutputTokensHint")}
        onChange={(averageOutputTokens) => onChange({ averageOutputTokens })}
      />
      <NumberField
        label={t("workload.averageAgentSteps")}
        value={workload.averageAgentSteps}
        min={0.1}
        step={0.5}
        integer={false}
        onChange={(averageAgentSteps) => onChange({ averageAgentSteps })}
      />
      <NumberField
        label={t("workload.peakConcurrentUsers")}
        value={workload.peakConcurrentUsers}
        min={1}
        onChange={(peakConcurrentUsers) => onChange({ peakConcurrentUsers })}
      />
      <NumberField
        label={t("workload.workingHoursDay")}
        value={workload.workingHoursPerDay}
        min={0.1}
        max={24}
        step={0.5}
        integer={false}
        suffix={t("workload.hoursSuffix")}
        onChange={(workingHoursPerDay) => onChange({ workingHoursPerDay })}
      />
      <NumberField
        label={t("workload.workingDaysMonth")}
        value={workload.workingDaysPerMonth}
        min={0.1}
        max={31}
        step={0.5}
        integer={false}
        suffix={t("workload.daysSuffix")}
        onChange={(workingDaysPerMonth) =>
          onChange({
            workingDaysPerMonth,
            ...(workload.mode === "simple"
              ? {
                  monthlyRequests: Math.round(
                    requestsPerUserDay * workload.users * workingDaysPerMonth,
                  ),
                }
              : {}),
          })
        }
      />
    </div>
  );

  const contextFields = (
    <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="flex items-start gap-2.5">
        <Info
          className="mt-0.5 size-4 shrink-0 text-blue-700"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-slate-900">
            {t("workload.contextCapacityTitle")}
          </h4>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            {t("workload.contextCapacityDescription")}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <NumberField
          label={t("workload.averageContextLength")}
          value={workload.averageContextLength}
          min={1}
          suffix={t("workload.contextTokensPerCall")}
          hint={t("workload.averageContextHint")}
          onChange={(averageContextLength) => {
            const peakContextLength = Math.max(
              workload.peakContextLength,
              averageContextLength,
            );
            setContextAdjustment(
              peakContextLength !== workload.peakContextLength
                ? {
                    kind: "peak-raised",
                    value: peakContextLength,
                  }
                : null,
            );
            onChange({ averageContextLength, peakContextLength });
          }}
        />
        <NumberField
          label={t("workload.peakContextLength")}
          value={workload.peakContextLength}
          min={1}
          suffix={t("workload.contextTokensPerCall")}
          hint={t("workload.peakContextHint")}
          onChange={(peakContextLength) => {
            const averageContextLength = Math.min(
              workload.averageContextLength,
              peakContextLength,
            );
            setContextAdjustment(
              averageContextLength !== workload.averageContextLength
                ? {
                    kind: "average-lowered",
                    value: averageContextLength,
                  }
                : null,
            );
            onChange({ peakContextLength, averageContextLength });
          }}
        />
      </div>

      {contextAdjustment ? (
        <div
          role="status"
          aria-live="polite"
          className="mt-4 flex gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs leading-5 text-blue-900"
        >
          <Info
            className="mt-0.5 size-3.5 shrink-0 text-blue-700"
            aria-hidden="true"
          />
          <p>
            {t(
              contextAdjustment.kind === "peak-raised"
                ? "workload.peakContextAutoRaised"
                : "workload.averageContextAutoLowered",
              { value: formatContextValue(contextAdjustment.value) },
            )}
          </p>
        </div>
      ) : null}
    </div>
  );

  return (
    <section id="workload" className="advisor-section">
      <SectionHeading
        id="workload-heading"
        title={t("workload.title")}
        description={
          analysisMode === "configuration-first"
            ? t("workload.configurationFirstDescription")
            : t("workload.description")
        }
        action={
          <SegmentedControl
            label={t("workload.inputMode")}
            value={workload.mode}
            onChange={(mode) => onChange({ mode })}
            options={[
              { value: "simple", label: t("workload.simple") },
              { value: "advanced", label: t("workload.advanced") },
            ]}
          />
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(330px,0.65fr)] lg:items-start">
        <Panel className="p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {workload.mode === "simple" ? (
              <>
                <SelectField
                  label={t("workload.useCase")}
                  value={workload.useCase}
                  options={useCases}
                  onChange={(useCase) => onChange({ useCase })}
                />
                <SelectField
                  label={t("workload.usageFrequency")}
                  value={workload.usageFrequency}
                  options={frequencies}
                  onChange={(usageFrequency) => onChange({ usageFrequency })}
                />
              </>
            ) : null}
            {qualitativeFields}
          </div>

          <div className="mt-4 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-950">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>{t("workload.policyClassificationNotice")}</p>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <article className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  {localized(privacyDefinition.labels)}
                </h3>
                <StatusBadge>{t("workload.dataPackDefinition")}</StatusBadge>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                {localized(privacyDefinition.description)}
              </p>
              <dl className="mt-3 grid gap-2 border-t border-slate-200 pt-3 text-xs leading-5">
                <div>
                  <dt className="font-bold text-slate-700">
                    {t("workload.example")}
                  </dt>
                  <dd className="text-slate-600">
                    {localized(privacyDefinition.example)}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold text-slate-700">
                    {t("workload.recommendationImpact")}
                  </dt>
                  <dd className="text-slate-600">
                    {localized(privacyDefinition.recommendationImpact)}
                  </dd>
                </div>
              </dl>
            </article>

            <article className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  {capabilityLabel}
                </h3>
                <StatusBadge>{t("workload.dataPackDefinition")}</StatusBadge>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                {localizedOptional(
                  capabilityDefinition?.description,
                  "workload.capabilityFallbackDescription",
                )}
              </p>
              <dl className="mt-3 grid gap-2 border-t border-slate-200 pt-3 text-xs leading-5">
                <div>
                  <dt className="font-bold text-slate-700">
                    {t("workload.example")}
                  </dt>
                  <dd className="text-slate-600">
                    {localizedOptional(
                      capabilityDefinition?.example,
                      "workload.capabilityFallbackExample",
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold text-slate-700">
                    {t("workload.recommendationImpact")}
                  </dt>
                  <dd className="text-slate-600">
                    {localizedOptional(
                      capabilityDefinition?.recommendationImpact,
                      "workload.capabilityFallbackImpact",
                    )}
                  </dd>
                </div>
              </dl>
            </article>

            <article className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  {localized(latencyDefinition.labels)}
                </h3>
                <StatusBadge tone="blue">
                  {t("workload.planningTarget")}
                </StatusBadge>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                {localized(latencyDefinition.description)}
              </p>
              <dl className="mt-3 grid gap-2 border-t border-slate-200 pt-3 text-xs leading-5 sm:grid-cols-2">
                <div>
                  <dt className="font-bold text-slate-700">
                    {t("workload.example")}
                  </dt>
                  <dd className="text-slate-600">
                    {localized(latencyDefinition.example)}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold text-slate-700">
                    {t("workload.targetTimeToFirstToken")}
                  </dt>
                  <dd className="font-bold tabular-nums text-slate-900">
                    {t("workload.secondsValue", {
                      value: new Intl.NumberFormat(locale, {
                        maximumFractionDigits: 2,
                      }).format(
                        latencyDefinition.targetTimeToFirstTokenSeconds,
                      ),
                    })}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-bold text-slate-700">
                    {t("workload.recommendationImpact")}
                  </dt>
                  <dd className="text-slate-600">
                    {localized(latencyDefinition.recommendationImpact)}
                  </dd>
                </div>
              </dl>
              <div className="mt-3 flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs leading-5 text-amber-900">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <p>{t("workload.ttftPlanningCaveat")}</p>
              </div>
            </article>
          </div>

          {workload.mode === "simple" ? (
            <div className="mt-5 flex gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs leading-5 text-blue-900">
              <Info
                className="mt-0.5 size-4 shrink-0 text-blue-700"
                aria-hidden="true"
              />
              <span>
                <strong>{t("workload.templateStartingPoint")}</strong>{" "}
                {t("workload.simpleTemplateHint")}
              </span>
            </div>
          ) : null}

          <div className="mt-5 border-t border-slate-200 pt-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-slate-800">
                <SlidersHorizontal className="size-4" aria-hidden="true" />
                <h3 className="text-sm font-bold">
                  {t("workload.editableAssumptions")}
                </h3>
              </div>
              {workload.mode === "simple" ? (
                <StatusBadge tone="blue">
                  {t("workload.derivedMonthlyRequests")}:{" "}
                  {formatTokens(workload.monthlyRequests, { compact: false })}
                </StatusBadge>
              ) : null}
            </div>
            {numericFields}
            {contextFields}
          </div>
        </Panel>

        <Panel tone="blue" className="p-5 lg:sticky lg:top-20">
          <div className="flex items-center gap-2 text-blue-800">
            <Calculator className="size-4.5" aria-hidden="true" />
            <h3 className="text-xs font-extrabold tracking-[0.09em] uppercase">
              {t("workload.monthlyTokenDemand")}
            </h3>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-600">
            {t("workload.monthlyTokenDemandDescription")}
          </p>

          <div className="mt-4 rounded-lg border border-blue-200 bg-white/80 p-4">
            <Metric
              label={t("workload.totalProcessedTokens")}
              value={formatTokens(tokenDemand.monthlyTotalTokens)}
              note={t("workload.tokensPerMonth")}
              emphasis
            />
          </div>

          <div className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-bold text-slate-700">
                {t("workload.monthlyComposition")}
              </h4>
              <span className="text-[11px] font-semibold text-slate-500">
                {t("workload.inputPlusOutput")}
              </span>
            </div>
            <div className="mt-2 grid min-w-0 grid-cols-2 gap-2">
              <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
                <Metric
                  label={t("workload.inputComponent")}
                  value={formatTokens(tokenDemand.monthlyInputTokens)}
                  note={t("workload.tokensPerMonth")}
                />
              </div>
              <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
                <Metric
                  label={t("workload.outputComponent")}
                  value={formatTokens(tokenDemand.monthlyOutputTokens)}
                  note={t("workload.tokensPerMonth")}
                />
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50/80 p-3">
            <p className="text-[11px] font-extrabold tracking-[0.07em] text-blue-800 uppercase">
              {t("workload.monthlyFormulaLabel")}
            </p>
            <p className="mt-1 break-words text-xs leading-5 font-semibold text-slate-700">
              {t("workload.monthlyFormula")}
            </p>
          </div>

          <div className="mt-4 border-t border-blue-200 pt-4">
            <Metric
              label={t("workload.requestsProcessed")}
              value={formatTokens(tokenDemand.monthlyRequests)}
              note={t("workload.requestsPerMonthUnit")}
            />
          </div>
          <Button
            variant="secondary"
            className="mt-5 w-full"
            onClick={onViewCalculation}
          >
            {t("workload.howCalculated")}
          </Button>
        </Panel>
      </div>
    </section>
  );
}
