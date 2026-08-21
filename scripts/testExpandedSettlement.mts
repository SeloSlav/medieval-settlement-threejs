import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BUILDING_DEFINITIONS,
  BUILDING_COSTS,
  BUILDING_KINDS,
  BUILDING_STORAGE_CAPS,
  CARPENTER_CART_SERVICE_IRONWORK_PER_TRIP,
  CARPENTER_CART_SERVICE_TIMBER_PER_TRIP,
  CARPENTER_DELIVERY_SPEED_MULTIPLIER,
  CARPENTER_TIMBER_COST_MULTIPLIER,
  MONASTERY_COVERAGE_RADIUS,
  RESIDENCE_TIER1_CAPACITY,
  RESIDENCE_TIER2_CAPACITY,
  RESIDENCE_TIER3_CAPACITY,
} from '../src/generated/gameBalance.ts';
import {
  activeResidenceNeedKinds,
  createDefaultNeeds,
} from '../src/residences/residenceNeedState.ts';
import { evaluateResidenceNeedRecovery } from '../src/residences/residenceNeeds.ts';
import type { BuildingKind, BuildingState, ResidenceState } from '../src/resources/types.ts';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { validateBuildingPlacement } from '../src/buildings/BuildingPlacementValidation.ts';
import { pointWithinBuildingSiteClearance } from '../src/buildings/BuildingTerrainLayout.ts';
import { getBuildingExtent } from '../src/buildings/buildingExtents.ts';
import { createResidenceMesh } from '../src/residences/ResidenceMarkers.ts';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import {
  buildingCostWithCarpenterSupport,
  CARPENTER_CART_SERVICE_TARGET_PRESETS,
  carpenterCartServiceIronworkTarget,
  carpenterCartServiceReady,
  carpenterCartServiceTimberTarget,
  carpenterCartServiceTripsAvailable,
  carpenterDeliverySpeedMultiplier,
  hasRoadLinkedCarpenter,
  isOperationalCarpenter,
  normalizeCarpenterCartServiceTargetTrips,
  type CarpenterSupportBuilding,
} from '../src/economy/carpenterSupport.ts';
import { roadDeliveryTripSeconds } from '../src/logistics/deliveryLogistics.ts';
import { describeToolbarStatus } from '../src/ui/buildToolbarStatus.ts';

const expanded = [
  'threshing_barn', 'monastery', 'brewery', 'smokehouse', 'granary',
  'apiary', 'watermill', 'windmill', 'carpenter',
] as const;
for (const kind of expanded) {
  assert.ok(BUILDING_KINDS.includes(kind), `${kind} must remain a generated buildable kind`);
  assert.ok(BUILDING_DEFINITIONS[kind].label.length > 0, `${kind} needs player-facing copy`);
}
assert.equal(BUILDING_DEFINITIONS.watermill.requiresWaterShore, true);
assert.equal(BUILDING_DEFINITIONS.windmill.requiresWaterShore, false);
assert.equal(BUILDING_KINDS.some((kind) => kind.includes('ferry')), false);
assert.equal(BUILDING_DEFINITIONS.monastery.acceptsLabor, false);
assert.equal(BUILDING_DEFINITIONS.monastery.requiresHillside, true);
assert.equal(BUILDING_DEFINITIONS.monastery.workRadius, 0);
assert.equal(MONASTERY_COVERAGE_RADIUS, 520);
assert.deepEqual(
  getBuildingExtent('threshing_barn', BUILDING_DEFINITIONS.threshing_barn.workRadius),
  { type: 'work', label: 'Field work extent', radius: 250 },
);
assert.deepEqual(
  getBuildingExtent('monastery', BUILDING_DEFINITIONS.monastery.workRadius),
  { type: 'coverage', label: 'Faith coverage', radius: 520 },
);
assert.deepEqual(
  getBuildingExtent('apiary', BUILDING_DEFINITIONS.apiary.workRadius),
  { type: 'work', label: 'Bee forage extent', radius: 48 },
);
for (const kind of ['brewery', 'smokehouse', 'granary', 'watermill', 'windmill', 'carpenter'] as const) {
  assert.equal(BUILDING_DEFINITIONS[kind].workRadius, 0, `${kind} has no spatial work extent`);
  assert.equal(getBuildingExtent(kind, BUILDING_DEFINITIONS[kind].workRadius), null, `${kind} must not render an extent ring`);
}
assert.ok(BUILDING_STORAGE_CAPS.granary.grain > BUILDING_STORAGE_CAPS.threshing_barn.grain);
assert.deepEqual([RESIDENCE_TIER1_CAPACITY, RESIDENCE_TIER2_CAPACITY, RESIDENCE_TIER3_CAPACITY], [3, 6, 10]);

const roadlessPlacementContext = {
  buildings: [],
  residences: [],
  burgageZones: [],
  farmFields: [],
  quarries: [],
  foragingNodes: [],
  stockpile: { timber: 999, stone: 999 },
  isWaterAt: () => false,
  getNaturalHeightAt: () => 0,
  roadNetwork: new RoadNetwork(),
};
assert.equal(
  validateBuildingPlacement('carpenter', 0, 0, roadlessPlacementContext).ok,
  true,
  'roads must be connected after construction, not required for placement',
);
assert.equal(
  pointWithinBuildingSiteClearance(10, -6, { kind: 'watermill', x: 10, z: -6 }),
  true,
  'the construction pad must clear an obstacle at its center',
);
assert.equal(
  pointWithinBuildingSiteClearance(40, -6, { kind: 'watermill', x: 10, z: -6 }),
  false,
  'construction clearing must not expand to the functional work radius',
);

function buildingState(
  kind: BuildingKind,
  id: string,
  x: number,
  z: number,
  assignedLabor = 0,
): BuildingState {
  return {
    id,
    kind,
    x,
    z,
    workRadius: BUILDING_DEFINITIONS[kind].workRadius,
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
    ironwork: 0,
    polearms: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor,
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
  };
}

const carpenterRoad = new RoadNetwork();
carpenterRoad.addRoadPath([
  new THREE.Vector3(-20, 0, 0),
  new THREE.Vector3(140, 0, 0),
]);
const activeCarpenter = buildingState('carpenter', 'carpenter', 0, 18, 1);
activeCarpenter.timber = 3;
activeCarpenter.ironwork = 0.6;
const idleCarpenter = buildingState('carpenter', 'idle-carpenter', 0, 18, 0);
assert.equal(isOperationalCarpenter(activeCarpenter), true);
assert.equal(isOperationalCarpenter(idleCarpenter), false);
assert.equal(carpenterCartServiceReady(activeCarpenter), true);
assert.equal(carpenterCartServiceTripsAvailable(activeCarpenter), 15);
assert.deepEqual(
  CARPENTER_CART_SERVICE_TARGET_PRESETS.map((preset) => preset.trips),
  [0, 5, 15, 30],
);
assert.equal(
  validateBuildingPlacement('windmill', 0, 0, roadlessPlacementContext).ok,
  true,
  'windmills must be placeable on dry land without a river shore',
);
assert.equal(normalizeCarpenterCartServiceTargetTrips(undefined), 15);
assert.equal(normalizeCarpenterCartServiceTargetTrips(7), 15);
assert.equal(carpenterCartServiceTimberTarget(5), 1);
assert.equal(carpenterCartServiceIronworkTarget(5), 0.2);
const conservingCarpenter = {
  ...activeCarpenter,
  carpenterCartServiceTargetTrips: 0,
};
assert.equal(
  carpenterCartServiceReady(conservingCarpenter),
  false,
  'the workshop policy must be able to stop repair-kit consumption',
);
assert.equal(
  hasRoadLinkedCarpenter(
    [conservingCarpenter],
    carpenterRoad,
    { x: 100, z: 18 },
  ),
  true,
  'conserving fittings must retain the skilled construction discount',
);
assert.equal(
  carpenterCartServiceTripsAvailable({
    timber: CARPENTER_CART_SERVICE_TIMBER_PER_TRIP * 5,
    ironwork: CARPENTER_CART_SERVICE_IRONWORK_PER_TRIP * 2,
  }),
  2,
  'the scarcer physical repair input must cap accelerated departures',
);
assert.equal(
  hasRoadLinkedCarpenter([activeCarpenter], carpenterRoad, { x: 100, z: 18 }),
  true,
  'a staffed carpenter must support sites on its road component',
);
assert.equal(
  hasRoadLinkedCarpenter([idleCarpenter], carpenterRoad, { x: 100, z: 18 }),
  false,
  'an unstaffed carpenter must not grant economic bonuses',
);
assert.equal(
  hasRoadLinkedCarpenter(
    [activeCarpenter],
    carpenterRoad,
    { x: 100, z: 18 },
    new Set([activeCarpenter.id]),
  ),
  false,
  'a fire-disabled carpenter must not grant construction or cart bonuses',
);

const supportedSmokehouseCost = buildingCostWithCarpenterSupport('smokehouse', true);
assert.equal(
  supportedSmokehouseCost.timber,
  BUILDING_COSTS.smokehouse.timber * CARPENTER_TIMBER_COST_MULTIPLIER,
);
assert.equal(supportedSmokehouseCost.stone, BUILDING_COSTS.smokehouse.stone);
const discountedPlacementContext = {
  ...roadlessPlacementContext,
  roadNetwork: carpenterRoad,
  buildings: [activeCarpenter],
  stockpile: {
    timber: supportedSmokehouseCost.timber,
    stone: supportedSmokehouseCost.stone,
  },
};
assert.deepEqual(
  validateBuildingPlacement('smokehouse', 100, 18, discountedPlacementContext),
  { ok: true },
  'client placement affordability must accept the server carpenter discount',
);
const idleDiscountResult = validateBuildingPlacement('smokehouse', 100, 18, {
  ...discountedPlacementContext,
  buildings: [idleCarpenter],
});
assert.equal(idleDiscountResult.ok, false);
if (!idleDiscountResult.ok) assert.equal(idleDiscountResult.reason, 'insufficient_resources');

const baseTripSeconds = roadDeliveryTripSeconds(
  carpenterRoad,
  { x: 30, z: 18 },
  { x: 120, z: 18 },
  1,
  1,
  0,
);
const supportedSpeed = carpenterDeliverySpeedMultiplier(
  [activeCarpenter],
  carpenterRoad,
  { x: 30, z: 18 },
);
assert.equal(supportedSpeed, CARPENTER_DELIVERY_SPEED_MULTIPLIER);
assert.equal(
  carpenterDeliverySpeedMultiplier(
    [{ ...activeCarpenter, ironwork: 0 }],
    carpenterRoad,
    { x: 30, z: 18 },
  ),
  1,
  'staffing alone must not create a free cart-speed aura',
);
assert.equal(
  carpenterDeliverySpeedMultiplier(
    [conservingCarpenter],
    carpenterRoad,
    { x: 30, z: 18 },
  ),
  1,
  'a stocked carpenter with service disabled must not consume a kit or accelerate carts',
);
const supportedTripSeconds = roadDeliveryTripSeconds(
  carpenterRoad,
  { x: 30, z: 18 },
  { x: 120, z: 18 },
  1,
  1,
  0,
  supportedSpeed,
);
assert.ok(
  supportedTripSeconds < baseTripSeconds,
  'idle-trip projections must expose the carpenter cart-speed benefit',
);
const placementStatus = describeToolbarStatus({
  canBuild: true,
  hasDraft: false,
  mode: 'smokehouse',
  buildingCost: supportedSmokehouseCost,
  carpenterSupported: true,
  carpenterCartServiceReady: true,
});
assert.match(placementStatus, /carpenter-supported: 10% less timber; stocked wheelwright gives road carts \+18% speed/);
assert.match(placementStatus, new RegExp(`${supportedSmokehouseCost.timber} timber`));
assert.match(
  describeToolbarStatus({
    canBuild: true,
    hasDraft: false,
    mode: 'smokehouse',
    buildingCost: supportedSmokehouseCost,
    carpenterSupported: true,
    carpenterCartServiceEnabled: false,
    carpenterCartServiceReady: false,
  }),
  /cart service disabled to conserve fittings/,
);

const performanceCarpenters: CarpenterSupportBuilding[] = Array.from(
  { length: 100_000 },
  (_, index) => ({
    id: `mill-${index}`,
    kind: 'lumber_mill' as const,
    x: index,
    z: 200,
    constructionComplete: true,
    assignedLabor: 1,
  }),
);
performanceCarpenters.push(activeCarpenter);
const supportScanStarted = performance.now();
assert.equal(
  hasRoadLinkedCarpenter(performanceCarpenters, carpenterRoad, { x: 100, z: 18 }),
  true,
);
const supportScanElapsed = performance.now() - supportScanStarted;
assert.ok(
  supportScanElapsed < 500,
  `100k-building carpenter support scan regressed (${supportScanElapsed.toFixed(1)} ms)`,
);
const serviceScanStarted = performance.now();
assert.equal(
  carpenterDeliverySpeedMultiplier(
    performanceCarpenters,
    carpenterRoad,
    { x: 100, z: 18 },
  ),
  CARPENTER_DELIVERY_SPEED_MULTIPLIER,
);
const serviceScanElapsed = performance.now() - serviceScanStarted;
assert.ok(
  serviceScanElapsed < 500,
  `100k-building supplied cart-service scan regressed (${serviceScanElapsed.toFixed(1)} ms)`,
);

const closeShorePlacement = validateBuildingPlacement('watermill', 0, 0, {
  ...roadlessPlacementContext,
  isWaterAt: (x: number, z: number) => Math.hypot(x - 4, z) <= 0.75,
});
assert.equal(closeShorePlacement.ok, true, 'watermill placement must detect water within the close-bank sampling gap');

const distantShorePlacement = validateBuildingPlacement('watermill', 0, 0, {
  ...roadlessPlacementContext,
  isWaterAt: (x: number, z: number) => Math.hypot(x - 30, z) <= 0.75,
});
assert.equal(distantShorePlacement.ok, false);
if (!distantShorePlacement.ok) assert.equal(distantShorePlacement.reason, 'requires_shore');

const residence = (tier: 1 | 2 | 3): ResidenceState => ({
  id: `tier-${tier}`, zoneId: 'zone', parcelIndex: 0, x: 0, z: 0, yaw: 0,
  population: 1, populationCapacity: tier === 1 ? 3 : tier === 2 ? 6 : 10,
  tier, settlementTicks: 0, needs: createDefaultNeeds(), abandoned: false, householdWealth: 0,
});
const supply = { servingLodgeId: 'lodge', servingWellId: 'well', servingFoodSupplierId: 'food' };
assert.deepEqual(activeResidenceNeedKinds(1), ['food', 'firewood', 'water', 'church']);
assert.deepEqual(activeResidenceNeedKinds(2), ['food', 'firewood', 'water', 'church', 'foodVariety', 'cloth']);
assert.deepEqual(
  activeResidenceNeedKinds(3),
  ['food', 'firewood', 'water', 'church', 'foodVariety', 'cloth', 'preservedFood', 'ale', 'pottery'],
);
assert.equal(evaluateResidenceNeedRecovery(residence(1), supply).length, 3);
assert.equal(evaluateResidenceNeedRecovery(residence(2), supply).length, 3);
assert.equal(
  evaluateResidenceNeedRecovery(residence(3), supply).length,
  3,
  'vacant homes require food, water, and warmth for recovery; status goods do not gate survival',
);

for (const kind of expanded) {
  const model = createBuildingMesh(kind);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  let meshCount = 0;
  model.traverse((object) => { if (object instanceof THREE.Mesh) meshCount += 1; });
  assert.ok(meshCount >= 8, `${kind} needs a modeled silhouette, not a placeholder`);
  assert.ok([size.x, size.y, size.z].every(Number.isFinite), `${kind} bounds must be finite`);
  assert.ok(size.x > 1 && size.y > 1 && size.z > 1, `${kind} must have a visible three-dimensional footprint`);
}
const watermillModel = createBuildingMesh('watermill');
assert.ok(
  watermillModel.getObjectByName('Watermill wheel') instanceof THREE.Group,
  'the river-power animation needs one stable wheel group',
);
const windmillModel = createBuildingMesh('windmill');
assert.ok(
  windmillModel.getObjectByName('Windmill sails') instanceof THREE.Group,
  'the wind-power animation needs one stable sail group',
);

const tierSizes = ([1, 2, 3] as const).map((tier) =>
  new THREE.Box3().setFromObject(createResidenceMesh(42, tier)).getSize(new THREE.Vector3()),
);
assert.ok(tierSizes[0].x < tierSizes[1].x && tierSizes[1].x < tierSizes[2].x);
assert.ok(tierSizes[0].y < tierSizes[1].y && tierSizes[1].y < tierSizes[2].y);

const expandedSimulation = fs.readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
assert.match(
  expandedSimulation,
  /select_supply_route_candidate/,
  'specialist inputs and outputs should prefer short road routes',
);
assert.match(
  expandedSimulation,
  /building_has_inbound_supply_trip\(ctx, target\.id\)/,
  'a processor should not summon duplicate carts while an input haul is already in flight',
);
assert.match(
  expandedSimulation,
  /!target\.construction_complete/,
  'specialist goods should never be dispatched to unfinished buildings',
);
assert.doesNotMatch(
  expandedSimulation,
  /sources\.sort_by_key\(\|source\| source\.id\)/,
  'building age must not override industrial clustering and road layout',
);
assert.match(
  expandedSimulation,
  /let throughput_multiplier = environment\.watermill_throughput_multiplier\(\)[\s\S]*civilian_tool_throughput_multiplier\(building\.ironwork\)[\s\S]*step_processor_at_rate\([\s\S]*throughput_multiplier/,
  'authoritative watermill cycles must multiply live river power by maintained stone dressing',
);
const watermillInspector = fs.readFileSync(
  'src/resources/inspector/expandedBuildingRenderer.ts',
  'utf8',
);
assert.match(watermillInspector, /River power/);
assert.match(watermillInspector, /Shuts down all winter/);
assert.match(watermillInspector, /windmill on well-exposed ground/);
const resourceInspector = fs.readFileSync('src/resources/ResourceInspector.ts', 'utf8');
assert.match(resourceInspector, /row\.dataset\.tooltipTitle = label/);
assert.match(resourceInspector, /row\.dataset\.tooltip = detail/);
assert.doesNotMatch(resourceInspector, /Full ledger|data-inspector-ledger|secondaryDetailList/);
assert.doesNotMatch(
  resourceInspector,
  /row\.title = detail/,
  'inspector help must use the immediate styled tooltip instead of a delayed native title',
);
const buildingMarkers = fs.readFileSync('src/buildings/BuildingMarkers.ts', 'utf8');
assert.match(buildingMarkers, /watermillThroughputMultiplier/);
assert.match(buildingMarkers, /wheel\.rotation\.x/);
const placementReducer = fs.readFileSync('server/src/reducers/buildings.rs', 'utf8');
assert.match(
  placementReducer,
  /CARPENTER_TIMBER_COST_MULTIPLIER/,
  'client contextual costs must retain an authoritative server counterpart',
);
const deliverySimulation = fs.readFileSync('server/src/simulation/delivery_trips.rs', 'utf8');
assert.match(
  deliverySimulation,
  /carpenter_cart_service_ready[\s\S]*withdraw_building_commodity\([\s\S]*CARPENTER_CART_SERVICE_TIMBER_PER_TRIP[\s\S]*CARPENTER_CART_SERVICE_IRONWORK_PER_TRIP[\s\S]*CARPENTER_DELIVERY_SPEED_MULTIPLIER/,
  'the authoritative speed bonus must consume one physical wheelwright repair kit',
);
assert.match(
  expandedSimulation,
  /step_carpenter[\s\S]*carpenter_cart_service_timber_target[\s\S]*carpenter_cart_service_ironwork_target[\s\S]*request_connected_commodity/,
  'staffed wheelwrights must physically request both repair inputs',
);
assert.match(watermillInspector, /Repair kit/);
assert.match(watermillInspector, /protected timber/);
assert.match(watermillInspector, /data-carpenter-cart-service-target/);
const carpenterPolicy = fs.readFileSync(
  'src/economy/carpenterSupport.ts',
  'utf8',
);
assert.match(carpenterPolicy, /Conserve fittings/);
assert.match(carpenterPolicy, /Deep service/);
assert.match(
  placementReducer,
  /set_carpenter_cart_service_target[\s\S]*is_valid_carpenter_cart_service_target[\s\S]*carpenter_cart_service_target_trips = target_trips/,
  'cart-service depth must be an authoritative validated workshop policy',
);
const buildingSchema = fs.readFileSync('server/src/tables.rs', 'utf8');
assert.match(
  buildingSchema,
  /#\[default\(15u8\)\]\s+pub carpenter_cart_service_target_trips: u8/,
  'existing carpenters must retain the current fifteen-departure service depth',
);
const generatedBuilding = fs.readFileSync(
  'src/generated/building_table.ts',
  'utf8',
);
assert.match(generatedBuilding, /carpenterCartServiceTargetTrips/);
assert.ok(
  fs.existsSync('src/generated/set_carpenter_cart_service_target_reducer.ts'),
  'client bindings must include the cart-service policy reducer',
);

console.log('expanded settlement tests passed');
