import { ArrowDown, Building2, Cloud, ServerCog } from "lucide-react";
import { useI18n } from "../../i18n";
import { Button } from "../ui/AdvisorUI";

export function Hero({ startSection = "workload" }: { startSection?: "workload" | "hardware" }) {
  const { t } = useI18n();
  const analyze = () => {
    const heading = document.getElementById(`${startSection}-heading`);
    heading?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => heading?.focus({ preventScroll: true }), 450);
  };

  return (
    <section id="top" className="border-b border-slate-200 bg-white">
      <div className="mx-auto grid max-w-[1440px] gap-8 px-4 py-12 sm:px-6 sm:py-14 lg:grid-cols-[minmax(0,1fr)_minmax(380px,0.62fr)] lg:items-end lg:px-8 lg:py-16">
        <div>
          <p className="mb-4 text-sm font-bold text-blue-700">{t("hero.eyebrow")}</p>
          <h1 className="max-w-4xl text-4xl font-bold leading-[1.05] tracking-[-0.045em] text-slate-950 sm:text-5xl lg:text-[3.65rem]">
            {t("hero.title")}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
            {t("hero.description")}
          </p>
          <Button className="mt-7 w-full sm:w-auto" onClick={analyze}>
            {t(startSection === "hardware" ? "hero.actionConfiguration" : "hero.action")}
            <ArrowDown className="size-4" aria-hidden="true" />
          </Button>
        </div>

        <div className="grid grid-cols-3 divide-x divide-slate-200 rounded-xl border border-slate-200 bg-slate-50/70">
          {[
            { label: t("common.local"), icon: ServerCog, tone: "text-emerald-700" },
            { label: t("common.hybrid"), icon: Building2, tone: "text-amber-700" },
            { label: t("common.cloud"), icon: Cloud, tone: "text-blue-700" },
          ].map(({ label, icon: Icon, tone }) => (
            <div key={label} className="flex flex-col items-center gap-2 px-2 py-5 text-center sm:py-7">
              <Icon className={`size-5 ${tone}`} strokeWidth={1.8} aria-hidden="true" />
              <span className="text-xs font-extrabold tracking-[0.12em] text-slate-800">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
