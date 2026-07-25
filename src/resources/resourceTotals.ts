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
  let polearms = state.stockpile.polearms ?? 0;

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
    polearms += building.polearms ?? 0;
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
  }

  cachedTotals = {
    timber,
    stone,
    firewood,
    water,
    food,
    gold: state.stockpile.gold,
    grain,
    flour,
    ale,
    preservedFood,
    honey,
    wine,
    polearms,
  };
  cachedState = state;
  return cachedTotals;
}

export function computeTradeAvailability(state: GameState): MarketplaceTradeAvailability {
  const totals = computeResourceTotals(state);
  return {
    timber: totals.timber,
    stone: totals.stone,
    gold: totals.gold,
    firewood: totals.firewood,
    food: totals.food,
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

  const total = STARTING_POPULATION + housed;
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
