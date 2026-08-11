import type { ModelBenchmarkRecord } from "../../types";
import type { ArtificialAnalysisComparisonRecord } from "../../data/schemas/artificialAnalysisComparisonSchemas";

export const ARTIFICIAL_ANALYSIS_INTELLIGENCE_METHODOLOGY_URL =
  "https://artificialanalysis.ai/methodology/intelligence-benchmarking";

export const ARTIFICIAL_ANALYSIS_CURRENT_INTELLIGENCE_VERSION = "4.1.1";
export const ARTIFICIAL_ANALYSIS_EVALUATION_COUNT = 9;
export const ARTIFICIAL_ANALYSIS_CATEGORY_WEIGHTS = {
  agents: 34,
  coding: 24,
  scientificReasoning: 24,
  general: 18,
} as const;

export function isSameBenchmarkCohort(
  left: ModelBenchmarkRecord,
  right: ModelBenchmarkRecord,
): boolean {
  if (left === right) return true;
  if (!left.intelligenceScale || !right.intelligenceScale) return false;

  return (
    left.sourceId === right.sourceId &&
    left.methodologyVersion === right.methodologyVersion &&
    left.intelligenceScale.min === right.intelligenceScale.min &&
    left.intelligenceScale.max === right.intelligenceScale.max
  );
}

export function isSameArtificialAnalysisSnapshotCohort(
  left: ArtificialAnalysisComparisonRecord,
  right: ArtificialAnalysisComparisonRecord,
): boolean {
  if (left === right) return true;
  if (
    left.intelligenceIndexVersion === null ||
    right.intelligenceIndexVersion === null
  ) {
    return false;
  }

  return (
    left.sourceEndpoint === right.sourceEndpoint &&
    left.intelligenceIndexVersion === right.intelligenceIndexVersion
  );
}
