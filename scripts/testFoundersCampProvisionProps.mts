import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { createFoundersCampMesh } from '../src/buildings/meshes/foundersCampMesh.ts';

function instanceBounds(mesh: THREE.InstancedMesh, index: number): THREE.Box3 {
  mesh.geometry.computeBoundingBox();
  assert.ok(mesh.geometry.boundingBox);
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return mesh.geometry.boundingBox.clone().applyMatrix4(matrix);
}

function horizontalOverlap(a: THREE.Box3, b: THREE.Box3): number {
  const overlapX = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
  const overlapZ = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
  return Math.min(overlapX, overlapZ);
}

const camp = createFoundersCampMesh();
const basket = camp.getObjectByName('Woven provision basket');
const basketRim = camp.getObjectByName('Woven basket rim');
const basketBase = camp.getObjectByName('Woven basket base');
const bread = camp.getObjectByName('Basket bread loaves');
assert.ok(basket instanceof THREE.Mesh);
assert.ok(basketRim instanceof THREE.Mesh);
assert.ok(basketBase instanceof THREE.Mesh);
assert.ok(bread instanceof THREE.InstancedMesh);
assert.equal(bread.count, 1);
assert.equal(bread.userData.provisionContents, 'bread');
assert.equal(bread.userData.containerName, basket.name);
assert.equal(bread.userData.support, basketBase.name);
assert.equal((bread.material as THREE.MeshStandardMaterial).userData.buildingDetailMaterialKey, 'bread');
assert.equal((bread.material as THREE.MeshStandardMaterial).color.getHex(), 0xd9c7a2);
assert.equal(camp.getObjectByName('Slumped canvas provision sacks'), undefined);

const breadBounds: THREE.Box3[] = [];
for (let index = 0; index < bread.count; index += 1) {
  const matrix = new THREE.Matrix4();
  bread.getMatrixAt(index, matrix);
  const center = new THREE.Vector3().setFromMatrixPosition(matrix);
  const bounds = instanceBounds(bread, index);
  breadBounds.push(bounds);
  assert.ok(
    Math.hypot(center.x - basket.position.x, center.z - basket.position.z) < 0.01,
    `bread loaf ${index + 1} must sit inside the basket footprint`,
  );
  const size = bounds.getSize(new THREE.Vector3());
  assert.ok(size.x > 0.48 && size.x < 0.58 && size.z < 0.32 && size.x / size.z > 1.65,
    `bread loaf ${index + 1} must have one clearly oblong silhouette`);
  assert.ok(bounds.min.y > 0.055 && bounds.max.y < 0.56,
    `bread loaf ${index + 1} must stay inside the basket volume`);
}

const basketBaseBounds = new THREE.Box3().setFromObject(basketBase);
for (const bounds of breadBounds) {
  assert.ok(Math.abs(bounds.min.y - basketBaseBounds.max.y) < 0.01,
    'the loaf must rest on the basket base');
}
assert.ok(breadBounds[0].max.y > basketRim.position.y - 0.08,
  'the loaf crown must rise close enough to the rim for the basket to read as full');
assert.ok(bread.geometry.index && bread.geometry.index.count / 3 <= 64,
  'the single loaf must stay within its 64-triangle allocation');

const crates = camp.getObjectByName('Asymmetric founding supply crates');
const braces = camp.getObjectByName('Dark crate braces');
assert.ok(crates instanceof THREE.InstancedMesh);
assert.ok(braces instanceof THREE.InstancedMesh);
assert.equal(crates.count, 3);
assert.equal(braces.count, crates.count);
const [leftBase, rightBase, top] = [0, 1, 2].map((index) => instanceBounds(crates, index)) as [
  THREE.Box3,
  THREE.Box3,
  THREE.Box3,
];
assert.equal(leftBase.intersectsBox(rightBase), false,
  'the two ground crates must not intersect');
assert.ok(Math.abs(leftBase.max.y - rightBase.max.y) < 1e-5,
  'the two ground crates must share one load-bearing top plane');
assert.ok(Math.abs(top.min.y - leftBase.max.y) < 1e-5,
  'the upper crate must rest exactly on the base-crate top plane');
assert.ok(horizontalOverlap(top, leftBase) > 0.2 && horizontalOverlap(top, rightBase) > 0.2,
  'the upper crate must bridge both base crates with stable overlap');

const compiledCamp = createBuildingMesh('founders_camp');
const metrics = compiledCamp.userData.proceduralArchitectureMetrics as {
  visibleTriangles: number;
  withinVisibleTriangleCeiling: boolean;
};
assert.ok(metrics.withinVisibleTriangleCeiling);
assert.ok(metrics.visibleTriangles <= 18_000);

console.log(
  `founders camp provision props passed (1 supported 60-triangle oblong loaf; `
  + `2+1 contact-stacked crates; ${metrics.visibleTriangles}/18000 visible triangles)`,
);
