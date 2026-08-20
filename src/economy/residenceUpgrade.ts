import {
  BACKYARD_GARDEN_KINDS,
  RESIDENCE_TIER2_CAPACITY,
  RESIDENCE_TIER2_GOLD_COST,
  RESIDENCE_TIER2_STONE_COST,
  RESIDENCE_TIER2_TIMBER_COST,
  RESIDENCE_TIER3_CAPACITY,
  RESIDENCE_TIER3_GOLD_COST,
  RESIDENCE_TIER3_STONE_COST,
  RESIDENCE_TIER3_TIMBER_COST,
  type BackyardGardenKind,
} from '../generated/gameBalance.ts';
import type { ResourceTotals } from '../resources/resourceTotals.ts';
import type { BuildingState, ResidenceState } from '../resources/types.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import {
  constructionPriorityLabel,
  normalizeConstructionPriority,
  type ConstructionPriority,
} from '../logistics/constructionPriority.ts';
import { residenceServiceState } from './residenceSatisfaction.ts';

export type ResidenceUpgradeServiceKind =
  | 'firewood'
  | 'water'
  | 'preservedFood'
  | 'ale'
  | 'cloth'
  | 'pottery'
  | 'church'
  | 'foodVariety';

export type ResidenceUpgradeServiceInput = {
  supplier: BuildingState | null;
  stocked: boolean;
  ready?: boolean;
};

export type ResidenceUpgradeServices = Record<
  ResidenceUpgradeServiceKind,
  ResidenceUpgradeServiceInput
>;

export type ResidenceUpgradeServiceCheck = ResidenceUpgradeServiceInput & {
  kind: ResidenceUpgradeServiceKind;
  label: string;
  ready: boolean;
};

export type ResidenceUpgradeResourceCheck = {
  kind: 'timber' | 'stone' | 'gold';
  label: string;
  available: number;
  required: number;
  shortfall: number;
  ready: boolean;
};

export type ResidenceUpgradePlan = {
  nextTier: 2 | 3;
  populationCapacity: number;
  addedCapacity: number;
  addedNeeds: string;
  occupied: boolean;
  services: ResidenceUpgradeServiceCheck[];
  resources: ResidenceUpgradeResourceCheck[];
  blockers: string[];
  ready: boolean;
  householdContribution: number;
  civicGoldRequired: number;
  physicalEconomy: boolean;
};

export type ResidenceUpgradeContext = {
  fireDisabled?: boolean;
  physicalEconomy?: boolean;
};

export type ResidenceUpgradeMaterial = 'timber' | 'stone' | 'gold';
export type ResidenceProjectMaterial = ResidenceUpgradeMaterial | 'roofTiles';

export type ResidenceMaterialProject = {
  progress: number;
  priority: ConstructionPriority;
  priorityLabel: string;
  assignedLabor: number;
  required: Record<ResidenceProjectMaterial, number>;
  delivered: Record<ResidenceProjectMaterial, number>;
  reserved: Record<ResidenceProjectMaterial, number>;
  incoming: Record<ResidenceProjectMaterial, number>;
  incomingTrips: DeliveryTripState[];
  materialReadiness: number;
  paid: boolean;
  blockers: string[];
};

export type ResidenceUpgradeProject = ResidenceMaterialProject & {
  targetTier: 1 | 2 | 3;
};

export type ResidenceBackyardProject = ResidenceMaterialProject & {
  kind: BackyardGardenKind;
};

export type ResidenceFireRepairProject = ResidenceMaterialProject;
export type ResidenceRoofTileProject = ResidenceMaterialProject;

type UpgradeDefinition = {
  nextTier: 2 | 3;
  populationCapacity: number;
  timber: number;
  stone: number;
  gold: number;
  serviceKinds: ResidenceUpgradeServiceKind[];
  addedNeeds: string;
};

function definitionForTier(tier: ResidenceState['tier']): UpgradeDefinition | null {
  if (tier === 1) {
    return {
      nextTier: 2,
      populationCapacity: RESIDENCE_TIER2_CAPACITY,
      timber: RESIDENCE_TIER2_TIMBER_COST,
      stone: RESIDENCE_TIER2_STONE_COST,
      gold: RESIDENCE_TIER2_GOLD_COST,
      serviceKinds: ['firewood', 'water', 'church', 'foodVariety', 'cloth'],
      addedNeeds: 'Adds a second food category and household textiles',
    };
  }
  if (tier === 2) {
    return {
      nextTier: 3,
      populationCapacity: RESIDENCE_TIER3_CAPACITY,
      timber: RESIDENCE_TIER3_TIMBER_COST,
      stone: RESIDENCE_TIER3_STONE_COST,
      gold: RESIDENCE_TIER3_GOLD_COST,
      serviceKinds: ['preservedFood', 'ale', 'cloth', 'pottery', 'church', 'foodVariety'],
      addedNeeds: 'Adds a third food category, beverages, preserved food, pottery, and a stone-church standard',
    };
  }
  return null;
}

const SERVICE_LABELS: Record<ResidenceUpgradeServiceKind, string> = {
  firewood: 'Firewood',
  water: 'Water',
  preservedFood: 'Preserved food',
  ale: 'Beverages',
  cloth: 'Cloth',
  pottery: 'Pottery',
  church: 'Church access',
  foodVariety: 'Food variety',
};

export function evaluateResidenceUpgrade(
  residence: ResidenceState,
  totals: Pick<ResourceTotals, 'timber' | 'stone' | 'gold'>,
  serviceInputs: ResidenceUpgradeServices,
  context: ResidenceUpgradeContext = {},
): ResidenceUpgradePlan | null {
  const definition = definitionForTier(residence.tier);
  if (!definition) return null;

  const services = definition.serviceKinds.map((kind): ResidenceUpgradeServiceCheck => {
    const input = serviceInputs[kind];
    return {
      kind,
      label: kind === 'church' && definition.nextTier === 3
        ? 'Stone church'
        : kind === 'foodVariety'
          ? `${definition.nextTier === 3 ? 3 : 2} food categories`
          : SERVICE_LABELS[kind],
      supplier: input.supplier,
      stocked: input.stocked,
      ready: input.ready ?? input.supplier != null,
    };
  });
  const physicalEconomy = context.physicalEconomy === true;
  const householdContribution = physicalEconomy
    ? Math.min(Math.max(0, residence.householdWealth), definition.gold)
    : 0;
  const civicGoldRequired = Math.max(0, definition.gold - householdContribution);
  const requiredResources = [
    ['timber', 'Timber', totals.timber, definition.timber],
    ['stone', 'Stone', totals.stone, definition.stone],
    ['gold', physicalEconomy ? 'Civic gold' : 'Gold', totals.gold, civicGoldRequired],
  ] as const;
  const resources = requiredResources.map(
    ([kind, label, available, required]): ResidenceUpgradeResourceCheck => ({
      kind,
      label,
      available: Math.max(0, available),
      required,
      shortfall: Math.max(0, required - available),
      ready: available + 1e-6 >= required,
    }),
  );
  const occupied = residence.population > 0;
  const serviceState = residenceServiceState(residence);
  const blockers = [
    ...(!occupied ? ['occupied household required'] : []),
    ...(serviceState.upgradeBlocked
      ? ['sustained household needs must recover before promotion']
      : []),
    ...(context.fireDisabled ? ['repair fire damage before upgrading'] : []),
    ...services.filter((service) => !service.ready).map(
      (service) => `${service.label.toLowerCase()} route missing`,
    ),
    ...resources.filter((resource) => !resource.ready).map(
      (resource) => `${formatAmount(resource.shortfall)} ${resource.label.toLowerCase()} short`,
    ),
  ];

  return {
    nextTier: definition.nextTier,
    populationCapacity: definition.populationCapacity,
    addedCapacity: Math.max(0, definition.populationCapacity - residence.populationCapacity),
    addedNeeds: definition.addedNeeds,
    occupied,
    services,
    resources,
    blockers,
    ready: blockers.length === 0,
    householdContribution,
    civicGoldRequired,
    physicalEconomy,
  };
}

export function residenceUpgradeProject(
  residence: ResidenceState,
  trips: Iterable<DeliveryTripState> = [],
): ResidenceUpgradeProject | null {
  const targetTier = residence.upgradeTargetTier ?? 0;
  if (
    targetTier <= residence.tier
    || (targetTier !== 1 && targetTier !== 2 && targetTier !== 3)
  ) return null;

  return {
    targetTier,
    ...residenceMaterialProject(residence, trips),
  };
}

export function residenceBackyardProject(
  residence: ResidenceState,
  trips: Iterable<DeliveryTripState> = [],
): ResidenceBackyardProject | null {
  const kind = BACKYARD_GARDEN_KINDS[(residence.backyardProjectKind ?? 0) - 1];
  if (!kind) return null;
  return {
    kind,
    ...residenceMaterialProject(residence, trips),
  };
}

export function residenceFireRepairProject(
  residence: ResidenceState,
  trips: Iterable<DeliveryTripState> = [],
): ResidenceFireRepairProject | null {
  if (residence.fireRepairActive !== true) return null;
  return residenceMaterialProject(residence, trips);
}

export function residenceRoofTileProject(
  residence: ResidenceState,
  trips: Iterable<DeliveryTripState> = [],
): ResidenceRoofTileProject | null {
  if (residence.roofTileRetrofitActive !== true) return null;
  return residenceMaterialProject(residence, trips);
}

function residenceMaterialProject(
  residence: ResidenceState,
  trips: Iterable<DeliveryTripState>,
): ResidenceMaterialProject {
  const required = {
    timber: nonnegative(residence.upgradeRequiredTimber),
    stone: nonnegative(residence.upgradeRequiredStone),
    gold: nonnegative(residence.upgradeRequiredGold),
    roofTiles: nonnegative(residence.upgradeRequiredRoofTiles),
  };
  const delivered = {
    timber: nonnegative(residence.upgradeDeliveredTimber),
    stone: nonnegative(residence.upgradeDeliveredStone),
    gold: nonnegative(residence.upgradeDeliveredGold),
    roofTiles: nonnegative(residence.upgradeDeliveredRoofTiles),
  };
  const reserved = {
    timber: nonnegative(residence.upgradeReservedTimber),
    stone: nonnegative(residence.upgradeReservedStone),
    gold: nonnegative(residence.upgradeReservedGold),
    roofTiles: nonnegative(residence.upgradeReservedRoofTiles),
  };
  const incoming = { timber: 0, stone: 0, gold: 0, roofTiles: 0 };
  const incomingTrips: DeliveryTripState[] = [];
  for (const trip of trips) {
    if (
      trip.destinationKind !== 'residence'
      || trip.residenceId !== residence.id
      || trip.phase === 'inbound'
      || (trip.cargoKind !== 'timber'
        && trip.cargoKind !== 'stone'
        && trip.cargoKind !== 'gold'
        && trip.cargoKind !== 'roofTiles')
    ) {
      continue;
    }
    incoming[trip.cargoKind] += Math.max(0, trip.amount);
    incomingTrips.push(trip);
  }
  const structuralRequired = required.timber + required.stone + required.roofTiles;
  const materialReadiness = structuralRequired <= 1e-6
    ? 1
    : Math.min(
        1,
        (delivered.timber + delivered.stone + delivered.roofTiles) / structuralRequired,
      );
  const priority = normalizeConstructionPriority(residence.upgradePriority);
  const assignedLabor = Math.max(0, Math.floor(residence.upgradeAssignedLabor ?? 0));
  const paid = delivered.gold + 1e-6 >= required.gold;
  const blockers = [
    ...(priority === 0 ? ['works held by player'] : []),
    ...(assignedLabor === 0 && priority !== 0 ? ['waiting for a free builder'] : []),
    ...(delivered.timber + incoming.timber + 1e-6 < required.timber
      ? ['timber still reserved at source']
      : []),
    ...(delivered.stone + incoming.stone + 1e-6 < required.stone
      ? ['stone still reserved at source']
      : []),
    ...(delivered.gold + incoming.gold + 1e-6 < required.gold
      ? ['civic lockbox payment still at source']
      : []),
    ...(delivered.roofTiles + incoming.roofTiles + 1e-6 < required.roofTiles
      ? ['fired roof tiles still reserved at source']
      : []),
  ];

  return {
    progress: Math.max(0, Math.min(1, residence.upgradeProgress ?? 0)),
    priority,
    priorityLabel: constructionPriorityLabel(priority),
    assignedLabor,
    required,
    delivered,
    reserved,
    incoming,
    incomingTrips,
    materialReadiness,
    paid,
    blockers,
  };
}

function nonnegative(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function formatAmount(value: number): string {
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 0.05 ? String(rounded) : value.toFixed(1);
}
