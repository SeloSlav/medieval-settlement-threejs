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
import type { Point2 } from '../utils/polygonGeometry.ts';

export type BackyardGardenPlacement = {
  x: number;
  z: number;
  /** Usable cross-parcel span after leaving room for the burgage fence. */
  width: number;
  /** Usable house-to-rear-fence span after leaving a small working margin. */
  depth: number;
};

/** Keeps rooted meadow tufts and flower heads from leaning across a garden edge. */
export const BACKYARD_GROUNDCOVER_CLEARANCE_MARGIN = 0.16;

export function backyardGardenClearancePolygon(
  placement: BackyardGardenPlacement,
  yaw: number,
  margin = BACKYARD_GROUNDCOVER_CLEARANCE_MARGIN,
): Point2[] {
  const halfWidth = placement.width * 0.5 + margin;
  const halfDepth = placement.depth * 0.5 + margin;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return [
    { x: -halfWidth, z: -halfDepth },
    { x: halfWidth, z: -halfDepth },
    { x: halfWidth, z: halfDepth },
    { x: -halfWidth, z: halfDepth },
  ].map((point) => ({
    x: placement.x + point.x * cos + point.z * sin,
    z: placement.z - point.x * sin + point.z * cos,
  }));
}

export function collectBackyardGardenClearancePolygons(
  gardens: Iterable<{ residenceId: string }>,
  residences: Iterable<ResidenceState>,
  zones: Iterable<BurgageZoneState>,
): Point2[][] {
  const residenceById = new Map<string, ResidenceState>();
  for (const residence of residences) residenceById.set(residence.id, residence);
  const zoneById = new Map<string, BurgageZoneState>();
  for (const zone of zones) zoneById.set(zone.id, zone);

  const polygons: Point2[][] = [];
  for (const garden of gardens) {
    const residence = residenceById.get(garden.residenceId);
    if (!residence) continue;
    const zone = zoneById.get(residence.zoneId);
    if (!zone) continue;
    const placement = backyardGardenPlacement(residence, zone);
    if (!placement) continue;
    polygons.push(backyardGardenClearancePolygon(placement, residence.yaw));
  }
  return polygons;
}

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
