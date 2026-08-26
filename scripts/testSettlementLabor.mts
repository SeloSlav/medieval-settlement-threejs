import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  BUILDING_DEFINITIONS,
  CONSTRUCTION_MAX_BUILDERS,
  type BuildingKind,
} from '../src/generated/gameBalance.ts';
import {
  EMPTY_CART_SPEED_MULTIPLIER,
  type DeliveryTripState,
} from '../src/logistics/deliveryTrips.ts';
import { computeSettlementLaborPlan } from '../src/economy/settlementLabor.ts';
import { computeSettlementHaulagePlan } from '../src/economy/settlementHaulage.ts';
import { renderTownHallInspector } from '../src/resources/inspector/townHallRenderer.ts';
import { buildingLaborView } from '../src/resources/inspector/buildingCommon.ts';
import {
  computeInTransitResourceTotals,
  computePopulationStats,
  computeResourceTotals,
  maxAssignableLabor,
} from '../src/resources/resourceTotals.ts';
import {
  createEmptyStockpile,
  type BuildingState,
  type GameState,
} from '../src/resources/types.ts';
import type { WorldQueries } from '../src/resources/WorldQueries.ts';

const buildings = new Map<string, BuildingState>();
buildings.set('1', building('1', 'well', 0));
buildings.set('4', building('4', 'lumber_mill', 2));
buildings.set('10', building('10', 'guardhouse', 0));
buildings.set('2', building('2', 'marketplace', 0));
buildings.set('6', building('6', 'chapel', 1));
buildings.set('7', building('7', 'town_hall', 0));
buildings.set('8', building('8', 'monastery', 0));
buildings.set('20', building('20', 'granary', 3, false, 2));
buildings.set('21', building('21', 'smokehouse', 0, false, 0));

const trips = new Map<string, DeliveryTripState>([
  ['trip-a', { ...trip('trip-a', '1', 1), freeHaulerWorkers: 1 }],
  ['trip-b', trip('trip-b', '2', 2)],
]);

const plan = computeSettlementLaborPlan({
  state: { buildings, deliveryTrips: trips },
  population: { total: 10 },
  vacantHousingSlots: 5,
  excludeNavigationBuildingId: '7',
});

const permanentCapacity = [
  'well',
  'lumber_mill',
  'guardhouse',
  'marketplace',
  'chapel',
  'town_hall',
  'monastery',
] satisfies BuildingKind[];
assert.equal(
  BUILDING_DEFINITIONS.monastery.maxLabor,
  8,
  'the completed Monastery fixture must contribute its eight legitimate permanent posts',
);
const expectedCapacity = permanentCapacity.reduce(
  (sum, kind) => sum + BUILDING_DEFINITIONS[kind].maxLabor,
  0,
);
assert.equal(plan.permanentAssigned, 3);
assert.equal(plan.permanentCapacity, expectedCapacity);
assert.equal(plan.openPermanentPosts, expectedCapacity - 3);
assert.equal(plan.unstaffedWorksites, 3);
assert.equal(plan.firstUnstaffedBuildingId, '8');
assert.equal(plan.sectors.provisions.assigned, 0);
assert.equal(plan.sectors.provisions.capacity, BUILDING_DEFINITIONS.well.maxLabor);
assert.equal(plan.sectors.materials.assigned, 2);
assert.equal(plan.sectors.logistics.unstaffedWorksites, 0);
assert.equal(plan.sectors.defense.unstaffedWorksites, 1);
assert.equal(plan.sectors.civic.unstaffedWorksites, 2);
assert.equal(plan.constructionAssigned, 3);
assert.equal(plan.constructionCapacity, CONSTRUCTION_MAX_BUILDERS);
assert.equal(plan.activeConstructionSites, 1);
assert.equal(plan.heldConstructionSites, 1);
assert.equal(plan.activeCartTrips, 2);
assert.equal(plan.cartCrewWorkers, 3);
assert.equal(plan.populationAtFullHousing, 15);
assert.equal(
  plan.futurePermanentPostShortfall,
  Math.max(0, expectedCapacity - 15),
);
assert.equal(
  plan.futureFreeLaborAfterFullStaffing,
  Math.max(0, 15 - expectedCapacity),
);

const haulageTrips = new Map<string, DeliveryTripState>([
  ['10', haulageTrip('10', 'firewood', 'outbound', 300, 1, 8, 100, 1, 30, 30)],
  ['2', haulageTrip('2', 'timber', 'inbound', 300, 1, 0, 250, 1, 20, 0)],
  ['3', haulageTrip('3', 'food', 'unloading', 120, 2, 4, 120, 1, 60, 15)],
  ['4', haulageTrip('4', 'food', 'inbound', 120, 1, 0, 20, 1, 20, 0)],
  ['5', {
    ...haulageTrip('5', 'water', 'outbound', 50, 1, 2, 0, 0, 10, 10),
    destinationKind: 'fire',
  }],
]);
const haulage = computeSettlementHaulagePlan(haulageTrips.values());
assert.equal(haulage.activeTrips, 5);
assert.equal(haulage.deliveryWorkers, 6);
assert.equal(haulage.freeHaulerWorkers, 0);
assert.equal(haulage.outboundTrips, 2);
assert.equal(haulage.unloadingTrips, 1);
assert.equal(haulage.returningTrips, 2);
assert.equal(haulage.loadedTrips, 3);
assert.equal(haulage.emergencyTrips, 1);
assert.equal(haulage.cargoInTransit, 14);
assert.equal(haulage.cargoTrips.food, 2);
assert.equal(haulage.cargoInTransitByKind.food, 4);
assert.equal(haulage.busiestCargoKind, 'food');
assert.equal(haulage.busiestCargoTrips, 2);
assert.equal(haulage.measuredTrips, 5);
assert.equal(haulage.unresolvedTrips, 1);
assert.equal(haulage.totalOneWayDistance, 890);
assert.equal(haulage.averageOneWayDistance, 178);
const loadedFirewoodSeconds = 200 + 30 + 300;
const emptyTimberReturnSeconds = 50 / EMPTY_CART_SPEED_MULTIPLIER;
const twoWorkerFoodUnloadSeconds = 15 + 120 / 2;
const emptyFoodReturnSeconds = 100 / EMPTY_CART_SPEED_MULTIPLIER;
assert.equal(
  haulage.totalRemainingTripSeconds,
  loadedFirewoodSeconds
    + emptyTimberReturnSeconds
    + twoWorkerFoodUnloadSeconds
    + emptyFoodReturnSeconds,
);
assert.equal(
  haulage.totalRemainingWorkerSeconds,
  loadedFirewoodSeconds
    + emptyTimberReturnSeconds
    + twoWorkerFoodUnloadSeconds * 2
    + emptyFoodReturnSeconds,
);
assert.equal(haulage.longestRoute?.tripId, '2');
assert.equal(haulage.longestRoute?.remainingSeconds, emptyTimberReturnSeconds);
const inTransit = computeInTransitResourceTotals(haulageTrips.values());
assert.equal(inTransit.firewood, 8);
assert.equal(inTransit.food, 4);
assert.equal(inTransit.water, 2);
assert.equal(inTransit.timber, 0, 'an empty returning cart should not report cargo');
assert.equal(
  inTransit.timber + inTransit.firewood + inTransit.water + inTransit.food,
  haulage.cargoInTransit,
  'aggregate food plus non-food cargo rows must account for every loaded physical cart exactly once',
);

const laborSurplus = computeSettlementLaborPlan({
  state: { buildings: new Map([['1', building('1', 'well', 0)]]), deliveryTrips: new Map() },
  population: { total: 10 },
  vacantHousingSlots: 4,
});
assert.equal(
  laborSurplus.futureFreeLaborAfterFullStaffing,
  14 - BUILDING_DEFINITIONS.well.maxLabor,
);
assert.equal(laborSurplus.futurePermanentPostShortfall, 0);

const renderedTownHall = building('hall', 'town_hall', 1);
const renderedWell = building('well', 'well', 0);
const renderedMarket = building('market', 'marketplace', 0);
const renderedState: GameState = {
  seed: 1,
  tick: 0,
  stockpile: createEmptyStockpile(),
  quarries: new Map(),
  foragingNodes: new Map(),
  trees: new Map(),
  buildings: new Map([
    [renderedTownHall.id, renderedTownHall],
    [renderedWell.id, renderedWell],
    [renderedMarket.id, renderedMarket],
  ]),
  farmFields: new Map(),
  pastures: new Map(),
  livestockHerds: new Map(),
  burgageZones: new Map(),
  residences: new Map(),
  backyardGardens: new Map(),
  deliveryTrips: new Map(),
  stableOxen: new Map(),
  fireIncidents: new Map(),
  nextBuildingId: 4,
};
const renderedPopulation = computePopulationStats(renderedState);
const renderedPlan = computeSettlementLaborPlan({
  state: renderedState,
  population: renderedPopulation,
  vacantHousingSlots: 0,
  excludeNavigationBuildingId: renderedTownHall.id,
});
const renderedQueries = {
  getBuildingLabel: (kind: BuildingKind) => BUILDING_DEFINITIONS[kind].label,
  getRoadAccessLabel: () => 'Connected',
  getRoadPathDistance: () => null,
  isResidenceConnectedToMarketplace: () => false,
  getServingChapelForResidence: () => null,
  isMonasteryLinkedToChapel: () => false,
  findNearestRoadLinkedBuilding: () => null,
  getActiveDeliveryTrip: (building: BuildingState) => (
    [...renderedState.deliveryTrips.values()]
      .find((tripState) => tripState.buildingId === building.id) ?? null
  ),
} as unknown as WorldQueries;
const renderedInspector = renderTownHallInspector(
  {
    kind: 'building',
    building: renderedTownHall,
    matureTrees: 0,
    stumpTrees: 0,
    growingTrees: 0,
  },
  {
    gameState: renderedState,
    worldQueries: renderedQueries,
    populationStats: renderedPopulation,
    resourceTotals: computeResourceTotals(renderedState),
    worldHydrology: 0.5,
  },
);
assert.ok(renderedInspector.detailsHtml.includes(
  `${renderedPopulation.assigned} / ${renderedPopulation.total} explicitly rostered · ${renderedPopulation.available} workplace-ready reserve · ${renderedPopulation.idle} currently idle · ${renderedPlan.openPermanentPosts} open permanent posts`,
));
assert.ok(renderedInspector.detailsHtml.includes(
  `At full housing labor</span><span>${renderedPlan.populationAtFullHousing} people`,
));
assert.doesNotMatch(
  renderedInspector.detailsHtml,
  /data-inspect-building="market"/,
  'an unstaffed Marketplace square must never appear as a vacant labor worksite',
);
assert.match(renderedInspector.detailsHtml, /No active building sites · no carts traveling/);
assert.doesNotMatch(renderedInspector.detailsHtml, /Staffing priorit/);
assert.doesNotMatch(renderedInspector.supplementalPanelHtml ?? '', /data-staffing-priority/);
assert.match(renderedInspector.detailsHtml, /Haulage network<\/span><span>No active cart runs/);

renderedState.deliveryTrips.set(
  'route',
  {
    ...haulageTrip('route', 'firewood', 'outbound', 420, 1, 8, 20, 1, 30, 30),
    buildingId: renderedWell.id,
    targetBuildingId: renderedMarket.id,
    freeHaulerWorkers: 1,
  },
);
const activePopulation = computePopulationStats(renderedState);
assert.equal(activePopulation.cartAssigned, 1);
assert.equal(activePopulation.assigned, renderedPopulation.assigned);
assert.equal(activePopulation.flexibleAssigned, renderedPopulation.flexibleAssigned + 1);
assert.equal(activePopulation.available, renderedPopulation.available);
assert.equal(activePopulation.idle, renderedPopulation.idle - 1);
assert.equal(
  maxAssignableLabor(
    building('reserve-workplace', 'lumber_mill', 0),
    {
      total: 5,
      assigned: 1,
      flexibleAssigned: 4,
      cartAssigned: 1,
      sick: 0,
      available: 4,
      idle: 0,
      housingCapacity: 0,
      housed: 0,
      vacant: 0,
    },
  ),
  BUILDING_DEFINITIONS.lumber_mill.maxLabor,
  'temporary reserve tasks must not disable explicit workplace assignment',
);
assert.equal(
  maxAssignableLabor(
    building('reserve-construction', 'lumber_mill', 0, false),
    {
      total: 5,
      assigned: 1,
      flexibleAssigned: 4,
      cartAssigned: 1,
      sick: 0,
      available: 4,
      idle: 0,
      housingCapacity: 0,
      housed: 0,
      vacant: 0,
    },
  ),
  0,
  'temporary construction still needs an actually idle reserve worker',
);
const activeCartLabor = buildingLaborView(
  renderedWell,
  activePopulation,
  renderedQueries,
);
assert.equal(activeCartLabor.visible, false, 'wells must not expose worker assignment controls');
const renderedStorehouse = building('storehouse', 'village_storehouse', 1);
const rosterBackedCartLabor = buildingLaborView(
  renderedStorehouse,
  renderedPopulation,
  {
    getActiveDeliveryTrip: () => ({
      ...renderedState.deliveryTrips.get('route')!,
      laborBuildingId: renderedStorehouse.id,
      freeHaulerWorkers: 0,
    }),
  } as unknown as WorldQueries,
);
assert.equal(
  rosterBackedCartLabor.maxCount,
  BUILDING_DEFINITIONS.village_storehouse.maxLabor,
  'building labor cards must expose their staffing limit for the visible assigned / capacity counter',
);
assert.match(rosterBackedCartLabor.hint, /1 rostered worker is away, leaving 0 on site/);
assert.match(rosterBackedCartLabor.hint, /Only the on-site crew performs this building's role until return/);
const activeHaulageInspector = renderTownHallInspector(
  {
    kind: 'building',
    building: renderedTownHall,
    matureTrees: 0,
    stumpTrees: 0,
    growingTrees: 0,
  },
  {
    gameState: renderedState,
    worldQueries: renderedQueries,
    populationStats: activePopulation,
    resourceTotals: computeResourceTotals(renderedState),
    worldHydrology: 0.5,
  },
);
assert.match(activeHaulageInspector.detailsHtml, /Haulage posture/);
assert.match(activeHaulageInspector.detailsHtml, /1 reserved outside building rosters/);
assert.match(activeHaulageInspector.detailsHtml, /1 on flexible tasks, including 1 on carts/);
assert.match(activeHaulageInspector.detailsHtml, /Road commitment/);
assert.match(activeHaulageInspector.detailsHtml, /Longest active haul/);
assert.match(activeHaulageInspector.detailsHtml, /data-inspect-delivery-trip="route"/);

const perfBuildings = new Map<string, BuildingState>();
for (let index = 0; index < 100_000; index += 1) {
  const kind: BuildingKind = index % 5 === 0
    ? 'well'
    : index % 5 === 1
      ? 'lumber_mill'
      : index % 5 === 2
        ? 'marketplace'
        : index % 5 === 3
          ? 'chapel'
          : 'guardhouse';
  perfBuildings.set(String(index), building(String(index), kind, index % 2));
}
const perfTrips = new Map<string, DeliveryTripState>();
for (let index = 0; index < 100_000; index += 1) {
  perfTrips.set(
    String(index),
    haulageTrip(String(index), 'food', 'outbound', 100, 1, 1, 0, 1, 10, 10),
  );
}
const started = performance.now();
const perfPlan = computeSettlementLaborPlan({
  state: { buildings: perfBuildings, deliveryTrips: perfTrips },
  population: { total: 100_000 },
  vacantHousingSlots: 20_000,
});
const elapsedMs = performance.now() - started;
const cargoStarted = performance.now();
const perfCargo = computeInTransitResourceTotals(perfTrips.values());
const cargoElapsedMs = performance.now() - cargoStarted;
assert.equal(perfPlan.sectors.provisions.worksites, 0);
assert.equal(perfPlan.sectors.materials.worksites, 20_000);
assert.equal(
  perfPlan.sectors.logistics.worksites,
  0,
  'Marketplace squares have no labor posts; depot workers own their stalls',
);
assert.equal(perfPlan.sectors.civic.worksites, 20_000);
assert.equal(perfPlan.sectors.defense.worksites, 20_000);
assert.equal(perfPlan.haulage.activeTrips, 100_000);
assert.equal(perfPlan.haulage.loadedTrips, 100_000);
assert.equal(perfPlan.haulage.cargoInTransit, 100_000);
assert.equal(perfCargo.food, 100_000);
assert.equal(perfPlan.haulage.longestRoute?.tripId, '0');
assert.ok(elapsedMs < 250, `100,000-building workforce plan took ${elapsedMs.toFixed(1)} ms`);
assert.ok(
  cargoElapsedMs < 100,
  `100,000-cart HUD cargo ledger took ${cargoElapsedMs.toFixed(1)} ms`,
);

const townHallInspector = readFileSync(
  new URL('../src/resources/inspector/townHallRenderer.ts', import.meta.url),
  'utf8',
);
const settlementHud = readFileSync(
  new URL('../src/ui/SettlementHud.ts', import.meta.url),
  'utf8',
);
const resourceInspector = readFileSync(
  new URL('../src/resources/ResourceInspector.ts', import.meta.url),
  'utf8',
);
const hudResourceCards = readFileSync(
  new URL('../src/ui/hudResourceCards.ts', import.meta.url),
  'utf8',
);
const villagerInspector = readFileSync(
  new URL('../src/ui/VillagerInspector.ts', import.meta.url),
  'utf8',
);
const appBootstrap = readFileSync(
  new URL('../src/app/appBootstrap.ts', import.meta.url),
  'utf8',
);
assert.match(townHallInspector, /Workforce/);
assert.match(townHallInspector, /Sector staffing/);
assert.match(townHallInspector, /Dawn labor review/);
assert.match(townHallInspector, /Automatic labor reserve/);
assert.match(townHallInspector, /data-policy-seasonal-labor-steward/);
assert.match(townHallInspector, /data-policy-production-labor-steward/);
assert.match(townHallInspector, /data-policy-construction-labor-steward/);
assert.match(townHallInspector, /At full housing labor/);
assert.match(townHallInspector, /Work in motion/);
assert.match(townHallInspector, /Haulage posture/);
assert.match(townHallInspector, /data-inspect-delivery-trip/);
assert.match(townHallInspector, /data-inspect-building/);
const laborHudIndex = settlementHud.indexOf('data-resource="labor"');
const populationHudIndex = settlementHud.indexOf('data-resource="population"');
const housingHudIndex = settlementHud.indexOf('data-resource="housing"');
const timberHudIndex = settlementHud.indexOf('data-resource="timber"');
assert.ok(
  laborHudIndex >= 0
    && laborHudIndex < populationHudIndex
    && populationHudIndex < housingHudIndex
    && housingHudIndex < timberHudIndex,
  'the HUD should lead with free workers, total population, and living space',
);
assert.match(settlementHud, /data-people-card="labor"/);
assert.match(settlementHud, /Individual workforce/);
assert.match(settlementHud, /data-resident-card/);
assert.match(settlementHud, /Resident ledger/);
assert.doesNotMatch(
  settlementHud,
  /data-resource="population"[^>]*data-tooltip/,
  'the resident summary must use its anchored ledger card instead of the global tooltip',
);
assert.match(settlementHud, /data-people-card="housing"/);
assert.match(settlementHud, /Homes &amp; migration/);
assert.match(settlementHud, /data-stockpile="housing">0<\/strong>/);
assert.doesNotMatch(settlementHud, /data-stockpile="housing-sub"/);
assert.match(
  resourceInspector,
  /const displayedOpenLivingPlaces = starterCampCreated \? population\.vacant : 0;[\s\S]*this\.housingValue\.textContent = displayedOpenLivingPlaces\.toString\(\)/,
  'the HUD must hide pre-founding population noise, then show authoritative open living places',
);
assert.match(settlementHud, /data-stockpile-transit="timber"/);
assert.match(
  hudResourceCards,
  /Loaded carts remain listed separately until unloading/,
  'the totals-mode resource card must keep in-transit cargo separate from physically stored stock',
);
assert.match(resourceInspector, /closest<HTMLElement>\('\[data-inspect-delivery-trip\]'\)/);
assert.match(
  resourceInspector,
  /`\$\{view\.labor\.count\} \/ \$\{view\.labor\.maxCount\}`/,
  'the visible building labor counter must render assigned labor with its denominator',
);
assert.match(resourceInspector, /en route/);
assert.match(resourceInspector, /awaiting collection/);
assert.match(villagerInspector, /selectDeliveryTrip\(tripId: string\): boolean/);
assert.match(appBootstrap, /onInspectDeliveryTrip: \(tripId\)/);

console.log(`settlement workforce and haulage plan tests passed (${elapsedMs.toFixed(1)} ms for 100,000 buildings + 100,000 trips; ${cargoElapsedMs.toFixed(1)} ms cargo ledger)`);

function building(
  id: string,
  kind: BuildingKind,
  assignedLabor: number,
  constructionComplete = true,
  constructionPriority = 2,
): BuildingState {
  return {
    id,
    kind,
    x: 0,
    z: 0,
    workRadius: 0,
    actionCooldown: 0,
    timber: 0,
    firewood: 0,
    stone: 0,
    water: 0,
    food: 0,
    grain: 0,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    wool: 0,
    cloth: 0,
    ironwork: 0,
    polearms: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor,
    constructionComplete,
    constructionProgress: 0,
    constructionRequiredTimber: 0,
    constructionRequiredStone: 0,
    constructionDeliveredTimber: 0,
    constructionDeliveredStone: 0,
    constructionReservedTimber: 0,
    constructionReservedStone: 0,
    constructionTreasuryTimber: 0,
    constructionTreasuryStone: 0,
    storehouseAcceptsTimber: false,
    storehouseAcceptsStone: false,
    storehouseAcceptsFirewood: false,
    constructionPriority,
  };
}

function trip(id: string, buildingId: string, deliveryWorkers: number): DeliveryTripState {
  return {
    id,
    buildingId,
    residenceId: null,
    destinationKind: 'building',
    targetBuildingId: 'target',
    cargoKind: 'food',
    amount: 1,
    phase: 'outbound',
    x: 0,
    z: 0,
    progress: 0,
    speedMps: 1,
    unloadSeconds: 1,
    unloadRemaining: 1,
    deliveryWorkers,
    freeHaulerWorkers: 0,
    pathDistance: 1,
    travelSpeedMultiplier: 1,
    routePolylineJson: '[]',
  };
}

function haulageTrip(
  id: string,
  cargoKind: DeliveryTripState['cargoKind'],
  phase: DeliveryTripState['phase'],
  pathDistance: number,
  deliveryWorkers: number,
  amount: number,
  progress: number,
  speedMps: number,
  unloadSeconds: number,
  unloadRemaining: number,
): DeliveryTripState {
  return {
    ...trip(id, 'origin', deliveryWorkers),
    cargoKind,
    phase,
    pathDistance,
    amount,
    progress,
    speedMps,
    unloadSeconds,
    unloadRemaining,
  };
}
