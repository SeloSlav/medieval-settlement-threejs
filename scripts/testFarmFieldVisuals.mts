import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  FarmFieldMarkers,
  FarmFieldPreview,
} from '../src/farming/FarmFieldMarkers.ts';
import type { FarmFieldState } from '../src/resources/types.ts';

const field: FarmFieldState = {
  id: 'visual-test-field',
  farmsteadId: 'visual-test-farmstead',
  corners: [
    { x: 0, z: 0 },
    { x: 20, z: 0 },
    { x: 20, z: 20 },
    { x: 0, z: 20 },
  ],
  area: 400,
  averageSlopeDegrees: 2,
  moisture: 0.42,
  fertility: 0.9,
  crop: 'rye',
  nextCrop: 'fallow',
  stage: 'growing',
  stageProgress: 0.76,
  priority: 2,
  harvestCount: 0,
  lastYield: 0,
  currentYield: 0,
};

const visualRoot = new THREE.Group();
const fieldMarkers = new FarmFieldMarkers(visualRoot, () => 0);
fieldMarkers.syncFields([field]);
const standingCereal = visualRoot.getObjectByName('Standing cereal stalks');
const matureHeads = visualRoot.getObjectByName('Pale awned grain heads');
const matureSoil = visualRoot.getObjectByName('Worked field soil') as THREE.Mesh;
assert.ok(standingCereal instanceof THREE.InstancedMesh);
assert.ok(matureHeads instanceof THREE.InstancedMesh);
assert.ok(standingCereal.count >= field.area, 'a mature field should read as a dense crop stand');
assert.equal(matureHeads.count, standingCereal.count, 'every mature cereal tuft needs a readable grain head');
assert.ok(matureSoil.geometry.getAttribute('color'), 'worked earth should carry non-flat surface variation');

fieldMarkers.syncFields([{
  ...field,
  stage: 'harvesting',
  stageProgress: 0.56,
}]);
const harvestedStanding = visualRoot.getObjectByName('Standing cereal stalks');
const harvestedStubble = visualRoot.getObjectByName('Cut cereal stubble');
assert.ok(harvestedStanding instanceof THREE.InstancedMesh);
assert.ok(harvestedStubble instanceof THREE.InstancedMesh);
assert.ok(harvestedStanding.count < standingCereal.count, 'harvest progress should clear a visible part of the standing crop');
assert.ok(harvestedStubble.count > 0, 'harvested ground should retain cut stubble');
assert.ok(
  visualRoot.getObjectByName('Irregular soil clods') instanceof THREE.InstancedMesh,
  'exposed worked ground should not remain a featureless flat plane',
);

fieldMarkers.syncFields([{
  ...field,
  crop: 'fallow',
  stage: 'growing',
  stageProgress: 0.8,
}]);
assert.equal(visualRoot.getObjectByName('Pale awned grain heads'), undefined);
assert.ok(
  visualRoot.getObjectByName('Fallow grasses and volunteer plants') instanceof THREE.InstancedMesh,
  'fallow land should remain visibly different from a cereal crop',
);

for (const [crop, signature] of [
  ['oats', 'Oat drooping panicles'],
  ['barley', 'Barley long-awn heads'],
  ['flax', 'Flax blue blossoms'],
  ['wheat', 'Wheat–rye maslin heads'],
] as const) {
  fieldMarkers.syncFields([{
    ...field,
    crop,
    stage: 'growing',
    stageProgress: 0.9,
  }]);
  assert.ok(
    visualRoot.getObjectByName(signature) instanceof THREE.InstancedMesh,
    `${crop} should have a crop-specific modeled silhouette`,
  );
}
fieldMarkers.dispose();

const preview = new FarmFieldPreview(() => 0);
visualRoot.add(preview.group);
preview.show(null, false, 'rye', [
  { x: 0, z: 0 },
  { x: 20, z: 0 },
  { x: 18, z: 14 },
]);
const openBoundary = preview.group.getObjectByName('Farmland dotted border') as THREE.Mesh;
const previewFill = preview.group.getObjectByName('Farmland preview fill') as THREE.Mesh;
assert.ok(preview.group.visible);
assert.ok(openBoundary.geometry.getAttribute('position').count > 0);
assert.equal(previewFill.visible, false, 'an open three-corner boundary must not imply committed area');
preview.show([
  { x: 0, z: 0 },
  { x: 20, z: 0 },
  { x: 18, z: 14 },
  { x: 2, z: 12 },
], true, 'rye');
assert.equal(previewFill.visible, true);
assert.ok(previewFill.geometry.getAttribute('position').count > 0);
preview.dispose();

console.log('farm-field visual tests passed');
