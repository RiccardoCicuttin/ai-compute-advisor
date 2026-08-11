import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ModelComparisonView } from "../../features/advisor-ui/viewModels";
import type { CurrencyCode, ExchangeRateCatalog } from "../../currency";
import { convertUsdToDisplay } from "../../currency";
import { useI18n, type TranslationKey } from "../../i18n";
import { EmptyValue, SegmentedControl, StatusBadge } from "../ui/AdvisorUI";

type Metric =
  "intelligence" | "context" | "size" | "price" | "speed" | "latency";

interface ModelComparisonEvidenceView extends ModelComparisonView {
  priceProvider?: string | null;
  priceSourceUrl?: string | null;
  priceLastUpdated?: string | null;
  benchmarkSourceId?: string | null;
  benchmarkMeasuredAt?: string | null;
  benchmarkMethodology?: string | null;
}

const metricMeta: Record<
  Metric,
  {
    labelKey: TranslationKey;
    unitKey: TranslationKey;
    directionKey: TranslationKey;
  }
> = {
  intelligence: {
    labelKey: "model.metric.intelligence",
    unitKey: "model.metric.unit.index",
    directionKey: "model.metric.direction.higher",
  },
  context: {
    labelKey: "model.metric.context",
    unitKey: "model.metric.unit.tokens",
    directionKey: "model.metric.direction.higher",
  },
  size: {
    labelKey: "model.metric.size",
    unitKey: "model.metric.unit.parameters",
    directionKey: "model.metric.direction.context",
  },
  price: {
    labelKey: "model.metric.priceLong",
    unitKey: "model.metric.unit.price",
    directionKey: "model.metric.direction.lower",
  },
  speed: {
    labelKey: "model.metric.speed",
    unitKey: "model.metric.unit.speed",
    directionKey: "model.metric.direction.higher",
  },
  latency: {
    labelKey: "model.metric.latency",
    unitKey: "model.metric.unit.seconds",
    directionKey: "model.metric.direction.lower",
  },
};

function formatTick(
  value: number,
  metric: Metric,
  currency: CurrencyCode,
  exchangeRates: ExchangeRateCatalog,
  locale: string,
) {
  if (metric === "context") {
    return new Intl.NumberFormat(locale, { notation: "compact" }).format(value);
  }
  if (metric === "price") {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 0,
      maximumFractionDigits: 4,
    }).format(convertUsdToDisplay(value, currency, exchangeRates));
  }
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
    value,
  );
}

export function ModelComparisonChart({
  models,
  currency,
  exchangeRates,
  modelCatalogUpdatedAt,
}: {
  models: ModelComparisonEvidenceView[];
  currency: CurrencyCode;
  exchangeRates: ExchangeRateCatalog;
  modelCatalogUpdatedAt?: string;
}) {
  const { locale, t } = useI18n();
  const [metric, setMetric] = useState<Metric>("intelligence");
  const meta = metricMeta[metric];
  const metricLabel = t(meta.labelKey);
  const metricUnit = t(meta.unitKey, { currency });
  const metricHeading = `${metricLabel} (${metricUnit})`;
  const data = useMemo(
    () =>
      models
        .map((model) => ({ ...model, value: model[metric] }))
        .filter(
          (model): model is typeof model & { value: number } =>
            model.value !== null,
        ),
    [currency, exchangeRates, metric, models],
  );

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-950">
            {t("model.comparisonTitle")}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {metricUnit}, {t(meta.directionKey)}
          </p>
        </div>
        <div className="max-w-full overflow-x-auto pb-1">
          <SegmentedControl
            label={t("model.metric")}
            value={metric}
            onChange={setMetric}
            options={(Object.keys(metricMeta) as Metric[]).map((key) => ({
              value: key,
              label: t(metricMeta[key].labelKey),
            }))}
          />
        </div>
      </div>

      {data.length ? (
        <div
          className="h-[300px] w-full"
          role="img"
          aria-label={t("model.comparisonAria", {
            metric: metricLabel,
            count: data.length,
          })}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 0, right: 18, bottom: 28, left: 10 }}
            >
              <CartesianGrid
                stroke="#e2e8f0"
                strokeDasharray="3 3"
                horizontal={false}
              />
              <XAxis
                type="number"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#64748b", fontSize: 11 }}
                tickFormatter={(value: number) =>
                  formatTick(value, metric, currency, exchangeRates, locale)
                }
                label={{
                  value: metricHeading,
                  position: "insideBottom",
                  offset: -12,
                  fill: "#475569",
                  fontSize: 11,
                  fontWeight: 650,
                }}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={118}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#334155", fontSize: 11, fontWeight: 650 }}
              />
              <Tooltip
                cursor={{ fill: "#f1f5f9" }}
                formatter={(value) => [
                  `${formatTick(
                    Number(value),
                    metric,
                    currency,
                    exchangeRates,
                    locale,
                  )} · ${metricUnit}`,
                  metricLabel,
                ]}
                contentStyle={{ border: "1px solid #cbd5e1", borderRadius: 8 }}
              />
              <Bar
                dataKey="value"
                radius={[0, 4, 4, 0]}
                barSize={21}
                isAnimationActive={false}
              >
                {data.map((entry) => (
                  <Cell
                    key={entry.id}
                    fill={
                      entry.selected
                        ? "#1d4ed8"
                        : entry.recommended
                          ? "#64748b"
                          : "#cbd5e1"
                    }
                    stroke={entry.selected ? "#1e3a8a" : "transparent"}
                    strokeWidth={entry.selected ? 2 : 0}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="grid h-[260px] place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm">
          <EmptyValue>
            {t("model.noCompatibleMetric", { metric: metricLabel })}
          </EmptyValue>
        </div>
      )}

      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2 font-bold">{t("model.table.model")}</th>
              <th className="px-3 py-2 font-bold">
                {t("model.table.provider")}
              </th>
              <th className="px-3 py-2 text-right font-bold">
                {metricHeading}
              </th>
              <th className="px-3 py-2 font-bold">
                {t("model.table.evidence")}
              </th>
              <th className="px-3 py-2 font-bold">
                {t("model.table.selection")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {models.map((model) => (
              <tr
                key={model.id}
                className={model.selected ? "bg-blue-50/50" : "bg-white"}
              >
                <th className="px-3 py-2.5 font-bold text-slate-900">
                  {model.name}
                </th>
                <td className="px-3 py-2.5 text-slate-600">{model.provider}</td>
                <td className="px-3 py-2.5 text-right font-bold tabular-nums text-slate-900">
                  {model[metric] === null
                    ? t("common.notAvailable")
                    : metric === "price"
                      ? formatTick(
                          model[metric],
                          metric,
                          currency,
                          exchangeRates,
                          locale,
                        )
                      : formatTick(
                          model[metric],
                          metric,
                          currency,
                          exchangeRates,
                          locale,
                        )}
                </td>
                <td className="px-3 py-2.5 text-slate-600">
                  {metric === "price" ? (
                    model.price === null ? (
                      t("common.notAvailable")
                    ) : (
                      <div className="grid gap-0.5">
                        <span>
                          {model.priceProvider ?? t("common.notAvailable")}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {model.priceLastUpdated ?? t("common.notAvailable")}
                        </span>
                        {model.priceSourceUrl ? (
                          <a
                            className="font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2"
                            href={model.priceSourceUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t("model.table.openSource")}
                          </a>
                        ) : null}
                      </div>
                    )
                  ) : metric === "intelligence" ||
                    metric === "speed" ||
                    metric === "latency" ? (
                    model[metric] === null ? (
                      t("common.notAvailable")
                    ) : (
                      <div className="grid gap-0.5">
                        <span>
                          {model.benchmarkSourceId ?? t("common.notAvailable")}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {[
                            model.benchmarkMethodology,
                            model.benchmarkMeasuredAt,
                          ]
                            .filter(Boolean)
                            .join(" · ") || t("common.notAvailable")}
                        </span>
                      </div>
                    )
                  ) : (
                    <div className="grid gap-0.5">
                      <span>{t("model.table.modelCatalog")}</span>
                      <span className="text-[11px] text-slate-500">
                        {modelCatalogUpdatedAt ?? t("common.notAvailable")}
                      </span>
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {model.selected ? (
                    <StatusBadge tone="blue">{t("model.selected")}</StatusBadge>
                  ) : model.recommended ? (
                    <StatusBadge>{t("model.recommended")}</StatusBadge>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">
        {t("model.comparisonFootnote")}
      </p>
    </div>
  );
}
