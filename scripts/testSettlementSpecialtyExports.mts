import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  computeSettlementSpecialtyExportPlan,
} from '../src/economy/settlementSpecialtyExports.ts';
import type { FireIncidentState } from '../src/fires/fireIncident.ts';
import type { DeliveryTripState } from '../src/logistics/deliveryTrips.ts';
import {
  renderSettlementSpecialtyExportRows,
} from '../src/resources/inspector/townHallRenderer.ts';
import type {
  BuildingKind,
  BuildingState,
} from '../src/resources/types.ts';

function building(
  id: string,
  kind: BuildingKind,
  x: number,
  partial: Partial<BuildingState> = {},
): BuildingState {
  return {
    id,
    kind,
    x,
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
    assignedLabor: 0,
    constructionComplete: true,
    constructionProgress: 1,
    constructionRequiredTimber: 0,
    constructionRequiredStone: 0,
    constructionDeliveredTimber: 0,
    constructionDeliveredStone: 0,
    constructionReservedTimber: 0,
    constructionReservedStone: 0,
    constructionTreasuryTimber: 0,
    constructionTreasuryStone: 0,
    storehouseAcceptsTimber: true,
    storehouseAcceptsStone: true,
    storehouseAcceptsFirewood: true,
    marketplaceSpecialtyExportPolicy: 0,
    ...partial,
  };
}

function trip(
  id: string,
  sourceId: string,
  cargoKind: DeliveryTripState['cargoKind'],
  amount: number,
  targetBuildingId: string | null,
  phase: DeliveryTripState['phase'] = 'outbound',
): DeliveryTripState {
  return {
    id,
    buildingId: sourceId,
    residenceId: null,
    destinationKind: targetBuildingId === null ? 'residence' : 'building',
    targetBuildingId,
    cargoKind,
    amount,
    phase,
    x: 0,
    z: 0,
    progress: 1,
    speedMps: 1,
    unloadSeconds: 1,
    unloadRemaining: 1,
    deliveryWorkers: 1,
    freeHaulerWorkers: 0,
    pathDistance: 100,
    travelSpeedMultiplier: 1,
    routePolylineJson: '[]',
  };
}

const buildings = new Map<string, BuildingState>();
const trips = new Map<string, DeliveryTripState>();
const westMarket = building('west-market', 'marketplace', 0, {
  assignedLabor: 2,
  actionCooldown: 5,
  ale: 4,
});
const westOverflowMarket = building('west-overflow-market', 'marketplace', 10, {
  assignedLabor: 1,
});
const westBrewery = building('west-brewery', 'brewery', 0, {
  assignedLabor: 1,
  ale: 10,
});
const westApiary = building('west-apiary', 'apiary', 0, {
  assignedLabor: 0,
  honey: 5,
});
const westVineyard = building('west-vineyard', 'vineyard', 0, {
  assignedLabor: 1,
  wine: 4,
});
const westWeaver = building('west-weaver', 'weaver', 0, {
  assignedLabor: 1,
  cloth: 2,
});
const remoteVineyard = building('remote-vineyard', 'vineyard', 100, {
  assignedLabor: 1,
  wine: 8,
});
const fullHoneyMarket = building('full-honey-market', 'marketplace', 200, {
  assignedLabor: 1,
  honey: 100,
});
const blockedApiary = building('blocked-apiary', 'apiary', 200, {
  assignedLabor: 1,
  honey: 9,
});
for (const candidate of [
  westMarket,
  westOverflowMarket,
  westBrewery,
  westApiary,
  westVineyard,
  westWeaver,
  remoteVineyard,
  fullHoneyMarket,
  blockedApiary,
]) {
  buildings.set(candidate.id, candidate);
}
trips.set(
  'cloth-cart',
  trip('cloth-cart', westWeaver.id, 'cloth', 3, westMarket.id),
);
trips.set(
  'returning-wine-cart',
  trip(
    'returning-wine-cart',
    westVineyard.id,
    'wine',
    99,
    westMarket.id,
    'inbound',
  ),
);

const split = computeSettlementSpecialtyExportPlan({
  state: { buildings, deliveryTrips: trips },
  marketRate: 1,
  roadComponentFor: (candidate) =>
    candidate.x < 50 ? 1 : candidate.x < 150 ? 2 : 3,
});
assert.equal(split.producers, 6);
assert.equal(split.staffedProducers, 5);
assert.equal(split.markets, 3);
assert.equal(split.completedMarkets, 3);
assert.equal(split.roadLinkedMarkets, 3);
assert.equal(split.staffedMarkets, 3);
assert.equal(split.operationalMarkets, 3);
assert.equal(split.activeBrokerMarkets, 3);
assert.equal(split.producerStock, 38);
assert.equal(split.dispatchReadyProducerStock, 10);
assert.equal(split.busyProducerStock, 6);
assert.equal(split.laborBlockedProducerStock, 5);
assert.equal(split.roadStrandedProducerStock, 8);
assert.equal(split.storageBlockedProducerStock, 9);
assert.equal(split.receivingBlockedProducerStock, 0);
assert.equal(split.marketQueueUnits, 104);
assert.equal(split.inTransitToMarkets, 3);
assert.equal(split.projectedMarketQueueUnits, 107);
assert.equal(split.activeMarketQueueUnits, 107);
assert.equal(split.blockedMarketQueueUnits, 0);
assert.equal(split.exportWorkers, 3);
assert.ok(Math.abs(split.exportRatePerSecond - 1.35) < 1e-9);
assert.equal(split.commodities.cloth.producerStock, 2);
assert.equal(split.commodities.cloth.inTransitToMarkets, 3);
assert.equal(split.commodities.cloth.projectedMarketQueue, 3);
assert.equal(split.commodities.cloth.projectedMarketValue, 4.5);
assert.equal(split.roadPlan?.activeBranches, 3);
assert.equal(split.roadPlan?.producerBranches, 3);
assert.equal(split.roadPlan?.marketBranches, 2);
assert.equal(split.roadPlan?.matchedBranches, 2);
assert.equal(split.roadPlan?.staffedBrokerBranches, 2);
assert.equal(split.roadPlan?.activeBrokerBranches, 2);
assert.equal(split.roadPlan?.exposedProducerBranches, 2);
assert.equal(split.roadPlan?.roadMatchedProducerStock, 30);
assert.equal(split.roadPlan?.roadStrandedProducerStock, 8);
assert.equal(split.roadPlan?.brokerCoveredProducerStock, 30);
assert.equal(split.firstAttentionBuildingId, remoteVineyard.id);
assert.equal(split.firstAttentionKind, 'producer-road');
assert.equal(split.slowestActiveMarketId, fullHoneyMarket.id);
assert.ok(
  Math.abs((split.slowestActiveMarketClearSeconds ?? 0) - 100 / 0.45) < 1e-9,
);

const splitRows = renderSettlementSpecialtyExportRows(split);
assert.match(splitRows, /Specialty pipeline/);
assert.match(splitRows, /10\.0 at sources with labor, a free cart, receiving room, and a market route/);
assert.match(splitRows, /2 \/ 3 producer branches reach a completed market/);
assert.match(splitRows, /8\.0 stranded by topology/);
assert.match(splitRows, /9\.0 behind full destination stores/);
assert.match(splitRows, /3 \/ 3 completed markets actively selling/);
assert.match(splitRows, /data-inspect-building="remote-vineyard"/);

const reconnected = computeSettlementSpecialtyExportPlan({
  state: { buildings, deliveryTrips: trips },
  marketRate: 1,
  roadComponentFor: () => 1,
});
assert.equal(reconnected.roadStrandedProducerStock, 0);
assert.equal(reconnected.storageBlockedProducerStock, 0);
assert.equal(reconnected.dispatchReadyProducerStock, 27);
assert.equal(reconnected.roadPlan?.activeBranches, 1);
assert.equal(reconnected.roadPlan?.matchedBranches, 1);
assert.equal(reconnected.roadPlan?.roadMatchedProducerStock, 38);
assert.equal(reconnected.firstAttentionBuildingId, westApiary.id);
assert.equal(reconnected.firstAttentionKind, 'producer-labor');

const receivingMarket = building('receiving-market', 'marketplace', 0, {
  assignedLabor: 1,
});
const receivingBrewery = building('receiving-brewery', 'brewery', 0, {
  assignedLabor: 1,
  ale: 6,
});
const receivingTrips = new Map<string, DeliveryTripState>([
  [
    'grain-cart',
    trip('grain-cart', 'farm', 'grain', 4, receivingMarket.id),
  ],
]);
const receiving = computeSettlementSpecialtyExportPlan({
  state: {
    buildings: new Map([
      [receivingMarket.id, receivingMarket],
      [receivingBrewery.id, receivingBrewery],
    ]),
    deliveryTrips: receivingTrips,
  },
  marketRate: 1,
  roadComponentFor: () => 1,
});
assert.equal(receiving.receivingBlockedProducerStock, 6);
assert.equal(receiving.dispatchReadyProducerStock, 0);
assert.equal(receiving.firstAttentionKind, 'producer-receiving');
receivingTrips.set(
  'grain-cart',
  trip(
    'grain-cart',
    'farm',
    'grain',
    4,
    receivingMarket.id,
    'inbound',
  ),
);
assert.equal(
  computeSettlementSpecialtyExportPlan({
    state: {
      buildings: new Map([
        [receivingMarket.id, receivingMarket],
        [receivingBrewery.id, receivingBrewery],
      ]),
      deliveryTrips: receivingTrips,
    },
    marketRate: 1,
    roadComponentFor: () => 1,
  }).dispatchReadyProducerStock,
  6,
);

const unstaffedReceivingMarket = building(
  'unstaffed-receiving-market',
  'marketplace',
  0,
  { assignedLabor: 0 },
);
const routedApiary = building('routed-apiary', 'apiary', 0, {
  assignedLabor: 1,
  honey: 4,
});
const unstaffedDestination = computeSettlementSpecialtyExportPlan({
  state: {
    buildings: new Map([
      [unstaffedReceivingMarket.id, unstaffedReceivingMarket],
      [routedApiary.id, routedApiary],
    ]),
    deliveryTrips: new Map(),
  },
  marketRate: 1,
  roadComponentFor: () => 1,
});
assert.equal(unstaffedDestination.dispatchReadyProducerStock, 4);
assert.equal(unstaffedDestination.operationalMarkets, 0);
assert.equal(unstaffedDestination.activeBrokerMarkets, 0);

const heldMarket = building('held-market', 'marketplace', 0, {
  assignedLabor: 1,
  cloth: 5,
  marketplaceSpecialtyExportPolicy: 2,
});
const idleMarket = building('idle-market', 'marketplace', 10, {
  assignedLabor: 0,
  wine: 7,
});
const manualMarket = building('manual-market', 'marketplace', 20, {
  assignedLabor: 1,
  actionCooldown: 5,
  ale: 3,
});
const roadlessMarket = building('roadless-market', 'marketplace', 30, {
  assignedLabor: 1,
  honey: 4,
});
const unfinishedMarket = building('unfinished-market', 'marketplace', 40, {
  assignedLabor: 1,
  ale: 2,
  constructionComplete: false,
});
const held = computeSettlementSpecialtyExportPlan({
  state: {
    buildings: new Map([
      [heldMarket.id, heldMarket],
      [idleMarket.id, idleMarket],
      [manualMarket.id, manualMarket],
      [roadlessMarket.id, roadlessMarket],
      [unfinishedMarket.id, unfinishedMarket],
    ]),
    deliveryTrips: new Map(),
  },
  marketRate: 1,
  roadComponentFor: (candidate) =>
    candidate.id === roadlessMarket.id ? null : 1,
});
assert.equal(held.activeBrokerMarkets, 0);
assert.equal(held.policyHeldMarketQueueUnits, 5);
assert.equal(held.laborBlockedMarketQueueUnits, 7);
assert.equal(held.manualTradeBlockedMarketQueueUnits, 3);
assert.equal(held.roadBlockedMarketQueueUnits, 4);
assert.equal(held.constructionBlockedMarketQueueUnits, 2);
assert.equal(held.blockedMarketQueueUnits, 21);
assert.equal(held.firstAttentionBuildingId, roadlessMarket.id);
assert.equal(held.firstAttentionKind, 'market-road');

const burningMarket = building('burning-market', 'marketplace', 0, {
  assignedLabor: 1,
  ale: 2,
});
const burningBrewery = building('burning-brewery', 'brewery', 0, {
  assignedLabor: 1,
  ale: 3,
});
const fireIncidents = new Map<string, FireIncidentState>([
  [
    'market-fire',
    {
      id: 'market-fire',
      targetKind: 'building',
      targetId: burningMarket.id,
      x: 0,
      z: 0,
      ignitionSource: 'accident',
      status: 'burning',
      intensity: 1,
      damage: 0,
      waterDelivered: 0,
      requiredWater: 1,
      extinguishChance: 0,
      startedTick: 1,
      lastWaterTick: 0,
      resolvedTick: 0,
      responseWellId: null,
    },
  ],
  [
    'brewery-fire',
    {
      id: 'brewery-fire',
      targetKind: 'building',
      targetId: burningBrewery.id,
      x: 0,
      z: 0,
      ignitionSource: 'accident',
      status: 'burning',
      intensity: 1,
      damage: 0,
      waterDelivered: 0,
      requiredWater: 1,
      extinguishChance: 0,
      startedTick: 1,
      lastWaterTick: 0,
      resolvedTick: 0,
      responseWellId: null,
    },
  ],
]);
const fireBlocked = computeSettlementSpecialtyExportPlan({
  state: {
    buildings: new Map([
      [burningMarket.id, burningMarket],
      [burningBrewery.id, burningBrewery],
    ]),
    deliveryTrips: new Map(),
    fireIncidents,
  },
  marketRate: 1,
  roadComponentFor: () => 1,
});
assert.equal(fireBlocked.fireBlockedProducerStock, 3);
assert.equal(fireBlocked.fireBlockedMarketQueueUnits, 2);
assert.equal(fireBlocked.activeBrokerMarkets, 0);

const marketOnlyFire = computeSettlementSpecialtyExportPlan({
  state: {
    buildings: new Map([
      [burningMarket.id, burningMarket],
      [burningBrewery.id, burningBrewery],
    ]),
    deliveryTrips: new Map(),
    fireIncidents: new Map([
      ['market-fire', fireIncidents.get('market-fire')!],
    ]),
  },
  marketRate: 1,
  roadComponentFor: () => 1,
});
assert.equal(marketOnlyFire.fireBlockedProducerStock, 0);
assert.equal(marketOnlyFire.marketFireBlockedProducerStock, 3);
assert.equal(marketOnlyFire.dispatchReadyProducerStock, 0);
assert.equal(marketOnlyFire.firstAttentionKind, 'producer-market-fire');
assert.equal(marketOnlyFire.roadPlan?.exposedProducerBranches, 1);

const perfBuildings = new Map<string, BuildingState>();
for (let index = 0; index < 50_000; index += 1) {
  const branch = index % 200;
  const producer = building(
    `perf-brewery-${index}`,
    'brewery',
    branch,
    { assignedLabor: 1, ale: 1 },
  );
  perfBuildings.set(producer.id, producer);
}
for (let index = 0; index < 50_000; index += 1) {
  const branch = index % 200;
  const market = building(
    `perf-market-${index}`,
    'marketplace',
    branch,
    { assignedLabor: 1, honey: 1 },
  );
  perfBuildings.set(market.id, market);
}
const perfStarted = performance.now();
const large = computeSettlementSpecialtyExportPlan({
  state: {
    buildings: perfBuildings,
    deliveryTrips: new Map(),
  },
  marketRate: 1,
  roadComponentFor: (candidate) => candidate.x,
});
const perfElapsed = performance.now() - perfStarted;
assert.equal(large.producers, 50_000);
assert.equal(large.markets, 50_000);
assert.equal(large.roadPlan?.activeBranches, 200);
assert.equal(large.roadPlan?.matchedBranches, 200);
assert.equal(large.dispatchReadyProducerStock, 50_000);
assert.ok(
  perfElapsed < 600,
  `100,000-building / 200-branch specialty export plan took ${perfElapsed.toFixed(1)} ms`,
);

const expandedEconomyServer = readFileSync(
  'server/src/simulation/expanded_economy.rs',
  'utf8',
);
assert.match(
  expandedEconomyServer,
  /target\.id == source\.id[\s\S]{0,180}building_disabled_by_fire\(ctx, target\.id\)/,
);
assert.match(
  expandedEconomyServer,
  /if !source\.construction_complete[\s\S]{0,180}building_disabled_by_fire\(ctx, source\.id\)/,
);

console.log(
  `settlement specialty export tests passed (${perfElapsed.toFixed(1)} ms for 100,000 buildings / 200 branches)`,
);
