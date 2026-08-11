import { ClipboardList, MonitorCog } from "lucide-react";
import type { AnalysisMode } from "../../types";
import { useI18n } from "../../i18n";
import { StatusBadge } from "../../components/ui/AdvisorUI";

export function AnalysisModeControl({
  value,
  onChange,
}: {
  value: AnalysisMode;
  onChange: (value: AnalysisMode) => void;
}) {
  const { t } = useI18n();
  const options = [
    {
      value: "workload-first" as const,
      label: t("workflow.workloadFirst"),
      description: t("workflow.workloadFirstDescription"),
      icon: ClipboardList,
    },
    {
      value: "configuration-first" as const,
      label: t("workflow.configurationFirst"),
      description: t("workflow.configurationFirstDescription"),
      icon: MonitorCog,
    },
  ];

  return (
    <section
      aria-label={t("workflow.label")}
      className="border-b border-slate-200 bg-white"
    >
      <div className="mx-auto grid max-w-[1440px] gap-2 px-4 py-4 sm:grid-cols-2 sm:px-6 lg:px-8">
        {options.map((option) => {
          const selected = value === option.value;
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={`flex min-h-20 items-start gap-3 rounded-xl border p-3 text-left transition active:translate-y-px sm:p-4 ${
                selected
                  ? "border-blue-400 bg-blue-50/70 shadow-sm"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <span
                className={`grid size-9 shrink-0 place-items-center rounded-lg ${
                  selected
                    ? "bg-blue-700 text-white"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                <Icon className="size-4.5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-950">
                  {option.label}
                  {selected ? (
                    <StatusBadge tone="blue">{t("workflow.active")}</StatusBadge>
                  ) : null}
                </span>
                <span className="mt-1 block text-xs leading-5 text-slate-600">
                  {option.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
