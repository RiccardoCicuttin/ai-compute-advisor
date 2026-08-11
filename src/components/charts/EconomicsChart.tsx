import { useState } from "react";
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
import type { DeploymentComparisonView } from "../../features/advisor-ui/viewModels";
import type { CurrencyCode, ExchangeRateCatalog } from "../../currency";
import { convertUsdToDisplay, formatCurrencyAmount } from "../../currency";
import { useI18n } from "../../i18n";
import { EmptyValue, SegmentedControl } from "../ui/AdvisorUI";

const colors = {
  local: "#168266",
  hybrid: "#c17a19",
  cloud: "#2d6cdf",
};

export function EconomicsChart({ comparisons, currency, exchangeRates }: { comparisons: DeploymentComparisonView[]; currency: CurrencyCode; exchangeRates: ExchangeRateCatalog }) {
  const { locale, t } = useI18n();
  const [metric, setMetric] = useState<"monthly" | "tco">("monthly");
  const deploymentLabels = {
    local: t("common.local"),
    hybrid: t("common.hybrid"),
    cloud: t("common.cloud"),
  };
  const data = comparisons.map((item) => ({
    name: deploymentLabels[item.deployment],
    deployment: item.deployment,
    value: (metric === "monthly" ? item.monthlyCost : item.threeYearTco) === null
      ? null
      : convertUsdToDisplay((metric === "monthly" ? item.monthlyCost : item.threeYearTco)!, currency, exchangeRates),
  }));
  const available = data.filter((item) => item.value !== null);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-950">{t("chart.costComparison")}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{t("chart.lowerBetter", { currency })}</p>
        </div>
        <SegmentedControl
          label={t("chart.costPeriod")}
          value={metric}
          onChange={setMetric}
          options={[
            { value: "monthly", label: t("chart.monthlyCost") },
            { value: "tco", label: t("chart.threeYearTco") },
          ]}
        />
      </div>
      {available.length ? (
        <div
          role="img"
          aria-label={t("chart.costAria", {
            period: metric === "monthly" ? t("chart.monthlyCost") : t("chart.threeYearTco"),
          })}
          className="h-[280px] w-full"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={available}
              layout="vertical"
              margin={{ top: 4, right: 18, bottom: 4, left: 0 }}
            >
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#64748b", fontSize: 11 }}
                tickFormatter={(value: number) =>
                  new Intl.NumberFormat(locale, { notation: "compact" }).format(value)
                }
              />
              <YAxis
                type="category"
                dataKey="name"
                width={58}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#334155", fontSize: 12, fontWeight: 700 }}
              />
              <Tooltip
                cursor={{ fill: "#f1f5f9" }}
                formatter={(value) => [formatCurrencyAmount(Number(value), currency, exchangeRates, { locale }), t("common.cost")]}
                contentStyle={{
                  border: "1px solid #cbd5e1",
                  borderRadius: 8,
                  boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
                }}
              />
              <Bar dataKey="value" radius={[0, 5, 5, 0]} barSize={30} isAnimationActive={false}>
                {available.map((entry) => (
                  <Cell key={entry.deployment} fill={colors[entry.deployment]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="grid h-[280px] place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm">
          <EmptyValue>{t("chart.completeEconomics")}</EmptyValue>
        </div>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-200 pt-3 text-sm">
        {data.map((item) => (
          <div key={item.deployment}>
            <span className="block text-xs font-semibold capitalize text-slate-500">
              {item.deployment}
            </span>
            <span className="mt-0.5 block font-bold tabular-nums text-slate-900">
              {item.value === null ? t("common.notAvailable") : formatCurrencyAmount(item.value, currency, exchangeRates, { locale })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
