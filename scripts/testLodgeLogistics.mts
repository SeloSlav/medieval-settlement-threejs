import assert from 'node:assert/strict';
import { residenceFirewoodRunwaySeconds, residenceHasFirewoodRoom } from '../src/logistics/firewoodLogistics.ts';
import {
  lodgeFirewoodPerDelivery,
  lodgeLaborAlternates,
  lodgeLaborSplit,
} from '../src/logistics/lodgeLogistics.ts';
import { compareResidencesForDelivery } from '../src/logistics/roadLogistics.ts';
import { createDefaultNeeds, mergeNeedRow } from '../src/residences/residenceNeedState.ts';
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

console.log('lodge logistics tests passed');
