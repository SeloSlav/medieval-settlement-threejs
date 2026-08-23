import {
  BACKYARD_GARDEN_KINDS,
  HOUSEHOLD_PROJECT_WEALTH_RESERVE,
  RESIDENCE_TIER2_CAPACITY,
  RESIDENCE_TIER2_GOLD_COST,
  RESIDENCE_TIER2_STONE_COST,
  RESIDENCE_TIER2_TIMBER_COST,
  RESIDENCE_TIER3_CAPACITY,
  RESIDENCE_TIER3_GOLD_COST,
  RESIDENCE_TIER3_STONE_COST,
  RESIDENCE_TIER3_TIMBER_COST,
  RESIDENCE_TIER4_CAPACITY,
  RESIDENCE_TIER4_GOLD_COST,
  RESIDENCE_TIER4_STONE_COST,
  RESIDENCE_TIER4_TIMBER_COST,
  RESIDENCE_TILE_ROOF_TILE_COST,
  type BackyardGardenKind,
} from '../generated/gameBalance.ts';
import type { ResourceTotals } from '../resources/resourceTotals.ts';
import {
  residenceHasActiveProject,
  type BackyardGardenState,
  type BuildingState,
  type ResidenceState,
} from '../resources/types.ts';
import {
  activeResidenceNeedKinds,
  getNeedStock,
  requiredChapelTierForResidence,
  type ResidenceNeedKind,
} from '../residences/residenceNeedState.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import {
  constructionPriorityLabel,
  normalizeConstructionPriority,
  type ConstructionPriority,
} from '../logistics/constructionPriority.ts';
import { foodProgressionStatus, preservedFoodStock } from './foodInventory.ts';
import { residenceServiceState } from './residenceSatisfaction.ts';

export type ResidenceUpgradeServiceKind = ResidenceNeedKind;

export type ResidenceUpgradeServiceInput = {
  supplier: BuildingState | null;
  stocked: boolean;
};

export type ResidenceUpgradeServices = Record<
  ResidenceUpgradeServiceKind,
  ResidenceUpgradeServiceInput
>;

export type ResidenceUpgradeServiceCheck = ResidenceUpgradeServiceInput & {
  kind: ResidenceUpgradeServiceKind;
  label: string;
  householdReady: boolean;
  outletReady: boolean;
  ready: boolean;
};

export type ResidenceUpgradeResourceCheck = {
  kind: 'timber' | 'stone' | 'gold' | 'roofTiles';
  label: string;
  available: number;
  required: number;
  shortfall: number;
  ready: boolean;
};

export type ResidenceUpgradePlan = {
  currentTier: 1 | 2 | 3;
  nextTier: 2 | 3 | 4;
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

export type HouseholdProjectFunding = {
  goldCost: number;
  householdContribution: number;
  civicGoldRequired: number;
  treasuryShortfall: number;
  ready: boolean;
};

export function householdProjectFunding(
  householdWealth: number,
  goldCost: number,
  treasuryGold: number,
  physicalEconomy: boolean,
): HouseholdProjectFunding {
  const normalizedCost = Math.max(0, goldCost);
  const householdContribution = physicalEconomy
    ? Math.min(
      Math.max(0, householdWealth - HOUSEHOLD_PROJECT_WEALTH_RESERVE),
      normalizedCost,
    )
    : 0;
  const civicGoldRequired = Math.max(0, normalizedCost - householdContribution);
  const treasuryShortfall = Math.max(0, civicGoldRequired - Math.max(0, treasuryGold));
  return {
    goldCost: normalizedCost,
    householdContribution,
    civicGoldRequired,
    treasuryShortfall,
    ready: treasuryShortfall <= 1e-6,
  };
}

export type ResidenceUpgradeMaterial = 'timber' | 'stone' | 'gold' | 'roofTiles';
export type ResidenceProjectMaterial = ResidenceUpgradeMaterial;

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
  targetTier: 1 | 2 | 3 | 4;
};

export type ResidenceBackyardProject = ResidenceMaterialProject & {
  kind: BackyardGardenKind;
};

export type ResidenceFireRepairProject = ResidenceMaterialProject;
export type ResidenceRoofTileProject = ResidenceMaterialProject;

type UpgradeDefinition = {
  currentTier: 1 | 2 | 3;
  nextTier: 2 | 3 | 4;
  populationCapacity: number;
  timber: number;
  stone: number;
  gold: number;
  roofTiles: number;
  requiredChapelTier: 1 | 2 | 3;
  serviceKinds: ResidenceUpgradeServiceKind[];
  addedNeeds: string;
};

function definitionForTier(tier: ResidenceState['tier']): UpgradeDefinition | null {
  if (tier === 1) {
    return {
      currentTier: 1,
      nextTier: 2,
      populationCapacity: RESIDENCE_TIER2_CAPACITY,
      timber: RESIDENCE_TIER2_TIMBER_COST,
      stone: RESIDENCE_TIER2_STONE_COST,
      gold: RESIDENCE_TIER2_GOLD_COST,
      roofTiles: 0,
      requiredChapelTier: requiredChapelTierForResidence(tier),
      serviceKinds: activeResidenceNeedKinds(tier),
      addedNeeds: 'a grain staple plus another food group, beverages, and cloth; the level-1 church standard remains',
    };
  }
  if (tier === 2) {
    return {
      currentTier: 2,
      nextTier: 3,
      populationCapacity: RESIDENCE_TIER3_CAPACITY,
      timber: RESIDENCE_TIER3_TIMBER_COST,
      stone: RESIDENCE_TIER3_STONE_COST,
      gold: RESIDENCE_TIER3_GOLD_COST,
      roofTiles: 0,
      requiredChapelTier: requiredChapelTierForResidence(tier),
      serviceKinds: activeResidenceNeedKinds(tier),
      addedNeeds: 'shoes, an expanded grain/produce-or-forage/animal/fish food standard, and a level-2 church standard',
    };
  }
  if (tier === 3) {
    return {
      currentTier: 3,
      nextTier: 4,
      populationCapacity: RESIDENCE_TIER4_CAPACITY,
      timber: RESIDENCE_TIER4_TIMBER_COST,
      stone: RESIDENCE_TIER4_STONE_COST,
      gold: RESIDENCE_TIER4_GOLD_COST,
      roofTiles: RESIDENCE_TILE_ROOF_TILE_COST,
      requiredChapelTier: requiredChapelTierForResidence(tier),
      serviceKinds: activeResidenceNeedKinds(tier),
      addedNeeds: 'cured provisions, pottery, luxury goods, the complete food standard, and a level-3 church standard; the house gains its fired-tile roof',
    };
  }
  return null;
}

const SERVICE_LABELS: Record<ResidenceUpgradeServiceKind, string> = {
  food: 'Food supply',
  firewood: 'Firewood',
  water: 'Water',
  preservedFood: 'Cured provisions',
  ale: 'Beverages',
  cloth: 'Cloth',
  shoes: 'Shoes',
  pottery: 'Pottery',
  luxury: 'Luxury source',
  church: 'Church access',
  foodVariety: 'Food variety',
};

/** Options a Tier-3 household can prepare for the future Tier-4 luxury need. */
export function residenceHasHouseholdLuxuryOption(
  residence: Pick<ResidenceState, 'aroniaJam' | 'rosehipJam'>,
  garden: Pick<BackyardGardenState, 'kind' | 'flowerLuxuryUpgraded'> | null | undefined,
): boolean {
  return Math.max(0, residence.aroniaJam ?? 0) + Math.max(0, residence.rosehipJam ?? 0) > 1e-6
    || garden?.flowerLuxuryUpgraded === true
    || garden?.kind === 'aronia_orchard'
    || garden?.kind === 'rosehip_orchard';
}

function householdPromotionNeedReady(
  residence: ResidenceState,
  kind: ResidenceUpgradeServiceKind,
  currentTier: 1 | 2 | 3,
): boolean {
  const stock = getNeedStock(residence.needs, kind);
  switch (kind) {
    // These are continuing infrastructure services. A leftover bucket or the
    // replicated chapel-level row must not conceal a broken route.
    case 'water':
    case 'church':
      return false;
    case 'food':
      return foodProgressionStatus(residence, residence.population, 1).ready
        || stock > 1e-6;
    case 'foodVariety':
      return foodProgressionStatus(residence, residence.population, currentTier).ready;
    case 'preservedFood':
      return preservedFoodStock(residence) > 1e-6 || stock > 1e-6;
    case 'luxury':
      return Math.max(0, residence.aroniaJam ?? 0)
        + Math.max(0, residence.rosehipJam ?? 0) > 1e-6
        || stock > 1e-6;
    case 'firewood':
    case 'ale':
    case 'cloth':
    case 'shoes':
    case 'pottery':
      return stock > 1e-6;
  }
}

function promotionOutletReady(
  kind: ResidenceUpgradeServiceKind,
  input: ResidenceUpgradeServiceInput,
  requiredChapelTier: 1 | 2 | 3,
  residence: ResidenceState,
  currentTier: 1 | 2 | 3,
): boolean {
  const supplier = input.supplier;
  if (kind === 'church') {
    return supplier?.kind === 'chapel'
      && supplier.constructionComplete !== false
      && supplier.assignedLabor > 0
      && (supplier.chapelTier ?? 1) >= requiredChapelTier;
  }
  if (kind === 'water') {
    return supplier?.kind === 'well' && supplier.constructionComplete !== false;
  }
  if (kind === 'food' || kind === 'firewood') {
    return supplier?.kind === 'marketplace'
      && supplier.constructionComplete !== false
      && input.stocked;
  }
  if (kind === 'foodVariety') {
    return supplier?.kind === 'marketplace'
      && supplier.constructionComplete !== false
      && foodProgressionStatus(supplier, residence.population, currentTier).ready;
  }
  if (kind === 'ale') {
    return supplier?.kind === 'tavern'
      && supplier.constructionComplete !== false
      && supplier.assignedLabor > 0
      && input.stocked;
  }
  if (
    kind === 'preservedFood'
    || kind === 'cloth'
    || kind === 'shoes'
    || kind === 'pottery'
    || kind === 'luxury'
  ) {
    return supplier?.kind === 'marketplace'
      && supplier.constructionComplete !== false
      && input.stocked;
  }
  return false;
}

function promotionNeedBlocker(kind: ResidenceUpgradeServiceKind, label: string): string {
  switch (kind) {
    case 'water':
      return 'water route missing — connect a completed well within service radius';
    case 'church':
      return `${label.toLowerCase()} route missing — staff the required reachable church`;
    case 'foodVariety':
      return `${label.toLowerCase()} unmet — stock the missing groups in the household pantry or one reachable Marketplace`;
    case 'ale':
      return 'beverages unmet — stock the household or a staffed reachable Tavern';
    case 'food':
      return 'food supply unmet — stock the household pantry or a reachable Marketplace';
    case 'firewood':
      return 'firewood unmet — stock the household or a reachable Marketplace';
    case 'preservedFood':
      return 'cured provisions unmet — stock the household or a reachable Marketplace';
    case 'cloth':
      return 'cloth unmet — stock the household or a reachable Marketplace goods stall';
    case 'shoes':
      return 'shoes unmet — stock the household or a reachable Marketplace goods stall';
    case 'pottery':
      return 'pottery unmet — stock the household or a reachable Marketplace goods stall';
    case 'luxury':
      return 'luxury unmet — stock the household or a reachable Marketplace';
  }
}

export function evaluateResidenceUpgrade(
  residence: ResidenceState,
  totals: Pick<ResourceTotals, 'timber' | 'stone' | 'gold' | 'roofTiles'>,
  serviceInputs: ResidenceUpgradeServices,
  context: ResidenceUpgradeContext = {},
): ResidenceUpgradePlan | null {
  const definition = definitionForTier(residence.tier);
  if (!definition) return null;

  const services = definition.serviceKinds.map((kind): ResidenceUpgradeServiceCheck => {
    const input = serviceInputs[kind];
    const householdReady = householdPromotionNeedReady(
      residence,
      kind,
      definition.currentTier,
    );
    const outletReady = promotionOutletReady(
      kind,
      input,
      definition.requiredChapelTier,
      residence,
      definition.currentTier,
    );
    return {
      kind,
      label: kind === 'church'
        ? `Level ${definition.requiredChapelTier} church`
        : kind === 'foodVariety'
          ? definition.currentTier >= 3
            ? 'Current grain, produce/forage, animal-food, and fish standard'
            : 'Current grain staple and second food group'
          : SERVICE_LABELS[kind],
      supplier: input.supplier,
      stocked: input.stocked,
      householdReady,
      outletReady,
      ready: householdReady || outletReady,
    };
  });
  const physicalEconomy = context.physicalEconomy === true;
  const funding = householdProjectFunding(
    residence.householdWealth,
    definition.gold,
    totals.gold,
    physicalEconomy,
  );
  const requiredResources = [
    ['timber', 'Timber', totals.timber, definition.timber],
    ['stone', 'Stone', totals.stone, definition.stone],
    ['gold', physicalEconomy ? 'Treasury gold' : 'Gold', totals.gold, funding.civicGoldRequired],
    ['roofTiles', 'Fired roof tiles', totals.roofTiles, definition.roofTiles],
  ] as const;
  const resources = requiredResources.filter(([, , , required]) => required > 0).map(
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
  const activeProject = residenceHasActiveProject(residence);
  const blockers = [
    ...(!occupied ? ['occupied household required'] : []),
    ...(serviceState.upgradeBlocked
      ? ['sustained household needs must recover before promotion']
      : []),
    ...(context.fireDisabled ? ['repair fire damage before upgrading'] : []),
    ...(activeProject ? ['finish or cancel the active household project'] : []),
    ...services.filter((service) => !service.ready).map((service) =>
      promotionNeedBlocker(service.kind, service.label)),
    ...resources.filter((resource) => !resource.ready).map(
      (resource) => `${formatAmount(resource.shortfall)} ${resource.label.toLowerCase()} short`,
    ),
  ];

  return {
    currentTier: definition.currentTier,
    nextTier: definition.nextTier,
    populationCapacity: definition.populationCapacity,
    addedCapacity: Math.max(0, definition.populationCapacity - residence.populationCapacity),
    addedNeeds: definition.addedNeeds,
    occupied,
    services,
    resources,
    blockers,
    ready: blockers.length === 0,
    householdContribution: funding.householdContribution,
    civicGoldRequired: funding.civicGoldRequired,
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
    || (targetTier !== 1 && targetTier !== 2 && targetTier !== 3 && targetTier !== 4)
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
