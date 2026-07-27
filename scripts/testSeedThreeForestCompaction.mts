import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  writeSeedThreeLodMatrices,
  type SeedThreeTreeSlot,
} from '../src/vegetation/seedthree/seedThreeForestCompaction.ts';

function makeLodSet(capacity: number) {
  const branchGeometry = new THREE.BoxGeometry(1, 1, 1);
  branchGeometry.setAttribute(
    'aWindVec',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
  );
  branchGeometry.setAttribute(
    'aAnchorPos',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
  );
  const branches = new THREE.InstancedMesh(
    branchGeometry,
    new THREE.MeshBasicMaterial(),
    capacity,
  );

  const cardGeometry = new THREE.PlaneGeometry(1, 1);
  cardGeometry.setAttribute(
    'aThickness',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
  );
  cardGeometry.setAttribute(
    'aTreeOrigin',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
  );
  cardGeometry.setAttribute(
    'aWindVec',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
  );
  cardGeometry.setAttribute(
    'aAnchorPos',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
  );
  const cards = new THREE.InstancedMesh(
    cardGeometry,
    new THREE.MeshBasicMaterial(),
    capacity,
  ) as THREE.InstancedMesh & { userData: Record<string, unknown> };
  cards.userData.k = 1;
  cards.userData.srcMatrices = new Float32Array(new THREE.Matrix4().elements);
  cards.userData.weights = new Float32Array([0.7]);
  return { branches, cards: [cards] };
}

const nearSet = makeLodSet(2);
const overviewSet = makeLodSet(2);
const slot = (layoutIndex: number, x: number): SeedThreeTreeSlot => ({
  layoutIndex,
  matrix: new THREE.Matrix4().makeTranslation(x, 0, 0),
  pos: new THREE.Vector3(x, 0, 0),
  visibilityCenter: new THREE.Vector3(x, 4, 0),
  visibilityRadius: 5,
  enabled: true,
});
const slots = [slot(0, 10), slot(1, 20)];

writeSeedThreeLodMatrices(nearSet, slots, [0]);
writeSeedThreeLodMatrices(overviewSet, slots, [1]);
assert.equal(nearSet.branches.count, 1, 'near bucket should submit one tree');
assert.equal(nearSet.cards[0].count, 1, 'near card bucket should submit one tree');
assert.equal(overviewSet.branches.count, 1, 'overview bucket should submit one tree');
assert.equal(overviewSet.cards[0].count, 1, 'overview card bucket should submit one tree');
const activeDraws = (): number => [
  nearSet.branches,
  ...nearSet.cards,
  overviewSet.branches,
  ...overviewSet.cards,
].filter((mesh) => mesh.count > 0).length;
assert.equal(activeDraws(), 4,
  'disjoint near and overview bands should each issue one branch/card pair');

const matrix = new THREE.Matrix4();
nearSet.branches.getMatrixAt(0, matrix);
assert.equal(matrix.elements[12], 10, 'near compaction should preserve source transform');
overviewSet.cards[0].getMatrixAt(0, matrix);
assert.equal(matrix.elements[12], 20, 'overview compaction should preserve source transform');

slots[0]!.enabled = false;
writeSeedThreeLodMatrices(nearSet, slots, [0]);
writeSeedThreeLodMatrices(overviewSet, slots, [1]);
assert.equal(nearSet.branches.count, 0, 'harvested near tree must stay hidden after compaction');
assert.equal(nearSet.cards[0].count, 0, 'harvested near foliage must stay hidden after compaction');
assert.equal(overviewSet.branches.count, 1, 'hiding a near tree must not disturb overview trees');
assert.equal(activeDraws(), 2,
  'zero-count harvested meshes must not contribute structural draws');

slots[0]!.enabled = true;
writeSeedThreeLodMatrices(nearSet, slots, [0]);
assert.equal(nearSet.branches.count, 1, 'restored tree should return to its selected LOD band');
nearSet.branches.getMatrixAt(0, matrix);
assert.equal(matrix.elements[12], 10, 'restored tree should recover its exact source transform');

for (const set of [nearSet, overviewSet]) {
  set.branches.geometry.dispose();
  (set.branches.material as THREE.Material).dispose();
  for (const cards of set.cards) {
    cards.geometry.dispose();
    (cards.material as THREE.Material).dispose();
  }
}

console.log('test:seedthree-forest-compaction passed');
