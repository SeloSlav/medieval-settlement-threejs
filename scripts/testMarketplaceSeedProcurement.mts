import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  MARKETPLACE_SEED_GRAIN_IMPORT_LOT,
  MARKETPLACE_SEED_GRAIN_IMPORT_OFFER,
  MARKETPLACE_SEED_GRAIN_TARGETS,
  marketplaceSeedGrainProcurementPlan,
  nextMarketplaceStandingOrder,
  normalizeMarketplaceSeedGrainTarget,
} from '../src/economy/marketplaceSeedPolicy.ts';
import {
  marketplaceSeedCoveragePlan,
  seedGrainSourceCoveragePlan,
} from '../src/economy/marketplaceSeedCoverage.ts';
import { DEFAULT_REGIONAL_MARKET_STATE } from '../src/economy/regionalMarket.ts';
import { renderMarketplaceTradePanel } from '../src/resources/inspector/marketplaceTradeRenderer.ts';
import type {
  BuildingState,
  FarmFieldState,
  GameState,
} from '../src/resources/types.ts';
import type { DeliveryTripState } from '../src/logistics/deliveryTrips.ts';

assert.deepEqual(MARKETPLACE_SEED_GRAIN_TARGETS, [0, 24, 48, 72, 96]);
assert.equal(MARKETPLACE_SEED_GRAIN_IMPORT_OFFER.id, 'buy_seed_grain');
assert.equal(MARKETPLACE_SEED_GRAIN_IMPORT_LOT, 24);
assert.equal(MARKETPLACE_SEED_GRAIN_IMPORT_OFFER.goldCost, 18);
assert.equal(normalizeMarketplaceSeedGrainTarget(undefined), 0);
assert.equal(normalizeMarketplaceSeedGrainTarget(71), 48);
assert.equal(normalizeMarketplaceSeedGrainTarget(255), 96);

assert.deepEqual(
  marketplaceSeedGrainProcurementPlan({
    grain: 0,
    marketplaceSeedGrainTarget: undefined,
  }),
  {
    target: 0,
    stock: 0,
    ordersToTarget: 0,
    nextOrderDue: false,
  },
);
assert.deepEqual(
  marketplaceSeedGrainProcurementPlan({
    grain: 0,
    marketplaceSeedGrainTarget: 48,
  }),
  {
    target: 48,
    stock: 0,
    ordersToTarget: 2,
    nextOrderDue: true,
  },
);
assert.deepEqual(
  marketplaceSeedGrainProcurementPlan({
    grain: 25,
    marketplaceSeedGrainTarget: 48,
  }),
  {
    target: 48,
    stock: 25,
    ordersToTarget: 0,
    nextOrderDue: false,
  },
  'whole-lot procurement must not overshoot the selected market target',
);

assert.equal(
  nextMarketplaceStandingOrder({
    grain: 0,
    marketplaceSeedGrainTarget: 48,
    ironwork: 0,
    marketplaceIronworkTarget: 12,
  }, false),
  'seedGrain',
  'peaceful worlds must ignore stale frontier targets',
);
assert.equal(
  nextMarketplaceStandingOrder({
    grain: 0,
    marketplaceSeedGrainTarget: 48,
    ironwork: 0,
    marketplaceIronworkTarget: 12,
  }, true),
  'seedGrain',
  'seed grain wins an exact fill-ratio tie',
);
assert.equal(
  nextMarketplaceStandingOrder({
    grain: 24,
    marketplaceSeedGrainTarget: 72,
    ironwork: 0,
    marketplaceIronworkTarget: 12,
  }, true),
  'ironwork',
);
assert.equal(
  nextMarketplaceStandingOrder({
    grain: 0,
    marketplaceSeedGrainTarget: 72,
    ironwork: 6,
    marketplaceIronworkTarget: 12,
  }, true),
  'seedGrain',
);

const marketplace = {
  id: 'building:42',
  kind: 'marketplace',
  constructionComplete: true,
  assignedLabor: 1,
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
  gold: 0,
  ironwork: 0,
  marketplaceSeedGrainTarget: 48,
  marketplaceIronworkTarget: 12,
} as BuildingState;
const tradeAvailability = {
  timber: 0,
  stone: 0,
  firewood: 0,
  food: 0,
  grain: 0,
  ironwork: 0,
  gold: 100,
};
const manualTrade = { ready: true, label: 'Trade desk ready', reason: null };
const peacefulPanel = renderMarketplaceTradePanel(
  marketplace,
  tradeAvailability,
  DEFAULT_REGIONAL_MARKET_STATE,
  manualTrade,
  false,
);
assert.match(peacefulPanel, /Seed-grain procurement/);
assert.match(peacefulPanel, /data-marketplace-seed-grain-target="48" disabled/);
assert.match(peacefulPanel, /Next 24-unit seed lot ready for 18 gold; 2 lots remain/);
assert.doesNotMatch(peacefulPanel, /Frontier ironwork procurement/);

const frontierPanel = renderMarketplaceTradePanel(
  marketplace,
  tradeAvailability,
  DEFAULT_REGIONAL_MARKET_STATE,
  manualTrade,
  true,
);
assert.match(frontierPanel, /seed grain and ironwork share this broker queue/);
assert.match(
  frontierPanel,
  /Queued behind the more depleted seed-grain reserve; 2 ironwork lots remain/,
  'the inspector must explain shared-queue arbitration before treasury gold is spent',
);

function makeField(
  id: string,
  farmsteadId: string,
  area: number,
  crop: 'rye' | 'oats',
): FarmFieldState {
  return {
    id,
    farmsteadId,
    corners: [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 1, z: 1 },
      { x: 0, z: 1 },
    ],
    area,
    averageSlopeDegrees: 2,
    moisture: 0.7,
    fertility: 0.8,
    crop,
    nextCrop: crop,
    stage: 'ploughing',
    stageProgress: 0,
    priority: 2,
    harvestCount: 0,
    lastYield: 0,
    currentYield: 0,
  };
}

const staffedHolding = {
  ...marketplace,
  id: 'building:100',
  kind: 'threshing_barn',
  x: 30,
  z: 0,
  assignedLabor: 2,
  grain: 0,
} as BuildingState;
const unstaffedHolding = {
  ...marketplace,
  id: 'building:101',
  kind: 'threshing_barn',
  x: 20,
  z: 0,
  assignedLabor: 0,
  grain: 4,
} as BuildingState;
const inboundSeed = {
  id: 'delivery:1',
  buildingId: marketplace.id,
  residenceId: null,
  destinationKind: 'building',
  targetBuildingId: staffedHolding.id,
  cargoKind: 'grain',
  amount: 6,
  phase: 'outbound',
  x: 0,
  z: 0,
  progress: 0.5,
  speedMps: 1,
  unloadSeconds: 1,
  unloadRemaining: 1,
  deliveryWorkers: 1,
  freeHaulerWorkers: 0,
  pathDistance: 30,
  travelSpeedMultiplier: 1,
  routePolylineJson: '',
} as DeliveryTripState;
const coverageState = {
  buildings: new Map([
    [marketplace.id, marketplace],
    [staffedHolding.id, staffedHolding],
    [unstaffedHolding.id, unstaffedHolding],
  ]),
  farmFields: new Map([
    ['field:1', makeField('field:1', staffedHolding.id, 2_000, 'rye')],
    ['field:2', makeField('field:2', unstaffedHolding.id, 1_000, 'oats')],
  ]),
  deliveryTrips: new Map([[inboundSeed.id, inboundSeed]]),
} as Pick<GameState, 'buildings' | 'farmFields' | 'deliveryTrips'>;
const coverage = marketplaceSeedCoveragePlan(
  marketplace,
  coverageState,
  (_market, farmstead) => farmstead.x,
);
assert.equal(coverage.connectedHoldings, 2);
assert.equal(coverage.staffedHoldings, 1);
assert.equal(coverage.shortHoldings, 2);
assert.equal(coverage.staffedShortHoldings, 1);
assert.equal(coverage.laborBlockedHoldings, 1);
assert.equal(coverage.inboundBlockedHoldings, 1);
assert.equal(coverage.sourceBusy, true);
assert.equal(coverage.seedRequired, 38);
assert.equal(coverage.seedCovered, 10);
assert.equal(coverage.seedShortfall, 28);
assert.equal(coverage.dispatchableShortfall, 18);
assert.equal(coverage.laborBlockedShortfall, 10);
assert.equal(coverage.inboundGrain, 6);
assert.equal(coverage.marketOutboundGrain, 6);
assert.equal(coverage.plannedImportLots, 2);
assert.equal(coverage.plannedImportGrain, 48);
assert.equal(coverage.potentialCoverage, 18);
assert.equal(coverage.uncoveredDispatchableShortfall, 0);
assert.equal(coverage.firstShortBuildingId, staffedHolding.id);
assert.equal(coverage.nextDispatchBuildingId, null);
assert.equal(coverage.nextDispatchAmount, 0);

const coveredPanel = renderMarketplaceTradePanel(
  marketplace,
  tradeAvailability,
  DEFAULT_REGIONAL_MARKET_STATE,
  manualTrade,
  false,
  coverage,
);
assert.match(coveredPanel, /10\.0 \/ 38\.0 grain covered/);
assert.match(coveredPanel, /6\.0 already inbound \(6\.0 from this market\)/);
assert.match(coveredPanel, /10\.0 grain across 1 holding cannot move until farm labor is assigned/);
assert.match(coveredPanel, /overlapping sources will not duplicate the haul/);
assert.match(coveredPanel, /already has a cart away; seed priority is recalculated/);
assert.match(coveredPanel, new RegExp(`data-inspect-building="${staffedHolding.id}"`));

const stockedMarketplace = { ...marketplace, grain: 12 };
const readyCoverage = marketplaceSeedCoveragePlan(
  stockedMarketplace,
  {
    ...coverageState,
    buildings: new Map([
      [stockedMarketplace.id, stockedMarketplace],
      [staffedHolding.id, staffedHolding],
      [unstaffedHolding.id, unstaffedHolding],
    ]),
    deliveryTrips: new Map(),
  },
  (_market, farmstead) => farmstead.x,
);
assert.equal(readyCoverage.sourceBusy, false);
assert.equal(readyCoverage.inboundBlockedHoldings, 0);
assert.equal(readyCoverage.nextDispatchBuildingId, staffedHolding.id);
assert.equal(readyCoverage.nextDispatchDistance, 30);
assert.equal(readyCoverage.nextDispatchStock, 0);
assert.equal(readyCoverage.nextDispatchRequired, 24);
assert.equal(readyCoverage.nextDispatchShortfall, 24);
assert.equal(readyCoverage.nextDispatchAmount, 6);
const readyCoveragePanel = renderMarketplaceTradePanel(
  stockedMarketplace,
  tradeAvailability,
  DEFAULT_REGIONAL_MARKET_STATE,
  manualTrade,
  false,
  readyCoverage,
);
assert.match(readyCoveragePanel, /Next seed cart: 6\.0 grain to the least-covered eligible holding/);
assert.match(readyCoveragePanel, /0\.0 \/ 24\.0 onsite/);
assert.match(readyCoveragePanel, /over 30 m of road/);

const overlappingInbound = { ...inboundSeed, buildingId: 'building:other-source' };
const overlappingCoverage = marketplaceSeedCoveragePlan(
  stockedMarketplace,
  {
    ...coverageState,
    buildings: new Map([
      [stockedMarketplace.id, stockedMarketplace],
      [staffedHolding.id, staffedHolding],
      [unstaffedHolding.id, unstaffedHolding],
    ]),
    deliveryTrips: new Map([[overlappingInbound.id, overlappingInbound]]),
  },
  (_market, farmstead) => farmstead.x,
);
assert.equal(overlappingCoverage.sourceBusy, false);
assert.equal(overlappingCoverage.inboundBlockedHoldings, 1);
assert.equal(overlappingCoverage.nextDispatchBuildingId, null);
assert.equal(overlappingCoverage.nextDispatchAmount, 0);

const unstaffedGranary = {
  ...stockedMarketplace,
  id: 'building:granary',
  kind: 'granary',
  assignedLabor: 0,
} as BuildingState;
const granarySeedPlan = seedGrainSourceCoveragePlan(
  unstaffedGranary,
  {
    ...coverageState,
    buildings: new Map([
      [unstaffedGranary.id, unstaffedGranary],
      [staffedHolding.id, staffedHolding],
      [unstaffedHolding.id, unstaffedHolding],
    ]),
    deliveryTrips: new Map(),
  },
  (_granary, farmstead) => farmstead.x,
);
assert.equal(granarySeedPlan.sourceOperational, true);
assert.equal(granarySeedPlan.nextDispatchBuildingId, staffedHolding.id);
assert.equal(granarySeedPlan.nextDispatchAmount, 6);

const tablesSource = fs.readFileSync('server/src/tables.rs', 'utf8');
const reducerSource = fs.readFileSync('server/src/reducers/buildings.rs', 'utf8');
const tradeSource = fs.readFileSync('server/src/economy/marketplace_trade.rs', 'utf8');
const expandedEconomySource = fs.readFileSync(
  'server/src/simulation/expanded_economy.rs',
  'utf8',
);
const caravanSource = fs.readFileSync('server/src/simulation/marketplace_caravan.rs', 'utf8');
const generatedTable = fs.readFileSync('src/generated/building_table.ts', 'utf8');
const generatedReducer = fs.readFileSync(
  'src/generated/set_marketplace_seed_grain_target_reducer.ts',
  'utf8',
);
const rendererSource = fs.readFileSync(
  'src/resources/inspector/marketplaceTradeRenderer.ts',
  'utf8',
);
const inspectorSource = fs.readFileSync('src/resources/ResourceInspector.ts', 'utf8');
const marketplaceInspectorSource = fs.readFileSync(
  'src/resources/inspector/marketplaceInspector.ts',
  'utf8',
);
const syncSource = fs.readFileSync('src/data/spacetimeTableSync/syncBuildings.ts', 'utf8');

assert.match(
  tablesSource,
  /#\[default\(0u8\)\]\s+pub marketplace_seed_grain_target: u8/,
  'existing saves must remain manual-only after the additive migration',
);
assert.match(
  reducerSource,
  /set_marketplace_seed_grain_target[\s\S]*?is_valid_marketplace_seed_grain_target[\s\S]*?building\.marketplace_seed_grain_target = seed_grain_target/,
  'the authoritative reducer must validate and persist only bounded targets',
);
const standingImportSource = tradeSource.slice(
  tradeSource.indexOf('pub fn try_execute_standing_marketplace_import'),
  tradeSource.indexOf('fn execute_food_commodity_trade'),
);
for (const contract of [
  'next_standing_marketplace_import',
  'StandingMarketplaceImport::SeedGrain',
  '"buy_seed_grain"',
  'MARKETPLACE_SEED_GRAIN_IMPORT_LOT',
  'apply_marketplace_trade',
  'start_manual_trade_cooldown',
]) {
  assert.ok(
    standingImportSource.includes(contract),
    `standing seed procurement must retain ${contract}`,
  );
}
assert.ok(
  standingImportSource.indexOf('apply_marketplace_trade')
    < standingImportSource.indexOf('start_manual_trade_cooldown'),
  'broker cooldown starts only after a regional trade commits',
);
assert.match(
  caravanSource,
  /marketplace_seed_grain_target > 0[\s\S]*?clock\.sim_tick % 5 == building_id % 5[\s\S]*?try_execute_standing_marketplace_import/,
  'seed procurement checks must reuse the staggered marketplace loop',
);
assert.match(generatedTable, /marketplaceSeedGrainTarget: __t\.u8\(\)/);
assert.match(generatedReducer, /seedGrainTarget: __t\.u8\(\)/);
assert.match(
  inspectorSource,
  /data-marketplace-seed-grain-target[\s\S]*?onSetMarketplaceSeedGrainTarget/,
);
assert.match(syncSource, /marketplaceSeedGrainTarget: row\.marketplaceSeedGrainTarget/);
assert.match(
  expandedEconomySource,
  /source\.kind == "marketplace" && source\.assigned_labor == 0/,
  'an unstaffed marketplace must not launch a seed or armory cart',
);
assert.match(
  marketplaceInspectorSource,
  /marketplaceSeedCoveragePlan\([\s\S]*?getRoadPathDistance/,
  'the market inspector must evaluate field demand against its real road component',
);
for (const feedbackContract of [
  'Seed-grain procurement',
  'data-marketplace-seed-grain-target',
  'reserved for road-linked, staffed farmsteads',
  'least-covered holding first, then the shorter road',
  'Next seed cart',
  'overlapping sources will not duplicate the haul',
  'mills and breweries continue drawing from holdings and granaries',
  'more depleted selected target goes first',
  'Reachable field demand',
  'data-inspect-building',
  'cannot move until farm labor is assigned',
]) {
  assert.ok(
    rendererSource.includes(feedbackContract),
    `marketplace inspector must explain ${feedbackContract}`,
  );
}

const performanceStarted = performance.now();
let orders = 0;
for (let index = 0; index < 100_000; index += 1) {
  const building = {
    grain: index % 97,
    marketplaceSeedGrainTarget: 96,
    ironwork: index % 49,
    marketplaceIronworkTarget: 48,
  };
  orders += marketplaceSeedGrainProcurementPlan(building).ordersToTarget;
  if (nextMarketplaceStandingOrder(building, true) != null) orders += 1;
}
const performanceElapsed = performance.now() - performanceStarted;
assert.ok(orders > 0);
assert.ok(
  performanceElapsed < 350,
  `100k shared marketplace procurement forecasts regressed (${performanceElapsed.toFixed(1)} ms)`,
);

const largeBuildings = new Map<string, BuildingState>([[marketplace.id, marketplace]]);
const largeFields = new Map<string, FarmFieldState>();
for (let index = 0; index < 100_000; index += 1) {
  const farmsteadId = `building:${index + 1_000}`;
  largeBuildings.set(farmsteadId, {
    id: farmsteadId,
    kind: 'threshing_barn',
    x: index % 500,
    z: Math.floor(index / 500),
    grain: index % 3,
    assignedLabor: index % 5 === 0 ? 0 : 2,
    constructionComplete: true,
  } as BuildingState);
  const fieldId = `field:${index + 1_000}`;
  largeFields.set(fieldId, {
    id: fieldId,
    farmsteadId,
    area: 1_000,
    crop: 'rye',
    nextCrop: 'oats',
    stage: 'ploughing',
    stageProgress: 0,
    priority: 2,
  } as FarmFieldState);
}
const coveragePerformanceStarted = performance.now();
const largeCoverage = marketplaceSeedCoveragePlan(
  { ...marketplace, marketplaceSeedGrainTarget: 96 },
  {
    buildings: largeBuildings,
    farmFields: largeFields,
    deliveryTrips: new Map(),
  },
  () => 100,
);
const coveragePerformanceElapsed = performance.now() - coveragePerformanceStarted;
assert.equal(largeCoverage.connectedHoldings, 100_000);
assert.ok(largeCoverage.seedShortfall > 0);
assert.ok(
  coveragePerformanceElapsed < 500,
  `100k-holding branch seed forecast regressed (${coveragePerformanceElapsed.toFixed(1)} ms)`,
);

console.log(
  `marketplace seed procurement tests passed (${performanceElapsed.toFixed(1)} ms for 100k shared forecasts; ${coveragePerformanceElapsed.toFixed(1)} ms for a 100k-holding road branch)`,
);
