import {
  MAIN_HOUSE_DEPTH,
  MIN_BACKYARD_EXTENSION_DEPTH,
  type BurgageParcelLayout,
  type ResidencePlacement,
} from './burgageLayout.ts';
import { layoutFromBurgageZone } from './burgageZoneLayout.ts';
import type {
  BackyardGardenState,
  BurgageZoneState,
  ResidenceState,
} from '../resources/types.ts';
import type { Point2 } from '../utils/polygonGeometry.ts';

export type BackyardGardenPlacement = {
  x: number;
  z: number;
  /** Usable cross-parcel span after leaving room for the burgage fence. */
  width: number;
  /** Usable house-to-rear-fence span after leaving a small working margin. */
  depth: number;
  /** House-authored orientation; every backyard extension inherits this yaw. */
  yaw: number;
};

const BACKYARD_HOUSE_CLEARANCE = 0.65;
const BACKYARD_FENCE_CLEARANCE = 0.55;
const MIN_BACKYARD_GARDEN_WIDTH = 3.8;
const MIN_BACKYARD_GARDEN_DEPTH = 1.8;
const BACKYARD_FIT_SAMPLE_SPACING = 0.25;

/** Keeps rooted meadow tufts, wind-bent blades, and flower heads outside cultivated beds. */
export const BACKYARD_GROUNDCOVER_CLEARANCE_MARGIN = 0.55;

export function backyardGardenClearsGroundcover(kind: BackyardGardenState['kind']): boolean {
  return kind === 'vegetable_garden'
    || kind === 'flower_garden'
    || kind === 'herb_garden';
}

export function backyardGardenClearancePolygon(
  placement: BackyardGardenPlacement,
  margin = BACKYARD_GROUNDCOVER_CLEARANCE_MARGIN,
): Point2[] {
  const halfWidth = placement.width * 0.5 + margin;
  const halfDepth = placement.depth * 0.5 + margin;
  const sin = Math.sin(placement.yaw);
  const cos = Math.cos(placement.yaw);
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
  gardens: Iterable<Pick<BackyardGardenState, 'residenceId' | 'kind'>>,
  residences: Iterable<ResidenceState>,
  zones: Iterable<BurgageZoneState>,
): Point2[][] {
  const residenceById = new Map<string, ResidenceState>();
  for (const residence of residences) residenceById.set(residence.id, residence);
  const zoneById = new Map<string, BurgageZoneState>();
  for (const zone of zones) zoneById.set(zone.id, zone);

  const polygons: Point2[][] = [];
  for (const garden of gardens) {
    if (!backyardGardenClearsGroundcover(garden.kind)) continue;
    const residence = residenceById.get(garden.residenceId);
    if (!residence) continue;
    const zone = zoneById.get(residence.zoneId);
    if (!zone) continue;
    const placement = backyardGardenPlacement(residence, zone);
    if (!placement) continue;
    polygons.push(backyardGardenClearancePolygon(placement));
  }
  return polygons;
}

type LocalSpan = { left: number; right: number };

function toResidenceLocal(
  point: Point2,
  residence: ResidencePlacement,
): Point2 {
  const dx = point.x - residence.x;
  const dz = point.z - residence.z;
  const cos = Math.cos(residence.yaw);
  const sin = Math.sin(residence.yaw);
  return {
    x: dx * cos - dz * sin,
    z: dx * sin + dz * cos,
  };
}

function fromResidenceLocal(
  point: Point2,
  residence: ResidencePlacement,
): Point2 {
  const cos = Math.cos(residence.yaw);
  const sin = Math.sin(residence.yaw);
  return {
    x: residence.x + point.x * cos + point.z * sin,
    z: residence.z - point.x * sin + point.z * cos,
  };
}

/** Cross-parcel span of a convex parcel at one house-local depth. */
function horizontalParcelSpan(polygon: Point2[], z: number): LocalSpan | null {
  const intersections: number[] = [];
  const epsilon = 1e-6;
  for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index]!;
    const end = polygon[(index + 1) % polygon.length]!;
    const dz = end.z - start.z;
    if (Math.abs(dz) <= epsilon) {
      if (Math.abs(z - start.z) <= epsilon) intersections.push(start.x, end.x);
      continue;
    }
    const t = (z - start.z) / dz;
    if (t < -epsilon || t > 1 + epsilon) continue;
    intersections.push(start.x + (end.x - start.x) * Math.max(0, Math.min(1, t)));
  }
  if (intersections.length < 2) return null;
  return {
    left: Math.min(...intersections),
    right: Math.max(...intersections),
  };
}

function commonParcelSpan(
  polygon: Point2[],
  rearZ: number,
  frontZ: number,
): LocalSpan | null {
  const sampleDepths = [rearZ, frontZ];
  for (const point of polygon) {
    if (point.z > rearZ + 1e-6 && point.z < frontZ - 1e-6) {
      sampleDepths.push(point.z);
    }
  }

  let left = -Infinity;
  let right = Infinity;
  for (const z of sampleDepths) {
    const span = horizontalParcelSpan(polygon, z);
    if (!span) return null;
    left = Math.max(left, span.left);
    right = Math.min(right, span.right);
  }
  return right > left ? { left, right } : null;
}

type LocalGardenFit = {
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
};

/**
 * Finds the largest house-aligned rectangle in the actual free-form backyard.
 * The front edge stays close to the cottage while the side and rear edges are
 * trimmed by the fence shape, so a skewed fence never dictates garden yaw.
 */
function fitHouseAlignedBackyard(localParcel: Point2[]): LocalGardenFit | null {
  const frontZ = -MAIN_HOUSE_DEPTH * 0.5 - BACKYARD_HOUSE_CLEARANCE;
  const deepestZ = Math.min(...localParcel.map((point) => point.z));
  const deepestUsableZ = deepestZ + BACKYARD_FENCE_CLEARANCE;
  const shallowestCandidateZ = frontZ - Math.max(
    MIN_BACKYARD_EXTENSION_DEPTH,
    MIN_BACKYARD_GARDEN_DEPTH,
  );
  if (deepestUsableZ >= shallowestCandidateZ) return null;

  const candidates = [deepestUsableZ, shallowestCandidateZ];
  const steps = Math.ceil((shallowestCandidateZ - deepestUsableZ) / BACKYARD_FIT_SAMPLE_SPACING);
  for (let step = 1; step < steps; step++) {
    candidates.push(deepestUsableZ + step * BACKYARD_FIT_SAMPLE_SPACING);
  }
  for (const point of localParcel) {
    const candidate = point.z + BACKYARD_FENCE_CLEARANCE;
    if (candidate > deepestUsableZ && candidate < shallowestCandidateZ) {
      candidates.push(candidate);
    }
  }

  let best: LocalGardenFit | null = null;
  let bestArea = 0;
  for (const rearZ of candidates) {
    const depth = frontZ - rearZ;
    if (depth < MIN_BACKYARD_GARDEN_DEPTH) continue;
    const span = commonParcelSpan(localParcel, rearZ, frontZ);
    if (!span) continue;
    const left = span.left + BACKYARD_FENCE_CLEARANCE;
    const right = span.right - BACKYARD_FENCE_CLEARANCE;
    if (left >= 0 || right <= 0) continue;
    const width = Math.min(-left, right) * 2;
    if (width < MIN_BACKYARD_GARDEN_WIDTH) continue;
    const area = width * depth;
    if (area <= bestArea) continue;
    bestArea = area;
    best = {
      centerX: 0,
      centerZ: (frontZ + rearZ) * 0.5,
      width,
      depth,
    };
  }
  return best;
}

export function backyardGardenPlacementForParcel(
  residence: ResidencePlacement,
  parcel: BurgageParcelLayout,
): BackyardGardenPlacement | null {
  if (parcel.backyardArea < 2) return null;
  if (parcel.backyardDepth < MIN_BACKYARD_EXTENSION_DEPTH) return null;

  const localParcel = parcel.polygon.map((point) => toResidenceLocal(point, residence));
  const fit = fitHouseAlignedBackyard(localParcel);
  if (!fit) return null;
  const center = fromResidenceLocal({ x: fit.centerX, z: fit.centerZ }, residence);

  return {
    x: center.x,
    z: center.z,
    width: fit.width,
    depth: fit.depth,
    yaw: residence.yaw,
  };
}

/**
 * World position and usable footprint for a residence backyard feature.
 * Local +X runs across the parcel and local +/-Z runs along its depth once the
 * returned marker is rotated by the included house-authored yaw.
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
