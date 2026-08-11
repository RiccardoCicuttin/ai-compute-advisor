import { Cloud, GitMerge, MapPin, ServerCog, ShieldAlert } from "lucide-react";
import type {
  OpportunityPointView,
  OpportunityRegionView,
} from "../../features/advisor-ui/viewModels";
import {
  buildOpportunityBandRows,
  findOpportunityDeployment,
  findUniformOpportunityDeployment,
  type OpportunityDeployment,
} from "../../features/recommendation/opportunityMapPresentation";
import { createCapabilityTierScale } from "../../features/recommendation/capabilityTierPresentation";
import { sentenceCase } from "../../features/advisor-ui/presentation";
import type { CapabilityTierDefinition } from "../../types";
import { useI18n } from "../../i18n";
import { EmptyValue, StatusBadge } from "../ui/AdvisorUI";

const deploymentMeta: Record<
  OpportunityDeployment,
  {
    icon: typeof ServerCog;
    fill: string;
    border: string;
    text: string;
  }
> = {
  local: {
    icon: ServerCog,
    fill: "bg-emerald-100",
    border: "border-emerald-300",
    text: "text-emerald-950",
  },
  hybrid: {
    icon: GitMerge,
    fill: "bg-amber-100",
    border: "border-amber-300",
    text: "text-amber-950",
  },
  cloud: {
    icon: Cloud,
    fill: "bg-blue-100",
    border: "border-blue-300",
    text: "text-blue-950",
  },
  constraint: {
    icon: ShieldAlert,
    fill: "bg-rose-100",
    border: "border-rose-300",
    text: "text-rose-950",
  },
};

const xTicks = [0, 25, 50, 75, 100];

function percentage(value: number) {
  return `${Number((value * 100).toFixed(4))}%`;
}

function deploymentLabel(
  deployment: OpportunityDeployment,
  locale: "en" | "zh-CN",
) {
  return sentenceCase(deployment, locale);
}

export function OpportunityMap({
  point,
  regions,
  capabilityTiers,
}: {
  point: OpportunityPointView | null;
  regions: OpportunityRegionView[];
  capabilityTiers: CapabilityTierDefinition[];
}) {
  const { locale, t } = useI18n();
  const tierScale = createCapabilityTierScale(capabilityTiers, locale);
  const tierById = new Map(tierScale.tiers.map((tier) => [tier.id, tier]));
  const orderedTiers = [...tierScale.tiers].reverse();
  const bandRows = buildOpportunityBandRows(regions);
  const bandsByTier = new Map(
    bandRows.map((row) => [row.capabilityTierId, row.bands]),
  );
  const pointTier = point ? tierById.get(point.capabilityTierId) : undefined;
  const utilizationRatio = point ? Math.max(0, point.utilization) : null;
  const isOverflow = utilizationRatio !== null && utilizationRatio > 1;
  const currentDeployment = point
    ? findOpportunityDeployment(point, bandRows)
    : null;
  const uniformDeployment = findUniformOpportunityDeployment(bandRows);
  const currentMeta = isOverflow
    ? deploymentMeta.constraint
    : currentDeployment
      ? deploymentMeta[currentDeployment]
      : null;
  const CurrentDeploymentIcon = currentMeta?.icon ?? MapPin;
  const utilizationPercent = point
    ? Math.round((utilizationRatio ?? 0) * 100)
    : null;
  const markerPercent = Math.min(100, utilizationPercent ?? 0);
  const methodLabel = point
    ? point.method === "derived"
      ? t("map.methodDerived")
      : t("map.methodAssumed")
    : null;
  const xAxisLabel =
    point?.method === "derived"
      ? t("map.utilizationAxisDerived")
      : t("map.utilizationAxisAssumed");

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-950">
            {t("map.title")}
          </h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
            {t("map.descriptionDetailed")}
          </p>
        </div>
        <StatusBadge tone="blue">{t("map.sameRulesBadge")}</StatusBadge>
      </div>

      {point && pointTier ? (
        <>
          <div
            className={`mt-4 rounded-xl border p-3.5 ${
              currentMeta
                ? `${currentMeta.fill} ${currentMeta.border}`
                : "border-slate-200 bg-slate-50"
            }`}
          >
            <div className="flex items-start gap-3">
              <span
                className={`grid size-9 shrink-0 place-items-center rounded-lg border bg-white ${
                  currentMeta?.border ?? "border-slate-300"
                } ${currentMeta?.text ?? "text-slate-700"}`}
              >
                <CurrentDeploymentIcon
                  className="size-4.5"
                  aria-hidden="true"
                />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-extrabold tracking-[0.08em] text-slate-600 uppercase">
                  {t("map.currentRecommendation")}
                </p>
                <p
                  className={`mt-0.5 text-xl font-black tracking-[-0.025em] ${
                    currentMeta?.text ?? "text-slate-950"
                  }`}
                >
                  {isOverflow
                    ? t("map.currentOverflowRegion", {
                        utilization: utilizationPercent ?? 0,
                      })
                    : currentDeployment
                      ? t("map.currentRegion", {
                          deployment: deploymentLabel(
                            currentDeployment,
                            locale,
                          ),
                        })
                      : t("map.regionUnavailable")}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-slate-700">
                  <span>
                    {t("map.pointUtilization", {
                      utilization: utilizationPercent ?? 0,
                    })}
                  </span>
                  <span>
                    {t("map.pointCapability", { capability: pointTier.label })}
                  </span>
                  <span>{methodLabel}</span>
                </div>
              </div>
            </div>
            <p className="mt-3 border-t border-black/10 pt-2.5 text-xs leading-5 text-slate-700">
              {isOverflow
                ? t("map.currentOverflowReason", {
                    utilization: utilizationPercent ?? 0,
                    excess: Math.max(0, (utilizationPercent ?? 100) - 100),
                  })
                : currentDeployment
                  ? t("map.currentReason", {
                      utilization: utilizationPercent ?? 0,
                      capability: pointTier.label,
                      deployment: deploymentLabel(currentDeployment, locale),
                    })
                  : t("map.currentReasonUnavailable")}
            </p>
            {uniformDeployment ? (
              <p className="mt-2 rounded-lg border border-black/10 bg-white/70 px-3 py-2 text-xs font-bold leading-5 text-slate-800">
                {t("map.uniformRecommendation", {
                  deployment: deploymentLabel(uniformDeployment, locale),
                })}
              </p>
            ) : null}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(["local", "hybrid", "cloud", "constraint"] as const).map(
              (deployment) => {
                const meta = deploymentMeta[deployment];
                const Icon = meta.icon;
                return (
                  <div
                    key={deployment}
                    className={`flex min-h-10 items-center gap-2 rounded-lg border px-2.5 py-2 ${meta.fill} ${meta.border}`}
                  >
                    <Icon
                      className={`size-3.5 shrink-0 ${meta.text}`}
                      aria-hidden="true"
                    />
                    <span className={`text-xs font-bold ${meta.text}`}>
                      {deploymentLabel(deployment, locale)}
                    </span>
                  </div>
                );
              },
            )}
          </div>

          <div
            role="img"
            aria-label={t("map.ariaDetailed", {
              utilization: utilizationPercent ?? 0,
              intelligence: pointTier.label,
              deployment: currentDeployment
                ? deploymentLabel(currentDeployment, locale)
                : isOverflow
                  ? t("map.outsideDomain")
                  : t("common.notAvailable"),
            })}
            className="mt-4 rounded-xl border border-slate-200 bg-white p-2.5 sm:p-4"
          >
            <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-x-3">
              <div className="self-end pb-2 text-[10px] font-bold leading-4 text-slate-500 sm:text-xs">
                {t("map.capabilityAxis")}
                <span className="mt-0.5 block font-medium text-slate-400">
                  {t("map.capabilityAxisUnit")}
                </span>
              </div>
              <div className="flex items-center justify-between pb-2 text-[10px] font-semibold text-slate-400">
                <span>{t("map.lowerUtilization")}</span>
                <span>{t("map.higherUtilization")}</span>
              </div>

              {orderedTiers.map((tier, tierIndex) => {
                const bands = bandsByTier.get(tier.id) ?? [];
                const isCurrentTier = tier.id === point.capabilityTierId;
                return (
                  <div key={tier.id} className="contents">
                    <div
                      className={`flex min-h-12 items-center justify-end pr-1 text-right text-[10px] font-bold leading-4 sm:text-xs ${
                        isCurrentTier ? "text-slate-950" : "text-slate-600"
                      }`}
                    >
                      <span>
                        {tier.label}
                        {tierIndex === 0 ? (
                          <span className="block text-[9px] font-semibold text-slate-400">
                            {t("map.higherCapability")}
                          </span>
                        ) : tierIndex === orderedTiers.length - 1 ? (
                          <span className="block text-[9px] font-semibold text-slate-400">
                            {t("map.lowerCapability")}
                          </span>
                        ) : null}
                      </span>
                    </div>

                    <div
                      className={`relative my-1 h-11 overflow-hidden rounded-md border bg-slate-50 sm:h-12 ${
                        isCurrentTier
                          ? "border-slate-500 ring-1 ring-slate-400"
                          : "border-slate-200"
                      }`}
                    >
                      {bands.map((band) => {
                        const meta = deploymentMeta[band.deployment];
                        const width = Math.max(0, band.x2 - band.x1);
                        return (
                          <div
                            key={band.id}
                            className={`absolute inset-y-0 flex items-center justify-center overflow-hidden border-r px-0.5 ${meta.fill} ${meta.border} ${meta.text}`}
                            style={{
                              left: percentage(band.x1),
                              width: percentage(width),
                            }}
                            title={t("map.regionTitle", {
                              deployment: deploymentLabel(
                                band.deployment,
                                locale,
                              ),
                              capability: tier.label,
                              start: Math.round(band.x1 * 100),
                              end: Math.round(band.x2 * 100),
                            })}
                          >
                            <span className="max-w-full truncate text-[9px] font-extrabold sm:text-[10px]">
                              {deploymentLabel(band.deployment, locale)}
                            </span>
                          </div>
                        );
                      })}

                      {xTicks.map((tick) => (
                        <span
                          key={tick}
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-y-0 z-10 border-l border-slate-500/20"
                          style={{ left: `${tick}%` }}
                        />
                      ))}

                      {isCurrentTier ? (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-slate-950"
                          style={{
                            left: `clamp(6px, ${markerPercent}%, calc(100% - 6px))`,
                          }}
                        >
                          <span className="absolute top-1/2 left-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-slate-950 shadow-sm ring-1 ring-slate-950" />
                        </span>
                      ) : null}
                      {isCurrentTier && isOverflow ? (
                        <span className="absolute top-1 right-1 z-30 rounded bg-rose-700 px-1.5 py-0.5 text-[9px] font-extrabold text-white shadow-sm">
                          {t("map.overflowBadge", {
                            utilization: utilizationPercent ?? 0,
                          })}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}

              <div aria-hidden="true" />
              <div>
                <div className="relative h-5 border-t border-slate-300">
                  {xTicks.map((tick) => (
                    <span
                      key={tick}
                      className="absolute top-1 -translate-x-1/2 text-[9px] font-semibold tabular-nums text-slate-500 sm:text-[10px]"
                      style={{
                        left:
                          tick === 0
                            ? "2px"
                            : tick === 100
                              ? "calc(100% - 2px)"
                              : `${tick}%`,
                        transform:
                          tick === 0
                            ? "none"
                            : tick === 100
                              ? "translateX(-100%)"
                              : "translateX(-50%)",
                      }}
                    >
                      {tick}%
                    </span>
                  ))}
                </div>
                <p className="mt-1 text-center text-[10px] font-bold leading-4 text-slate-600 sm:text-xs">
                  {xAxisLabel}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-3 grid gap-2 text-[11px] leading-5 text-slate-500 sm:grid-cols-2 sm:text-xs">
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <strong className="text-slate-700">{t("map.axisMeaning")}</strong>{" "}
              {point.method === "derived"
                ? t("map.derivedMeaning")
                : t("map.assumedMeaning")}
            </p>
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <strong className="text-slate-700">
                {t("map.boundaryMeaning")}
              </strong>{" "}
              {t("map.samplingMeaning")}
            </p>
          </div>
          <p
            className={`mt-2 text-[11px] leading-5 ${
              isOverflow ? "font-semibold text-rose-700" : "text-slate-500"
            }`}
          >
            {isOverflow ? t("map.overflowMapNote") : t("map.currentPointNote")}
          </p>
        </>
      ) : (
        <div className="mt-4 grid min-h-52 place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 text-center text-sm">
          <EmptyValue>{t("map.completeWorkload")}</EmptyValue>
        </div>
      )}
    </div>
  );
}
