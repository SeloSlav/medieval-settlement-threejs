import assert from 'node:assert/strict';
import * as THREE from 'three';
import { InstanceDrawCompaction } from '../src/scene/InstanceDrawCompaction.ts';
import { selectSeedThreeTreeLod as select, SEEDTHREE_FOREST_LOD_DISTANCES } from '../src/vegetation/seedthree/seedThreeForestLod.ts';

assert.deepEqual(SEEDTHREE_FOREST_LOD_DISTANCES, [0, 48, 96]);
for (const [distance, expected] of [[0, 0], [48, 0], [48.01, 1], [96, 1], [96.01, 2]] as const) {
  assert.equal(select(distance, -1), expected, `initial LOD at ${distance}`);
}
assert.equal(select(52.8, 0), 0);
assert.equal(select(52.81, 0), 1);
assert.equal(select(43.2, 1), 1);
assert.equal(select(43.19, 1), 0);
assert.equal(select(105.6, 1), 1);
assert.equal(select(105.61, 1), 2);
assert.equal(select(86.4, 2), 2);
assert.equal(select(86.39, 2), 1);
assert.equal(select(500, 0), 2, 'teleport must replace near with far immediately');
assert.equal(select(5, 2), 0, 'teleport back must replace far with near immediately');
for (let previous = -1; previous <= 2; previous++) {
  for (const distance of [0, 42, 48, 53, 86, 96, 106, 500, NaN, Infinity]) {
    assert.equal(select(distance, previous, true), 2, 'horizon uses one normal far LOD');
    assert.ok([0, 1, 2].includes(select(distance, previous)), 'exactly one LOD owns each tree');
  }
}
let state = 0;
for (const distance of [47, 49, 48, 51, 46]) { state = select(distance, state); assert.equal(state, 0); }
state = 2;
for (const distance of [95, 97, 94, 88, 101]) { state = select(distance, state); assert.equal(state, 2); }

// Seasonal/streaming owners can change the rung without changing the camera.
// Its revision must invalidate the branch compactor's stationary-view cache.
const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 2);
mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(1, 0, 0));
mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(7, 0, 0));
let visibleGroup = 0, revision = 0;
const compaction = new InstanceDrawCompaction(mesh, 0, {
  groupVisible: group => group === visibleGroup, selectionVersion: () => revision,
});
compaction.prepare(null);
assert.equal(compaction.draw.count, 1);
assert.equal(compaction.draw.instanceMatrix.array[12], 1);
visibleGroup = 1; revision++;
compaction.prepare(null);
assert.equal(compaction.draw.count, 1);
assert.equal(compaction.draw.instanceMatrix.array[12], 7, 'stationary camera must publish the newly selected rung');
compaction.dispose(); mesh.dispose(); mesh.geometry.dispose(); mesh.material.dispose();
console.log('test:seedthree-forest-lod passed');
