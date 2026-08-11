import type {
  CapabilityTierDefinition,
  CapabilityTierId,
  CloudPricingRecord,
  InferenceProfileRecord,
  ModelRecord,
  ModelRequirementResult,
  WorkloadConfig,
} from "../types";
import {
  capabilityTierRank,
  compareCapabilityTiers,
} from "./capabilityTiers";

export interface ModelSelectionEvidence {
  inferenceProfiles: readonly InferenceProfileRecord[];
  cloudPricing: readonly CloudPricingRecord[];
}

interface ModelEvidenceAvailability {
  hasInferenceProfile: boolean;
  hasModelBoundCloudPricing: boolean;
  rank: number;
}

function modelEvidenceAvailability(
  model: ModelRecord,
  evidence: ModelSelectionEvidence,
): ModelEvidenceAvailability {
  const hasInferenceProfile = evidence.inferenceProfiles.some(
    (profile) =>
      profile.modelId === model.id &&
      profile.quantizationId === model.recommendedQuantizationId,
  );
  const hasModelBoundCloudPricing = evidence.cloudPricing.some(
    (pricing) => pricing.modelId === model.id,
  );

  return {
    hasInferenceProfile,
    hasModelBoundCloudPricing,
    // A model-bound cloud price is required for cloud/hybrid economics, so it
    // wins a partial-evidence tie. Both signals still rank above either alone.
    rank: (hasModelBoundCloudPricing ? 2 : 0) + (hasInferenceProfile ? 1 : 0),
  };
}

export function modelMeetsWorkload(
  model: ModelRecord,
  workload: WorkloadConfig,
  capabilityTiers: CapabilityTierDefinition[],
): boolean {
  const modelRank = capabilityTierRank(model.capabilityTierId, capabilityTiers);
  const requiredRank = capabilityTierRank(
    workload.capabilityRequirementTierId,
    capabilityTiers,
  );
  return (
    model.contextWindowTokens >= workload.peakContextLength &&
    modelRank !== null &&
    requiredRank !== null &&
    modelRank >= requiredRank &&
    (workload.privacyRequirement !== "critical" || model.openWeight)
  );
}

export function resolveModelRequirement(
  workload: WorkloadConfig,
  models: ModelRecord[],
  capabilityTiers: CapabilityTierDefinition[],
  requestedModelId?: string,
  selectionSource: "manual" | "configuration" = "manual",
  evidence?: ModelSelectionEvidence,
): ModelRequirementResult {
  const eligible = models
    .filter((model) => modelMeetsWorkload(model, workload, capabilityTiers))
    .sort((left, right) => {
      if (workload.privacyRequirement === "high" && left.openWeight !== right.openWeight) {
        return left.openWeight ? -1 : 1;
      }
      if (evidence) {
        const evidenceDifference =
          modelEvidenceAvailability(right, evidence).rank -
          modelEvidenceAvailability(left, evidence).rank;
        if (evidenceDifference !== 0) return evidenceDifference;
      }
      return (
        compareCapabilityTiers(left.capabilityTierId, right.capabilityTierId, capabilityTiers) ||
        left.totalParametersB - right.totalParametersB ||
        left.id.localeCompare(right.id)
      );
    });

  const requestedModel = requestedModelId
    ? models.find((model) => model.id === requestedModelId)
    : undefined;
  const selectedModel = requestedModel ?? eligible[0] ?? null;
  const warnings: string[] = [];
  const requirementRank = capabilityTierRank(
    workload.capabilityRequirementTierId,
    capabilityTiers,
  );

  if (requirementRank === null) {
    warnings.push(
      `Capability tier '${workload.capabilityRequirementTierId}' is not defined in assumptions.capabilityTiers.`,
    );
  }
  if (requestedModelId && !requestedModel) {
    warnings.push(`Selected model '${requestedModelId}' is not present in the model catalog.`);
  }
  if (requestedModel && requestedModel.contextWindowTokens < workload.peakContextLength) {
    warnings.push(`The ${selectionSource} model selection does not meet the peak context requirement.`);
  }
  if (
    requestedModel &&
    compareCapabilityTiers(
      requestedModel.capabilityTierId,
      workload.capabilityRequirementTierId,
      capabilityTiers,
    ) < 0
  ) {
    warnings.push(`The ${selectionSource} model selection is below the requested capability tier.`);
  }
  if (requestedModel && workload.privacyRequirement === "critical" && !requestedModel.openWeight) {
    warnings.push(`The ${selectionSource} model selection conflicts with the critical privacy requirement.`);
  }
  if (!selectedModel) warnings.push("No model in the bundled catalog meets all workload requirements.");

  const selectedEvidence =
    !requestedModel && selectedModel && evidence
      ? modelEvidenceAvailability(selectedModel, evidence)
      : null;
  if (selectedEvidence && selectedEvidence.rank < 3) {
    const missingEvidence = [
      ...(selectedEvidence.hasModelBoundCloudPricing ? [] : ["model-bound cloud pricing"]),
      ...(selectedEvidence.hasInferenceProfile
        ? []
        : ["a local inference profile for the recommended quantization"]),
    ];
    warnings.push(
      `RECOMMENDED_MODEL_EVIDENCE_FALLBACK: '${selectedModel.id}' is the eligible model with the strongest available catalog evidence, but it is missing ${missingEvidence.join(
        " and ",
      )}. Unavailable TPS or cloud cost will remain unavailable rather than borrowing evidence from another model.`,
    );
  }

  const normalizedTierCode = workload.capabilityRequirementTierId
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
  const reasonCodes = [
    `CAPABILITY_TIER_${normalizedTierCode}`,
    "CONTEXT_REQUIREMENT_APPLIED",
  ];
  if (workload.privacyRequirement === "high" || workload.privacyRequirement === "critical") {
    reasonCodes.push("OPEN_WEIGHT_PREFERRED");
  }
  if (requestedModel) {
    reasonCodes.push(
      selectionSource === "manual" ? "MANUAL_MODEL_OVERRIDE" : "CONFIGURATION_FIRST_SELECTION",
    );
  } else if (selectedEvidence?.rank === 3) {
    reasonCodes.push("MODEL_BOUND_CALCULATION_EVIDENCE");
  } else if (selectedEvidence) {
    reasonCodes.push("PARTIAL_MODEL_EVIDENCE_FALLBACK");
  }

  return {
    recommendedClass: workload.capabilityRequirementTierId,
    eligibleModelIds: eligible.map((model) => model.id),
    selectedModelId: selectedModel?.id ?? null,
    reasonCodes: reasonCodes.slice(0, 4),
    warnings,
  };
}

/** @deprecated Prefer compareCapabilityTiers. */
export function compareIntelligence(
  left: CapabilityTierId,
  right: CapabilityTierId,
  capabilityTiers: CapabilityTierDefinition[],
): number {
  return compareCapabilityTiers(left, right, capabilityTiers);
}
