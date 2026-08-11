import type {
  OpportunityPointView,
  OpportunityRegionView,
} from "../advisor-ui/viewModels";

export type OpportunityDeployment = OpportunityRegionView["deployment"];

export interface OpportunityBand {
  id: string;
  deployment: OpportunityDeployment;
  x1: number;
  x2: number;
}

export interface OpportunityBandRow {
  capabilityTierId: string;
  bands: OpportunityBand[];
}

const EPSILON = 1e-9;

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Coalesces adjacent cells with the same recommendation for a quieter visual.
 * It changes presentation only: every source boundary remains at its original
 * midpoint and no recommendation is recalculated here.
 */
export function buildOpportunityBandRows(
  regions: OpportunityRegionView[],
): OpportunityBandRow[] {
  const rows = new Map<string, OpportunityBand[]>();

  for (const region of regions) {
    if (!Number.isFinite(region.x1) || !Number.isFinite(region.x2)) continue;
    const x1 = clampRatio(Math.min(region.x1, region.x2));
    const x2 = clampRatio(Math.max(region.x1, region.x2));
    if (x2 - x1 <= EPSILON) continue;

    const row = rows.get(region.capabilityTierId) ?? [];
    row.push({
      id: region.id,
      deployment: region.deployment,
      x1,
      x2,
    });
    rows.set(region.capabilityTierId, row);
  }

  return [...rows.entries()].map(([capabilityTierId, unsortedBands]) => {
    const sortedBands = [...unsortedBands].sort(
      (left, right) => left.x1 - right.x1 || left.x2 - right.x2,
    );
    const bands: OpportunityBand[] = [];

    for (const band of sortedBands) {
      const previous = bands.at(-1);
      if (
        previous &&
        previous.deployment === band.deployment &&
        band.x1 <= previous.x2 + EPSILON
      ) {
        previous.x2 = Math.max(previous.x2, band.x2);
        previous.id = `${previous.id}+${band.id}`;
      } else {
        bands.push({ ...band });
      }
    }

    return { capabilityTierId, bands };
  });
}

/** Finds the displayed recommendation band containing the current point. */
export function findOpportunityDeployment(
  point: OpportunityPointView,
  rows: OpportunityBandRow[],
): OpportunityDeployment | null {
  const row = rows.find(
    (candidate) => candidate.capabilityTierId === point.capabilityTierId,
  );
  if (!row?.bands.length) return null;

  if (point.utilization < -EPSILON || point.utilization > 1 + EPSILON) {
    return null;
  }
  const utilization = clampRatio(point.utilization);
  const band = row.bands.find((candidate, index) => {
    const isLast = index === row.bands.length - 1;
    return (
      utilization >= candidate.x1 - EPSILON &&
      (utilization < candidate.x2 - EPSILON ||
        (isLast && utilization <= candidate.x2 + EPSILON))
    );
  });

  return band?.deployment ?? null;
}

/** Returns the sole recommendation when every displayed cell has one color. */
export function findUniformOpportunityDeployment(
  rows: OpportunityBandRow[],
): OpportunityDeployment | null {
  const deployments = new Set(
    rows.flatMap((row) => row.bands.map((band) => band.deployment)),
  );
  return deployments.size === 1
    ? (deployments.values().next().value ?? null)
    : null;
}
