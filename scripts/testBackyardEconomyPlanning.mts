import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  CALENDAR_SECONDS_PER_DAY,
  HOUSEHOLD_MAX_WEALTH,
  SIM_TICK_SECONDS,
  TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER,
  type BackyardGardenKind,
} from '../src/generated/gameBalance.ts';
import {
  backyardGardenSeasonalMultiplier,
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
  };
}

function garden(
  id: string,
  residenceId: string,
  kind: BackyardGardenKind,
): BackyardGardenState {
  return { id, residenceId, kind };
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
  for (let day = 0; day < 180; day += 1) {
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
    'vegetable_garden',
    7,
    { season: 'summer', weather: 'drought' },
  ),
  0.55,
);
assert.equal(
  backyardGardenSeasonalMultiplier(
    'hen_yard',
    1,
    { season: 'winter', weather: 'frost' },
  ),
  0.75,
);

const september = nonSundayClockInMonth(9);
const westHome = residence('west-home', 0, 3, HOUSEHOLD_MAX_WEALTH);
const eastHome = residence('east-home', 100, 4);
const junctionHome = residence('junction-home', 50, 2);
const splitState = state({
  tick: september.simTick,
  buildings: [building('west-market', 'marketplace', 0)],
  residences: [westHome, eastHome, junctionHome],
  gardens: [
    garden('west-apples', westHome.id, 'apple_orchard'),
    garden('east-vegetables', eastHome.id, 'vegetable_garden'),
    garden('junction-hens', junctionHome.id, 'hen_yard'),
  ],
});
const components = new Map<string, number | readonly number[]>([
  ['west-market', 1],
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
  buildings: [building('unfinished-market', 'marketplace', 0, false)],
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
  buildings: [building('burned-market', 'marketplace', 0)],
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
    buildings: [building('garden-market', 'marketplace', 0)],
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
  buildings: [building('market', 'marketplace', 0)],
  residences: [residence('sabbath-home', 0)],
  gardens: [
    garden('sabbath-vegetables', 'sabbath-home', 'vegetable_garden'),
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
assert.ok(sabbath.horizonSelfFood > 0);
assert.ok(sabbath.horizonRoutedActivity > 0);

const dailyVegetable = backyardGardenEconomyPerDay(
  'vegetable_garden',
  4,
  0.2,
  { seasonalMultiplier: 1, hasMarketAccess: true },
);
const droughtVegetable = backyardGardenEconomyPerDay(
  'vegetable_garden',
  4,
  0.2,
  { seasonalMultiplier: 0.55, hasMarketAccess: true },
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
assert.match(rows, /Garden season/);
assert.match(rows, /Market-garden roads/);
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
assert.match(readout.gdpLabel, /gold today/);
assert.match(readout.taxIncomeLabel, /levied at markets/);
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
assert.equal(backyardView.statusText, 'Harvesting');
assert.match(backyardView.detailsHtml, /September harvest/);
assert.match(backyardView.detailsHtml, /Home food today/);
assert.match(backyardView.detailsHtml, /Market activity today/);
assert.match(backyardView.detailsHtml, /collection without a staffed clerk/);

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
}
for (let index = 0; index < 100_000; index += 1) {
  const home = residence(`home-${index}`, index % 200, 3);
  largeResidences.set(home.id, home);
  largeGardens.set(
    `garden-${index}`,
    garden(
      `garden-${index}`,
      home.id,
      index % 2 === 0 ? 'vegetable_garden' : 'hen_yard',
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
const serverHouseholdMarketOrdersSource = readFileSync(
  new URL('../server/src/simulation/household_market_orders.rs', import.meta.url),
  'utf8',
);
const serverMarketplaceTradeSource = readFileSync(
  new URL('../server/src/economy/marketplace_trade.rs', import.meta.url),
  'utf8',
);
assert.doesNotMatch(serverStepSource, /residence_has_marketplace_access/);
assert.doesNotMatch(
  serverStepSource,
  /credit_treasury_gold/,
  'garden tolls must not teleport from a household into the civic treasury',
);
assert.match(serverStepSource, /market_tolls_by_market/);
assert.match(serverStepSource, /marketplace_for_residence/);
assert.match(serverStepSource, /credit_marketplace_receipt_gold/);
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
assert.match(serverPolicySource, /AppleOrchard \| CherryOrchard/);
assert.match(serverPolicySource, /month == 9/);
assert.match(serverPolicySource, /base \* 0\.55/);
assert.match(serverTickContextSource, /marketplace_claims/);
assert.match(serverTickContextSource, /building_disabled_by_fire\(ctx, building\.id\)/);
assert.match(
  serverTickContextSource,
  /build_marketplace_claims[\s\S]*claim_residences_by_nearest_supplier/,
  'garden trade should use an exact nearest-market road territory cached once per owner',
);
assert.match(
  serverHouseholdMarketOrdersSource,
  /marketplace_for_residence/,
  'household emergency orders should share the cached nearest-market territory',
);
assert.doesNotMatch(
  serverHouseholdMarketOrdersSource,
  /claim_residences_by_nearest_supplier/,
  'household orders must not rebuild a territory already shared by the tick context',
);
assert.match(
  serverMarketplaceTradeSource,
  /credit_marketplace_receipt_gold[\s\S]*physical_trade_staging_enabled[\s\S]*deposit_building_commodity/,
  'new saves should place garden tolls in the same physical market lockbox as export receipts',
);

console.log(
  `Backyard seasonal economy and road-ledger checks passed `
    + `(${performanceMs.toFixed(1)}ms for 100k gardens / 200 branches).`,
);
