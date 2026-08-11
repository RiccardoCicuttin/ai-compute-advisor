import type { CapabilityTierDefinition, CapabilityTierId } from "../types";

export function orderedCapabilityTiers(
  tiers: CapabilityTierDefinition[],
): CapabilityTierDefinition[] {
  return [...tiers].sort((left, right) => left.rank - right.rank);
}

export function capabilityTierRank(
  tierId: CapabilityTierId,
  tiers: CapabilityTierDefinition[],
): number | null {
  return tiers.find((tier) => tier.id === tierId)?.rank ?? null;
}

/** Known tiers sort above unknown IDs; two identical unknown IDs compare equal. */
export function compareCapabilityTiers(
  left: CapabilityTierId,
  right: CapabilityTierId,
  tiers: CapabilityTierDefinition[],
): number {
  if (left === right) return 0;
  const leftRank = capabilityTierRank(left, tiers);
  const rightRank = capabilityTierRank(right, tiers);
  if (leftRank === null) return rightRank === null ? left.localeCompare(right) : -1;
  if (rightRank === null) return 1;
  return leftRank - rightRank;
}

export function lowestCapabilityTierId(
  tiers: CapabilityTierDefinition[],
): CapabilityTierId | null {
  return orderedCapabilityTiers(tiers)[0]?.id ?? null;
}

export function highestCapabilityTierId(
  tiers: CapabilityTierDefinition[],
): CapabilityTierId | null {
  return orderedCapabilityTiers(tiers).at(-1)?.id ?? null;
}
