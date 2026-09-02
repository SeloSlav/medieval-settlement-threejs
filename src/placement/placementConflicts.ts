import type { BuildingKind, BuildingState, BurgageZoneState, GameState } from '../resources/types.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import type { BurgageZoneCorners } from '../residences/burgageLayout.ts';
import { cornersToArray } from '../residences/burgageLayout.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { buildingPlacementYaw } from '../buildings/buildingPlacement.ts';
import { getBuildingFootprintCorners } from '../buildings/BuildingTerrainLayout.ts';
import {
  convexPolygonsOverlap2,
  type Point2,
  pointStrictlyInsidePolygon2,
} from '../utils/polygonGeometry.ts';
import { getPlacementSpatialIndex, type PlacementSpatialIndex } from './placementSpatialIndex.ts';

const LEGACY_BUILDING_FOOTPRINT_SCALE = 0.9;

export function burgageZonePolygon(zone: BurgageZoneState): Point2[] {
  return [zone.cornerA, zone.cornerB, zone.cornerC, zone.cornerD];
}

export function buildingFootprintPolygon(
  x: number,
  z: number,
  kind: BuildingKind,
  roadNetwork?: RoadNetwork | null,
  placementYaw?: number,
): Point2[] {
  // Some older parcel tools do not own the road network needed to reproduce
  // a placed building's road-facing yaw. Preserve their conservative proxy
  // until those validators and their server reducers migrate together.
  if (roadNetwork === undefined && placementYaw === undefined) {
    const radius = getBuildingDefinition(kind).pickRadius * LEGACY_BUILDING_FOOTPRINT_SCALE;
    return [
      { x: x - radius, z: z - radius },
      { x: x + radius, z: z - radius },
      { x: x + radius, z: z + radius },
      { x: x - radius, z: z + radius },
    ];
  }
  const yaw = placementYaw ?? buildingPlacementYaw(kind, x, z, roadNetwork);
  return getBuildingFootprintCorners(kind, x, z, yaw);
}

export function buildingFootprintPolygonFromState(
  building: BuildingState,
  roadNetwork?: RoadNetwork | null,
): Point2[] {
  return buildingFootprintPolygon(building.x, building.z, building.kind, roadNetwork, building.yaw);
}

export function buildingOverlapsResidenceZone(
  kind: BuildingKind,
  x: number,
  z: number,
  zones: Iterable<BurgageZoneState>,
  roadNetwork?: RoadNetwork | null,
  yaw?: number,
): boolean {
  const footprint = buildingFootprintPolygon(x, z, kind, roadNetwork, yaw);
  for (const zone of zones) {
    if (convexPolygonsOverlap2(footprint, burgageZonePolygon(zone))) {
      return true;
    }
  }
  return false;
}

export function overlapsExistingZoneIndexed(
  candidate: Point2[],
  index: PlacementSpatialIndex,
): boolean {
  return index.zoneOverlaps(candidate);
}

export function burgageZoneOverlapsBuildings(
  zoneCorners: BurgageZoneCorners,
  buildings: Iterable<BuildingState>,
  gameState?: GameState,
  roadNetwork?: RoadNetwork | null,
): boolean {
  const candidate = cornersToArray(zoneCorners);
  if (gameState) {
    return burgageZoneOverlapsBuildingsIndexed(
      candidate,
      getPlacementSpatialIndex(gameState, roadNetwork),
    );
  }
  for (const building of buildings) {
    if (convexPolygonsOverlap2(
      candidate,
      buildingFootprintPolygonFromState(building, roadNetwork),
    )) {
      return true;
    }
  }
  return false;
}

export function burgageZoneOverlapsBuildingsIndexed(
  candidate: Point2[],
  index: PlacementSpatialIndex,
): boolean {
  return index.buildingOverlaps(candidate);
}

export function pointInsideResidenceZone(
  x: number,
  z: number,
  zones: Iterable<BurgageZoneState>,
): boolean {
  const point = { x, z };
  for (const zone of zones) {
    if (pointStrictlyInsidePolygon2(point, burgageZonePolygon(zone))) {
      return true;
    }
  }
  return false;
}
