import { initialFieldFertility } from '../farming/farmFieldMath.ts';
import type { ForagingNodeState, ResourceNodeState } from '../resources/types.ts';

export const FOUNDING_TIMBER_RADIUS = 90;

export type FoundingSiteRating = 'promising' | 'workable' | 'demanding';

export type FoundingSiteAssessment = {
  score: number;
  rating: FoundingSiteRating;
  groundwater: number;
  matureTrees: number | null;
  quarryDistance: number | null;
  wildFoodDistance: number | null;
  fieldGround: number;
};

type FoundingSiteAssessmentOptions = {
  x: number;
  z: number;
  sampleGroundwater: (x: number, z: number) => number;
  countMatureTrees: ((x: number, z: number, radius: number) => number | null) | undefined;
  quarries: Iterable<ResourceNodeState>;
  foragingNodes: Iterable<ForagingNodeState>;
  getHeightAt: (x: number, z: number) => number;
};

const FIELD_SAMPLE_RADIUS = 52;
const FIELD_SAMPLE_COUNT = 8;
const FIELD_SLOPE_SAMPLE_OFFSET = 2;

/**
 * A non-binding logistics outlook for an upland founding site. Gorski Kotar's
 * forested karst terrain makes water, woodland access, stone, wild food, and
 * small pockets of workable ground more useful signals than a generic score.
 */
export function assessFoundingSite(
  options: FoundingSiteAssessmentOptions,
): FoundingSiteAssessment {
  const groundwater = clamp01(options.sampleGroundwater(options.x, options.z));
  const matureTrees = options.countMatureTrees?.(
    options.x,
    options.z,
    FOUNDING_TIMBER_RADIUS,
  ) ?? null;
  const quarryDistance = nearestAvailableNodeDistance(
    options.x,
    options.z,
    options.quarries,
  );
  const wildFoodDistance = nearestAvailableNodeDistance(
    options.x,
    options.z,
    options.foragingNodes,
  );
  const fieldGround = sampleNearbyFieldGround(options);

  const weightedFactors = [
    { value: clamp01((groundwater - 0.15) / 0.65), weight: 0.25 },
    {
      value: matureTrees == null ? null : clamp01(matureTrees / 36),
      weight: 0.25,
    },
    {
      value: distanceAccessScore(quarryDistance, 90, 650),
      weight: 0.20,
    },
    {
      value: distanceAccessScore(wildFoodDistance, 70, 450),
      weight: 0.15,
    },
    { value: fieldGround, weight: 0.15 },
  ] as const;
  let weightedScore = 0;
  let knownWeight = 0;
  for (const factor of weightedFactors) {
    if (factor.value == null) continue;
    weightedScore += factor.value * factor.weight;
    knownWeight += factor.weight;
  }
  const score = knownWeight > 0 ? clamp01(weightedScore / knownWeight) : 0;

  return {
    score,
    rating: score >= 0.72 ? 'promising' : score >= 0.47 ? 'workable' : 'demanding',
    groundwater,
    matureTrees,
    quarryDistance,
    wildFoodDistance,
    fieldGround,
  };
}

export function describeFoundingSiteAssessment(
  assessment: FoundingSiteAssessment,
): string {
  const timber = assessment.matureTrees == null
    ? 'timber survey pending'
    : `timber ${assessment.matureTrees} nearby`;
  return [
    `Founding outlook: ${assessment.rating}`,
    `water ${Math.round(assessment.groundwater * 100)}%`,
    timber,
    `stone ${formatDistance(assessment.quarryDistance)}`,
    `wild food ${formatDistance(assessment.wildFoodDistance)}`,
    `field ground ${Math.round(assessment.fieldGround * 100)}%`,
    'click to establish',
  ].join(' | ');
}

function sampleNearbyFieldGround(options: FoundingSiteAssessmentOptions): number {
  const samples: number[] = [];
  for (let index = 0; index < FIELD_SAMPLE_COUNT; index += 1) {
    const angle = (index / FIELD_SAMPLE_COUNT) * Math.PI * 2;
    const x = options.x + Math.cos(angle) * FIELD_SAMPLE_RADIUS;
    const z = options.z + Math.sin(angle) * FIELD_SAMPLE_RADIUS;
    const moisture = clamp01(options.sampleGroundwater(x, z));
    const slope = sampleLocalSlopeDegrees(x, z, options.getHeightAt);
    const soil = clamp01((initialFieldFertility(moisture, slope, x, z) - 0.35) / 0.60);
    const workableSlope = clamp01(1 - slope / 18);
    samples.push(soil * 0.55 + workableSlope * 0.45);
  }
  samples.sort((left, right) => right - left);
  const bestNearbyGround = samples.slice(0, 3);
  return bestNearbyGround.reduce((sum, value) => sum + value, 0)
    / Math.max(1, bestNearbyGround.length);
}

function sampleLocalSlopeDegrees(
  x: number,
  z: number,
  getHeightAt: (x: number, z: number) => number,
): number {
  const offset = FIELD_SLOPE_SAMPLE_OFFSET;
  const west = getHeightAt(x - offset, z);
  const east = getHeightAt(x + offset, z);
  const north = getHeightAt(x, z - offset);
  const south = getHeightAt(x, z + offset);
  if (![west, east, north, south].every(Number.isFinite)) return 45;
  const gradientX = (east - west) / (offset * 2);
  const gradientZ = (south - north) / (offset * 2);
  return Math.atan(Math.hypot(gradientX, gradientZ)) * 180 / Math.PI;
}

function nearestAvailableNodeDistance(
  x: number,
  z: number,
  nodes: Iterable<Pick<ResourceNodeState, 'x' | 'z' | 'remaining'>>,
): number | null {
  let nearest = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    if (node.remaining <= 0) continue;
    nearest = Math.min(nearest, Math.hypot(node.x - x, node.z - z));
  }
  return Number.isFinite(nearest) ? nearest : null;
}

function distanceAccessScore(
  distance: number | null,
  closeDistance: number,
  distantDistance: number,
): number {
  if (distance == null) return 0;
  return 1 - clamp01(
    (distance - closeDistance) / Math.max(1, distantDistance - closeDistance),
  );
}

function formatDistance(distance: number | null): string {
  return distance == null ? 'unavailable' : `${Math.round(distance)} m`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
