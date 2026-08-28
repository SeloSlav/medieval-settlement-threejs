import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { BuildingKind, BuildingState } from '../resources/types.ts';
import {
  distanceBetweenConvexPolygons2,
  normalize2,
  perpendicularLeft2,
  type Point2,
} from '../utils/polygonGeometry.ts';
import { getBuildingFootprintCorners } from './BuildingTerrainLayout.ts';
import {
  buildingPlacementYaw,
  resolvedPlacedBuildingYaw,
} from './buildingPlacement.ts';

/** Narrow pedestrian/drainage seam retained between visible building edges. */
export const BUILDING_EDGE_CLEARANCE = 0.65;
/** Cursor range in which a clear building edge becomes magnetic. */
export const BUILDING_EDGE_SNAP_DISTANCE = 2.75;

const CLEARANCE_EPSILON = 0.025;
const SNAP_RESULT_TOLERANCE = 0.2;
const MIN_PARALLEL_EDGE_OVERLAP = 0.65;

type Projection = { min: number; max: number };

export function buildingFootprintAt(
  kind: BuildingKind,
  x: number,
  z: number,
  roadNetwork?: RoadNetwork | null,
): Point2[] {
  return getBuildingFootprintCorners(
    kind,
    x,
    z,
    buildingPlacementYaw(kind, x, z, roadNetwork),
  );
}

export function buildingFootprintEdgeDistance(
  candidateKind: BuildingKind,
  candidateX: number,
  candidateZ: number,
  other: Pick<BuildingState, 'kind' | 'x' | 'z' | 'yaw'>,
  roadNetwork?: RoadNetwork | null,
): number {
  return distanceBetweenConvexPolygons2(
    buildingFootprintAt(candidateKind, candidateX, candidateZ, roadNetwork),
    getBuildingFootprintCorners(
      other.kind,
      other.x,
      other.z,
      resolvedPlacedBuildingYaw(other, roadNetwork),
    ),
  );
}

export function buildingFootprintsTooClose(
  candidateKind: BuildingKind,
  candidateX: number,
  candidateZ: number,
  other: Pick<BuildingState, 'kind' | 'x' | 'z' | 'yaw'>,
  roadNetwork?: RoadNetwork | null,
): boolean {
  return buildingFootprintEdgeDistance(
    candidateKind,
    candidateX,
    candidateZ,
    other,
    roadNetwork,
  ) < BUILDING_EDGE_CLEARANCE - CLEARANCE_EPSILON;
}

/**
 * Pull a nearby candidate edge onto the closest existing edge while retaining
 * the small settlement seam. The final point is rejected if its resolved yaw,
 * another neighbour, or a caller-owned placement constraint blocks it.
 */
export function resolveBuildingEdgeSnap(
  kind: BuildingKind,
  x: number,
  z: number,
  buildings: Iterable<BuildingState>,
  roadNetwork?: RoadNetwork | null,
  isBlocked?: (x: number, z: number) => boolean,
): { x: number; z: number } {
  const existingBuildings = [...buildings];
  if (existingBuildings.length === 0) return { x, z };

  const footprint = buildingFootprintAt(kind, x, z, roadNetwork);
  const center = { x, z };
  const proposals: Array<{ x: number; z: number; movement: number }> = [];

  for (const building of existingBuildings) {
    const otherFootprint = getBuildingFootprintCorners(
      building.kind,
      building.x,
      building.z,
      resolvedPlacedBuildingYaw(building, roadNetwork),
    );
    for (const axis of uniqueRectangleAxes(footprint, otherFootprint)) {
      const candidateRange = projectPolygon(footprint, axis);
      const otherRange = projectPolygon(otherFootprint, axis);
      const tangent = perpendicularLeft2(axis);
      if (projectionOverlap(
        projectPolygon(footprint, tangent),
        projectPolygon(otherFootprint, tangent),
      ) < MIN_PARALLEL_EDGE_OVERLAP) {
        continue;
      }

      const candidateCenter = dot(center, axis);
      const otherCenter = dot({ x: building.x, z: building.z }, axis);
      const delta = candidateCenter <= otherCenter
        ? otherRange.min - BUILDING_EDGE_CLEARANCE - candidateRange.max
        : otherRange.max + BUILDING_EDGE_CLEARANCE - candidateRange.min;
      const movement = Math.abs(delta);
      if (movement > BUILDING_EDGE_SNAP_DISTANCE || movement <= 1e-5) continue;

      const proposal = {
        x: x + axis.x * delta,
        z: z + axis.z * delta,
        movement,
      };
      const targetGap = buildingFootprintEdgeDistance(
        kind,
        proposal.x,
        proposal.z,
        building,
        roadNetwork,
      );
      if (Math.abs(targetGap - BUILDING_EDGE_CLEARANCE) > SNAP_RESULT_TOLERANCE) continue;
      if (existingBuildings.some((other) =>
        buildingFootprintsTooClose(kind, proposal.x, proposal.z, other, roadNetwork)
      )) {
        continue;
      }
      // Edge alignment is secondary to placement rules such as road
      // clearance. The caller owns those broader world constraints so this
      // low-level footprint helper remains independent of validation policy.
      if (isBlocked?.(proposal.x, proposal.z)) continue;
      proposals.push(proposal);
    }
  }

  proposals.sort((a, b) => a.movement - b.movement);
  return proposals[0] ?? { x, z };
}

function uniqueRectangleAxes(...footprints: Point2[][]): Point2[] {
  const axes: Point2[] = [];
  for (const footprint of footprints) {
    for (let index = 0; index < footprint.length; index += 1) {
      const start = footprint[index];
      const end = footprint[(index + 1) % footprint.length];
      const axis = normalize2({ x: -(end.z - start.z), z: end.x - start.x });
      if (axes.some((other) => Math.abs(dot(axis, other)) > 0.9995)) continue;
      axes.push(axis);
    }
  }
  return axes;
}

function projectPolygon(polygon: Point2[], axis: Point2): Projection {
  let min = Infinity;
  let max = -Infinity;
  for (const point of polygon) {
    const projection = dot(point, axis);
    min = Math.min(min, projection);
    max = Math.max(max, projection);
  }
  return { min, max };
}

function projectionOverlap(a: Projection, b: Projection): number {
  return Math.min(a.max, b.max) - Math.max(a.min, b.min);
}

function dot(a: Point2, b: Point2): number {
  return a.x * b.x + a.z * b.z;
}
