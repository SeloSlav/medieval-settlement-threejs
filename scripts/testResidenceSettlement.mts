import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recoveryStockMin } from '../src/economy/chapelCommunity.ts';
import { residenceSettlementReadiness } from '../src/economy/residenceSettlement.ts';
import {
  createDefaultNeeds,
  type ResidenceCommunityContext,
  type ResidenceNeedKind,
} from '../src/residences/residenceNeedState.ts';
import type { ResidenceState } from '../src/resources/types.ts';

const noParish: ResidenceCommunityContext = {
  hasChapelAccess: false,
  hasMonasteryCoverage: false,
  sabbathObservance: false,
};

const vacant = residence(1, 0);
const vacantReadiness = residenceSettlementReadiness(vacant, noParish);
assert.equal(vacantReadiness.firstArrival, true);
assert.equal(vacantReadiness.ready, true, 'the first settler must establish the food delivery claim');

const tierOne = residence(1, 1);
const hungryReadiness = residenceSettlementReadiness(tierOne, noParish);
assert.equal(hungryReadiness.ready, false);
assert.deepEqual(hungryReadiness.waitingOn.map((buffer) => buffer.kind), ['food']);
stockToThreshold(tierOne, 'food', noParish);
assert.equal(residenceSettlementReadiness(tierOne, noParish).ready, true);

const tierTwo = residence(2, 3);
stockToThreshold(tierTwo, 'food', noParish);
stockToThreshold(tierTwo, 'firewood', noParish);
stockToThreshold(tierTwo, 'water', noParish);
assert.equal(residenceSettlementReadiness(tierTwo, noParish).ready, true);
tierTwo.needs.water.stock -= 0.1;
assert.deepEqual(
  residenceSettlementReadiness(tierTwo, noParish).waitingOn.map((buffer) => buffer.kind),
  ['water'],
);

const tierThree = residence(3, 6);
for (const kind of ['food', 'firewood', 'water', 'preservedFood', 'ale', 'cloth'] as const) {
  stockToThreshold(tierThree, kind, noParish);
}
assert.equal(residenceSettlementReadiness(tierThree, noParish).ready, true);
tierThree.needs.cloth.stock = 0;
assert.deepEqual(
  residenceSettlementReadiness(tierThree, noParish).waitingOn.map((buffer) => buffer.kind),
  ['cloth'],
  'prosperous-house growth must depend on the textile chain as well as food and drink',
);

const parish: ResidenceCommunityContext = {
  hasChapelAccess: true,
  hasMonasteryCoverage: true,
  sabbathObservance: true,
};
const parishHome = residence(2, 3);
for (const kind of ['food', 'firewood', 'water'] as const) {
  stockToThreshold(parishHome, kind, parish);
}
assert.equal(residenceSettlementReadiness(parishHome, parish).ready, true);
assert.ok(
  recoveryStockMin('food', parish.hasChapelAccess, parish.hasMonasteryCoverage)
    < recoveryStockMin('food', false, false),
  'parish and monastery support should retain their established buffer reduction',
);

const serverLifecycle = readFileSync(
  new URL('../server/src/simulation/residence_lifecycle.rs', import.meta.url),
  'utf8',
);
const serverSettlement = readFileSync(
  new URL('../server/src/simulation/residence_settlement.rs', import.meta.url),
  'utf8',
);
assert.match(
  serverLifecycle,
  /let needs = load_needs[\s\S]*?step_residence_settlement[\s\S]*?&needs[\s\S]*?step_residence_needs[\s\S]*?needs/,
  'growth and consumption must share one authoritative need-row load',
);
assert.match(serverSettlement, /settlement_buffers_ready\(residence\.population, buffers\)/);
assert.match(serverSettlement, /recovery_stock_min/);

console.log('residence settlement buffer tests passed');

function residence(tier: 1 | 2 | 3, population: number): ResidenceState {
  return {
    id: `tier-${tier}-${population}`,
    zoneId: 'zone',
    parcelIndex: 0,
    x: 0,
    z: 0,
    yaw: 0,
    population,
    populationCapacity: tier === 1 ? 3 : tier === 2 ? 6 : 10,
    tier,
    settlementTicks: 0,
    needs: createDefaultNeeds(),
    abandoned: false,
    householdWealth: 0,
  };
}

function stockToThreshold(
  target: ResidenceState,
  kind: ResidenceNeedKind,
  community: ResidenceCommunityContext,
): void {
  target.needs[kind].stock = recoveryStockMin(
    kind,
    community.hasChapelAccess,
    community.hasMonasteryCoverage,
  );
}
