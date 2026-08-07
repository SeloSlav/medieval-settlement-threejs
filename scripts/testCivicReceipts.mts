import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import {
  civicReceiptCollectionPlan,
  findPreferredCivicTreasurySeat,
  localCivicReceiptGold,
} from '../src/economy/civicReceipts.ts';
import { MONASTERY_PILGRIMAGE_GOLD_PER_DAY } from '../src/generated/gameBalance.ts';
import type { DeliveryTripState } from '../src/logistics/deliveryTrips.ts';
import { computeGoldAwaitingCollection } from '../src/resources/resourceTotals.ts';
import type { BuildingState } from '../src/resources/types.ts';
import { buildingMarkerCollectionSignature } from '../src/buildings/buildingMarkerSignature.ts';
import {
  createMonasteryMesh,
  LOCAL_RECEIPT_VISUAL_SEGMENTS,
} from '../src/buildings/meshes/expandedBuildingMeshes.ts';

function building(
  partial: Partial<BuildingState> & Pick<BuildingState, 'id' | 'kind' | 'x' | 'z'>,
): BuildingState {
  return {
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
    ...partial,
  };
}

function goldTrip(partial: Partial<DeliveryTripState> = {}): DeliveryTripState {
  return {
    id: 'trip-1',
    buildingId: 'monastery',
    residenceId: null,
    destinationKind: 'building',
    targetBuildingId: 'hall',
    cargoKind: 'gold',
    amount: 2.25,
    phase: 'outbound',
    x: 15,
    z: 0,
    progress: 5,
    speedMps: 1,
    unloadSeconds: 1,
    unloadRemaining: 0,
    deliveryWorkers: 1,
    freeHaulerWorkers: 0,
    pathDistance: 100,
    travelSpeedMultiplier: 1,
    routePolylineJson: '[[10,0],[100,0]]',
    ...partial,
  };
}

const monastery = building({
  id: 'monastery',
  kind: 'monastery',
  x: 20,
  z: 0,
  gold: 20,
  civicReceiptsGold: 3,
});
const foundingCamp = building({
  id: 'camp',
  kind: 'founders_camp',
  x: 50,
  z: 0,
});
const townHall = building({
  id: 'hall',
  kind: 'town_hall',
  x: 100,
  z: 0,
});
const market = building({
  id: 'market',
  kind: 'marketplace',
  x: 30,
  z: 0,
  gold: 14,
});

assert.equal(localCivicReceiptGold(monastery), 3);
assert.equal(
  localCivicReceiptGold({ ...monastery, civicReceiptsGold: 99 }),
  20,
  'the earmarked subset cannot exceed physical source coin',
);
assert.equal(localCivicReceiptGold(market), 0);
assert.equal(
  findPreferredCivicTreasurySeat([foundingCamp, townHall])?.id,
  townHall.id,
  'the completed Town Hall must supersede the founding lockbox',
);

const roadDistance = () => 90;
assert.equal(
  civicReceiptCollectionPlan({
    source: { ...monastery, gold: 1, civicReceiptsGold: 1 },
    buildings: [monastery, foundingCamp],
    trips: [],
    physicalEconomy: true,
    dispatchThreshold: MONASTERY_PILGRIMAGE_GOLD_PER_DAY,
    getRoadPathDistance: roadDistance,
  }).status,
  'accumulating',
);
assert.equal(
  civicReceiptCollectionPlan({
    source: monastery,
    buildings: [monastery, townHall],
    trips: [],
    physicalEconomy: true,
    dispatchThreshold: MONASTERY_PILGRIMAGE_GOLD_PER_DAY,
    getRoadPathDistance: () => null,
  }).status,
  'no-road',
);
assert.equal(
  civicReceiptCollectionPlan({
    source: monastery,
    buildings: [monastery, townHall],
    trips: [],
    physicalEconomy: true,
    dispatchThreshold: MONASTERY_PILGRIMAGE_GOLD_PER_DAY,
    getRoadPathDistance: roadDistance,
  }).status,
  'ready',
);
const moving = civicReceiptCollectionPlan({
  source: monastery,
  buildings: [monastery, townHall],
  trips: [goldTrip()],
  physicalEconomy: true,
  dispatchThreshold: MONASTERY_PILGRIMAGE_GOLD_PER_DAY,
  getRoadPathDistance: roadDistance,
});
assert.equal(moving.status, 'en-route');
assert.equal(moving.inTransitGold, 2.25);
assert.equal(
  civicReceiptCollectionPlan({
    source: monastery,
    buildings: [monastery],
    trips: [],
    physicalEconomy: true,
    dispatchThreshold: MONASTERY_PILGRIMAGE_GOLD_PER_DAY,
    getRoadPathDistance: roadDistance,
  }).status,
  'no-treasury',
);
assert.equal(
  civicReceiptCollectionPlan({
    source: monastery,
    buildings: [monastery, townHall],
    trips: [],
    physicalEconomy: false,
    dispatchThreshold: MONASTERY_PILGRIMAGE_GOLD_PER_DAY,
    getRoadPathDistance: roadDistance,
  }).status,
  'legacy',
);

assert.equal(
  computeGoldAwaitingCollection([market, monastery, townHall]),
  17,
  'the HUD must include market receipts plus only the civic subset of local purses',
);

for (const [mesh, containerName, segmentName] of [
  [createMonasteryMesh(), 'MonasteryTreasuryChest', 'MonasteryGoldSegment'],
] as const) {
  const container = mesh.getObjectByName(containerName);
  assert.ok(container);
  assert.equal(
    container.children.filter((child) => child.name === segmentName).length,
    LOCAL_RECEIPT_VISUAL_SEGMENTS,
  );
  assert.equal(container.visible, false);
}

assert.notEqual(
  buildingMarkerCollectionSignature(new Map([[monastery.id, { ...monastery, gold: 2 }]])),
  buildingMarkerCollectionSignature(new Map([[monastery.id, { ...monastery, gold: 12 }]])),
  'the mixed monastery purse should visibly reflect its total physical coin',
);

const expandedServer = readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
const receiptServer = readFileSync('server/src/simulation/civic_receipts.rs', 'utf8');
const receiptEconomy = readFileSync('server/src/economy/civic_receipts.rs', 'utf8');
const deliveryServer = readFileSync('server/src/simulation/delivery_trips.rs', 'utf8');
const securityServer = readFileSync('server/src/simulation/settlement_security.rs', 'utf8');
const tableServer = readFileSync('server/src/tables.rs', 'utf8');
const inspector = readFileSync(
  'src/resources/inspector/expandedBuildingRenderer.ts',
  'utf8',
);
const removedContent = readFileSync('server/src/simulation/removed_content.rs', 'utf8');

assert.doesNotMatch(
  expandedServer,
  /credit_treasury_gold/,
  'local income sources must not teleport coin into the civic treasury',
);
assert.match(
  expandedServer,
  /step_monastery[\s\S]*credit_local_civic_receipts[\s\S]*try_dispatch_local_civic_receipts[\s\S]*step_carpenter/,
);
assert.doesNotMatch(
  expandedServer,
  /step_ferry_landing/,
  'removed ferry gameplay must not remain in the active economy loop',
);
assert.match(removedContent, /ferry_landing[\s\S]*salvage_pile/);
assert.match(receiptServer, /available_free_haulers/);
assert.match(receiptServer, /physical_treasury_seat/);
assert.match(receiptServer, /try_start_building_supply_trip/);
assert.match(receiptServer, /civic_receipt_cart_load/);
assert.match(
  receiptEconomy,
  /physical_founding_site_enabled[\s\S]*if !physical[\s\S]*credit_treasury_gold[\s\S]*let deposited = deposit_building_commodity/,
  'new saves stage receipts locally while legacy saves retain direct credit',
);
assert.match(deliveryServer, /restore_local_civic_receipts/);
assert.match(securityServer, /civic_receipts_gold[\s\S]*min\(building\.gold\.max\(0\.0\)\)/);
assert.match(
  tableServer,
  /#\[default\(0\.0\)\]\s+pub civic_receipts_gold: f64/,
  'the schema addition must default safely for existing saves',
);
assert.doesNotMatch(inspector, /Fare income/);
assert.match(inspector, /Civic visitor gifts/);
assert.match(inspector, /Civic collection/);

const perfBuildings = [monastery, townHall];
const started = performance.now();
let checksum = 0;
for (let index = 0; index < 100_000; index += 1) {
  checksum += civicReceiptCollectionPlan({
    source: {
      ...monastery,
      gold: index % 30,
      civicReceiptsGold: index % 30,
    },
    buildings: perfBuildings,
    trips: [],
    physicalEconomy: true,
    dispatchThreshold: MONASTERY_PILGRIMAGE_GOLD_PER_DAY,
    getRoadPathDistance: roadDistance,
  }).heldGold;
}
const elapsed = performance.now() - started;
assert.ok(checksum > 0);
assert.ok(elapsed < 500, `100k civic receipt plans regressed (${elapsed.toFixed(1)} ms)`);

console.log(
  `civic receipt logistics tests passed (${elapsed.toFixed(1)} ms for 100k plans)`,
);
