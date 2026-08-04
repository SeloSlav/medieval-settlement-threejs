import {
  CALENDAR_SECONDS_PER_DAY,
  HERB_TREATMENT_PER_SICK_DAY,
  HUNGER_WARNING_DAYS,
  MALNUTRITION_DAYS,
  SIM_TICK_SECONDS,
  STARVATION_DEATH_START_DAYS,
} from '../generated/gameBalance.ts';
import { residenceServiceState } from './residenceSatisfaction.ts';
import {
  fireDisabledBuildingIds,
  fireDisabledResidenceIds,
} from '../fires/fireIncident.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import type { GameState, ResidenceState } from '../resources/types.ts';

export type WelfareLevel = 'none' | 'stable' | 'watch' | 'critical';

export type SettlementWelfare = {
  level: WelfareLevel;
  activeHouseholds: number;
  activeResidents: number;
  stableHouseholds: number;
  stableResidents: number;
  hungryHouseholds: number;
  hungryResidents: number;
  malnourishedHouseholds: number;
  malnourishedResidents: number;
  starvingHouseholds: number;
  starvingResidents: number;
  sickHouseholds: number;
  sickResidents: number;
  untreatedSickHouseholds: number;
  householdRemedyStock: number;
  preparedRemedyStock: number;
  remediesInTransit: number;
  remedyStock: number;
  remedyDemandPerDay: number;
  remedyRunwayDays: number;
  serviceWarningHouseholds: number;
  upgradeBlockedHouseholds: number;
  serviceEconomicOutputMultiplier: number;
  totalDeaths: number;
  waitingBodies: number;
  outboundEmptyCarts: number;
  loadedBurialCarts: number;
  uncollectedBodiesAtHomes: number;
  oldestUncollectedBodyDays: number;
  burialGrounds: number;
  graveCapacity: number;
  occupiedGraves: number;
  reservedGraves: number;
  openGraves: number;
  staffedGravediggers: number;
  vacantHomes: number;
  firstAttentionResidenceId: string | null;
};

/**
 * Mutable, allocation-free residence accumulator. Settlement provisioning
 * feeds its existing residence scan through this object so health feedback
 * does not add another O(homes) pass to every replicated snapshot.
 */
export type SettlementWelfareAccumulator = Omit<
  SettlementWelfare,
  | 'level'
  | 'remedyRunwayDays'
  | 'householdRemedyStock'
  | 'preparedRemedyStock'
  | 'remediesInTransit'
  | 'waitingBodies'
  | 'outboundEmptyCarts'
  | 'loadedBurialCarts'
  | 'uncollectedBodiesAtHomes'
  | 'oldestUncollectedBodyDays'
  | 'burialGrounds'
  | 'graveCapacity'
  | 'occupiedGraves'
  | 'reservedGraves'
  | 'openGraves'
  | 'staffedGravediggers'
> & {
  firstAttentionRank: number;
  serviceEconomicMultiplierTotal: number;
};

export function createSettlementWelfareAccumulator(): SettlementWelfareAccumulator {
  return {
    activeHouseholds: 0,
    activeResidents: 0,
    stableHouseholds: 0,
    stableResidents: 0,
    hungryHouseholds: 0,
    hungryResidents: 0,
    malnourishedHouseholds: 0,
    malnourishedResidents: 0,
    starvingHouseholds: 0,
    starvingResidents: 0,
    sickHouseholds: 0,
    sickResidents: 0,
    untreatedSickHouseholds: 0,
    remedyStock: 0,
    remedyDemandPerDay: 0,
    serviceWarningHouseholds: 0,
    upgradeBlockedHouseholds: 0,
    serviceEconomicOutputMultiplier: 1,
    totalDeaths: 0,
    vacantHomes: 0,
    firstAttentionResidenceId: null,
    firstAttentionRank: Number.POSITIVE_INFINITY,
    serviceEconomicMultiplierTotal: 0,
  };
}

export function accumulateResidenceWelfare(
  accumulator: SettlementWelfareAccumulator,
  residence: ResidenceState,
  fireDisabled: boolean,
): void {
  accumulator.totalDeaths += finiteCount(residence.deathsTotal);
  if (residence.tier === 0) return;

  if (residence.population <= 0) {
    accumulator.vacantHomes += 1;
    return;
  }

  if (fireDisabled) return;
  const population = finiteCount(residence.population);
  if (population <= 0) return;

  accumulator.activeHouseholds += 1;
  accumulator.activeResidents += population;
  const hungerDays = ticksToDays(residence.hungerTicks);
  const malnutrition = finiteUnit(residence.malnutrition);
  let hungerRank = 3;
  if (hungerDays >= STARVATION_DEATH_START_DAYS) {
    accumulator.starvingHouseholds += 1;
    accumulator.starvingResidents += population;
    hungerRank = 0;
  } else if (hungerDays >= MALNUTRITION_DAYS || malnutrition >= 0.05) {
    accumulator.malnourishedHouseholds += 1;
    accumulator.malnourishedResidents += population;
    hungerRank = 2;
  } else if (hungerDays >= HUNGER_WARNING_DAYS) {
    accumulator.hungryHouseholds += 1;
    accumulator.hungryResidents += population;
    hungerRank = 5;
  }
  if (hungerRank < 3 || hungerRank === 5) {
    updateWelfareAttention(accumulator, residence.id, hungerRank);
  }

  const sick = Math.min(population, finiteCount(residence.sickPopulation));
  const remedyStock = finiteAmount(residence.remedyStock);
  const remedyDemand = sick * HERB_TREATMENT_PER_SICK_DAY;
  accumulator.remedyStock += remedyStock;
  accumulator.remedyDemandPerDay += remedyDemand;
  if (sick > 0) {
    accumulator.sickHouseholds += 1;
    accumulator.sickResidents += sick;
    const untreated = remedyStock + 1e-9 < remedyDemand;
    if (untreated) accumulator.untreatedSickHouseholds += 1;
    updateWelfareAttention(accumulator, residence.id, untreated ? 3 : 4);
  }

  const service = residenceServiceState(residence);
  accumulator.serviceEconomicMultiplierTotal += service.economicMultiplier;
  if (service.warning) {
    accumulator.serviceWarningHouseholds += 1;
    updateWelfareAttention(accumulator, residence.id, 6);
  }
  if (service.upgradeBlocked) {
    accumulator.upgradeBlockedHouseholds += 1;
  }

  if (
    hungerDays < HUNGER_WARNING_DAYS
    && malnutrition < 0.05
    && sick === 0
    && !service.warning
  ) {
    accumulator.stableHouseholds += 1;
    accumulator.stableResidents += population;
  }
}

export function finalizeSettlementWelfare(
  accumulator: SettlementWelfareAccumulator,
  state: GameState,
  disabledBuildings: ReadonlySet<string>,
): SettlementWelfare {
  let waitingBodies = 0;
  let outboundEmptyCarts = 0;
  let loadedBurialCarts = 0;
  let uncollectedBodiesAtHomes = 0;
  let oldestUncollectedBodyDays = 0;
  let reservedGraves = 0;
  for (const corpse of state.corpses?.values() ?? []) {
    if (corpse.state === 0) waitingBodies += 1;
    if (corpse.state === 1) outboundEmptyCarts += 1;
    if (corpse.state === 2) loadedBurialCarts += 1;
    if (corpse.state > 0 && corpse.graveyardId !== null) reservedGraves += 1;
    if (corpse.state <= 1) {
      uncollectedBodiesAtHomes += 1;
      oldestUncollectedBodyDays = Math.max(
        oldestUncollectedBodyDays,
        ticksToDays(Math.max(0, state.tick - corpse.createdTick)),
      );
      updateWelfareAttention(accumulator, corpse.residenceId, 1);
    }
  }

  let burialGrounds = 0;
  let graveCapacity = 0;
  let occupiedGraves = 0;
  for (const graveyard of state.graveyards?.values() ?? []) {
    burialGrounds += 1;
    graveCapacity += finiteCount(graveyard.capacity);
    occupiedGraves += finiteCount(graveyard.burials);
  }
  const openGraves = Math.max(0, graveCapacity - occupiedGraves - reservedGraves);

  let staffedGravediggers = 0;
  let preparedRemedyStock = 0;
  for (const building of state.buildings.values()) {
    preparedRemedyStock += finiteAmount(building.remedies);
    if (
      building.kind === 'chapel'
      && building.constructionComplete !== false
      && !disabledBuildings.has(building.id)
    ) {
      staffedGravediggers += finiteCount(building.assignedLabor);
    }
  }
  let remediesInTransit = 0;
  for (const trip of state.deliveryTrips.values()) {
    if (trip.cargoKind === 'remedies') {
      remediesInTransit += finiteAmount(trip.amount);
    }
  }

  const householdRemedyStock = accumulator.remedyStock;
  const totalRemedyStock =
    householdRemedyStock + preparedRemedyStock + remediesInTransit;
  const remedyRunwayDays = accumulator.remedyDemandPerDay > 1e-9
    ? totalRemedyStock / accumulator.remedyDemandPerDay
    : Number.POSITIVE_INFINITY;
  const seriousUntreatedIllness = accumulator.untreatedSickHouseholds > 0
    && accumulator.activeResidents > 0
    && accumulator.sickResidents / accumulator.activeResidents >= 0.2;
  const critical = accumulator.starvingResidents > 0
    || seriousUntreatedIllness
    || (
      uncollectedBodiesAtHomes > 0
      && (openGraves <= 0 || oldestUncollectedBodyDays >= 1)
    );
  const watch = critical
    || accumulator.hungryResidents > 0
    || accumulator.malnourishedResidents > 0
    || accumulator.sickResidents > 0
    || accumulator.serviceWarningHouseholds > 0
    || uncollectedBodiesAtHomes > 0;
  const hasWelfareState = accumulator.activeResidents > 0
    || accumulator.totalDeaths > 0
    || burialGrounds > 0
    || accumulator.vacantHomes > 0;

  return {
    level: critical ? 'critical' : watch ? 'watch' : hasWelfareState ? 'stable' : 'none',
    activeHouseholds: accumulator.activeHouseholds,
    activeResidents: accumulator.activeResidents,
    stableHouseholds: accumulator.stableHouseholds,
    stableResidents: accumulator.stableResidents,
    hungryHouseholds: accumulator.hungryHouseholds,
    hungryResidents: accumulator.hungryResidents,
    malnourishedHouseholds: accumulator.malnourishedHouseholds,
    malnourishedResidents: accumulator.malnourishedResidents,
    starvingHouseholds: accumulator.starvingHouseholds,
    starvingResidents: accumulator.starvingResidents,
    sickHouseholds: accumulator.sickHouseholds,
    sickResidents: accumulator.sickResidents,
    untreatedSickHouseholds: accumulator.untreatedSickHouseholds,
    householdRemedyStock,
    preparedRemedyStock,
    remediesInTransit,
    remedyStock: totalRemedyStock,
    remedyDemandPerDay: accumulator.remedyDemandPerDay,
    remedyRunwayDays,
    serviceWarningHouseholds: accumulator.serviceWarningHouseholds,
    upgradeBlockedHouseholds: accumulator.upgradeBlockedHouseholds,
    serviceEconomicOutputMultiplier: accumulator.activeHouseholds > 0
      ? accumulator.serviceEconomicMultiplierTotal / accumulator.activeHouseholds
      : 1,
    totalDeaths: accumulator.totalDeaths,
    waitingBodies,
    outboundEmptyCarts,
    loadedBurialCarts,
    uncollectedBodiesAtHomes,
    oldestUncollectedBodyDays,
    burialGrounds,
    graveCapacity,
    occupiedGraves,
    reservedGraves,
    openGraves,
    staffedGravediggers,
    vacantHomes: accumulator.vacantHomes,
    firstAttentionResidenceId: accumulator.firstAttentionResidenceId,
  };
}

export function computeSettlementWelfare(state: GameState): SettlementWelfare {
  const accumulator = createSettlementWelfareAccumulator();
  const disabledResidences = fireDisabledResidenceIds(state.fireIncidents.values());
  for (const residence of state.residences.values()) {
    accumulateResidenceWelfare(
      accumulator,
      residence,
      disabledResidences.has(residence.id),
    );
  }
  return finalizeSettlementWelfare(
    accumulator,
    state,
    fireDisabledBuildingIds(state.fireIncidents.values()),
  );
}

function updateWelfareAttention(
  accumulator: SettlementWelfareAccumulator,
  residenceId: string,
  rank: number,
): void {
  if (
    rank < accumulator.firstAttentionRank
    || (
      rank === accumulator.firstAttentionRank
      && (
        accumulator.firstAttentionResidenceId === null
        || compareStableEntityIds(residenceId, accumulator.firstAttentionResidenceId) < 0
      )
    )
  ) {
    accumulator.firstAttentionRank = rank;
    accumulator.firstAttentionResidenceId = residenceId;
  }
}

function ticksToDays(ticks: number | undefined): number {
  const safeTicks = Number.isFinite(ticks) ? Math.max(0, ticks ?? 0) : 0;
  return safeTicks * SIM_TICK_SECONDS / CALENDAR_SECONDS_PER_DAY;
}

function finiteCount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0;
}

function finiteAmount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function finiteUnit(value: number | undefined): number {
  return Math.min(1, finiteAmount(value));
}
