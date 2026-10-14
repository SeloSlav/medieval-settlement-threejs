import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWindmillMesh } from '../src/buildings/meshes/expandedBuildingMeshes.ts';
import { batchWindmillSails } from '../src/buildings/windmillSailBatch.ts';

const windmill = createWindmillMesh();
const sails = windmill.getObjectByName('Windmill sails');
assert.ok(sails instanceof THREE.Group);
const sources: THREE.Mesh[] = [];
sails.traverse(object => { if ((object as THREE.Mesh).isMesh) sources.push(object as THREE.Mesh); });
const beforeTriangles = sources.reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3, 0);
const draws = batchWindmillSails(sails);
const compiled = sails.getObjectByName('Windmill batched rotating sails');
assert.ok(compiled instanceof THREE.Group);
assert.ok(draws > 0 && draws < sources.length, 'Sail assembly should use fewer material draws');
assert.equal(batchWindmillSails(sails), draws, 'Repeated registration must not rebuild dynamic geometry');
assert.ok(sources.every(mesh => !mesh.visible), 'Source leaves must not submit beside compiled sails');
const afterTriangles = compiled.children.reduce((sum, child) => {
  const mesh = child as THREE.Mesh;
  return sum + (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3;
}, 0);
assert.equal(afterTriangles, beforeTriangles, 'Compiled sails retain every authored triangle');
console.log(`Windmill sail draw batching passed: ${sources.length} authored leaves -> ${draws} dynamic draws, ${beforeTriangles} triangles.`);
