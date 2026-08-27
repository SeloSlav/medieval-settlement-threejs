import type { GraveyardState } from '../resources/types.ts';
import type { Point2 } from '../utils/polygonGeometry.ts';

export const MAX_VISIBLE_GRAVES = 180;
export const GRAVE_SITE_VEGETATION_CLEARANCE_RADIUS = 0.8;
const GRAVE_SITE_CLEARANCE_SEGMENTS = 12;

export type GraveSitePlacement = Point2 & {
  yaw: number;
  headX: number;
  headZ: number;
};

function bilinear(
  corners: GraveyardState['corners'],
  u: number,
  v: number,
): Point2 {
  const topX = corners[0].x + (corners[1].x - corners[0].x) * u;
  const topZ = corners[0].z + (corners[1].z - corners[0].z) * u;
  const bottomX = corners[3].x + (corners[2].x - corners[3].x) * u;
  const bottomZ = corners[3].z + (corners[2].z - corners[3].z) * u;
  return {
    x: topX + (bottomX - topX) * v,
    z: topZ + (bottomZ - topZ) * v,
  };
}

/**
 * Deterministic occupied grave sites shared by marker placement and the live
 * grass/wildflower exclusion field. Empty capacity never clears vegetation.
 */
export function visibleGraveSitePlacements(
  graveyard: GraveyardState,
): GraveSitePlacement[] {
  const visible = Math.min(graveyard.burials, MAX_VISIBLE_GRAVES);
  if (visible <= 0) return [];
  const columns = Math.max(
    2,
    Math.floor(Math.sqrt(Math.max(1, graveyard.capacity) * 1.45)),
  );
  const rows = Math.max(1, Math.ceil(graveyard.capacity / columns));
  const placements: GraveSitePlacement[] = [];
  for (let index = 0; index < visible; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const u = (column + 0.5) / columns;
    const v = (row + 0.5) / rows;
    const point = bilinear(graveyard.corners, 0.08 + u * 0.84, 0.08 + v * 0.84);
    const next = bilinear(
      graveyard.corners,
      0.08 + u * 0.84,
      Math.min(0.92, 0.08 + v * 0.84 + 0.02),
    );
    const rowLength = Math.max(1e-6, Math.hypot(next.x - point.x, next.z - point.z));
    const rowX = (next.x - point.x) / rowLength;
    const rowZ = (next.z - point.z) / rowLength;
    placements.push({
      ...point,
      yaw: Math.atan2(rowX, rowZ),
      headX: point.x - rowX * 0.38,
      headZ: point.z - rowZ * 0.38,
    });
  }
  return placements;
}

export function collectGraveSiteVegetationClearancePolygons(
  graveyards: Iterable<GraveyardState>,
): Point2[][] {
  const polygons: Point2[][] = [];
  for (const graveyard of graveyards) {
    for (const site of visibleGraveSitePlacements(graveyard)) {
      polygons.push(Array.from({ length: GRAVE_SITE_CLEARANCE_SEGMENTS }, (_, index) => {
        const angle = index / GRAVE_SITE_CLEARANCE_SEGMENTS * Math.PI * 2;
        return {
          x: site.x + Math.cos(angle) * GRAVE_SITE_VEGETATION_CLEARANCE_RADIUS,
          z: site.z + Math.sin(angle) * GRAVE_SITE_VEGETATION_CLEARANCE_RADIUS,
        };
      }));
    }
  }
  return polygons;
}
