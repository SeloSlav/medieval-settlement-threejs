import {
  CATTLE_AREA_PER_HEAD,
  CATTLE_MAX_SLOPE_DEGREES,
  CATTLE_MOISTURE_IDEAL,
  CATTLE_MOISTURE_TOLERANCE,
  SHEEP_AREA_PER_HEAD,
  SHEEP_MAX_SLOPE_DEGREES,
  SHEEP_MOISTURE_IDEAL,
  SHEEP_MOISTURE_TOLERANCE,
  SWINE_AREA_PER_HEAD,
} from '../generated/gameBalance.ts';
import type {
  LivestockHerdState,
  LivestockSpecies,
  PastureState,
} from '../resources/types.ts';

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
  pasture: Pick<PastureState, 'area' | 'averageSlopeDegrees' | 'moisture'>,
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

/**
 * Attributes the holding's live, season-adjusted capacity back to one parcel.
 * Pannage is intentionally excluded because mature-tree placement, not area
 * alone, determines which woodland parcel supplies the herd.
 */
export function currentPastureHeadCapacity(
  pasture: PastureState,
  holdingPastures: Iterable<PastureState>,
  herd: Pick<LivestockHerdState, 'species' | 'pastureCapacity'>,
): number | null {
  const parcelCapacity = neutralPastureHeadCapacity(pasture, herd.species);
  if (parcelCapacity === null) return null;
  let holdingCapacity = 0;
  for (const candidate of holdingPastures) {
    holdingCapacity += neutralPastureHeadCapacity(candidate, herd.species) ?? 0;
  }
  if (holdingCapacity <= 1e-9) return 0;
  return Math.max(0, herd.pastureCapacity) * parcelCapacity / holdingCapacity;
}
