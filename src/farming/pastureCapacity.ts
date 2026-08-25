import {
  CATTLE_AREA_PER_HEAD,
  CATTLE_MAX_HERD,
  CATTLE_MAX_SLOPE_DEGREES,
  CATTLE_MOISTURE_IDEAL,
  CATTLE_MOISTURE_TOLERANCE,
  SHEEP_AREA_PER_HEAD,
  SHEEP_MAX_HERD,
  SHEEP_MAX_SLOPE_DEGREES,
  SHEEP_MOISTURE_IDEAL,
  SHEEP_MOISTURE_TOLERANCE,
  SWINE_AREA_PER_HEAD,
  SWINE_MATURE_TREES_PER_HEAD,
  SWINE_MAX_HERD,
} from '../generated/gameBalance.ts';
import type { TreeRegistry } from '../resources/TreeRegistry.ts';
import type {
  GameState,
  LivestockHerdState,
  LivestockSpecies,
  PastureState,
} from '../resources/types.ts';
import { isPointInPolygon2 } from '../utils/polygonGeometry.ts';

type PastureCapacityParcel = Pick<
  PastureState,
  'area' | 'averageSlopeDegrees' | 'moisture'
>;

type PasturePolygon = Pick<PastureState, 'corners'>;

export type PannageHoldingCapacity = {
  /** Ceiling imposed by the total fenced woodland area. */
  areaHeadCapacity: number;
  /** Ceiling imposed by live mature mast trees inside the fenced polygons. */
  mastHeadCapacity: number;
  /** Neutral-season carrying capacity before the seasonal pasture multiplier. */
  headCapacity: number;
  matureTrees: number;
};

type GrazingProfile = {
  areaPerHead: number;
  maxSlopeDegrees: number;
  moistureIdeal: number;
  moistureTolerance: number;
};

const GRAZING_PROFILE: Record<'cattle' | 'sheep', GrazingProfile> = {
  cattle: {
    areaPerHead: CATTLE_AREA_PER_HEAD,
    maxSlopeDegrees: CATTLE_MAX_SLOPE_DEGREES,
    moistureIdeal: CATTLE_MOISTURE_IDEAL,
    moistureTolerance: CATTLE_MOISTURE_TOLERANCE,
  },
  sheep: {
    areaPerHead: SHEEP_AREA_PER_HEAD,
    maxSlopeDegrees: SHEEP_MAX_SLOPE_DEGREES,
    moistureIdeal: SHEEP_MOISTURE_IDEAL,
    moistureTolerance: SHEEP_MOISTURE_TOLERANCE,
  },
};

/** Area-only ceiling. Woodland pannage may be lower when mature trees are scarce. */
export function pastureAreaHeadCapacity(
  pasture: Pick<PastureState, 'area'>,
  species: LivestockSpecies,
): number {
  const areaPerHead = species === 'cattle'
    ? CATTLE_AREA_PER_HEAD
    : species === 'sheep'
      ? SHEEP_AREA_PER_HEAD
      : SWINE_AREA_PER_HEAD;
  return Math.max(0, pasture.area) / Math.max(1, areaPerHead);
}

/** Mirrors the authoritative neutral-season cattle/sheep grazing calculation. */
export function neutralPastureHeadCapacity(
  pasture: PastureCapacityParcel,
  species: LivestockSpecies,
): number | null {
  if (species === 'swine') return null;
  const profile = GRAZING_PROFILE[species];
  const slopeQuality = Math.max(
    0.5,
    Math.min(
      1,
      1 - 0.35 * Math.max(0, pasture.averageSlopeDegrees)
        / Math.max(1, profile.maxSlopeDegrees),
    ),
  );
  const moistureQuality = Math.max(
    0.45,
    Math.min(
      1,
      1 - 0.45 * Math.abs(pasture.moisture - profile.moistureIdeal)
        / Math.max(0.01, profile.moistureTolerance),
    ),
  );
  return pastureAreaHeadCapacity(pasture, species) * slopeQuality * moistureQuality;
}

/** Neutral-season capacity of every cattle/sheep parcel linked to one holding. */
export function neutralPastureHoldingHeadCapacity(
  pastures: Iterable<PastureCapacityParcel>,
  species: Exclude<LivestockSpecies, 'swine'>,
): number {
  let capacity = 0;
  for (const pasture of pastures) {
    capacity += neutralPastureHeadCapacity(pasture, species) ?? 0;
  }
  return capacity;
}

/**
 * Neutral woodland-pannage capacity. Area and live mast are independent hard
 * ceilings, so expanding only the non-limiting side may add no supported pigs.
 */
export function pannageHoldingHeadCapacity(
  pastures: Iterable<Pick<PastureState, 'area'>>,
  matureTrees: number,
): PannageHoldingCapacity {
  let areaHeadCapacity = 0;
  for (const pasture of pastures) {
    areaHeadCapacity += pastureAreaHeadCapacity(pasture, 'swine');
  }
  const normalizedMatureTrees = Math.max(0, Math.floor(matureTrees));
  const mastHeadCapacity = normalizedMatureTrees
    / Math.max(0.1, SWINE_MATURE_TREES_PER_HEAD);
  return {
    areaHeadCapacity,
    mastHeadCapacity,
    headCapacity: Math.min(areaHeadCapacity, mastHeadCapacity),
    matureTrees: normalizedMatureTrees,
  };
}

export function livestockHoldingWholeHeadLimit(
  neutralCapacity: number,
  species: LivestockSpecies,
): number {
  const maximumHerd = species === 'cattle'
    ? CATTLE_MAX_HERD
    : species === 'sheep'
      ? SHEEP_MAX_HERD
      : SWINE_MAX_HERD;
  return Math.min(
    maximumHerd,
    Math.max(0, Math.floor(Math.max(0, neutralCapacity) + 1e-9)),
  );
}

/** Mirrors the server's shared husbandry-management budget for one holding. */
export const PASTORAL_MANAGEMENT_UNITS = 60;
export const SWINE_MANAGEMENT_UNITS = 30;

export function livestockManagementUnitsPerHead(species: LivestockSpecies): number {
  return species === 'cattle' ? 3 : 1;
}

/**
 * Maximum head of `species` that one selected pasture may contain after every
 * sibling herd has claimed its share of the linked holding's management cap.
 */
export function livestockPastureManagementHeadAllowance(
  species: LivestockSpecies,
  siblingHerds: Iterable<Pick<LivestockHerdState, 'species' | 'headCount'>>,
): number {
  let usedUnits = 0;
  for (const herd of siblingHerds) {
    usedUnits += Math.max(0, Math.floor(herd.headCount))
      * livestockManagementUnitsPerHead(herd.species);
  }
  const budget = species === 'swine'
    ? SWINE_MANAGEMENT_UNITS
    : PASTORAL_MANAGEMENT_UNITS;
  return Math.max(
    0,
    Math.floor((budget - usedUnits) / livestockManagementUnitsPerHead(species)),
  );
}

/**
 * Counts authoritative mature trees inside the exact union of authored
 * pannage polygons. Each parcel performs one spatial-index query against its
 * bounding circle, then exact polygon containment filters the small candidate
 * set. The id set prevents double-counting if callers provide touching or
 * temporarily overlapping draft polygons.
 */
export function countMatureTreesInPasturePolygons(
  state: Pick<GameState, 'trees'>,
  treeRegistry: Pick<TreeRegistry, 'treesInRadiusInto'>,
  pastures: Iterable<PasturePolygon>,
): number {
  const countedTreeIds = new Set<string>();
  const candidates: ReturnType<TreeRegistry['treesInRadius']> = [];

  for (const pasture of pastures) {
    const corners = pasture.corners;
    if (corners.length < 3) continue;
    let centerX = 0;
    let centerZ = 0;
    for (const corner of corners) {
      centerX += corner.x;
      centerZ += corner.z;
    }
    centerX /= corners.length;
    centerZ /= corners.length;
    let radius = 0;
    for (const corner of corners) {
      radius = Math.max(radius, Math.hypot(corner.x - centerX, corner.z - centerZ));
    }

    treeRegistry.treesInRadiusInto(centerX, centerZ, radius + 1e-6, candidates);
    for (const candidate of candidates) {
      if (countedTreeIds.has(candidate.id)) continue;
      if (state.trees.get(candidate.id)?.phase !== 'mature') continue;
      if (!isPointInPolygon2(candidate, corners)) continue;
      countedTreeIds.add(candidate.id);
    }
  }

  return countedTreeIds.size;
}

/**
 * Returns the live, season-adjusted capacity authored for one parcel herd.
 *
 * The pasture arguments remain in this compatibility helper for callers that
 * still have the surrounding land context, but capacity is no longer divided
 * among sibling parcels: every `PastureHerd` row already belongs to exactly
 * one pasture. Pannage remains excluded because its UI reports the separate
 * live area and mast ceilings instead.
 */
export function currentPastureHeadCapacity(
  _pasture: PastureState,
  _holdingPastures: Iterable<PastureState>,
  herd: Pick<LivestockHerdState, 'species' | 'pastureCapacity'>,
): number | null {
  if (herd.species === 'swine') return null;
  return Math.max(0, herd.pastureCapacity);
}
