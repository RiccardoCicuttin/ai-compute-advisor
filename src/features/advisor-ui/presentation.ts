import type { CalculationUnit, CalculationValue } from "../../types";
import { formatCurrency, formatMemory, formatPercentage, formatTokens } from "../../utils";
import { translate, translateDynamic, type Locale } from "../../i18n";

export function formatNumber(
  value: number | null | undefined,
  maximumFractionDigits = 1,
  locale: Locale = "en",
) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return translate(locale, "common.notAvailable");
  }
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
}

export function formatTraceValue(
  value: number | string | null,
  unit: CalculationUnit,
  locale: Locale = "en",
) {
  if (value === null) return translate(locale, "common.notAvailable");
  if (typeof value === "string" || unit === "text") return String(value);
  if (unit === "USD" || unit === "USD/month") return formatCurrency(value);
  if (unit === "USD/1M tokens") return `${formatCurrency(value)} / 1M`;
  if (unit === "tokens" || unit === "tokens/month") return formatTokens(value);
  if (unit === "GB") return formatMemory(value);
  if (unit === "ratio") return formatPercentage(value);
  if (unit === "months") return `${formatNumber(value, 1, locale)} ${translate(locale, "common.months")}`;
  if (unit === "hours") return `${formatNumber(value, 1, locale)} ${translate(locale, "common.hours")}`;
  if (unit === "watts") return `${formatNumber(value, 0, locale)} W`;
  if (unit === "tokens/second") return `${formatNumber(value, 1, locale)} tok/s`;
  return formatNumber(value, 1, locale);
}

export function formatCalculationValue(value: CalculationValue, locale: Locale = "en") {
  return formatTraceValue(value.rawValue, value.unit, locale);
}

export function sentenceCase(value: string, locale: Locale = "en") {
  const fallback = value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .toLowerCase()
    .replace(/^./, (character) => character.toUpperCase());
  return translateDynamic(locale, `status.${value}`, fallback);
}

export const reasonCopy: Record<string, string> = {
  CRITICAL_PRIVACY_REQUIRES_LOCAL: "Critical privacy requires data to remain on local infrastructure.",
  LOCAL_HARDWARE_INFEASIBLE: "The selected local hardware cannot fit the required model and context.",
  LOCAL_PERFORMANCE_INSUFFICIENT: "Estimated workload demand exceeds the selected local performance capacity.",
  LOCAL_RUNTIME_UNVERIFIED: "The selected system does not yet have confirmed runtime support for a reliable local path.",
  LOCAL_MODEL_MEETS_REQUIREMENTS: "The selected local model meets the workload requirements.",
  LOCAL_MODEL_INTELLIGENCE_GAP: "The local model does not meet the required intelligence level.",
  FRONTIER_CLOUD_REQUIRED: "Frontier reasoning still requires access to a cloud model.",
  HIGH_LOCAL_COVERAGE: "Most routine requests can be served locally.",
  UTILIZATION_ABOVE_BREAK_EVEN: "Expected utilization is above the local economic threshold.",
  NO_ECONOMIC_BREAK_EVEN: "Local hardware does not reach economic break-even under current assumptions.",
  LOCAL_ECONOMICS_UNFAVORABLE: "Local economics are outside the preferred cost or break-even range.",
  LOCAL_LOWER_MONTHLY_COST: "Local monthly cost is lower for this workload density.",
  HYBRID_SAVES_VS_CLOUD: "Hybrid reduces cloud spend while preserving escalation capacity.",
  CLOUD_AVOIDS_CAPEX: "Cloud avoids upfront hardware investment and scales with demand.",
  REAL_TIME_NETWORK_LATENCY_PREFERENCE: "The latency requirement favors a local execution path.",
  INCOMPLETE_INPUTS: "Complete the highlighted inputs to receive a recommendation.",
  NO_CLOUD_OFFERING: "No compatible cloud offering is available in the current data catalog.",
};

export function reasonLabel(code: string, locale: Locale = "en") {
  return translateDynamic(
    locale,
    `reason.${code}`,
    reasonCopy[code] ?? sentenceCase(code, locale),
  );
}
