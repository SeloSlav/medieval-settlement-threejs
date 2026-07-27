import {
  BACKYARD_GARDEN_KINDS,
  CALENDAR_SECONDS_PER_DAY,
  HOUSEHOLD_MAX_WEALTH,
  SIM_TICK_SECONDS,
  type BackyardGardenKind,
} from '../generated/gameBalance.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import type {
  BuildingState,
  GameState,
  ResidenceState,
} from '../resources/types.ts';
import {
  gameClock,
  type GameClock,
} from '../world/gameCalendar.ts';
import {
  environmentFor,
  type EnvironmentState,
} from '../world/seasonPolicy.ts';
import {
  backyardGardenSeasonalMultiplier,
} from './backyardGardenTick.ts';
import {
  backyardGardenEconomyPerDay,
} from './villageProjections.ts';

export const BACKYARD_ECONOMY_HORIZON_DAYS = 120;

type BackyardRoadEntity = Pick<
  BuildingState | ResidenceState,
  'id' | 'x' | 'z'
>;

export type BackyardRoadComponentResolver = (
  entity: BackyardRoadEntity,
) => string | number | readonly (string | number)[] | null;

export type BackyardGardenKindPlan = {
  gardens: number;
  population: number;
  currentMultiplier: number;
  currentSelfFood: number;
  currentRoutedActivity: number;
  horizonRoutedActivity: number;
};

export type SettlementBackyardEconomyPlan = {
  gardens: number;
  occupiedGardens: number;
  seasonallyActiveGardens: number;
  producingTodayGardens: number;
  marketLinkedGardens: number;
  marketUnlinkedGardens: number;
  marketRoadBranches: number;
  occupiedGardenBranches: number;
  matchedGardenBranches: number;
  unservedGardenBranches: number;
  currentDaySelfFood: number;
  currentDayPotentialActivity: number;
  currentDayRoutedActivity: number;
  currentDayStrandedActivity: number;
  currentDayAssessedTax: number;
  currentDayCollectedTax: number;
  currentDayHouseholdIncome: number;
  currentDayStorableHouseholdIncome: number;
  wealthCappedGardens: number;
  horizonSelfFood: number;
  horizonPotentialActivity: number;
  horizonRoutedActivity: number;
  horizonStrandedActivity: number;
  horizonCollectedTax: number;
  horizonHouseholdIncome: number;
  firstUnlinkedResidenceId: string | null;
  firstUnlinkedHorizonActivity: number;
  currentSabbathPause: boolean;
  currentEnvironment: EnvironmentState;
  currentClock: GameClock;
  byKind: Readonly<Record<BackyardGardenKind, BackyardGardenKindPlan>>;
};

function positive(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function componentKeys(
  component: ReturnType<BackyardRoadComponentResolver>,
): string[] {
  if (component === null) return [];
  if (!Array.isArray(component)) {
    return [`${typeof component}:${String(component)}`];
  }
  return [
    ...new Set(
      component.map(
        (candidate) => `${typeof candidate}:${String(candidate)}`,
      ),
    ),
  ];
}

function emptyKindPlan(): BackyardGardenKindPlan {
  return {
    gardens: 0,
    population: 0,
    currentMultiplier: 0,
    currentSelfFood: 0,
    currentRoutedActivity: 0,
    horizonRoutedActivity: 0,
  };
}

function emptyKindPlans(): Record<BackyardGardenKind, BackyardGardenKindPlan> {
  return {
    apple_orchard: emptyKindPlan(),
    cherry_orchard: emptyKindPlan(),
    vegetable_garden: emptyKindPlan(),
    flower_garden: emptyKindPlan(),
    herb_garden: emptyKindPlan(),
    hen_yard: emptyKindPlan(),
  };
}

function multiplierByKind(
  clock: GameClock,
  environment: EnvironmentState,
  sabbathObserved: boolean,
): Record<BackyardGardenKind, number> {
  const paused = sabbathObserved && clock.isSunday;
  const multipliers = {} as Record<BackyardGardenKind, number>;
  for (const kind of BACKYARD_GARDEN_KINDS) {
    multipliers[kind] = paused
      ? 0
      : backyardGardenSeasonalMultiplier(kind, clock.month, environment);
  }
  return multipliers;
}

function horizonMultipliers(input: {
  seed: number;
  hydrology: number;
  clock: GameClock;
  sabbathObserved: boolean;
  days: number;
}): Record<BackyardGardenKind, number> {
  const totals = {} as Record<BackyardGardenKind, number>;
  for (const kind of BACKYARD_GARDEN_KINDS) totals[kind] = 0;
  const ticksPerDay = CALENDAR_SECONDS_PER_DAY / SIM_TICK_SECONDS;
  for (let day = 0; day < input.days; day += 1) {
    const dayClock = gameClock(input.clock.simTick + day * ticksPerDay);
    const environment = environmentFor(
      input.seed,
      input.hydrology,
      dayClock,
    );
    const multipliers = multiplierByKind(
      dayClock,
      environment,
      input.sabbathObserved,
    );
    for (const kind of BACKYARD_GARDEN_KINDS) {
      totals[kind] += multipliers[kind];
    }
  }
  return totals;
}

/**
 * Read-only household-plot forecast matching the authoritative workday,
 * seasonal weather, Sabbath, tax collection, and completed-market topology.
 *
 * Connectivity uses cached component ids, so the reduction is linear in
 * buildings, gardens, and residences and performs no route solves.
 */
export function computeSettlementBackyardEconomyPlan(input: {
  state: Pick<GameState, 'seed' | 'buildings' | 'residences' | 'backyardGardens'>;
  clock: GameClock;
  hydrology: number;
  taxRate: number;
  taxCollectionMultiplier: number;
  sabbathObserved: boolean;
  roadComponentFor?: BackyardRoadComponentResolver;
  horizonDays?: number;
}): SettlementBackyardEconomyPlan {
  const currentEnvironment = environmentFor(
    input.state.seed,
    input.hydrology,
    input.clock,
  );
  const currentSabbathPause = input.sabbathObserved && input.clock.isSunday;
  const currentMultipliers = multiplierByKind(
    input.clock,
    currentEnvironment,
    input.sabbathObserved,
  );
  const horizonDays = Math.max(
    1,
    Math.floor(input.horizonDays ?? BACKYARD_ECONOMY_HORIZON_DAYS),
  );
  const futureMultipliers = horizonMultipliers({
    seed: input.state.seed,
    hydrology: input.hydrology,
    clock: input.clock,
    sabbathObserved: input.sabbathObserved,
    days: horizonDays,
  });
  const byKind = emptyKindPlans();
  for (const kind of BACKYARD_GARDEN_KINDS) {
    byKind[kind].currentMultiplier = currentMultipliers[kind];
  }

  const marketComponents = new Set<string>();
  let completedMarkets = 0;
  for (const building of input.state.buildings.values()) {
    if (
      building.kind !== 'marketplace'
      || building.constructionComplete === false
    ) {
      continue;
    }
    completedMarkets += 1;
    if (!input.roadComponentFor) continue;
    for (const key of componentKeys(input.roadComponentFor(building))) {
      marketComponents.add(key);
    }
  }

  let gardens = 0;
  let occupiedGardens = 0;
  let seasonallyActiveGardens = 0;
  let producingTodayGardens = 0;
  let marketLinkedGardens = 0;
  let marketUnlinkedGardens = 0;
  let currentDaySelfFood = 0;
  let currentDayPotentialActivity = 0;
  let currentDayRoutedActivity = 0;
  let currentDayStrandedActivity = 0;
  let currentDayAssessedTax = 0;
  let currentDayCollectedTax = 0;
  let currentDayHouseholdIncome = 0;
  let currentDayStorableHouseholdIncome = 0;
  let wealthCappedGardens = 0;
  let horizonSelfFood = 0;
  let horizonPotentialActivity = 0;
  let horizonRoutedActivity = 0;
  let horizonStrandedActivity = 0;
  let horizonCollectedTax = 0;
  let horizonHouseholdIncome = 0;
  let firstUnlinkedResidenceId: string | null = null;
  let firstUnlinkedHorizonActivity = 0;
  const occupiedGardenBranches = new Set<string>();
  const matchedGardenBranches = new Set<string>();
  const unservedGardenBranches = new Set<string>();

  for (const garden of input.state.backyardGardens.values()) {
    gardens += 1;
    const residence = input.state.residences.get(garden.residenceId);
    if (
      !residence
      || residence.abandoned
      || residence.population <= 0
    ) {
      continue;
    }
    occupiedGardens += 1;
    const kindPlan = byKind[garden.kind];
    kindPlan.gardens += 1;
    kindPlan.population += residence.population;
    const rawCurrentMultiplier = backyardGardenSeasonalMultiplier(
      garden.kind,
      input.clock.month,
      currentEnvironment,
    );
    if (rawCurrentMultiplier > 1e-9) seasonallyActiveGardens += 1;
    const currentMultiplier = currentMultipliers[garden.kind];
    if (currentMultiplier > 1e-9) producingTodayGardens += 1;

    const keys = input.roadComponentFor
      ? componentKeys(input.roadComponentFor(residence))
      : [];
    for (const key of keys) occupiedGardenBranches.add(key);
    const marketLinked = input.roadComponentFor
      ? keys.some((key) => marketComponents.has(key))
      : completedMarkets > 0;
    if (marketLinked) {
      marketLinkedGardens += 1;
      for (const key of keys) {
        if (marketComponents.has(key)) matchedGardenBranches.add(key);
      }
    } else {
      marketUnlinkedGardens += 1;
      for (const key of keys) unservedGardenBranches.add(key);
    }

    const potentialToday = backyardGardenEconomyPerDay(
      garden.kind,
      residence.population,
      input.taxRate,
      {
        seasonalMultiplier: currentMultiplier,
        hasMarketAccess: true,
        taxCollectionMultiplier: input.taxCollectionMultiplier,
      },
    );
    const actualToday = marketLinked
      ? potentialToday
      : backyardGardenEconomyPerDay(
          garden.kind,
          residence.population,
          input.taxRate,
          {
            seasonalMultiplier: currentMultiplier,
            hasMarketAccess: false,
            taxCollectionMultiplier: input.taxCollectionMultiplier,
          },
        );
    currentDaySelfFood += potentialToday.selfFood;
    currentDayPotentialActivity += potentialToday.activity;
    currentDayRoutedActivity += actualToday.activity;
    currentDayStrandedActivity += Math.max(
      0,
      potentialToday.activity - actualToday.activity,
    );
    currentDayAssessedTax += actualToday.assessedTax;
    currentDayCollectedTax += actualToday.tax;
    currentDayHouseholdIncome += actualToday.net;
    const wealthRoom = Math.max(
      0,
      HOUSEHOLD_MAX_WEALTH - positive(residence.householdWealth),
    );
    currentDayStorableHouseholdIncome += Math.min(actualToday.net, wealthRoom);
    if (actualToday.net > wealthRoom + 0.05) wealthCappedGardens += 1;
    kindPlan.currentSelfFood += potentialToday.selfFood;
    kindPlan.currentRoutedActivity += actualToday.activity;

    const potentialHorizon = backyardGardenEconomyPerDay(
      garden.kind,
      residence.population,
      input.taxRate,
      {
        seasonalMultiplier: futureMultipliers[garden.kind],
        hasMarketAccess: true,
        taxCollectionMultiplier: input.taxCollectionMultiplier,
      },
    );
    const actualHorizon = marketLinked
      ? potentialHorizon
      : backyardGardenEconomyPerDay(
          garden.kind,
          residence.population,
          input.taxRate,
          {
            seasonalMultiplier: futureMultipliers[garden.kind],
            hasMarketAccess: false,
            taxCollectionMultiplier: input.taxCollectionMultiplier,
          },
        );
    horizonSelfFood += potentialHorizon.selfFood;
    horizonPotentialActivity += potentialHorizon.activity;
    horizonRoutedActivity += actualHorizon.activity;
    horizonStrandedActivity += Math.max(
      0,
      potentialHorizon.activity - actualHorizon.activity,
    );
    horizonCollectedTax += actualHorizon.tax;
    horizonHouseholdIncome += actualHorizon.net;
    kindPlan.horizonRoutedActivity += actualHorizon.activity;

    if (
      !marketLinked
      && (
        potentialHorizon.activity > firstUnlinkedHorizonActivity + 1e-9
        || (
          Math.abs(
            potentialHorizon.activity - firstUnlinkedHorizonActivity,
          ) <= 1e-9
          && (
            firstUnlinkedResidenceId === null
            || compareStableEntityIds(
              residence.id,
              firstUnlinkedResidenceId,
            ) < 0
          )
        )
      )
    ) {
      firstUnlinkedHorizonActivity = potentialHorizon.activity;
      firstUnlinkedResidenceId = residence.id;
    }
  }

  return {
    gardens,
    occupiedGardens,
    seasonallyActiveGardens,
    producingTodayGardens,
    marketLinkedGardens,
    marketUnlinkedGardens,
    marketRoadBranches: marketComponents.size,
    occupiedGardenBranches: occupiedGardenBranches.size,
    matchedGardenBranches: matchedGardenBranches.size,
    unservedGardenBranches: unservedGardenBranches.size,
    currentDaySelfFood,
    currentDayPotentialActivity,
    currentDayRoutedActivity,
    currentDayStrandedActivity,
    currentDayAssessedTax,
    currentDayCollectedTax,
    currentDayHouseholdIncome,
    currentDayStorableHouseholdIncome,
    wealthCappedGardens,
    horizonSelfFood,
    horizonPotentialActivity,
    horizonRoutedActivity,
    horizonStrandedActivity,
    horizonCollectedTax,
    horizonHouseholdIncome,
    firstUnlinkedResidenceId,
    firstUnlinkedHorizonActivity,
    currentSabbathPause,
    currentEnvironment,
    currentClock: input.clock,
    byKind,
  };
}
