import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import {
  GUARDHOUSE_FOOD_VISUAL_SEGMENTS,
  GUARDHOUSE_POLEARM_VISUAL_SEGMENTS,
} from '../src/buildings/armoryStockpileVisuals.ts';
import {
  BUILDING_DETAIL_CASTER_BATCH_FLAG,
} from '../src/buildings/buildingDetailShadowBatch.ts';
import {
  BUILDING_LOCAL_VISUAL_BOUNDS,
  BUILDING_VISUAL_BOUNDS_SAFETY_MARGIN,
} from '../src/buildings/BuildingVisualBounds.ts';
import {
  GUARDHOUSE_PAYROLL_VISUAL_SEGMENTS,
} from '../src/buildings/meshes/civicLogisticsBuildingMeshes.ts';
import {
  PROCEDURAL_BUILDING_CATALOG,
} from '../src/buildings/proceduralArchitecture/catalog.ts';
import {
  STOREHOUSE_CLAY_VISUAL_SEGMENTS,
  STOREHOUSE_FIREWOOD_VISUAL_SEGMENTS,
  STOREHOUSE_IRON_VISUAL_SEGMENTS,
  STOREHOUSE_SALT_VISUAL_SEGMENTS,
  STOREHOUSE_STONE_VISUAL_SEGMENTS,
  STOREHOUSE_TIMBER_VISUAL_SEGMENTS,
} from '../src/buildings/buildingStockpileVisuals.ts';
import {
  WATCHTOWER_GALLERY_DECK_CENTER_Y,
  WATCHTOWER_GALLERY_DECK_THICKNESS,
  WATCHTOWER_GALLERY_POST_CENTER_Y,
  WATCHTOWER_GALLERY_POST_HEIGHT,
  WATCHTOWER_GALLERY_RAIL_CENTER_Y,
  WATCHTOWER_GALLERY_RAIL_HEIGHT,
  WATCHTOWER_GALLERY_TOP_BEAM_Y,
} from '../src/buildings/watchtowerLayout.ts';
import type { BuildingKind } from '../src/generated/gameBalance.ts';

const KINDS = [
  'town_hall',
  'village_storehouse',
  'watchtower',
  'guardhouse',
  'palisaded_refuge',
] as const satisfies readonly BuildingKind[];
const EPSILON = 1e-4;

type ProceduralMetrics = Readonly<{
  sourceMeshes: number;
  visibleMeshes: number;
  sourceTriangles: number;
  visibleTriangles: number;
  sourceDrawCalls: number;
  visibleDrawCalls: number;
  distinctMaterials: number;
  atlasBackedMaterials: number;
  finiteGeometry: boolean;
  withinTriangleCeiling: boolean;
  withinVisibleTriangleCeiling: boolean;
}>;

type BoundsAudit = Readonly<{
  box: THREE.Box3;
  meshCount: number;
  vertexCount: number;
}>;

const models = new Map<typeof KINDS[number], THREE.Group>();
for (const kind of KINDS) models.set(kind, createBuildingMesh(kind));

function model(kind: typeof KINDS[number]): THREE.Group {
  const root = models.get(kind);
  assert.ok(root, `missing ${kind} test model`);
  return root;
}

function objectsNamed(root: THREE.Object3D, name: string): THREE.Object3D[] {
  const matches: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object.name === name) matches.push(object);
  });
  return matches;
}

function meshes(root: THREE.Object3D): THREE.Mesh<THREE.BufferGeometry>[] {
  const result: THREE.Mesh<THREE.BufferGeometry>[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh<THREE.BufferGeometry>;
    if (mesh.isMesh) result.push(mesh);
  });
  return result;
}

function assertNamedCount(
  root: THREE.Object3D,
  name: string,
  expected: number,
): THREE.Object3D[] {
  const matches = objectsNamed(root, name);
  assert.equal(matches.length, expected, `${root.name} must preserve ${expected} ${name} object(s)`);
  return matches;
}

function assertHiddenRuntimeGroup(root: THREE.Object3D, name: string): THREE.Object3D {
  const [anchor] = assertNamedCount(root, name, 1);
  assert.ok(anchor);
  assert.equal(anchor.visible, false, `${name} must remain runtime-hidden by default`);
  assert.deepEqual(anchor.position.toArray(), [0, 0, 0], `${name} placement anchor must remain root-local`);
  return anchor;
}

function measureVisibleStructuralBounds(root: THREE.Object3D): BoundsAudit {
  root.updateWorldMatrix(true, true);
  const rootInverse = root.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const instanceMatrix = new THREE.Matrix4();
  const meshWorld = new THREE.Matrix4();
  const relative = new THREE.Matrix4();
  const vertex = new THREE.Vector3();
  let meshCount = 0;
  let vertexCount = 0;

  const visit = (object: THREE.Object3D, parentVisible: boolean): void => {
    const visible = parentVisible && object.visible;
    if (!visible || object.userData[BUILDING_DETAIL_CASTER_BATCH_FLAG] === true) return;
    const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
    if (mesh.isMesh && mesh.geometry) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const position = mesh.geometry.getAttribute('position');
      if (position && materials.some((material) => material.visible)) {
        const instanceCount = (mesh as THREE.InstancedMesh).isInstancedMesh
          ? Math.max(0, Math.floor((mesh as THREE.InstancedMesh).count))
          : 1;
        if (instanceCount > 0) meshCount += 1;
        for (let instance = 0; instance < instanceCount; instance += 1) {
          if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
            (mesh as THREE.InstancedMesh).getMatrixAt(instance, instanceMatrix);
            meshWorld.multiplyMatrices(mesh.matrixWorld, instanceMatrix);
          } else {
            meshWorld.copy(mesh.matrixWorld);
          }
          relative.multiplyMatrices(rootInverse, meshWorld);
          for (let index = 0; index < position.count; index += 1) {
            vertex.fromBufferAttribute(position, index).applyMatrix4(relative);
            assert.ok(
              Number.isFinite(vertex.x) && Number.isFinite(vertex.y) && Number.isFinite(vertex.z),
              `${root.name}/${mesh.name || 'Mesh'} has non-finite geometry`,
            );
            box.expandByPoint(vertex);
            vertexCount += 1;
          }
        }
      }
    }
    for (const child of object.children) visit(child, visible);
  };
  visit(root, true);
  return { box, meshCount, vertexCount };
}

// Catalog ceilings, shared material identity, and metric UV density apply to
// every civic/defensive source mesh, including hidden runtime stock segments.
const reports: Array<Record<string, number | string>> = [];
for (const kind of KINDS) {
  const root = model(kind);
  assert.deepEqual(root.position.toArray(), [0, 0, 0], `${kind} placement origin changed`);
  const metrics = root.userData.proceduralArchitectureMetrics as ProceduralMetrics;
  const ceiling = PROCEDURAL_BUILDING_CATALOG[kind].triangleCeiling;
  assert.ok(metrics && metrics.finiteGeometry, `${kind} needs finite compiler metrics`);
  assert.ok(metrics.sourceTriangles <= ceiling, `${kind} exceeds its ${ceiling}-triangle source ceiling`);
  assert.ok(metrics.visibleTriangles <= ceiling, `${kind} exceeds its ${ceiling}-triangle visible ceiling`);
  assert.equal(metrics.withinTriangleCeiling, true);
  assert.equal(metrics.withinVisibleTriangleCeiling, true);

  for (const mesh of meshes(root)) {
    if (mesh.userData[BUILDING_DETAIL_CASTER_BATCH_FLAG] === true) continue;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      assert.equal(
        material.userData.sharedBuildingMaterial,
        true,
        `${kind}/${mesh.name || 'Mesh'} must use a shared building-kit material`,
      );
      const meters = Number(material.userData.metricUvMeters);
      if (!Number.isFinite(meters) || meters <= 0) continue;
      const uv = mesh.geometry.getAttribute('uv');
      const position = mesh.geometry.getAttribute('position');
      assert.ok(uv, `${kind}/${mesh.name || 'Mesh'} is missing metric UVs`);
      assert.equal(uv.count, position.count, `${kind}/${mesh.name || 'Mesh'} UV/position counts differ`);
      assert.ok(
        Math.abs(Number(mesh.geometry.userData.metricUvMeters) - meters) <= EPSILON,
        `${kind}/${mesh.name || 'Mesh'} geometry/material metric UV scales differ`,
      );
    }
  }

  const measured = measureVisibleStructuralBounds(root);
  const declared = BUILDING_LOCAL_VISUAL_BOUNDS[kind];
  assert.ok(declared.minX <= measured.box.min.x - BUILDING_VISUAL_BOUNDS_SAFETY_MARGIN + EPSILON);
  assert.ok(declared.maxX >= measured.box.max.x + BUILDING_VISUAL_BOUNDS_SAFETY_MARGIN - EPSILON);
  assert.ok(declared.minZ <= measured.box.min.z - BUILDING_VISUAL_BOUNDS_SAFETY_MARGIN + EPSILON);
  assert.ok(declared.maxZ >= measured.box.max.z + BUILDING_VISUAL_BOUNDS_SAFETY_MARGIN - EPSILON);
  reports.push({
    kind,
    sourceMeshes: metrics.sourceMeshes,
    visibleMeshes: metrics.visibleMeshes,
    sourceTriangles: metrics.sourceTriangles,
    visibleTriangles: metrics.visibleTriangles,
    sourceDrawCalls: metrics.sourceDrawCalls,
    visibleDrawCalls: metrics.visibleDrawCalls,
    materials: metrics.distinctMaterials,
    atlasMaterials: metrics.atlasBackedMaterials,
    boundMinX: Number(measured.box.min.x.toFixed(3)),
    boundMaxX: Number(measured.box.max.x.toFixed(3)),
    boundMinZ: Number(measured.box.min.z.toFixed(3)),
    boundMaxZ: Number(measured.box.max.z.toFixed(3)),
    measuredMeshes: measured.meshCount,
    measuredVertices: measured.vertexCount,
  });
}

// Literal apertures: the three gabled buildings rebuild their façade shells
// around openings, while the tower door and vent sit between separate panels.
for (const [kind, counts] of [
  ['town_hall', [4, 7]],
  ['village_storehouse', [2, 3]],
  ['guardhouse', [2, 3]],
] as const) {
  const perforated = meshes(model(kind))
    .map((mesh) => Number(mesh.userData.proceduralFacadeOpeningCount))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  assert.deepEqual(perforated, [...counts], `${kind} must retain physical front/rear façade apertures`);
}
for (const [kind, doors, windows] of [
  ['town_hall', 2, 9],
  ['village_storehouse', 1, 4],
  ['watchtower', 1, 1],
  ['guardhouse', 1, 4],
] as const) {
  const openings = objectsWithData(model(kind), 'facadeOpeningKind');
  assert.equal(openings.filter((opening) => opening.userData.facadeOpeningKind === 'door').length, doors);
  assert.equal(openings.filter((opening) => opening.userData.facadeOpeningKind === 'window').length, windows);
  assert.ok(openings.every((opening) => opening.userData.hasCrossBars === false));
}
assertNamedCount(model('watchtower'), 'Watchtower ground store rear wall beside door', 2);
assertNamedCount(model('watchtower'), 'Watchtower ground store wall below vent', 1);
assertNamedCount(model('watchtower'), 'Watchtower ground store wall above vent', 1);

// Permanent attached roofs and tower caps must use semantic, course-aligned,
// physical-UV geometry from the shared kit.
for (const [kind, roofName] of [
  ['town_hall', 'Town hall bell lantern joined shingle cap'],
  ['watchtower', 'Watchtower joined steep shingle cap'],
  ['palisaded_refuge', 'Refuge gate watch-platform joined shingle cap'],
] as const) {
  const [roof] = assertNamedCount(model(kind), roofName, 1) as THREE.Mesh<THREE.BufferGeometry>[];
  assert.ok(roof?.isMesh);
  assert.equal(roof.userData.proceduralRoofAttachment, 'hipped-cap');
  assert.equal(roof.userData.proceduralPrimitiveCount, 4);
  assert.equal(roof.geometry.userData.proceduralGeometryWriter, 'semantic-physical-uv-v1');
  assert.ok(roof.geometry.userData.proceduralPhysicalUv);
}
for (const [kind, roofName, highEdge] of [
  ['village_storehouse', 'Village storehouse loading canopy roof', 'negativeZ'],
  ['guardhouse', 'Frontier guardhouse drill-yard roof', 'negativeX'],
  ['palisaded_refuge', 'Refuge shelter roof', 'negativeX'],
] as const) {
  const [roof] = assertNamedCount(model(kind), roofName, 1) as THREE.Mesh<THREE.BufferGeometry>[];
  assert.ok(roof?.isMesh);
  assert.equal(roof.userData.proceduralRoofAttachment, 'lean-to');
  assert.equal(roof.userData.leanToHighEdge, highEdge);
  assert.equal(roof.geometry.userData.proceduralGeometryWriter, 'semantic-physical-uv-v1');
  assert.ok(roof.geometry.userData.proceduralPhysicalUv);
}

for (const [kind, frameName, memberCount] of [
  ['village_storehouse', 'Village storehouse connected loading canopy frame', 14],
  ['watchtower', 'Watchtower joined bracing and gallery bearer frame', 12],
  ['guardhouse', 'Guardhouse connected drill-yard roof frame', 13],
  ['palisaded_refuge', 'Refuge joined palisade horizontal bindings', 96],
  ['palisaded_refuge', 'Refuge connected gate watch-platform frame and ladder', 23],
  ['palisaded_refuge', 'Refuge connected emergency-shelter roof frame', 12],
] as const) {
  const [frame] = assertNamedCount(model(kind), frameName, 1);
  assert.ok(frame);
  assert.equal(frame.userData.structuralConnection, 'joined-endpoint-authored');
  assert.equal(frame.userData.structuralMemberCount, memberCount);
}
assertNamedCount(model('town_hall'), 'Town hall council porch roof post', 2);
assertNamedCount(model('town_hall'), 'Town hall bell lantern connected post', 4);

// Runtime-owned visibility anchors and their segment cardinalities remain
// unchanged, so stock/guard update code can continue toggling the same objects.
const townHall = model('town_hall');
assertHiddenRuntimeGroup(townHall, 'TownHallTreasuryChest');

const storehouse = model('village_storehouse');
for (const [stockpile, segment, count] of [
  ['StorehouseTimberStockpile', 'StorehouseTimberSegment', STOREHOUSE_TIMBER_VISUAL_SEGMENTS],
  ['StorehouseStoneStockpile', 'StorehouseStoneSegment', STOREHOUSE_STONE_VISUAL_SEGMENTS],
  ['StorehouseFirewoodStockpile', 'StorehouseFirewoodSegment', STOREHOUSE_FIREWOOD_VISUAL_SEGMENTS],
  ['StorehouseIronStockpile', 'StorehouseIronSegment', STOREHOUSE_IRON_VISUAL_SEGMENTS],
  ['StorehouseClayStockpile', 'StorehouseClaySegment', STOREHOUSE_CLAY_VISUAL_SEGMENTS],
  ['StorehouseSaltStockpile', 'StorehouseSaltSegment', STOREHOUSE_SALT_VISUAL_SEGMENTS],
] as const) {
  assertHiddenRuntimeGroup(storehouse, stockpile);
  assertNamedCount(storehouse, segment, count);
}
assertHiddenRuntimeGroup(storehouse, 'TradingPostProceedsChest');
assertNamedCount(storehouse, 'TradingPostReceiptSegment', 3);

const guardhouse = model('guardhouse');
assertHiddenRuntimeGroup(guardhouse, 'GuardhousePolearmStockpile');
assertNamedCount(guardhouse, 'GuardhousePolearmSegment', GUARDHOUSE_POLEARM_VISUAL_SEGMENTS);
assertHiddenRuntimeGroup(guardhouse, 'GuardhouseFoodStockpile');
assertNamedCount(guardhouse, 'GuardhouseFoodSegment', GUARDHOUSE_FOOD_VISUAL_SEGMENTS);
assertHiddenRuntimeGroup(guardhouse, 'GuardhousePayrollChest');
assertNamedCount(guardhouse, 'GuardhousePayrollSegment', GUARDHOUSE_PAYROLL_VISUAL_SEGMENTS);

const watchtower = model('watchtower');
const [galleryDeck] = assertNamedCount(watchtower, 'Watchtower staffed gallery deck anchor', 1) as THREE.Mesh<THREE.BoxGeometry>[];
assert.ok(galleryDeck?.isMesh);
assert.equal(galleryDeck.position.y, WATCHTOWER_GALLERY_DECK_CENTER_Y);
assert.equal(galleryDeck.geometry.parameters.height, WATCHTOWER_GALLERY_DECK_THICKNESS);
const gallery = assertNamedCount(watchtower, 'Open timber watch gallery', 1)[0];
assert.ok(gallery);
assert.equal(
  gallery.children.filter((child) => child.position.y === WATCHTOWER_GALLERY_RAIL_CENTER_Y).length,
  4,
);
assert.equal(
  gallery.children.filter((child) => child.position.y === WATCHTOWER_GALLERY_POST_CENTER_Y).length,
  8,
);
assert.equal(
  gallery.children.filter((child) => child.position.y === WATCHTOWER_GALLERY_TOP_BEAM_Y).length,
  4,
);
for (const child of gallery.children.filter((candidate) => candidate.position.y === WATCHTOWER_GALLERY_RAIL_CENTER_Y)) {
  const parameters = (child as THREE.Mesh<THREE.BoxGeometry>).geometry.parameters;
  assert.ok(
    parameters.height === WATCHTOWER_GALLERY_RAIL_HEIGHT
      || parameters.width === WATCHTOWER_GALLERY_RAIL_HEIGHT,
  );
}
for (const child of gallery.children.filter((candidate) => candidate.position.y === WATCHTOWER_GALLERY_POST_CENTER_Y)) {
  assert.equal((child as THREE.Mesh<THREE.BoxGeometry>).geometry.parameters.height, WATCHTOWER_GALLERY_POST_HEIGHT);
}

// Fired clay remains a single restrained civic-status signal on the town hall;
// defense/logistics silhouettes stay fieldstone, timber, and split shingle.
const materialKeys = (root: THREE.Object3D): Set<string> => {
  const result = new Set<string>();
  for (const mesh of meshes(root)) {
    for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
      const key = material.userData.buildingMaterialKey;
      if (typeof key === 'string') result.add(key);
    }
  }
  return result;
};
assert.ok(materialKeys(townHall).has('clayRed'));
for (const kind of ['village_storehouse', 'watchtower', 'guardhouse', 'palisaded_refuge'] as const) {
  const keys = materialKeys(model(kind));
  assert.equal(keys.has('clayRed') || keys.has('clayDark'), false, `${kind} must not borrow town-hall tile status`);
}
for (const kind of KINDS) {
  const root = model(kind);
  root.traverse((object) => {
    assert.doesNotMatch(
      object.name,
      /(?:foliage|vegetation|shrub|tree|moss|grass)/i,
      `${kind} must leave vegetation to the placement layer`,
    );
  });
}

// The refuge's direct instanced stockade meshes are explicitly metric-UV
// prepared too; they cannot escape the shared atlas audit through instancing.
for (const name of ['Refuge palisade stakes', 'Refuge palisade stake tips']) {
  const [mesh] = assertNamedCount(model('palisaded_refuge'), name, 1) as THREE.InstancedMesh[];
  assert.ok(mesh?.isInstancedMesh);
  assert.ok(mesh.geometry.getAttribute('uv'));
  assert.equal(
    mesh.geometry.userData.metricUvMeters,
    Number((mesh.material as THREE.Material).userData.metricUvMeters),
  );
}

console.log(`Civic/defense architecture passed: ${JSON.stringify(reports)}`);

function objectsWithData(root: THREE.Object3D, key: string): THREE.Object3D[] {
  const result: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (Object.prototype.hasOwnProperty.call(object.userData, key)) result.push(object);
  });
  return result;
}
