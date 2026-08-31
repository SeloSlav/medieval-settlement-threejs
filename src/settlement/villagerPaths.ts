import { BUILDING_ROAD_ACCESS_DISTANCE } from '../generated/gameBalance.ts';
import { roadPathRoute } from '../logistics/roadLogistics.ts';
import {
  MAIN_HOUSE_DEPTH,
  MAIN_HOUSE_WIDTH,
} from '../residences/burgageLayout.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { ResidenceState } from '../resources/types.ts';
import {
  polylineLengthXZ,
  samplePolylineXZ,
  type PointXZ,
} from '../utils/pathGeometry.ts';
import { hashStringSeed, mulberry32 } from '../utils/random.ts';
import type { VillagerModelVariant } from './SettlementCrowdRenderer.ts';

export type { PointXZ as RoadPoint };

export type HomePlotLeisureArea = {
  polygon: readonly PointXZ[];
  backyardDepth: number;
};

/**
 * Compatibility exports retained for callers and diagnostics. They express
 * the full-quality policy now: presentation has no population, household, or
 * road-length ceiling and one authoritative resident maps to one actor.
 */
export const MAX_VILLAGERS_TOTAL = Number.MAX_SAFE_INTEGER;
export const MAX_VILLAGERS_PER_RESIDENCE = Number.MAX_SAFE_INTEGER;
export const POPULATION_DENSITY_RATIO = 1;
export const MIN_ROAD_METERS_PER_AGENT = 0;

export function residenceDoorPosition(residence: ResidenceState): PointXZ {
  const doorOffset = MAIN_HOUSE_DEPTH * 0.5 - 0.1;
  const sin = Math.sin(residence.yaw);
  const cos = Math.cos(residence.yaw);
  return {
    x: residence.x + sin * doorOffset,
    z: residence.z + cos * doorOffset,
  };
}

export function computeRoadSlotBudget(network: RoadNetwork | null): number {
  void network;
  return MAX_VILLAGERS_TOTAL;
}

export function computeVillagerSlots(
  residences: readonly ResidenceState[],
  roadNetwork: RoadNetwork | null = null,
  populationByResidence?: ReadonlyMap<string, number>,
  maxSlots = MAX_VILLAGERS_TOTAL,
): Map<string, number> {
  const slots = new Map<string, number>();
  let total = 0;

  for (const residence of residences) {
    const population = populationByResidence?.get(residence.id) ?? residence.population;
    if (residence.abandoned || population <= 0) continue;
    const count = Math.max(0, Math.floor(population));
    slots.set(residence.id, count);
    total += count;
  }

  void roadNetwork;
  const cap = Number.isFinite(maxSlots)
    ? Math.max(0, Math.floor(maxSlots))
    : MAX_VILLAGERS_TOTAL;
  if (total <= cap) return slots;

  const entries = [...slots.entries()].sort((a, b) => b[1] - a[1]);
  const trimmed = new Map<string, number>();
  let remaining = cap;
  for (const [id, count] of entries) {
    if (remaining <= 0) break;
    const kept = Math.min(count, remaining);
    trimmed.set(id, kept);
    remaining -= kept;
  }
  return trimmed;
}

export function findNearestRoadEdgePath(
  network: RoadNetwork,
  x: number,
  z: number,
): { path: PointXZ[]; distance: number } | null {
  const nearest = network.getSpatialIndex().findNearestEdgePath(x, z, BUILDING_ROAD_ACCESS_DISTANCE);
  if (!nearest) return null;
  return {
    path: nearest.path.map((point) => ({ x: point.x, z: point.z })),
    distance: nearest.distance,
  };
}

export function pickVillagerWalkPath(
  residence: ResidenceState,
  residences: readonly ResidenceState[],
  network: RoadNetwork | null,
  seed: number,
  nearestEdge: { path: PointXZ[]; distance: number } | null,
  homePlot: HomePlotLeisureArea | null = null,
  origin: PointXZ = residenceDoorPosition(residence),
): PointXZ[] | null {
  const rng = mulberry32(seed);
  const door = residenceDoorPosition(residence);
  const plotWander = pickHomePlotWanderPath(
    residence,
    seed ^ 0x51f15e5d,
    homePlot,
    origin,
  );

  // Most leisure trips reach the street, while a substantial minority stay
  // inside the household plot. The latter keeps roadless and not-yet-improved
  // homes alive instead of pinning everybody to one idle pose by the door.
  if (plotWander && rng() < 0.36) return plotWander;

  if (
    network
    && nearestEdge
    && nearestEdge.distance <= BUILDING_ROAD_ACCESS_DISTANCE
    && rng() < 0.72
  ) {
    const wander = pickLocalRoadWander(origin, door, nearestEdge, seed);
    if (wander) return wander;
  }

  const candidates = network ? residences.filter(
    (other) =>
      other.id !== residence.id
      && !other.abandoned
      && other.population > 0,
  ) : [];
  if (network && candidates.length > 0) {
    const shuffled = [...candidates].sort(() => rng() - 0.5);
    for (const target of shuffled.slice(0, 4)) {
      const targetDoor = residenceDoorPosition(target);
      const route = roadPathRoute(network, door.x, door.z, targetDoor.x, targetDoor.z);
      if (!route || route.distance < 6 || route.distance > 140) continue;
      return closeLeisureLoop(origin, route.polyline);
    }
  }

  return (network
    ? pickLocalRoadWander(origin, door, nearestEdge, seed)
    : null)
    ?? plotWander;
}

function pickLocalRoadWander(
  origin: PointXZ,
  door: PointXZ,
  nearestEdge: { path: PointXZ[]; distance: number } | null,
  seed: number,
): PointXZ[] | null {
  if (!nearestEdge || nearestEdge.distance > BUILDING_ROAD_ACCESS_DISTANCE) return null;

  const rng = mulberry32(seed ^ 0x9e3779b9);
  const totalLength = polylineLengthXZ(nearestEdge.path);
  if (totalLength < 8) return null;

  const wanderLength = 12 + rng() * 18;
  const startDistance = rng() * Math.max(1, totalLength - wanderLength);
  const endDistance = Math.min(totalLength, startDistance + wanderLength);
  const start = samplePolylineXZ(nearestEdge.path, startDistance);
  const end = samplePolylineXZ(nearestEdge.path, endDistance);
  if (!start || !end) return null;

  const roadLoop = [
    door,
    { x: start.x, z: start.z },
    { x: end.x, z: end.z },
    { x: start.x, z: start.z },
    door,
  ];
  return closeLeisureLoop(origin, roadLoop, false);
}

/**
 * Picks a short front-yard or backyard loop. A real burgage polygon keeps the
 * points inset from its fence; the conservative front-yard fallback also lets
 * old saves and focused fixtures animate before a zone layout is available.
 */
export function pickHomePlotWanderPath(
  residence: ResidenceState,
  seed: number,
  homePlot: HomePlotLeisureArea | null = null,
  origin: PointXZ = residenceDoorPosition(residence),
): PointXZ[] | null {
  const rng = mulberry32(seed ^ 0x85ebca6b);
  const originLocal = toResidenceLocal(origin, residence);
  const localPolygon = homePlot?.polygon.map((point) =>
    toResidenceLocal(point, residence)
  ) ?? null;
  const halfHouseDepth = MAIN_HOUSE_DEPTH * 0.5;
  const isInBackyard = originLocal.z < -halfHouseDepth - 0.12;
  const polygonRear = localPolygon
    ? Math.min(...localPolygon.map((point) => point.z))
    : -halfHouseDepth - Math.max(2.4, homePlot?.backyardDepth ?? 0);
  const polygonFront = localPolygon
    ? Math.max(...localPolygon.map((point) => point.z))
    : halfHouseDepth + 3.15;
  const regionMinZ = isInBackyard
    ? polygonRear + 0.52
    : halfHouseDepth + 0.48;
  const regionMaxZ = isInBackyard
    ? -halfHouseDepth - 0.52
    : polygonFront - 0.52;
  if (regionMaxZ - regionMinZ < 0.55) return null;

  const firstZ = regionMinZ + (regionMaxZ - regionMinZ) * (0.25 + rng() * 0.18);
  const secondZ = regionMinZ + (regionMaxZ - regionMinZ) * (0.68 + rng() * 0.16);
  const firstSpan = localHorizontalSpan(localPolygon, firstZ);
  const secondSpan = localHorizontalSpan(localPolygon, secondZ);
  if (!firstSpan || !secondSpan) return null;

  const insetSpan = (span: LocalHorizontalSpan): LocalHorizontalSpan => ({
    left: span.left + 0.48,
    right: span.right - 0.48,
  });
  const insetFirst = insetSpan(firstSpan);
  const insetSecond = insetSpan(secondSpan);
  if (insetFirst.right - insetFirst.left < 1 || insetSecond.right - insetSecond.left < 1) {
    return null;
  }

  const firstCenter = (insetFirst.left + insetFirst.right) * 0.5;
  const secondCenter = (insetSecond.left + insetSecond.right) * 0.5;
  const firstReach = Math.min(2.15, (insetFirst.right - insetFirst.left) * 0.32);
  const secondReach = Math.min(2.15, (insetSecond.right - insetSecond.left) * 0.32);
  const direction = rng() < 0.5 ? -1 : 1;
  const localWaypoints = [
    { x: firstCenter + direction * firstReach, z: firstZ },
    { x: secondCenter - direction * secondReach, z: secondZ },
    { x: firstCenter - direction * firstReach * 0.45, z: firstZ },
  ];
  const waypoints = localWaypoints.map((point) =>
    fromResidenceLocal(point, residence)
  );
  return [
    { x: origin.x, z: origin.z },
    ...waypoints,
    { x: origin.x, z: origin.z },
  ];
}

type LocalHorizontalSpan = { left: number; right: number };

function localHorizontalSpan(
  polygon: readonly PointXZ[] | null,
  z: number,
): LocalHorizontalSpan | null {
  if (!polygon) {
    const halfWidth = MAIN_HOUSE_WIDTH * 0.5 + 0.15;
    return { left: -halfWidth, right: halfWidth };
  }

  const intersections: number[] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]!;
    const end = polygon[(index + 1) % polygon.length]!;
    const dz = end.z - start.z;
    if (Math.abs(dz) <= 1e-7) {
      if (Math.abs(z - start.z) <= 1e-7) intersections.push(start.x, end.x);
      continue;
    }
    const t = (z - start.z) / dz;
    if (t < 0 || t > 1) continue;
    intersections.push(start.x + (end.x - start.x) * t);
  }
  if (intersections.length < 2) return null;
  return {
    left: Math.min(...intersections),
    right: Math.max(...intersections),
  };
}

function toResidenceLocal(point: PointXZ, residence: ResidenceState): PointXZ {
  const dx = point.x - residence.x;
  const dz = point.z - residence.z;
  const cos = Math.cos(residence.yaw);
  const sin = Math.sin(residence.yaw);
  return {
    x: dx * cos - dz * sin,
    z: dx * sin + dz * cos,
  };
}

function fromResidenceLocal(point: PointXZ, residence: ResidenceState): PointXZ {
  const cos = Math.cos(residence.yaw);
  const sin = Math.sin(residence.yaw);
  return {
    x: residence.x + point.x * cos + point.z * sin,
    z: residence.z - point.x * sin + point.z * cos,
  };
}

function closeLeisureLoop(
  origin: PointXZ,
  outbound: readonly PointXZ[],
  reverseOutbound = true,
): PointXZ[] {
  const path = [{ x: origin.x, z: origin.z }];
  for (const point of outbound) appendDistinctPoint(path, point);
  if (reverseOutbound) {
    for (let index = outbound.length - 2; index >= 0; index -= 1) {
      appendDistinctPoint(path, outbound[index]!);
    }
  }
  appendDistinctPoint(path, origin);
  return path;
}

function appendDistinctPoint(path: PointXZ[], point: PointXZ): void {
  const previous = path[path.length - 1];
  if (previous && Math.hypot(previous.x - point.x, previous.z - point.z) < 1e-5) return;
  path.push({ x: point.x, z: point.z });
}

export function pickIdleOffset(residenceId: string, slotIndex: number): { x: number; z: number; yaw: number } {
  const rng = mulberry32(hashStringSeed(`${residenceId}:${slotIndex}`));
  const radius = 0.35 + rng() * 0.85;
  const angle = rng() * Math.PI * 2;
  return {
    x: Math.sin(angle) * radius,
    z: Math.cos(angle) * radius,
    yaw: angle + Math.PI + (rng() - 0.5) * 0.6,
  };
}

export function pickWalkSpeed(seed: number): number {
  const rng = mulberry32(seed);
  return 1.05 + rng() * 0.35;
}

export function pickIdleDuration(seed: number): number {
  const rng = mulberry32(seed);
  return 2.5 + rng() * 6.5;
}

export function pickVillagerAppearanceSeed(residenceId: string, slotIndex: number): number {
  return hashStringSeed(`villager:${residenceId}:${slotIndex}`);
}

export function pickVillagerColors(seed: number): { tunic: number; skin: number } {
  const rng = mulberry32(seed);
  const tunics = [0x6b4e38, 0x4a5c44, 0x5c4636, 0x3d4a62, 0x7a5e46, 0x556b48] as const;
  const skins = [0xd4a574, 0xc9956a, 0xe0b080, 0xbf8860] as const;
  const tunic = tunics[Math.floor(rng() * tunics.length)] ?? tunics[0];
  const skin = skins[Math.floor(rng() * skins.length)] ?? skins[0];
  return { tunic, skin };
}

/** Stable presentation gender so replicated villagers never flicker between models. */
export function pickVillagerModelVariant(seed: number): VillagerModelVariant {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  return rng() < 0.5 ? 'man' : 'woman';
}

export function pickVillagerHairColor(seed: number): number {
  const rng = mulberry32(seed ^ 0x6c8e9cf5);
  const hair = [0x2f2119, 0x4a3022, 0x6b4b2d, 0x8a713e, 0x3b302b] as const;
  return hair[Math.floor(rng() * hair.length)] ?? hair[0];
}
