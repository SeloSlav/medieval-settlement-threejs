import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  BUILDING_DEFINITIONS,
  BUILDING_STORAGE_CAPS,
} from '../src/generated/gameBalance.ts';
import { describeGeologicalMapMarker } from '../src/map/geologicalMapMarkerState.ts';
import { localMaterialInputCommodities } from '../src/logistics/processorInputLogistics.ts';
import {
  GATHERING_BUILD_MENU_ENTRIES,
  renderBuildMenuCards,
} from '../src/ui/buildMenuCards.ts';

for (const resource of ['stone', 'iron', 'salt', 'clay'] as const) {
  const presentation = describeGeologicalMapMarker(
    { label: `Rich ${resource} deposit` },
    {
      nodeId: `rich-${resource}`,
      kind: 'quarry',
      resource,
      remaining: 125,
      maxYield: 500,
      x: 0,
      z: 0,
      isRich: true,
    },
  );
  assert.deepEqual(presentation, {
    label: `Rich ${resource} deposit · 125 / 500 surface ${resource} remaining · underground ${resource} does not deplete · center ${resource === 'stone' ? 'Quarry' : 'Mineworks'} on this node`,
    level: 'deep',
  });
}

assert.equal(BUILDING_DEFINITIONS.stone_quarry.label, 'Mining Pit');
assert.equal(BUILDING_DEFINITIONS.large_quarry.label, 'Quarry');
assert.equal(BUILDING_DEFINITIONS.mine.label, 'Mineworks');
for (const resource of ['stone', 'iron', 'salt', 'clay'] as const) {
  assert.ok(
    (BUILDING_STORAGE_CAPS.stone_quarry[resource] ?? 0) > 0,
    `the Mining Pit must physically store surface ${resource}`,
  );
}
assert.ok((BUILDING_STORAGE_CAPS.large_quarry.stone ?? 0) > 0);
assert.equal(BUILDING_STORAGE_CAPS.large_quarry.iron ?? 0, 0);
assert.equal(BUILDING_STORAGE_CAPS.large_quarry.salt ?? 0, 0);
assert.equal(BUILDING_STORAGE_CAPS.large_quarry.clay ?? 0, 0);
for (const resource of ['iron', 'salt', 'clay'] as const) {
  assert.ok(
    (BUILDING_STORAGE_CAPS.mine[resource] ?? 0) > 0,
    `Mineworks must physically store rich ${resource}`,
  );
}
assert.equal(BUILDING_STORAGE_CAPS.mine.stone ?? 0, 0);

assert.deepEqual(
  GATHERING_BUILD_MENU_ENTRIES
    .filter((entry) => (
      entry.artKey === 'stone_quarry'
      || entry.artKey === 'large_quarry'
      || entry.artKey === 'mine'
    ))
    .map((entry) => entry.artKey),
  ['stone_quarry', 'large_quarry', 'mine'],
);
assert.equal(
  GATHERING_BUILD_MENU_ENTRIES.some((entry) => entry.artKey === 'clay_pit'),
  false,
);
const cards = renderBuildMenuCards(GATHERING_BUILD_MENU_ENTRIES);
assert.match(cards, />Mining Pit</);
assert.match(cards, />Quarry</);
assert.match(cards, />Mineworks</);
assert.match(cards, /stone, iron, salt, or clay from shallow surface deposits/);
assert.match(cards, /rich stone/);
assert.match(cards, /rich iron, salt, or clay/);
assert.deepEqual(
  localMaterialInputCommodities('stone_quarry', { iron: 4, salt: 0, clay: 7 }),
  ['iron', 'clay'],
);
assert.deepEqual(
  localMaterialInputCommodities('large_quarry', { iron: 0, salt: 6, clay: 0 }),
  [],
);
assert.deepEqual(
  localMaterialInputCommodities('mine', { iron: 4, salt: 6, clay: 7 }),
  ['iron', 'salt', 'clay'],
);

const surfaceSimulation = fs.readFileSync('server/src/simulation/stone_quarry.rs', 'utf8');
const quarrySimulation = fs.readFileSync('server/src/simulation/large_quarry.rs', 'utf8');
const mineworksSimulation = fs.readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
const extractionPolicy = fs.readFileSync('server/src/extraction_policy.rs', 'utf8');
const remoteWorkCampPolicy = fs.readFileSync('src/buildings/remoteWorkCamp.ts', 'utf8');
assert.match(remoteWorkCampPolicy, /'stone_quarry'/);
assert.match(remoteWorkCampPolicy, /'large_quarry'/);
assert.match(remoteWorkCampPolicy, /'mine'/);
assert.match(surfaceSimulation, /finite surface reserve of stone, iron, salt, or clay/);
assert.match(surfaceSimulation, /SurfaceDeposit::Geological/);
assert.match(surfaceSimulation, /SurfaceDeposit::Clay/);
assert.match(surfaceSimulation, /remaining: crate::resource_units::whole_units\(deposit\.remaining\) - batch/);
assert.match(quarrySimulation, /quarry_geological_commodity/);
assert.match(quarrySimulation, /without changing the finite surface reserve/);
assert.match(mineworksSimulation, /mineworks_commodity_beneath/);
assert.match(mineworksSimulation, /CommodityKind::Clay => MINE_CLAY_PER_CYCLE/);
assert.match(extractionPolicy, /fn quarry_accepts_only_rich_stone/);
assert.match(extractionPolicy, /fn mineworks_accepts_only_rich_iron_salt_and_clay/);

console.log('Unified Mining Pit, Quarry, and Mineworks model tests passed.');
