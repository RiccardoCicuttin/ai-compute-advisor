import { useEffect, useRef } from "react";
import { Calculator, Database, X } from "lucide-react";
import type { CalculationTrace } from "../../types";
import { formatCalculationValue, sentenceCase } from "../advisor-ui/presentation";
import { IconButton, StatusBadge } from "../../components/ui/AdvisorUI";
import { useI18n } from "../../i18n";

function TraceTable({
  title,
  values,
}: {
  title: string;
  values: CalculationTrace["inputs"];
}) {
  const { locale } = useI18n();
  if (!values.length) return null;
  return (
    <div>
      <h4 className="mb-2 text-xs font-extrabold tracking-[0.08em] text-slate-500 uppercase">
        {title}
      </h4>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <tbody className="divide-y divide-slate-100">
            {values.map((value) => (
              <tr key={value.key}>
                <th className="px-3 py-2.5 font-semibold text-slate-700">{value.label}</th>
                <td className="px-3 py-2.5 text-right font-bold tabular-nums text-slate-950">
                  {formatCalculationValue(value, locale)}
                </td>
                <td className="hidden px-3 py-2.5 text-right text-xs text-slate-500 sm:table-cell">
                  {sentenceCase(value.source, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CalculationDrawer({
  trace,
  onClose,
}: {
  trace: CalculationTrace | null;
  onClose: () => void;
}) {
  const { locale, t } = useI18n();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!trace) return;
    headingRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, trace]);

  if (!trace) return null;

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        aria-label={t("drawer.close")}
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/35"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="calculation-drawer-title"
        className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[min(520px,92vw)] sm:rounded-none"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700">
              <Calculator className="size-4.5" aria-hidden="true" />
            </span>
            <div>
              <h3
                id="calculation-drawer-title"
                ref={headingRef}
                tabIndex={-1}
                className="text-lg font-bold tracking-[-0.02em] text-slate-950"
              >
                {trace.title}
              </h3>
              <div className="mt-1 flex items-center gap-2">
                <StatusBadge tone={trace.method === "unavailable" ? "amber" : "neutral"}>
                  {sentenceCase(trace.method, locale)}
                </StatusBadge>
                <span className="text-xs text-slate-500">{t("drawer.directional")}</span>
              </div>
            </div>
          </div>
          <IconButton label={t("drawer.close")} onClick={onClose}>
            <X className="size-5" aria-hidden="true" />
          </IconButton>
        </div>

        <div className="grid gap-6 px-5 py-6 sm:px-6">
          <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
            <p className="text-xs font-bold text-blue-700">{t("drawer.result")}</p>
            <p className="mt-1 text-3xl font-bold tracking-[-0.03em] tabular-nums text-slate-950">
              {formatCalculationValue(trace.result, locale)}
            </p>
          </div>

          <TraceTable title={t("drawer.inputs")} values={trace.inputs} />

          <div>
            <h4 className="mb-2 text-xs font-extrabold tracking-[0.08em] text-slate-500 uppercase">
              {t("drawer.formula")}
            </h4>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-950 px-4 py-3 font-mono text-xs leading-6 text-slate-100">
              {trace.formula}
            </pre>
          </div>

          <TraceTable title={t("drawer.intermediate")} values={trace.intermediateValues} />

          {trace.warnings.length ? (
            <div>
              <h4 className="mb-2 text-xs font-extrabold tracking-[0.08em] text-slate-500 uppercase">
                {t("drawer.caveats")}
              </h4>
              <ul className="grid gap-2 text-sm leading-6 text-amber-900">
                {trace.warnings.map((warning) => (
                  <li key={warning} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    {warning}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {trace.sourceIds.length ? (
            <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-600">
              <Database className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                {t("drawer.sourcesLabel")} <strong className="font-semibold text-slate-800">{trace.sourceIds.join(", ")}</strong>
              </span>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
