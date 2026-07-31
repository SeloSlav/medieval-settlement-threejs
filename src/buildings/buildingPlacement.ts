import * as THREE from 'three';
import type { BuildingKind } from '../generated/gameBalance.ts';
import { buildingFacesRoad } from '../resources/buildingPlacementPolicy.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';

const ROAD_FACING_SNAP_DISTANCE = 24;
const ROADSIDE_CURSOR_LEEWAY = 6;
const ROADSIDE_FOOTPRINT_SCALE = 0.6;
const ROADSIDE_CLEARANCE = 0.65;

function pseudoRandomYaw(x: number, z: number): number {
  return (Math.abs(Math.floor(Math.sin(x * 0.017 + z * 0.013) * 6283)) % 360) * (Math.PI / 180);
}

/** Mesh doors face local +Z; rotate so +Z points toward the nearest road. */
export function buildingPlacementYaw(
  kind: BuildingKind,
  x: number,
  z: number,
  roadNetwork?: RoadNetwork | null,
): number {
  if (roadNetwork && buildingFacesRoad(kind)) {
    const snap = roadNetwork.findSnap(new THREE.Vector3(x, 0, z), ROAD_FACING_SNAP_DISTANCE);
    if (snap) {
      const dx = snap.point.x - x;
      const dz = snap.point.z - z;
      if (Math.hypot(dx, dz) > 0.05) {
        return Math.atan2(dx, dz);
      }
    }
  }
  return pseudoRandomYaw(x, z);
}

/**
 * Pull ordinary road-dependent buildings onto the nearest road verge while
 * preserving the cursor's position along the road and its chosen side.
 * Shore and deposit-anchored buildings keep free placement because their
 * terrain alignment is more important than a roadside magnet.
 */
export function resolveRoadsideBuildingPlacement(
  kind: BuildingKind,
  x: number,
  z: number,
  roadNetwork?: RoadNetwork | null,
): { x: number; z: number } {
  const definition = getBuildingDefinition(kind);
  if (
    !roadNetwork
    || !definition.requiresRoad
    || definition.requiresWaterShore
    || kind === 'large_quarry'
    || kind === 'mine'
    || kind === 'clay_pit'
  ) {
    return { x, z };
  }

  const footprintDepth = definition.pickRadius * ROADSIDE_FOOTPRINT_SCALE;
  const maxDistance = Math.min(
    ROAD_FACING_SNAP_DISTANCE,
    footprintDepth + ROADSIDE_CLEARANCE + ROADSIDE_CURSOR_LEEWAY + 3,
  );
  const candidates = roadNetwork
    .getSpatialIndex()
    .collectSnapCandidates(x, z, maxDistance)
    .edges;

  let nearest: {
    x: number;
    z: number;
    normalX: number;
    normalZ: number;
    halfWidth: number;
    distance: number;
  } | null = null;

  for (const edge of candidates) {
    for (let index = 0; index < edge.path.length - 1; index += 1) {
      const a = edge.path[index];
      const b = edge.path[index + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lengthSq = dx * dx + dz * dz;
      if (lengthSq <= 1e-8) continue;
      const t = THREE.MathUtils.clamp(
        ((x - a.x) * dx + (z - a.z) * dz) / lengthSq,
        0,
        1,
      );
      const projectedX = a.x + dx * t;
      const projectedZ = a.z + dz * t;
      const distance = Math.hypot(x - projectedX, z - projectedZ);
      if (distance > maxDistance || (nearest && distance >= nearest.distance)) continue;
      const inverseLength = 1 / Math.sqrt(lengthSq);
      nearest = {
        x: projectedX,
        z: projectedZ,
        normalX: -dz * inverseLength,
        normalZ: dx * inverseLength,
        halfWidth: edge.halfWidth,
        distance,
      };
    }
  }

  if (!nearest) return { x, z };

  const signedSide = (x - nearest.x) * nearest.normalX
    + (z - nearest.z) * nearest.normalZ;
  const side = Math.abs(signedSide) > 1e-4
    ? Math.sign(signedSide)
    : pseudoRandomYaw(nearest.x, nearest.z) < Math.PI ? 1 : -1;
  const setback = nearest.halfWidth + footprintDepth + ROADSIDE_CLEARANCE;
  return {
    x: nearest.x + nearest.normalX * setback * side,
    z: nearest.z + nearest.normalZ * setback * side,
  };
}
