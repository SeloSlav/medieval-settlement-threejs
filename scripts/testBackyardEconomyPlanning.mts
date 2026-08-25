import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  BACKYARD_GARDEN_KINDS,
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_MONTHS_PER_YEAR,
  CALENDAR_SECONDS_PER_DAY,
  HOUSEHOLD_MAX_WEALTH,
  SIM_TICK_SECONDS,
  TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER,
  type BackyardGardenKind,
} from '../src/generated/gameBalance.ts';
import {
  backyardGardenMarketChannel,
  backyardGardenMarketChannels,
  backyardGardenPhenology,
  backyardGardenSeasonalMultiplier,
  splitBackyardOrchardHarvest,
} from '../src/economy/backyardGardenTick.ts';
import {
  computeSettlementBackyardEconomyPlan,
} from '../src/economy/settlementBackyardEconomy.ts';
import {
  BACKYARD_WORKDAY_SECONDS,
  backyardGardenEconomyPerDay,
} from '../src/economy/villageProjections.ts';
import {
  buildVillageAdminReadout,
} from '../src/economy/villageAdminReadout.ts';
import { DEFAULT_PARISH_POLICY } from '../src/economy/chapelParish.ts';
import {
  renderSettlementBackyardEconomyRows,
} from '../src/resources/inspector/townHallRenderer.ts';
import { renderBackyardInspector } from '../src/resources/inspector/backyardRenderer.ts';
import type {
  BackyardGardenState,
  BuildingState,
  GameState,
  ResidenceState,
} from '../src/resources/types.ts';
import type { WorldQueries } from '../src/resources/WorldQueries.ts';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import type { DeliveryTripState } from '../src/logistics/deliveryTrips.ts';
import {
  gameClock,
  type GameClock,
} from '../src/world/gameCalendar.ts';

function residence(
  id: string,
  x: number,
  population = 4,
  householdWealth = 0,
): ResidenceState {
  return {
    id,
    zoneId: `zone-${id}`,
    parcelIndex: 0,
    x,
    z: 0,
    yaw: 0,
    population,
    populationCapacity: 5,
    tier: 1,
    settlementTicks: 0,
    needs: [],
    abandoned: false,
    householdWealth,
    food: 20,
  };
}

const conservedJamHarvest = splitBackyardOrchardHarvest(10, 4);
assert.deepEqual(conservedJamHarvest, { freshFruit: 6, jam: 4 });
assert.equal(conservedJamHarvest.freshFruit + conservedJamHarvest.jam, 10);
assert.deepEqual(splitBackyardOrchardHarvest(2, 8), { freshFruit: 0, jam: 2 });
assert.deepEqual(splitBackyardOrchardHarvest(Number.NaN, Number.POSITIVE_INFINITY), {
  freshFruit: 0,
  jam: 0,
});

function garden(
  id: string,
  residenceId: string,
  kind: BackyardGardenKind,
): BackyardGardenState {
  return {
    id,
    residenceId,
    kind,
    firstHarvestDay: 0,
    lastPrimaryProductionDay: 0,
    lastSecondaryProductionDay: 0,
    hideStock: 0,
    flowerLuxuryUpgraded: false,
  };
}

function building(
  id: string,
  kind: BuildingState['kind'],
  x: number,
  constructionComplete = true,
  assignedLabor = 0,
): BuildingState {
  return {
    id,
    kind,
    x,
    z: 0,
    constructionComplete,
    assignedLabor,
  } as BuildingState;
}

function state(input: {
  seed?: number;
  tick?: number;
  buildings?: BuildingState[];
  residences?: ResidenceState[];
  gardens?: BackyardGardenState[];
  fireDisabledBuildingIds?: string[];
  fireDisabledResidenceIds?: string[];
}): Pick<
  GameState,
  'seed' | 'tick' | 'buildings' | 'residences' | 'backyardGardens' | 'fireIncidents'
> {
  return {
    seed: input.seed ?? 77,
    tick: input.tick ?? 0,
    buildings: new Map(
      (input.buildings ?? []).map((candidate) => [candidate.id, candidate]),
    ),
    residences: new Map(
      (input.residences ?? []).map((candidate) => [candidate.id, candidate]),
    ),
    backyardGardens: new Map(
      (input.gardens ?? []).map((candidate) => [candidate.id, candidate]),
    ),
    fireIncidents: new Map(
      [
        ...(input.fireDisabledBuildingIds ?? []).map((targetId) => [
          `fire-building-${targetId}`,
          {
            id: `fire-building-${targetId}`,
            targetKind: 'building',
            targetId,
          },
        ] as const),
        ...(input.fireDisabledResidenceIds ?? []).map((targetId) => [
          `fire-residence-${targetId}`,
          {
            id: `fire-residence-${targetId}`,
            targetKind: 'residence',
            targetId,
          },
        ] as const),
      ].map(([id, incident]) => [
        id,
        incident as GameState['fireIncidents'] extends Map<string, infer Incident>
          ? Incident
          : never,
      ]),
    ),
  };
}

function nonSundayClockInMonth(month: number): GameClock {
  const ticksPerDay = CALENDAR_SECONDS_PER_DAY / SIM_TICK_SECONDS;
  for (
    let day = 0;
    day < CALENDAR_DAYS_PER_MONTH * CALENDAR_MONTHS_PER_YEAR;
    day += 1
  ) {
    const clock = gameClock(day * ticksPerDay);
    if (clock.month === month && !clock.isSunday) return clock;
  }
  throw new Error(`No non-Sunday clock found in month ${month}`);
}

assert.equal(
  BACKYARD_WORKDAY_SECONDS,
  CALENDAR_SECONDS_PER_DAY * 14 / 24,
  'daily garden forecasts must use the 06:00-20:00 workday',
);
assert.equal(BACKYARD_WORKDAY_SECONDS, 70);
assert.equal(
  backyardGardenSeasonalMultiplier(
    'apple_orchard',
    9,
    { season: 'autumn', weather: 'fair' },
  ),
  12,
);
assert.equal(
  backyardGardenSeasonalMultiplier(
    'apple_orchard',
    8,
    { season: 'summer', weather: 'drought' },
  ),
  0,
);
assert.equal(
  backyardGardenSeasonalMultiplier(
    'cabbage_garden',
    7,
    { season: 'summer', weather: 'drought' },
  ),
  0.6325,
);
assert.equal(
  backyardGardenSeasonalMultiplier(
    'chicken_pen',
    1,
    { season: 'winter', weather: 'frost' },
  ),
  0,
);
assert.equal(backyardGardenPhenology('vegetable_garden', 3).harvestable, false);
assert.equal(backyardGardenPhenology('vegetable_garden', 7).harvestable, false);
assert.equal(backyardGardenPhenology('carrot_garden', 6).harvestable, true);
assert.equal(backyardGardenPhenology('herb_garden', 1).growing, false);
assert.equal(backyardGardenPhenology('herb_garden', 1).harvestable, false);
assert.equal(backyardGardenMarketChannel('flower_garden'), null);
assert.equal(backyardGardenMarketChannel('herb_garden'), 'goods');
assert.deepEqual(backyardGardenMarketChannels('goat_pen'), ['food', 'goods']);
assert.deepEqual(backyardGardenMarketChannels('backyard_apiary'), ['food']);
assert.deepEqual(backyardGardenMarketChannels('flower_garden'), []);

const september = nonSundayClockInMonth(9);
const westHome = residence('west-home', 0, 3, HOUSEHOLD_MAX_WEALTH);
const eastHome = residence('east-home', 100, 4);
const junctionHome = residence('junction-home', 50, 2);
const splitState = state({
  tick: september.simTick,
  buildings: [
    building('west-market', 'marketplace', 0),
    building('west-granary', 'granary', 5, true, 1),
  ],
  residences: [westHome, eastHome, junctionHome],
  gardens: [
    garden('west-apples', westHome.id, 'apple_orchard'),
    garden('east-vegetables', eastHome.id, 'carrot_garden'),
    garden('junction-hens', junctionHome.id, 'chicken_pen'),
  ],
});
const components = new Map<string, number | readonly number[]>([
  ['west-market', 1],
  ['west-granary', 1],
  ['west-home', 1],
  ['east-home', 2],
  ['junction-home', [2, 1]],
]);
const split = computeSettlementBackyardEconomyPlan({
  state: splitState,
  clock: september,
  hydrology: 50,
  taxRate: 0.25,
  taxCollectionMultiplier: TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER,
  sabbathObserved: false,
  roadComponentFor: (candidate) => components.get(candidate.id) ?? null,
});
assert.equal(split.gardens, 3);
assert.equal(split.occupiedGardens, 3);
assert.equal(split.seasonallyActiveGardens, 3);
assert.equal(split.producingTodayGardens, 3);
assert.equal(split.marketLinkedGardens, 2);
assert.equal(split.marketUnlinkedGardens, 1);
assert.equal(split.marketRoadBranches, 1);
assert.equal(split.occupiedGardenBranches, 2);
assert.equal(split.matchedGardenBranches, 1);
assert.equal(split.unservedGardenBranches, 1);
assert.equal(split.firstUnlinkedResidenceId, eastHome.id);
assert.ok(split.currentDaySelfFood > 0);
assert.ok(split.currentDayMarketFood > 0);
assert.ok(split.currentDayRoutedActivity > 0);
assert.ok(split.currentDayStrandedActivity > 0);
assert.ok(split.horizonRoutedActivity > split.currentDayRoutedActivity);
assert.ok(split.horizonStrandedActivity > 0);
assert.equal(split.wealthCappedGardens, 1);
assert.ok(
  split.currentDayStorableHouseholdIncome
    < split.currentDayHouseholdIncome,
);

const fullyCollected = computeSettlementBackyardEconomyPlan({
  state: splitState,
  clock: september,
  hydrology: 50,
  taxRate: 0.25,
  taxCollectionMultiplier: 1,
  sabbathObserved: false,
  roadComponentFor: (candidate) => components.get(candidate.id) ?? null,
});
assert.ok(
  Math.abs(
    split.currentDayAssessedTax - fullyCollected.currentDayAssessedTax,
  ) < 1e-9,
);
assert.ok(
  Math.abs(
    split.currentDayCollectedTax
      - fullyCollected.currentDayCollectedTax
        * TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER,
  ) < 1e-9,
);
assert.ok(
  split.currentDayHouseholdIncome
    > fullyCollected.currentDayHouseholdIncome,
  'uncollected assessed tax remains household income, matching the server',
);

const reconnected = computeSettlementBackyardEconomyPlan({
  state: splitState,
  clock: september,
  hydrology: 50,
  taxRate: 0.25,
  taxCollectionMultiplier: 1,
  sabbathObserved: false,
  roadComponentFor: () => 1,
});
assert.equal(reconnected.marketLinkedGardens, 3);
assert.equal(reconnected.marketUnlinkedGardens, 0);
assert.equal(reconnected.currentDayStrandedActivity, 0);
assert.equal(reconnected.horizonStrandedActivity, 0);

const unfinishedMarketState = state({
  tick: september.simTick,
  buildings: [
    building('unfinished-market', 'marketplace', 0, false),
    building('unfinished-market-granary', 'granary', 2, true, 1),
  ],
  residences: [westHome],
  gardens: [garden('west-apples', westHome.id, 'apple_orchard')],
});
const unfinished = computeSettlementBackyardEconomyPlan({
  state: unfinishedMarketState,
  clock: september,
  hydrology: 50,
  taxRate: 0.25,
  taxCollectionMultiplier: 1,
  sabbathObserved: false,
  roadComponentFor: () => 1,
});
assert.equal(unfinished.marketLinkedGardens, 0);
assert.equal(unfinished.currentDayRoutedActivity, 0);
assert.ok(unfinished.currentDaySelfFood > 0);

const burnedMarketState = state({
  tick: september.simTick,
  buildings: [
    building('burned-market', 'marketplace', 0),
    building('burned-market-granary', 'granary', 2, true, 1),
  ],
  residences: [westHome],
  gardens: [garden('burned-market-apples', westHome.id, 'apple_orchard')],
  fireDisabledBuildingIds: ['burned-market'],
});
const burnedMarket = computeSettlementBackyardEconomyPlan({
  state: burnedMarketState,
  clock: september,
  hydrology: 50,
  taxRate: 0.25,
  taxCollectionMultiplier: 1,
  sabbathObserved: false,
  roadComponentFor: () => 1,
});
assert.equal(burnedMarket.operationalMarketplaces, 0);
assert.equal(burnedMarket.fireDisabledMarketplaces, 1);
assert.equal(burnedMarket.marketLinkedGardens, 0);
assert.equal(burnedMarket.marketUnlinkedGardens, 1);
assert.equal(burnedMarket.currentDayRoutedActivity, 0);
assert.match(
  renderSettlementBackyardEconomyRows(burnedMarket),
  /1 market fire-disabled/,
);
const burnedMarketWithoutTopology = computeSettlementBackyardEconomyPlan({
  state: burnedMarketState,
  clock: september,
  hydrology: 50,
  taxRate: 0.25,
  taxCollectionMultiplier: 1,
  sabbathObserved: false,
});
assert.equal(
  burnedMarketWithoutTopology.marketLinkedGardens,
  0,
  'the no-topology fallback must require an operational market too',
);

const burnedGardenHome = residence('burned-garden-home', 0);
const burnedGarden = computeSettlementBackyardEconomyPlan({
  state: state({
    tick: september.simTick,
    buildings: [
      building('garden-market', 'marketplace', 0),
      building('garden-market-granary', 'granary', 2, true, 1),
    ],
    residences: [burnedGardenHome],
    gardens: [garden('burned-home-apples', burnedGardenHome.id, 'apple_orchard')],
    fireDisabledResidenceIds: [burnedGardenHome.id],
  }),
  clock: september,
  hydrology: 50,
  taxRate: 0.25,
  taxCollectionMultiplier: 1,
  sabbathObserved: false,
  roadComponentFor: () => 1,
});
assert.equal(burnedGarden.gardens, 1);
assert.equal(burnedGarden.occupiedGardens, 0);
assert.equal(burnedGarden.fireDisabledGardens, 1);
assert.equal(burnedGarden.fireDisabledGardenResidents, 4);
assert.equal(burnedGarden.currentDaySelfFood, 0);
assert.equal(burnedGarden.currentDayRoutedActivity, 0);
assert.equal(burnedGarden.horizonRoutedActivity, 0);
assert.match(
  renderSettlementBackyardEconomyRows(burnedGarden),
  /1 plot is suspended by residence fire damage/,
);

const sunday = gameClock(0);
assert.equal(sunday.isSunday, true);
const sabbathState = state({
  tick: sunday.simTick,
  buildings: [
    building('market', 'marketplace', 0),
    building('market-granary', 'granary', 2, true, 1),
  ],
  residences: [residence('sabbath-home', 0)],
  gardens: [
    garden('sabbath-hens', 'sabbath-home', 'chicken_pen'),
  ],
});
const sabbath = computeSettlementBackyardEconomyPlan({
  state: sabbathState,
  clock: sunday,
  hydrology: 50,
  taxRate: 0.2,
  taxCollectionMultiplier: 1,
  sabbathObserved: true,
  roadComponentFor: () => 1,
});
assert.equal(sabbath.currentSabbathPause, true);
assert.equal(sabbath.seasonallyActiveGardens, 1);
assert.equal(sabbath.producingTodayGardens, 0);
assert.equal(sabbath.currentDaySelfFood, 0);
assert.equal(sabbath.currentDayRoutedActivity, 0);
assert.equal(
  sabbath.horizonSelfFood,
  0,
  'a pantry already above its tier reserve should not retain forecast output',
);
assert.ok(sabbath.horizonMarketFood > 0);
assert.ok(sabbath.horizonRoutedActivity > 0);

const unstaffedMarket = computeSettlementBackyardEconomyPlan({
  state: state({
    tick: september.simTick,
    buildings: [building('empty-market', 'marketplace', 0)],
    residences: [westHome],
    gardens: [garden('unstalled-apples', westHome.id, 'apple_orchard')],
  }),
  clock: september,
  hydrology: 50,
  taxRate: 0.25,
  taxCollectionMultiplier: 1,
  sabbathObserved: false,
  roadComponentFor: () => 1,
});
assert.equal(unstaffedMarket.unstaffedMarketplaces, 1);
assert.equal(unstaffedMarket.marketLinkedGardens, 0);
assert.equal(unstaffedMarket.currentDayMarketFood, 0);
assert.ok(
  unstaffedMarket.currentDaySelfFood > split.byKind.apple_orchard.currentSelfFood,
  'an edible plot must keep its full crop when no granary worker runs a food stall',
);

const goodsStallState = state({
  tick: september.simTick,
  buildings: [
    building('goods-market', 'marketplace', 0),
    building('goods-storehouse', 'village_storehouse', 2, true, 1),
  ],
  residences: [westHome],
  gardens: [garden('market-flowers', westHome.id, 'flower_garden')],
});
const goodsStall = computeSettlementBackyardEconomyPlan({
  state: goodsStallState,
  clock: september,
  hydrology: 50,
  taxRate: 0.25,
  taxCollectionMultiplier: 1,
  sabbathObserved: false,
  roadComponentFor: () => 1,
});
assert.equal(goodsStall.goodsStallMarketplaces, 1);
assert.equal(goodsStall.foodStallMarketplaces, 0);
assert.equal(goodsStall.marketLinkedGardens, 1);
assert.equal(
  goodsStall.currentDayRoutedActivity,
  0,
  'flower gardens support attraction and bee forage instead of passive taxable sales',
);

const dailyVegetable = backyardGardenEconomyPerDay(
  'carrot_garden',
  4,
  0.2,
  { seasonalMultiplier: 1, hasMarketAccess: true, tier: 1, currentFoodStock: 20 },
);
const droughtVegetable = backyardGardenEconomyPerDay(
  'carrot_garden',
  4,
  0.2,
  { seasonalMultiplier: 0.55, hasMarketAccess: true, tier: 1, currentFoodStock: 20 },
);
assert.ok(
  Math.abs(
    droughtVegetable.activity - dailyVegetable.activity * 0.55,
  ) < 1e-9,
);
assert.ok(
  Math.abs(
    droughtVegetable.selfFood - dailyVegetable.selfFood * 0.55,
  ) < 1e-9,
);

const rows = renderSettlementBackyardEconomyRows(split);
assert.match(rows, /Backyard food sharing/);
assert.match(rows, /Backyard stall coverage/);
assert.match(rows, /next 120 days/);
assert.match(rows, /data-inspect-residence="east-home"/);

const fakeQueries = {
  getRoadComponentIds: (x: number) => x < 75 ? [1] : [2],
  getServingChapelForResidence: () => null,
} as unknown as WorldQueries;
const readout = buildVillageAdminReadout({
  gameState: {
    ...splitState,
    stockpile: {},
  } as GameState,
  worldQueries: fakeQueries,
  worldHydrology: 50,
  taxRate: 0.25,
  parishPolicy: DEFAULT_PARISH_POLICY,
});
assert.ok(readout.backyardEconomy);
assert.match(readout.gdpLabel, /gold local trade today/);
assert.match(readout.taxIncomeLabel, /market lockboxes/);
const scalarReadout = buildVillageAdminReadout({
  gameState: {
    ...splitState,
    stockpile: {},
  } as GameState,
  worldQueries: {
    getRoadComponentId: (x: number) => x < 75 ? 1 : 2,
    getServingChapelForResidence: () => null,
  } as unknown as WorldQueries,
  worldHydrology: 50,
  taxRate: 0.25,
  parishPolicy: DEFAULT_PARISH_POLICY,
});
assert.equal(scalarReadout.backyardEconomy?.marketLinkedGardens, 2);

const backyardView = renderBackyardInspector(
  {
    kind: 'backyard',
    residence: westHome,
    zone: { plotCount: 1 },
    garden: garden('west-apples', westHome.id, 'apple_orchard'),
  } as Parameters<typeof renderBackyardInspector>[0],
  {
    gameState: splitState as GameState,
    worldQueries: {
      isResidenceConnectedToMarketplace: () => true,
    } as unknown as WorldQueries,
    worldHydrology: 50,
    resourceTotals: {},
    getEconomicActivityTaxRate: () => 0.25,
    getParishPolicy: () => DEFAULT_PARISH_POLICY,
  } as Parameters<typeof renderBackyardInspector>[1],
);
assert.equal(backyardView.statusText, 'Harvestable — household collection active');
assert.match(backyardView.detailsHtml, /Harvestable now during September/);
assert.match(backyardView.detailsHtml, /Harvest window/);
assert.match(backyardView.detailsHtml, /No assigned labor slot/);
assert.match(backyardView.detailsHtml, /claims no extra Marketplace table or depot worker/);
assert.match(backyardView.detailsHtml, /Home food today/);
assert.match(backyardView.detailsHtml, /Shared market food today/);
assert.match(backyardView.detailsHtml, /Local trade value today/);
assert.match(backyardView.detailsHtml, /collection without a staffed clerk/);
assert.doesNotMatch(backyardView.detailsHtml, /<span>Parcel<\/span>/);
assert.doesNotMatch(backyardView.detailsHtml, /Household services/);
assert.doesNotMatch(backyardView.detailsHtml, /Sustained shortages/);

const emptyBackyardView = renderBackyardInspector(
  {
    kind: 'backyard',
    residence: westHome,
    zone: {
      id: westHome.zoneId,
      cornerA: { x: -16, z: 0 },
      cornerB: { x: 16, z: 0 },
      cornerC: { x: 16, z: 24 },
      cornerD: { x: -16, z: 24 },
      frontageEdge: 0,
      plotCount: 4,
    },
    garden: null,
  } as Parameters<typeof renderBackyardInspector>[0],
  {
    gameState: {
      ...state({ residences: [westHome] }),
      deliveryTrips: new Map(),
    } as GameState,
    worldQueries: {} as WorldQueries,
    worldHydrology: 50,
    resourceTotals: { timber: 381, stone: 12, gold: 24 },
    getEconomicActivityTaxRate: () => 0.25,
    getParishPolicy: () => DEFAULT_PARISH_POLICY,
  } as Parameters<typeof renderBackyardInspector>[1],
);
assert.doesNotMatch(emptyBackyardView.detailsHtml, /<span>Parcel<\/span>/);
assert.doesNotMatch(emptyBackyardView.detailsHtml, /<span>Available timber<\/span>/);
assert.match(emptyBackyardView.detailsHtml, /<span>Population<\/span>/);

const backyardProjectHome: ResidenceState = {
  ...westHome,
  backyardProjectKind: BACKYARD_GARDEN_KINDS.indexOf('vegetable_garden') + 1,
  upgradeProgress: 0.42,
  upgradeRequiredTimber: 6,
  upgradeRequiredStone: 2,
  upgradeDeliveredTimber: 3,
  upgradeDeliveredStone: 1,
  upgradeReservedTimber: 2,
  upgradeReservedStone: 1,
  upgradeAssignedLabor: 1,
  upgradePriority: 3,
};
const backyardTimberCart: DeliveryTripState = {
  id: 'backyard-timber-cart',
  buildingId: 'stockyard',
  residenceId: backyardProjectHome.id,
  destinationKind: 'residence',
  targetBuildingId: null,
  cargoKind: 'timber',
  amount: 5,
  phase: 'outbound',
  x: 0,
  z: 0,
  progress: 0.2,
  speedMps: 1,
  unloadSeconds: 1,
  unloadRemaining: 1,
  deliveryWorkers: 1,
  freeHaulerWorkers: 1,
  pathDistance: 10,
  travelSpeedMultiplier: 1,
  routePolylineJson: '',
};
const backyardProjectView = renderBackyardInspector(
  {
    kind: 'backyard',
    residence: backyardProjectHome,
    zone: { plotCount: 1 },
    garden: null,
  } as Parameters<typeof renderBackyardInspector>[0],
  {
    gameState: {
      ...state({ residences: [backyardProjectHome] }),
      deliveryTrips: new Map([[backyardTimberCart.id, backyardTimberCart]]),
    } as GameState,
    worldQueries: {
      isResidenceConnectedToMarketplace: () => true,
    } as unknown as WorldQueries,
    worldHydrology: 50,
    resourceTotals: {},
    getEconomicActivityTaxRate: () => 0.25,
    getParishPolicy: () => DEFAULT_PARISH_POLICY,
  } as Parameters<typeof renderBackyardInspector>[1],
);
assert.equal(backyardProjectView.eyebrow, 'Backyard worksite');
assert.equal(backyardProjectView.title, 'Vegetable garden works');
assert.match(backyardProjectView.detailsHtml, /42%/);
assert.match(backyardProjectView.detailsHtml, /Begins only after the worksite is complete/);
assert.doesNotMatch(backyardProjectView.detailsHtml, /<span>Parcel<\/span>/);
assert.doesNotMatch(backyardProjectView.detailsHtml, /Incoming haul/);
assert.doesNotMatch(backyardProjectView.detailsHtml, /data-inspect-delivery-trip/);
assert.doesNotMatch(backyardProjectView.detailsHtml, /Inspect cart/);
assert.match(backyardProjectView.supplementalPanelHtml ?? '', /data-residence-upgrade-priority="3"/);
assert.match(backyardProjectView.supplementalPanelHtml ?? '', /class="resource-action-row"/);
assert.match(backyardProjectView.supplementalPanelHtml ?? '', /class="resource-action-button" data-residence-upgrade-priority="3" disabled/);
assert.equal(backyardProjectView.demolish.label, 'Cancel backyard works');

const touchNetwork = new RoadNetwork();
touchNetwork.restore({
  nextNodeId: 5,
  nextEdgeId: 3,
  nodes: [
    { id: 'left-south', position: [-5, 0, 0] },
    { id: 'left-north', position: [-5, 0, 20] },
    { id: 'right-south', position: [5, 0, 0] },
    { id: 'right-north', position: [5, 0, 20] },
  ],
  edges: [
    {
      id: 'left',
      startNodeId: 'left-south',
      endNodeId: 'left-north',
      width: 4,
      controlPoints: [[-5, 0, 0], [-5, 0, 20]],
      sampledPath: [[-5, 0, 0], [-5, 0, 20]],
      length: 20,
      revision: 1,
    },
    {
      id: 'right',
      startNodeId: 'right-south',
      endNodeId: 'right-north',
      width: 4,
      controlPoints: [[5, 0, 0], [5, 0, 20]],
      sampledPath: [[5, 0, 0], [5, 0, 20]],
      length: 20,
      revision: 1,
    },
  ],
});
const touchingComponents = touchNetwork
  .getPathfinder()
  .roadComponentsAt(0, 10);
assert.equal(touchingComponents.length, 2);
assert.equal(
  touchNetwork.getPathfinder().roadComponentAt(0, 10),
  touchingComponents[0],
  'the legacy scalar accessor remains deterministic',
);

const largeResidences = new Map<string, ResidenceState>();
const largeGardens = new Map<string, BackyardGardenState>();
const largeBuildings = new Map<string, BuildingState>();
const largeFireIncidents: GameState['fireIncidents'] = new Map();
for (let branch = 0; branch < 200; branch += 1) {
  const market = building(
    `market-${branch}`,
    'marketplace',
    branch,
  );
  largeBuildings.set(market.id, market);
  const granary = building(
    `granary-${branch}`,
    'granary',
    branch,
    true,
    1,
  );
  largeBuildings.set(granary.id, granary);
}
for (let index = 0; index < 100_000; index += 1) {
  const home = residence(`home-${index}`, index % 200, 3);
  largeResidences.set(home.id, home);
  largeGardens.set(
    `garden-${index}`,
    garden(
      `garden-${index}`,
      home.id,
      index % 2 === 0 ? 'carrot_garden' : 'chicken_pen',
    ),
  );
  if (index % 4 === 0) {
    largeFireIncidents.set(`home-fire-${index}`, {
      id: `home-fire-${index}`,
      targetKind: 'residence',
      targetId: home.id,
    } as GameState['fireIncidents'] extends Map<string, infer Incident>
      ? Incident
      : never);
  }
}
const performanceStart = performance.now();
const largePlan = computeSettlementBackyardEconomyPlan({
  state: {
    seed: 9,
    buildings: largeBuildings,
    residences: largeResidences,
    backyardGardens: largeGardens,
    fireIncidents: largeFireIncidents,
  },
  clock: nonSundayClockInMonth(5),
  hydrology: 50,
  taxRate: 0.2,
  taxCollectionMultiplier: 1,
  sabbathObserved: false,
  roadComponentFor: (candidate) => Math.round(candidate.x),
});
const performanceMs = performance.now() - performanceStart;
assert.equal(largePlan.occupiedGardens, 75_000);
assert.equal(largePlan.fireDisabledGardens, 25_000);
assert.equal(largePlan.marketLinkedGardens, 75_000);
assert.equal(largePlan.occupiedGardenBranches, 150);
assert.equal(largePlan.matchedGardenBranches, 150);
assert.ok(
  performanceMs < 1_500,
  `100k gardens across 200 branches should remain linear (${performanceMs.toFixed(1)}ms)`,
);

const serverStepSource = readFileSync(
  new URL('../server/src/simulation/backyard_garden.rs', import.meta.url),
  'utf8',
);
const serverPolicySource = readFileSync(
  new URL('../server/src/backyard_garden_policy.rs', import.meta.url),
  'utf8',
);
const serverTickContextSource = readFileSync(
  new URL('../server/src/simulation/tick_context.rs', import.meta.url),
  'utf8',
);
const serverMarketplaceTradeSource = readFileSync(
  new URL('../server/src/economy/marketplace_trade.rs', import.meta.url),
  'utf8',
);
const serverMarketplaceCaravanSource = readFileSync(
  new URL('../server/src/simulation/marketplace_caravan.rs', import.meta.url),
  'utf8',
);
const serverDeliveryTripsSource = readFileSync(
  new URL('../server/src/simulation/delivery_trips.rs', import.meta.url),
  'utf8',
);
const serverBackyardReducerSource = readFileSync(
  new URL('../server/src/reducers/backyards.rs', import.meta.url),
  'utf8',
);
const serverResidenceProjectsSource = readFileSync(
  new URL('../server/src/simulation/residence_upgrades.rs', import.meta.url),
  'utf8',
);
const backyardInspectorSource = readFileSync(
  new URL('../src/resources/inspector/backyardRenderer.ts', import.meta.url),
  'utf8',
);
assert.doesNotMatch(serverStepSource, /residence_has_marketplace_access/);
assert.doesNotMatch(
  serverStepSource,
  /credit_treasury_gold/,
  'garden tolls must not teleport from a household into the civic treasury',
);
assert.match(serverStepSource, /market_tolls_by_market/);
assert.match(serverStepSource, /local_marketplace_for_residence/);
assert.match(serverStepSource, /credit_marketplace_receipt_gold/);
assert.match(serverStepSource, /fn backyard_has_food_output/);
assert.match(serverStepSource, /fn backyard_has_goods_output/);
assert.match(serverStepSource, /HerbGarden \| BackyardGardenKind::GoatPen/);
assert.match(
  serverStepSource,
  /food_marketplace_id[\s\S]*ResidenceNeedKind::Food[\s\S]*goods_marketplace_id[\s\S]*ResidenceNeedKind::Cloth/,
  'each backyard output class must resolve its responsible depot and stall independently',
);
assert.match(serverStepSource, /CommodityKind::Remedies/);
assert.match(
  serverStepSource,
  /fn deposit_backyard_depot_commodity[\s\S]*marketplace_stall_workplace_id_for_deposit[\s\S]*storage_accepts_commodity[\s\S]*deposit_building_commodity\(&mut depot/,
  'backyard goods must enter the Granary or Storehouse that owns the staffed stall before reaching the square',
);
assert.doesNotMatch(
  serverStepSource,
  /deposit_building_commodity\(&mut marketplace/,
  'backyard production must never write commodity stock directly into a Marketplace',
);
assert.match(
  serverStepSource,
  /market_tolls\.sort_by_key[\s\S]*for \(marketplace_id, toll\) in market_tolls/,
  'tax receipts should aggregate and update each serving market once in stable order',
);
assert.match(serverStepSource, /residence_disabled_by_fire\(ctx, residence\.id\)/);
assert.match(
  serverStepSource,
  /backyard_garden_seasonal_multiplier\(kind, clock\.month, environment\)/,
);
assert.match(serverStepSource, /garden\.first_harvest_day > clock\.total_days/);
assert.match(
  serverStepSource,
  /gross_fruit[\s\S]*jam_target[\s\S]*split_backyard_orchard_harvest[\s\S]*backyard_jam_commodity[\s\S]*orchard_harvest\.jam/,
  'jam must consume a bounded share of the same physical fruit harvest',
);
assert.match(serverStepSource, /AroniaOrchard => Some\(CommodityKind::AroniaJam\)/);
assert.match(serverStepSource, /RosehipOrchard => Some\(CommodityKind::RosehipJam\)/);
assert.match(serverPolicySource, /AppleOrchard \| CherryOrchard \| PearOrchard/);
assert.match(serverPolicySource, /def\.harvest_start_month[\s\S]*def\.harvest_end_month/);
assert.match(serverPolicySource, /12\.0 \/ window \* def\.yield_efficiency/);
assert.match(serverPolicySource, /AroniaOrchard => 0\.75/);
assert.match(serverPolicySource, /RosehipOrchard => 0\.85/);
assert.match(serverTickContextSource, /marketplace_claims/);
assert.match(serverTickContextSource, /building_disabled_by_fire\(ctx, building\.id\)/);
assert.match(
  serverTickContextSource,
  /build_local_marketplace_claims[\s\S]*marketplace_has_stall_workers[\s\S]*claim_residences_by_nearest_supplier/,
  'garden trade should use a cached nearest market territory backed by the correct depot stall',
);
assert.match(
  serverMarketplaceTradeSource,
  /credit_marketplace_receipt_gold[\s\S]*physical_trade_staging_enabled[\s\S]*deposit_building_commodity/,
  'new saves should place garden tolls in the same physical market lockbox as export receipts',
);
assert.match(
  serverMarketplaceCaravanSource,
  /try_dispatch_marketplace_remedies[\s\S]*try_start_market_stall_remedy_trip/,
  'storehouse-run goods stalls must physically share backyard herb remedies with sick homes',
);
assert.match(
  serverMarketplaceCaravanSource,
  /let unpledged_gold = \(building\.gold - private_export_proceeds\(&building\)\)[\s\S]*let collectible_gold = if is_trading_post[\s\S]*unpledged_gold[\s\S]*try_dispatch_marketplace_proceeds/,
  'local tax must remain in the Marketplace lockbox until its treasury cart launches',
);
assert.match(
  serverMarketplaceCaravanSource,
  /fn try_dispatch_marketplace_proceeds[\s\S]*try_start_free_building_supply_trip[\s\S]*if started \{[\s\S]*mark_local_civic_receipts_dispatched/,
  'a Marketplace must retire public receipts only after its physical treasury cart starts',
);
assert.match(
  serverDeliveryTripsSource,
  /try_start_market_stall_remedy_trip[\s\S]*DeliveryLaborSource::Building\(stall_workplace_id\)[\s\S]*TripDestination::ResidenceRemedy/,
  'market remedy deliveries must reserve an actual storehouse stall worker',
);
assert.match(
  serverBackyardReducerSource,
  /if physical_economy[\s\S]*ensure_upgrade_source_route[\s\S]*backyard_project_kind = def\.kind as u8[\s\S]*upgrade_reserved_timber = cost\.timber[\s\S]*return Ok\(\(\)\)[\s\S]*spend_aggregate_timber/,
  'physical backyard placement must queue reachable carted materials while legacy saves retain instant spending',
);
assert.match(
  serverResidenceProjectsSource,
  /backyard_project_kind[\s\S]*BackyardGardenKind::from_id[\s\S]*backyard_garden\(\)\.insert/,
  'garden production must not exist before household builders finish the physical worksite',
);
assert.match(
  serverBackyardReducerSource,
  /demolish_backyard_garden[\s\S]*backyard_project_kind != 0[\s\S]*cancel_trips_for_residence[\s\S]*clear_residence_project/,
  'canceling backyard works must return cart cargo and release its household builder',
);
assert.match(
  serverBackyardReducerSource,
  /specialize_orchard[\s\S]*specialization_of == Some\("orchard"\)[\s\S]*first_harvest_day/,
  'a completed generic orchard must be explicitly specialized before its maturity clock begins',
);
assert.match(
  serverBackyardReducerSource,
  /specialize_animal_pen[\s\S]*specialization_of == Some\("animal_pen"\)[\s\S]*first_harvest_day/,
  'a completed generic animal pen must be explicitly stocked before its maturity clock begins',
);
assert.match(serverStepSource, /backyard_interval_harvest_due/);
assert.match(serverStepSource, /last_primary_production_day/);
assert.match(backyardInspectorSource, /Backyard worksite/);
assert.match(backyardInspectorSource, /Production[\s\S]*Begins only after the worksite is complete/);
assert.match(backyardInspectorSource, /data-residence-upgrade-priority/);
assert.match(backyardInspectorSource, /Cancel backyard works/);

console.log(
  `Backyard seasonal economy and road-ledger checks passed `
    + `(${performanceMs.toFixed(1)}ms for 100k gardens / 200 branches).`,
);
