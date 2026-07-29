import {
  ABANDON_AFTER_DEFICIT_TICKS,
  BUILDING_DEFINITIONS,
  BUILDING_STORAGE_CAPS,
  CONSTRUCTION_MAX_BUILDERS,
  POPULATION_PER_RESIDENCE,
  RESIDENCE_FIREWOOD_CAPACITY,
  RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC,
  RESIDENCE_RECOVERY_FIREWOOD_MIN,
  RESIDENCE_WATER_CAPACITY,
  RESIDENCE_SETTLE_TICKS,
  SIM_TICK_SECONDS,
  STARTING_POPULATION,
  type StorageCaps,
} from '../generated/gameBalance.ts';
import type { MarketplaceTradeAvailability } from '../economy/marketplaceTrade.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import { granaryExportableGrain } from '../economy/granaryPolicy.ts';
import { localCivicReceiptGold } from '../economy/civicReceipts.ts';
import { fireDisabledBuildingIds } from '../fires/fireIncident.ts';
import { getNeedStock } from '../residences/residenceNeedState.ts';
import {
  residenceHasActiveProject,
  type BuildingKind,
  type BuildingState,
  type GameState,
} from './types.ts';
import {
  formatFirewoodRunwayDays,
  GAME_DAY_SECONDS,
  residenceFirewoodRunwayDays,
  residenceFirewoodRunwaySeconds,
} from '../logistics/firewoodLogistics.ts';

export { residenceNeedsStatus } from '../residences/residenceNeeds.ts';

export {
  ABANDON_AFTER_DEFICIT_TICKS,
  formatFirewoodRunwayDays,
  GAME_DAY_SECONDS,
  POPULATION_PER_RESIDENCE,
  residenceFirewoodRunwayDays,
  residenceFirewoodRunwaySeconds,
  RESIDENCE_FIREWOOD_CAPACITY,
  RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC,
  RESIDENCE_RECOVERY_FIREWOOD_MIN,
  RESIDENCE_WATER_CAPACITY,
  RESIDENCE_SETTLE_TICKS,
  SIM_TICK_SECONDS,
  STARTING_POPULATION,
};

export type { StorageCaps };

export type ResourceTotals = {
  timber: number;
  stone: number;
  firewood: number;
  water: number;
  food: number;
  gold: number;
  grain: number;
  barley: number;
  malt: number;
  flax: number;
  flour: number;
  ale: number;
  preservedFood: number;
  honey: number;
  wine: number;
  wool: number;
  cloth: number;
  ironwork: number;
  polearms: number;
  iron: number;
  clay: number;
  salt: number;
  charcoal: number;
  pottery: number;
  manure: number;
  remedies: number;
};

export const HUD_RESOURCE_KINDS = [
  'timber',
  'stone',
  'firewood',
  'water',
  'food',
  'gold',
  'grain',
  'barley',
  'malt',
  'flax',
  'flour',
  'ale',
  'preservedFood',
  'honey',
  'wine',
  'wool',
  'cloth',
  'ironwork',
  'polearms',
  'iron',
  'clay',
  'salt',
  'charcoal',
  'pottery',
] as const satisfies readonly (keyof ResourceTotals)[];

export type HudResourceKind = (typeof HUD_RESOURCE_KINDS)[number];

export function isHudResourceKind(value: string): value is HudResourceKind {
  return (HUD_RESOURCE_KINDS as readonly string[]).includes(value);
}

export type PopulationStats = {
  total: number;
  assigned: number;
  cartAssigned: number;
  sick?: number;
  available: number;
  housingCapacity: number;
  housed: number;
  vacant: number;
};

export function buildingStorageCaps(kind: BuildingKind): StorageCaps {
  return BUILDING_STORAGE_CAPS[kind];
}

export function buildingAcceptsLabor(kind: BuildingKind): boolean {
  return BUILDING_DEFINITIONS[kind].acceptsLabor;
}

export function buildingMaxLabor(kind: BuildingKind): number {
  const definition = BUILDING_DEFINITIONS[kind];
  return definition.acceptsLabor ? definition.maxLabor : 0;
}

export function laborScaledInterval(baseInterval: number, assignedLabor: number): number {
  if (assignedLabor <= 0 || baseInterval <= 0) return baseInterval;
  return baseInterval / assignedLabor;
}

let cachedState: GameState | null = null;
let cachedTotals: ResourceTotals | null = null;
let cachedStoredTotals: ResourceTotals | null = null;

export function computeResourceTotals(state: GameState): ResourceTotals {
  if (cachedState === state && cachedTotals) {
    return cachedTotals;
  }

  // The player-resource row remains in the schema for old saves and policy
  // fields, but a physical settlement may only count goods held by a map
  // entity. The server materializes any migrated balance into a salvage pile.
  const ledger = state.physicalFoundingSiteEnabled === true
    ? null
    : state.stockpile;
  let timber = ledger?.timber ?? 0;
  let stone = ledger?.stone ?? 0;
  let firewood = ledger?.firewood ?? 0;
  let water = ledger?.water ?? 0;
  let food = ledger?.food ?? 0;
  let grain = ledger?.grain ?? 0;
  let barley = ledger?.barley ?? 0;
  let malt = ledger?.malt ?? 0;
  let flax = ledger?.flax ?? 0;
  let flour = ledger?.flour ?? 0;
  let ale = ledger?.ale ?? 0;
  let preservedFood = ledger?.preservedFood ?? 0;
  let honey = ledger?.honey ?? 0;
  let wine = ledger?.wine ?? 0;
  let wool = ledger?.wool ?? 0;
  let cloth = ledger?.cloth ?? 0;
  let ironwork = ledger?.ironwork ?? 0;
  let polearms = ledger?.polearms ?? 0;
  let iron = ledger?.iron ?? 0;
  let clay = ledger?.clay ?? 0;
  let salt = ledger?.salt ?? 0;
  let charcoal = ledger?.charcoal ?? 0;
  let pottery = ledger?.pottery ?? 0;
  let manure = 0;
  let remedies = 0;
  let gold = ledger?.gold ?? 0;
  let reservedTimber = 0;
  let reservedStone = 0;
  let reservedGold = 0;

  for (const building of state.buildings.values()) {
    timber += building.timber;
    stone += building.stone;
    firewood += building.firewood;
    water += building.water;
    food += building.food;
    grain += building.grain;
    barley += building.barley ?? 0;
    malt += building.malt ?? 0;
    flax += building.flax ?? 0;
    flour += building.flour;
    ale += building.ale;
    preservedFood += building.preservedFood;
    honey += building.honey;
    wine += building.wine;
    wool += building.wool ?? 0;
    cloth += building.cloth ?? 0;
    ironwork += building.ironwork ?? 0;
    polearms += building.polearms ?? 0;
    iron += building.iron ?? 0;
    clay += building.clay ?? 0;
    salt += building.salt ?? 0;
    charcoal += building.charcoal ?? 0;
    pottery += building.pottery ?? 0;
    manure += building.manure ?? 0;
    remedies += building.remedies ?? 0;
    if (
      building.kind === 'founders_camp'
      || building.kind === 'salvage_pile'
      || building.kind === 'town_hall'
    ) {
      gold += building.gold;
    }
    if (building.constructionComplete === false) {
      reservedTimber += Math.max(0, building.constructionReservedTimber);
      reservedStone += Math.max(0, building.constructionReservedStone);
    }
  }

  for (const residence of state.residences?.values() ?? []) {
    if (residenceHasActiveProject(residence)) {
      reservedTimber += Math.max(0, residence.upgradeReservedTimber ?? 0);
      reservedStone += Math.max(0, residence.upgradeReservedStone ?? 0);
      reservedGold += Math.max(0, residence.upgradeReservedGold ?? 0);
    }
    firewood += getNeedStock(residence.needs, 'firewood');
    water += getNeedStock(residence.needs, 'water');
    food += getNeedStock(residence.needs, 'food');
    ale += getNeedStock(residence.needs, 'ale');
    preservedFood += getNeedStock(residence.needs, 'preservedFood');
    cloth += getNeedStock(residence.needs, 'cloth');
    remedies += Math.max(0, residence.remedyStock ?? 0);
  }

  cachedStoredTotals = {
    timber: Math.max(0, timber),
    stone: Math.max(0, stone),
    firewood,
    water,
    food,
    gold: Math.max(0, gold),
    grain,
    barley,
    malt,
    flax,
    flour,
    ale,
    preservedFood,
    honey,
    wine,
    wool,
    cloth,
    ironwork,
    polearms,
    iron,
    clay,
    salt,
    charcoal,
    pottery,
    manure,
    remedies,
  };
  cachedTotals = {
    ...cachedStoredTotals,
    timber: Math.max(0, timber - reservedTimber),
    stone: Math.max(0, stone - reservedStone),
    gold: Math.max(0, gold - reservedGold),
  };
  cachedState = state;
  return cachedTotals;
}

/**
 * Every physical good presently stored in the settlement, including stock
 * already committed to active construction and household projects.
 */
export function computeStoredResourceTotals(state: GameState): ResourceTotals {
  if (cachedState !== state || !cachedStoredTotals) {
    computeResourceTotals(state);
  }
  return cachedStoredTotals!;
}

/**
 * Loaded goods are still owned and physically represented by their cart, but
 * they are not spendable at a store or destination until unloading. Keep this
 * ledger separate from `computeResourceTotals` so readable HUD feedback never
 * lets client affordability previews promise cargo that the server cannot use.
 */
export function computeInTransitResourceTotals(
  trips: Iterable<DeliveryTripState>,
): ResourceTotals {
  const totals = emptyResourceTotals();
  for (const trip of trips) {
    const amount = Number.isFinite(trip.amount) ? Math.max(0, trip.amount) : 0;
    if (amount <= 1e-6) continue;
    totals[trip.cargoKind] += amount;
  }
  return totals;
}

/**
 * Market proceeds, local tolls, ferry fares, and monastery visitor gifts are
 * physically owned but remain unavailable until their cart reaches a civic
 * lockbox.
 */
export function computeGoldAwaitingCollection(
  buildings: Iterable<BuildingState>,
): number {
  let gold = 0;
  for (const building of buildings) {
    if (
      building.kind === 'marketplace'
      && building.constructionComplete !== false
      && Number.isFinite(building.gold)
    ) {
      gold += Math.max(0, building.gold);
      continue;
    }
    gold += localCivicReceiptGold(building);
  }
  return gold;
}

/** Gold already committed to local guard-company pay chests. */
export function computeGuardhousePayrollGold(
  buildings: Iterable<BuildingState>,
): number {
  let gold = 0;
  for (const building of buildings) {
    if (
      building.kind === 'guardhouse'
      && building.constructionComplete !== false
      && Number.isFinite(building.gold)
    ) {
      gold += Math.max(0, building.gold);
    }
  }
  return gold;
}

/**
 * Physical timber held at buildings after subtracting active construction
 * reservations backed by those stores. This mirrors the authoritative lodge
 * conversion check.
 */
export function computeUnreservedBuildingTimber(state: GameState): number {
  let timber = 0;
  let reserved = 0;
  for (const building of state.buildings.values()) {
    timber += building.timber;
    if (building.constructionComplete === false) {
      reserved += Math.max(
        0,
        building.constructionReservedTimber - building.constructionTreasuryTimber,
      );
    }
  }
  for (const residence of state.residences?.values() ?? []) {
    if (residenceHasActiveProject(residence)) {
      reserved += Math.max(0, residence.upgradeReservedTimber ?? 0);
    }
  }
  return Math.max(0, timber - reserved);
}

export type RoadConnectionQuery = (
  ax: number,
  az: number,
  bx: number,
  bz: number,
) => boolean;

/**
 * Reports goods that can participate in this market's trade loop. Physical
 * saves use the number to decide whether a staging cart can complete the lot;
 * only inventory already at the market is consumed when the trade settles.
 * Legacy saves retain direct access to their compatibility ledger.
 */
export function computeMarketplaceTradeAvailability(
  state: GameState,
  marketplace: BuildingState,
  roadConnected: RoadConnectionQuery,
): MarketplaceTradeAvailability {
  const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
  const includeLegacyLedger = state.physicalFoundingSiteEnabled !== true;
  let allBuildingTimber = 0;
  let allBuildingStone = 0;
  let accessibleTimber = 0;
  let accessibleStone = 0;
  let accessibleFirewood = 0;
  let accessibleFood = 0;
  let accessibleGrain = 0;
  let accessibleBarley = 0;
  let accessibleIronwork = 0;
  let accessibleIron = 0;
  let accessibleSalt = 0;
  let accessiblePottery = 0;
  let reservedBuildingTimber = 0;
  let reservedBuildingStone = 0;
  let reservedTreasuryTimber = 0;
  let reservedTreasuryStone = 0;
  let reservedResidenceTimber = 0;
  let reservedResidenceStone = 0;

  for (const building of state.buildings.values()) {
    allBuildingTimber += building.timber;
    allBuildingStone += building.stone;
    if (building.constructionComplete === false) {
      reservedBuildingTimber += Math.max(
        0,
        building.constructionReservedTimber - building.constructionTreasuryTimber,
      );
      reservedBuildingStone += Math.max(
        0,
        building.constructionReservedStone - building.constructionTreasuryStone,
      );
      reservedTreasuryTimber += building.constructionTreasuryTimber;
      reservedTreasuryStone += building.constructionTreasuryStone;
      continue;
    }
    if (fireDisabled.has(building.id)) continue;

    const connected = building.id === marketplace.id
      || roadConnected(marketplace.x, marketplace.z, building.x, building.z);
    if (!connected) continue;
    accessibleTimber += building.timber;
    accessibleStone += building.stone;
    accessibleFirewood += building.firewood;
    accessibleFood += building.food;
    accessibleGrain += building.kind === 'granary'
      ? granaryExportableGrain(building.grain, building.granaryGrainReserve ?? 0)
      : building.grain;
    accessibleBarley += building.barley ?? 0;
    accessibleIronwork += building.ironwork ?? 0;
    accessibleIron += building.iron ?? 0;
    accessibleSalt += building.salt ?? 0;
    accessiblePottery += building.pottery ?? 0;
  }

  for (const residence of state.residences?.values() ?? []) {
    if (!residenceHasActiveProject(residence)) continue;
    reservedResidenceTimber += Math.max(0, residence.upgradeReservedTimber ?? 0);
    reservedResidenceStone += Math.max(0, residence.upgradeReservedStone ?? 0);
  }

  const unreservedBuildingTimber = Math.max(
    0,
    allBuildingTimber - reservedBuildingTimber - reservedResidenceTimber,
  );
  const unreservedBuildingStone = Math.max(
    0,
    allBuildingStone - reservedBuildingStone - reservedResidenceStone,
  );
  const ledgerTimber = includeLegacyLedger
    ? Math.max(0, state.stockpile.timber - reservedTreasuryTimber)
    : 0;
  const ledgerStone = includeLegacyLedger
    ? Math.max(0, state.stockpile.stone - reservedTreasuryStone)
    : 0;
  return {
    timber:
      ledgerTimber + Math.min(accessibleTimber, unreservedBuildingTimber),
    stone:
      ledgerStone + Math.min(accessibleStone, unreservedBuildingStone),
    gold: includeLegacyLedger
      ? computeResourceTotals(state).gold
      : Math.max(0, marketplace.gold),
    firewood: (includeLegacyLedger ? state.stockpile.firewood : 0) + accessibleFirewood,
    food: (includeLegacyLedger ? state.stockpile.food : 0) + accessibleFood,
    grain: (includeLegacyLedger ? state.stockpile.grain : 0) + accessibleGrain,
    barley: (includeLegacyLedger ? (state.stockpile.barley ?? 0) : 0) + accessibleBarley,
    ironwork: (includeLegacyLedger ? (state.stockpile.ironwork ?? 0) : 0) + accessibleIronwork,
    iron: (includeLegacyLedger ? (state.stockpile.iron ?? 0) : 0) + accessibleIron,
    salt: (includeLegacyLedger ? (state.stockpile.salt ?? 0) : 0) + accessibleSalt,
    pottery: (includeLegacyLedger ? (state.stockpile.pottery ?? 0) : 0) + accessiblePottery,
  };
}

export function computePopulationStats(state: GameState): PopulationStats {
  let housed = 0;
  let housingCapacity = 0;
  let sick = 0;
  for (const residence of state.residences?.values() ?? []) {
    if (residence.abandoned || residence.tier === 0) continue;
    housed += residence.population;
    sick += Math.min(residence.population, residence.sickPopulation ?? 0);
    housingCapacity += residence.populationCapacity;
  }

  const legacyPopulationBonus = state.legacyUnhousedPopulationBonusEnabled
    ?? state.physicalFoundingSiteEnabled !== true;
  const total = legacyPopulationBonus
    ? STARTING_POPULATION + housed
    : Math.max(STARTING_POPULATION, housed);
  let buildingAssigned = 0;
  for (const building of state.buildings.values()) {
    buildingAssigned += building.assignedLabor;
  }
  let residenceUpgradeAssigned = 0;
  for (const residence of state.residences?.values() ?? []) {
    if (residenceHasActiveProject(residence)) {
      residenceUpgradeAssigned += Math.max(0, residence.upgradeAssignedLabor ?? 0);
    }
  }
  let cartAssigned = 0;
  for (const trip of state.deliveryTrips.values()) {
    cartAssigned += Math.max(0, trip.freeHaulerWorkers);
  }
  const assigned = buildingAssigned + residenceUpgradeAssigned + cartAssigned;

  return {
    total,
    assigned,
    cartAssigned,
    sick,
    available: Math.max(0, total - assigned - sick),
    housingCapacity,
    housed,
    vacant: Math.max(0, housingCapacity - housed),
  };
}

export function maxAssignableLabor(
  building: BuildingState,
  stats: PopulationStats,
): number {
  const assignedElsewhere = stats.assigned - building.assignedLabor;
  const fromPool = Math.max(0, stats.total - (stats.sick ?? 0) - assignedElsewhere);
  const buildingCap = building.constructionComplete !== false
    ? buildingMaxLabor(building.kind)
    : CONSTRUCTION_MAX_BUILDERS;
  return Math.min(fromPool, buildingCap);
}

function emptyResourceTotals(): ResourceTotals {
  return {
    timber: 0,
    stone: 0,
    firewood: 0,
    water: 0,
    food: 0,
    gold: 0,
    grain: 0,
    barley: 0,
    malt: 0,
    flax: 0,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    wool: 0,
    cloth: 0,
    ironwork: 0,
    polearms: 0,
    iron: 0,
    clay: 0,
    salt: 0,
    charcoal: 0,
    pottery: 0,
    manure: 0,
    remedies: 0,
  };
}
