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
import {
  BUILDING_DEFINITIONS,
  BUILDING_STORAGE_CAPS,
  LODGE_FIREWOOD_PER_CYCLE,
  LODGE_TIMBER_PER_CYCLE,
  LODGE_TIMBER_PER_DELIVERY,
  RESIDENCE_FIREWOOD_CAPACITY,
} from '../src/generated/gameBalance.ts';
import { resolveWoodcuttersLodgeStatus } from '../src/resources/inspector/woodcuttersLodgeStatus.ts';
import { effectiveTreeWorkArea } from '../src/resources/treeWorkArea.ts';
import type { ResidenceState } from '../src/resources/types.ts';

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
assert.equal(residenceHasFirewoodRoom(RESIDENCE_FIREWOOD_CAPACITY), false);
assert.equal(residenceHasFirewoodRoom(10), true);
const householdPriorityTarget = residenceFirewoodPriorityTarget(4);
assert.ok(householdPriorityTarget > 0);
assert.equal(
  residenceFirewoodPriorityTarget(10),
  householdPriorityTarget,
  'one occupied residence owes one household fuel bill regardless of population tier',
);
assert.equal(
  residenceNeedsPriorityFirewood(residence('below-floor', householdPriorityTarget - 0.01, 4)),
  true,
);
assert.equal(
  residenceNeedsPriorityFirewood(residence('at-floor', householdPriorityTarget, 4)),
  false,
);
assert.equal(
  householdPriorityTarget < RESIDENCE_FIREWOOD_CAPACITY,
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
    [
      residence('covered', householdPriorityTarget),
      residence('exposed', householdPriorityTarget - 0.01),
    ],
  )?.id,
  'exposed',
);
assert.equal(
  peekNextDeliveryTarget(
    directDistanceNetwork,
    { x: 0, z: 0 },
    [residence('covered', householdPriorityTarget)],
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

assert.equal(lodgeSustainedProcessingLabor(0), 0);
assert.equal(lodgeSustainedProcessingLabor(1), 1);
assert.equal(lodgeSustainedProcessingLabor(4), 4);
assert.equal(LODGE_TIMBER_PER_CYCLE, 0);
assert.equal(LODGE_TIMBER_PER_DELIVERY, 0);
assert.equal(LODGE_FIREWOOD_PER_CYCLE, 5);
assert.equal(BUILDING_STORAGE_CAPS.woodcutters_lodge.timber, 0);
assert.equal(BUILDING_DEFINITIONS.woodcutters_lodge.requiresMatureTrees, true);
assert.ok(BUILDING_DEFINITIONS.woodcutters_lodge.workRadius > 0);
assert.equal(
  effectiveTreeWorkArea({
    kind: 'woodcutters_lodge',
    x: 10,
    z: 20,
    workRadius: 0,
  }).radius,
  BUILDING_DEFINITIONS.woodcutters_lodge.workRadius,
  'lodges from older saves must inherit the new authored tree-harvesting radius',
);

const noTreesStatus = resolveWoodcuttersLodgeStatus({
  assignedLabor: 1,
  matureTrees: 0,
  firewood: 0,
  firewoodRoom: 47,
  claimedResidenceCount: 2,
  crew: lodgeLaborSplit(1),
  tripRemainingSeconds: null,
  activeTrip: null,
  activeDestinationLabel: 'Parcel #1',
  hasIndustrialTarget: false,
  industrialTargetLabel: 'industry',
});
assert.match(noTreesStatus.statusText, /No mature trees/);
assert.equal(noTreesStatus.statusState, 'warning');

const harvestingStatus = resolveWoodcuttersLodgeStatus({
  assignedLabor: 1,
  matureTrees: 12,
  firewood: 0,
  firewoodRoom: 47,
  claimedResidenceCount: 0,
  crew: lodgeLaborSplit(1),
  tripRemainingSeconds: null,
  activeTrip: null,
  activeDestinationLabel: 'Protected household reserves covered',
  hasIndustrialTarget: false,
  industrialTargetLabel: 'industry',
});
assert.match(harvestingStatus.statusText, /Harvesting firewood from 12 mature trees/);
assert.equal(harvestingStatus.statusState, 'active');

const lodgeSimulation = readFileSync(
  'server/src/simulation/woodcutters_lodge.rs',
  'utf8',
);
assert.match(
  lodgeSimulation,
  /super::forestry::step_forestry/,
  'lodges must use the shared fallen-tree and finite-log production pipeline',
);
assert.doesNotMatch(
  lodgeSimulation,
  /try_start_timber_supply_trip|LODGE_TIMBER_PER_CYCLE|woodcutter_can_process|CommodityKind::Timber/,
  'lodge production must not consume construction timber or request it from lumber mills',
);
assert.doesNotMatch(
  lodgeSimulation,
  /ResidenceNeedKind|household_firewood_needs_priority|try_start_delivery_trip/,
  'woodcutters must remain at production and never deliver firewood directly to homes',
);

console.log('lodge logistics tests passed');
