import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHuntersHallMesh } from '../src/buildings/meshes/serviceBuildingMeshes.ts';

const camp = createHuntersHallMesh();
camp.updateMatrixWorld(true);

assert.equal(camp.userData.noBakedHangingTools, true);
assert.equal(
  camp.children.some((child) => /bow|snare|axe|carcass|hanging tool/i.test(child.name)),
  false,
  'removed hunter props returned as baked decoration',
);

const fabrics: THREE.Mesh[] = [];
const physicalPanels: THREE.Mesh[] = [];
const stones: THREE.Mesh[] = [];
const fireLogs: THREE.Mesh[] = [];
let triangles = 0;
camp.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return;
  const index = object.geometry.getIndex();
  triangles += index ? index.count / 3 : object.geometry.getAttribute('position').count / 3;
  if (object.userData.proceduralFabric === true) fabrics.push(object);
  if (object.geometry.userData.proceduralPhysicalUv) physicalPanels.push(object);
  if (object.name === 'Hunter hearth ring stone') stones.push(object);
  if (object.name === 'Hunter hearth fire log') fireLogs.push(object);
});

assert.equal(fabrics.length, 4, 'camp must retain two tent slopes, a closed rear, and the work fly');
assert.equal(physicalPanels.length, 3, 'all sagging fabric panels must preserve fabric-aligned metric UVs');
for (const panel of physicalPanels) {
  const material = panel.material as THREE.Material;
  assert.equal(material.userData.buildingMaterialAtlasTile, 'linen-canvas');
  assert.equal(panel.geometry.userData.metricUvMeters, 1.2);
  const metadata = panel.geometry.userData.proceduralPhysicalUv as {
    physicalUSpan: number;
    physicalVSpan: number;
  };
  const uv = panel.geometry.getAttribute('uv');
  const bounds = uvBounds(uv);
  assert.ok(
    Math.abs((bounds.maxU - bounds.minU) * 1.2 - metadata.physicalUSpan) < 1e-4,
    `${panel.name} stretches canvas across its U axis`,
  );
  assert.ok(
    Math.abs((bounds.maxV - bounds.minV) * 1.2 - metadata.physicalVSpan) < 1e-4,
    `${panel.name} stretches canvas across its V axis`,
  );
}

assert.equal(stones.length, 11, 'hearth stone ring changed unexpectedly');
assert.equal(fireLogs.length, 3, 'hearth must retain a compact three-log fuel pile');
for (const log of fireLogs) {
  const world = new THREE.Vector3();
  log.getWorldPosition(world);
  assert.ok(world.y >= 0.3, 'hearth log sits on the ground instead of above the ring bed');
  assert.ok(Math.hypot(world.x + 0.05, world.z - 2.05) < 0.08, 'hearth log escaped the stone ring');
}

assert.ok(triangles <= 6_500, `hunter camp exceeds its 6,500 triangle ceiling (${triangles})`);
console.log(`hunter camp architecture passed (${fabrics.length} canvas pieces, ${triangles} triangles)`);

function uvBounds(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
} {
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < attribute.count; index += 1) {
    minU = Math.min(minU, attribute.getX(index));
    maxU = Math.max(maxU, attribute.getX(index));
    minV = Math.min(minV, attribute.getY(index));
    maxV = Math.max(maxV, attribute.getY(index));
  }
  return { minU, maxU, minV, maxV };
}
