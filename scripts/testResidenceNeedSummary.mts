import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  residenceFoodNeedSources,
  residenceNeedIsMet,
} from '../src/resources/inspector/residenceRenderer.ts';
import type { ResidenceState } from '../src/resources/types.ts';
import { createDefaultNeeds } from '../src/residences/residenceNeedState.ts';

function residence(overrides: Partial<ResidenceState> = {}): ResidenceState {
  return {
    id: 'need-summary-home',
    zoneId: 'need-summary-zone',
    parcelIndex: 0,
    x: 0,
    z: 0,
    yaw: 0,
    population: 1,
    populationCapacity: 4,
    tier: 1,
    settlementTicks: 0,
    needs: createDefaultNeeds(),
    abandoned: false,
    householdWealth: 0,
    foodInventoryMigrated: true,
    ...overrides,
  };
}

const emptyHome = residence();
assert.equal(
  residenceNeedIsMet(emptyHome, 'food'),
  false,
  'an empty new household must not look fed before its first monthly bill',
);
assert.equal(residenceNeedIsMet(emptyHome, 'firewood'), false);
assert.equal(residenceNeedIsMet(emptyHome, 'church'), false);

const stockedHome = residence({ ryeBread: 3, fish: 4, oatGrain: 10 });
stockedHome.needs.food.stock = 12;
const sources = residenceFoodNeedSources(stockedHome);
assert.deepEqual(
  sources.map(({ kind }) => kind),
  ['oatGrain', 'fish', 'ryeBread'],
  'the visible sub-icon should select the pantry food with the most meal-equivalents',
);
assert.equal(residenceNeedIsMet(stockedHome, 'food'), true);
stockedHome.needs.food.deficitTicks = 1;
assert.equal(
  residenceNeedIsMet(stockedHome, 'food'),
  false,
  'stock must not conceal an already-recorded failed food bill',
);

const tierThreeHome = residence({ tier: 3 });
tierThreeHome.needs.church.stock = 1;
assert.equal(residenceNeedIsMet(tierThreeHome, 'church'), false);
tierThreeHome.needs.church.stock = 2;
assert.equal(residenceNeedIsMet(tierThreeHome, 'church'), true);

const css = readFileSync(new URL('../src/ui/polishedGameUi.css', import.meta.url), 'utf8');
assert.doesNotMatch(
  css,
  /residence-need-icon:hover[\s\S]{0,120}(?:border-color|background)/,
  'live inspector refreshes must not restart a hover border/background effect',
);
assert.match(css, /residence-need-icon__source[\s\S]{0,220}width: 15px/);

console.log('residence need summary tests passed');
