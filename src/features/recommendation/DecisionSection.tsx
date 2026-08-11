import {
  ArrowRight,
  CheckCircle2,
  ClipboardCopy,
  Cloud,
  Copy,
  GitMerge,
  ServerCog,
  Share2,
  TriangleAlert,
} from "lucide-react";
import type {
  AnalysisResult,
  CalculationTrace,
  CapabilityTierDefinition,
} from "../../types";
import { formatPercentage } from "../../utils";
import type { CurrencyCode, ExchangeRateCatalog } from "../../currency";
import { formatUsdAsCurrency } from "../../currency";
import { useI18n } from "../../i18n";
import { OpportunityMap } from "../../components/charts/OpportunityMap";
import {
  Button,
  InlineNotice,
  Metric,
  Panel,
  SectionHeading,
  StatusBadge,
  type Tone,
} from "../../components/ui/AdvisorUI";
import type {
  Deployment,
  OpportunityPointView,
  OpportunityRegionView,
} from "../advisor-ui/viewModels";
import { reasonLabel, sentenceCase } from "../advisor-ui/presentation";
import {
  buildOpportunityRegionViews,
  capabilityTierLabel,
} from "./capabilityTierPresentation";

const deploymentMeta: Record<
  Deployment,
  { icon: typeof ServerCog; color: string; tone: Tone }
> = {
  local: { icon: ServerCog, color: "text-emerald-700", tone: "green" },
  hybrid: { icon: GitMerge, color: "text-amber-700", tone: "amber" },
  cloud: { icon: Cloud, color: "text-blue-700", tone: "blue" },
};

function selectedMonthlyCost(analysis: AnalysisResult) {
  const deployment = analysis.recommendation.deployment;
  if (deployment === "local") return analysis.localCost?.monthlyTcoUSD ?? null;
  if (deployment === "hybrid") return analysis.hybridCost?.monthlyCostUSD ?? null;
  if (deployment === "cloud") return analysis.cloudCost?.monthlyCostUSD ?? null;
  return null;
}

export function DecisionSection({
  analysis,
  copied,
  shared,
  currency,
  exchangeRates,
  capabilityTiers,
  onCopySummary,
  onShare,
  onViewCalculation,
}: {
  analysis: AnalysisResult;
  copied: boolean;
  shared: boolean;
  currency: CurrencyCode;
  exchangeRates: ExchangeRateCatalog;
  capabilityTiers: CapabilityTierDefinition[];
  onCopySummary: () => void;
  onShare: () => void;
  onViewCalculation: (trace: CalculationTrace) => void;
}) {
  const { locale, t } = useI18n();
  const deployment = analysis.recommendation.deployment;
  const constraintConflict = analysis.recommendation.status === "constraint-conflict";
  const meta = deployment ? deploymentMeta[deployment] : null;
  const DecisionIcon = meta?.icon ?? TriangleAlert;
  const regions: OpportunityRegionView[] = buildOpportunityRegionViews(
    analysis.opportunityMap.cells,
  );
  const point: OpportunityPointView = {
    utilization: analysis.opportunityMap.currentPoint.utilizationRatio,
    capabilityTierId:
      analysis.opportunityMap.currentPoint.intelligenceClass,
    method: analysis.opportunityMap.currentPoint.method,
  };
  const recommendationTrace = analysis.traces.find((trace) => trace.id.includes("recommend"));
  const formatUsd = (value: number | null | undefined) =>
    value == null ? t("common.notAvailable") : formatUsdAsCurrency(value, currency, exchangeRates, { locale });
  const formatRatio = (value: number | null | undefined) =>
    value == null || !Number.isFinite(value)
      ? t("common.notAvailable")
      : formatPercentage(value);
  const localCoverage =
    deployment === "local"
      ? 1
      : deployment === "cloud"
        ? 0
        : analysis.hybridCost?.localCoverageRatio;
  const cloudEscalation =
    deployment === "local"
      ? 0
      : deployment === "cloud"
        ? 1
        : analysis.hybridCost?.cloudEscalationRatio;
  const breakEvenLabel =
    analysis.breakEven?.month.status === "available"
      ? `${analysis.breakEven.month.months?.toFixed(1)} ${t("common.months")}`
      : analysis.breakEven?.month.status === "none"
        ? t("decision.noEconomicBreakEven")
        : t("common.notAvailable");
  const fallbackTone: Tone = constraintConflict ? "red" : "amber";
  const fallbackColor = constraintConflict ? "text-red-700" : "text-amber-700";
  const decisionLabel = deployment
    ? sentenceCase(deployment, locale)
    : constraintConflict
      ? t("decision.constraint")
      : t("decision.incomplete");

  return (
    <section id="decision" className="advisor-section">
      <SectionHeading
        id="decision-heading"
        title={t("decision.title")}
        description={t("decision.description")}
        action={
          <div className="flex flex-col gap-2 sm:flex-row" aria-live="polite">
            <Button variant="secondary" onClick={onCopySummary}>
              {copied ? <CheckCircle2 className="size-4 text-emerald-700" /> : <Copy className="size-4" />}
              {copied ? t("decision.summaryCopied") : t("decision.copySummary")}
            </Button>
            <Button variant="secondary" onClick={onShare}>
              {shared ? <CheckCircle2 className="size-4 text-emerald-700" /> : <Share2 className="size-4" />}
              {shared ? t("decision.linkCopied") : t("decision.shareLink")}
            </Button>
          </div>
        }
      />

      <Panel tone={meta?.tone ?? fallbackTone} className="overflow-hidden">
        <div className="grid gap-px bg-slate-200 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="bg-white p-5 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <span className={`grid size-12 place-items-center rounded-xl bg-slate-50 ${meta?.color ?? fallbackColor}`}>
                <DecisionIcon className="size-6" aria-hidden="true" />
              </span>
              <StatusBadge tone={meta?.tone ?? fallbackTone}>{sentenceCase(analysis.recommendation.status, locale)}</StatusBadge>
            </div>
            <p className="mt-6 text-xs font-extrabold tracking-[0.1em] text-slate-500 uppercase">{t("decision.recommendedDeployment")}</p>
            <p className={`mt-1 break-words text-4xl font-black tracking-[-0.055em] sm:text-5xl ${meta?.color ?? fallbackColor}`}>
              {decisionLabel}
            </p>
            <h3 className="mt-7 text-sm font-bold text-slate-950">
              {deployment
                ? t("decision.whyDeployment", { deployment: sentenceCase(deployment, locale) })
                : constraintConflict
                  ? t("decision.whyConstrained")
                  : t("decision.whatMissing")}
            </h3>
            <ul className="mt-3 grid gap-2.5 text-sm leading-6 text-slate-700">
              {analysis.recommendation.reasonCodes.slice(0, 4).map((reason) => (
                <li key={reason} className="flex gap-2.5">
                  <CheckCircle2 className="mt-1 size-4 shrink-0 text-slate-500" aria-hidden="true" />
                  <span>{reasonLabel(reason, locale)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-slate-50/80 p-5 sm:p-7">
            <div className="grid grid-cols-2 gap-x-5 gap-y-5">
              <Metric label={t("decision.localCoverage")} value={formatRatio(localCoverage)} />
              <Metric label={t("decision.cloudEscalation")} value={formatRatio(cloudEscalation)} />
              <Metric label={t("decision.estimatedMonthlyCost")} value={formatUsd(selectedMonthlyCost(analysis))} emphasis className="col-span-2 border-y border-slate-200 py-4" />
              <Metric label={t("decision.cloudOnlyCost")} value={formatUsd(analysis.cloudCost?.monthlyCostUSD)} />
              <Metric label={t("decision.hybridSaving")} value={deployment === "hybrid" ? formatRatio(analysis.hybridCost?.savingVsCloudRatio) : t("decision.notApplicable")} />
              <Metric
                label={t("decision.localBreakEven")}
                value={breakEvenLabel}
                className="col-span-2"
              />
            </div>
          </div>
        </div>
      </Panel>

      <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="sticky left-0 z-10 w-48 border-r border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500">{t("decision.metric")}</th>
              {analysis.comparisons.map((comparison) => {
                const active = comparison.deployment === deployment;
                return (
                  <th key={comparison.deployment} className={`min-w-44 px-4 py-3 ${active ? "bg-blue-50" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-extrabold text-slate-900">{sentenceCase(comparison.deployment, locale)}</span>
                      {active ? <StatusBadge tone="blue">{t("decision.recommended")}</StatusBadge> : null}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[
              { label: t("common.feasible"), value: (item: AnalysisResult["comparisons"][number]) => item.feasible ? t("common.yes") : t("common.no") },
              { label: t("decision.monthlyCost"), value: (item: AnalysisResult["comparisons"][number]) => formatUsd(item.monthlyCostUSD) },
              { label: t("decision.threeYearTco"), value: (item: AnalysisResult["comparisons"][number]) => formatUsd(item.threeYearTcoUSD) },
              { label: t("economics.costPerMillion"), value: (item: AnalysisResult["comparisons"][number]) => item.costPerMillionTokensUSD === null ? t("common.notAvailable") : `${formatUsd(item.costPerMillionTokensUSD)} / 1M` },
              { label: t("decision.privacy"), value: (item: AnalysisResult["comparisons"][number]) => sentenceCase(item.privacy, locale) },
              { label: t("decision.latency"), value: (item: AnalysisResult["comparisons"][number]) => sentenceCase(item.latency, locale) },
              { label: t("decision.scalability"), value: (item: AnalysisResult["comparisons"][number]) => sentenceCase(item.scalability, locale) },
              { label: t("decision.intelligenceCeiling"), value: (item: AnalysisResult["comparisons"][number]) => capabilityTierLabel(item.intelligenceCeiling, capabilityTiers, locale) },
              { label: t("decision.hardwareInvestment"), value: (item: AnalysisResult["comparisons"][number]) => formatUsd(item.upfrontInvestmentUSD) },
            ].map((row) => (
              <tr key={row.label}>
                <th className="sticky left-0 z-10 border-r border-slate-200 bg-white px-4 py-3 font-semibold text-slate-600">{row.label}</th>
                {analysis.comparisons.map((comparison) => (
                  <td key={comparison.deployment} className={`px-4 py-3 font-semibold tabular-nums text-slate-900 ${comparison.deployment === deployment ? "bg-blue-50/45" : ""}`}>
                    {row.value(comparison)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <Panel className="min-w-0 p-4 sm:p-5">
          <OpportunityMap
            point={point}
            regions={regions}
            capabilityTiers={capabilityTiers}
          />
        </Panel>
        <Panel className="min-w-0 p-5">
          <h3 className="text-base font-bold text-slate-950">{t("decision.whatChanges")}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {t("decision.boundaryDescription")}
          </p>
          {analysis.recommendation.changeConditions.length ? (
            <ul className="mt-4 grid gap-3">
              {analysis.recommendation.changeConditions.map((condition, index) => (
                <li key={`${condition.target}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start gap-2.5">
                    <ArrowRight className="mt-0.5 size-4 shrink-0 text-blue-700" aria-hidden="true" />
                    <div>
                      <StatusBadge tone={deploymentMeta[condition.target].tone}>{sentenceCase(condition.target, locale)}</StatusBadge>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{condition.description}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <InlineNotice>{t("decision.adjustScenario")}</InlineNotice>
          )}

          {analysis.opportunityMap.boundaryReasonCodes.length ? (
            <div className="mt-5 border-t border-slate-200 pt-4">
              <p className="text-xs font-bold text-slate-500">{t("decision.strongestBoundaries")}</p>
              <ul className="mt-2 grid gap-1.5 text-sm text-slate-700">
                {analysis.opportunityMap.boundaryReasonCodes.slice(0, 2).map((reason) => (
                  <li key={reason}>{reasonLabel(reason, locale)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <Button variant="secondary" className="mt-5 w-full" disabled={!recommendationTrace} onClick={() => recommendationTrace && onViewCalculation(recommendationTrace)}>
            <ClipboardCopy className="size-4" /> {t("decision.viewRules")}
          </Button>
        </Panel>
      </div>
    </section>
  );
}
