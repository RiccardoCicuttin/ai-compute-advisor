import { ExternalLink } from "lucide-react";
import { InlineNotice } from "../../components/ui/AdvisorUI";
import { useI18n } from "../../i18n";
import {
  ARTIFICIAL_ANALYSIS_CATEGORY_WEIGHTS,
  ARTIFICIAL_ANALYSIS_CURRENT_INTELLIGENCE_VERSION,
  ARTIFICIAL_ANALYSIS_EVALUATION_COUNT,
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_METHODOLOGY_URL,
} from "./intelligenceMethodology";

interface CatalogCohortDescriptor {
  sourceId: string;
  methodologyVersion: string;
  scaleMin: number;
  scaleMax: number;
}

export function IntelligenceMethodologyNotice({
  context,
  catalogCohort,
  importedVersions = [],
}: {
  context: "catalog" | "artificial-analysis-snapshot";
  catalogCohort?: CatalogCohortDescriptor | null;
  importedVersions?: readonly number[];
}) {
  const { locale, t } = useI18n();
  const formatNumber = (value: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  const uniqueVersions = [...new Set(importedVersions)].sort(
    (left, right) => left - right,
  );

  return (
    <InlineNotice
      tone="blue"
      title={t("intelligenceMethod.title")}
    >
      <div className="mt-1 grid gap-1.5 text-xs leading-5">
        <p>
          {t("intelligenceMethod.officialSummary", {
            version: ARTIFICIAL_ANALYSIS_CURRENT_INTELLIGENCE_VERSION,
            count: ARTIFICIAL_ANALYSIS_EVALUATION_COUNT,
            agents: ARTIFICIAL_ANALYSIS_CATEGORY_WEIGHTS.agents,
            coding: ARTIFICIAL_ANALYSIS_CATEGORY_WEIGHTS.coding,
            scientific:
              ARTIFICIAL_ANALYSIS_CATEGORY_WEIGHTS.scientificReasoning,
            general: ARTIFICIAL_ANALYSIS_CATEGORY_WEIGHTS.general,
          })}
        </p>
        <p>{t("intelligenceMethod.evaluationConditions")}</p>
        <p className="font-semibold">
          {t("intelligenceMethod.interpretationLimit")}
        </p>
        <p>{t("intelligenceMethod.cohortRule")}</p>

        {context === "catalog" ? (
          <>
            <p className="font-semibold text-amber-900">
              {t("intelligenceMethod.catalogSampleWarning")}
            </p>
            {catalogCohort ? (
              <p>
                {t("intelligenceMethod.currentCohort", {
                  source: catalogCohort.sourceId,
                  methodology: catalogCohort.methodologyVersion,
                  min: formatNumber(catalogCohort.scaleMin),
                  max: formatNumber(catalogCohort.scaleMax),
                })}
              </p>
            ) : null}
          </>
        ) : uniqueVersions.length ? (
          <p>
            {t("intelligenceMethod.snapshotVersions", {
              versions: uniqueVersions.map(formatNumber).join(", "),
            })}
          </p>
        ) : (
          <p className="font-semibold text-amber-900">
            {t("intelligenceMethod.snapshotVersionMissing")}
          </p>
        )}

        <a
          href={ARTIFICIAL_ANALYSIS_INTELLIGENCE_METHODOLOGY_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-0.5 inline-flex w-fit items-center gap-1 font-bold text-blue-800 underline decoration-blue-300 underline-offset-2"
        >
          {t("intelligenceMethod.officialMethodology")}
          <ExternalLink aria-hidden="true" className="size-3" />
        </a>
      </div>
    </InlineNotice>
  );
}
