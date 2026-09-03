import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ForestManager } from '../src/props/ForestManager.ts';
import { createStubForestInstances } from '../src/props/forestInstanceStub.ts';
import type { ForestTreePlacement } from '../src/props/forestPlacements.ts';
import {
  commitHarvestStumpInstanceUpdates,
  createHarvestStumpInstances,
  disposeHarvestStumpInstances,
  hideHarvestStumpInstance,
  updateHarvestStumpInstance,
} from '../src/props/RoadStumps.ts';
import { ForestVisualSync } from '../src/resources/ForestVisualSync.ts';
import type { TreeEntityState } from '../src/resources/types.ts';

const placements: ForestTreePlacement[] = [
  { x: 20, z: 24, scale: 1, species: 'beech', form: 'broad' },
  { x: 40, z: 24, scale: 1.4, species: 'beech', form: 'broad' },
  { x: 60, z: 24, scale: 0.8, species: 'silverFir', form: 'narrow' },
];
const root = new THREE.Group();
const terrainMaterial = new THREE.MeshBasicMaterial();
const forest = createStubForestInstances(placements);
const manager = new ForestManager(
  root, forest, { group: new THREE.Group(), instances: [] }, null, [],
  { mesh: { material: terrainMaterial }, getHeightAt: (x: number) => x * 0.02 } as never,
  () => { forest.trunkMesh.geometry.dispose(); (forest.trunkMesh.material as THREE.Material).dispose(); },
);
const sync = new ForestVisualSync(manager);
const trees = new Map(placements.map((_, layoutIndex) => [
  `tree-${layoutIndex}`,
  { treeId: `tree-${layoutIndex}`, layoutIndex, phase: 'stump', growthProgress: 0 } as TreeEntityState,
]));
const stumpGroup = root.getObjectByName('Harvest stumps')!;
const stumpMeshes = stumpGroup.children as THREE.InstancedMesh[];
function renderedPositions(meshes: THREE.InstancedMesh[]): number[][] {
  const positions: number[][] = [];
  const matrix = new THREE.Matrix4();
  for (const mesh of meshes) {
    if (!mesh.visible) continue;
    for (let index = 0; index < mesh.count; index++) {
      mesh.getMatrixAt(index, matrix);
      assert.ok(matrix.determinant() > 0, 'draw prefixes must not contain hidden zero-scale slots');
      positions.push([matrix.elements[12], matrix.elements[14]]);
    }
  }
  return positions.sort((a, b) => a[0] - b[0]);
}

sync.syncAll(trees);
assert.deepEqual(renderedPositions(stumpMeshes), [[20, 24], [40, 24], [60, 24]]);
const camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.1, 1000);
for (const distance of [24, 88, 240, 346.14, 400, 346.14, 240, 88]) {
  manager.updateCameraState(camera, distance, false, { minX: -100, maxX: 100, minZ: -100, maxZ: 100 });
  assert.equal(stumpGroup.visible, distance < 400, 'camera updates must route the live-world stump envelope');
  assert.equal(renderedPositions(stumpMeshes).length, 3, 'camera culling must never discard stump instances');
}
for (const progress of [0.02, 0.35, 0.999]) {
  for (const tree of trees.values()) {
    tree.phase = 'growing';
    tree.growthProgress = progress;
  }
  sync.syncTrees(trees, [...trees.keys()]);
  assert.deepEqual(
    renderedPositions(stumpMeshes), [[20, 24], [40, 24], [60, 24]],
    `harvest sites must retain stumps through ${progress * 100}% recovery`,
  );
}

// A full authoritative resync must reproduce the same recovering sites.
sync.syncAll(trees);
assert.equal(renderedPositions(stumpMeshes).length, 3);
manager.syncPlacementClearance({ buildings: [{ kind: 'lumber_mill', x: 20, z: 24 }] });
assert.deepEqual(renderedPositions(stumpMeshes), [[60, 24]], 'construction still clears stumps in its site footprint');
manager.syncPlacementClearance({ buildings: [] });
assert.equal(renderedPositions(stumpMeshes).length, 3, 'cleared-site restoration must preserve growth phase');
sync.removeTreeLayouts([1]);
assert.deepEqual(renderedPositions(stumpMeshes), [[20, 24], [60, 24]], 'deleted entities must not leave ghost stumps');
sync.syncTrees(trees, ['tree-1']);
assert.equal(renderedPositions(stumpMeshes).length, 3);
for (const tree of trees.values()) { tree.phase = 'mature'; tree.growthProgress = 1; }
sync.syncAll(trees);
assert.equal(renderedPositions(stumpMeshes).length, 0, 'mature trees replace their stumps');
manager.dispose();
terrainMaterial.dispose();

// Sparse mature forests must submit only actual stumps, including after swap-removal.
const instances = createHarvestStumpInstances(Array.from({ length: 512 }, (_, index) => ({
  species: index % 2 ? 'silverFir' : 'beech',
})));
assert.ok(instances.meshes.every((mesh) => mesh.count === 0 && !mesh.visible));
const active = new Set<number>();
function show(index: number) {
  updateHarvestStumpInstance(instances, index, index * 3, index % 7, index * 0.02, 1);
  active.add(index);
}
function hide(index: number) {
  hideHarvestStumpInstance(instances, index);
  active.delete(index);
}
function assertPacking() {
  commitHarvestStumpInstanceUpdates(instances);
  assert.equal(instances.meshes.reduce((sum, mesh) => sum + mesh.count, 0), active.size);
  assert.deepEqual(renderedPositions(instances.meshes), [...active]
    .sort((a, b) => a - b).map((index) => [index * 3, index % 7]));
  for (const index of active) {
    const slot = instances.slots[index];
    const matrix = new THREE.Matrix4();
    slot.mesh.getMatrixAt(slot.instanceIndex, matrix);
    assert.equal(matrix.elements[12], index * 3, 'reverse slot ownership must follow swapped matrices');
    assert.ok(Math.abs(matrix.elements[13] - index * 0.02) < 1e-5, 'stumps stay terrain-grounded');
  }
  assert.equal(instances.dirtyMeshes.size, 0);
}
show(0); show(2); show(4); show(1); show(3);
assertPacking();
hide(0); // moves layout 4 into the first species slot
hide(0); // repeated hide must be a no-op
show(4); // update the moved layout without adding an instance
assertPacking();
show(0); hide(2); hide(3); hide(1);
assertPacking();
for (const seed of [1, 17, 913]) {
  let random = seed;
  for (let step = 0; step < 300; step++) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const index = random % 512;
    if ((random >>> 16) % 3 === 0) hide(index); else show(index);
    assertPacking();
  }
}
for (const index of [...active]) hide(index);
assertPacking();
assert.ok(instances.meshes.every((mesh) => !mesh.visible));
disposeHarvestStumpInstances(instances);
console.log('harvest stump lifecycle, authoritative sync, site clearance, and sparse packing tests passed');
