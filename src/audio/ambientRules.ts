import { BASELINE_ORBIT_DISTANCE } from '../camera/CameraCurves.ts';
import type { BuildingState, BurgageZoneState } from '../resources/types.ts';
import type { AmbientLayerId } from './audioCatalog.ts';

export type AmbientRuleState = {
  overviewActive: boolean;
  villageActive: boolean;
};

export type AmbientRuleResult = {
  state: AmbientRuleState;
  baseLayer: AmbientLayerId;
  overlayLayer: AmbientLayerId | null;
};

export type SettlementZone = {
  x: number;
  z: number;
  radius: number;
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
const MIN_SETTLEMENT_RADIUS = 48;
const BURGAGE_ZONE_RADIUS = 56;

export function buildSettlementZones(
  buildings: Iterable<BuildingState>,
  burgageZones: Iterable<BurgageZoneState>,
): SettlementZone[] {
  const zones: SettlementZone[] = [];
  for (const building of buildings) {
    zones.push({
      x: building.x,
      z: building.z,
      radius: Math.max(MIN_SETTLEMENT_RADIUS, building.workRadius),
    });
  }
  for (const zone of burgageZones) {
    zones.push({
      x: (zone.cornerA.x + zone.cornerB.x + zone.cornerC.x + zone.cornerD.x) * 0.25,
      z: (zone.cornerA.z + zone.cornerB.z + zone.cornerC.z + zone.cornerD.z) * 0.25,
      radius: BURGAGE_ZONE_RADIUS,
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

  const nearestZone = params.settlementZones.reduce<{ distance: number; radius: number } | null>((best, zone) => {
    const distance = Math.hypot(params.cameraTarget.x - zone.x, params.cameraTarget.z - zone.z);
    if (!best || distance < best.distance) {
      return { distance, radius: zone.radius };
    }
    return best;
  }, null);

  const villageThreshold = nearestZone
    ? nearestZone.radius * (params.previous.villageActive ? VILLAGE_EXIT_RADIUS_MULTIPLIER : 1)
    : 0;
  const villageActive =
    !params.isNight &&
    !overviewActive &&
    !!nearestZone &&
    nearestZone.distance <= villageThreshold;

  const baseLayer: AmbientLayerId = overviewActive
    ? 'open_wind_overview'
    : params.isNight
      ? 'night_insects'
      : 'birds_wind_day';
  const overlayLayer: AmbientLayerId | null =
    !overviewActive && !params.isNight && villageActive ? 'village_day' : null;

  return {
    state: { overviewActive, villageActive },
    baseLayer,
    overlayLayer,
  };
}

/** Overview zoom deliberately strips the ambience back to its open-wind bed. */
export function selectAmbientWeatherLayer(
  isRaining: boolean,
  overviewActive: boolean,
): AmbientLayerId | null {
  return isRaining && !overviewActive ? 'light_rain' : null;
}
