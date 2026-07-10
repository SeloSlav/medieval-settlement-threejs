import {
  ABANDON_AFTER_DEFICIT_TICKS,
  BUILDING_DEFINITIONS,
  BUILDING_STORAGE_CAPS,
  LODGE_DELIVERY_INTERVAL,
  LODGE_FIREWOOD_PER_DELIVERY,
  POPULATION_PER_RESIDENCE,
  RESIDENCE_FIREWOOD_CAPACITY,
  RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC,
  SIM_TICK_SECONDS,
  STARTING_POPULATION,
  type StorageCaps,
} from '../generated/gameBalance.ts';
import type { BuildingKind, BuildingState, GameState, ResidenceState } from './types.ts';

export {
  ABANDON_AFTER_DEFICIT_TICKS,
  POPULATION_PER_RESIDENCE,
  RESIDENCE_FIREWOOD_CAPACITY,
  RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC,
  SIM_TICK_SECONDS,
  STARTING_POPULATION,
};

export type { StorageCaps };

/** One in-game day for firewood runway display (60 sim seconds). */
export const GAME_DAY_SECONDS = 60;

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

export function residenceFirewoodDemandPerSecond(residence: ResidenceState): number {
  if (residence.abandoned || residence.population <= 0) return 0;
  return residence.population * RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC;
}

export function residenceFirewoodRunwaySeconds(residence: ResidenceState): number | null {
  const demand = residenceFirewoodDemandPerSecond(residence);
  if (demand <= 0) return null;
  return residence.firewoodStock / demand;
}

export function residenceFirewoodRunwayDays(residence: ResidenceState): number | null {
  const runwaySeconds = residenceFirewoodRunwaySeconds(residence);
  if (runwaySeconds == null) return null;
  return runwaySeconds / GAME_DAY_SECONDS;
}

export function formatFirewoodRunwayDays(days: number): string {
  if (days >= 10) return `${Math.round(days)} days`;
  if (days >= 1) return `${days.toFixed(1)} days`;
  const runwaySeconds = days * GAME_DAY_SECONDS;
  if (runwaySeconds >= 3600) return `~${(runwaySeconds / 3600).toFixed(1)} h`;
  const minutes = runwaySeconds / 60;
  return `~${Math.max(1, Math.round(minutes))} min`;
}

export type LodgeLaborSplit = {
  processing: number;
  delivering: number;
  alternates: boolean;
};

/** One deliverer when possible; remaining workers process. A lone worker alternates roles. */
export function lodgeLaborSplit(assignedLabor: number): LodgeLaborSplit {
  if (assignedLabor <= 0) {
    return { processing: 0, delivering: 0, alternates: false };
  }
  if (assignedLabor === 1) {
    return { processing: 1, delivering: 1, alternates: true };
  }
  return { processing: assignedLabor - 1, delivering: 1, alternates: false };
}

export function formatLodgeCrewSplit(split: LodgeLaborSplit): string {
  if (split.processing === 0 && split.delivering === 0) return 'None assigned';
  if (split.alternates) return '1 worker — alternates processing & delivery';
  if (split.delivering === 0) return `${split.processing} processing`;
  return `${split.processing} processing · ${split.delivering} delivering`;
}

export function lodgeFirewoodPerDelivery(deliveryWorkers: number): number {
  if (deliveryWorkers <= 0) return 0;
  return LODGE_FIREWOOD_PER_DELIVERY * deliveryWorkers;
}

export function lodgeDeliveryIntervalSeconds(deliveryWorkers: number): number {
  if (deliveryWorkers <= 0) return Infinity;
  return LODGE_DELIVERY_INTERVAL / deliveryWorkers;
}

export function computeResourceTotals(state: GameState): ResourceTotals {
  let timber = state.stockpile.timber;
  let stone = state.stockpile.stone;
  let firewood = state.stockpile.firewood;

  for (const building of state.buildings.values()) {
    timber += building.timber;
    stone += building.stone;
    firewood += building.firewood;
  }

  for (const residence of state.residences.values()) {
    firewood += residence.firewoodStock;
  }

  return {
    timber,
    stone,
    firewood,
    water: state.stockpile.water,
  };
}

export function computePopulationStats(state: GameState): PopulationStats {
  let fromResidences = 0;
  for (const residence of state.residences.values()) {
    if (residence.abandoned) continue;
    fromResidences += residence.population;
  }

  const total = STARTING_POPULATION + fromResidences;
  let assigned = 0;
  for (const building of state.buildings.values()) {
    assigned += building.assignedLabor;
  }

  return {
    total,
    assigned,
    available: Math.max(0, total - assigned),
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

export function residenceNeedsStatus(residence: ResidenceState): {
  label: string;
  state: 'active' | 'idle' | 'warning' | 'abandoned';
} {
  if (residence.abandoned) {
    return { label: 'Abandoned — firewood needs unmet', state: 'abandoned' };
  }
  if (residence.population === 0) {
    return { label: 'Unoccupied', state: 'idle' };
  }
  if (residence.needsDeficitTicks > 0) {
    const remainingTicks = Math.max(0, ABANDON_AFTER_DEFICIT_TICKS - residence.needsDeficitTicks);
    const remainingSeconds = remainingTicks * SIM_TICK_SECONDS;
    return {
      label: `Low firewood — abandons in ${formatShortDuration(remainingSeconds)}`,
      state: 'warning',
    };
  }

  const runwayDays = residenceFirewoodRunwayDays(residence);
  if (runwayDays == null) {
    return { label: 'Needs met', state: 'active' };
  }

  if (runwayDays <= 0.25) {
    return {
      label: 'Out of firewood — awaiting delivery',
      state: 'warning',
    };
  }
  if (runwayDays < 1) {
    return {
      label: `Low firewood — ${formatFirewoodRunwayDays(runwayDays)} left`,
      state: 'warning',
    };
  }
  if (runwayDays < 3) {
    return {
      label: `Firewood low — ${formatFirewoodRunwayDays(runwayDays)} left`,
      state: 'warning',
    };
  }
  return {
    label: `Needs met — ${formatFirewoodRunwayDays(runwayDays)} of firewood`,
    state: 'active',
  };
}

function formatShortDuration(seconds: number): string {
  if (seconds >= 120) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    return `~${minutes} min`;
  }
  return `~${Math.max(1, Math.round(seconds))}s`;
}
