import { Check, Sparkles } from "lucide-react";
import { useI18n } from "../../i18n";

export interface PresetItem {
  id: string;
  name: string;
  description?: string;
}

export function PresetRail({
  presets,
  selectedId,
  customized,
  onSelect,
}: {
  presets: PresetItem[];
  selectedId?: string;
  customized?: boolean;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <section aria-label={t("preset.ariaLabel")} className="border-b border-slate-200 bg-slate-50/75">
      <div className="mx-auto flex max-w-[1440px] items-center gap-3 overflow-x-auto px-4 py-3 sm:px-6 lg:px-8">
        <div className="sticky left-0 z-10 flex shrink-0 items-center gap-2 bg-slate-50/95 pr-2 text-xs font-bold text-slate-600">
          <Sparkles className="size-4 text-blue-700" aria-hidden="true" />
          {t("preset.label")}
        </div>
        {presets.map((preset) => {
          const active = selectedId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              title={preset.description}
              aria-pressed={active}
              onClick={() => onSelect(preset.id)}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-bold transition active:translate-y-px ${
                active
                  ? "border-blue-300 bg-blue-50 text-blue-800"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
              }`}
            >
              {active ? <Check className="size-3.5" aria-hidden="true" /> : null}
              {preset.name}
              {active && customized ? (
                <span className="font-semibold text-blue-600">{t("preset.customized")}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
