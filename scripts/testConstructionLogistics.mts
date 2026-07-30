import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import {
  CARPENTER_CART_SERVICE_IRONWORK_PER_TRIP,
  CARPENTER_CART_SERVICE_TARGET_TRIPS,
  CARPENTER_CART_SERVICE_TIMBER_PER_TRIP,
  CONSTRUCTION_DELIVERY_SPEED_MPS,
  CONSTRUCTION_HAUL_PER_WORKER,
  CONSTRUCTION_MAX_BUILDERS,
  CONSTRUCTION_TREASURY_TRANSFER_PER_SEC,
  CONSTRUCTION_WORK_PER_WORKER_PER_SEC,
  FIREWOOD_DELIVERY_SPEED_MPS,
  FOOD_DELIVERY_SPEED_MPS,
  TIMBER_DELIVERY_SPEED_MPS,
  WATER_DELIVERY_SPEED_MPS,
} from '../src/generated/gameBalance.ts';
import { getBuildingDefinition } from '../src/resources/buildings.ts';
import { getBuildingCost } from '../src/resources/buildingEconomy.ts';
import {
  constructionVisualSignature,
  createConstructionSiteMesh,
} from '../src/buildings/ConstructionSiteMesh.ts';
import {
  deliveryWorkerPersonIdentity,
  findInboundSupplyTripForBuilding,
  type DeliveryTripState,
} from '../src/logistics/deliveryTrips.ts';
import {
  constructionSourceAvailableStock,
  constructionSourcePriority,
  selectConstructionRouteSource,
} from '../src/logistics/constructionLogistics.ts';
import {
  computeSettlementConstructionPlan,
} from '../src/economy/settlementConstruction.ts';
import type { FireIncidentState } from '../src/fires/fireIncident.ts';
import {
  CONSTRUCTION_PRIORITY_HOLD,
  CONSTRUCTION_PRIORITY_LOW,
  CONSTRUCTION_PRIORITY_NORMAL,
  CONSTRUCTION_PRIORITY_URGENT,
  constructionPriorityLabel,
  normalizeConstructionPriority,
} from '../src/logistics/constructionPriority.ts';
import type { BuildingState } from '../src/resources/types.ts';
import { renderConstructionInspector } from '../src/resources/inspector/constructionRenderer.ts';
import { renderConstructionQueueRows } from '../src/resources/inspector/townHallRenderer.ts';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const buildingSchemaBlock = read('server/src/tables.rs')
  .split('pub struct Building {')[1]
  ?.split('\n}\n\n/// A player-drawn arable parcel')[0] ?? '';
const buildingSchemaFields = [...buildingSchemaBlock.matchAll(/pub\s+([a-z0-9_]+):/g)]
  .map((match) => match[1]);
const legacyBuildingSchemaPrefix = [
  'id owner kind x z work_radius action_cooldown timber firewood stone water food',
  'grain flour ale preserved_food honey wine polearms water_capacity assigned_labor',
  'storehouse_accepts_timber storehouse_accepts_stone storehouse_accepts_firewood gold',
  'construction_complete construction_progress construction_required_timber',
  'construction_required_stone construction_delivered_timber construction_delivered_stone',
  'construction_reserved_timber construction_reserved_stone construction_treasury_timber',
  'construction_treasury_stone granary_accepts_fresh_food ironwork',
  'granary_households_first construction_priority woodcutter_timber_reserve',
  'granary_grain_reserve harvest_reserve_percent wool cloth carpenter_polearm_reserve',
  'guardhouse_pay_priority marketplace_ironwork_target marketplace_specialty_export_policy',
  'granary_fresh_food_target_percent storehouse_timber_target_percent',
  'storehouse_stone_target_percent storehouse_firewood_target_percent',
  'processor_output_target_percent guardhouse_food_reserve marketplace_seed_grain_target',
  'founding_shelter_active marketplace_pending_trade_code chapel_monastery_tithe_due',
  'civic_receipts_gold marketplace_gold_reserve_target barley malt flax',
  'guardhouse_muster_watchtower_id weaver_input_policy iron clay salt charcoal pottery',
  'marketplace_iron_target marketplace_salt_target manure remedies',
].join(' ').split(' ');
assert.deepEqual(
  buildingSchemaFields.slice(0, legacyBuildingSchemaPrefix.length),
  legacyBuildingSchemaPrefix,
  'the complete deployed Building prefix must remain byte-order stable for additive upgrades',
);
assert.deepEqual(
  buildingSchemaFields.slice(
    legacyBuildingSchemaPrefix.length,
    legacyBuildingSchemaPrefix.length + 4,
  ),
  [
    'construction_required_ironwork',
    'construction_delivered_ironwork',
    'construction_reserved_ironwork',
    'construction_treasury_ironwork',
  ],
  'construction ironwork accounting must append after the deployed schema prefix',
);

assert.equal(CONSTRUCTION_MAX_BUILDERS, 4);
assert.ok(CONSTRUCTION_HAUL_PER_WORKER > 0);
assert.ok(CONSTRUCTION_DELIVERY_SPEED_MPS > 0);
assert.ok(CONSTRUCTION_TREASURY_TRANSFER_PER_SEC > 0);
assert.ok(CONSTRUCTION_WORK_PER_WORKER_PER_SEC > 0);
assert.ok(
  Math.min(
    FIREWOOD_DELIVERY_SPEED_MPS,
    WATER_DELIVERY_SPEED_MPS,
    TIMBER_DELIVERY_SPEED_MPS,
    CONSTRUCTION_DELIVERY_SPEED_MPS,
  ) >= 2,
  'heavy utility and construction carts should retain their established logistics pace',
);
assert.ok(
  FOOD_DELIVERY_SPEED_MPS >= 1.4 && FOOD_DELIVERY_SPEED_MPS < 2,
  'household food handcarts should move at a believable brisk walking pace',
);
assert.equal(normalizeConstructionPriority(undefined), CONSTRUCTION_PRIORITY_NORMAL);
assert.equal(normalizeConstructionPriority(-8), CONSTRUCTION_PRIORITY_HOLD);
assert.equal(normalizeConstructionPriority(99), CONSTRUCTION_PRIORITY_URGENT);
assert.deepEqual(
  [
    CONSTRUCTION_PRIORITY_HOLD,
    CONSTRUCTION_PRIORITY_LOW,
    CONSTRUCTION_PRIORITY_NORMAL,
    CONSTRUCTION_PRIORITY_URGENT,
  ].map(constructionPriorityLabel),
  ['Hold', 'Low', 'Normal', 'Urgent'],
);

for (const kind of ['lumber_mill', 'stone_quarry'] as const) {
  const definition = getBuildingDefinition(kind);
  const cost = getBuildingCost(kind);
  const maxCrewSeconds = (cost.timber + cost.stone)
    / (CONSTRUCTION_WORK_PER_WORKER_PER_SEC * CONSTRUCTION_MAX_BUILDERS);
  assert.ok(
    maxCrewSeconds <= 17,
    `${definition.label} should finish builder work in at most 17 seconds with a full crew`,
  );
}

const fittingCosts = [
  'large_quarry',
  'chapel',
  'town_hall',
  'watchtower',
  'guardhouse',
  'palisaded_refuge',
  'monastery',
  'brewery',
  'smokehouse',
  'granary',
  'watermill',
  'carpenter',
  'ferry_landing',
] as const;
assert.equal(
  fittingCosts.reduce(
    (total, kind) => total + (getBuildingCost(kind).ironwork ?? 0),
    0,
  ),
  51,
  'advanced civic, defensive, and processing buildout should create a modest but meaningful fittings demand',
);
for (const kind of [
  'founders_camp',
  'marketplace',
  'lumber_mill',
  'stone_quarry',
  'smithy',
  'charcoal_burner',
  'clay_pit',
  'potter_kiln',
] as const) {
  assert.equal(
    getBuildingCost(kind).ironwork ?? 0,
    0,
    `${kind} must remain free of circular ironwork bootstrap costs`,
  );
}

assert.notEqual(
  constructionVisualSignature(0.1, 0.2, 0.2),
  constructionVisualSignature(0.65, 0.8, 1),
  'site signature must change with construction stage and delivered piles',
);

const mesh = createConstructionSiteMesh('village_storehouse', 0.55, 0.7, 1);
assert.equal(mesh.name, 'Construction site');
assert.ok(mesh.children.length >= 10, 'site should contain a foundation, frame, scaffold, and piles');
assert.ok(
  mesh.children.some((child) => child.position.y > 2),
  'mid-stage site should contain raised timber framing',
);

const framedSite = createConstructionSiteMesh('village_storehouse', 0.75, 1, 1);
const roofRafters = framedSite.children.filter(
  (child): child is THREE.Mesh => child instanceof THREE.Mesh
    && child.name === 'Construction roof rafter',
);
assert.equal(roofRafters.length, 8, 'the framed construction stage should show four roof trusses');
for (const rafter of roofRafters) {
  const geometry = rafter.geometry as THREE.BoxGeometry;
  const length = geometry.parameters.width;
  const directionToRidge = -Math.sign(rafter.position.x);
  const innerY = rafter.position.y
    + Math.sin(rafter.rotation.z) * directionToRidge * length * 0.5;
  const outerY = rafter.position.y
    - Math.sin(rafter.rotation.z) * directionToRidge * length * 0.5;
  assert.ok(
    innerY > outerY,
    'every construction rafter must rise toward the center ridge',
  );
}

const fittedSite = createConstructionSiteMesh('town_hall', 0.65, 1, 1, 0.67);
assert.ok(
  fittedSite.getObjectByName('Construction fittings crate'),
  'delivered fittings should appear as a named construction-site crate',
);
assert.ok(
  fittedSite.getObjectByName('Construction iron strap 2'),
  'the fittings crate should visibly fill as more ironwork arrives',
);
assert.notEqual(
  constructionVisualSignature(0.65, 1, 1, 0),
  constructionVisualSignature(0.65, 1, 1, 0.67),
  'construction marker invalidation must track delivered fittings',
);

const constructionServer = read('server/src/simulation/construction.rs');
assert.match(constructionServer, /construction_reserved_timber/);
assert.match(constructionServer, /try_start_construction_supply_trip/);
assert.match(constructionServer, /available_free_haulers/);
const deliveryTripServer = read('server/src/simulation/delivery_trips.rs');
assert.match(
  deliveryTripServer,
  /pub fn available_free_haulers[\s\S]*available_building_labor\(ctx, owner\)/,
  'all freelance carts must share the authoritative settlement labor budget',
);
assert.doesNotMatch(
  deliveryTripServer.slice(
    deliveryTripServer.indexOf('pub fn available_free_haulers'),
    deliveryTripServer.indexOf('pub fn building_has_inbound_commodity_trip'),
  ),
  /ctx\.db\.building/,
  'checking free cart labor must not reload every active trip origin',
);
assert.match(
  read('server/src/economy/population.rs'),
  /delivery_trip\(\)[\s\S]*free_hauler_workers[\s\S]*available_building_labor/,
  'freelance cart crews must be deducted by the authoritative population budget',
);
assert.match(
  deliveryTripServer,
  /free_hauler_workers_for_trip[\s\S]*free_hauler_workers,/,
  'new trips must persist their free-labor reservation',
);
assert.match(
  deliveryTripServer,
  /preserve_in_transit_cart_labor[\s\S]*free_hauler_workers[\s\S]*delivery_trip\(\)\.id\(\)\.update/,
  'roster reductions must transfer traveling workers into the trip reservation',
);
assert.match(
  read('server/src/year_round_labor_policy.rs'),
  /minimum_labor[\s\S]*saturating_sub\(donor\.minimum_labor\)/,
  'priority rotation must not reuse a staffed cart crew as donor labor',
);
assert.match(constructionServer, /construction_progress/);
assert.match(constructionServer, /complete_site/);
assert.match(constructionServer, /CommodityKind::Ironwork/);
assert.match(constructionServer, /construction_required_ironwork/);
assert.match(constructionServer, /construction_delivered_ironwork/);
assert.match(constructionServer, /site_buckets/);
assert.match(constructionServer, /construction_priority_bucket/);
assert.match(constructionServer, /CONSTRUCTION_PRIORITY_HOLD/);
assert.match(constructionServer, /\.into_iter\(\)\.rev\(\)\.flatten\(\)/);
assert.doesNotMatch(
  constructionServer.slice(
    constructionServer.indexOf('pub fn step_construction_sites'),
    constructionServer.indexOf('fn transfer_treasury_reserve'),
  ),
  /\.sort/,
  'construction priority must stay a fixed-bucket linear pass',
);
const constructionDispatch = constructionServer.slice(
  constructionServer.indexOf('fn dispatch_reserved_stock'),
  constructionServer.indexOf('fn advance_builder_work'),
);
assert.doesNotMatch(
  constructionDispatch,
  /source\.assigned_labor\s*>\s*0/,
  'unstaffed completed sources must remain eligible for construction pickup',
);
assert.doesNotMatch(
  constructionDispatch,
  /\.sort_by\(/,
  'construction dispatch should not sort every stocked building before starting one cart',
);
assert.match(constructionDispatch, /source_groups/);
assert.match(constructionDispatch, /construction_source_priority/);
assert.match(
  constructionDispatch,
  /tick\.construction_source_ids\(ctx, site\.owner, commodity\)/,
  'every site should inspect only the tick-local roster that began with the requested material',
);
assert.match(
  constructionDispatch,
  /tick\.building_disabled_by_fire\(ctx, source\.id\)/,
  'site-driven construction dispatch must quarantine fire-damaged material sources',
);
assert.doesNotMatch(
  constructionDispatch,
  /ctx\.db\.building\(\)\.owner\(\)/,
  'construction carts must not rescan every owner building for each site and commodity',
);
assert.match(constructionDispatch, /road_path_distance/);
assert.match(constructionDispatch, /select_supply_route_candidate/);

const roadNetworkServer = read('server/src/roads/network.rs');
assert.match(
  roadNetworkServer,
  /heap_key\s*>\s*cost_to_key\(best\)/,
  'road search must compare stale heap entries in the same quantized domain',
);
assert.doesNotMatch(
  roadNetworkServer,
  /heap_key as f64 \/ 1000\.0\)\s*>\s*best/,
  'rounding a heap key back to metres can reject a fresh connected route',
);

const deliveryServer = read('server/src/simulation/delivery_trips.rs');
const constructionTrip = deliveryServer.slice(
  deliveryServer.indexOf('pub fn try_start_construction_supply_trip'),
  deliveryServer.indexOf('fn try_start_road_trip'),
);
assert.doesNotMatch(
  constructionTrip,
  /\|\|\s*origin\.assigned_labor\s*==\s*0/,
  'construction pickup must not require workers assigned to the material source',
);
assert.match(constructionTrip, /available_free_haulers\.min\(1\)/);
assert.match(
  constructionTrip,
  /STOREHOUSE_HAUL_PER_WORKER/,
  'staffed storehouses should retain a batch-hauling advantage',
);
assert.match(
  constructionTrip,
  /tick\.building_disabled_by_fire\(ctx, origin\.id\)/,
  'the trip-start boundary must reject a source that became fire-disabled',
);

const constructionInspector = read('src/resources/inspector/constructionRenderer.ts');
assert.doesNotMatch(constructionInspector, /Waiting for a staffed material source/);
assert.match(constructionInspector, /Unassigned hauler bringing/);
assert.match(constructionInspector, /No road route to/);
assert.match(constructionInspector, /Material source/);
assert.match(constructionInspector, /routeDistance/);
assert.doesNotMatch(
  constructionInspector.slice(constructionInspector.indexOf('function resolveConstructionSupply')),
  /\.sort\(/,
  'inspector prediction should use the same bounded selection as the server',
);

const returningTrip: DeliveryTripState = {
  id: 'trip-1',
  buildingId: 'building-1',
  residenceId: null,
  destinationKind: 'building',
  targetBuildingId: 'building-2',
  cargoKind: 'stone',
  amount: 0,
  phase: 'inbound',
  x: 0,
  z: 0,
  progress: 0,
  speedMps: 1,
  unloadSeconds: 6,
  unloadRemaining: 0,
  deliveryWorkers: 1,
  freeHaulerWorkers: 0,
  pathDistance: 10,
  travelSpeedMultiplier: 1,
  routePolylineJson: '',
};
assert.equal(
  findInboundSupplyTripForBuilding([returningTrip], 'building-2'),
  null,
  'a cart returning empty must no longer appear as an incoming construction haul',
);
const outboundTrip: DeliveryTripState = { ...returningTrip, amount: 8, phase: 'outbound' };
assert.equal(findInboundSupplyTripForBuilding([outboundTrip], 'building-2'), outboundTrip);
assert.equal(
  deliveryWorkerPersonIdentity({ ...outboundTrip, id: 'the-next-trip' }),
  deliveryWorkerPersonIdentity(outboundTrip),
  'a building hauler should keep the same identity and name between deliveries',
);
assert.notEqual(
  deliveryWorkerPersonIdentity({ ...outboundTrip, buildingId: 'another-origin' }),
  deliveryWorkerPersonIdentity(outboundTrip),
);

const buildingState = (
  overrides: Partial<BuildingState> & Pick<BuildingState, 'id' | 'kind'>,
): BuildingState => ({
  id: overrides.id,
  kind: overrides.kind,
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
  constructionPriority: CONSTRUCTION_PRIORITY_NORMAL,
  ...overrides,
});
const carpenterServiceStock = buildingState({
  id: 'service-carpenter',
  kind: 'carpenter',
  timber: CARPENTER_CART_SERVICE_TIMBER_PER_TRIP
    * (CARPENTER_CART_SERVICE_TARGET_TRIPS + 5),
  ironwork: CARPENTER_CART_SERVICE_IRONWORK_PER_TRIP
    * (CARPENTER_CART_SERVICE_TARGET_TRIPS + 2),
});
assert.equal(
  constructionSourceAvailableStock(carpenterServiceStock, 'timber'),
  CARPENTER_CART_SERVICE_TIMBER_PER_TRIP * 5,
);
assert.ok(
  Math.abs(
    constructionSourceAvailableStock(carpenterServiceStock, 'ironwork')
      - CARPENTER_CART_SERVICE_IRONWORK_PER_TRIP * 2,
  ) < 1e-9,
);
const conservingCarpenterStock = {
  ...carpenterServiceStock,
  carpenterCartServiceTargetTrips: 0,
};
assert.equal(
  constructionSourceAvailableStock(conservingCarpenterStock, 'timber'),
  carpenterServiceStock.timber,
  'disabling cart service must release protected timber to construction',
);
assert.equal(
  constructionSourceAvailableStock(conservingCarpenterStock, 'ironwork'),
  carpenterServiceStock.ironwork,
  'disabling cart service must release protected fittings to construction',
);
const fireIncident = (
  targetId: string,
  id = `fire-${targetId}`,
): FireIncidentState => ({
  id,
  targetKind: 'building',
  targetId,
  x: 0,
  z: 0,
  ignitionSource: 'accident',
  status: 'extinguished',
  intensity: 0,
  damage: 0.5,
  waterDelivered: 10,
  requiredWater: 10,
  extinguishChance: 1,
  startedTick: 1,
  lastWaterTick: 2,
  resolvedTick: 3,
  responseWellId: null,
});
const fittingsSource = buildingState({
  id: 'fittings-smithy',
  kind: 'smithy',
  ironwork: 4,
  assignedLabor: 2,
});
const fittingsSite = buildingState({
  id: 'fittings-town-hall',
  kind: 'town_hall',
  assignedLabor: 2,
  constructionComplete: false,
  constructionProgress: 0.2,
  constructionRequiredTimber: 20,
  constructionRequiredStone: 20,
  constructionRequiredIronwork: 6,
  constructionDeliveredTimber: 20,
  constructionDeliveredStone: 20,
  constructionDeliveredIronwork: 1,
  constructionReservedIronwork: 5,
});
const fittingsPlan = computeSettlementConstructionPlan({
  state: {
    buildings: new Map([
      [fittingsSource.id, fittingsSource],
      [fittingsSite.id, fittingsSite],
    ]),
    deliveryTrips: new Map(),
  },
  hasRoadAccess: () => true,
  roadComponentFor: () => 1,
});
assert.deepEqual(fittingsPlan.materials.ironwork, {
  required: 6,
  delivered: 1,
  remaining: 5,
  foundersReserve: 0,
  awaitingPickup: 5,
  inTransit: 0,
  uncovered: 0,
});
assert.equal(fittingsPlan.roadPlan?.materials.ironwork.sourceStock, 4);
assert.equal(fittingsPlan.roadPlan?.materials.ironwork.strandedRoadBoundClaim, 1);
assert.match(renderConstructionQueueRows(fittingsPlan), /ironwork earmarked/);

const urgentOffRoadSite = buildingState({
  id: 'queue-urgent',
  kind: 'lumber_mill',
  assignedLabor: 2,
  constructionComplete: false,
  constructionProgress: 0.4,
  constructionRequiredTimber: 40,
  constructionRequiredStone: 10,
  constructionDeliveredTimber: 20,
  constructionReservedStone: 10,
  constructionPriority: CONSTRUCTION_PRIORITY_URGENT,
});
const uncrewedNormalSite = buildingState({
  id: 'queue-normal',
  kind: 'village_storehouse',
  assignedLabor: 0,
  constructionComplete: false,
  constructionProgress: 0.5,
  constructionRequiredTimber: 10,
  constructionDeliveredTimber: 10,
});
const suppliedLowSite = buildingState({
  id: 'queue-low',
  kind: 'chapel',
  assignedLabor: 1,
  constructionComplete: false,
  constructionProgress: 0,
  constructionRequiredStone: 12,
  constructionPriority: CONSTRUCTION_PRIORITY_LOW,
});
const heldQueueSite = buildingState({
  id: 'queue-held',
  kind: 'marketplace',
  assignedLabor: 3,
  constructionComplete: false,
  constructionProgress: 0,
  constructionRequiredTimber: 10,
  constructionReservedTimber: 10,
  constructionTreasuryTimber: 4,
  constructionPriority: CONSTRUCTION_PRIORITY_HOLD,
});
const queueStoneTrip: DeliveryTripState = {
  ...outboundTrip,
  id: 'queue-stone-trip',
  targetBuildingId: suppliedLowSite.id,
  cargoKind: 'stone',
  amount: 8,
};
const returningQueueTrip: DeliveryTripState = {
  ...queueStoneTrip,
  id: 'returning-queue-trip',
  phase: 'inbound',
  amount: 99,
};
const constructionQueue = computeSettlementConstructionPlan({
  state: {
    buildings: new Map([
      urgentOffRoadSite,
      uncrewedNormalSite,
      suppliedLowSite,
      heldQueueSite,
    ].map((building) => [building.id, building])),
    deliveryTrips: new Map([
      [queueStoneTrip.id, queueStoneTrip],
      [returningQueueTrip.id, returningQueueTrip],
    ]),
  },
  hasRoadAccess: (building) => building.id !== urgentOffRoadSite.id,
});
assert.equal(constructionQueue.siteCount, 4);
assert.equal(constructionQueue.activeSites, 3);
assert.equal(constructionQueue.heldSites, 1);
assert.deepEqual(
  constructionQueue.priorityCounts,
  { held: 1, low: 1, normal: 1, urgent: 1 },
);
assert.equal(constructionQueue.assignedBuilders, 3);
assert.equal(constructionQueue.builderCapacity, 12);
assert.ok(Math.abs(constructionQueue.remainingBuilderDays - 47 / 70) < 1e-9);
assert.deepEqual(
  constructionQueue.statusCounts,
  {
    held: 1,
    building: 0,
    'founders-reserve': 0,
    'in-transit': 1,
    'waiting-builders': 1,
    'off-road': 1,
    'waiting-hauler': 0,
    'waiting-materials': 0,
  },
);
assert.deepEqual(
  constructionQueue.materials.timber,
  {
    required: 60,
    delivered: 30,
    remaining: 30,
    foundersReserve: 4,
    awaitingPickup: 6,
    inTransit: 0,
    uncovered: 20,
  },
);
assert.deepEqual(
  constructionQueue.materials.stone,
  {
    required: 22,
    delivered: 0,
    remaining: 22,
    foundersReserve: 0,
    awaitingPickup: 10,
    inTransit: 8,
    uncovered: 4,
  },
);
assert.deepEqual(
  constructionQueue.firstAttention,
  {
    buildingId: urgentOffRoadSite.id,
    priority: CONSTRUCTION_PRIORITY_URGENT,
    status: 'off-road',
  },
  'the highest-priority blocked site should lead the settlement queue',
);
assert.equal(constructionQueue.roadPlan, null);
const constructionQueueRows = renderConstructionQueueRows(constructionQueue);
assert.match(constructionQueueRows, /Construction queue/);
assert.match(constructionQueueRows, /urgent 1 \/ normal 1 \/ low 1/);
assert.match(constructionQueueRows, /10 \/ 30 timber earmarked/);
assert.match(
  constructionQueueRows,
  new RegExp(`data-inspect-building="${urgentOffRoadSite.id}"`),
);
assert.match(constructionQueueRows, /off-road materials/);

const eastConstructionSource = buildingState({
  id: 'east-construction-source',
  kind: 'village_storehouse',
  x: 0,
  timber: 20,
  stone: 10,
});
const remoteConstructionSource = buildingState({
  id: 'remote-construction-source',
  kind: 'village_storehouse',
  x: 200,
  timber: 100,
  stone: 100,
});
const eastConstructionSite = buildingState({
  id: 'east-construction-site',
  kind: 'chapel',
  x: 0,
  assignedLabor: 1,
  constructionComplete: false,
  constructionProgress: 0,
  constructionRequiredTimber: 30,
  constructionRequiredStone: 10,
  constructionReservedTimber: 30,
  constructionReservedStone: 10,
});
const westConstructionSite = buildingState({
  id: 'west-construction-site',
  kind: 'marketplace',
  x: 100,
  assignedLabor: 1,
  constructionComplete: false,
  constructionProgress: 0,
  constructionRequiredTimber: 20,
  constructionReservedTimber: 20,
  constructionPriority: CONSTRUCTION_PRIORITY_URGENT,
});
const offroadConstructionSite = buildingState({
  id: 'offroad-construction-site',
  kind: 'stone_quarry',
  x: 100,
  assignedLabor: 1,
  constructionComplete: false,
  constructionProgress: 0,
  constructionRequiredTimber: 10,
  constructionReservedTimber: 10,
});
const constructionRoadState = {
  buildings: new Map([
    eastConstructionSource,
    remoteConstructionSource,
    eastConstructionSite,
    westConstructionSite,
    offroadConstructionSite,
  ].map((candidate) => [candidate.id, candidate])),
  deliveryTrips: new Map<string, DeliveryTripState>(),
};
const constructionComponent = (candidate: BuildingState): number =>
  candidate.x < 50 ? 1 : candidate.x < 150 ? 2 : 3;
const splitConstructionRoads = computeSettlementConstructionPlan({
  state: constructionRoadState,
  hasRoadAccess: () => true,
  roadComponentFor: constructionComponent,
});
assert.equal(splitConstructionRoads.roadPlan?.activeBranches, 3);
assert.equal(splitConstructionRoads.roadPlan?.claimBranches, 2);
assert.equal(splitConstructionRoads.roadPlan?.suppliedClaimBranches, 0);
assert.equal(splitConstructionRoads.roadPlan?.exposedClaimBranches, 2);
assert.equal(splitConstructionRoads.roadPlan?.roadBoundSites, 2);
assert.equal(splitConstructionRoads.roadPlan?.offroadSites, 1);
assert.deepEqual(splitConstructionRoads.roadPlan?.materials.timber, {
  roadBoundClaim: 50,
  matchedRoadBoundClaim: 20,
  strandedRoadBoundClaim: 30,
  offroadClaim: 10,
  offroadPotentialCoverage: 10,
  sourceStock: 120,
  fragmentationCoverage: 30,
  unmatchedSourceStock: 90,
});
assert.deepEqual(splitConstructionRoads.roadPlan?.materials.stone, {
  roadBoundClaim: 10,
  matchedRoadBoundClaim: 10,
  strandedRoadBoundClaim: 0,
  offroadClaim: 0,
  offroadPotentialCoverage: 0,
  sourceStock: 110,
  fragmentationCoverage: 0,
  unmatchedSourceStock: 100,
});
assert.equal(
  splitConstructionRoads.roadPlan?.firstExposedBuildingId,
  westConstructionSite.id,
  'the urgent disconnected site should lead the road-stranded reservation audit',
);
const splitConstructionRows = renderConstructionQueueRows(splitConstructionRoads);
assert.match(splitConstructionRows, /Construction roads/);
assert.match(splitConstructionRows, /earmarked but stranded between road branches/);
assert.match(splitConstructionRows, /off-road-capable sites can cover/);
assert.match(
  splitConstructionRows,
  new RegExp(`data-inspect-building="${westConstructionSite.id}"`),
);

const joinedConstructionRoads = computeSettlementConstructionPlan({
  state: constructionRoadState,
  hasRoadAccess: () => true,
  roadComponentFor: () => 1,
});
assert.equal(joinedConstructionRoads.roadPlan?.activeBranches, 1);
assert.equal(joinedConstructionRoads.roadPlan?.claimBranches, 1);
assert.equal(joinedConstructionRoads.roadPlan?.suppliedClaimBranches, 1);
assert.equal(joinedConstructionRoads.roadPlan?.exposedClaimBranches, 0);
assert.equal(
  joinedConstructionRoads.roadPlan?.materials.timber.fragmentationCoverage,
  0,
);
assert.equal(joinedConstructionRoads.roadPlan?.firstExposedBuildingId, null);

const fireBlockedConstructionRoads = computeSettlementConstructionPlan({
  state: {
    ...constructionRoadState,
    fireIncidents: new Map([
      [
        `fire-${remoteConstructionSource.id}`,
        fireIncident(remoteConstructionSource.id),
      ],
    ]),
  },
  hasRoadAccess: () => true,
  roadComponentFor: () => 1,
});
assert.equal(fireBlockedConstructionRoads.fireDisabledSourceBuildings, 1);
assert.equal(fireBlockedConstructionRoads.fireBlockedTimberStock, 100);
assert.equal(fireBlockedConstructionRoads.fireBlockedStoneStock, 100);
assert.equal(
  fireBlockedConstructionRoads.firstFireDisabledSourceId,
  remoteConstructionSource.id,
);
assert.equal(
  fireBlockedConstructionRoads.roadPlan?.materials.timber.sourceStock,
  20,
  'fire-damaged timber must not cover a construction reservation',
);
assert.equal(
  fireBlockedConstructionRoads.roadPlan?.materials.stone.sourceStock,
  10,
  'fire-damaged stone must not cover a construction reservation',
);
assert.equal(fireBlockedConstructionRoads.roadPlan?.exposedClaimBranches, 1);
const fireBlockedConstructionRows = renderConstructionQueueRows(
  fireBlockedConstructionRoads,
);
assert.match(fireBlockedConstructionRows, /Fire-quarantined stores/);
assert.match(
  fireBlockedConstructionRows,
  /100 timber \+ 100 stone \+ 0 ironwork unavailable/,
);
assert.match(
  fireBlockedConstructionRows,
  new RegExp(`data-inspect-building="${remoteConstructionSource.id}"`),
);

const site = buildingState({
  id: 'site',
  kind: 'lumber_mill',
  x: 30,
  assignedLabor: 4,
  constructionComplete: false,
  constructionProgress: 0.75,
  constructionRequiredTimber: 45,
  constructionRequiredStone: 15,
  constructionDeliveredTimber: 45,
  constructionReservedStone: 15,
});
const stoneSource = buildingState({
  id: 'quarry',
  kind: 'stone_quarry',
  stone: 200,
});
const constructionContext = (
  sources: BuildingState[],
  available: number,
  pathDistance:
    | number
    | null
    | ((ax: number, az: number, bx: number, bz: number) => number | null),
  inbound: DeliveryTripState | null = null,
  fireIncidents = new Map<string, FireIncidentState>(),
) => {
  const buildings = new Map(sources.concat(site).map((building) => [building.id, building]));
  return {
    gameState: {
      buildings,
      deliveryTrips: new Map(inbound ? [[inbound.id, inbound]] : []),
      fireIncidents,
    },
    worldQueries: {
      getInboundSupplyTrip: () => inbound,
      getBuilding: (id: string) => buildings.get(id) ?? null,
      getRoadPathDistance: (
        ax: number,
        az: number,
        bx: number,
        bz: number,
      ) => typeof pathDistance === 'function'
        ? pathDistance(ax, az, bx, bz)
        : pathDistance,
      getActiveDeliveryTrip: () => null,
      getRoadAccessLabel: () => 'Connected (5 m to road)',
    },
    populationStats: {
      total: 9,
      assigned: 4,
      cartAssigned: 0,
      available,
      housingCapacity: 4,
      housed: 4,
      vacant: 0,
    },
    resourceTotals: {},
  };
};
const siteTarget = { kind: 'building' as const, building: site };

const fittingsInspector = renderConstructionInspector(
  { kind: 'building', building: fittingsSite },
  constructionContext([fittingsSource], 5, 30) as never,
);
assert.match(fittingsInspector.statusText, /preparing 5 ironwork/);
assert.match(fittingsInspector.detailsHtml, /Ironwork fittings delivered/);
assert.match(fittingsInspector.detailsHtml, /1 \/ 6/);

assert.equal(
  renderConstructionInspector(
    siteTarget,
    constructionContext([stoneSource], 5, 30) as never,
  ).statusText,
  "Unassigned worker fetching 15 stone from Stonecutter's camp",
);
assert.equal(
  renderConstructionInspector(
    siteTarget,
    constructionContext([stoneSource], 0, 30) as never,
  ).statusText,
  "Waiting for an unassigned hauler — 15 stone is at Stonecutter's camp",
);
assert.equal(
  renderConstructionInspector(
    siteTarget,
    constructionContext([stoneSource], 5, null) as never,
  ).statusText,
  "No road route to 15 stone at Stonecutter's camp",
);
const staffedStorehouse = buildingState({
  id: 'storehouse',
  kind: 'village_storehouse',
  stone: 100,
  assignedLabor: 1,
});
const fireBlockedSourceView = renderConstructionInspector(
  siteTarget,
  constructionContext(
    [stoneSource],
    5,
    30,
    null,
    new Map([
      [`fire-${stoneSource.id}`, fireIncident(stoneSource.id)],
    ]),
  ) as never,
);
assert.equal(
  fireBlockedSourceView.statusText,
  "Reserved 15 stone is fire-quarantined at Stonecutter's camp — repair it or supply another store",
);
assert.match(fireBlockedSourceView.detailsHtml, /fire-disabled/);
const healthyFallbackView = renderConstructionInspector(
  siteTarget,
  constructionContext(
    [stoneSource, staffedStorehouse],
    5,
    30,
    null,
    new Map([
      [`fire-${stoneSource.id}`, fireIncident(stoneSource.id)],
    ]),
  ) as never,
);
assert.equal(
  healthyFallbackView.statusText,
  'Storehouse crew preparing 15 stone',
  'a healthy source must replace a fire-disabled preferred source',
);
assert.equal(
  renderConstructionInspector(
    siteTarget,
    constructionContext([stoneSource, staffedStorehouse], 5, 30) as never,
  ).statusText,
  'Storehouse crew preparing 15 stone',
);
const straightLineNearSource = buildingState({
  id: '10',
  kind: 'stone_quarry',
  x: 25,
  assignedLabor: 1,
  stone: 100,
});
const roadRouteNearSource = buildingState({
  id: '20',
  kind: 'large_quarry',
  x: -100,
  assignedLabor: 1,
  stone: 100,
});
const routeAwareView = renderConstructionInspector(
  siteTarget,
  constructionContext(
    [straightLineNearSource, roadRouteNearSource],
    5,
    (sourceX) => sourceX === roadRouteNearSource.x ? 20 : 90,
  ) as never,
);
assert.equal(
  routeAwareView.statusText,
  'Large Quarry crew preparing 15 stone',
  'the source with the shorter road route must beat the source that looks nearer in a straight line',
);
assert.match(routeAwareView.detailsHtml, /Large Quarry · 20m haul/);
assert.match(routeAwareView.detailsHtml, /Queue priority<\/span><span>Normal/);
assert.match(routeAwareView.supplementalPanelHtml ?? '', /data-construction-priority="3"/);
assert.match(routeAwareView.supplementalPanelHtml ?? '', /urgent sites claim available carts/);

const heldSite = {
  ...site,
  assignedLabor: 0,
  constructionPriority: CONSTRUCTION_PRIORITY_HOLD,
};
const heldView = renderConstructionInspector(
  { kind: 'building', building: heldSite },
  constructionContext([stoneSource], 5, 30) as never,
);
assert.equal(heldView.statusText, 'Construction held — reservations retained');
assert.match(heldView.detailsHtml, /Queue priority<\/span><span>Hold/);
assert.match(heldView.labor.hint, /Reservations remain earmarked/);
assert.equal(heldView.labor.increaseDisabled, true);

assert.ok(
  constructionSourcePriority(staffedStorehouse)
    < constructionSourcePriority(roadRouteNearSource),
  'staffed central stores should retain their established source-class advantage',
);
const hierarchyWinner = selectConstructionRouteSource(
  [roadRouteNearSource, staffedStorehouse],
  (source) => source.id === staffedStorehouse.id ? 500 : 20,
);
assert.equal(
  hierarchyWinner?.source.id,
  staffedStorehouse.id,
  'route distance should break ties inside a source class rather than erase the source hierarchy',
);
const stableTieWinner = selectConstructionRouteSource(
  [
    { id: '7', kind: 'stone_quarry' as const, assignedLabor: 1 },
    { id: '3', kind: 'large_quarry' as const, assignedLabor: 1 },
  ],
  () => 40,
);
assert.equal(stableTieWinner?.source.id, '3');

const largeSourceSet = Array.from({ length: 100_000 }, (_, index) => ({
  id: String(index),
  kind: 'stone_quarry' as const,
  assignedLabor: 1,
}));
const selectionStarted = performance.now();
const largeSelection = selectConstructionRouteSource(
  largeSourceSet,
  (source) => 100_000 - Number(source.id),
);
const selectionElapsedMs = performance.now() - selectionStarted;
assert.equal(largeSelection?.source.id, '99999');
assert.ok(
  selectionElapsedMs < 250,
  `100,000 construction sources took ${selectionElapsedMs.toFixed(1)} ms to select`,
);
const largeQueueBuildings = new Map(
  Array.from({ length: 100_000 }, (_, index) => {
    const building = buildingState({
      id: String(index),
      kind: 'lumber_mill',
      constructionComplete: false,
      constructionRequiredTimber: 10,
    });
    return [building.id, building] as const;
  }),
);
const queueStarted = performance.now();
let largeQueueRoadChecks = 0;
const largeQueue = computeSettlementConstructionPlan({
  state: {
    buildings: largeQueueBuildings,
    deliveryTrips: new Map(),
  },
  hasRoadAccess: () => {
    largeQueueRoadChecks += 1;
    return true;
  },
});
const queueElapsedMs = performance.now() - queueStarted;
assert.equal(largeQueue.siteCount, 100_000);
assert.equal(largeQueue.firstAttention?.buildingId, '0');
assert.equal(
  largeQueueRoadChecks,
  0,
  'uncrewed sites should be classified without unnecessary road-network queries',
);
assert.ok(
  queueElapsedMs < 500,
  `100,000 construction sites took ${queueElapsedMs.toFixed(1)} ms to summarize`,
);
for (let index = 0; index < 100_000; index += 1) {
  const candidate = largeQueueBuildings.get(String(index));
  assert.ok(candidate);
  candidate.x = Math.floor(index / 500);
  if (index % 2 === 0) {
    candidate.constructionComplete = true;
    candidate.constructionRequiredTimber = 0;
    candidate.constructionReservedTimber = 0;
    candidate.timber = 10;
  } else {
    candidate.constructionReservedTimber = 10;
  }
}
const constructionRoadPerfStarted = performance.now();
const constructionRoadPerf = computeSettlementConstructionPlan({
  state: {
    buildings: largeQueueBuildings,
    deliveryTrips: new Map(),
  },
  hasRoadAccess: () => true,
  roadComponentFor: (candidate) => candidate.x,
});
const constructionRoadPerfElapsedMs =
  performance.now() - constructionRoadPerfStarted;
assert.equal(constructionRoadPerf.siteCount, 50_000);
assert.equal(constructionRoadPerf.roadPlan?.activeBranches, 200);
assert.equal(constructionRoadPerf.roadPlan?.claimBranches, 200);
assert.equal(constructionRoadPerf.roadPlan?.suppliedClaimBranches, 200);
assert.equal(constructionRoadPerf.roadPlan?.exposedClaimBranches, 0);
assert.equal(constructionRoadPerf.roadPlan?.roadBoundSites, 50_000);
assert.equal(
  constructionRoadPerf.roadPlan?.materials.timber.matchedRoadBoundClaim,
  500_000,
);
assert.ok(
  constructionRoadPerfElapsedMs < 650,
  `100,000-building construction road audit took ${constructionRoadPerfElapsedMs.toFixed(1)} ms`,
);
const constructionFirePerfIncidents = new Map<string, FireIncidentState>();
for (let index = 0; index < 100_000; index += 4) {
  const id = String(index);
  constructionFirePerfIncidents.set(`fire-${id}`, fireIncident(id));
}
const constructionFirePerfStarted = performance.now();
const constructionFirePerf = computeSettlementConstructionPlan({
  state: {
    buildings: largeQueueBuildings,
    deliveryTrips: new Map(),
    fireIncidents: constructionFirePerfIncidents,
  },
  hasRoadAccess: () => true,
  roadComponentFor: (candidate) => candidate.x,
});
const constructionFirePerfElapsedMs =
  performance.now() - constructionFirePerfStarted;
assert.equal(constructionFirePerf.fireDisabledSourceBuildings, 25_000);
assert.equal(constructionFirePerf.fireBlockedTimberStock, 250_000);
assert.equal(
  constructionFirePerf.roadPlan?.materials.timber.matchedRoadBoundClaim,
  250_000,
);
assert.equal(constructionFirePerf.roadPlan?.exposedClaimBranches, 200);
assert.ok(
  constructionFirePerfElapsedMs < 800,
  `100,000-building fire-aware construction road audit took ${constructionFirePerfElapsedMs.toFixed(1)} ms`,
);
const visibleInbound = {
  ...outboundTrip,
  buildingId: stoneSource.id,
  targetBuildingId: site.id,
};
assert.equal(
  renderConstructionInspector(
    siteTarget,
    constructionContext([stoneSource], 5, 30, visibleInbound) as never,
  ).statusText,
  "Unassigned hauler bringing 8 stone from Stonecutter's camp",
);

const placementServer = read('server/src/reducers/buildings.rs');
assert.match(placementServer, /construction_complete: false/);
assert.match(placementServer, /construction_treasury_reservation/);
assert.match(placementServer, /initial_construction_labor/);
assert.doesNotMatch(
  placementServer.slice(
    placementServer.indexOf('pub fn place_building'),
    placementServer.indexOf('pub fn assign_building_labor'),
  ),
  /assigned_labor:\s*0/,
  'new construction sites must not silently start with zero builders when labor is available',
);
assert.doesNotMatch(
  placementServer.slice(
    placementServer.indexOf('pub fn place_building'),
    placementServer.indexOf('pub fn assign_building_labor'),
  ),
  /spend_aggregate_timber/,
  'building placement must reserve resources instead of consuming them instantly',
);
assert.match(placementServer, /construction_priority: CONSTRUCTION_PRIORITY_NORMAL/);
assert.match(placementServer, /pub fn set_construction_priority/);
assert.match(placementServer, /building\.assigned_labor = 0/);
assert.match(placementServer, /cancel_inbound_construction_trips_for_site/);
assert.match(placementServer, /initial_construction_labor\(available_building_labor/);
assert.match(
  deliveryServer,
  /pub fn cancel_inbound_construction_trips_for_site[\s\S]*recall_trip_to_origin/,
  'holding a site should recall its visible cart instead of deleting and teleporting the load',
);

const simServer = read('server/src/reducers/simulation.rs');
assert.match(simServer, /step_construction_sites/);
assert.match(simServer, /if !building\.construction_complete/);

const woodcutterServer = read('server/src/simulation/woodcutters_lodge.rs');
assert.match(
  woodcutterServer,
  /available_unreserved_building_timber/,
  'firewood processing must not consume timber reserved for construction',
);

const generatedBuilding = read('src/generated/building_table.ts');
for (const field of [
  'constructionComplete',
  'constructionProgress',
  'constructionRequiredTimber',
  'constructionDeliveredStone',
  'constructionReservedTimber',
  'constructionTreasuryStone',
  'constructionPriority',
]) {
  assert.match(generatedBuilding, new RegExp(field), `generated binding missing ${field}`);
}
assert.match(read('src/generated/set_construction_priority_reducer.ts'), /priority: __t\.u8/);
assert.match(
  read('src/data/spacetimeTableSync/syncBuildings.ts'),
  /constructionPriority: row\.constructionPriority/,
);
assert.match(
  read('src/data/spacetimeGameStore.ts'),
  /async setConstructionPriority[\s\S]*constructionPriority: clampedPriority/,
);
assert.match(read('src/resources/ResourceInspector.ts'), /data-construction-priority/);

console.log(
  `construction logistics tests passed (${selectionElapsedMs.toFixed(1)} ms source selection; ${queueElapsedMs.toFixed(1)} ms queue summary for 100,000 sites; ${constructionRoadPerfElapsedMs.toFixed(1)} ms road audit; ${constructionFirePerfElapsedMs.toFixed(1)} ms fire-aware road audit for 100,000 buildings)`,
);
