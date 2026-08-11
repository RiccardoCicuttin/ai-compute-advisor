import type {
  CapabilityTierDefinition,
  CapabilityTierId,
  ModelRecord,
  ModelRequirementResult,
  WorkloadConfig,
} from "../types";
import {
  capabilityTierRank,
  compareCapabilityTiers,
} from "./capabilityTiers";

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
): ModelRequirementResult {
  const eligible = models
    .filter((model) => modelMeetsWorkload(model, workload, capabilityTiers))
    .sort((left, right) => {
      if (workload.privacyRequirement === "high" && left.openWeight !== right.openWeight) {
        return left.openWeight ? -1 : 1;
      }
      return (
        compareCapabilityTiers(left.capabilityTierId, right.capabilityTierId, capabilityTiers) ||
        left.totalParametersB - right.totalParametersB
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
