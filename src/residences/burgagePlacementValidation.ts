import * as THREE from 'three';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { BuildingState, BurgageZoneState } from '../resources/types.ts';
import { residenceZoneCost } from '../resources/buildingEconomy.ts';
import {
  type BurgageFrontageEdge,
  type BurgageLayoutResult,
  type BurgageZoneCorners,
  MAX_ROAD_FRONTAGE_DISTANCE,
  MAX_ZONE_DEPTH,
  MIN_PLOT_FRONTAGE,
  MIN_ZONE_DEPTH,
  autoFrontageEdge,
  cornersFromPoints,
  cornersToArray,
  getZoneEdge,
  measureZoneDepth,
  measureZoneSideDepths,
  resolveBurgageLayout,
  suggestPlotCount,
  type ResidencePlacement,
} from './burgageLayout.ts';
import { convexPolygonsOverlap2, isConvexQuad2, polygonArea2 } from '../utils/polygonGeometry.ts';
import { burgageZoneOverlapsBuildings, overlapsExistingZoneIndexed } from '../placement/placementConflicts.ts';
import { getPlacementSpatialIndex } from '../placement/placementSpatialIndex.ts';
import type { GameState } from '../resources/types.ts';
import {
  polygonOverlapsPhysicalDeposit,
  type PhysicalDepositFootprint,
} from '../resources/physicalDepositProtection.ts';

export type BurgagePlacementFailureReason =
  | 'water'
  | 'too_steep'
  | 'invalid_shape'
  | 'too_small'
  | 'too_deep'
  | 'no_road_frontage'
  | 'overlaps_existing'
  | 'overlaps_building'
  | 'overlaps_farm_field'
  | 'on_resource_deposit'
  | 'insufficient_resources'
  | 'no_fit';

export type BurgagePlacementResult =
  | { ok: true; layout: BurgageLayoutResult }
  | { ok: false; reason: BurgagePlacementFailureReason };

const MAX_ZONE_HEIGHT_DELTA = 6;
const MAX_ZONE_EDGE_GRADE = 0.4;
const MAX_RESIDENCE_FOOTPRINT_HEIGHT_DELTA = 2.4;
const RESIDENCE_TERRAIN_HALF_WIDTH = 3.85;
const RESIDENCE_TERRAIN_HALF_DEPTH = 4.2;
const FOOTPRINT_SAMPLE_FRACTIONS = [-1, 0, 1] as const;
const MIN_ZONE_AREA = MIN_PLOT_FRONTAGE * 12;
const WATER_SAMPLE_SPACING = 1.5;

type BurgagePlacementContext = {
  corners: THREE.Vector3[];
  frontageEdge: BurgageFrontageEdge;
  plotCount: number;
  stockpile: { timber: number; stone: number };
  existingZones: Iterable<BurgageZoneState>;
  existingBuildings: Iterable<BuildingState>;
  roadNetwork: RoadNetwork;
  isWaterAt: (x: number, z: number) => boolean;
  isResourceDepositAt?: (x: number, z: number) => boolean;
  physicalDeposits?: readonly PhysicalDepositFootprint[];
  getNaturalHeightAt: (x: number, z: number) => number;
  /** When preview already solved layout, skip a second resolve pass. */
  precomputedLayout?: BurgageLayoutResult | null;
  /** Cached placement index for overlap queries. */
  gameState?: GameState;
};

function zonePolygon(zone: BurgageZoneState) {
  return [zone.cornerA, zone.cornerB, zone.cornerC, zone.cornerD];
}

function overlapsExistingZone(
  zoneCorners: BurgageZoneCorners,
  existingZones: Iterable<BurgageZoneState>,
  gameState?: GameState,
): boolean {
  const candidate = cornersToArray(zoneCorners);
  if (gameState) {
    return overlapsExistingZoneIndexed(candidate, getPlacementSpatialIndex(gameState));
  }
  for (const zone of existingZones) {
    if (convexPolygonsOverlap2(candidate, zonePolygon(zone))) {
      return true;
    }
  }
  return false;
}

export function validateBurgagePlacement(context: BurgagePlacementContext): BurgagePlacementResult {
  if (context.corners.length !== 4) {
    return { ok: false, reason: 'invalid_shape' };
  }

  const heights = context.corners.map((corner) => context.getNaturalHeightAt(corner.x, corner.z));
  const minHeight = Math.min(...heights);
  const maxHeight = Math.max(...heights);
  if (maxHeight - minHeight > MAX_ZONE_HEIGHT_DELTA) {
    return { ok: false, reason: 'too_steep' };
  }
  for (let index = 0; index < context.corners.length; index++) {
    const nextIndex = (index + 1) % context.corners.length;
    const start = context.corners[index];
    const end = context.corners[nextIndex];
    const run = Math.hypot(end.x - start.x, end.z - start.z);
    if (run > 0.1 && Math.abs(heights[nextIndex] - heights[index]) / run > MAX_ZONE_EDGE_GRADE) {
      return { ok: false, reason: 'too_steep' };
    }
  }

  const cornerPoints = context.corners.map((corner) => ({ x: corner.x, z: corner.z }));
  const zoneCorners = cornersFromPoints(cornerPoints);
  if (!zoneCorners) return { ok: false, reason: 'invalid_shape' };

  if (!isConvexQuad2(zoneCorners.a, zoneCorners.b, zoneCorners.c, zoneCorners.d)) {
    return { ok: false, reason: 'invalid_shape' };
  }

  if (
    context.physicalDeposits
      ? polygonOverlapsPhysicalDeposit(cornerPoints, context.physicalDeposits)
      : context.corners.some((corner) =>
          context.isResourceDepositAt?.(corner.x, corner.z) === true
        )
  ) {
    return { ok: false, reason: 'on_resource_deposit' };
  }

  if (burgageZoneTouchesWater(zoneCorners, context.isWaterAt)) {
    return { ok: false, reason: 'water' };
  }

  if (polygonArea2(cornerPoints) < MIN_ZONE_AREA) {
    return { ok: false, reason: 'too_small' };
  }

  const zoneDepth = measureZoneDepth(zoneCorners, context.frontageEdge);
  const sideDepths = measureZoneSideDepths(zoneCorners, context.frontageEdge);
  if (zoneDepth + 1e-6 < MIN_ZONE_DEPTH) {
    return { ok: false, reason: 'too_small' };
  }
  if (Math.max(...sideDepths) > MAX_ZONE_DEPTH + 0.05) {
    return { ok: false, reason: 'too_deep' };
  }

  const edgeDistances = frontageEdgeRoadDistances(zoneCorners, context.roadNetwork);
  if (edgeDistances[context.frontageEdge] > MAX_ROAD_FRONTAGE_DISTANCE) {
    return { ok: false, reason: 'no_road_frontage' };
  }

  const layout = context.precomputedLayout
    ?? resolveBurgageLayout(zoneCorners, context.frontageEdge, context.plotCount);
  if (!layout || layout.residences.length === 0) {
    return { ok: false, reason: 'no_fit' };
  }
  if (layout.residences.some((residence) => (
    residenceFootprintHeightDelta(residence, context.getNaturalHeightAt)
      > MAX_RESIDENCE_FOOTPRINT_HEIGHT_DELTA
  ))) {
    return { ok: false, reason: 'too_steep' };
  }

  if (overlapsExistingZone(zoneCorners, context.existingZones, context.gameState)) {
    return { ok: false, reason: 'overlaps_existing' };
  }

  if (burgageZoneOverlapsBuildings(zoneCorners, context.existingBuildings, context.gameState)) {
    return { ok: false, reason: 'overlaps_building' };
  }

  if (context.gameState) {
    const candidate = cornersToArray(zoneCorners);
    for (const field of context.gameState.farmFields.values()) {
      if (convexPolygonsOverlap2(candidate, field.corners)) {
        return { ok: false, reason: 'overlaps_farm_field' };
      }
    }
  }

  const cost = residenceZoneCost(layout.residences.length);
  if (context.stockpile.timber < cost.timber || context.stockpile.stone < cost.stone) {
    return { ok: false, reason: 'insufficient_resources' };
  }

  return { ok: true, layout };
}

/**
 * Samples the complete authored parcel instead of only its four corners.
 * River water can cross an edge or the middle of a wide zone while every
 * corner remains dry, especially around bends and tributary junctions.
 */
export function burgageZoneTouchesWater(
  corners: BurgageZoneCorners,
  isWaterAt: (x: number, z: number) => boolean,
  sampleSpacing = WATER_SAMPLE_SPACING,
): boolean {
  const spacing = Math.max(0.25, sampleSpacing);
  const sideSteps = Math.max(1, Math.ceil(Math.max(
    Math.hypot(corners.d.x - corners.a.x, corners.d.z - corners.a.z),
    Math.hypot(corners.c.x - corners.b.x, corners.c.z - corners.b.z),
  ) / spacing));

  for (let sideIndex = 0; sideIndex <= sideSteps; sideIndex++) {
    const sideT = sideIndex / sideSteps;
    const left = {
      x: corners.a.x + (corners.d.x - corners.a.x) * sideT,
      z: corners.a.z + (corners.d.z - corners.a.z) * sideT,
    };
    const right = {
      x: corners.b.x + (corners.c.x - corners.b.x) * sideT,
      z: corners.b.z + (corners.c.z - corners.b.z) * sideT,
    };
    const rowSteps = Math.max(1, Math.ceil(Math.hypot(
      right.x - left.x,
      right.z - left.z,
    ) / spacing));

    for (let rowIndex = 0; rowIndex <= rowSteps; rowIndex++) {
      const rowT = rowIndex / rowSteps;
      const x = left.x + (right.x - left.x) * rowT;
      const z = left.z + (right.z - left.z) * rowT;
      if (isWaterAt(x, z)) return true;
    }
  }

  return false;
}

export function residenceFootprintHeightDelta(
  residence: ResidencePlacement,
  getHeightAt: (x: number, z: number) => number,
): number {
  const cos = Math.cos(residence.yaw);
  const sin = Math.sin(residence.yaw);
  let minHeight = Infinity;
  let maxHeight = -Infinity;

  for (const xFraction of FOOTPRINT_SAMPLE_FRACTIONS) {
    for (const zFraction of FOOTPRINT_SAMPLE_FRACTIONS) {
      const localX = xFraction * RESIDENCE_TERRAIN_HALF_WIDTH;
      const localZ = zFraction * RESIDENCE_TERRAIN_HALF_DEPTH;
      const x = residence.x + localX * cos - localZ * sin;
      const z = residence.z + localX * sin + localZ * cos;
      const height = getHeightAt(x, z);
      minHeight = Math.min(minHeight, height);
      maxHeight = Math.max(maxHeight, height);
    }
  }

  return maxHeight - minHeight;
}

export function frontageEdgeRoadDistances(
  corners: BurgageZoneCorners,
  roadNetwork: RoadNetwork,
): [number, number, number, number] {
  return [
    edgeDistanceToRoads(corners, 0, roadNetwork),
    edgeDistanceToRoads(corners, 1, roadNetwork),
    edgeDistanceToRoads(corners, 2, roadNetwork),
    edgeDistanceToRoads(corners, 3, roadNetwork),
  ];
}

export function countValidFrontageEdges(
  corners: BurgageZoneCorners,
  roadNetwork: RoadNetwork,
): number {
  const distances = frontageEdgeRoadDistances(corners, roadNetwork);
  let count = 0;
  for (const distance of distances) {
    if (distance <= MAX_ROAD_FRONTAGE_DISTANCE) count += 1;
  }
  return count;
}

export function detectFrontageEdge(corners: BurgageZoneCorners, roadNetwork: RoadNetwork): BurgageFrontageEdge {
  const valid = validFrontageEdges(corners, roadNetwork);
  if (valid.length > 0) return valid[0];
  const distances = frontageEdgeRoadDistances(corners, roadNetwork);
  return autoFrontageEdge(corners, (edge) => distances[edge]);
}

export function validFrontageEdges(
  corners: BurgageZoneCorners,
  roadNetwork: RoadNetwork,
): BurgageFrontageEdge[] {
  const distances = frontageEdgeRoadDistances(corners, roadNetwork);
  const valid: BurgageFrontageEdge[] = [];
  for (let edge = 0; edge < 4; edge++) {
    if (distances[edge] <= MAX_ROAD_FRONTAGE_DISTANCE) {
      valid.push(edge as BurgageFrontageEdge);
    }
  }
  valid.sort((a, b) => distances[a] - distances[b]);
  return valid;
}

export function cycleFrontageEdge(
  corners: BurgageZoneCorners,
  roadNetwork: RoadNetwork,
  current: BurgageFrontageEdge,
): BurgageFrontageEdge {
  const valid = validFrontageEdges(corners, roadNetwork);
  if (valid.length === 0) return current;
  if (valid.length === 1) return valid[0];
  const index = valid.indexOf(current);
  const nextIndex = index < 0 ? 0 : (index + 1) % valid.length;
  return valid[nextIndex];
}

export function frontageEdgeLabel(edge: BurgageFrontageEdge): string {
  return ['A–B', 'B–C', 'C–D', 'D–A'][edge];
}

export function initialPlotCount(corners: BurgageZoneCorners, frontageEdge: BurgageFrontageEdge): number {
  const [start, end] = getZoneEdge(corners, frontageEdge);
  return suggestPlotCount(Math.hypot(end.x - start.x, end.z - start.z));
}

function edgeDistanceToRoads(
  corners: BurgageZoneCorners,
  edge: BurgageFrontageEdge,
  roadNetwork: RoadNetwork,
): number {
  const [start, end] = getZoneEdge(corners, edge);
  if (roadNetwork.edges.size === 0 && roadNetwork.nodes.size === 0) return Infinity;

  const index = roadNetwork.getSpatialIndex();
  let minDistance = Infinity;
  const samples = 10;
  const searchRadius = MAX_ROAD_FRONTAGE_DISTANCE + 4;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = start.x + (end.x - start.x) * t;
    const z = start.z + (end.z - start.z) * t;
    minDistance = Math.min(minDistance, index.nearestDistance(x, z, searchRadius));
  }
  return minDistance;
}
