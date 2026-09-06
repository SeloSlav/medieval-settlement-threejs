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
  VineyardParcelState,
} from '../resources/types.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import {
  effectiveTreeWorkArea,
  hasCustomTreeWorkArea,
} from '../resources/treeWorkArea.ts';
import {
  compareStableEntityIds,
  roadPathDistancesFrom,
  roadPathRoute,
} from '../logistics/roadLogistics.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { PEDESTRIAN_ROAD_SPEED_MULTIPLIER } from '../roads/roadTravel.ts';
import { polylineLengthXZ, type PointXZ } from '../utils/pathGeometry.ts';
import { hashStringSeed, mulberry32 } from '../utils/random.ts';
import { isForagingHarvestAvailable } from '../foraging/foragingSeason.ts';
import {
  HARVEST_RESERVE_DEFAULT_PERCENT,
  isWildStockHarvestable,
} from '../foraging/harvestReservePolicy.ts';
import { WATCHTOWER_GALLERY_FLOOR_HEIGHT } from '../buildings/watchtowerLayout.ts';
import { BUILDING_STORAGE_CAPS } from '../generated/gameBalance.ts';
import { STARTING_POPULATION } from '../generated/gameBalance.ts';
import { preservableFoodStock } from '../economy/foodInventory.ts';
import { processorOutputHeadroom } from '../economy/processorOutputPolicy.ts';
import { resolvedPlacedBuildingYaw } from '../buildings/buildingPlacement.ts';
import {
  MONASTERY_EXTENSION_GUESTHOUSE,
  MONASTERY_EXTENSION_INFIRMARY,
  MONASTERY_EXTENSION_SCRIPTORIUM,
  monasteryHasExtension,
} from '../buildings/monasteryEstate.ts';
import {
  fieldAcceptsFarmsteadLabor,
  fieldStageAllowed,
} from '../farming/farmWorkPlanning.ts';
import {
  bilinearPoint,
  fieldEdgeLengths,
} from '../farming/farmFieldMath.ts';
import { fieldTaskRank } from '../farming/threshingPriority.ts';
import { residenceDoorPosition } from './villagerPaths.ts';
import { treeFallDirection } from '../forestry/forestry.ts';
import type { ClericDuty } from './clericBehaviors.ts';

export { WATCHTOWER_GALLERY_FLOOR_HEIGHT } from '../buildings/watchtowerLayout.ts';

export const PRODUCTION_WORKPLACE_KINDS = [
  'lumber_mill',
  'reforester',
  'woodcutters_lodge',
  'stone_quarry',
  'large_quarry',
  'mine',
  'charcoal_burner',
  'smithy',
  'potter_kiln',
  'stone_mason',
  'well',
  'hunters_hall',
  'foragers_shed',
  'fishing_camp',
  'chapel',
  'threshing_barn',
  'pastoral_farmstead',
  'swineherd',
  'monastery',
  'brewery',
  'smokehouse',
  'granary',
  'village_storehouse',
  'bakery',
  'apiary',
  'watermill',
  'windmill',
  'carpenter',
  'spinning_retting_house',
  'weaver',
  'chandlery',
  'watchtower',
  'guardhouse',
] as const satisfies readonly BuildingKind[];

const PRODUCTION_WORKPLACE_KIND_SET = new Set<BuildingKind>(PRODUCTION_WORKPLACE_KINDS);
/** Worker presentation is one-to-one with assigned labor; batching owns cost. */
const MAX_VISIBLE_WORKERS = Number.MAX_SAFE_INTEGER;
const MAX_TARGETS_PER_BUILDING = 96;
const MAX_PREFERRED_RESOURCE_WALK = 72;
const NO_ROSTERED_CART_WORKERS: ReadonlyMap<string, number> = new Map();
const FISHING_SHORE_TRACE_STEP = 0.35;
const FISHING_SHORE_REFINEMENT_STEPS = 8;
export const FISHING_SHORE_STANDOFF = 1.1;
const FISHING_YARD_SHORE_STANDOFF = 3.4;
const FISHING_YARD_WATER_CLEARANCE = 1.25;
const FISHING_YARD_WATER_PROBES = 16;

export type WorkerWaterTest = (x: number, z: number) => boolean;

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
  activity?: WorkerActivityKind;
  /** Retains the authoritative field phase so presentation can pick a specific action. */
  fieldStage?: FarmFieldState['stage'];
  fieldId?: string;
  fieldPriority?: number;
  fieldTaskRank?: number;
  fieldLinked?: boolean;
  /** Inset endpoints of one real pass across a quadrilateral field. */
  fieldLane?: Readonly<{ start: PointXZ; end: PointXZ; index: number }>;
  clericDuty?: ClericDuty;
  interior?: boolean;
  allowOutsideWorkExtent?: boolean;
  /** Authored stance beside a grounded trunk, facing its actual cutting point. */
  workStand?: PointXZ;
};

export type WorkerActivityKind =
  | 'chop'
  | 'hunt'
  | 'mine'
  | 'gather'
  | 'plant'
  | 'sow'
  | 'fish'
  | 'tend'
  | 'build';

export type WorkerProductionBlocker =
  | 'timber_capacity'
  | 'firewood_capacity'
  | 'clay_capacity'
  | 'charcoal_target'
  | 'ironwork_target'
  | 'pottery_target'
  | 'preserved_food_target'
  | 'candles_target'
  | 'firewood'
  | 'iron'
  | 'charcoal'
  | 'clay'
  | 'water'
  | 'food'
  | 'salt'
  | 'pottery'
  | 'wax';

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
  vineyardParcels?: Iterable<VineyardParcelState>;
  foragingMonth?: number;
  roadNetwork?: RoadNetwork | null;
  buildings?: ReadonlyMap<string, BuildingState>;
  residences?: readonly ResidenceState[];
};

/**
 * Processing buildings do not have replicated natural-resource nodes to walk
 * toward. These profiles give each staffed yard a small set of deterministic
 * outdoor workstations and an activity that reads clearly at game scale.
 */
export const YARD_WORK_ACTIVITY = {
  mine: 'mine',
  charcoal_burner: 'tend',
  smithy: 'build',
  potter_kiln: 'tend',
  stone_mason: 'build',
  well: 'tend',
  brewery: 'tend',
  smokehouse: 'tend',
  granary: 'tend',
  village_storehouse: 'tend',
  bakery: 'tend',
  apiary: 'gather',
  watermill: 'tend',
  windmill: 'tend',
  carpenter: 'build',
  spinning_retting_house: 'tend',
  weaver: 'tend',
  chandlery: 'tend',
  guardhouse: 'build',
  monastery: 'tend',
} as const satisfies Partial<Record<BuildingKind, WorkerActivityKind>>;

const MONASTERY_WORKSTATIONS = [
  { id: 'cloister', localX: -2.3, localZ: 2.15, activity: 'tend', clericDuty: 'cloister_prayer', interior: true },
  { id: 'scriptorium', localX: -11.7, localZ: 0.7, activity: 'tend', clericDuty: 'scriptorium', interior: true, requiredExtension: MONASTERY_EXTENSION_SCRIPTORIUM },
  { id: 'infirmary', localX: 7.1, localZ: 0.4, activity: 'tend', clericDuty: 'infirmary_care', interior: true, requiredExtension: MONASTERY_EXTENSION_INFIRMARY },
  { id: 'guesthouse', localX: 27, localZ: 0.2, activity: 'tend', clericDuty: 'hospitality', interior: true, requiredExtension: MONASTERY_EXTENSION_GUESTHOUSE },
  { id: 'mead-brewhouse', localX: -17.8, localZ: -12, activity: 'tend', clericDuty: 'brewing', interior: true },
  { id: 'cider-press', localX: -22.8, localZ: -11.8, activity: 'tend', clericDuty: 'brewing', interior: true },
  { id: 'vintner', localX: -17, localZ: -23.5, activity: 'tend', clericDuty: 'brewing', interior: true, requiresVineyard: true },
  { id: 'orchard', localX: -23, localZ: -35.25, activity: 'gather', clericDuty: 'pruning' },
  { id: 'apiary', localX: -26, localZ: -22, activity: 'gather', clericDuty: 'harvest' },
  { id: 'croft', localX: -7, localZ: -18.75, activity: 'tend', clericDuty: 'soil_work' },
  { id: 'herb-garden', localX: 3.5, localZ: -19, activity: 'gather', clericDuty: 'harvest' },
  { id: 'hen-yard', localX: 26, localZ: -12, activity: 'tend', clericDuty: 'livestock_care' },
  { id: 'small-stock-yard', localX: 24, localZ: -25, activity: 'tend', clericDuty: 'livestock_care' },
  { id: 'pasture', localX: 19.25, localZ: -37, activity: 'tend', clericDuty: 'ox_guidance' },
  { id: 'seed-archive', localX: 1, localZ: -37, activity: 'tend', clericDuty: 'scriptorium', interior: true },
  // A porter or almoner occasionally works beyond the gate on the roadside.
  { id: 'outer-gate', localX: 16.5, localZ: 14.5, activity: 'gather', clericDuty: 'hospitality' },
] as const satisfies readonly {
  id: string;
  localX: number;
  localZ: number;
  activity: WorkerActivityKind;
  clericDuty: ClericDuty;
  interior?: boolean;
  requiredExtension?: number;
  requiresVineyard?: boolean;
}[];

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

  if (building.kind === 'lumber_mill') {
    const capacity = BUILDING_STORAGE_CAPS.lumber_mill.timber ?? 0;
    return building.timber >= capacity - 1e-6 ? 'timber_capacity' : null;
  }

  if (building.kind === 'woodcutters_lodge') {
    const capacity = BUILDING_STORAGE_CAPS.woodcutters_lodge.firewood ?? 0;
    return building.firewood >= capacity - 1e-6 ? 'firewood_capacity' : null;
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
    case 'chandlery':
      outputBlocker = 'candles_target';
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
      if ((building.charcoal ?? 0) <= 1e-6) return 'charcoal';
      return building.water > 1e-6 ? null : 'water';
    case 'potter_kiln':
      if ((building.clay ?? 0) <= 1e-6) return 'clay';
      if (building.firewood <= 1e-6) return 'firewood';
      return building.water > 1e-6 ? null : 'water';
    case 'smokehouse':
      if (preservableFoodStock(building) <= 1e-6) return 'food';
      if (building.firewood <= 1e-6) return 'firewood';
      if ((building.salt ?? 0) <= 1e-6) return 'salt';
      return (building.pottery ?? 0) > 1e-6 ? null : 'pottery';
    case 'chandlery':
      if ((building.wax ?? 0) <= 1e-6) return 'wax';
      return building.firewood > 1e-6 ? null : 'firewood';
  }
}

export function workerProductionBlockerDescription(
  blocker: WorkerProductionBlocker,
): string {
  switch (blocker) {
    case 'timber_capacity': return 'the timber yard is full';
    case 'firewood_capacity': return 'the firewood yard is full';
    case 'clay_capacity': return 'the clay yard is full';
    case 'charcoal_target': return 'the charcoal target has been reached';
    case 'ironwork_target': return 'the ironwork target has been reached';
    case 'pottery_target': return 'the pottery target has been reached';
    case 'preserved_food_target': return 'the savory-preserve target has been reached';
    case 'candles_target': return 'the candle target has been reached';
    case 'firewood': return 'there is no firewood on site';
    case 'iron': return 'there is no raw iron on site';
    case 'charcoal': return 'there is no charcoal on site';
    case 'clay': return 'there is no clay on site';
    case 'water': return 'there is no workshop water on site';
    case 'food': return 'there is no fresh food on site';
    case 'salt': return 'there is no salt on site';
    case 'pottery': return 'there are no pottery vessels on site';
    case 'wax': return 'there is no beeswax on site';
  }
}

/**
 * Claims real household members for visible production jobs. Building/home
 * pairs are considered settlement-wide by routed travel distance, so stable
 * building-table order cannot strand a nearby household at a remote worksite.
 * The settlement's unhoused starting population remains the final fallback.
 */
export function allocateProductionWorkers(
  residences: readonly ResidenceState[],
  buildings: readonly BuildingState[],
  rosteredCartWorkersByBuilding: ReadonlyMap<string, number> = NO_ROSTERED_CART_WORKERS,
  roadNetwork: RoadNetwork | null = null,
): WorkerRoster {
  const occupiedResidences = residences
    .filter((residence) => !residence.abandoned && residence.population > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
  const activeResidences = occupiedResidences.filter(
    (residence) => residence.smallholding !== true,
  );
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
  const healthyHousedPopulation = occupiedResidences.reduce(
    (sum, residence) => sum + Math.max(
      0,
      Math.floor(residence.population)
        - Math.min(
            Math.floor(residence.population),
            Math.max(0, Math.floor(residence.sickPopulation ?? 0)),
          ),
    ),
    0,
  );
  const unhousedPopulation = Math.max(0, STARTING_POPULATION - healthyHousedPopulation);

  const workplaces = buildings
    .filter((building) =>
      building.assignedLabor > 0
        && (building.constructionComplete === false || isProductionWorkplaceKind(building.kind))
    )
    .sort((a, b) => a.id.localeCompare(b.id));

  const openSlots = new Map<string, number[]>();
  const onSiteWorkers = new Map<string, number>();
  let visibleSlotBudget = MAX_VISIBLE_WORKERS;
  for (const building of workplaces) {
    if (visibleSlotBudget <= 0) break;
    const workerCount = Math.max(0, Math.floor(building.assignedLabor));
    const visibleWorkerCount = Math.min(workerCount, visibleSlotBudget);
    const awayWorkerCount = Math.min(
      workerCount,
      Math.max(0, Math.floor(rosteredCartWorkersByBuilding.get(building.id) ?? 0)),
    );
    onSiteWorkers.set(building.id, workerCount - awayWorkerCount);
    openSlots.set(
      building.id,
      Array.from({ length: visibleWorkerCount }, (_, slotIndex) => slotIndex),
    );
    visibleSlotBudget -= visibleWorkerCount;
  }

  const travelPairs: Array<{
    building: BuildingState;
    residence: ResidenceState;
    travelCost: number;
  }> = [];
  const residenceTargets = activeResidences.map((residence) => ({
    x: residence.x,
    z: residence.z,
  }));
  for (const building of workplaces) {
    if (!openSlots.has(building.id)) continue;
    const roadDistances = roadNetwork
      ? roadPathDistancesFrom(
          roadNetwork,
          building.x,
          building.z,
          residenceTargets,
        )
      : null;
    for (let index = 0; index < activeResidences.length; index += 1) {
      const residence = activeResidences[index];
      const roadDistance = roadDistances?.[index] ?? null;
      travelPairs.push({
        building,
        residence,
        travelCost: roadDistance != null
          ? roadDistance / PEDESTRIAN_ROAD_SPEED_MULTIPLIER
          : Math.hypot(
              residence.x - building.x,
              residence.z - building.z,
            ),
      });
    }
  }

  travelPairs.sort((a, b) =>
    a.travelCost - b.travelCost
      || a.building.id.localeCompare(b.building.id)
      || a.residence.id.localeCompare(b.residence.id),
  );

  for (const pair of travelPairs) {
    const slots = openSlots.get(pair.building.id);
    if (!slots || slots.length === 0) continue;
    let remaining = remainingPopulationByResidence.get(pair.residence.id) ?? 0;
    while (slots.length > 0 && remaining > 0) {
      const slotIndex = slots.shift()!;
      const claimedIndex = Math.max(0, pair.residence.population - remaining);
      remaining -= 1;
      assignments.push({
        id: `worker:${pair.building.id}:${slotIndex}`,
        buildingId: pair.building.id,
        slotIndex,
        homeResidenceId: pair.residence.id,
        personIdentity: `${pair.residence.id}:person:${claimedIndex}`,
        onSite: slotIndex < (onSiteWorkers.get(pair.building.id) ?? 0),
      });
    }
    remainingPopulationByResidence.set(pair.residence.id, remaining);
  }

  let fallbackPersonIndex = 0;
  for (const building of workplaces) {
    const slots = openSlots.get(building.id) ?? [];
    while (slots.length > 0 && fallbackPersonIndex < unhousedPopulation) {
      const slotIndex = slots.shift()!;
      assignments.push({
        id: `worker:${building.id}:${slotIndex}`,
        buildingId: building.id,
        slotIndex,
        homeResidenceId: null,
        personIdentity: `starting-population:${fallbackPersonIndex}`,
        onSite: slotIndex < (onSiteWorkers.get(building.id) ?? 0),
      });
      fallbackPersonIndex += 1;
    }
  }

  assignments.sort((a, b) =>
    a.buildingId.localeCompare(b.buildingId) || a.slotIndex - b.slotIndex,
  );

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

  if (building.kind === 'lumber_mill' || building.kind === 'woodcutters_lodge') {
    const area = effectiveTreeWorkArea(building);
    const trees = inputs.treeRegistry?.treesInRadius(area.x, area.z, area.radius) ?? [];
    const fallen: WorkerTarget[] = [];
    const logs: WorkerTarget[] = [];
    let falling = false;
    let usefulLogs = false;
    for (const tree of trees) {
      const entity = inputs.trees.get(tree.id);
      if (!entity) continue;
      falling ||= entity.phase === 'falling';
      if (entity.phase === 'fallen') {
        if (entity.workBuildingId && entity.workBuildingId !== building.id) continue;
        const yaw = treeFallDirection(tree.layoutIndex);
        fallen.push({ id: `${tree.id}:bucking`, kind: 'tree',
          x: tree.x + Math.sin(yaw)*3, z: tree.z + Math.cos(yaw)*3,
          workStand: { x: tree.x + Math.sin(yaw)*3 + Math.cos(yaw)*0.85,
            z: tree.z + Math.cos(yaw)*3 - Math.sin(yaw)*0.85 } });
      }
      if (entity.phase === 'logs') {
        entity.logs?.forEach((log,index) => {
          usefulLogs ||= building.kind === 'woodcutters_lodge'
            ? log.health >= 5 || log.firewood >= 1 : log.health >= 10;
          if (log.health < 5 || building.kind !== 'woodcutters_lodge') return;
          const yaw = treeFallDirection(tree.layoutIndex);
          logs.push({ id: `${tree.id}:log:${index}`, kind: 'tree', x: log.x, z: log.z,
            workStand: { x: log.x + Math.cos(yaw)*0.85, z: log.z - Math.sin(yaw)*0.85 } });
        });
      }
    }
    if (fallen.length) targets.push(...fallen);
    else if (logs.length) targets.push(...logs);
    else if (!falling && !usefulLogs && !trees.some(tree => inputs.trees.get(tree.id)?.phase === 'fallen')) {
      collectTreeTargets(area, inputs, phase => phase === 'mature', targets);
    }
  } else if (building.kind === 'swineherd') {
    collectTreeTargets(
      { x: building.x, z: building.z, radius },
      inputs,
      (phase) => phase === 'mature',
      targets,
    );
  } else if (building.kind === 'reforester') {
    collectTreeTargets(
      effectiveTreeWorkArea(building),
      inputs,
      (phase) => phase === 'stump' || phase === 'growing',
      targets,
    );
  }

  if (building.kind === 'stone_quarry' || definition.requiresQuarryStone) {
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
        || !isWildStockHarvestable(
          node,
          building.harvestReservePercent ?? HARVEST_RESERVE_DEFAULT_PERCENT,
        )
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
        || !isWildStockHarvestable(
          node,
          building.harvestReservePercent ?? HARVEST_RESERVE_DEFAULT_PERCENT,
        )
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
        || !isWildStockHarvestable(
          node,
          building.harvestReservePercent ?? HARVEST_RESERVE_DEFAULT_PERCENT,
        )
        || (
          inputs.foragingMonth !== undefined
          && !isForagingHarvestAvailable(node.kind, inputs.foragingMonth)
        )
      ) continue;
      pushNodeInsideExtent(building, radius, node, 'fish', targets);
    }
  }

  if (building.kind === 'threshing_barn') {
    collectFarmFieldTargets(building, inputs, targets);
  }
  if (building.kind === 'pastoral_farmstead' || building.kind === 'swineherd') {
    for (const pasture of inputs.pastures) {
      if (pasture.farmsteadId !== building.id) continue;
      const center = polygonCenter(pasture.corners);
      targets.push({ id: pasture.id, kind: 'pasture', ...center });
    }
  }

  if (building.kind === 'monastery') {
    collectMonasteryWorkstations(
      building,
      inputs.roadNetwork ?? null,
      inputs.vineyardParcels ?? [],
      targets,
    );
  } else if (building.kind === 'chapel') {
    collectChapelDuties(
      building,
      inputs.roadNetwork ?? null,
      inputs.residences ?? [],
      targets,
    );
  } else if (building.kind in YARD_WORK_ACTIVITY) {
    collectYardWorkstations(building, targets);
  }

  targets.sort((a, b) => {
    if (building.kind === 'threshing_barn') {
      if (a.kind === 'field' && b.kind !== 'field') return -1;
      if (a.kind !== 'field' && b.kind === 'field') return 1;
      if (a.kind === 'field' && b.kind === 'field') {
        return (b.fieldTaskRank ?? 0) - (a.fieldTaskRank ?? 0)
          || (b.fieldPriority ?? 0) - (a.fieldPriority ?? 0)
          || fieldStageUrgency(b.fieldStage) - fieldStageUrgency(a.fieldStage)
          || Number(b.fieldLinked === true) - Number(a.fieldLinked === true)
          || compareStableEntityIds(a.fieldId ?? a.id, b.fieldId ?? b.id)
          || (a.fieldLane?.index ?? 0) - (b.fieldLane?.index ?? 0);
      }
    }
    const distanceA = distanceSq(building, a);
    const distanceB = distanceSq(building, b);
    return distanceA - distanceB || a.id.localeCompare(b.id);
  });
  return evenlyLimitTargets(targets, MAX_TARGETS_PER_BUILDING);
}

export function workplaceYardPosition(
  building: BuildingState,
  slotIndex: number,
  roadNetwork: RoadNetwork | null = null,
  isWaterAt: WorkerWaterTest | null = null,
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

  if (building.kind === 'monastery' && building.constructionComplete !== false) {
    const localX = 13.7 + (slotIndex % 3) * 1.45;
    const localZ = 4.5 - Math.floor(slotIndex / 3) * 1.35;
    const position = monasteryWorldPoint(building, localX, localZ, roadNetwork);
    return {
      ...position,
      yaw: Math.atan2(building.x - position.x, building.z - position.z),
    };
  }

  const definition = getBuildingDefinition(building.kind);
  const rng = mulberry32(hashStringSeed(`work-yard:${building.id}:${slotIndex}`));
  const angle = rng() * Math.PI * 2;
  const radius = Math.max(3.2, definition.pickRadius * (0.62 + rng() * 0.16));
  const x = building.x + Math.sin(angle) * radius;
  const z = building.z + Math.cos(angle) * radius;
  const yard = {
    x,
    z,
    yaw: Math.atan2(building.x - x, building.z - z),
  };
  if (building.kind !== 'fishing_camp') {
    return yard;
  }
  if (!isWaterAt) {
    return { x: building.x, z: building.z, yaw: yard.yaw };
  }

  const wetProbe = fishingYardWetProbe(yard, isWaterAt);
  if (!wetProbe) return yard;
  const dryYard = findFishingShoreWorkPosition(
    building,
    wetProbe,
    isWaterAt,
    FISHING_YARD_SHORE_STANDOFF,
  );
  return dryYard
    ? {
        ...dryYard,
        yaw: Math.atan2(building.x - dryYard.x, building.z - dryYard.z),
      }
    : {
        x: building.x,
        z: building.z,
        yaw: yard.yaw,
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
  roadNetwork: RoadNetwork | null = null,
  isWaterAt: WorkerWaterTest | null = null,
  preferOxFieldWork = false,
): WorkerWalkPlan | null {
  const start = workplaceYardPosition(
    building,
    slotIndex,
    roadNetwork,
    isWaterAt,
  );
  const rng = mulberry32(seed ^ hashStringSeed(building.id));

  const activeFieldTargets = building.kind === 'threshing_barn'
    ? targets.filter((target) => target.kind === 'field')
    : [];
  const activeOxGuidanceTargets = building.kind === 'monastery' && preferOxFieldWork
    ? targets.filter((target) => target.clericDuty === 'ox_guidance')
    : [];
  if (
    targets.length > 0
    && (
      building.constructionComplete === false
      || building.kind === 'fishing_camp'
      || activeFieldTargets.length > 0
      || activeOxGuidanceTargets.length > 0
      || rng() < 0.82
    )
  ) {
    const activityTargets = activeFieldTargets.length > 0
      ? activeFieldTargets
      : activeOxGuidanceTargets.length > 0
        ? activeOxGuidanceTargets
        : targets;
    const preferred = activityTargets.filter(
      (target) => Math.sqrt(distanceSq(building, target))
        <= Math.min(Math.max(1, building.workRadius), MAX_PREFERRED_RESOURCE_WALK),
    );
    // Linked parcels remain valid however far they lie from their holding, so
    // field presentation must not discard them merely because a generic
    // resource-walk preference is shorter than the authoritative rule.
    const pool = activeFieldTargets.length > 0 || activeOxGuidanceTargets.length > 0
      ? activityTargets
      : preferred.length > 0
        ? preferred
        : activityTargets;
    const target = activeFieldTargets.length > 0
      ? pickFarmFieldTarget(pool, slotIndex, preferOxFieldWork)
      : pool[Math.floor(rng() * pool.length)] ?? pool[0];
    if (target) {
      const path = resourceWorkLoop(building, start, target, rng, isWaterAt);
      const minimumPathLength = target.kind === 'fish' ? 0.25 : 4;
      if (path && polylineLengthXZ(path) >= minimumPathLength) {
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

  // A fishing camp's generic orbit can overlap the very bank it works from.
  // When there is no safe resource route, leave the crew at its verified dry
  // yard position instead of inventing a walk through the water.
  if (building.kind === 'fishing_camp') return null;

  const localPath = workplaceLoop(building, start, slotIndex, rng);
  return polylineLengthXZ(localPath) >= 4
    ? { path: localPath, activity: null, workDistance: null, target: null }
    : null;
}

export function pickWorkerTravelPath(
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

  // A direct fallback is preferable to teleporting when either endpoint has
  // not yet been connected to the road graph.
  return [
    { x: start.x, z: start.z },
    { x: destination.x, z: destination.z },
  ];
}

function collectTreeTargets(
  area: PointXZ & { radius: number },
  inputs: WorkerTargetInputs,
  acceptsPhase: (phase: TreeEntityState['phase']) => boolean,
  targets: WorkerTarget[],
): void {
  if (!inputs.treeRegistry || area.radius <= 0) return;
  for (const tree of inputs.treeRegistry.treesInRadius(area.x, area.z, area.radius)) {
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
  if (target.activity) return target.activity;
  if (
    (building.kind === 'lumber_mill' || building.kind === 'woodcutters_lodge')
    && target.kind === 'tree'
  ) return 'chop';
  if (building.kind === 'reforester' && target.kind === 'tree') return 'plant';
  if (building.kind === 'stone_quarry' && target.kind === 'quarry') return 'mine';
  if (building.kind === 'large_quarry' && target.kind === 'quarry') return 'mine';
  if (building.kind === 'hunters_hall' && target.kind === 'game') return 'hunt';
  if (
    building.kind === 'foragers_shed'
    && (target.kind === 'berries' || target.kind === 'mushrooms')
  ) return 'gather';
  if (building.kind === 'fishing_camp' && target.kind === 'fish') return 'fish';
  if (building.kind === 'threshing_barn' && target.kind === 'field') {
    return target.fieldStage === 'sowing' ? 'sow' : 'tend';
  }
  if (
    (building.kind === 'pastoral_farmstead' || building.kind === 'swineherd')
    && target.kind === 'pasture'
  ) return 'tend';
  if (building.kind === 'swineherd' && target.kind === 'tree') return 'gather';
  if (target.kind === 'workstation') {
    if (workerProductionBlocker(building)) return null;
    if (target.activity) return target.activity;
    return YARD_WORK_ACTIVITY[
      building.kind as keyof typeof YARD_WORK_ACTIVITY
    ] ?? null;
  }
  return null;
}

function collectFarmFieldTargets(
  building: BuildingState,
  inputs: WorkerTargetInputs,
  targets: WorkerTarget[],
): void {
  for (const field of inputs.farmFields) {
    const linked = field.farmsteadId === building.id;
    const resourceFarmstead = linked
      ? building
      : inputs.buildings?.get(field.farmsteadId) ?? null;
    if (
      field.stage === 'growing'
      || field.stageProgress >= 1 - 1e-9
      || !resourceFarmstead
      || resourceFarmstead.kind !== 'threshing_barn'
      || resourceFarmstead.constructionComplete === false
      || !fieldAcceptsFarmsteadLabor(field, building)
      || (
        inputs.foragingMonth !== undefined
        && !fieldStageAllowed(field, inputs.foragingMonth)
      )
    ) continue;

    const edges = fieldEdgeLengths(field.corners);
    const alongWidth = (edges[0] + edges[2]) >= (edges[1] + edges[3]);
    const crossLength = alongWidth
      ? (edges[1] + edges[3]) * 0.5
      : (edges[0] + edges[2]) * 0.5;
    const laneCount = Math.max(2, Math.min(8, Math.round(crossLength / 2.6)));
    for (let index = 0; index < laneCount; index += 1) {
      const cross = (index + 0.5) / laneCount;
      const reverse = index % 2 === 1;
      const start = alongWidth
        ? bilinearPoint(field.corners, reverse ? 0.92 : 0.08, cross)
        : bilinearPoint(field.corners, cross, reverse ? 0.92 : 0.08);
      const end = alongWidth
        ? bilinearPoint(field.corners, reverse ? 0.08 : 0.92, cross)
        : bilinearPoint(field.corners, cross, reverse ? 0.08 : 0.92);
      targets.push({
        id: `${field.id}:lane:${index}`,
        kind: 'field',
        x: end.x,
        z: end.z,
        fieldId: field.id,
        fieldStage: field.stage,
        fieldPriority: field.priority,
        fieldTaskRank: fieldTaskRank(field.priority, field.stage === 'harvesting'),
        fieldLinked: linked,
        fieldLane: { start, end, index },
      });
    }
  }
}

function pickFarmFieldTarget(
  targets: readonly WorkerTarget[],
  slotIndex: number,
  preferOxFieldWork: boolean,
): WorkerTarget | undefined {
  const oxPloughing = preferOxFieldWork
    ? targets.filter((target) => target.fieldStage === 'ploughing')
    : [];
  const ranked = oxPloughing.length > 0 ? oxPloughing : targets;
  const first = ranked[0];
  if (!first) return undefined;
  const fieldLanes = ranked.filter(
    (target) => (target.fieldId ?? target.id) === (first.fieldId ?? first.id),
  );
  return fieldLanes[Math.max(0, Math.floor(slotIndex)) % fieldLanes.length] ?? first;
}

function fieldStageUrgency(stage: FarmFieldState['stage'] | undefined): number {
  if (stage === 'harvesting') return 3;
  if (stage === 'sowing') return 2;
  if (stage === 'ploughing') return 1;
  return 0;
}

function collectMonasteryWorkstations(
  building: BuildingState,
  roadNetwork: RoadNetwork | null,
  vineyardParcels: Iterable<VineyardParcelState>,
  targets: WorkerTarget[],
): void {
  const linkedVineyards = Array.from(vineyardParcels)
    .filter((parcel) => parcel.monasteryId === building.id);
  for (const workstation of MONASTERY_WORKSTATIONS) {
    if (
      'requiredExtension' in workstation
      && !monasteryHasExtension(building.monasteryExtensions, workstation.requiredExtension)
    ) continue;
    if ('requiresVineyard' in workstation && workstation.requiresVineyard && linkedVineyards.length === 0) {
      continue;
    }
    targets.push({
      id: `${building.id}:monastery:${workstation.id}`,
      kind: 'workstation',
      activity: workstation.activity,
      clericDuty: workstation.clericDuty,
      interior: 'interior' in workstation && workstation.interior,
      ...monasteryWorldPoint(
        building,
        workstation.localX,
        workstation.localZ,
        roadNetwork,
      ),
    });
  }
  for (const parcel of linkedVineyards) {
    const center = polygonCenter(parcel.corners);
    targets.push({
      id: `${building.id}:monastery:vineyard:${parcel.id}:center`,
      kind: 'workstation',
      activity: 'gather',
      clericDuty: 'harvest',
      ...center,
    });
    for (let index = 0; index < parcel.corners.length; index += 1) {
      const corner = parcel.corners[index];
      const next = parcel.corners[(index + 1) % parcel.corners.length];
      targets.push({
        id: `${building.id}:monastery:vineyard:${parcel.id}:row-${index}`,
        kind: 'workstation',
        activity: 'gather',
        clericDuty: index % 2 === 0 ? 'pruning' : 'harvest',
        x: (corner.x + next.x + center.x) / 3,
        z: (corner.z + next.z + center.z) / 3,
      });
    }
  }
}

function collectChapelDuties(
  building: BuildingState,
  roadNetwork: RoadNetwork | null,
  residences: readonly ResidenceState[],
  targets: WorkerTarget[],
): void {
  const localDuties = [
    { id: 'nave-prayer', x: 0, z: 0, duty: 'interior_prayer', interior: true },
    { id: 'vestry-study', x: -1.8, z: -0.8, duty: 'interior_study', interior: true },
    { id: 'front-blessing', x: 0, z: 10.2, duty: 'sermon_rehearsal', interior: false },
    { id: 'churchyard-east', x: 6.7, z: 1.6, duty: 'churchyard_prayer', interior: false },
    { id: 'churchyard-west', x: -6.7, z: 1.6, duty: 'churchyard_prayer', interior: false },
  ] as const;
  for (const duty of localDuties) {
    targets.push({
      id: `${building.id}:chapel:${duty.id}`,
      kind: 'workstation',
      activity: 'tend',
      clericDuty: duty.duty,
      interior: duty.interior,
      ...monasteryWorldPoint(building, duty.x, duty.z, roadNetwork),
    });
  }

  const nearbyHomes = [...residences]
    .filter((residence) => !residence.abandoned && residence.population > 0)
    .sort((a, b) =>
      distanceSq(building, a) - distanceSq(building, b)
        || a.id.localeCompare(b.id)
    )
    .slice(0, 6);
  for (const residence of nearbyHomes) {
    targets.push({
      id: `${building.id}:chapel:parish-visit:${residence.id}`,
      kind: 'workstation',
      activity: 'tend',
      clericDuty: 'parish_visit',
      allowOutsideWorkExtent: true,
      ...residenceDoorPosition(residence),
    });
  }
}

function monasteryWorldPoint(
  building: BuildingState,
  localX: number,
  localZ: number,
  roadNetwork: RoadNetwork | null,
): PointXZ {
  const yaw = resolvedPlacedBuildingYaw(building, roadNetwork);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    x: building.x + localX * cos + localZ * sin,
    z: building.z - localX * sin + localZ * cos,
  };
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
  isWaterAt: WorkerWaterTest | null,
): PointXZ[] | null {
  if (target.workStand) {
    const stand = target.workStand;
    const midpoint = { x: (start.x + stand.x)/2, z: (start.z + stand.z)/2 };
    return [start, midpoint, stand, midpoint, start];
  }
  if (target.kind === 'field' && target.fieldLane) {
    const laneStart = target.fieldLane.start;
    const laneEnd = target.fieldLane.end;
    const midpoint = {
      x: (start.x + laneStart.x) * 0.5,
      z: (start.z + laneStart.z) * 0.5,
    };
    return [
      start,
      midpoint,
      laneStart,
      laneEnd,
      laneStart,
      midpoint,
      start,
    ];
  }
  if (target.kind === 'fish') {
    // A fish node is intentionally stored in open water. Without the rendered
    // wetness sampler there is no safe presentation target, so keep the crew
    // in its local yard instead of falling back to the shoal coordinate.
    if (!isWaterAt) return null;
    const shore = findFishingShoreWorkPosition(start, target, isWaterAt);
    if (!shore) return null;
    const midpoint = {
      x: (start.x + shore.x) * 0.5,
      z: (start.z + shore.z) * 0.5,
    };
    // The shoal remains the action focus, but the complete out-and-back walk
    // stays on the verified dry ray to its bank. Random orbit points around a
    // fish node would put the visible fisher back into open water.
    return [start, midpoint, shore, midpoint, start];
  }

  const dx = target.x - start.x;
  const dz = target.z - start.z;
  const length = Math.max(0.001, Math.hypot(dx, dz));
  const normalX = -dz / length;
  const normalZ = dx / length;
  const bend = (rng() - 0.5) * Math.min(10, length * 0.24);
  const midpoint = clampResourceWorkPoint(building, target, {
    x: (start.x + target.x) * 0.5 + normalX * bend,
    z: (start.z + target.z) * 0.5 + normalZ * bend,
  });
  const approachAngle = rng() * Math.PI * 2;
  const approachRadius = target.kind === 'game'
    ? 12
    : target.kind === 'tree'
      ? 1.8
      : target.kind === 'workstation'
        ? 1.15
        : 2.4;
  const approach = clampResourceWorkPoint(building, target, {
    x: target.x + Math.sin(approachAngle) * approachRadius,
    z: target.z + Math.cos(approachAngle) * approachRadius,
  });
  const workStep = target.kind === 'game' ? 10 + rng() * 4 : 1.6 + rng() * 1.4;
  const around = clampResourceWorkPoint(building, target, {
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

/**
 * Finds the dry activity stop immediately before a wet shoal on the straight
 * approach from a fishing camp. The water coordinate is deliberately retained
 * separately so the casting pose still faces the fish rather than the bank.
 */
export function findFishingShoreWorkPosition(
  dryOrigin: PointXZ,
  shoal: PointXZ,
  isWaterAt: WorkerWaterTest,
  shoreStandoff = FISHING_SHORE_STANDOFF,
): PointXZ | null {
  if (isWaterAt(dryOrigin.x, dryOrigin.z) || !isWaterAt(shoal.x, shoal.z)) {
    return null;
  }

  const dx = shoal.x - dryOrigin.x;
  const dz = shoal.z - dryOrigin.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= 1e-6) return null;

  const sampleCount = Math.max(1, Math.ceil(distance / FISHING_SHORE_TRACE_STEP));
  let dryT = 0;
  for (let index = 1; index <= sampleCount; index += 1) {
    const t = index / sampleCount;
    const x = dryOrigin.x + dx * t;
    const z = dryOrigin.z + dz * t;
    if (!isWaterAt(x, z)) {
      dryT = t;
      continue;
    }

    let wetT = t;
    for (let refinement = 0; refinement < FISHING_SHORE_REFINEMENT_STEPS; refinement += 1) {
      const midpointT = (dryT + wetT) * 0.5;
      if (isWaterAt(
        dryOrigin.x + dx * midpointT,
        dryOrigin.z + dz * midpointT,
      )) {
        wetT = midpointT;
      } else {
        dryT = midpointT;
      }
    }

    const standT = Math.max(0, dryT - Math.max(0, shoreStandoff) / distance);
    const stand = {
      x: dryOrigin.x + dx * standT,
      z: dryOrigin.z + dz * standT,
    };
    return isWaterAt(stand.x, stand.z) ? null : stand;
  }
  return null;
}

function fishingYardWetProbe(
  yard: PointXZ,
  isWaterAt: WorkerWaterTest,
): PointXZ | null {
  if (isWaterAt(yard.x, yard.z)) return yard;
  for (let index = 0; index < FISHING_YARD_WATER_PROBES; index += 1) {
    const angle = index / FISHING_YARD_WATER_PROBES * Math.PI * 2;
    const probe = {
      x: yard.x + Math.cos(angle) * FISHING_YARD_WATER_CLEARANCE,
      z: yard.z + Math.sin(angle) * FISHING_YARD_WATER_CLEARANCE,
    };
    if (isWaterAt(probe.x, probe.z)) return probe;
  }
  return null;
}

function clampResourceWorkPoint(
  building: BuildingState,
  target: WorkerTarget,
  point: PointXZ,
): PointXZ {
  if (
    target.kind === 'field'
    || target.kind === 'pasture'
    || (target.kind === 'tree' && hasCustomTreeWorkArea(building))
    || target.allowOutsideWorkExtent
  ) return point;
  return clampToWorkExtent(building, point);
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
