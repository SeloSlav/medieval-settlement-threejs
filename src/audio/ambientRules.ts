import { BASELINE_ORBIT_DISTANCE } from '../camera/CameraCurves.ts';
import type { BuildingState, BurgageZoneState } from '../resources/types.ts';
import type { AmbientLayerId } from './audioCatalog.ts';

export type AmbientRuleState = {
  overviewActive: boolean;
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

  let outskirtsMix = 0;
  let interiorGeographicMix = 0;
  const exitMultiplier = params.previous.villageActive
    ? VILLAGE_EXIT_RADIUS_MULTIPLIER
    : 1;
  for (const zone of params.settlementZones) {
    const distance = Math.hypot(
      params.cameraTarget.x - zone.x,
      params.cameraTarget.z - zone.z,
    );
    const outskirtsRadius = zone.outskirtsRadius * exitMultiplier;
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
    outskirtsMix = Math.max(outskirtsMix, zoneOutskirtsMix);
    interiorGeographicMix = Math.max(interiorGeographicMix, zoneInteriorMix);
  }
  const interiorZoomMix = 1 - smoothstep(
    TOWN_INTERIOR_FULL_ZOOM_DISTANCE,
    TOWN_INTERIOR_SILENT_ZOOM_DISTANCE,
    params.orbitDistance,
  );
  let interiorMix = interiorGeographicMix * interiorZoomMix;
  // Keep the diffuse outskirts bed underneath the close layer, but make room
  // for readable local detail rather than stacking both at full strength.
  outskirtsMix *= 1 - interiorMix * 0.35;
  if (params.isNight || overviewActive) {
    outskirtsMix = 0;
    interiorMix = 0;
  }
  const villageActive =
    outskirtsMix > 0.01 || interiorMix > 0.01;
  const townInteriorActive = interiorMix > 0.01;

  const baseLayer: AmbientLayerId = overviewActive
    ? 'open_wind_overview'
    : params.isNight
      ? 'night_insects'
      : 'birds_wind_day';
  const overlayLayer: AmbientLayerId | null =
    !overviewActive && !params.isNight && villageActive ? 'village_day' : null;
  const detailLayer: AmbientLayerId | null =
    !overviewActive && !params.isNight && townInteriorActive
      ? 'town_interior_day'
      : null;

  return {
    state: { overviewActive, villageActive, townInteriorActive },
    baseLayer,
    overlayLayer,
    overlayMix: outskirtsMix,
    detailLayer,
    detailMix: interiorMix,
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
