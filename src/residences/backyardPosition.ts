import {
  HOUSE_SETBACK,
  MAIN_HOUSE_DEPTH,
  MIN_BACKYARD_EXTENSION_DEPTH,
  distancePointToSegment,
  type BurgageParcelLayout,
  type ResidencePlacement,
} from './burgageLayout.ts';
import { layoutFromBurgageZone } from './burgageZoneLayout.ts';
import type { BurgageZoneState, ResidenceState } from '../resources/types.ts';

export type BackyardGardenPlacement = {
  x: number;
  z: number;
  /** Usable cross-parcel span after leaving room for the burgage fence. */
  width: number;
  /** Usable house-to-rear-fence span after leaving a small working margin. */
  depth: number;
};

export function backyardGardenPlacementForParcel(
  residence: ResidencePlacement,
  parcel: BurgageParcelLayout,
): BackyardGardenPlacement | null {
  if (parcel.backyardArea < 2) return null;

  const parcelDepth = Math.min(
    distancePointToSegment(parcel.frontLeft, parcel.polygon[2], parcel.polygon[3]),
    distancePointToSegment(parcel.frontRight, parcel.polygon[2], parcel.polygon[3]),
  );
  const backyardDepth = Math.max(0, parcelDepth - HOUSE_SETBACK - MAIN_HOUSE_DEPTH);
  if (backyardDepth < MIN_BACKYARD_EXTENSION_DEPTH) return null;

  const frontWidth = Math.hypot(
    parcel.frontRight.x - parcel.frontLeft.x,
    parcel.frontRight.z - parcel.frontLeft.z,
  );
  const rearLeft = parcel.polygon[3];
  const rearRight = parcel.polygon[2];
  const rearWidth = Math.hypot(rearRight.x - rearLeft.x, rearRight.z - rearLeft.z);
  const offset = MAIN_HOUSE_DEPTH * 0.5 + backyardDepth * 0.5;

  return {
    x: residence.x - Math.sin(residence.yaw) * offset,
    z: residence.z - Math.cos(residence.yaw) * offset,
    width: Math.max(3.8, Math.min(7.2, Math.min(frontWidth, rearWidth) - 0.9)),
    depth: Math.max(1.8, Math.min(8.2, backyardDepth - 0.55)),
  };
}

/**
 * World position and usable footprint for a residence backyard feature.
 * Local +X runs across the parcel and local +/-Z runs along its depth once the
 * returned marker is rotated by the residence yaw.
 */
export function backyardGardenPlacement(
  residence: ResidenceState,
  zone: BurgageZoneState,
): BackyardGardenPlacement | null {
  const layout = layoutFromBurgageZone(zone);
  if (!layout) return null;

  const parcel = layout.parcels.find((entry) => entry.index === residence.parcelIndex);
  if (!parcel) return null;
  return backyardGardenPlacementForParcel(residence, parcel);
}

/** World position for the backyard map icon — behind the house, mid-backyard. */
export function backyardIconPosition(
  residence: ResidenceState,
  zone: BurgageZoneState,
): { x: number; z: number } | null {
  const placement = backyardGardenPlacement(residence, zone);
  return placement ? { x: placement.x, z: placement.z } : null;
}
