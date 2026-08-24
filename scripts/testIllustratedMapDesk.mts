import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import {
  illustratedMapDeskColourGainAt,
  illustratedMapDeskMetrics,
  ILLUSTRATED_MAP_DESK_FADE_START,
  ILLUSTRATED_MAP_DESK_MARGIN_RATIO,
  ILLUSTRATED_MAP_DESK_TEXTURE_ASSET,
} from '../src/map/illustratedMapDeskSurface.ts';

const squareBounds = { minX: -500, maxX: 500, minZ: -500, maxZ: 500 };
const squareDesk = illustratedMapDeskMetrics(squareBounds);
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

assert.ok(
  ILLUSTRATED_MAP_DESK_FADE_START <= 0.65,
  'the desk fade should begin early enough to read as a broad transition',
);
assert.equal(illustratedMapDeskColourGainAt(0.5), 1);
assert.ok(
  illustratedMapDeskColourGainAt(0.7) < 1,
  'wood should already be darkening well before the outer edge',
);
assert.ok(illustratedMapDeskColourGainAt(0.8) < 0.55);
assert.ok(illustratedMapDeskColourGainAt(0.9) > 0);
assert.equal(illustratedMapDeskColourGainAt(1), 0);

const deskAsset = new URL(
  `../public/${ILLUSTRATED_MAP_DESK_TEXTURE_ASSET}`,
  import.meta.url,
);
assert.ok(
  statSync(deskAsset).size > 1_000_000,
  'the desk should use the full-resolution illustrated oak asset, not a tiny placeholder',
);

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
const deskSurfaceSource = readFileSync(
  new URL('../src/map/illustratedMapDeskSurface.ts', import.meta.url),
  'utf8',
);

assert.match(planeSource, /createIllustratedMapDeskCanvas\(\{/);
assert.match(planeSource, /scene\.background = new THREE\.Color\(0x000000\)/);
assert.match(planeSource, /renderPath: 'direct-no-post'/);
assert.match(planeSource, /source: 'real-texture-canvas'/);
assert.match(planeSource, /textureAsset: ILLUSTRATED_MAP_DESK_TEXTURE_ASSET/);
assert.match(planeSource, /this\.deskTexture\.needsUpdate = true/);
assert.match(planeSource, /desk\.renderOrder = -1/);
assert.match(
  planeSource,
  /deskMaterial = new THREE\.MeshBasicMaterial\(\{[\s\S]*?transparent: false,[\s\S]*?depthTest: false,[\s\S]*?depthWrite: false,/,
  'the desk must share the opaque render list so it cannot composite over the parchment',
);
assert.match(planeSource, /layers: \['desk-surround', 'parchment-shadow', 'parchment', 'resource-stamps'\]/);
assert.match(overlaySource, /dataset\.renderPath = 'dom-no-post'/);
assert.match(overlaySource, /dataset\.mapPresentation = 'parchment-on-real-dark-oak'/);
assert.match(overlaySource, /createIllustratedMapDeskCanvas\(\{/);
assert.match(overlaySource, /view\?\.innerWidth[\s\S]*?view\?\.innerHeight/);
assert.match(deskSurfaceSource, /new Image\(\)/);
assert.match(deskSurfaceSource, /drawImageCover\(context, image/);
assert.match(deskSurfaceSource, /pixels\[offset \+ 3\] = 255/);
assert.match(
  deskSurfaceSource,
  /getContext\('2d',\s*\{[\s\S]*?alpha:\s*false,[\s\S]*?willReadFrequently:\s*true,[\s\S]*?\}\)/,
  'the repeatedly sampled desk canvas should request Chromium\'s readback-oriented Canvas2D path',
);
assert.doesNotMatch(deskSurfaceSource, /plankCount|drawPlank|mulberry32|textureSeed/);
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
