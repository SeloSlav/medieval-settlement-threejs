import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  batchStaticFixtureMeshes,
  countFixtureStructuralSubmissions,
} from '../src/e2e/staticFixtureBatch.ts';

const root = new THREE.Group();
const visibleMaterial = new THREE.MeshBasicMaterial({ color: 0x6d5138 });
visibleMaterial.name = 'Visible timber';
const dormantMaterial = new THREE.MeshBasicMaterial({ color: 0xa84f32 });
dormantMaterial.name = 'Dormant fired roof tiles';

const visibleMesh = new THREE.Mesh(
  new THREE.BoxGeometry(2, 1, 1),
  visibleMaterial,
);
visibleMesh.name = 'Visible authored holding';
root.add(visibleMesh);

const dormantWorks = new THREE.Group();
dormantWorks.name = 'Dormant upgrade works';
dormantWorks.visible = false;
root.add(dormantWorks);
const dormantMesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  dormantMaterial,
);
dormantMesh.name = 'Delivered fired roof tiles';
dormantWorks.add(dormantMesh);

const result = batchStaticFixtureMeshes(root, 'Visible fixture fabric');
assert.equal(
  result.stats.sourceMeshes,
  1,
  'a hidden ancestor must exclude all descendant meshes from the permanent batch',
);
assert.equal(result.stats.batches, 1);
assert.equal(result.group.children[0]?.material, visibleMaterial);
assert.equal(
  dormantMesh.parent,
  dormantWorks,
  'dormant authored geometry must remain available beneath its hidden metadata group',
);
assert.deepEqual(
  countFixtureStructuralSubmissions(root),
  {
    draws: 1,
    triangles: 12,
  },
  'only effectively visible authored geometry may become a submitted batch',
);

visibleMaterial.dispose();
dormantMaterial.dispose();
result.group.traverse((object) => {
  if ((object as THREE.Mesh).isMesh) {
    (object as THREE.Mesh).geometry.dispose();
  }
});
dormantMesh.geometry.dispose();

console.log('Static fixture visibility-aware batching tests passed.');
