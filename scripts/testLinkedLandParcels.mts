import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FarmFieldTool } from '../src/farming/FarmFieldTool.ts';
import type { FarmFieldCorners } from '../src/farming/farmFieldMath.ts';
import { getBuildingFootprintHalfExtents } from '../src/buildings/BuildingFootprint.ts';
import {
  snapLandParcelDraftPoint,
  snapLandParcelPoint,
} from '../src/farming/landParcelSnap.ts';
import {
  snapBurgageBoundaryDraftPoint,
  snapBurgageBoundaryPoint,
  snapBurgageFrontagePoint,
} from '../src/residences/burgagePlotSnap.ts';
import type { BuildingState, BurgageZoneState, GameState } from '../src/resources/types.ts';
import { renderGraveyardInspector } from '../src/resources/inspector/graveyardRenderer.ts';
import { convexPolygonsOverlap2 } from '../src/utils/polygonGeometry.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const parcel = [
  { x: 0, z: 0 },
  { x: 20, z: 0 },
  { x: 20, z: 20 },
  { x: 0, z: 20 },
] as const;

assert.deepEqual(
  snapLandParcelPoint({ x: 10, z: -3 }, [parcel], 6),
  { x: 10, z: 0 },
  'a nearby point should snap to the middle of a linked parcel edge',
);
assert.deepEqual(
  snapLandParcelPoint({ x: 22, z: 22 }, [parcel], 6),
  { x: 20, z: 20 },
  'a nearby point should snap to a linked parcel corner',
);
assert.deepEqual(
  snapLandParcelPoint({ x: 15, z: 21 }, [parcel], 6),
  { x: 15, z: 20 },
  'corner preference should not pull an obvious mid-edge point sideways',
);
assert.deepEqual(
  snapLandParcelPoint({ x: 30, z: 30 }, [parcel], 6),
  { x: 30, z: 30 },
  'a distant point should remain free-form',
);

const rawLandExtension = [
  { x: 23, z: -2 },
  { x: 40, z: 0 },
  { x: 40, z: 20 },
  { x: 17, z: 23 },
] as const;
const acceptedLandExtension = rawLandExtension
  .slice(0, 3)
  .map((point) => snapLandParcelPoint(point, [parcel], 6));
const coherentLandJoin = snapLandParcelDraftPoint(
  rawLandExtension[3],
  acceptedLandExtension,
  [parcel],
  6,
);
assert.deepEqual(
  coherentLandJoin,
  { x: 20, z: 20 },
  'the final field-style corner should prefer a coherent join over the nearer perpendicular edge',
);
const attachedLandExtension = [...acceptedLandExtension, coherentLandJoin];
assert.equal(
  convexPolygonsOverlap2([...parcel], attachedLandExtension),
  false,
  'a magnetically attached land extension should share a boundary without entering the old parcel',
);
const sharedEdgeFirstLandExtension = [
  snapLandParcelPoint({ x: 17, z: 23 }, [parcel], 6),
  snapLandParcelPoint({ x: 23, z: -2 }, [parcel], 6),
  snapLandParcelPoint({ x: 40, z: 0 }, [parcel], 6),
];
sharedEdgeFirstLandExtension.push(snapLandParcelDraftPoint(
  { x: 40, z: 20 },
  sharedEdgeFirstLandExtension,
  [parcel],
  6,
));
assert.deepEqual(
  sharedEdgeFirstLandExtension,
  [
    { x: 20, z: 20 },
    { x: 20, z: 0 },
    { x: 40, z: 0 },
    { x: 40, z: 20 },
  ],
  'land joining must remain coherent when the player draws the shared edge first',
);
assert.equal(
  convexPolygonsOverlap2([...parcel], sharedEdgeFirstLandExtension),
  false,
  'shared-edge-first authoring must be as placeable as final-corner joining',
);
assert.equal(
  convexPolygonsOverlap2([...parcel], [
    { x: 20, z: 0 },
    { x: 40, z: 0 },
    { x: 40, z: 20 },
    { x: 17, z: 20 },
  ]),
  true,
  'the overlap guard must detect the snapped wedge that previously fell through to a building error',
);

const burgage: BurgageZoneState = {
  id: 'burgage-1',
  cornerA: { x: 0, z: 0 },
  cornerB: { x: 20, z: 0 },
  cornerC: { x: 20, z: 18 },
  cornerD: { x: 0, z: 18 },
  frontageEdge: 0,
  plotCount: 2,
};
assert.deepEqual(
  snapBurgageFrontagePoint({ x: 23, z: -2 }, [burgage]),
  { x: 20, z: 0 },
  'new road frontage should magnetize to the end of an existing burgage row',
);
assert.deepEqual(
  snapBurgageFrontagePoint({ x: 10, z: -2 }, [burgage]),
  { x: 10, z: -2 },
  'frontage should not snap into the middle of an existing occupied row',
);
assert.deepEqual(
  snapBurgageBoundaryPoint({ x: 23, z: 11 }, [burgage]),
  { x: 20, z: 11 },
  'a rear corner should magnetize to an existing burgage outer boundary',
);
assert.deepEqual(
  snapBurgageBoundaryPoint({ x: 23, z: 4 }, [burgage], 6, (point) => point.z >= 6),
  { x: 23, z: 4 },
  'a boundary target that would violate the new plot constraints should be ignored',
);

const burgageFrontageJoin = snapBurgageFrontagePoint({ x: 23, z: -2 }, [burgage]);
const coherentBurgageJoin = snapBurgageBoundaryDraftPoint(
  { x: 17, z: 21 },
  [burgageFrontageJoin, { x: 40, z: 0 }, { x: 40, z: 18 }],
  [burgage],
  6,
  (point) => point.z >= 12,
);
assert.deepEqual(
  coherentBurgageJoin,
  { x: 20, z: 18 },
  'a burgage rear corner should complete the attached side instead of cutting across the old rear edge',
);
assert.equal(
  convexPolygonsOverlap2(
    [burgage.cornerA, burgage.cornerB, burgage.cornerC, burgage.cornerD],
    [burgageFrontageJoin, { x: 40, z: 0 }, { x: 40, z: 18 }, coherentBurgageJoin],
  ),
  false,
  'an attached burgage extension should remain placeable after magnetic snapping',
);
const reverseBurgageFrontage = [
  { x: 40, z: 0 },
  snapBurgageFrontagePoint({ x: 23, z: -2 }, [burgage]),
];
const reverseBurgageRear = snapBurgageBoundaryDraftPoint(
  { x: 17, z: 21 },
  reverseBurgageFrontage,
  [burgage],
  6,
  (point) => point.z >= 12,
);
assert.deepEqual(
  reverseBurgageRear,
  { x: 20, z: 18 },
  'the first rear corner should pair with a snapped frontage endpoint when the row is drawn in reverse',
);
assert.equal(
  convexPolygonsOverlap2(
    [burgage.cornerA, burgage.cornerB, burgage.cornerC, burgage.cornerD],
    [...reverseBurgageFrontage, reverseBurgageRear, { x: 40, z: 18 }],
  ),
  false,
  'reverse-drawn burgage extensions must share the intended side without clipping the old plot',
);

const tool = source('src/farming/FarmFieldTool.ts');
for (const link of [
  /parcel\.farmsteadId === this\.farmsteadId/,
  /parcel\.chapelId === this\.farmsteadId/,
  /parcel\.monasteryId === this\.farmsteadId/,
]) assert.match(tool, link);
assert.match(tool, /snapLandParcelDraftPoint\([\s\S]*this\.points[\s\S]*linked/);
assert.match(
  tool,
  /this\.mode !== 'graveyard'[\s\S]*originFootprintPreview\.show\(null\)/,
  'only graveyard placement should retain the linked building exclusion footprint',
);
assert.match(
  tool,
  /buildingFootprintPolygonFromState\([\s\S]*originFootprintPreview\.show/,
  'graveyard placement should show the exact placed church footprint',
);
assert.doesNotMatch(tool, /GRAVEYARD_ADJACENCY_DISTANCE/);
assert.doesNotMatch(tool, /VINEYARD_MONASTERY_ADJACENCY_DISTANCE/);

const snapshotApplier = source('src/app/spacetimeSnapshotApplier.ts');
assert.match(
  snapshotApplier,
  /collectGraveSiteVegetationClearancePolygons[\s\S]*setForestClearanceSources/,
  'occupied grave sites should feed the live vegetation-clearance refresh',
);
const sceneManager = source('src/scene/SceneManager.ts');
assert.match(
  sceneManager,
  /syncPlacementClearance\(\[[\s\S]*graveSiteVegetationClearancePolygons/,
  'grave-site circles should clear the shared grass and wildflower stream',
);

const graveyardInspector = renderGraveyardInspector(
  {
    kind: 'graveyard',
    graveyard: {
      id: 'graveyard-card-test',
      chapelId: 'chapel-card-test',
      corners: parcel,
      area: 400,
      averageSlopeDegrees: 1.5,
      capacity: 24,
      burials: 7,
    },
    chapel: { id: 'chapel-card-test', kind: 'chapel' },
  } as Parameters<typeof renderGraveyardInspector>[0],
  {
    gameState: {
      corpses: new Map([
        ['incoming', { graveyardId: 'graveyard-card-test', state: 2 }],
        ['waiting', { graveyardId: 'graveyard-card-test', state: 0 }],
      ]),
    },
    worldQueries: { getBuildingLabel: () => 'Church' },
  } as Parameters<typeof renderGraveyardInspector>[1],
);
assert.match(graveyardInspector.detailsHtml, /Burials<\/span><strong>7 buried \/ 24 total/);
assert.equal((graveyardInspector.detailsHtml.match(/<li>/g) ?? []).length, 1);
assert.match(graveyardInspector.statusText, /17 grave spots remain · 1 incoming/);
assert.doesNotMatch(graveyardInspector.detailsHtml, /Linked church/);
assert.equal(graveyardInspector.title, 'Burial ground');

const worldQueries = source('src/resources/WorldQueries.ts');
assert.match(
  worldQueries,
  /graveyardTarget[\s\S]*isPointInPolygon2\(\{ x, z \}, graveyard\.corners\)[\s\S]*kind: 'graveyard'/,
  'clicking inside a burial-ground polygon should resolve an inspectable graveyard target',
);
const inspector = source('src/resources/ResourceInspector.ts');
assert.match(inspector, /graveyard:[^\n]*target\.graveyard\.id/);
assert.match(inspector, /build-menu\/cards\/burial-ground\.webp/);
const burialArt = readFileSync(new URL('../public/assets/ui/build-menu/cards/burial-ground.webp', import.meta.url));
assert.equal(burialArt.subarray(0, 4).toString('ascii'), 'RIFF');
assert.equal(burialArt.subarray(8, 12).toString('ascii'), 'WEBP');

const burgageTool = source('src/residences/BurgageTool.ts');
assert.match(burgageTool, /snapBurgageFrontagePoint/);
assert.match(burgageTool, /snapBurgageBoundaryDraftPoint/);
assert.match(burgageTool, /backPointMeetsMinimumDepth/);

const fields = source('server/src/reducers/farm_fields.rs');
assert.match(fields, /point[\s\S]*farmstead\.work_radius/);
assert.doesNotMatch(fields, /already has[\s\S]*field/i);

const pastures = source('server/src/reducers/livestock.rs');
assert.match(pastures, /point[\s\S]*farmstead\.work_radius/);
assert.doesNotMatch(pastures.match(/pub fn place_pasture[\s\S]*?\n\}/)?.[0] ?? '', /already has/i);

const graveyards = source('server/src/reducers/graveyards.rs');
assert.match(graveyards, /GRAVEYARD_MAX_DISTANCE/);
assert.doesNotMatch(graveyards, /GRAVEYARD_ADJACENCY_DISTANCE|must directly adjoin/);
assert.match(graveyards, /burgage_zone_overlaps_buildings\(ctx, owner, &corners\)/,
  'graveyards must share the authoritative rotated-footprint check used by residence plots');
assert.doesNotMatch(graveyards, /building_pick_radius|zone_overlaps_footprint\(/,
  'the selection-radius square must not reject land outside the visible church boundary');

const vineyards = source('server/src/reducers/vineyards.rs');
assert.match(vineyards, /VINEYARD_MONASTERY_MAX_DISTANCE/);
assert.doesNotMatch(vineyards, /VINEYARD_MONASTERY_ADJACENCY_DISTANCE|already has a vineyard/);

const vineyardTable = source('server/src/tables.rs');
assert.match(vineyardTable, /accessor = vineyard_parcel[\s\S]*index\(accessor = building_id[\s\S]*#\[auto_inc\]/);

const economy = source('server/src/simulation/expanded_economy.rs');
assert.match(economy, /Aggregate before applying the diminishing area curve/);
assert.match(economy, /vineyard_site \/ vineyard_area[\s\S]*vineyard_shape \/ vineyard_area/);

// Exercise the actual mouse lifecycle, including activation without mouseenter.
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const testWindow = new EventTarget();
Object.defineProperty(globalThis, 'window', { configurable: true, value: testWindow });
const canvas = new EventTarget();
const chapel = {
  id: 'placement-chapel', kind: 'chapel', x: 20, z: -20, yaw: 0,
  constructionComplete: true, workRadius: 38,
} as BuildingState;
const state = {
  buildings: new Map([[chapel.id, chapel]]),
  burgageZones: new Map(), farmFields: new Map(), pastures: new Map(),
  graveyards: new Map(), vineyardParcels: new Map(),
} as GameState;
let committed = 0;
const placementTool = new FarmFieldTool({
  domElement: canvas as unknown as HTMLElement,
  camera: new THREE.PerspectiveCamera(),
  terrainProjector: { pick: (x: number, z: number) => new THREE.Vector3(x, 0, z) } as never,
  getState: () => state,
  getHeightAt: () => 0,
  isWaterAt: () => false,
  isResourceDepositAt: () => false,
  onCommit: () => {}, onCommitPasture: () => {}, onCommitVineyard: () => {},
  onCommitGraveyard: () => { committed += 1; },
  onModeChanged: () => {}, isBlocked: () => false,
});
const previewRoot = new THREE.Group();
placementTool.attachTo(previewRoot);
const preview = previewRoot.getObjectByName('Terrain-hugging land parcel preview')!;
const hover = preview.getObjectByName('Land parcel hover anchor') as THREE.Mesh;
const anchors = preview.getObjectByName('Land parcel corner anchors') as THREE.InstancedMesh;
const border = preview.getObjectByName('Farmland dotted border') as THREE.Mesh;
const mouse = (type: string, x: number, z: number): void => {
  canvas.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
    clientX: x, clientY: z, button: 0, altKey: false,
  }));
  placementTool.update();
};
const key = (value: string): void => {
  testWindow.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: value }));
};
const { halfWidth } = getBuildingFootprintHalfExtents('chapel');
const besideChurch = (inset = 0): FarmFieldCorners => {
  const local = [[halfWidth + inset, -4], [halfWidth + inset + 8, -4],
    [halfWidth + inset + 8, 4], [halfWidth + inset, 4]];
  return local.map(([x, z]) => ({
    x: chapel.x + x * Math.cos(chapel.yaw!) + z * Math.sin(chapel.yaw!),
    z: chapel.z - x * Math.sin(chapel.yaw!) + z * Math.cos(chapel.yaw!),
  })) as unknown as FarmFieldCorners;
};
try {
  placementTool.setMode('graveyard', chapel.id);
  const validator = placementTool as unknown as {
    validate(corners: FarmFieldCorners): { ok: boolean; reason?: string };
  };
  for (const yaw of [0, Math.PI / 2, 0.63, -1.09]) {
    chapel.yaw = yaw;
    assert.equal(validator.validate(besideChurch(0.1)).ok, true,
      `burial ground just outside the church must be accepted at yaw ${yaw}`);
    assert.equal(validator.validate(besideChurch()).ok, true,
      `a shared church boundary must be accepted at yaw ${yaw}`);
    assert.equal(validator.validate(besideChurch(-0.5)).reason, 'building',
      `burial ground crossing the church boundary must be rejected at yaw ${yaw}`);
  }
  chapel.yaw = 0;
  const corners = besideChurch(0.1);
  mouse('mousemove', corners[0].x, corners[0].z);
  assert.equal(preview.visible && hover.visible, true,
    'a cursor ring must appear before the first click, even without mouseenter');
  assert.equal(anchors.count, 0);
  mouse('mouseleave', corners[0].x, corners[0].z);
  assert.equal(preview.visible, false, 'leaving the canvas must hide an unstarted preview');
  mouse('mousedown', corners[0].x, corners[0].z);
  assert.equal(preview.visible && anchors.visible, true, 'the first click must leave a visible corner');
  assert.equal(anchors.count, 1);
  mouse('mouseleave', corners[0].x, corners[0].z);
  assert.equal(preview.visible && anchors.visible, true, 'leaving must preserve the first fixed corner');
  assert.equal(hover.visible, false);
  mouse('mousemove', corners[1].x, corners[1].z);
  assert.equal(border.visible, true, 'the boundary must follow the next corner under the mouse');
  for (const point of corners.slice(1)) mouse('mousedown', point.x, point.z);
  assert.equal(placementTool.isDraftBuildable(), true);
  assert.equal(anchors.count, 4);
  assert.equal(hover.visible, false, 'a completed draft must hide the moving cursor marker');
  key('Backspace');
  assert.equal(anchors.count, 3, 'undo must remove only the final fixed corner');
  assert.equal(hover.visible, true, 'undo must restore the moving corner marker');
  mouse('mousedown', corners[3].x, corners[3].z);
  placementTool.commitDraft();
  await Promise.resolve();
  assert.equal(committed, 1);
  assert.equal(preview.visible, false, 'successful placement must clear the draft markers');
  placementTool.setEnabled(false);
  assert.equal(previewRoot.getObjectByName('Linked land-parcel origin footprint warning')!.visible, false);
} finally {
  placementTool.dispose();
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
  else Reflect.deleteProperty(globalThis, 'window');
}

console.log('linked parcels: snapping, church footprint boundaries, mouse preview, undo, and commit checks passed');
