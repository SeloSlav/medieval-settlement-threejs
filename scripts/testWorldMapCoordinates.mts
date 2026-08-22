import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  areResourceIconsAlwaysShown,
  resolveResourceIconOpacity,
  setResourceIconsAlwaysShown,
} from '../src/map/resourceMapIconPreference.ts';
import { worldDirectionToMapRotation, worldToMapPercent } from '../src/map/worldToMapPercent.ts';
import {
  deriveSettlementMapMarker,
  SETTLEMENT_RESIDENCE_LINK_RADIUS,
} from '../src/map/settlementMapMarker.ts';
import { SETTLEMENT_MAP_ICON_HTML } from '../src/map/settlementMapIconArt.ts';
import {
  MAP_STAMP_RESOURCE_KINDS,
  mapStampKey,
  residenceFootprintCorners,
  worldToMapPixels,
} from '../src/map/illustratedMapGeometry.ts';

const EPSILON = 1e-12;
const bounds = { minX: -100, maxX: 100, minZ: -200, maxZ: 200 };

assert.deepEqual(
  worldToMapPercent(0, 0, bounds),
  { x: 50, y: 50 },
  'the world origin should be centered on the minimap',
);
assert.deepEqual(
  worldToMapPercent(100, 200, bounds),
  { x: 100, y: 100 },
  'world +X should map right and world +Z should map down',
);

const cardinalDirections = [
  { label: 'world -Z points up', x: 0, z: -1, expected: 0 },
  { label: 'world +X points right', x: 1, z: 0, expected: Math.PI / 2 },
  { label: 'world +Z points down', x: 0, z: 1, expected: Math.PI },
  { label: 'world -X points left', x: -1, z: 0, expected: -Math.PI / 2 },
] as const;

for (const direction of cardinalDirections) {
  const actual = worldDirectionToMapRotation(direction.x, direction.z);
  assert.ok(
    Math.abs(actual - direction.expected) < EPSILON,
    `${direction.label}: expected ${direction.expected}, received ${actual}`,
  );
}

assert.equal(
  resolveResourceIconOpacity(400, true),
  1,
  'always-show resource icons should stay fully visible at close zoom',
);
assert.equal(
  resolveResourceIconOpacity(400, false),
  0,
  'disabling always-show should restore the close-zoom icon fade',
);
assert.equal(
  resolveResourceIconOpacity(25, false),
  1,
  'resource icons should remain visible at overview zoom when always-show is disabled',
);
assert.equal(
  areResourceIconsAlwaysShown(),
  true,
  'resource icons should be set to always show by default',
);
setResourceIconsAlwaysShown(false);
assert.equal(
  areResourceIconsAlwaysShown(),
  false,
  'the resource icon preference should be possible to disable',
);
setResourceIconsAlwaysShown(true);

const terrainMinimapSource = readFileSync(
  new URL('../src/map/createTerrainMinimapImage.ts', import.meta.url),
  'utf8',
);
const terrainMinimapOverlaySource = readFileSync(
  new URL('../src/map/TerrainMinimapOverlay.ts', import.meta.url),
  'utf8',
);
const terrainMinimapCss = readFileSync(
  new URL('../src/ui/terrainMinimap.css', import.meta.url),
  'utf8',
);
const illustratedLayersSource = readFileSync(
  new URL('../src/map/illustratedMapLayers.ts', import.meta.url),
  'utf8',
);
const illustratedPlaneSource = readFileSync(
  new URL('../src/map/IllustratedMapPlane.ts', import.meta.url),
  'utf8',
);
const worldMapUiSource = readFileSync(
  new URL('../src/app/worldMapIcons.ts', import.meta.url),
  'utf8',
);

assert.match(
  terrainMinimapSource,
  /dataset\.terrainStyle = 'medieval-parchment'/,
  'the first-person map should identify its parchment terrain presentation',
);
for (const renderer of [
  'drawReliefLines',
  'drawGrassGlyphs',
  'drawForestGlyphs',
  'drawWaterHatching',
] as const) {
  assert.match(
    terrainMinimapSource,
    new RegExp(`${renderer}\\(`),
    `the parchment terrain should include ${renderer}`,
  );
}
assert.match(
  terrainMinimapSource,
  /forestDensityAt\(/,
  'forest ink should follow the generated forest density field',
);
assert.match(
  terrainMinimapOverlaySource,
  /forestCores: this\.options\.forestCores/,
  'the minimap overlay should pass the generated forest cores into the terrain renderer',
);
assert.doesNotMatch(
  terrainMinimapOverlaySource,
  /deriveSettlementMapMarker|SETTLEMENT_MAP_ICON_HTML/,
  'the live map should render real structures rather than a derived city emblem',
);
for (const renderer of [
  'drawRoadInk',
  'drawBuildingFootprints',
  'drawResidenceFootprints',
  'drawResourceStamps',
] as const) {
  assert.match(
    illustratedLayersSource,
    new RegExp(`${renderer}\\(`),
    `the shared map canvas should include ${renderer}`,
  );
}
assert.match(
  illustratedLayersSource,
  /getBuildingFootprintCorners\(/,
  'map buildings should use the authoritative placement footprint',
);
assert.match(
  terrainMinimapOverlaySource,
  /onTerrainImageUpdated\?\.\(\)/,
  'live map changes should invalidate the shared 3D canvas texture',
);
assert.match(
  terrainMinimapOverlaySource,
  /stampCanvas\.dataset\.mapLayer = 'resource-stamps'/,
  'resource stamps should own a transparent canvas above the terrain canvas',
);
assert.match(
  illustratedPlaneSource,
  /stampPlane\.renderOrder = 2/,
  'the 3D stamp plane should render after the parchment plane',
);
assert.match(
  illustratedPlaneSource,
  /stampPlane\.position\.set\(centerX, 0\.12, centerZ\)/,
  'the 3D stamp plane should sit physically above the parchment',
);
assert.match(
  worldMapUiSource,
  /isVisibilityBlocked: \(\) => isIllustratedMapActive\(\)/,
  'legacy projected resource markers should be hidden while woodcut stamps own map mode',
);
assert.doesNotMatch(
  terrainMinimapSource,
  /drawTown|settlementHull|townBoundary/,
  'the terrain layer should not guess at a town footprint',
);
assert.match(
  terrainMinimapCss,
  /\.terrain-minimap\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?z-index:\s*2147483000;/,
  'the held map should cover the viewport above every normal UI stacking layer',
);

assert.deepEqual(
  worldToMapPixels({ x: 0, z: 0 }, bounds, 512, 256),
  { x: 256, y: 128 },
  'canvas layers should share the same X/Z coordinate frame as the held map',
);
assert.equal(
  mapStampKey({
    id: 'iron-vein',
    kind: 'quarry',
    label: 'Rich iron',
    x: 0,
    z: 0,
    resource: 'iron',
  }, true),
  'iron-rich',
);
assert.equal(
  mapStampKey({
    id: 'stone-outcrop',
    kind: 'quarry',
    label: 'Stone',
    x: 0,
    z: 0,
    resource: 'stone',
  }, false),
  'stone-normal',
);
const residenceCorners = residenceFootprintCorners({ x: 10, z: 20, yaw: 0 });
assert.deepEqual(
  residenceCorners,
  [
    { x: 6.7, z: 16.3 },
    { x: 13.3, z: 16.3 },
    { x: 13.3, z: 23.7 },
    { x: 6.7, z: 23.7 },
  ],
  'residences should be drawn at their physical 6.6m by 7.4m footprint',
);
for (const resource of MAP_STAMP_RESOURCE_KINDS) {
  for (const variant of ['normal', 'rich'] as const) {
    const asset = readFileSync(
      new URL(`../public/assets/ui/map-stamps/${resource}-${variant}.png`, import.meta.url),
    );
    assert.ok(asset.byteLength > 1_000, `${resource}-${variant} should have a real PNG asset`);
    assert.equal(asset.subarray(1, 4).toString('ascii'), 'PNG');
  }
}
assert.match(
  terrainMinimapCss,
  /\.terrain-minimap__panel\s*\{[\s\S]*?inset:\s*0;[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;/,
  'the framed minimap panel should become a fullscreen surface',
);
assert.match(
  terrainMinimapCss,
  /\.terrain-minimap__map-surface canvas\s*\{[\s\S]*?object-fit:\s*fill;/,
  'the terrain canvas must share the fullscreen coordinate frame used by marker percentages',
);
assert.match(
  terrainMinimapCss,
  /\.terrain-minimap__stamp-canvas\s*\{[\s\S]*?z-index:\s*1;[\s\S]*?opacity:\s*0\.98;/,
  'the held-map resource canvas should stay visibly above the parchment terrain',
);

const foundersMarker = deriveSettlementMapMarker({
  residences: [],
  buildings: [{
    id: 'founders-camp',
    kind: 'founders_camp',
    x: 24,
    z: -18,
    constructionComplete: true,
  }],
});
assert.deepEqual(
  foundersMarker,
  {
    x: 24,
    z: -18,
    tier: 'founders',
    label: "Founders' camp · settlement origin",
    residenceCount: 0,
    population: 0,
  },
  'the founders camp should own the settlement emblem before the first completed home',
);

const residence = (
  id: string,
  x: number,
  z: number,
  population = 4,
  tier: 0 | 1 | 2 | 3 = 1,
) => ({ id, x, z, population, tier });

const firstHomeMarker = deriveSettlementMapMarker({
  residences: [residence('home-1', 12, 7)],
  buildings: [],
});
assert.equal(firstHomeMarker?.tier, 'hamlet');
assert.ok(Math.abs((firstHomeMarker?.x ?? Infinity) - 12) < EPSILON);
assert.ok(Math.abs((firstHomeMarker?.z ?? Infinity) - 7) < EPSILON);
assert.match(firstHomeMarker?.label ?? '', /Hamlet center · 1 home/);

const villageMarker = deriveSettlementMapMarker({
  residences: Array.from({ length: 6 }, (_, index) => residence(
    `village-${index}`,
    (index % 3) * 24,
    Math.floor(index / 3) * 25,
    3,
  )),
  buildings: [],
});
assert.equal(villageMarker?.tier, 'village');
assert.equal(villageMarker?.residenceCount, 6);

const townMarker = deriveSettlementMapMarker({
  residences: Array.from({ length: 18 }, (_, index) => residence(
    `town-${index.toString().padStart(2, '0')}`,
    (index % 6) * 18,
    Math.floor(index / 6) * 20,
    3,
  )),
  buildings: [],
});
assert.equal(townMarker?.tier, 'town');
assert.equal(townMarker?.residenceCount, 18);

const primaryClusterMarker = deriveSettlementMapMarker({
  residences: [
    residence('primary-a', 0, 0),
    residence('primary-b', 18, 0),
    residence('primary-c', 8, 20),
    residence('remote-a', SETTLEMENT_RESIDENCE_LINK_RADIUS * 3, 0),
    residence('remote-b', SETTLEMENT_RESIDENCE_LINK_RADIUS * 3 + 15, 0),
  ],
  buildings: [],
});
assert.equal(primaryClusterMarker?.residenceCount, 3);
assert.ok((primaryClusterMarker?.x ?? Infinity) < 30);

const constructionOnlyMarker = deriveSettlementMapMarker({
  residences: [residence('unfinished-home', 80, 40, 0, 0)],
  buildings: [{
    id: 'camp-under-homes',
    kind: 'founders_camp',
    x: 4,
    z: 5,
    constructionComplete: true,
  }],
});
assert.equal(
  constructionOnlyMarker?.tier,
  'founders',
  'a tier-zero residence worksite should not retire the founders-camp emblem',
);

for (const tier of ['founders', 'hamlet', 'village', 'town'] as const) {
  assert.match(SETTLEMENT_MAP_ICON_HTML[tier], /settlement-map-icon-art/);
  assert.match(SETTLEMENT_MAP_ICON_HTML[tier], /<path/);
}

console.log('test:world-map passed');
