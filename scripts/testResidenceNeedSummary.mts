import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  residenceFoodNeedSources,
  residenceNeedIsMet,
  residenceNeedSource,
} from '../src/resources/inspector/residenceRenderer.ts';
import type { ResidenceState } from '../src/resources/types.ts';
import { createDefaultNeeds } from '../src/residences/residenceNeedState.ts';
import { residenceFoodShortageActive } from '../src/residences/residenceNeeds.ts';

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
assert.equal(residenceNeedSource(stockedHome, 'food')?.key, 'oatGrain');
assert.equal(residenceNeedSource(stockedHome, 'foodVariety')?.key, 'oatGrain');
stockedHome.needs.food.deficitTicks = 1;
assert.equal(
  residenceNeedIsMet(stockedHome, 'food'),
  false,
  'stock must not conceal an already-recorded failed food bill',
);
assert.equal(
  residenceFoodShortageActive(stockedHome),
  false,
  'a full meal in the pantry must stop an old failed bill presenting as active starvation',
);
const unfedHome = residence();
unfedHome.needs.food.deficitTicks = 1;
assert.equal(residenceFoodShortageActive(unfedHome), true);

const fullTierOneHome = residence({ population: 3, ryeBread: 1 });
fullTierOneHome.needs.food.deficitTicks = 1;
assert.equal(
  residenceFoodShortageActive(fullTierOneHome),
  false,
  'one rye bread must recover a full Tier-1 household from active starvation',
);

const tierThreeHome = residence({ tier: 3 });
tierThreeHome.needs.church.stock = 1;
assert.equal(residenceNeedIsMet(tierThreeHome, 'church'), false);
tierThreeHome.needs.church.stock = 2;
assert.equal(residenceNeedIsMet(tierThreeHome, 'church'), true);

const alternativeHome = residence({
  tier: 4,
  curedMeat: 2,
  smokedFish: 5,
});
alternativeHome.needs.firewood = { stock: 8, deficitTicks: 0, sourceKind: 22 };
alternativeHome.needs.ale = { stock: 4, deficitTicks: 0, sourceKind: 55 };
alternativeHome.needs.preservedFood.stock = 7;
alternativeHome.needs.luxury = { stock: 1, deficitTicks: 0, sourceKind: 65_534 };
assert.equal(residenceNeedSource(alternativeHome, 'firewood')?.key, 'charcoal');
assert.equal(
  residenceNeedSource(alternativeHome, 'ale')?.key,
  'cider',
  'commodity 55 must resolve to the unified cider resource',
);
assert.equal(residenceNeedSource(alternativeHome, 'preservedFood')?.key, 'smokedFish');
assert.equal(residenceNeedSource(alternativeHome, 'luxury')?.key, 'luxuryFlowers');
alternativeHome.needs.luxury.sourceKind = 8;
assert.equal(residenceNeedSource(alternativeHome, 'luxury')?.key, 'honey');

const css = readFileSync(new URL('../src/ui/polishedGameUi.css', import.meta.url), 'utf8');
assert.doesNotMatch(
  css,
  /residence-need-icon:hover[\s\S]{0,120}(?:border-color|background)/,
  'live inspector refreshes must not restart a hover border/background effect',
);
assert.match(css, /residence-need-icon__source[\s\S]{0,220}width: 15px/);
assert.match(css, /residence-need-icon__source--action[\s\S]{0,220}inspector-action-icon/);

const residenceNeedBinding = readFileSync(
  new URL('../src/generated/residence_need_table.ts', import.meta.url),
  'utf8',
);
assert.match(residenceNeedBinding, /sourceKind:\s*__t\.u16\(\)\.name\("source_kind"\)/);

console.log('residence need summary tests passed');
