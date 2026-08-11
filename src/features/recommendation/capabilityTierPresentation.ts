import type {
  CapabilityTierDefinition,
  OpportunityMapCell,
} from "../../types";
import type { Locale } from "../../i18n";
import type { OpportunityRegionView } from "../advisor-ui/viewModels";

export interface CapabilityTierScaleItem {
  id: string;
  label: string;
  rank: number;
  position: number;
}

export interface CapabilityTierScale {
  tiers: CapabilityTierScaleItem[];
  ticks: number[];
  domain: [number, number];
}

export function capabilityTierLabel(
  tierId: string,
  capabilityTiers: CapabilityTierDefinition[],
  locale: Locale,
): string {
  const tier = capabilityTiers.find((candidate) => candidate.id === tierId);
  return tier?.labels[locale] ?? tier?.labels.en ?? tierId;
}

export function createCapabilityTierScale(
  capabilityTiers: CapabilityTierDefinition[],
  locale: Locale,
): CapabilityTierScale {
  const tiers = [...capabilityTiers]
    .sort((left, right) => left.rank - right.rank || left.id.localeCompare(right.id))
    .map((tier, position) => ({
      id: tier.id,
      label: tier.labels[locale] ?? tier.labels.en ?? tier.id,
      rank: tier.rank,
      position,
    }));

  if (tiers.length === 0) {
    return { tiers, ticks: [], domain: [0, 1] };
  }

  return {
    tiers,
    ticks: tiers.map((tier) => tier.position),
    domain: [-0.5, tiers.length - 0.5],
  };
}

export function buildOpportunityRegionViews(
  cells: OpportunityMapCell[],
): OpportunityRegionView[] {
  const utilizationValues = [
    ...new Set(cells.map((cell) => cell.utilizationRatio)),
  ].sort((left, right) => left - right);
  const step =
    utilizationValues.length > 1
      ? utilizationValues[1]! - utilizationValues[0]!
      : 0.1;

  return cells.map((cell, index) => ({
    id: `${cell.intelligenceClass}-${cell.utilizationRatio}-${index}`,
    deployment:
      cell.deployment === "constraint-conflict"
        ? "constraint"
        : cell.deployment,
    capabilityTierId: cell.intelligenceClass,
    x1: Math.max(0, cell.utilizationRatio - step / 2),
    x2: Math.min(1, cell.utilizationRatio + step / 2),
    label:
      index % Math.max(1, Math.floor(cells.length / 3)) === 0
        ? cell.deployment.replace("constraint-conflict", "constraint")
        : undefined,
  }));
}
