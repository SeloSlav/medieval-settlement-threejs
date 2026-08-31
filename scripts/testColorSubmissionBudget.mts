import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  measureColorSubmissionBudget,
} from '../src/scene/colorSubmissionBudget.ts';
import { TREE_SHADOW_CAST_LAYER } from '../src/scene/SceneLayers.ts';

function twoTriangleGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, 0, 0,
    0.5, 0, 0,
    0.5, 1, 0,
    -0.5, 1, 0,
  ], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
camera.position.set(0, 2, 8);
camera.lookAt(0, 0, 0);
camera.updateProjectionMatrix();
camera.updateMatrixWorld(true);

const terrainGeometry = twoTriangleGeometry();
const terrain = new THREE.Mesh(terrainGeometry, new THREE.MeshBasicMaterial());
terrain.name = 'fixture terrain';
terrain.userData.terrain = true;
scene.add(terrain);

const crowd = new THREE.Group();
crowd.name = 'man exact authored crowd';
scene.add(crowd);
const bodyGeometry = twoTriangleGeometry();
bodyGeometry.clearGroups();
bodyGeometry.addGroup(0, 3, 0);
bodyGeometry.addGroup(3, 3, 1);
const body = new THREE.InstancedMesh(
  bodyGeometry,
  [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()],
  3,
);
body.count = 3;
body.frustumCulled = false;
body.userData.authoredSkinnedInstances = true;
crowd.add(body);

const equipmentGroup = new THREE.Group();
equipmentGroup.userData.exactMountedAttachmentBatch = true;
scene.add(equipmentGroup);
const equipment = new THREE.InstancedMesh(
  twoTriangleGeometry(),
  new THREE.MeshBasicMaterial(),
  4,
);
equipment.count = 4;
equipmentGroup.add(equipment);

const standards = new THREE.Group();
standards.name = 'Company standards · batched cloth and hardware';
scene.add(standards);
const standard = new THREE.Mesh(twoTriangleGeometry(), new THREE.MeshBasicMaterial());
standards.add(standard);

const forest = new THREE.Group();
forest.name = 'SeedThree Gorski Kotar forest';
scene.add(forest);
const visibleTrees = new THREE.InstancedMesh(
  twoTriangleGeometry(),
  new THREE.MeshBasicMaterial(),
  5,
);
visibleTrees.count = 5;
visibleTrees.frustumCulled = false;
forest.add(visibleTrees);
const hiddenTrees = new THREE.InstancedMesh(
  twoTriangleGeometry(),
  new THREE.MeshBasicMaterial(),
  100,
);
hiddenTrees.count = 100;
hiddenTrees.visible = false;
forest.add(hiddenTrees);

const grass = new THREE.Group();
grass.name = 'SeedThree grass field';
grass.userData.groundcoverSubmission = 'fixture';
scene.add(grass);
const grassTufts = new THREE.InstancedMesh(
  twoTriangleGeometry(),
  new THREE.MeshBasicMaterial(),
  7,
);
grassTufts.count = 7;
grassTufts.frustumCulled = false;
grass.add(grassTufts);

const animalGroup = new THREE.Group();
animalGroup.name = 'cow exact-model livestock instances';
scene.add(animalGroup);
const animals = new THREE.InstancedMesh(
  twoTriangleGeometry(),
  new THREE.MeshBasicMaterial(),
  2,
);
animals.count = 2;
animals.userData.authoredSkinnedInstances = true;
animalGroup.add(animals);

const offscreen = new THREE.Mesh(twoTriangleGeometry(), new THREE.MeshBasicMaterial());
offscreen.position.set(500, 0, 0);
scene.add(offscreen);

const shadowOnly = new THREE.InstancedMesh(
  twoTriangleGeometry(),
  new THREE.MeshBasicMaterial(),
  1_000,
);
shadowOnly.count = 1_000;
shadowOnly.layers.set(TREE_SHADOW_CAST_LAYER);
scene.add(shadowOnly);

scene.updateMatrixWorld(true);
const budget = measureColorSubmissionBudget(scene, camera);

assert.deepEqual(budget.categories.terrain, {
  drawCalls: 1,
  triangles: 2,
  instances: 1,
  objects: 1,
});
assert.deepEqual(budget.categories.authoredBodies, {
  drawCalls: 2,
  triangles: 6,
  instances: 3,
  objects: 1,
});
assert.equal(budget.categories.mountedEquipment.triangles, 8);
assert.equal(budget.categories.companyStandards.triangles, 2);
assert.equal(budget.categories.seedThreeForest.triangles, 10);
assert.equal(budget.categories.groundcover.triangles, 14);
assert.equal(budget.categories.authoredAnimals.triangles, 4);
assert.equal(budget.categories.other.triangles, 0, 'off-frustum and shadow-only work');
assert.equal(budget.total.triangles, 46);
assert.equal(budget.total.drawCalls, 8);
assert.equal(budget.total.objects, 7);

terrainGeometry.dispose();
bodyGeometry.dispose();
scene.traverse((object) => {
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh) return;
  if (mesh.geometry !== terrainGeometry && mesh.geometry !== bodyGeometry) mesh.geometry.dispose();
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) material.dispose();
});

console.log('Exact color submission budget classification passed (frustum, layers, groups, instances).');
