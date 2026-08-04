import {
  BACKYARD_GARDEN_DEFINITIONS,
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
  fireDisabledBuildingIds,
  fireDisabledResidenceIds,
} from '../fires/fireIncident.ts';
import {
  backyardGardenEconomyPerDay,
} from './villageProjections.ts';
import { residenceServiceState } from './residenceSatisfaction.ts';

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
  currentMarketFood: number;
  currentRoutedActivity: number;
  horizonMarketFood: number;
  horizonRoutedActivity: number;
};

export type SettlementBackyardEconomyPlan = {
  gardens: number;
  occupiedGardens: number;
  fireDisabledGardens: number;
  fireDisabledGardenResidents: number;
  seasonallyActiveGardens: number;
  producingTodayGardens: number;
  marketLinkedGardens: number;
  marketUnlinkedGardens: number;
  operationalMarketplaces: number;
  foodStallMarketplaces: number;
  goodsStallMarketplaces: number;
  unstaffedMarketplaces: number;
  fireDisabledMarketplaces: number;
  marketRoadBranches: number;
  occupiedGardenBranches: number;
  matchedGardenBranches: number;
  unservedGardenBranches: number;
  currentDaySelfFood: number;
  currentDayMarketFood: number;
  currentDayPotentialActivity: number;
  currentDayRoutedActivity: number;
  currentDayStrandedActivity: number;
  currentDayAssessedTax: number;
  currentDayCollectedTax: number;
  currentDayHouseholdIncome: number;
  currentDayStorableHouseholdIncome: number;
  wealthCappedGardens: number;
  servicePressuredGardens: number;
  currentDayServiceLostActivity: number;
  horizonSelfFood: number;
  horizonMarketFood: number;
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
    currentMarketFood: 0,
    currentRoutedActivity: 0,
    horizonMarketFood: 0,
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
  state: Pick<
    GameState,
    'seed' | 'buildings' | 'residences' | 'backyardGardens'
  > & Partial<Pick<GameState, 'fireIncidents'>>;
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
  const foodMarketComponents = new Set<string>();
  const goodsMarketComponents = new Set<string>();
  const granaryComponents = new Set<string>();
  const storehouseComponents = new Set<string>();
  let operationalMarketplaces = 0;
  let foodStallMarketplaces = 0;
  let goodsStallMarketplaces = 0;
  let unstaffedMarketplaces = 0;
  let fireDisabledMarketplaces = 0;
  const incidents = input.state.fireIncidents?.values() ?? [];
  const fireDisabledBuildings = fireDisabledBuildingIds(incidents);
  const fireDisabledResidences = fireDisabledResidenceIds(
    input.state.fireIncidents?.values() ?? [],
  );
  let hasStaffedGranary = false;
  let hasStaffedStorehouse = false;
  for (const building of input.state.buildings.values()) {
    if (
      building.constructionComplete === false
      || building.assignedLabor <= 0
      || fireDisabledBuildings.has(building.id)
    ) {
      continue;
    }
    const componentSet = building.kind === 'granary'
      ? granaryComponents
      : building.kind === 'village_storehouse'
        ? storehouseComponents
        : null;
    if (!componentSet) continue;
    if (building.kind === 'granary') hasStaffedGranary = true;
    if (building.kind === 'village_storehouse') hasStaffedStorehouse = true;
    if (!input.roadComponentFor) continue;
    for (const key of componentKeys(input.roadComponentFor(building))) {
      componentSet.add(key);
    }
  }
  for (const building of input.state.buildings.values()) {
    if (
      building.kind !== 'marketplace'
      || building.constructionComplete === false
    ) {
      continue;
    }
    if (fireDisabledBuildings.has(building.id)) {
      fireDisabledMarketplaces += 1;
      continue;
    }
    const keys = input.roadComponentFor
      ? componentKeys(input.roadComponentFor(building))
      : [];
    const hasFoodStall = input.roadComponentFor
      ? keys.some((key) => granaryComponents.has(key))
      : hasStaffedGranary;
    const hasGoodsStall = input.roadComponentFor
      ? keys.some((key) => storehouseComponents.has(key))
      : hasStaffedStorehouse;
    if (!hasFoodStall && !hasGoodsStall) {
      unstaffedMarketplaces += 1;
      continue;
    }
    operationalMarketplaces += 1;
    if (hasFoodStall) foodStallMarketplaces += 1;
    if (hasGoodsStall) goodsStallMarketplaces += 1;
    for (const key of keys) {
      marketComponents.add(key);
      if (hasFoodStall) foodMarketComponents.add(key);
      if (hasGoodsStall) goodsMarketComponents.add(key);
    }
  }

  let gardens = 0;
  let occupiedGardens = 0;
  let fireDisabledGardens = 0;
  let fireDisabledGardenResidents = 0;
  let seasonallyActiveGardens = 0;
  let producingTodayGardens = 0;
  let marketLinkedGardens = 0;
  let marketUnlinkedGardens = 0;
  let currentDaySelfFood = 0;
  let currentDayMarketFood = 0;
  let currentDayPotentialActivity = 0;
  let currentDayRoutedActivity = 0;
  let currentDayStrandedActivity = 0;
  let currentDayAssessedTax = 0;
  let currentDayCollectedTax = 0;
  let currentDayHouseholdIncome = 0;
  let currentDayStorableHouseholdIncome = 0;
  let wealthCappedGardens = 0;
  let servicePressuredGardens = 0;
  let currentDayServiceLostActivity = 0;
  let horizonSelfFood = 0;
  let horizonMarketFood = 0;
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
      || residence.population <= 0
    ) {
      continue;
    }
    if (fireDisabledResidences.has(residence.id)) {
      fireDisabledGardens += 1;
      fireDisabledGardenResidents += residence.population;
      continue;
    }
    occupiedGardens += 1;
    const service = residenceServiceState(residence);
    if (service.warning) servicePressuredGardens += 1;
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
    const requiresFoodStall = BACKYARD_GARDEN_DEFINITIONS[garden.kind]
      .foodPerPersonPerSec > 0;
    const eligibleMarketComponents = requiresFoodStall
      ? foodMarketComponents
      : goodsMarketComponents;
    const marketLinked = input.roadComponentFor
      ? keys.some((key) => eligibleMarketComponents.has(key))
      : requiresFoodStall
        ? foodStallMarketplaces > 0
        : goodsStallMarketplaces > 0;
    if (marketLinked) {
      marketLinkedGardens += 1;
      for (const key of keys) {
        if (eligibleMarketComponents.has(key)) matchedGardenBranches.add(key);
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
    const actualToday = backyardGardenEconomyPerDay(
          garden.kind,
          residence.population,
          input.taxRate,
          {
            seasonalMultiplier: currentMultiplier,
            hasMarketAccess: marketLinked,
            taxCollectionMultiplier: input.taxCollectionMultiplier,
            serviceMultiplier: service.economicMultiplier,
          },
        );
    currentDaySelfFood += actualToday.selfFood;
    currentDayMarketFood += actualToday.marketFood;
    currentDayPotentialActivity += potentialToday.activity;
    currentDayRoutedActivity += actualToday.activity;
    if (!marketLinked) currentDayStrandedActivity += potentialToday.activity;
    if (marketLinked) {
      currentDayServiceLostActivity += Math.max(
        0,
        potentialToday.activity - actualToday.activity,
      );
    }
    currentDayAssessedTax += actualToday.assessedTax;
    currentDayCollectedTax += actualToday.tax;
    currentDayHouseholdIncome += actualToday.net;
    const wealthRoom = Math.max(
      0,
      HOUSEHOLD_MAX_WEALTH - positive(residence.householdWealth),
    );
    currentDayStorableHouseholdIncome += Math.min(actualToday.net, wealthRoom);
    if (actualToday.net > wealthRoom + 0.05) wealthCappedGardens += 1;
    kindPlan.currentSelfFood += actualToday.selfFood;
    kindPlan.currentMarketFood += actualToday.marketFood;
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
    const actualHorizon = backyardGardenEconomyPerDay(
          garden.kind,
          residence.population,
          input.taxRate,
          {
            seasonalMultiplier: futureMultipliers[garden.kind],
            hasMarketAccess: marketLinked,
            taxCollectionMultiplier: input.taxCollectionMultiplier,
            serviceMultiplier: service.economicMultiplier,
          },
        );
    horizonSelfFood += actualHorizon.selfFood;
    horizonMarketFood += actualHorizon.marketFood;
    horizonPotentialActivity += potentialHorizon.activity;
    horizonRoutedActivity += actualHorizon.activity;
    if (!marketLinked) horizonStrandedActivity += potentialHorizon.activity;
    horizonCollectedTax += actualHorizon.tax;
    horizonHouseholdIncome += actualHorizon.net;
    kindPlan.horizonRoutedActivity += actualHorizon.activity;
    kindPlan.horizonMarketFood += actualHorizon.marketFood;

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
    fireDisabledGardens,
    fireDisabledGardenResidents,
    seasonallyActiveGardens,
    producingTodayGardens,
    marketLinkedGardens,
    marketUnlinkedGardens,
    operationalMarketplaces,
    foodStallMarketplaces,
    goodsStallMarketplaces,
    unstaffedMarketplaces,
    fireDisabledMarketplaces,
    marketRoadBranches: marketComponents.size,
    occupiedGardenBranches: occupiedGardenBranches.size,
    matchedGardenBranches: matchedGardenBranches.size,
    unservedGardenBranches: unservedGardenBranches.size,
    currentDaySelfFood,
    currentDayMarketFood,
    currentDayPotentialActivity,
    currentDayRoutedActivity,
    currentDayStrandedActivity,
    currentDayAssessedTax,
    currentDayCollectedTax,
    currentDayHouseholdIncome,
    currentDayStorableHouseholdIncome,
    wealthCappedGardens,
    servicePressuredGardens,
    currentDayServiceLostActivity,
    horizonSelfFood,
    horizonMarketFood,
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
