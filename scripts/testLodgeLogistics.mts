import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { residenceFirewoodRunwaySeconds, residenceHasFirewoodRoom } from '../src/logistics/firewoodLogistics.ts';
import {
  lodgeFirewoodPerDelivery,
  lodgeLaborAlternates,
  lodgeLaborSplit,
} from '../src/logistics/lodgeLogistics.ts';
import { compareResidencesForDelivery } from '../src/logistics/roadLogistics.ts';
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

assert.deepEqual(lodgeLaborSplit(0), { processing: 0, delivering: 0 });
assert.deepEqual(lodgeLaborSplit(1), { processing: 1, delivering: 1 });
assert.deepEqual(lodgeLaborSplit(3), { processing: 2, delivering: 1 });
assert.equal(lodgeLaborAlternates(1), true);
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

const lodgeSimulation = readFileSync(
  'server/src/simulation/woodcutters_lodge.rs',
  'utf8',
);
assert.match(
  lodgeSimulation,
  /row\.kind != "lumber_mill"[\s\S]*tick\.building_disabled_by_fire\(ctx, row\.id\)/,
  'lodges must not dispatch timber out of fire-disabled lumber mills',
);

console.log('lodge logistics tests passed');
