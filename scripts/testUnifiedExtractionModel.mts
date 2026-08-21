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
    label: `Rich ${resource} deposit · 125 / 500 surface ${resource} remaining · underground ${resource} does not deplete · center a Quarry on this node`,
    level: 'deep',
  });
}

assert.equal(BUILDING_DEFINITIONS.stone_quarry.label, 'Mining Pit');
assert.equal(BUILDING_DEFINITIONS.large_quarry.label, 'Quarry');
for (const kind of ['stone_quarry', 'large_quarry'] as const) {
  for (const resource of ['stone', 'iron', 'salt', 'clay'] as const) {
    assert.ok(
      (BUILDING_STORAGE_CAPS[kind][resource] ?? 0) > 0,
      `${kind} must physically store ${resource}`,
    );
  }
}

assert.deepEqual(
  GATHERING_BUILD_MENU_ENTRIES
    .filter((entry) => entry.artKey === 'stone_quarry' || entry.artKey === 'large_quarry')
    .map((entry) => entry.artKey),
  ['stone_quarry', 'large_quarry'],
);
assert.equal(
  GATHERING_BUILD_MENU_ENTRIES.some((entry) => entry.artKey === 'mine' || entry.artKey === 'clay_pit'),
  false,
);
const cards = renderBuildMenuCards(GATHERING_BUILD_MENU_ENTRIES);
assert.match(cards, />Mining Pit</);
assert.match(cards, />Quarry</);
assert.match(cards, /stone, iron, salt, or clay from shallow surface deposits/);
assert.deepEqual(
  localMaterialInputCommodities('stone_quarry', { iron: 4, salt: 0, clay: 7 }),
  ['iron', 'clay'],
);
assert.deepEqual(
  localMaterialInputCommodities('large_quarry', { iron: 0, salt: 6, clay: 0 }),
  ['salt'],
);

const surfaceSimulation = fs.readFileSync('server/src/simulation/stone_quarry.rs', 'utf8');
const deepSimulation = fs.readFileSync('server/src/simulation/large_quarry.rs', 'utf8');
const remoteWorkCampPolicy = fs.readFileSync('src/buildings/remoteWorkCamp.ts', 'utf8');
assert.match(remoteWorkCampPolicy, /'stone_quarry'/);
assert.match(remoteWorkCampPolicy, /'large_quarry'/);
for (const commodity of ['Stone', 'Iron', 'Salt', 'Clay']) {
  assert.match(surfaceSimulation, new RegExp(`CommodityKind::${commodity}`));
  assert.match(deepSimulation, new RegExp(`CommodityKind::${commodity}`));
}
assert.match(surfaceSimulation, /remaining: \(deposit\.remaining - extracted\)\.max\(0\.0\)/);
assert.match(deepSimulation, /produces from its underground source without changing the surface reserve/);

console.log('Unified Mining Pit and Quarry model tests passed.');
