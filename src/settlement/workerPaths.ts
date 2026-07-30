import type {
  BuildingKind,
  BuildingState,
  FarmFieldState,
  ForagingNodeState,
  PastureState,
  ResourceNodeState,
  ResidenceState,
  TreeEntityState,
  TreeLayoutEntry,
} from '../resources/types.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import { roadPathRoute } from '../logistics/roadLogistics.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { polylineLengthXZ, type PointXZ } from '../utils/pathGeometry.ts';
import { hashStringSeed, mulberry32 } from '../utils/random.ts';
import { isForagingHarvestAvailable } from '../foraging/foragingSeason.ts';
import { isWildStockHarvestable } from '../foraging/harvestReservePolicy.ts';
import { WATCHTOWER_GALLERY_FLOOR_HEIGHT } from '../buildings/watchtowerLayout.ts';
import { BUILDING_STORAGE_CAPS } from '../generated/gameBalance.ts';
import { STARTING_POPULATION } from '../generated/gameBalance.ts';
import { processorOutputHeadroom } from '../economy/processorOutputPolicy.ts';

export { WATCHTOWER_GALLERY_FLOOR_HEIGHT } from '../buildings/watchtowerLayout.ts';

export const PRODUCTION_WORKPLACE_KINDS = [
  'lumber_mill',
  'reforester',
  'woodcutters_lodge',
  'stone_quarry',
  'large_quarry',
  'mine',
  'clay_pit',
  'charcoal_burner',
  'smithy',
  'potter_kiln',
  'well',
  'hunters_hall',
  'foragers_shed',
  'fishing_camp',
  'threshing_barn',
  'pastoral_farmstead',
  'swineherd',
  'brewery',
  'smokehouse',
  'granary',
  'apiary',
  'watermill',
  'carpenter',
  'weaver',
  'watchtower',
  'guardhouse',
  'vineyard',
] as const satisfies readonly BuildingKind[];

const PRODUCTION_WORKPLACE_KIND_SET = new Set<BuildingKind>(PRODUCTION_WORKPLACE_KINDS);
const MAX_VISIBLE_WORKERS = 1024;
const MAX_TARGETS_PER_BUILDING = 96;
const MAX_PREFERRED_RESOURCE_WALK = 72;
const NO_ROSTERED_CART_WORKERS: ReadonlyMap<string, number> = new Map();

export type WorkerAssignment = {
  id: string;
  buildingId: string;
  slotIndex: number;
  homeResidenceId: string | null;
  personIdentity: string;
  onSite: boolean;
};

export type WorkerRoster = {
  assignments: WorkerAssignment[];
  remainingPopulationByResidence: Map<string, number>;
};

export type WorkerTargetKind =
  | 'tree'
  | 'quarry'
  | 'game'
  | 'berries'
  | 'mushrooms'
  | 'fish'
  | 'field'
  | 'pasture'
  | 'workstation'
  | 'construction';

export type WorkerTarget = PointXZ & {
  id: string;
  kind: WorkerTargetKind;
};

export type WorkerActivityKind =
  | 'chop'
  | 'mine'
  | 'gather'
  | 'plant'
  | 'fish'
  | 'tend'
  | 'build';

export type WorkerProductionBlocker =
  | 'clay_capacity'
  | 'charcoal_target'
  | 'ironwork_target'
  | 'pottery_target'
  | 'preserved_food_target'
  | 'firewood'
  | 'iron'
  | 'charcoal'
  | 'clay'
  | 'food'
  | 'salt'
  | 'pottery';

export type WorkerWalkPlan = {
  path: PointXZ[];
  activity: WorkerActivityKind | null;
  workDistance: number | null;
  target: WorkerTarget | null;
};

export type WorkerTargetInputs = {
  quarries: Iterable<ResourceNodeState>;
  foragingNodes: Iterable<ForagingNodeState>;
  trees: ReadonlyMap<string, TreeEntityState>;
  treeRegistry: {
    treesInRadius(x: number, z: number, radius: number): TreeLayoutEntry[];
  } | null;
  farmFields: Iterable<FarmFieldState>;
  pastures: Iterable<PastureState>;
  foragingMonth?: number;
};

/**
 * Processing buildings do not have replicated natural-resource nodes to walk
 * toward. These profiles give each staffed yard a small set of deterministic
 * outdoor workstations and an activity that reads clearly at game scale.
 */
export const YARD_WORK_ACTIVITY = {
  woodcutters_lodge: 'chop',
  mine: 'mine',
  clay_pit: 'plant',
  charcoal_burner: 'tend',
  smithy: 'build',
  potter_kiln: 'tend',
  well: 'tend',
  brewery: 'tend',
  smokehouse: 'tend',
  granary: 'tend',
  apiary: 'gather',
  watermill: 'tend',
  carpenter: 'build',
  weaver: 'tend',
  guardhouse: 'build',
  vineyard: 'tend',
} as const satisfies Partial<Record<BuildingKind, WorkerActivityKind>>;

export function isProductionWorkplaceKind(kind: BuildingKind): boolean {
  return PRODUCTION_WORKPLACE_KIND_SET.has(kind);
}

/**
 * Mirrors the authoritative material recipes closely enough to decide whether
 * a visible worker should perform a production action. Workers still remain
 * present and walk their yard while stalled; they simply stop pretending that
 * output is being made.
 */
export function workerProductionBlocker(
  building: BuildingState,
): WorkerProductionBlocker | null {
  if (building.constructionComplete === false) return null;

  if (building.kind === 'clay_pit') {
    const capacity = BUILDING_STORAGE_CAPS.clay_pit.clay ?? 0;
    return Math.max(0, building.clay ?? 0) >= capacity - 1e-6
      ? 'clay_capacity'
      : null;
  }

  let outputBlocker: WorkerProductionBlocker | null = null;
  switch (building.kind) {
    case 'charcoal_burner':
      outputBlocker = 'charcoal_target';
      break;
    case 'smithy':
      outputBlocker = 'ironwork_target';
      break;
    case 'potter_kiln':
      outputBlocker = 'pottery_target';
      break;
    case 'smokehouse':
      outputBlocker = 'preserved_food_target';
      break;
    default:
      return null;
  }

  if ((processorOutputHeadroom(building) ?? 0) <= 1e-6) {
    return outputBlocker;
  }

  switch (building.kind) {
    case 'charcoal_burner':
      return building.firewood > 1e-6 ? null : 'firewood';
    case 'smithy':
      if ((building.iron ?? 0) <= 1e-6) return 'iron';
      return (building.charcoal ?? 0) > 1e-6 ? null : 'charcoal';
    case 'potter_kiln':
      if ((building.clay ?? 0) <= 1e-6) return 'clay';
      return building.firewood > 1e-6 ? null : 'firewood';
    case 'smokehouse':
      if (building.food <= 1e-6) return 'food';
      if (building.firewood <= 1e-6) return 'firewood';
      if ((building.salt ?? 0) <= 1e-6) return 'salt';
      return (building.pottery ?? 0) > 1e-6 ? null : 'pottery';
  }
}

export function workerProductionBlockerDescription(
  blocker: WorkerProductionBlocker,
): string {
  switch (blocker) {
    case 'clay_capacity': return 'the clay yard is full';
    case 'charcoal_target': return 'the charcoal target has been reached';
    case 'ironwork_target': return 'the ironwork target has been reached';
    case 'pottery_target': return 'the pottery target has been reached';
    case 'preserved_food_target': return 'the preserved-food target has been reached';
    case 'firewood': return 'there is no firewood on site';
    case 'iron': return 'there is no raw iron on site';
    case 'charcoal': return 'there is no charcoal on site';
    case 'clay': return 'there is no clay on site';
    case 'food': return 'there is no fresh food on site';
    case 'salt': return 'there is no salt on site';
    case 'pottery': return 'there are no pottery vessels on site';
  }
}

/**
 * Claims real household members for visible production jobs. Nearest occupied
 * homes are used first; the settlement's unhoused starting population is the
 * fallback when there are more jobs than housed residents.
 */
export function allocateProductionWorkers(
  residences: readonly ResidenceState[],
  buildings: readonly BuildingState[],
  rosteredCartWorkersByBuilding: ReadonlyMap<string, number> = NO_ROSTERED_CART_WORKERS,
): WorkerRoster {
  const activeResidences = residences
    .filter((residence) => !residence.abandoned && residence.population > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
  const remainingPopulationByResidence = new Map(
    residences.map((residence) => [
      residence.id,
      residence.abandoned
        ? 0
        : Math.max(
            0,
            residence.population - Math.min(
              residence.population,
              Math.max(0, Math.floor(residence.sickPopulation ?? 0)),
            ),
          ),
    ]),
  );
  const assignments: WorkerAssignment[] = [];
  let fallbackPersonIndex = 0;
  const housedPopulation = activeResidences.reduce(
    (sum, residence) => sum + Math.max(0, Math.floor(residence.population)),
    0,
  );
  const unhousedPopulation = Math.max(0, STARTING_POPULATION - housedPopulation);

  const workplaces = buildings
    .filter((building) =>
      building.assignedLabor > 0
        && (building.constructionComplete === false || isProductionWorkplaceKind(building.kind))
    )
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const building of workplaces) {
    if (assignments.length >= MAX_VISIBLE_WORKERS) break;
    const workerCount = Math.max(0, Math.floor(building.assignedLabor));
    const awayWorkerCount = Math.min(
      workerCount,
      Math.max(0, Math.floor(rosteredCartWorkersByBuilding.get(building.id) ?? 0)),
    );
    const onSiteWorkerCount = workerCount - awayWorkerCount;
    for (let slotIndex = 0; slotIndex < workerCount; slotIndex++) {
      if (assignments.length >= MAX_VISIBLE_WORKERS) break;

      let home: ResidenceState | null = null;
      let bestDistanceSq = Infinity;
      for (const residence of activeResidences) {
        if ((remainingPopulationByResidence.get(residence.id) ?? 0) <= 0) continue;
        const distanceSq = (residence.x - building.x) ** 2 + (residence.z - building.z) ** 2;
        if (
          distanceSq < bestDistanceSq
          || (distanceSq === bestDistanceSq && home && residence.id < home.id)
        ) {
          home = residence;
          bestDistanceSq = distanceSq;
        }
      }

      let personIdentity: string;
      if (home) {
        const remaining = remainingPopulationByResidence.get(home.id) ?? 0;
        const claimedIndex = Math.max(0, home.population - remaining);
        remainingPopulationByResidence.set(home.id, remaining - 1);
        personIdentity = `${home.id}:person:${claimedIndex}`;
      } else {
        if (fallbackPersonIndex >= unhousedPopulation) break;
        personIdentity = `starting-population:${fallbackPersonIndex}`;
        fallbackPersonIndex += 1;
      }

      assignments.push({
        id: `worker:${building.id}:${slotIndex}`,
        buildingId: building.id,
        slotIndex,
        homeResidenceId: home?.id ?? null,
        personIdentity,
        onSite: slotIndex < onSiteWorkerCount,
      });
    }
  }

  return { assignments, remainingPopulationByResidence };
}

export function collectWorkerTargets(
  building: BuildingState,
  inputs: WorkerTargetInputs,
): WorkerTarget[] {
  const definition = getBuildingDefinition(building.kind);
  const radius = Math.max(0, building.workRadius || definition.workRadius);
  const targets: WorkerTarget[] = [];

  if (building.constructionComplete === false) {
    const workRadius = Math.max(3.4, definition.pickRadius * 0.62);
    for (let index = 0; index < 8; index += 1) {
      const angle = index / 8 * Math.PI * 2;
      targets.push({
        id: `${building.id}:construction:${index}`,
        kind: 'construction',
        x: building.x + Math.sin(angle) * workRadius,
        z: building.z + Math.cos(angle) * workRadius,
      });
    }
    return targets;
  }

  if (building.kind === 'lumber_mill' || building.kind === 'swineherd') {
    collectTreeTargets(building, radius, inputs, (phase) => phase === 'mature', targets);
  } else if (building.kind === 'reforester') {
    collectTreeTargets(
      building,
      radius,
      inputs,
      (phase) => phase === 'stump' || phase === 'growing',
      targets,
    );
  }

  if (definition.requiresQuarryStone) {
    for (const node of inputs.quarries) {
      if (node.kind !== 'quarry' || node.remaining <= 0) continue;
      pushNodeInsideExtent(building, radius, node, 'quarry', targets);
    }
  }
  if (building.kind === 'large_quarry') {
    const workRadius = Math.max(4.2, definition.pickRadius * 0.42);
    for (let index = 0; index < Math.max(4, definition.maxLabor); index++) {
      const angle = index / Math.max(4, definition.maxLabor) * Math.PI * 2;
      targets.push({
        id: `${building.id}:shaft:${index}`,
        kind: 'quarry',
        x: building.x + Math.sin(angle) * workRadius,
        z: building.z + Math.cos(angle) * workRadius,
      });
    }
  }
  if (definition.requiresGame) {
    for (const node of inputs.foragingNodes) {
      if (
        node.kind !== 'game'
        || !isWildStockHarvestable(node, building.harvestReservePercent ?? 0)
        || (
          inputs.foragingMonth !== undefined
          && !isForagingHarvestAvailable(node.kind, inputs.foragingMonth)
        )
      ) continue;
      pushNodeInsideExtent(building, radius, node, 'game', targets);
    }
  }
  if (definition.requiresBerries) {
    for (const node of inputs.foragingNodes) {
      if (
        (node.kind !== 'berries' && node.kind !== 'mushrooms')
        || node.remaining <= 0
        || (
          inputs.foragingMonth !== undefined
          && !isForagingHarvestAvailable(node.kind, inputs.foragingMonth)
        )
      ) continue;
      pushNodeInsideExtent(building, radius, node, node.kind, targets);
    }
  }
  if (definition.requiresFish) {
    for (const node of inputs.foragingNodes) {
      if (
        node.kind !== 'fish'
        || !isWildStockHarvestable(node, building.harvestReservePercent ?? 0)
        || (
          inputs.foragingMonth !== undefined
          && !isForagingHarvestAvailable(node.kind, inputs.foragingMonth)
        )
      ) continue;
      pushNodeInsideExtent(building, radius, node, 'fish', targets);
    }
  }

  if (building.kind === 'threshing_barn') {
    for (const field of inputs.farmFields) {
      if (field.farmsteadId !== building.id || field.priority <= 0) continue;
      const center = polygonCenter(field.corners);
      targets.push({ id: field.id, kind: 'field', ...center });
    }
  }
  if (building.kind === 'pastoral_farmstead' || building.kind === 'swineherd') {
    for (const pasture of inputs.pastures) {
      if (pasture.farmsteadId !== building.id) continue;
      const center = polygonCenter(pasture.corners);
      targets.push({ id: pasture.id, kind: 'pasture', ...center });
    }
  }

  if (building.kind in YARD_WORK_ACTIVITY) {
    collectYardWorkstations(building, targets);
  }

  targets.sort((a, b) => {
    const distanceA = distanceSq(building, a);
    const distanceB = distanceSq(building, b);
    return distanceA - distanceB || a.id.localeCompare(b.id);
  });
  return evenlyLimitTargets(targets, MAX_TARGETS_PER_BUILDING);
}

export function workplaceYardPosition(
  building: BuildingState,
  slotIndex: number,
): PointXZ & { yaw: number } {
  if (building.kind === 'watchtower') {
    const x = building.x + (slotIndex % 2 === 0 ? -0.58 : 0.58);
    const z = building.z + 3.05;
    return {
      x,
      z,
      yaw: Math.atan2(building.x - x, building.z - z),
    };
  }

  const definition = getBuildingDefinition(building.kind);
  const rng = mulberry32(hashStringSeed(`work-yard:${building.id}:${slotIndex}`));
  const angle = rng() * Math.PI * 2;
  const radius = Math.max(3.2, definition.pickRadius * (0.62 + rng() * 0.16));
  const x = building.x + Math.sin(angle) * radius;
  const z = building.z + Math.cos(angle) * radius;
  return {
    x,
    z,
    yaw: Math.atan2(building.x - x, building.z - z),
  };
}

export function watchtowerDutyPosition(
  building: BuildingState,
  slotIndex: number,
): PointXZ & { yaw: number; yOffset: number } {
  return slotIndex % 2 === 0
    ? {
        x: building.x - 0.78,
        z: building.z + 1.55,
        yaw: 0,
        yOffset: WATCHTOWER_GALLERY_FLOOR_HEIGHT,
      }
    : {
        x: building.x + 1.55,
        z: building.z - 0.78,
        yaw: Math.PI * 0.5,
        yOffset: WATCHTOWER_GALLERY_FLOOR_HEIGHT,
      };
}

export const WATCHTOWER_MUSTER_RANK_WIDTH = 6;

/**
 * Two compact ranks assemble clear of the ladder and tower collision footprint.
 * Each company caps at six workers. Additional road-linked companies extend
 * the formation away from the tower instead of overlapping the first rank.
 */
export function watchtowerMusterPosition(
  building: BuildingState,
  slotIndex: number,
): PointXZ & { yaw: number } {
  const slot = Math.max(0, Math.floor(slotIndex));
  const file = slot % WATCHTOWER_MUSTER_RANK_WIDTH;
  const rank = Math.floor(slot / WATCHTOWER_MUSTER_RANK_WIDTH);
  return {
    x: building.x
      + (file - (WATCHTOWER_MUSTER_RANK_WIDTH - 1) * 0.5) * 1.45,
    z: building.z + 4.55 + rank * 1.3,
    yaw: Math.PI,
  };
}

export function pickWorkerWalkPath(
  building: BuildingState,
  slotIndex: number,
  targets: readonly WorkerTarget[],
  seed: number,
): PointXZ[] | null {
  return pickWorkerWalkPlan(building, slotIndex, targets, seed)?.path ?? null;
}

export function pickWorkerWalkPlan(
  building: BuildingState,
  slotIndex: number,
  targets: readonly WorkerTarget[],
  seed: number,
): WorkerWalkPlan | null {
  const start = workplaceYardPosition(building, slotIndex);
  const rng = mulberry32(seed ^ hashStringSeed(building.id));

  if (
    targets.length > 0
    && (building.constructionComplete === false || rng() < 0.82)
  ) {
    const preferred = targets.filter(
      (target) => Math.sqrt(distanceSq(building, target))
        <= Math.min(Math.max(1, building.workRadius), MAX_PREFERRED_RESOURCE_WALK),
    );
    const pool = preferred.length > 0 ? preferred : targets;
    const target = pool[Math.floor(rng() * pool.length)] ?? pool[0];
    if (target) {
      const path = resourceWorkLoop(building, start, target, rng);
      if (polylineLengthXZ(path) >= 4) {
        const activity = workerActivityFor(building, target);
        return {
          path,
          activity,
          workDistance: activity ? polylineLengthXZ(path.slice(0, 3)) : null,
          target: activity ? target : null,
        };
      }
    }
  }

  const localPath = workplaceLoop(building, start, slotIndex, rng);
  return polylineLengthXZ(localPath) >= 4
    ? { path: localPath, activity: null, workDistance: null, target: null }
    : null;
}

export function pickWorkerCommutePath(
  start: PointXZ,
  destination: PointXZ,
  roadNetwork: RoadNetwork | null,
): PointXZ[] | null {
  const directDistance = Math.hypot(
    destination.x - start.x,
    destination.z - start.z,
  );
  if (directDistance < 0.25) return null;

  if (roadNetwork) {
    const route = roadPathRoute(
      roadNetwork,
      start.x,
      start.z,
      destination.x,
      destination.z,
    );
    if (route && route.distance >= 0.25 && route.polyline.length >= 2) {
      return route.polyline;
    }
  }

  // A direct fallback is preferable to teleporting when a workplace or home
  // has not yet been connected to the road graph.
  return [
    { x: start.x, z: start.z },
    { x: destination.x, z: destination.z },
  ];
}

function collectTreeTargets(
  building: BuildingState,
  radius: number,
  inputs: WorkerTargetInputs,
  acceptsPhase: (phase: TreeEntityState['phase']) => boolean,
  targets: WorkerTarget[],
): void {
  if (!inputs.treeRegistry || radius <= 0) return;
  for (const tree of inputs.treeRegistry.treesInRadius(building.x, building.z, radius)) {
    const entity = inputs.trees.get(tree.id);
    if (!entity || !acceptsPhase(entity.phase)) continue;
    targets.push({ id: tree.id, kind: 'tree', x: tree.x, z: tree.z });
  }
}

function workerActivityFor(
  building: BuildingState,
  target: WorkerTarget,
): WorkerActivityKind | null {
  if (building.constructionComplete === false && target.kind === 'construction') {
    return 'build';
  }
  if (building.kind === 'lumber_mill' && target.kind === 'tree') return 'chop';
  if (building.kind === 'reforester' && target.kind === 'tree') return 'plant';
  if (building.kind === 'stone_quarry' && target.kind === 'quarry') return 'mine';
  if (building.kind === 'large_quarry' && target.kind === 'quarry') return 'mine';
  if (building.kind === 'hunters_hall' && target.kind === 'game') return 'gather';
  if (
    building.kind === 'foragers_shed'
    && (target.kind === 'berries' || target.kind === 'mushrooms')
  ) return 'gather';
  if (building.kind === 'fishing_camp' && target.kind === 'fish') return 'fish';
  if (building.kind === 'threshing_barn' && target.kind === 'field') return 'tend';
  if (
    (building.kind === 'pastoral_farmstead' || building.kind === 'swineherd')
    && target.kind === 'pasture'
  ) return 'tend';
  if (building.kind === 'swineherd' && target.kind === 'tree') return 'gather';
  if (target.kind === 'workstation') {
    if (workerProductionBlocker(building)) return null;
    return YARD_WORK_ACTIVITY[
      building.kind as keyof typeof YARD_WORK_ACTIVITY
    ] ?? null;
  }
  return null;
}

function collectYardWorkstations(
  building: BuildingState,
  targets: WorkerTarget[],
): void {
  const definition = getBuildingDefinition(building.kind);
  const count = Math.max(2, definition.maxLabor);
  const radius = Math.max(4.2, definition.pickRadius * 0.74);
  const phase = hashStringSeed(`workstations:${building.id}`) / 0xffff_ffff
    * Math.PI * 2;
  for (let index = 0; index < count; index += 1) {
    const angle = phase + index / count * Math.PI * 2;
    targets.push({
      id: `${building.id}:workstation:${index}`,
      kind: 'workstation',
      x: building.x + Math.sin(angle) * radius,
      z: building.z + Math.cos(angle) * radius,
    });
  }
}

function pushNodeInsideExtent(
  building: BuildingState,
  radius: number,
  node: ResourceNodeState,
  kind: Extract<WorkerTargetKind, 'quarry' | 'game' | 'berries' | 'mushrooms' | 'fish'>,
  targets: WorkerTarget[],
): void {
  if (radius <= 0 || distanceSq(building, node) > radius * radius) return;
  targets.push({ id: node.nodeId, kind, x: node.x, z: node.z });
}

function resourceWorkLoop(
  building: BuildingState,
  start: PointXZ,
  target: WorkerTarget,
  rng: () => number,
): PointXZ[] {
  const dx = target.x - start.x;
  const dz = target.z - start.z;
  const length = Math.max(0.001, Math.hypot(dx, dz));
  const normalX = -dz / length;
  const normalZ = dx / length;
  const bend = (rng() - 0.5) * Math.min(10, length * 0.24);
  const midpoint = clampToWorkExtent(building, {
    x: (start.x + target.x) * 0.5 + normalX * bend,
    z: (start.z + target.z) * 0.5 + normalZ * bend,
  });
  const approachAngle = rng() * Math.PI * 2;
  const approachRadius = target.kind === 'tree'
    ? 1.8
    : target.kind === 'workstation'
      ? 1.15
      : 2.4;
  const approach = clampToWorkExtent(building, {
    x: target.x + Math.sin(approachAngle) * approachRadius,
    z: target.z + Math.cos(approachAngle) * approachRadius,
  });
  const workStep = 1.6 + rng() * 1.4;
  const around = clampToWorkExtent(building, {
    x: target.x + Math.sin(approachAngle + Math.PI * 0.62) * workStep,
    z: target.z + Math.cos(approachAngle + Math.PI * 0.62) * workStep,
  });
  return [
    start,
    midpoint,
    approach,
    around,
    approach,
    midpoint,
    start,
  ];
}

function workplaceLoop(
  building: BuildingState,
  start: PointXZ,
  slotIndex: number,
  rng: () => number,
): PointXZ[] {
  const definition = getBuildingDefinition(building.kind);
  const radius = Math.max(4, definition.pickRadius * (0.72 + rng() * 0.24));
  const startAngle = Math.atan2(start.x - building.x, start.z - building.z);
  const direction = slotIndex % 2 === 0 ? 1 : -1;
  const points: PointXZ[] = [start];
  for (let step = 1; step <= 3; step++) {
    const angle = startAngle + direction * step * (Math.PI * 0.48) + (rng() - 0.5) * 0.2;
    points.push({
      x: building.x + Math.sin(angle) * radius,
      z: building.z + Math.cos(angle) * radius,
    });
  }
  points.push(start);
  return points;
}

function clampToWorkExtent(building: BuildingState, point: PointXZ): PointXZ {
  if (building.workRadius <= 0) return point;
  const dx = point.x - building.x;
  const dz = point.z - building.z;
  const distance = Math.hypot(dx, dz);
  const limit = Math.max(1, building.workRadius - 0.75);
  if (distance <= limit) return point;
  const scale = limit / Math.max(0.001, distance);
  return {
    x: building.x + dx * scale,
    z: building.z + dz * scale,
  };
}

function polygonCenter(corners: FarmFieldState['corners']): PointXZ {
  let x = 0;
  let z = 0;
  for (const corner of corners) {
    x += corner.x;
    z += corner.z;
  }
  return { x: x / corners.length, z: z / corners.length };
}

function evenlyLimitTargets(
  targets: readonly WorkerTarget[],
  limit: number,
): WorkerTarget[] {
  if (targets.length <= limit) return [...targets];
  const result: WorkerTarget[] = [];
  for (let index = 0; index < limit; index++) {
    const sourceIndex = Math.floor(index * targets.length / limit);
    const target = targets[sourceIndex];
    if (target) result.push(target);
  }
  return result;
}

function distanceSq(a: PointXZ, b: PointXZ): number {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}
