import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createGuardhouseMesh,
  createPalisadedRefugeMesh,
  createTownHallMesh,
  createVillageStorehouseMesh,
  createWatchtowerMesh,
} from '../src/buildings/meshes/civicLogisticsBuildingMeshes.ts';

const FACTORIES = {
  town_hall: createTownHallMesh,
  village_storehouse: createVillageStorehouseMesh,
  watchtower: createWatchtowerMesh,
  guardhouse: createGuardhouseMesh,
  palisaded_refuge: createPalisadedRefugeMesh,
} as const;

type CivicKind = keyof typeof FACTORIES;

function meshes(root: THREE.Object3D): THREE.Mesh<THREE.BufferGeometry>[] {
  const result: THREE.Mesh<THREE.BufferGeometry>[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh<THREE.BufferGeometry>;
    if (mesh.isMesh) result.push(mesh);
  });
  return result;
}

function named(root: THREE.Object3D, name: string): THREE.Object3D[] {
  const result: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object.name === name) result.push(object);
  });
  return result;
}

function geometryDiagnostics(mesh: THREE.Mesh<THREE.BufferGeometry>): {
  materialRole?: string;
  primitiveCount?: number;
  triangleCount?: number;
  primitives?: readonly { semanticId: string; moduleId?: string; primitive: string }[];
} {
  return mesh.geometry.userData.proceduralGeometryDiagnostics ?? {};
}

function sourceMetrics(root: THREE.Object3D): {
  meshes: number;
  triangles: number;
} {
  let sourceMeshes = 0;
  let sourceTriangles = 0;
  for (const mesh of meshes(root)) {
    sourceMeshes += 1;
    const positions = mesh.geometry.getAttribute('position');
    const triangles = (mesh.geometry.index?.count ?? positions?.count ?? 0) / 3;
    sourceTriangles += triangles;
  }
  return { meshes: sourceMeshes, triangles: sourceTriangles };
}

function semanticManifest(root: THREE.Object3D): string[] {
  return meshes(root).flatMap((mesh) => {
    const diagnostics = geometryDiagnostics(mesh);
    return diagnostics.primitives?.map((primitive) => [
      mesh.name,
      primitive.semanticId,
      primitive.moduleId ?? '',
      primitive.primitive,
    ].join('|')) ?? [];
  });
}

function materialKeys(root: THREE.Object3D): string[] {
  return meshes(root).flatMap((mesh) => {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    return materials
      .map((material) => material.userData.buildingMaterialKey)
      .filter((key): key is string => typeof key === 'string');
  });
}

const models = Object.fromEntries(
  Object.entries(FACTORIES).map(([kind, factory]) => [kind, factory()]),
) as Record<CivicKind, THREE.Group>;

// The settlement-wide timber vocabulary must stay brown. Pale sawn timber is
// deliberately absent from civic frames, racks, crates, chests, and fences;
// true light surfaces in this family are plaster, salt sacks, and masonry.
for (const [kind, root] of Object.entries(models) as [CivicKind, THREE.Group][]) {
  const keys = materialKeys(root);
  assert.equal(keys.includes('timberLight'), false, `${kind} reintroduced pale structural timber`);
  assert.ok(keys.includes('timberDark'), `${kind} must retain load-bearing dark oak members`);
}

// Every visible or runtime-controlled crate is one semantic, course-aligned
// weathered-board mesh. This preserves per-segment visibility while removing
// the old three-draw body/batten assembly.
for (const [kind, expected] of [
  ['village_storehouse', 3],
  ['guardhouse', 2],
  ['palisaded_refuge', 2],
] as const) {
  const crates = meshes(models[kind]).filter((mesh) => mesh.userData.proceduralStorageProp === 'crate');
  assert.equal(crates.length, expected, `${kind} crate visibility cardinality changed`);
  for (const crate of crates) {
    assert.match(crate.name, /joined brown timber crate$/);
    assert.equal((crate.material as THREE.Material).userData.buildingMaterialKey, 'timberWeathered');
    assert.equal(crate.userData.structuralConnection, 'joined-boarded-carcass');
    const diagnostics = geometryDiagnostics(crate);
    assert.equal(diagnostics.materialRole, 'weathered-boards');
    assert.equal(diagnostics.primitiveCount, 3);
    assert.equal(diagnostics.triangleCount, 36);
    assert.ok(crate.geometry.userData.proceduralPhysicalUv);
  }
}

// The guardhouse front frame now reaches its roof-bearing wall plate and uses
// one endpoint-authored metric-UV slot. A small concealed overlap is required:
// a positive gap here would make the roof appear to float above the facade.
const guardhouse = models.guardhouse;
const [guardhouseFrame] = named(
  guardhouse,
  'Guardhouse joined road-facade sill post rail and wall-plate frame',
) as THREE.Mesh<THREE.BufferGeometry>[];
assert.ok(guardhouseFrame?.isMesh);
assert.equal(guardhouseFrame.userData.structuralConnection, 'joined-endpoint-authored');
assert.equal(guardhouseFrame.userData.structuralMemberCount, 7);
assert.equal(geometryDiagnostics(guardhouseFrame).primitiveCount, 7);
const frameBounds = new THREE.Box3().setFromObject(guardhouseFrame);
const primaryRoofPlanes = [
  ...named(guardhouse, 'Gable shell joined left roof plane'),
  ...named(guardhouse, 'Gable shell joined right roof plane'),
] as THREE.Mesh<THREE.BufferGeometry>[];
assert.equal(primaryRoofPlanes.length, 2);
const roofEaveBottom = Math.min(...primaryRoofPlanes.map(
  (roof) => new THREE.Box3().setFromObject(roof).min.y,
));
assert.ok(frameBounds.max.y >= roofEaveBottom, 'guardhouse facade plate must meet the roof shell');
assert.ok(frameBounds.max.y - roofEaveBottom <= 0.12, 'guardhouse facade plate must not protrude through the roof');

// The short drill-yard fence is two deterministic instance draws rather than
// fourteen tiny meshes. Instance counts and metric-UV preparation are fixed.
for (const name of [
  'Guardhouse drill-yard brown timber palisade stakes',
  'Guardhouse drill-yard brown timber palisade tips',
]) {
  const [mesh] = named(guardhouse, name) as THREE.InstancedMesh[];
  assert.ok(mesh?.isInstancedMesh, `${name} must remain instanced`);
  assert.equal(mesh.count, 7);
  assert.equal(mesh.geometry.userData.metricUvMeters, Number((mesh.material as THREE.Material).userData.metricUvMeters));
}

// Gabled civic/storage facades must retain actual perforated wall geometry,
// not intact walls hidden behind dark door/window rectangles.
for (const [kind, expectedCounts] of [
  ['town_hall', [4, 7]],
  ['village_storehouse', [2, 3]],
  ['guardhouse', [2, 3]],
] as const) {
  const counts = meshes(models[kind])
    .map((mesh) => Number(mesh.userData.proceduralFacadeOpeningCount))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  assert.deepEqual(counts, [...expectedCounts], `${kind} literal facade aperture count changed`);
}

// Current source-level budgets catch regressions before gameplay static
// batching. Triangles stay comfortably below family ceilings, while the two
// optimized storage/defense models retain the reduced source draw topology.
const budgets: Record<CivicKind, { meshes: number; triangles: number }> = {
  town_hall: { meshes: 160, triangles: 2300 },
  village_storehouse: { meshes: 140, triangles: 3300 },
  watchtower: { meshes: 74, triangles: 1200 },
  guardhouse: { meshes: 105, triangles: 2000 },
  palisaded_refuge: { meshes: 20, triangles: 3000 },
};
const reports: Record<string, { meshes: number; triangles: number }> = {};
for (const [kind, root] of Object.entries(models) as [CivicKind, THREE.Group][]) {
  const metrics = sourceMetrics(root);
  reports[kind] = metrics;
  assert.ok(metrics.meshes <= budgets[kind].meshes, `${kind} source mesh budget regressed`);
  // Instance repetition is a render count, not source topology; this audit
  // intentionally records each shared source geometry once.
  assert.ok(metrics.triangles <= budgets[kind].triangles, `${kind} source triangle budget regressed`);
  assert.deepEqual(
    semanticManifest(FACTORIES[kind]()),
    semanticManifest(root),
    `${kind} semantic procedural placements must compile deterministically`,
  );
  root.traverse((object) => {
    assert.doesNotMatch(object.name, /(?:foliage|vegetation|crop|shrub|tree)/i);
  });
}

console.log(`Civic/logistics architecture passed: ${JSON.stringify(reports)}`);
