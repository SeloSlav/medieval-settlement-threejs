import {
  ABANDON_AFTER_DEFICIT_TICKS,
  BUILDING_DEFINITIONS,
  BUILDING_STORAGE_CAPS,
  POPULATION_PER_RESIDENCE,
  RESIDENCE_FIREWOOD_CAPACITY,
  RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC,
  RESIDENCE_RECOVERY_FIREWOOD_MIN,
  RESIDENCE_SETTLE_TICKS,
  SIM_TICK_SECONDS,
  STARTING_POPULATION,
  type StorageCaps,
} from '../generated/gameBalance.ts';
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

  for (const building of state.buildings.values()) {
    timber += building.timber;
    stone += building.stone;
    firewood += building.firewood;
  }

  for (const residence of state.residences.values()) {
    firewood += getNeedStock(residence.needs, 'firewood');
  }

  cachedTotals = {
    timber,
    stone,
    firewood,
    water: state.stockpile.water,
  };
  cachedState = state;
  return cachedTotals;
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
  return Math.min(fromPool, buildingMaxLabor(building.kind));
}
