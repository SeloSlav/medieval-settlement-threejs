import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import {
  PROCESSOR_WORKSHOP_ARCHITECTURE_PLANS,
} from '../src/buildings/meshes/expandedBuildingMeshes.ts';
import { PROCEDURAL_BUILDING_CATALOG } from '../src/buildings/proceduralArchitecture/catalog.ts';
import type { BuildingKind } from '../src/generated/gameBalance.ts';

const KINDS = [
  'threshing_barn',
  'brewery',
  'bakery',
  'smokehouse',
  'watermill',
  'carpenter',
  'weaver',
] as const satisfies readonly BuildingKind[];

type TargetKind = typeof KINDS[number];
type ArchitectureMetrics = Readonly<{
  sourceMeshes: number;
  visibleMeshes: number;
  sourceTriangles: number;
  visibleTriangles: number;
  finiteGeometry: boolean;
  withinTriangleCeiling: boolean;
  withinVisibleTriangleCeiling: boolean;
}>;

type ApertureRay = Readonly<{
  label: string;
  origin: readonly [number, number, number];
  direction: readonly [number, number, number];
}>;

const APERTURE_RAYS: Readonly<Record<TargetKind, readonly ApertureRay[]>> = {
  threshing_barn: [
    { label: 'front service door', origin: [-3.1, 1.6, 4.02], direction: [0, 0, -1] },
    { label: 'front cart door', origin: [0, 1.7, 4.02], direction: [0, 0, -1] },
    { label: 'rear cart door', origin: [0, 1.7, -4.02], direction: [0, 0, 1] },
    { label: 'front left vent', origin: [-4.2, 2.35, 4.02], direction: [0, 0, -1] },
    { label: 'front right vent', origin: [4.2, 2.35, 4.02], direction: [0, 0, -1] },
  ],
  brewery: [
    { label: 'door', origin: [-1.8, 1.8, 3.7], direction: [0, 0, -1] },
    { label: 'window', origin: [1.45, 2.35, 3.7], direction: [0, 0, -1] },
  ],
  bakery: [
    { label: 'door', origin: [-1.45, 1.8, 3.35], direction: [0, 0, -1] },
    { label: 'window', origin: [1.35, 2.18, 3.35], direction: [0, 0, -1] },
  ],
  smokehouse: [
    { label: 'door', origin: [-1, 2.25, 3.2], direction: [0, 0, -1] },
    { label: 'front left smoke vent', origin: [0.82, 3.12, 3.2], direction: [0, 0, -1] },
    { label: 'front right smoke vent', origin: [1.48, 3.12, 3.2], direction: [0, 0, -1] },
    { label: 'rear smoke vent', origin: [0, 3.18, -3.2], direction: [0, 0, 1] },
  ],
  watermill: [
    { label: 'door', origin: [-1.7, 2.25, 3.85], direction: [0, 0, -1] },
    { label: 'window', origin: [1.5, 2.85, 3.85], direction: [0, 0, -1] },
  ],
  carpenter: [
    { label: 'door', origin: [-1.3, 1.55, 3.25], direction: [0, 0, -1] },
    { label: 'window', origin: [1.4, 1.85, 3.25], direction: [0, 0, -1] },
  ],
  weaver: [
    { label: 'door', origin: [-1.35, 1.55, 3.3], direction: [0, 0, -1] },
    { label: 'window', origin: [1.45, 1.82, 3.3], direction: [0, 0, -1] },
  ],
};

const JOINED_FRAMES = {
  threshing_barn: ['Threshing barn joined cart-bay and wall-plate frame', 10],
  brewery: ['Brewery joined cooling-bay roof frame', 6],
  smokehouse: ['Smokehouse joined fuel-bay roof frame', 6],
  carpenter: ['Carpenter joined lean-to, bench, and frame-saw structure', 14],
  weaver: ['Weaver joined lean-to, loom, and bench frame', 17],
} as const satisfies Partial<Record<TargetKind, readonly [string, number]>>;

const LEAN_TO_ROOFS = {
  brewery: ['Brewery open-bay roof', 'negativeZ'],
  smokehouse: ['Smokehouse fuel lean-to roof', 'positiveX'],
  carpenter: ['Carpenter open-bay roof', 'negativeX'],
  weaver: ['Weaver open-bay roof', 'negativeX'],
} as const satisfies Partial<Record<TargetKind, readonly [string, string]>>;

const models = new Map<TargetKind, THREE.Group>();
for (const kind of KINDS) models.set(kind, createBuildingMesh(kind));

function model(kind: TargetKind): THREE.Group {
  const root = models.get(kind);
  assert.ok(root, `missing ${kind} model`);
  return root;
}

function meshes(root: THREE.Object3D): THREE.Mesh<THREE.BufferGeometry>[] {
  const result: THREE.Mesh<THREE.BufferGeometry>[] = [];
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) result.push(object as THREE.Mesh<THREE.BufferGeometry>);
  });
  return result;
}

function objectNamed(root: THREE.Object3D, name: string): THREE.Object3D {
  const object = root.getObjectByName(name);
  assert.ok(object, `${root.name} must preserve ${name}`);
  return object;
}

function semanticPrimitiveIds(root: THREE.Object3D): string[] {
  const ids: string[] = [];
  for (const mesh of meshes(root)) {
    const direct = mesh.userData.proceduralPrimitiveDiagnostics as
      | readonly { readonly semanticId: string }[]
      | undefined;
    if (direct) ids.push(...direct.map((primitive) => primitive.semanticId));
    if (direct) continue;
    const geometryDiagnostics = mesh.geometry.userData.proceduralGeometryDiagnostics as
      | { readonly primitives?: readonly { readonly semanticId: string }[] }
      | undefined;
    ids.push(...(geometryDiagnostics?.primitives ?? []).map((primitive) => primitive.semanticId));
  }
  return ids;
}

function assertLiteralAperture(root: THREE.Group, aperture: ApertureRay): void {
  root.updateWorldMatrix(true, true);
  const walls = meshes(root).filter((mesh) => mesh.userData.proceduralWallShell === true);
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(...aperture.origin),
    new THREE.Vector3(...aperture.direction).normalize(),
    0,
    0.85,
  );
  const hits = raycaster.intersectObjects(walls, false);
  assert.equal(
    hits.length,
    0,
    `${root.name} ${aperture.label} must be a literal wall-shell aperture; hit ${hits[0]?.object.name ?? 'unknown'}`,
  );
}

function materialKey(object: THREE.Object3D): string | undefined {
  assert.ok((object as THREE.Mesh).isMesh, `${object.name} must be a mesh`);
  const material = (object as THREE.Mesh).material as THREE.Material;
  return material.userData.buildingMaterialKey as string | undefined;
}

const reports: Array<Record<string, string | number>> = [];
for (const kind of KINDS) {
  const root = model(kind);
  const architecturePlan = PROCESSOR_WORKSHOP_ARCHITECTURE_PLANS[kind];
  assert.equal(root.userData.architecturePlan, architecturePlan);
  assert.match(architecturePlan.semanticId, new RegExp(`^${kind.replaceAll('_', '-')}`));
  assert.deepEqual(root.position.toArray(), [0, 0, 0], `${kind} placement origin changed`);

  const metrics = root.userData.proceduralArchitectureMetrics as ArchitectureMetrics;
  const ceiling = PROCEDURAL_BUILDING_CATALOG[kind].triangleCeiling;
  assert.ok(metrics?.finiteGeometry, `${kind} must compile finite geometry`);
  assert.ok(metrics.sourceTriangles <= ceiling, `${kind} source triangle ceiling exceeded`);
  assert.ok(metrics.visibleTriangles <= ceiling, `${kind} visible triangle ceiling exceeded`);
  assert.equal(metrics.withinTriangleCeiling, true);
  assert.equal(metrics.withinVisibleTriangleCeiling, true);

  const wallOpeningCount = meshes(root).reduce(
    (sum, mesh) => sum + (Number(mesh.userData.proceduralFacadeOpeningCount) || 0),
    0,
  );
  assert.equal(
    wallOpeningCount,
    architecturePlan.literalOpenings,
    `${kind} physical wall-shell opening count changed`,
  );
  for (const aperture of APERTURE_RAYS[kind]) assertLiteralAperture(root, aperture);

  const leftRoof = objectNamed(root, 'Gable shell joined left roof plane') as THREE.Mesh;
  const rightRoof = objectNamed(root, 'Gable shell joined right roof plane') as THREE.Mesh;
  for (const roof of [leftRoof, rightRoof]) {
    assert.equal(roof.userData.proceduralRoofShell, true);
    assert.equal(roof.geometry.userData.proceduralGeometryWriter, 'semantic-physical-uv-v1');
    const plateIntersection = meshes(root)
      .filter((mesh) => mesh.name.includes('Gable shell') && mesh.name.includes('wall plate'))
      .some((plate) => new THREE.Box3().setFromObject(roof).intersectsBox(
        new THREE.Box3().setFromObject(plate),
      ));
    assert.equal(plateIntersection, true, `${kind} roof must bear on a wall plate`);
  }

  const frameExpectation = JOINED_FRAMES[kind];
  if (frameExpectation) {
    const [name, count] = frameExpectation;
    const frame = objectNamed(root, name) as THREE.Mesh;
    assert.equal(frame.userData.structuralConnection, 'joined-endpoint-authored');
    assert.equal(frame.userData.structuralMemberCount, count);
    assert.equal(frame.geometry.userData.proceduralGeometryWriter, 'semantic-physical-uv-v1');
    assert.equal(materialKey(frame), 'timberDark', `${name} must use shared brown structural timber`);
  }

  const leanTo = LEAN_TO_ROOFS[kind];
  if (leanTo && frameExpectation) {
    const roof = objectNamed(root, leanTo[0]) as THREE.Mesh;
    const frame = objectNamed(root, frameExpectation[0]);
    assert.equal(roof.userData.leanToHighEdge, leanTo[1]);
    assert.equal(roof.geometry.userData.proceduralGeometryWriter, 'semantic-physical-uv-v1');
    assert.equal(
      new THREE.Box3().setFromObject(roof).intersectsBox(new THREE.Box3().setFromObject(frame)),
      true,
      `${kind} lean-to roof must physically meet its support frame`,
    );
  }

  for (const anchorName of architecturePlan.dynamicAnchors) {
    const anchor = objectNamed(root, anchorName);
    if (anchorName !== 'Watermill wheel') {
      assert.equal(anchor.visible, false, `${anchorName} must stay runtime-hidden by default`);
    }
  }

  root.traverse((object) => {
    assert.doesNotMatch(
      object.name,
      /(?:foliage|vegetation|crop|grass|shrub|tree)/i,
      `${kind} must leave all vegetation to SeedThree`,
    );
  });

  const semanticIds = semanticPrimitiveIds(root);
  assert.equal(new Set(semanticIds).size, semanticIds.length, `${kind} semantic primitive IDs must be unique`);
  assert.deepEqual(
    semanticPrimitiveIds(createBuildingMesh(kind)),
    semanticIds,
    `${kind} semantic geometry placement must be deterministic`,
  );
  reports.push({
    kind,
    sourceMeshes: metrics.sourceMeshes,
    visibleMeshes: metrics.visibleMeshes,
    sourceTriangles: metrics.sourceTriangles,
    visibleTriangles: metrics.visibleTriangles,
  });
}

// Process-specific mechanical closure. These are stronger than silhouette
// checks: each named machine part must actually intersect the member that
// transfers load or exhaust into the permanent structure.
const bakery = model('bakery');
const ovenDome = objectNamed(bakery, 'Bakery attached masonry oven dome');
const ovenFlue = objectNamed(bakery, 'Bakery oven-to-chimney masonry flue');
const chimney = objectNamed(bakery, 'Bakery oven-axis masonry chimney stack');
assert.equal(new THREE.Box3().setFromObject(ovenDome).intersectsBox(new THREE.Box3().setFromObject(ovenFlue)), true);
assert.equal(new THREE.Box3().setFromObject(ovenFlue).intersectsBox(new THREE.Box3().setFromObject(chimney)), true);

const brewery = model('brewery');
const hearth = objectNamed(brewery, 'Brewery masonry kettle hearth');
const kettle = objectNamed(brewery, 'Brewery copper mash kettle seated on hearth');
assert.equal(new THREE.Box3().setFromObject(hearth).intersectsBox(new THREE.Box3().setFromObject(kettle)), true);

const watermill = model('watermill');
const wheel = objectNamed(watermill, 'Watermill wheel');
assert.ok(wheel instanceof THREE.Group, 'watermill runtime wheel must remain an animatable group');
assert.equal(wheel.position.x, 5.25);
assert.equal(wheel.position.y, 2.15);
const wheelFrame = objectNamed(watermill, 'Watermill joined wheel spokes and paddle boards') as THREE.Mesh;
assert.equal(wheelFrame.userData.structuralMemberCount, 24);
assert.equal(materialKey(wheelFrame), 'timberDark');
const axle = objectNamed(watermill, 'Watermill timber axle entering axle-house bearing');
const bearing = objectNamed(watermill, 'Watermill wall-connected axle bearing block');
assert.equal(new THREE.Box3().setFromObject(axle).intersectsBox(new THREE.Box3().setFromObject(bearing)), true);
assert.equal(meshes(watermill).filter((mesh) => mesh.name === 'Watermill open mill-race side wall').length, 2);

assert.equal(materialKey(objectNamed(watermill, 'Watermill brown timber grain chest')), 'timberMid');
assert.equal(materialKey(objectNamed(model('carpenter'), 'Carpenter brown timber workbench top')), 'timberMid');
assert.equal(materialKey(objectNamed(model('weaver'), 'Weaver brown timber loom bench')), 'timberMid');

console.log(`processor/workshop architecture passed: ${JSON.stringify(reports)}`);
