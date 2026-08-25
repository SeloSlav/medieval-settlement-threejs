import * as THREE from 'three';
import type { BuildingKind } from '../generated/gameBalance.ts';
import { buildingFacesRoad } from '../resources/buildingPlacementPolicy.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import {
  BUILDING_LOCAL_VISUAL_BOUNDS,
  getConstructionSiteLocalVisualBounds,
} from './BuildingVisualBounds.ts';

const ROAD_FACING_SNAP_DISTANCE = 24;
const ROADSIDE_CURSOR_LEEWAY = 6;
const ROADSIDE_MINIMUM_PICK_RADIUS_SCALE = 0.6;
const ROADSIDE_CLEARANCE = 0.65;

function pseudoRandomYaw(x: number, z: number): number {
  return (Math.abs(Math.floor(Math.sin(x * 0.017 + z * 0.013) * 6283)) % 360) * (Math.PI / 180);
}

/**
 * Road snapping is a placement preference, while `requiresRoad` controls
 * construction logistics. Keep those policies separate so rural buildings
 * such as hunters' halls can still use the shared snap toggle. Only buildings
 * whose center is fixed to an exact shore or deposit site retain free
 * placement.
 *
 * Buildings pulled onto a road verge must also inherit the road-facing yaw.
 * Several utility and rural definitions intentionally have no authored
 * `facesRoad` facade, but leaving those at a random angle makes the positional
 * snap appear broken.
 */
function buildingUsesRoadsideSnap(kind: BuildingKind): boolean {
  const definition = getBuildingDefinition(kind);
  return !definition.requiresWaterShore
    && kind !== 'large_quarry'
    && kind !== 'mine'
    && kind !== 'clay_pit';
}

export type RoadsideBuildingPlacement = { x: number; z: number };

/** Mesh doors face local +Z; rotate so +Z points toward the nearest road. */
export function buildingPlacementYaw(
  kind: BuildingKind,
  x: number,
  z: number,
  roadNetwork?: RoadNetwork | null,
): number {
  if (roadNetwork && (buildingFacesRoad(kind) || buildingUsesRoadsideSnap(kind))) {
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
 * Pull movable buildings onto the nearest road verge while preserving the
 * cursor's position along the road and its chosen side. Shore and
 * deposit-centered buildings keep their exact placement because moving their
 * center would invalidate the site selected by the player.
 */
export function resolveRoadsideBuildingPlacement(
  kind: BuildingKind,
  x: number,
  z: number,
  roadNetwork?: RoadNetwork | null,
): RoadsideBuildingPlacement {
  return resolveRoadsideBuildingPlacementCandidates(kind, x, z, roadNetwork)[0];
}

/**
 * Return both road verges in cursor-preferred order. Callers with placement
 * context can reject a verge that still intersects a curve or nearby branch
 * and fall through to the other side without losing the player's side choice.
 */
export function resolveRoadsideBuildingPlacementCandidates(
  kind: BuildingKind,
  x: number,
  z: number,
  roadNetwork?: RoadNetwork | null,
): RoadsideBuildingPlacement[] {
  const definition = getBuildingDefinition(kind);
  if (
    !roadNetwork
    || !buildingUsesRoadsideSnap(kind)
  ) {
    return [{ x, z }];
  }

  // Local +Z is the road-facing side. Use the complete authored envelopes so
  // large footprints clear the road instead of snapping to a position that
  // authoritative validation immediately rejects.
  const footprintDepth = Math.max(
    definition.pickRadius * ROADSIDE_MINIMUM_PICK_RADIUS_SCALE,
    BUILDING_LOCAL_VISUAL_BOUNDS[kind].maxZ,
    getConstructionSiteLocalVisualBounds(kind).maxZ,
  );
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

  if (!nearest) return [{ x, z }];

  const signedSide = (x - nearest.x) * nearest.normalX
    + (z - nearest.z) * nearest.normalZ;
  const preferredSide = Math.abs(signedSide) > 1e-4
    ? Math.sign(signedSide)
    : pseudoRandomYaw(nearest.x, nearest.z) < Math.PI ? 1 : -1;
  const setback = nearest.halfWidth + footprintDepth + ROADSIDE_CLEARANCE;
  return [preferredSide, -preferredSide].map((side) => ({
    x: nearest.x + nearest.normalX * setback * side,
    z: nearest.z + nearest.normalZ * setback * side,
  }));
}
