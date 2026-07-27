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
import { granaryExportableGrain } from '../economy/granaryPolicy.ts';
import { fireDisabledBuildingIds } from '../fires/fireIncident.ts';
import { getNeedStock } from '../residences/residenceNeedState.ts';
import type { BuildingKind, BuildingState, GameState } from './types.ts';
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
  flour: number;
  ale: number;
  preservedFood: number;
  honey: number;
  wine: number;
  wool: number;
  cloth: number;
  ironwork: number;
  polearms: number;
};

export type PopulationStats = {
  total: number;
  assigned: number;
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

export function computeResourceTotals(state: GameState): ResourceTotals {
  if (cachedState === state && cachedTotals) {
    return cachedTotals;
  }

  let timber = state.stockpile.timber;
  let stone = state.stockpile.stone;
  let firewood = state.stockpile.firewood;
  let water = state.stockpile.water;
  let food = state.stockpile.food;
  let grain = state.stockpile.grain;
  let flour = state.stockpile.flour;
  let ale = state.stockpile.ale;
  let preservedFood = state.stockpile.preservedFood;
  let honey = state.stockpile.honey;
  let wine = state.stockpile.wine;
  let wool = state.stockpile.wool;
  let cloth = state.stockpile.cloth;
  let ironwork = state.stockpile.ironwork ?? 0;
  let polearms = state.stockpile.polearms ?? 0;
  let gold = state.stockpile.gold;

  for (const building of state.buildings.values()) {
    timber += building.timber;
    stone += building.stone;
    firewood += building.firewood;
    water += building.water;
    food += building.food;
    grain += building.grain;
    flour += building.flour;
    ale += building.ale;
    preservedFood += building.preservedFood;
    honey += building.honey;
    wine += building.wine;
    wool += building.wool ?? 0;
    cloth += building.cloth ?? 0;
    ironwork += building.ironwork ?? 0;
    polearms += building.polearms ?? 0;
    if (building.kind === 'founders_camp' || building.kind === 'town_hall') {
      gold += building.gold;
    }
    if (building.constructionComplete === false) {
      timber -= building.constructionReservedTimber;
      stone -= building.constructionReservedStone;
    }
  }

  for (const residence of state.residences.values()) {
    firewood += getNeedStock(residence.needs, 'firewood');
    water += getNeedStock(residence.needs, 'water');
    food += getNeedStock(residence.needs, 'food');
    ale += getNeedStock(residence.needs, 'ale');
    preservedFood += getNeedStock(residence.needs, 'preservedFood');
    cloth += getNeedStock(residence.needs, 'cloth');
  }

  cachedTotals = {
    timber,
    stone,
    firewood,
    water,
    food,
    gold,
    grain,
    flour,
    ale,
    preservedFood,
    honey,
    wine,
    wool,
    cloth,
    ironwork,
    polearms,
  };
  cachedState = state;
  return cachedTotals;
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
  let accessibleIronwork = 0;
  let reservedBuildingTimber = 0;
  let reservedBuildingStone = 0;
  let reservedTreasuryTimber = 0;
  let reservedTreasuryStone = 0;

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
    accessibleIronwork += building.ironwork ?? 0;
  }

  const unreservedBuildingTimber = Math.max(0, allBuildingTimber - reservedBuildingTimber);
  const unreservedBuildingStone = Math.max(0, allBuildingStone - reservedBuildingStone);
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
    gold: computeResourceTotals(state).gold,
    firewood: (includeLegacyLedger ? state.stockpile.firewood : 0) + accessibleFirewood,
    food: (includeLegacyLedger ? state.stockpile.food : 0) + accessibleFood,
    grain: (includeLegacyLedger ? state.stockpile.grain : 0) + accessibleGrain,
    ironwork: (includeLegacyLedger ? (state.stockpile.ironwork ?? 0) : 0) + accessibleIronwork,
  };
}

export function computePopulationStats(state: GameState): PopulationStats {
  let housed = 0;
  let housingCapacity = 0;
  for (const residence of state.residences.values()) {
    if (residence.abandoned) continue;
    housed += residence.population;
    housingCapacity += residence.populationCapacity;
  }

  const total = state.physicalFoundingSiteEnabled === true
    ? Math.max(STARTING_POPULATION, housed)
    : STARTING_POPULATION + housed;
  let assigned = 0;
  for (const building of state.buildings.values()) {
    assigned += building.assignedLabor;
  }

  return {
    total,
    assigned,
    available: Math.max(0, total - assigned),
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
  const fromPool = Math.max(0, stats.total - assignedElsewhere);
  const buildingCap = building.constructionComplete !== false
    ? buildingMaxLabor(building.kind)
    : CONSTRUCTION_MAX_BUILDERS;
  return Math.min(fromPool, buildingCap);
}
