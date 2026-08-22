import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  illustratedMapDeskAlphaAt,
  illustratedMapDeskColourGainAt,
  illustratedMapDeskMetrics,
  ILLUSTRATED_MAP_DESK_ALPHA_FADE_START,
  ILLUSTRATED_MAP_DESK_FADE_START,
  ILLUSTRATED_MAP_DESK_MARGIN_RATIO,
  ILLUSTRATED_MAP_DESK_TEXTURE_SEED,
} from '../src/map/illustratedMapDeskSurface.ts';

const squareBounds = { minX: -500, maxX: 500, minZ: -500, maxZ: 500 };
const squareDesk = illustratedMapDeskMetrics(squareBounds);
assert.equal(ILLUSTRATED_MAP_DESK_TEXTURE_SEED, 0x1550c0de);
assert.equal(ILLUSTRATED_MAP_DESK_MARGIN_RATIO, 0.45);
assert.deepEqual(squareDesk, {
  centerX: 0,
  centerZ: 0,
  width: 1900,
  depth: 1900,
  margin: 450,
});

const rectangularDesk = illustratedMapDeskMetrics({
  minX: -100,
  maxX: 100,
  minZ: -200,
  maxZ: 200,
});
assert.deepEqual(
  rectangularDesk,
  { centerX: 0, centerZ: 0, width: 560, depth: 760, margin: 180 },
  'desk margins should follow the longest map dimension without distorting the parchment',
);

assert.ok(ILLUSTRATED_MAP_DESK_FADE_START < ILLUSTRATED_MAP_DESK_ALPHA_FADE_START);
assert.equal(illustratedMapDeskColourGainAt(0.5), 1);
assert.equal(illustratedMapDeskAlphaAt(0.5), 1);
assert.ok(
  illustratedMapDeskColourGainAt(0.9) < 1,
  'wood colour should darken before transparency begins',
);
assert.equal(illustratedMapDeskAlphaAt(0.9), 1);
assert.ok(illustratedMapDeskAlphaAt(0.98) < 1);
assert.ok(illustratedMapDeskColourGainAt(0.98) > 0);
assert.equal(illustratedMapDeskAlphaAt(1), 0);
assert.ok(illustratedMapDeskColourGainAt(1) <= 0.061);

const planeSource = readFileSync(
  new URL('../src/map/IllustratedMapPlane.ts', import.meta.url),
  'utf8',
);
const overlaySource = readFileSync(
  new URL('../src/map/TerrainMinimapOverlay.ts', import.meta.url),
  'utf8',
);
const overlayCss = readFileSync(
  new URL('../src/ui/terrainMinimap.css', import.meta.url),
  'utf8',
);

assert.match(planeSource, /createIllustratedMapDeskCanvas\(\)/);
assert.match(planeSource, /scene\.background = new THREE\.Color\(0x000000\)/);
assert.match(planeSource, /renderPath: 'direct-no-post'/);
assert.match(planeSource, /desk\.renderOrder = -1/);
assert.match(
  planeSource,
  /deskMaterial = new THREE\.MeshBasicMaterial\(\{[\s\S]*?transparent: false,[\s\S]*?depthTest: false,[\s\S]*?depthWrite: false,/,
  'the desk must share the opaque render list so it cannot composite over the parchment',
);
assert.match(planeSource, /layers: \['desk-surround', 'parchment-shadow', 'parchment', 'resource-stamps'\]/);
assert.match(overlaySource, /dataset\.renderPath = 'dom-no-post'/);
assert.match(overlaySource, /createIllustratedMapDeskCanvas\(\)/);
assert.match(
  overlaySource,
  /replaceChildren\(this\.mapCanvas, this\.stampCanvas, this\.focusMarker\)/,
  'the focus marker and both map canvases must share the inset parchment coordinate frame',
);
assert.match(overlayCss, /--map-desk-inset:\s*clamp\(/);
assert.match(overlayCss, /\.terrain-minimap__desk-canvas\s*\{[\s\S]*?object-fit:\s*fill;/);
assert.match(
  overlayCss,
  /\.terrain-minimap__map-surface\s*\{[\s\S]*?top:\s*50%;[\s\S]*?left:\s*50%;[\s\S]*?width:\s*min\([\s\S]*?aspect-ratio:\s*1\s*\/\s*1;[\s\S]*?transform:\s*translate\(-50%,\s*-50%\);/,
  'the held-G parchment should stay centered and square over the full-screen desk',
);
assert.doesNotMatch(
  overlayCss,
  /\.terrain-minimap__map-surface canvas\s*\{[\s\S]*?object-fit:\s*fill;/,
  'the parchment layers must not stretch with an ultrawide viewport',
);

console.log('test:map-desk passed');
