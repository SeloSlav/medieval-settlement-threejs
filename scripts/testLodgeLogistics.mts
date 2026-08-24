import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  residenceFirewoodPriorityTarget,
  residenceFirewoodRunwaySeconds,
  residenceHasFirewoodRoom,
  residenceNeedsPriorityFirewood,
} from '../src/logistics/firewoodLogistics.ts';
import {
  lodgeFirewoodPerDelivery,
  lodgeLaborAlternates,
  lodgeLaborSplit,
  lodgeSustainedProcessingLabor,
} from '../src/logistics/lodgeLogistics.ts';
import {
  compareResidencesForDelivery,
  peekNextDeliveryTarget,
} from '../src/logistics/roadLogistics.ts';
import { createDefaultNeeds, mergeNeedRow } from '../src/residences/residenceNeedState.ts';
import { computeUnreservedBuildingTimber } from '../src/resources/resourceTotals.ts';
import {
  normalizeWoodcutterTimberReserve,
  timberAboveWoodcutterReserve,
  woodcutterCanProcess,
  WOODCUTTER_TIMBER_RESERVE_MAX,
  WOODCUTTER_TIMBER_RESERVE_PRESETS,
} from '../src/economy/woodcutterPolicy.ts';
import { resolveWoodcuttersLodgeStatus } from '../src/resources/inspector/woodcuttersLodgeStatus.ts';
import type { BuildingState, GameState, ResidenceState } from '../src/resources/types.ts';

function residence(id: string, firewoodStock: number, population = 4): ResidenceState {
  return {
    id,
    zoneId: 'zone-1',
    parcelIndex: 0,
    x: 0,
    z: 0,
    yaw: 0,
    population,
    populationCapacity: population,
    settlementTicks: 0,
    needs: mergeNeedRow(createDefaultNeeds(), 'firewood', {
      stock: firewoodStock,
      deficitTicks: 0,
    }),
    abandoned: false,
  };
}

assert.deepEqual(lodgeLaborSplit(0), { processing: 0, delivering: 1 });
assert.deepEqual(lodgeLaborSplit(0, 0), { processing: 0, delivering: 0 });
assert.deepEqual(lodgeLaborSplit(1), { processing: 1, delivering: 1 });
assert.deepEqual(lodgeLaborSplit(3), { processing: 3, delivering: 1 });
assert.equal(lodgeLaborAlternates(1), false);
assert.equal(lodgeLaborAlternates(2), false);
assert.equal(lodgeFirewoodPerDelivery(2), lodgeFirewoodPerDelivery(1) * 2);

const lowStock = residence('low', 2);
const highStock = residence('high', 20);
assert.ok(
  (residenceFirewoodRunwaySeconds(lowStock) ?? Infinity)
    < (residenceFirewoodRunwaySeconds(highStock) ?? Infinity),
);
assert.equal(residenceHasFirewoodRoom(40), false);
assert.equal(residenceHasFirewoodRoom(10), true);
assert.equal(residenceFirewoodPriorityTarget(4), 9.6);
assert.equal(residenceFirewoodPriorityTarget(10), 24);
assert.equal(residenceNeedsPriorityFirewood(residence('below-floor', 9.59, 4)), true);
assert.equal(residenceNeedsPriorityFirewood(residence('at-floor', 9.6, 4)), false);
assert.equal(
  residenceFirewoodPriorityTarget(10) < 40,
  true,
  'a full tier-three household must eventually release its distributor cart to industry',
);
const directDistanceNetwork = {
  getPathfinder: () => ({
    roadPathDistance: (ax: number, az: number, bx: number, bz: number) =>
      Math.hypot(bx - ax, bz - az),
  }),
} as Parameters<typeof peekNextDeliveryTarget>[0];
assert.equal(
  peekNextDeliveryTarget(
    directDistanceNetwork,
    { x: 0, z: 0 },
    [residence('covered', 9.6), residence('exposed', 9.59)],
  )?.id,
  'exposed',
);
assert.equal(
  peekNextDeliveryTarget(
    directDistanceNetwork,
    { x: 0, z: 0 },
    [residence('covered', 9.6)],
  ),
  null,
  'client logistics must expose industrial fuel duty once every home reaches its floor',
);

const network = {
  nodes: new Map(),
  edges: new Map(),
} as Parameters<typeof compareResidencesForDelivery>[0];

assert.equal(
  compareResidencesForDelivery(network, { x: 0, z: 0 }, lowStock, highStock) < 0,
  true,
);

assert.equal(woodcutterCanProcess(3, 0, 3), true);
assert.equal(woodcutterCanProcess(2.99, 0, 3), false);
assert.equal(woodcutterCanProcess(43, 40, 3), true);
assert.equal(woodcutterCanProcess(42.99, 40, 3), false);
assert.equal(normalizeWoodcutterTimberReserve(-5), 0);
assert.equal(normalizeWoodcutterTimberReserve(39.6), 40);
assert.equal(normalizeWoodcutterTimberReserve(1_000), WOODCUTTER_TIMBER_RESERVE_MAX);
assert.equal(timberAboveWoodcutterReserve(87, 40), 47);
assert.equal(lodgeSustainedProcessingLabor(0), 0);
assert.equal(lodgeSustainedProcessingLabor(1), 1);
assert.equal(lodgeSustainedProcessingLabor(4), 4);
assert.deepEqual(
  WOODCUTTER_TIMBER_RESERVE_PRESETS.map(({ reserve }) => reserve),
  [0, 40, 100, 200],
);

const stockState = {
  buildings: new Map<string, BuildingState>([
    ['mill', {
      timber: 100,
      constructionComplete: true,
      constructionReservedTimber: 0,
      constructionTreasuryTimber: 0,
    } as BuildingState],
    ['lodge', {
      timber: 10,
      constructionComplete: true,
      constructionReservedTimber: 0,
      constructionTreasuryTimber: 0,
    } as BuildingState],
    ['site', {
      timber: 0,
      constructionComplete: false,
      constructionReservedTimber: 50,
      constructionTreasuryTimber: 20,
    } as BuildingState],
  ]),
} as GameState;
assert.equal(computeUnreservedBuildingTimber(stockState), 80);

const heldStatus = resolveWoodcuttersLodgeStatus({
  onRoad: true,
  assignedLabor: 1,
  connectedMillCount: 1,
  millsWithTimber: 1,
  timber: 0,
  firewood: 0,
  claimedResidenceCount: 2,
  crew: lodgeLaborSplit(1),
  tripRemainingSeconds: null,
  activeTrip: null,
  inboundTimberTrip: null,
  timberTripRemainingSeconds: null,
  nextTargetLabel: 'Parcel #1',
  hasNextTarget: true,
  activeDestinationLabel: 'Parcel #1',
  hasIndustrialTarget: false,
  industrialTargetLabel: 'industry',
  firewoodPerTrip: lodgeFirewoodPerDelivery(1),
  canDeliver: false,
  availableUnreservedTimber: 40,
  timberReserve: 40,
  timberPerCycle: 3,
});
assert.match(heldStatus.statusText, /Holding timber for construction/);
assert.equal(heldStatus.statusState, 'warning');

const noDemandStatus = resolveWoodcuttersLodgeStatus({
  onRoad: true,
  assignedLabor: 1,
  connectedMillCount: 1,
  millsWithTimber: 1,
  timber: 3,
  firewood: 6,
  claimedResidenceCount: 0,
  crew: lodgeLaborSplit(1),
  tripRemainingSeconds: null,
  activeTrip: null,
  inboundTimberTrip: null,
  timberTripRemainingSeconds: null,
  nextTargetLabel: 'Protected household reserves covered',
  hasNextTarget: false,
  activeDestinationLabel: 'Protected household reserves covered',
  hasIndustrialTarget: false,
  industrialTargetLabel: 'industry',
  firewoodPerTrip: lodgeFirewoodPerDelivery(1),
  canDeliver: false,
  availableUnreservedTimber: 100,
  timberReserve: 0,
  timberPerCycle: 3,
});
assert.equal(noDemandStatus.statusText, '');
assert.equal(noDemandStatus.statusState, 'idle');

const lodgeSimulation = readFileSync(
  'server/src/simulation/woodcutters_lodge.rs',
  'utf8',
);
assert.match(
  lodgeSimulation,
  /row\.kind != "lumber_mill"[\s\S]*tick\.building_disabled_by_fire\(ctx, row\.id\)/,
  'lodges must not dispatch timber out of fire-disabled lumber mills',
);
assert.doesNotMatch(
  lodgeSimulation,
  /ResidenceNeedKind|household_firewood_needs_priority|try_start_delivery_trip/,
  'woodcutters must remain at production and never deliver firewood directly to homes',
);

console.log('lodge logistics tests passed');
