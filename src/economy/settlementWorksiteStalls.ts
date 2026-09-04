import { BUILDING_STORAGE_CAPS } from '../generated/gameBalance.ts';
import {
  harvestableWildStock,
} from '../foraging/harvestReservePolicy.ts';
import { isForagingHarvestAvailable } from '../foraging/foragingSeason.ts';
import { fireDisabledBuildingIds } from '../fires/fireIncident.ts';
import type {
  DeliveryCargoKind,
  DeliveryTripState,
} from '../logistics/deliveryTrips.ts';
import { lodgeLaborSplit } from '../logistics/lodgeLogistics.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import type {
  BuildingKind,
  BuildingState,
  ForagingNodeState,
  GameState,
  ResourceNodeState,
} from '../resources/types.ts';
import {
  extractionOutputHeadroom,
  isProcessorOutputTargetKind,
  processorInputCommodities,
  processorOutputCommodity,
  processorOutputCommodityForBuilding,
  processorOutputHeadroom,
  type ProcessorOutputTargetKind,
} from './processorOutputPolicy.ts';
import {
  BREWERY_RECIPE_AUTO,
  BREWERY_RECIPE_CIDER_APPLES,
  BREWERY_RECIPE_MEAD,
  BREWERY_RECIPE_CIDER_PEARS,
  normalizeBreweryRecipePolicy,
} from './breweryRecipePolicy.ts';
import {
  normalizeSmokehouseRecipePolicy,
  SMOKEHOUSE_RECIPE_AUTO,
  SMOKEHOUSE_RECIPE_CHEESE,
  SMOKEHOUSE_RECIPE_CURED_MEAT,
  SMOKEHOUSE_RECIPE_SMOKED_FISH,
} from './smokehouseRecipePolicy.ts';
import {
  normalizeWeaverInputPolicy,
  WEAVER_INPUT_POLICY_AUTO,
  WEAVER_INPUT_POLICY_FLAX_FIRST,
  WEAVER_INPUT_POLICY_WOOL_FIRST,
} from './weaverInputPolicy.ts';
import { largeQuarrySupportsReady } from './largeQuarrySupportPolicy.ts';
import { richMineSupportsReady } from './mineSupportPolicy.ts';
import { freshFoodStock } from './foodInventory.ts';
import { breadStock, flourStock } from './cropGoods.ts';
import {
  normalizeStaffingPriority,
  type StaffingPriority,
} from './staffingPriority.ts';

export type WorksiteStallKind =
  | ProcessorOutputTargetKind
  | 'mine'
  | 'stone_quarry'
  | 'large_quarry'
  | 'hunters_hall'
  | 'fishing_camp';

export type ProductionLaborKind = Exclude<WorksiteStallKind, 'fishing_camp'>;

export type WorksiteStallReason =
  | 'input_empty'
  | 'output_blocked'
  | 'source_unavailable'
  | 'reserve_protected'
  | 'fire_disabled';

export type WorksiteStallSite = {
  buildingId: string;
  kind: WorksiteStallKind;
  reason: WorksiteStallReason;
  detail: string;
  assignedLabor: number;
  assignedWorkers: number;
  targetLabor: number;
  reclaimableWorkers: number;
  priority: StaffingPriority;
  hasDispatchDuty: boolean;
};

export type SettlementWorksiteStallPlan = {
  auditedSites: number;
  stalledSites: number;
  stalledWorkers: number;
  inputStalledSites: number;
  outputStalledSites: number;
  sourceStalledSites: number;
  reserveStalledSites: number;
  fireDisabledSites: number;
  dispatchDutySites: number;
  reclaimableSites: number;
  reclaimableWorkers: number;
  retainedDispatchers: number;
  supplyEnRouteSites: number;
  supplyEnRouteWorkers: number;
  firstReclaimableBuildingId: string | null;
  firstAttention: WorksiteStallSite | null;
  sites: WorksiteStallSite[];
};

export type SettlementProductionReadiness = {
  auditedSites: number;
  readySites: number;
  blockedSites: number;
  fireDisabledSites: number;
  readyBuildingIds: ReadonlySet<string>;
};

type ProductionReadinessState =
  Pick<GameState, 'buildings' | 'quarries' | 'foragingNodes'>
  & Partial<Pick<GameState, 'fireIncidents'>>;

type OperationalProductionReadinessState =
  Pick<GameState, 'buildings' | 'deliveryTrips' | 'quarries' | 'foragingNodes'>
  & Partial<Pick<GameState, 'fireIncidents'>>;

type Positioned = { x: number; z: number };

const SPATIAL_BUCKET_SIZE = 96;
const RICH_DEPOSIT_CENTER_TOLERANCE = 2.5;

function spatialKey(cellX: number, cellZ: number): string {
  return `${cellX}:${cellZ}`;
}

function buildSpatialBuckets<T extends Positioned>(
  values: Iterable<T>,
): Map<string, T[]> {
  const buckets = new Map<string, T[]>();
  for (const value of values) {
    const cellX = Math.floor(value.x / SPATIAL_BUCKET_SIZE);
    const cellZ = Math.floor(value.z / SPATIAL_BUCKET_SIZE);
    const key = spatialKey(cellX, cellZ);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(value);
    } else {
      buckets.set(key, [value]);
    }
  }
  return buckets;
}

function sourceStateWithinRadius<T extends Positioned>(
  buckets: ReadonlyMap<string, readonly T[]>,
  x: number,
  z: number,
  radius: number,
  isRelevant: (candidate: T) => boolean,
  isUsable: (candidate: T) => boolean,
): { relevant: boolean; usable: boolean } {
  const safeRadius = Math.max(0, radius);
  const radiusSq = safeRadius * safeRadius;
  const minCellX = Math.floor((x - safeRadius) / SPATIAL_BUCKET_SIZE);
  const maxCellX = Math.floor((x + safeRadius) / SPATIAL_BUCKET_SIZE);
  const minCellZ = Math.floor((z - safeRadius) / SPATIAL_BUCKET_SIZE);
  const maxCellZ = Math.floor((z + safeRadius) / SPATIAL_BUCKET_SIZE);
  let relevant = false;

  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
      const bucket = buckets.get(spatialKey(cellX, cellZ));
      if (!bucket) continue;
      for (const candidate of bucket) {
        if (!isRelevant(candidate)) continue;
        const distanceSq = (candidate.x - x) ** 2 + (candidate.z - z) ** 2;
        if (distanceSq > radiusSq) continue;
        relevant = true;
        if (isUsable(candidate)) {
          return { relevant: true, usable: true };
        }
      }
    }
  }
  return { relevant, usable: false };
}

function inputAmount(
  building: BuildingState,
  commodity: DeliveryCargoKind,
): number {
  const inventory = building as unknown as Partial<Record<DeliveryCargoKind, number>>;
  return Math.max(0, Number(inventory[commodity] ?? 0));
}

function inputLabel(commodity: DeliveryCargoKind): string {
  return commodity.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

function outputLabel(
  building: BuildingState & { kind: ProcessorOutputTargetKind },
): string {
  const output = processorOutputCommodityForBuilding(building)
    ?? processorOutputCommodity(building.kind);
  return output;
}

function hasHigherAttention(
  candidate: WorksiteStallSite,
  current: WorksiteStallSite | null,
): boolean {
  if (current === null) return true;
  if (candidate.priority !== current.priority) {
    return candidate.priority > current.priority;
  }
  if (candidate.reason !== current.reason) {
    if (candidate.reason === 'fire_disabled') return true;
    if (current.reason === 'fire_disabled') return false;
  }
  return compareStableEntityIds(candidate.buildingId, current.buildingId) < 0;
}

function worksiteKind(
  building: BuildingState,
  month: number,
): WorksiteStallKind | null {
  if (isProcessorOutputTargetKind(building.kind)) return building.kind;
  if (building.kind === 'mine') return building.kind;
  if (building.kind === 'stone_quarry' || building.kind === 'large_quarry') {
    return building.kind;
  }
  if (building.kind === 'hunters_hall') return building.kind;
  if (
    building.kind === 'fishing_camp'
    && isForagingHarvestAvailable('fish', month)
  ) {
    return building.kind;
  }
  return null;
}

export function isProductionLaborKind(
  kind: BuildingKind,
): kind is ProductionLaborKind {
  return isProcessorOutputTargetKind(kind)
    || kind === 'mine'
    || kind === 'stone_quarry'
    || kind === 'large_quarry'
    || kind === 'hunters_hall';
}

function outputStock(building: BuildingState): number {
  if (isProcessorOutputTargetKind(building.kind)) {
    const output = processorOutputCommodityForBuilding(building)
      ?? processorOutputCommodity(building.kind);
    if (output === 'flour') return flourStock(building);
    if (output === 'bread') return breadStock(building);
    return Math.max(0, building[output] ?? 0);
  }
  if (building.kind === 'hunters_hall' || building.kind === 'fishing_camp') {
    return building.kind === 'hunters_hall'
      ? Math.max(0, building.meat ?? 0)
      : Math.max(0, building.fish ?? 0);
  }
  return 0;
}

type ProcessorInputRequirement = readonly DeliveryCargoKind[];
type ProcessorInputRecipe = readonly ProcessorInputRequirement[];

function processorInputRecipes(
  building: BuildingState & { kind: ProcessorOutputTargetKind },
): readonly ProcessorInputRecipe[] {
  switch (building.kind) {
    case 'watermill':
    case 'windmill':
      return [[['ryeGrain', 'maslinGrain']]];
    case 'bakery':
      return [[
        ['ryeFlour', 'maslinFlour'],
        ['water'],
        ['firewood'],
      ]];
    case 'brewery': {
      const ale: ProcessorInputRecipe = [
        ['barley', 'malt'],
        ['water'],
        ['firewood'],
      ];
      const appleRecipe: ProcessorInputRecipe = [['apples']];
      const pearRecipe: ProcessorInputRecipe = [['pears']];
      const mead: ProcessorInputRecipe = [['honey']];
      switch (normalizeBreweryRecipePolicy(building.breweryRecipePolicy)) {
        case BREWERY_RECIPE_CIDER_APPLES:
          return [appleRecipe];
        case BREWERY_RECIPE_CIDER_PEARS:
          return [pearRecipe];
        case BREWERY_RECIPE_MEAD:
          return [mead];
        case BREWERY_RECIPE_AUTO:
          return [ale, appleRecipe, pearRecipe, mead];
        default:
          return [ale];
      }
    }
    case 'smokehouse': {
      const shared: ProcessorInputRecipe = [['firewood'], ['salt']];
      const meat: ProcessorInputRecipe = [['meat'], ...shared];
      const fish: ProcessorInputRecipe = [['fish'], ...shared];
      const cheese: ProcessorInputRecipe = [['milk'], ...shared];
      switch (normalizeSmokehouseRecipePolicy(building.smokehouseRecipePolicy)) {
        case SMOKEHOUSE_RECIPE_CURED_MEAT:
          return [meat];
        case SMOKEHOUSE_RECIPE_SMOKED_FISH:
          return [fish];
        case SMOKEHOUSE_RECIPE_CHEESE:
          return [cheese];
        case SMOKEHOUSE_RECIPE_AUTO:
        default:
          return [meat, fish, cheese];
      }
    }
    case 'spinning_retting_house': {
      const wool: ProcessorInputRecipe = [['wool']];
      const flax: ProcessorInputRecipe = [['flax'], ['water']];
      switch (normalizeWeaverInputPolicy(building.weaverInputPolicy)) {
        case WEAVER_INPUT_POLICY_WOOL_FIRST:
          return [wool];
        case WEAVER_INPUT_POLICY_FLAX_FIRST:
          return [flax];
        case WEAVER_INPUT_POLICY_AUTO:
        default:
          return [wool, flax];
      }
    }
    case 'weaver': {
      const yarn: ProcessorInputRecipe = [['yarn']];
      const linen: ProcessorInputRecipe = [['linen']];
      switch (normalizeWeaverInputPolicy(building.weaverInputPolicy)) {
        case WEAVER_INPUT_POLICY_WOOL_FIRST:
          return [yarn];
        case WEAVER_INPUT_POLICY_FLAX_FIRST:
          return [linen];
        case WEAVER_INPUT_POLICY_AUTO:
        default:
          return [yarn, linen];
      }
    }
    default:
      return [[...processorInputCommodities(building.kind)
        .filter((commodity) => commodity !== 'food')
        .map(
        (commodity): ProcessorInputRequirement => [commodity],
      )]];
  }
}

function requirementAvailable(
  requirement: ProcessorInputRequirement,
  building: BuildingState,
  inboundCargo?: ReadonlySet<DeliveryCargoKind>,
): boolean {
  return requirement.some((commodity) =>
    inputAmount(building, commodity) > 1e-6
      || inboundCargo?.has(commodity) === true
  );
}

function recipeAvailable(
  recipe: ProcessorInputRecipe,
  building: BuildingState,
  inboundCargo?: ReadonlySet<DeliveryCargoKind>,
): boolean {
  return recipe.every((requirement) =>
    requirementAvailable(requirement, building, inboundCargo)
  );
}

function missingRecipeRequirements(
  recipe: ProcessorInputRecipe,
  building: BuildingState,
): ProcessorInputRequirement[] {
  return recipe.filter((requirement) =>
    !requirementAvailable(requirement, building)
  );
}

function requirementLabel(requirement: ProcessorInputRequirement): string {
  if (
    requirement.length === 3
    && requirement.includes('meat')
    && requirement.includes('fish')
    && requirement.includes('milk')
  ) {
    return 'fresh meat, fish, or milk';
  }
  return requirement.map(inputLabel).join(' or ');
}

function joinRequirements(requirements: readonly ProcessorInputRequirement[]): string {
  const labels = requirements.map(requirementLabel);
  if (labels.length === 1) return `no ${labels[0]} on site`;
  if (labels.length === 2) return `missing ${labels[0]} and ${labels[1]} on site`;
  return `missing ${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)} on site`;
}

function buildInboundCargoByBuilding(
  trips: Iterable<DeliveryTripState>,
): Map<string, Set<DeliveryCargoKind>> {
  const inboundCargoByBuilding = new Map<string, Set<DeliveryCargoKind>>();
  for (const trip of trips) {
    if (
      trip.destinationKind !== 'building'
      || trip.targetBuildingId === null
      || trip.phase === 'inbound'
    ) {
      continue;
    }
    const cargo = inboundCargoByBuilding.get(trip.targetBuildingId);
    if (cargo) {
      cargo.add(trip.cargoKind);
    } else {
      inboundCargoByBuilding.set(
        trip.targetBuildingId,
        new Set([trip.cargoKind]),
      );
    }
  }
  return inboundCargoByBuilding;
}

function processorStall(
  building: BuildingState & { kind: ProcessorOutputTargetKind },
  inboundCargo: ReadonlySet<DeliveryCargoKind> | undefined,
  hasActiveOriginTrip: boolean,
): WorksiteStallSite | 'supply_en_route' | null {
  const assignedLabor = Math.max(0, Math.floor(building.assignedLabor));
  const hasDispatchDuty = hasActiveOriginTrip || outputStock(building) > 1e-6;
  const targetLabor = 0;
  const base = {
    buildingId: building.id,
    kind: building.kind,
    assignedLabor,
    assignedWorkers: assignedLabor,
    targetLabor,
    reclaimableWorkers: Math.max(0, assignedLabor - targetLabor),
    priority: normalizeStaffingPriority(building.constructionPriority),
    hasDispatchDuty,
  };
  if ((processorOutputHeadroom(building) ?? Number.POSITIVE_INFINITY) <= 1e-6) {
    return {
      ...base,
      reason: 'output_blocked',
      detail: `${outputLabel(building)} output target reached`,
    };
  }

  const recipes = processorInputRecipes(building);
  if (recipes.some((recipe) => recipeAvailable(recipe, building))) return null;
  if (recipes.some((recipe) => recipeAvailable(recipe, building, inboundCargo))) {
    return 'supply_en_route';
  }
  if (
    building.kind === 'brewery'
    && normalizeBreweryRecipePolicy(building.breweryRecipePolicy) === BREWERY_RECIPE_AUTO
  ) {
    return {
      ...base,
      reason: 'input_empty',
      detail: 'no complete beverage recipe on site (ale needs barley or malt, water, and firewood; cider needs apples or pears; mead needs honey)',
    };
  }
  const missingRequirements = recipes
    .map((recipe) => missingRecipeRequirements(recipe, building))
    .reduce((best, missing) => missing.length < best.length ? missing : best);
  return {
    ...base,
    reason: 'input_empty',
    detail: joinRequirements(missingRequirements),
  };
}

function mineralDepositState(
  building: BuildingState,
  quarryBuckets: ReadonlyMap<string, readonly ResourceNodeState[]>,
): { resource: 'iron' | 'salt' | 'clay' } | null {
  for (const resource of ['iron', 'salt', 'clay'] as const) {
    const richSource = sourceStateWithinRadius(
      quarryBuckets,
      building.x,
      building.z,
      RICH_DEPOSIT_CENTER_TOLERANCE,
      (deposit) => deposit.resource === resource && deposit.isRich === true,
      () => true,
    );
    if (richSource.relevant) {
      return { resource };
    }
  }
  return null;
}

function mineStall(
  building: BuildingState,
  quarryBuckets: ReadonlyMap<string, readonly ResourceNodeState[]>,
  hasActiveOriginTrip: boolean,
  inboundCargo?: ReadonlySet<DeliveryCargoKind>,
): WorksiteStallSite | 'supply_en_route' | null {
  const source = mineralDepositState(building, quarryBuckets);
  const assignedLabor = Math.max(0, Math.floor(building.assignedLabor));
  const outputStock = source === null
    ? Math.max(0, building.iron ?? 0)
      + Math.max(0, building.salt ?? 0)
      + Math.max(0, building.clay ?? 0)
    : Math.max(0, building[source.resource] ?? 0);
  const hasDispatchDuty = hasActiveOriginTrip || outputStock > 1e-6;
  const targetLabor = 0;
  const base = {
    buildingId: building.id,
    kind: 'mine' as const,
    assignedLabor,
    assignedWorkers: assignedLabor,
    targetLabor,
    reclaimableWorkers: Math.max(0, assignedLabor - targetLabor),
    priority: normalizeStaffingPriority(building.constructionPriority),
    hasDispatchDuty,
  };
  if (source === null) {
    return {
      ...base,
      reason: 'source_unavailable',
      detail: 'no rich iron, salt, or clay deposit lies beneath the Mineworks',
    };
  }
  if (
    (extractionOutputHeadroom(building, source.resource)
      ?? Number.POSITIVE_INFINITY) <= 1e-6
  ) {
    return {
      ...base,
      reason: 'output_blocked',
      detail: `local ${source.resource} yard is full`,
    };
  }
  if (!richMineSupportsReady(building.timber)) {
    if (inboundCargo?.has('timber') === true) return 'supply_en_route';
    return {
      ...base,
      reason: 'input_empty',
      detail: 'no deep-shaft support timber on site',
    };
  }
  return null;
}

function quarryStall(
  building: BuildingState,
  quarryBuckets: ReadonlyMap<string, readonly ResourceNodeState[]>,
  hasActiveOriginTrip: boolean,
  inboundCargo?: ReadonlySet<DeliveryCargoKind>,
): WorksiteStallSite | 'supply_en_route' | null {
  const kind = building.kind as Extract<BuildingKind, 'stone_quarry' | 'large_quarry'>;
  const assignedLabor = Math.max(0, Math.floor(building.assignedLabor));
  const source = geologicalSourceForQuarry(building, quarryBuckets);
  const outputStock = source === null
    ? Math.max(0, building.stone)
      + Math.max(0, building.iron ?? 0)
      + Math.max(0, building.salt ?? 0)
      + Math.max(0, building.clay ?? 0)
    : Math.max(0, building[source.resource] ?? 0);
  const targetLabor = 0;
  const base = {
    buildingId: building.id,
    kind,
    assignedLabor,
    assignedWorkers: assignedLabor,
    targetLabor,
    reclaimableWorkers: Math.max(0, assignedLabor - targetLabor),
    priority: normalizeStaffingPriority(building.constructionPriority),
    hasDispatchDuty: hasActiveOriginTrip || outputStock > 1e-6,
  };
  if (source !== null && (
    extractionOutputHeadroom(building, source.resource)
      ?? Number.POSITIVE_INFINITY) <= 1e-6
  ) {
    return {
      ...base,
      reason: 'output_blocked',
      detail: `local ${source.resource} yard is full`,
    };
  }

  if (kind === 'large_quarry') {
    if (source === null) {
      return {
        ...base,
        reason: 'source_unavailable',
        detail: 'no rich stone deposit lies beneath the quarry',
      };
    }
    if (!largeQuarrySupportsReady(building.timber)) {
      if (inboundCargo?.has('timber') === true) return 'supply_en_route';
      return {
        ...base,
        reason: 'input_empty',
        detail: 'no prepared chamber-support timber on site',
      };
    }
    return null;
  }

  return source !== null
    ? null
    : {
        ...base,
        reason: 'source_unavailable',
        detail: 'no unexhausted surface deposit lies within the work area',
      };
}

function geologicalSourceForQuarry(
  building: BuildingState,
  quarryBuckets: ReadonlyMap<string, readonly ResourceNodeState[]>,
): { resource: 'stone' | 'iron' | 'salt' | 'clay' } | null {
  const radius = building.kind === 'large_quarry'
    ? RICH_DEPOSIT_CENTER_TOLERANCE
    : building.workRadius;
  let nearest: ResourceNodeState | null = null;
  let nearestDistance = radius;
  for (const deposits of quarryBuckets.values()) {
    for (const deposit of deposits) {
      if (building.kind === 'large_quarry') {
        if (deposit.isRich !== true || deposit.resource !== 'stone') continue;
      } else if (deposit.remaining <= 1e-6) {
        continue;
      }
      const distance = Math.hypot(deposit.x - building.x, deposit.z - building.z);
      if (distance > nearestDistance) continue;
      nearest = deposit;
      nearestDistance = distance;
    }
  }
  if (
    nearest?.resource === 'stone'
    || nearest?.resource === 'iron'
    || nearest?.resource === 'salt'
    || nearest?.resource === 'clay'
  ) {
    return { resource: nearest.resource };
  }
  return null;
}

function wildStockStall(
  building: BuildingState,
  nodeBuckets: ReadonlyMap<string, readonly ForagingNodeState[]>,
  hasActiveOriginTrip: boolean,
): WorksiteStallSite | null {
  const kind = building.kind as Extract<BuildingKind, 'hunters_hall' | 'fishing_camp'>;
  const nodeKind = kind === 'hunters_hall' ? 'game' : 'fish';
  const assignedLabor = Math.max(0, Math.floor(building.assignedLabor));
  const hasDispatchDuty = hasActiveOriginTrip || outputStock(building) > 1e-6;
  const targetLabor = 0;
  const base = {
    buildingId: building.id,
    kind,
    assignedLabor,
    assignedWorkers: lodgeLaborSplit(building.assignedLabor).processing,
    targetLabor,
    reclaimableWorkers: Math.max(0, assignedLabor - targetLabor),
    priority: normalizeStaffingPriority(building.constructionPriority),
    hasDispatchDuty,
  };
  const foodCapacity = BUILDING_STORAGE_CAPS[kind].food ?? 0;
  if (foodCapacity > 0 && freshFoodStock(building) >= foodCapacity - 1e-6) {
    return {
      ...base,
      reason: 'output_blocked',
      detail: 'local food store is full',
    };
  }

  const source = sourceStateWithinRadius(
    nodeBuckets,
    building.x,
    building.z,
    building.workRadius,
    (node) => node.kind === nodeKind,
    (node) =>
      harvestableWildStock(
        node,
        building.harvestReservePercent ?? 0,
      ) > 1e-6,
  );
  if (source.usable) return null;
  if (source.relevant) {
    const population = sourceStateWithinRadius(
      nodeBuckets,
      building.x,
      building.z,
      building.workRadius,
      (node) => node.kind === nodeKind,
      (node) => node.remaining > 1e-6,
    );
    if (population.usable) {
      return {
        ...base,
        reason: 'reserve_protected',
        detail: `${nodeKind} in range is held at the protected breeding reserve`,
      };
    }
  }
  return {
    ...base,
    reason: 'source_unavailable',
    detail: source.relevant
      ? `${nodeKind} population in range is exhausted`
      : `no ${nodeKind} population lies within the work area`,
  };
}

/// Finds completed production sites that can accept an explicit Town Hall
/// deployment. Processor readiness means output capacity is open; their
/// physical input network remains a separate planning constraint. Extraction
/// sites additionally require local yard room and a usable source.
export function computeSettlementProductionReadiness(
  state: ProductionReadinessState,
): SettlementProductionReadiness {
  const quarryBuckets = buildSpatialBuckets(state.quarries.values());
  const nodeBuckets = buildSpatialBuckets(state.foragingNodes.values());
  const fireDisabled = fireDisabledBuildingIds(
    state.fireIncidents?.values() ?? [],
  );
  const readyBuildingIds = new Set<string>();
  let auditedSites = 0;
  let fireDisabledSites = 0;

  for (const building of state.buildings.values()) {
    if (
      building.constructionComplete === false
      || !isProductionLaborKind(building.kind)
    ) {
      continue;
    }
    auditedSites += 1;
    if (fireDisabled.has(building.id)) {
      fireDisabledSites += 1;
      continue;
    }

    let ready: boolean;
    if (isProcessorOutputTargetKind(building.kind)) {
      ready = (processorOutputHeadroom(building) ?? 0) > 1e-6;
    } else if (building.kind === 'mine') {
      ready = mineStall(building, quarryBuckets, false) === null;
    } else if (
      building.kind === 'stone_quarry'
      || building.kind === 'large_quarry'
    ) {
      ready = quarryStall(building, quarryBuckets, false) === null;
    } else {
      ready = wildStockStall(building, nodeBuckets, false) === null;
    }
    if (ready) readyBuildingIds.add(building.id);
  }

  return {
    auditedSites,
    readySites: readyBuildingIds.size,
    blockedSites: auditedSites - readyBuildingIds.size,
    fireDisabledSites,
    readyBuildingIds,
  };
}

/// Mirrors the stricter automatic production-steward gate. Unlike the manual
/// deployment forecast, a processor is ready only when every current input is
/// on site or already approaching on a matching physical cart.
export function computeSettlementOperationalProductionReadiness(
  state: OperationalProductionReadinessState,
): SettlementProductionReadiness {
  const quarryBuckets = buildSpatialBuckets(state.quarries.values());
  const nodeBuckets = buildSpatialBuckets(state.foragingNodes.values());
  const fireDisabled = fireDisabledBuildingIds(
    state.fireIncidents?.values() ?? [],
  );
  const inboundCargoByBuilding = buildInboundCargoByBuilding(
    state.deliveryTrips.values(),
  );
  const readyBuildingIds = new Set<string>();
  let auditedSites = 0;
  let fireDisabledSites = 0;

  for (const building of state.buildings.values()) {
    if (
      building.constructionComplete === false
      || !isProductionLaborKind(building.kind)
    ) {
      continue;
    }
    auditedSites += 1;
    if (fireDisabled.has(building.id)) {
      fireDisabledSites += 1;
      continue;
    }

    let ready: boolean;
    if (isProcessorOutputTargetKind(building.kind)) {
      const stall = processorStall(
        building as BuildingState & { kind: ProcessorOutputTargetKind },
        inboundCargoByBuilding.get(building.id),
        false,
      );
      ready = stall === null || stall === 'supply_en_route';
    } else if (building.kind === 'mine') {
      const stall = mineStall(
        building,
        quarryBuckets,
        false,
        inboundCargoByBuilding.get(building.id),
      );
      ready = stall === null || stall === 'supply_en_route';
    } else if (
      building.kind === 'stone_quarry'
      || building.kind === 'large_quarry'
    ) {
      const stall = quarryStall(
        building,
        quarryBuckets,
        false,
        inboundCargoByBuilding.get(building.id),
      );
      ready = stall === null || stall === 'supply_en_route';
    } else {
      ready = wildStockStall(building, nodeBuckets, false) === null;
    }
    if (ready) readyBuildingIds.add(building.id);
  }

  return {
    auditedSites,
    readySites: readyBuildingIds.size,
    blockedSites: auditedSites - readyBuildingIds.size,
    fireDisabledSites,
    readyBuildingIds,
  };
}

export function computeSettlementWorksiteStallPlan(
  state: OperationalProductionReadinessState,
  month: number,
): SettlementWorksiteStallPlan {
  const quarryBuckets = buildSpatialBuckets(state.quarries.values());
  const nodeBuckets = buildSpatialBuckets(state.foragingNodes.values());
  const fireDisabled = fireDisabledBuildingIds(
    state.fireIncidents?.values() ?? [],
  );
  const activeOriginTrips = new Set<string>();
  const inboundCargoByBuilding = buildInboundCargoByBuilding(
    state.deliveryTrips.values(),
  );
  for (const trip of state.deliveryTrips.values()) {
    activeOriginTrips.add(trip.buildingId);
  }

  const sites: WorksiteStallSite[] = [];
  let auditedSites = 0;
  let stalledWorkers = 0;
  let inputStalledSites = 0;
  let outputStalledSites = 0;
  let sourceStalledSites = 0;
  let reserveStalledSites = 0;
  let fireDisabledSites = 0;
  let dispatchDutySites = 0;
  let reclaimableSites = 0;
  let reclaimableWorkers = 0;
  let retainedDispatchers = 0;
  let supplyEnRouteSites = 0;
  let supplyEnRouteWorkers = 0;
  let firstReclaimable: WorksiteStallSite | null = null;
  let firstAttention: WorksiteStallSite | null = null;

  for (const building of state.buildings.values()) {
    if (
      building.constructionComplete === false
      || building.assignedLabor <= 0
      || worksiteKind(building, month) === null
    ) {
      continue;
    }
    auditedSites += 1;

    const activeOriginTrip = activeOriginTrips.has(building.id);
    let stall: WorksiteStallSite | 'supply_en_route' | null;
    if (fireDisabled.has(building.id)) {
      const kind = worksiteKind(building, month);
      if (kind === null) continue;
      const assignedLabor = Math.max(0, Math.floor(building.assignedLabor));
      stall = {
        buildingId: building.id,
        kind,
        reason: 'fire_disabled',
        detail: 'fire damage suspends all production and dispatch until repaired',
        assignedLabor,
        assignedWorkers: assignedLabor,
        targetLabor: 0,
        reclaimableWorkers: assignedLabor,
        priority: normalizeStaffingPriority(building.constructionPriority),
        hasDispatchDuty: false,
      };
    } else if (isProcessorOutputTargetKind(building.kind)) {
      stall = processorStall(
        building as BuildingState & { kind: ProcessorOutputTargetKind },
        inboundCargoByBuilding.get(building.id),
        activeOriginTrip,
      );
    } else if (building.kind === 'mine') {
      stall = mineStall(
        building,
        quarryBuckets,
        activeOriginTrip,
        inboundCargoByBuilding.get(building.id),
      );
    } else if (
      building.kind === 'stone_quarry'
      || building.kind === 'large_quarry'
    ) {
      stall = quarryStall(
        building,
        quarryBuckets,
        activeOriginTrip,
        inboundCargoByBuilding.get(building.id),
      );
    } else {
      stall = wildStockStall(building, nodeBuckets, activeOriginTrip);
    }

    if (stall === 'supply_en_route') {
      supplyEnRouteSites += 1;
      supplyEnRouteWorkers += Math.max(0, Math.floor(building.assignedLabor));
      continue;
    }
    if (stall === null) continue;

    sites.push(stall);
    stalledWorkers += stall.assignedWorkers;
    if (stall.hasDispatchDuty) dispatchDutySites += 1;
    if (stall.targetLabor > 0) retainedDispatchers += stall.targetLabor;
    if (stall.reclaimableWorkers > 0) {
      reclaimableSites += 1;
      reclaimableWorkers += stall.reclaimableWorkers;
      if (hasHigherAttention(stall, firstReclaimable)) {
        firstReclaimable = stall;
      }
    }
    if (stall.reason === 'input_empty') inputStalledSites += 1;
    if (stall.reason === 'output_blocked') outputStalledSites += 1;
    if (stall.reason === 'source_unavailable') sourceStalledSites += 1;
    if (stall.reason === 'reserve_protected') reserveStalledSites += 1;
    if (stall.reason === 'fire_disabled') fireDisabledSites += 1;
    if (hasHigherAttention(stall, firstAttention)) {
      firstAttention = stall;
    }
  }

  return {
    auditedSites,
    stalledSites: sites.length,
    stalledWorkers,
    inputStalledSites,
    outputStalledSites,
    sourceStalledSites,
    reserveStalledSites,
    fireDisabledSites,
    dispatchDutySites,
    reclaimableSites,
    reclaimableWorkers,
    retainedDispatchers,
    supplyEnRouteSites,
    supplyEnRouteWorkers,
    firstReclaimableBuildingId: firstReclaimable?.buildingId ?? null,
    firstAttention,
    sites,
  };
}

export function applyWorksiteStallRecall(
  buildings: ReadonlyMap<string, BuildingState>,
  plan: SettlementWorksiteStallPlan,
): Map<string, BuildingState> {
  const recalled = new Map(buildings);
  for (const site of plan.sites) {
    if (site.reclaimableWorkers <= 0) continue;
    const building = recalled.get(site.buildingId);
    if (!building) continue;
    recalled.set(site.buildingId, {
      ...building,
      assignedLabor: site.targetLabor,
    });
  }
  return recalled;
}
