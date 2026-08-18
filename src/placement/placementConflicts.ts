import type { BuildingKind, BuildingState, BurgageZoneState, GameState } from '../resources/types.ts';
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

export function burgageZonePolygon(zone: BurgageZoneState): Point2[] {
  return [zone.cornerA, zone.cornerB, zone.cornerC, zone.cornerD];
}

export function buildingFootprintPolygon(
  x: number,
  z: number,
  kind: BuildingKind,
  roadNetwork?: RoadNetwork | null,
): Point2[] {
  const yaw = buildingPlacementYaw(kind, x, z, roadNetwork);
  return getBuildingFootprintCorners(kind, x, z, yaw);
}

export function buildingFootprintPolygonFromState(
  building: BuildingState,
  roadNetwork?: RoadNetwork | null,
): Point2[] {
  return buildingFootprintPolygon(building.x, building.z, building.kind, roadNetwork);
}

export function buildingOverlapsResidenceZone(
  kind: BuildingKind,
  x: number,
  z: number,
  zones: Iterable<BurgageZoneState>,
  roadNetwork?: RoadNetwork | null,
): boolean {
  const footprint = buildingFootprintPolygon(x, z, kind, roadNetwork);
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
