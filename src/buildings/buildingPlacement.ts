import * as THREE from 'three';
import type { BuildingKind } from '../generated/gameBalance.ts';
import { buildingFacesRoad } from '../resources/buildingPlacementPolicy.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';

const ROAD_FACING_SNAP_DISTANCE = 24;

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
