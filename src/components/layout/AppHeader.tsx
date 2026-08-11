import { useState } from "react";
import {
  CheckCircle2,
  Cpu,
  Database,
  LoaderCircle,
  Menu,
  RotateCcw,
  Save,
  TriangleAlert,
  X,
} from "lucide-react";
import { useI18n, type Locale, type TranslationKey } from "../../i18n";
import type { AnalysisMode } from "../../types";
import { Button, IconButton, SegmentedControl } from "../ui/AdvisorUI";

const workloadFirstLinks = [
  { id: "workload", labelKey: "header.workload" },
  { id: "model", labelKey: "header.model" },
  { id: "hardware", labelKey: "header.hardware" },
  { id: "economics", labelKey: "header.economics" },
  { id: "decision", labelKey: "header.decision" },
] satisfies Array<{ id: string; labelKey: TranslationKey }>;

export function AppHeader({
  activeSection,
  analysisMode = "workload-first",
  onSave,
  saveStatus = "not-saved",
  lastSavedAt,
  onReset,
}: {
  activeSection?: string;
  analysisMode?: AnalysisMode;
  onSave: () => void;
  saveStatus?: "pending" | "saved" | "error" | "not-saved";
  lastSavedAt?: string | null;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { locale, setLocale, t } = useI18n();
  const links =
    analysisMode === "configuration-first"
      ? [
          workloadFirstLinks[2],
          workloadFirstLinks[1],
          workloadFirstLinks[0],
          ...workloadFirstLinks.slice(3),
        ]
      : workloadFirstLinks;
  const localeOptions: Array<{ value: Locale; label: string }> = [
    { value: "en", label: t("header.english") },
    { value: "zh-CN", label: t("header.chinese") },
  ];

  const goTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setOpen(false);
  };
  const saveLabel =
    saveStatus === "pending"
      ? t("header.savingScenario")
      : saveStatus === "saved"
        ? t("header.savedLocally")
        : saveStatus === "error"
          ? t("header.saveFailed")
          : t("header.saveScenario");
  const saveTitle = lastSavedAt
    ? t("header.lastSavedAt", {
        value: new Intl.DateTimeFormat(locale, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }).format(new Date(lastSavedAt)),
      })
    : t("header.autoSaveDescription");
  const saveIcon =
    saveStatus === "pending" ? (
      <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
    ) : saveStatus === "saved" ? (
      <CheckCircle2 className="size-4" aria-hidden="true" />
    ) : saveStatus === "error" ? (
      <TriangleAlert className="size-4" aria-hidden="true" />
    ) : (
      <Save className="size-4" aria-hidden="true" />
    );

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/90 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-5 px-4 sm:px-6 lg:px-8">
        <a
          href="#top"
          className="flex min-w-0 items-center gap-2.5 font-bold tracking-[-0.02em] text-slate-950"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-950 text-white">
            <Cpu className="size-4.5" aria-hidden="true" />
          </span>
          <span className="truncate">AI Compute Advisor</span>
        </a>

        <nav aria-label={t("header.analysisSections")} className="ml-4 hidden items-center gap-1 lg:flex">
          {links.map((link) => (
            <button
              key={link.id}
              type="button"
              onClick={() => goTo(link.id)}
              aria-current={activeSection === link.id ? "location" : undefined}
              className={`min-h-9 rounded-md px-3 text-sm font-semibold transition ${
                activeSection === link.id
                  ? "bg-slate-100 text-slate-950"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              {t(link.labelKey)}
            </button>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 sm:flex">
          <SegmentedControl
            label={t("header.language")}
            value={locale}
            options={localeOptions}
            onChange={setLocale}
          />
          <Button variant="ghost" onClick={() => goTo("data-status")}>
            <Database className="size-4" aria-hidden="true" />
            {t("header.dataStatus")}
          </Button>
          <Button
            variant="secondary"
            onClick={onSave}
            disabled={saveStatus === "pending"}
            aria-busy={saveStatus === "pending"}
            title={saveTitle}
          >
            {saveIcon}
            <span aria-live="polite">{saveLabel}</span>
          </Button>
          <Button variant="secondary" onClick={onReset}>
            <RotateCcw className="size-4" aria-hidden="true" />
            {t("header.reset")}
          </Button>
        </div>

        <IconButton
          label={open ? t("header.closeNavigation") : t("header.openNavigation")}
          className="ml-auto lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-navigation"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </IconButton>
      </div>

      {open ? (
        <div id="mobile-navigation" className="border-t border-slate-200 bg-white px-4 py-3 lg:hidden">
          <nav aria-label={t("header.mobileAnalysisSections")} className="mx-auto grid max-w-[1440px] gap-1">
            {links.map((link) => (
              <button
                key={link.id}
                type="button"
                onClick={() => goTo(link.id)}
                className="min-h-11 rounded-lg px-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {t(link.labelKey)}
              </button>
            ))}
            <div className="mt-2 border-t border-slate-200 pt-3 sm:hidden">
              <SegmentedControl
                label={t("header.language")}
                value={locale}
                options={localeOptions}
                onChange={setLocale}
                className="flex w-full"
              />
            </div>
            <div className="mt-2 grid gap-2 border-t border-slate-200 pt-3 sm:grid-cols-3">
              <Button variant="secondary" onClick={() => goTo("data-status")}>
                <Database className="size-4" /> {t("header.dataStatus")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  onSave();
                  setOpen(false);
                }}
                disabled={saveStatus === "pending"}
                aria-busy={saveStatus === "pending"}
                title={saveTitle}
              >
                {saveIcon} <span aria-live="polite">{saveLabel}</span>
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setOpen(false);
                  onReset();
                }}
              >
                <RotateCcw className="size-4" /> {t("header.reset")}
              </Button>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
