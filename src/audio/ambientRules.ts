import { BASELINE_ORBIT_DISTANCE } from '../camera/CameraCurves.ts';
import type { BuildingState, BurgageZoneState } from '../resources/types.ts';
import type { AmbientLayerId } from './audioCatalog.ts';

export type AmbientRuleState = {
  overviewActive: boolean;
  foundersCampActive: boolean;
  villageActive: boolean;
  townInteriorActive: boolean;
};

export type AmbientRuleResult = {
  state: AmbientRuleState;
  baseLayer: AmbientLayerId;
  overlayLayer: AmbientLayerId | null;
  overlayMix: number;
  detailLayer: AmbientLayerId | null;
  detailMix: number;
};

export type SettlementZone = {
  kind: 'founders-camp' | 'town';
  x: number;
  z: number;
  interiorRadius: number;
  outskirtsRadius: number;
};

type CameraTarget = {
  x: number;
  z: number;
};

/**
 * Entering and leaving the overview use a deliberately broad deadband. This
 * prevents mouse-wheel settling near ~200% zoom from repeatedly crossfading
 * between close ambience and the panoramic wind bed.
 */
export const OVERVIEW_ENTER_DISTANCE = BASELINE_ORBIT_DISTANCE * 2.1;
export const OVERVIEW_EXIT_DISTANCE = BASELINE_ORBIT_DISTANCE * 1.85;
const VILLAGE_EXIT_RADIUS_MULTIPLIER = 1.15;
const TOWN_INTERIOR_FULL_ZOOM_DISTANCE = 38;
const TOWN_INTERIOR_SILENT_ZOOM_DISTANCE = 112;
const TOWN_AMBIENCE_ANCHOR_KINDS = new Set<BuildingState['kind']>([
  'founders_camp',
  'town_hall',
  'marketplace',
  'trading_post',
  'chapel',
  'wayside_shrine',
  'village_storehouse',
  'granary',
  'well',
  'tavern',
  'stable',
  'kennel',
  'watchtower',
  'guardhouse',
  'palisaded_refuge',
  'monastery',
]);

export function buildSettlementZones(
  buildings: Iterable<BuildingState>,
  burgageZones: Iterable<BurgageZoneState>,
): SettlementZone[] {
  const zones: SettlementZone[] = [];
  for (const building of buildings) {
    if (
      building.constructionComplete === false
      || !TOWN_AMBIENCE_ANCHOR_KINDS.has(building.kind)
    ) {
      continue;
    }
    const primaryAnchor = building.kind === 'town_hall';
    const foundingAnchor = building.kind === 'founders_camp';
    zones.push({
      kind: foundingAnchor ? 'founders-camp' : 'town',
      x: building.x,
      z: building.z,
      interiorRadius: primaryAnchor ? 52 : foundingAnchor ? 36 : 28,
      outskirtsRadius: primaryAnchor ? 108 : foundingAnchor ? 78 : 66,
    });
  }
  for (const zone of burgageZones) {
    const x = (zone.cornerA.x + zone.cornerB.x + zone.cornerC.x + zone.cornerD.x) * 0.25;
    const z = (zone.cornerA.z + zone.cornerB.z + zone.cornerC.z + zone.cornerD.z) * 0.25;
    const parcelExtent = Math.max(
      Math.hypot(zone.cornerA.x - x, zone.cornerA.z - z),
      Math.hypot(zone.cornerB.x - x, zone.cornerB.z - z),
      Math.hypot(zone.cornerC.x - x, zone.cornerC.z - z),
      Math.hypot(zone.cornerD.x - x, zone.cornerD.z - z),
    );
    zones.push({
      kind: 'town',
      x,
      z,
      interiorRadius: Math.max(30, parcelExtent + 16),
      outskirtsRadius: Math.max(72, parcelExtent + 56),
    });
  }
  return zones;
}

export function evaluateAmbientRules(params: {
  settlementZones: SettlementZone[];
  cameraTarget: CameraTarget;
  orbitDistance: number;
  previous: AmbientRuleState;
  isNight: boolean;
}): AmbientRuleResult {
  const overviewActive = params.previous.overviewActive
    ? params.orbitDistance >= OVERVIEW_EXIT_DISTANCE
    : params.orbitDistance >= OVERVIEW_ENTER_DISTANCE;

  let foundersCampMix = 0;
  let townOutskirtsMix = 0;
  let townInteriorGeographicMix = 0;
  const townExitMultiplier = params.previous.villageActive
    ? VILLAGE_EXIT_RADIUS_MULTIPLIER
    : 1;
  for (const zone of params.settlementZones) {
    const distance = Math.hypot(
      params.cameraTarget.x - zone.x,
      params.cameraTarget.z - zone.z,
    );
    if (zone.kind === 'founders-camp') {
      const campExitMultiplier = params.previous.foundersCampActive
        ? VILLAGE_EXIT_RADIUS_MULTIPLIER
        : 1;
      const campRadius = zone.outskirtsRadius * campExitMultiplier;
      const zoneCampMix = 1 - smoothstep(
        campRadius * 0.42,
        campRadius,
        distance,
      );
      foundersCampMix = Math.max(foundersCampMix, zoneCampMix);
      continue;
    }
    const outskirtsRadius = zone.outskirtsRadius * townExitMultiplier;
    const interiorRadius = zone.interiorRadius * (
      params.previous.townInteriorActive ? VILLAGE_EXIT_RADIUS_MULTIPLIER : 1
    );
    const zoneOutskirtsMix = 1 - smoothstep(
      outskirtsRadius * 0.52,
      outskirtsRadius,
      distance,
    );
    const zoneInteriorMix = 1 - smoothstep(
      interiorRadius * 0.48,
      interiorRadius,
      distance,
    );
    townOutskirtsMix = Math.max(townOutskirtsMix, zoneOutskirtsMix);
    townInteriorGeographicMix = Math.max(
      townInteriorGeographicMix,
      zoneInteriorMix,
    );
  }
  const interiorZoomMix = 1 - smoothstep(
    TOWN_INTERIOR_FULL_ZOOM_DISTANCE,
    TOWN_INTERIOR_SILENT_ZOOM_DISTANCE,
    params.orbitDistance,
  );
  let townInteriorMix = townInteriorGeographicMix * interiorZoomMix;
  // Keep the diffuse outskirts bed underneath the close layer, but make room
  // for readable local detail rather than stacking both at full strength.
  townOutskirtsMix *= 1 - townInteriorMix * 0.35;
  if (params.isNight || overviewActive) {
    foundersCampMix = 0;
    townOutskirtsMix = 0;
    townInteriorMix = 0;
  }
  const townMix = Math.max(townOutskirtsMix, townInteriorMix);
  const foundersCampActive = foundersCampMix > 0.01;
  const foundersCampDominant = foundersCampActive && foundersCampMix >= townMix;
  const villageActive = townMix > 0.01;
  const settlementActive = foundersCampActive || villageActive;
  const townInteriorActive = !foundersCampDominant && townInteriorMix > 0.01;

  const baseLayer: AmbientLayerId = overviewActive
    ? 'open_wind_overview'
    : params.isNight
      ? 'night_insects'
      : 'birds_wind_day';
  const overlayLayer: AmbientLayerId | null =
    !overviewActive && !params.isNight && settlementActive
      ? foundersCampDominant
        ? 'founders_camp_day'
        : 'village_day'
      : null;
  const detailLayer: AmbientLayerId | null =
    !overviewActive && !params.isNight && townInteriorActive
      ? 'town_interior_day'
      : null;

  return {
    state: {
      overviewActive,
      foundersCampActive,
      villageActive,
      townInteriorActive,
    },
    baseLayer,
    overlayLayer,
    overlayMix: foundersCampDominant ? foundersCampMix : townOutskirtsMix,
    detailLayer,
    detailMix: foundersCampDominant ? 0 : townInteriorMix,
  };
}

/** Overview zoom deliberately strips the ambience back to its open-wind bed. */
export function selectAmbientWeatherLayer(
  isRaining: boolean,
  overviewActive: boolean,
): AmbientLayerId | null {
  return isRaining && !overviewActive ? 'light_rain' : null;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
