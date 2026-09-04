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
import { InputManager } from '../src/input/InputManager.ts';
import { IllustratedMapResourceHover } from '../src/map/IllustratedMapResourceHover.ts';
import { UI_TOOLTIP_REPOSITION_EVENT } from '../src/ui/tooltips.ts';
import {
  clearProjectedMapButtonHitBounds,
  projectedMapButtonHitDistanceSquared,
  setProjectedMapButtonHitBounds,
} from '../src/map/projectedMapButtonHitBounds.ts';
import {
  MAP_STAMP_RESOURCE_KINDS,
  mapStampArtSize,
  mapStampKey,
  residenceFootprintCorners,
  worldToMapPixels,
} from '../src/map/illustratedMapGeometry.ts';
import { resourceNodeArtUrl } from '../src/resources/resourceNodeArt.ts';

const EPSILON = 1e-12;
const bounds = { minX: -100, maxX: 100, minZ: -200, maxZ: 200 };

type FakeListener = (event: Record<string, unknown>) => void;

class FakeDomEventTarget {
  private readonly listeners = new Map<string, Set<FakeListener>>();

  addEventListener(type: string, listener: FakeListener): void {
    const listeners = this.listeners.get(type) ?? new Set<FakeListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: FakeListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: Record<string, unknown> = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const fakeWindow = new FakeDomEventTarget();
const fakeDocument = Object.assign(new FakeDomEventTarget(), { hidden: false });
const fakeCanvas = new FakeDomEventTarget();
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: fakeWindow,
});
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: fakeDocument,
});
try {
  const input = new InputManager(fakeCanvas as unknown as HTMLElement);
  fakeWindow.dispatch('keydown', {
    key: 'g',
    target: { tagName: 'DIV', isContentEditable: false },
  });
  assert.equal(input.isDown('g'), true, 'the held-map key should register while focused');
  fakeWindow.dispatch('blur');
  assert.equal(input.isDown('g'), false, 'window blur must release a held map key');
  fakeWindow.dispatch('keydown', {
    key: 'g',
    target: { tagName: 'DIV', isContentEditable: false },
  });
  fakeDocument.hidden = true;
  fakeDocument.dispatch('visibilitychange');
  assert.equal(input.isDown('g'), false, 'hiding the page must release a held map key');
  input.dispose();
} finally {
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
  else delete (globalThis as { window?: unknown }).window;
  if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
  else delete (globalThis as { document?: unknown }).document;
}

class FakeMouseEvent extends Event {
  readonly relatedTarget: EventTarget | null;

  constructor(type: string, init: EventInit & { relatedTarget?: EventTarget | null } = {}) {
    super(type, init);
    this.relatedTarget = init.relatedTarget ?? null;
  }
}

class HoverAnchor extends EventTarget {
  hidden = false;
  isConnected = true;
  parentHidden = false;

  closest(): HoverAnchor | null {
    return this.hidden || this.parentHidden ? this : null;
  }

  getBoundingClientRect(): DOMRect {
    return {
      x: 80,
      y: 80,
      left: 80,
      top: 80,
      right: 120,
      bottom: 120,
      width: 40,
      height: 40,
      toJSON: () => ({}),
    } as DOMRect;
  }
}

const hoverAnchor = new HoverAnchor();
const hoverRenderer = new EventTarget();
const hoverWindow = new EventTarget() as EventTarget & { MouseEvent: typeof FakeMouseEvent };
hoverWindow.MouseEvent = FakeMouseEvent;
const hoverUiRoot = new EventTarget() as EventTarget & {
  ownerDocument: EventTarget & { defaultView: typeof hoverWindow; hidden: boolean };
  querySelectorAll: (selector: string) => HoverAnchor[];
};
hoverUiRoot.ownerDocument = Object.assign(new EventTarget(), { defaultView: hoverWindow, hidden: false });
const hoverAnchors: HoverAnchor[] = [];
let hoverAnchorSelector = '';
hoverUiRoot.querySelectorAll = (selector) => {
  hoverAnchorSelector = selector;
  return hoverAnchors;
};
let illustratedMapActive = true;
let hoverBlocked = false;
let mouseOverCount = 0;
let mouseOutCount = 0;
let repositionCount = 0;
hoverAnchor.addEventListener('mouseover', () => { mouseOverCount += 1; });
hoverAnchor.addEventListener('mouseout', () => { mouseOutCount += 1; });
hoverUiRoot.addEventListener(UI_TOOLTIP_REPOSITION_EVENT, () => { repositionCount += 1; });
const illustratedHover = new IllustratedMapResourceHover({
  uiRoot: hoverUiRoot as unknown as HTMLElement,
  domElement: hoverRenderer as unknown as HTMLElement,
  isActive: () => illustratedMapActive,
  isBlocked: () => hoverBlocked,
});
// Military markers are simulation-owned and are commonly mounted after the
// illustrated-map hover helper has already been constructed.
hoverAnchors.push(hoverAnchor);
setProjectedMapButtonHitBounds(
  hoverAnchor as unknown as HTMLButtonElement,
  100,
  100,
  40,
  40,
);
assert.equal(
  projectedMapButtonHitDistanceSquared(
    hoverAnchor as unknown as HTMLButtonElement,
    100,
    100,
  ),
  0,
  'the projected hit cache should resolve the stamp center without a layout read',
);
const pointerMove = new Event('pointermove');
Object.defineProperties(pointerMove, {
  clientX: { value: 100 },
  clientY: { value: 100 },
});
hoverRenderer.dispatchEvent(pointerMove);
assert.equal(mouseOverCount, 1, 'pointer movement should activate a stamp without waiting for a render frame');
assert.match(
  hoverAnchorSelector,
  /\.military-company-map-icon/,
  'illustrated-map hover hit testing should include live bandit-company markers',
);
illustratedHover.update();
assert.equal(repositionCount, 1, 'an active card should follow its projected stamp each frame');
assert.equal(pointerMove.defaultPrevented, false, 'hover hit testing must not consume camera input');
const moveOutside = new Event('pointermove');
Object.defineProperties(moveOutside, {
  clientX: { value: 121 },
  clientY: { value: 100 },
});
hoverRenderer.dispatchEvent(moveOutside);
assert.equal(mouseOutCount, 1, 'moving one pixel beyond the stamp must dismiss immediately');
hoverRenderer.dispatchEvent(pointerMove);
assert.equal(mouseOverCount, 2, 'returning to the stamp must reopen its tooltip');
// The map can move under a stationary mouse without another pointer event.
setProjectedMapButtonHitBounds(hoverAnchor as unknown as HTMLButtonElement, 200, 100, 40, 40);
illustratedHover.update();
assert.equal(mouseOutCount, 2, 'panning a stamp away from the cursor must dismiss it');
setProjectedMapButtonHitBounds(hoverAnchor as unknown as HTMLButtonElement, 100, 100, 40, 40);
illustratedHover.update();
assert.equal(mouseOverCount, 3);
hoverRenderer.dispatchEvent(new Event('pointercancel'));
assert.equal(mouseOutCount, 3, 'cancelled pointer input must release the hovered resource');
illustratedHover.update();
assert.equal(mouseOverCount, 3, 'cancelled input must not restore a stale hover');
hoverRenderer.dispatchEvent(pointerMove);
hoverAnchor.parentHidden = true;
illustratedHover.update();
assert.equal(mouseOutCount, 4, 'hidden resource layers must not retain a hover');
hoverAnchor.parentHidden = false;
hoverRenderer.dispatchEvent(pointerMove);
hoverUiRoot.ownerDocument.hidden = true;
hoverUiRoot.ownerDocument.dispatchEvent(new Event('visibilitychange'));
assert.equal(mouseOutCount, 5, 'a hidden page must release the hovered resource');
hoverUiRoot.ownerDocument.hidden = false;
hoverRenderer.dispatchEvent(pointerMove);
hoverBlocked = true;
illustratedHover.update();
assert.equal(mouseOutCount, 6, 'a blocking overlay should close the active resource card');
hoverBlocked = false;
illustratedMapActive = false;
illustratedHover.update();
illustratedHover.dispose();
clearProjectedMapButtonHitBounds(hoverAnchor as unknown as HTMLButtonElement);

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
const illustratedResourceHoverSource = readFileSync(
  new URL('../src/map/IllustratedMapResourceHover.ts', import.meta.url),
  'utf8',
);
const mapIconProjectionSource = readFileSync(
  new URL('../src/map/mapIconProjection.ts', import.meta.url),
  'utf8',
);
const mapIconCss = readFileSync(
  new URL('../src/ui/mapIcons.css', import.meta.url),
  'utf8',
);
const appStyles = readFileSync(
  new URL('../src/style.css', import.meta.url),
  'utf8',
);
const polishedGameUi = readFileSync(
  new URL('../src/ui/polishedGameUi.css', import.meta.url),
  'utf8',
);
const appBootstrapSource = readFileSync(
  new URL('../src/app/appBootstrap.ts', import.meta.url),
  'utf8',
);
const sceneManagerSource = readFileSync(
  new URL('../src/scene/SceneManager.ts', import.meta.url),
  'utf8',
);
const forestPropsSource = readFileSync(
  new URL('../src/props/ForestProps.ts', import.meta.url),
  'utf8',
);

assert.match(
  terrainMinimapSource,
  /dataset\.terrainStyle = 'medieval-parchment'/,
  'the first-person map should identify its parchment terrain presentation',
);
for (const renderer of [
  'drawReliefLines',
  'drawCharcoalContour',
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
  /projectIllustratedWoodland\(/,
  'forest ink should project accepted game-tree placements',
);
assert.doesNotMatch(
  terrainMinimapSource,
  /forestDensityAt\(/,
  'the paper-map tree layer must not invent groves from the broad density field',
);
assert.match(
  terrainMinimapSource,
  /dataset\.terrainFieldContract = ILLUSTRATED_TERRAIN_FIELD_CONTRACT/,
  'the terrain canvas should expose the stable world-space field contract used for its ink',
);
assert.match(
  terrainMinimapSource,
  /dataset\.contourIntervalMeters = String\(diagnostics\.elevation\.contourIntervalMeters\)/,
  'both map views should publish their shared elevation interval',
);
assert.doesNotMatch(
  terrainMinimapSource,
  /drawMountain|mountainFootprints/,
  'height contours should replace pictorial mountains and their tree exclusion zones',
);
assert.match(
  terrainMinimapSource,
  /dataset\.woodlandSource = 'accepted-tree-placements'/,
  'the one-time terrain bake should identify its authoritative tree source',
);
assert.match(
  terrainMinimapSource,
  /dataset\.woodlandSourceTrees = String\(diagnostics\.woodland\.sourceTreeCount\)/,
  'the terrain bake should publish the accepted source count',
);
assert.match(
  terrainMinimapSource,
  /dataset\.woodlandGlyphs = String\(diagnostics\.woodland\.drawnTreeGlyphCount\)/,
  'the terrain bake should publish the number of actually drawn tree marks',
);
assert.match(
  terrainMinimapOverlaySource,
  /const treePlacements = await this\.options\.treePlacements/,
  'the minimap should wait for deferred forest placement instead of blocking the first frame',
);
assert.match(
  terrainMinimapOverlaySource,
  /treePlacements,/,
  'the minimap overlay should pass accepted tree placements into the terrain renderer',
);
assert.match(
  terrainMinimapOverlaySource,
  /Object\.assign\(this\.mapCanvas\.dataset, image\.canvas\.dataset\)/,
  'accepted-tree diagnostics should survive the mounted-canvas copy',
);
assert.match(
  appBootstrapSource,
  /treePlacements: sceneManager\.whenForestTreePlacementsReady\(\)/,
  'map startup should subscribe to the deferred shared forest layout',
);
assert.match(
  sceneManagerSource,
  /treePlacements: this\.resolveForestTreePlacements\(\)/,
  'the 3D forest build should resolve the same accepted layout used by the map',
);
assert.match(
  forestPropsSource,
  /options\?\.treePlacements[\s\S]*?computeForestTreePlacements\(/,
  'forest props should consume the shared placements and only generate as a fallback',
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
  /stampPlane\.position\.set\(centerX, ILLUSTRATED_MAP_STAMP_LIFT, centerZ\)/,
  'the 3D stamp plane should sit physically above the parchment',
);
assert.match(
  worldMapUiSource,
  /getIllustratedMapY: \(\) => getIllustratedMapElevation\(\) \+ ILLUSTRATED_MAP_STAMP_LIFT/,
  'illustrated-map hover targets should project onto the resource stamp plane',
);
assert.match(
  worldMapUiSource,
  /isIllustratedMapActive\(\)[\s\S]*?\? isOverlayBlocked\(placementGate\)[\s\S]*?: isWorldResourceIconVisibilityBlocked\(placementGate\)/,
  'map-mode hover targets should remain available unless a real overlay blocks them',
);
assert.match(
  illustratedResourceHoverSource,
  /domElement\.addEventListener\('pointermove'/,
  'illustrated resource hover should be hit-tested from the renderer input surface',
);
assert.match(
  illustratedResourceHoverSource,
  /dispatchEvent\(new MouseEventConstructor\('mouseover'/,
  'illustrated resource hits should reuse the shared tooltip anchors',
);
assert.match(
  mapIconProjectionSource,
  /syncProjectedButtonHitArea\(/,
  'projected hover bounds should follow each stamp through camera movement',
);
assert.match(
  mapIconCss,
  /\.quarry-map-icons\.is-illustrated-map[\s\S]*?pointer-events:\s*none;/,
  'transparent map hover bounds must not swallow wheel, pan, or orbit controls',
);
assert.match(
  appBootstrapSource,
  /document\.documentElement\.dataset\.cameraView = active[\s\S]*?\? 'illustrated-map'[\s\S]*?: 'world'/,
  'map render ownership should expose one synchronous root visibility signal',
);
assert.match(
  appStyles,
  /html\[data-camera-view='illustrated-map'\] \[data-settlement-hud\][\s\S]*?width:\s*0;[\s\S]*?background:\s*none;/,
  'the illustrated map should remove the resource-ribbon frame without HUD lifecycle work',
);
assert.match(
  appStyles,
  /> :not\(\.noble-hud\):not\(\.settlement-vitals\)[\s\S]*?display:\s*none;/,
  'the top resource menu should disappear while exempting the lord and time panels',
);
assert.match(
  appStyles,
  /html\[data-camera-view='illustrated-map'\] \[data-ui-root\] \.hud-bottom-center,[\s\S]*?\.floating-build-button,[\s\S]*?\.burgage-layout-hud,[\s\S]*?\.delete-popup[\s\S]*?display:\s*none;/,
  'all bottom construction controls should disappear for the illustrated map',
);
assert.doesNotMatch(
  terrainMinimapOverlaySource,
  /terrain-minimap__(?:header|title|hint)|>World map<|>Hold G</,
  'the held first-person map should show only the map presentation',
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
const inspectorArtCases = [
  { family: 'stone', kind: 'quarry', resource: 'stone' },
  { family: 'clay', kind: 'quarry', resource: 'clay' },
  { family: 'iron', kind: 'quarry', resource: 'iron' },
  { family: 'salt', kind: 'quarry', resource: 'salt' },
  { family: 'game', kind: 'game', resource: 'game' },
  { family: 'berries', kind: 'berries', resource: 'berries' },
  { family: 'mushrooms', kind: 'mushrooms', resource: 'mushrooms' },
  { family: 'fish', kind: 'fish', resource: 'fish' },
] as const;
for (const { family, kind, resource } of inspectorArtCases) {
  for (const rich of [false, true]) {
    assert.equal(
      resourceNodeArtUrl(kind, resource, rich),
      `/assets/ui/map-stamps/${family}-${rich ? 'rich' : 'normal'}.png`,
      `${family} inspector art should preserve both its resource family and richness`,
    );
  }
}
assert.match(
  polishedGameUi,
  /\[data-inspector-kind='resource'\] \.resource-inspector-hero-image\s*\{[\s\S]*?object-fit:\s*contain;/,
  'transparent resource stamps should be fully visible in the inspector hero',
);
assert.equal(
  mapStampArtSize({
    id: 'rich-game',
    kind: 'game',
    label: 'Rich game',
    x: 0,
    z: 0,
  }, true),
  42,
  'rich hover bounds should use the same art size as rich figure stamps',
);
assert.equal(
  mapStampArtSize({
    id: 'large-stone',
    kind: 'quarry',
    quarryKind: 'large',
    label: 'Large stone',
    x: 0,
    z: 0,
  }, false),
  31,
  'large normal quarry hover bounds should use the same art size as their stamp',
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
  /\.terrain-minimap__map-surface\s*\{[\s\S]*?top:\s*50%;[\s\S]*?left:\s*50%;[\s\S]*?width:\s*min\([\s\S]*?aspect-ratio:\s*1\s*\/\s*1;[\s\S]*?transform:\s*translate\(-50%,\s*-50%\);/,
  'the held-G parchment should remain a centered square rather than stretch with the viewport',
);
assert.doesNotMatch(
  terrainMinimapCss,
  /\.terrain-minimap__map-surface canvas\s*\{[\s\S]*?object-fit:\s*fill;/,
  'the held-G parchment canvases must not be stretched independently',
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

assert.match(SETTLEMENT_MAP_ICON_HTML.founders, /gk-icon--camp/);
assert.doesNotMatch(SETTLEMENT_MAP_ICON_HTML.founders, /<svg|<path/);
for (const tier of ['hamlet', 'village', 'town'] as const) {
  assert.match(SETTLEMENT_MAP_ICON_HTML[tier], /settlement-map-icon-art/);
  assert.match(SETTLEMENT_MAP_ICON_HTML[tier], /gk-icon--town-hall/);
  assert.doesNotMatch(SETTLEMENT_MAP_ICON_HTML[tier], /<svg|<path/);
}
assert.match(
  mapIconCss,
  /\.settlement-map-icons\s*\{[\s\S]*?z-index:\s*1;[\s\S]*?\.settlement-map-icon\s*\{[\s\S]*?z-index:\s*1;/,
  'community markers must stay below the game HUD stacking layers',
);

console.log('test:world-map passed');
