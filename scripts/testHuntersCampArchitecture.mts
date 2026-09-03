import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as THREE from 'three';
import { createHuntersHallMesh } from '../src/buildings/meshes/serviceBuildingMeshes.ts';
import { addCampAFrameShelter } from '../src/buildings/meshes/foundersCampMesh.ts';
import { sharedBuildingDetailMaterial } from '../src/buildings/buildingMaterials.ts';
import { CAMP_HIDE_METERS_PER_REPEAT, CAMP_HIDE_TEXTURE_ROOT } from '../src/buildings/campHideSurface.ts';
import { getBuildingFootprintHalfExtents } from '../src/buildings/BuildingFootprint.ts';

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

const tent = camp.getObjectByName('Founding canvas tent');
assert.ok(tent instanceof THREE.Group, 'hunter camp must use the actual founder tent');
assert.deepEqual(tent.scale.toArray(), [1, 1, 1], 'the shared tent must retain its authored proportions');
assert.equal(tent.rotation.y, Math.PI, 'founder tent entrance must face the hunter camp front (+Z)');
const referenceTent = addCampAFrameShelter(new THREE.Group(), 0, 0, 0, 0);
assert.deepEqual(tent.children.map((part) => part.name), referenceTent.children.map((part) => part.name));
for (let index = 0; index < referenceTent.children.length; index += 1) {
  const actual = tent.children[index] as THREE.Mesh;
  const expected = referenceTent.children[index] as THREE.Mesh;
  assert.equal(actual.material, expected.material, `${actual.name} must share the founder material`);
  assert.deepEqual(actual.geometry.getAttribute('position').array, expected.geometry.getAttribute('position').array);
  assert.deepEqual(actual.geometry.getAttribute('uv').array, expected.geometry.getAttribute('uv').array);
  assert.deepEqual(actual.position.toArray(), expected.position.toArray());
  assert.deepEqual(actual.quaternion.toArray(), expected.quaternion.toArray());
}

assert.equal(fabrics.length, 1, 'the only separate fabric panel is the hide work fly');
assert.equal(physicalPanels.length, 1, 'the hide fly must preserve fabric-aligned metric UVs');
for (const panel of physicalPanels) {
  const material = panel.material as THREE.MeshStandardMaterial;
  assert.equal(material, sharedBuildingDetailMaterial('hide'));
  assert.notEqual(material, sharedBuildingDetailMaterial('canvas'));
  assert.equal(material.userData.campSurface, 'stitched-brown-hide');
  assert.equal(material.userData.buildingMaterialAtlas, undefined, 'hide must not sample linen atlas UVs');
  assert.equal(material.side, THREE.DoubleSide);
  assert.equal(material.metalness, 0);
  assert.equal(material.map?.colorSpace, THREE.SRGBColorSpace);
  assert.equal(material.normalMap?.colorSpace, THREE.NoColorSpace);
  for (const map of [material.map, material.normalMap]) {
    assert.equal(map?.wrapS, THREE.RepeatWrapping);
    assert.equal(map?.wrapT, THREE.RepeatWrapping);
  }
  for (const channel of ['albedo', 'normal', 'material']) {
    assert.ok(existsSync(new URL(`../public${CAMP_HIDE_TEXTURE_ROOT}/stitched_hide_${channel}.png`, import.meta.url)));
  }
  assert.equal(panel.geometry.userData.metricUvMeters, CAMP_HIDE_METERS_PER_REPEAT);
  const metadata = panel.geometry.userData.proceduralPhysicalUv as {
    physicalUSpan: number;
    physicalVSpan: number;
  };
  const uv = panel.geometry.getAttribute('uv');
  const bounds = uvBounds(uv);
  assert.ok(
    Math.abs((bounds.maxU - bounds.minU) * CAMP_HIDE_METERS_PER_REPEAT - metadata.physicalUSpan) < 1e-4,
    `${panel.name} stretches hide across its U axis`,
  );
  assert.ok(
    Math.abs((bounds.maxV - bounds.minV) * CAMP_HIDE_METERS_PER_REPEAT - metadata.physicalVSpan) < 1e-4,
    `${panel.name} stretches hide across its V axis`,
  );
}

assert.equal(stones.length, 11, 'hearth stone ring changed unexpectedly');
assert.equal(fireLogs.length, 3, 'hearth must retain a compact three-log fuel pile');
for (const log of fireLogs) {
  const world = new THREE.Vector3();
  log.getWorldPosition(world);
  assert.ok(world.y >= 0.3, 'hearth log sits on the ground instead of above the ring bed');
  assert.ok(Math.hypot(world.x + 0.05, world.z - 3.35) < 0.08, 'hearth log escaped the stone ring');
}

const hearth = camp.getObjectByName('Hunter hearth')!;
const fire = camp.getObjectByName('HunterCampfire')!;
assert.equal(fire.parent, hearth, 'runtime fire anchor must travel with the full hearth');
const firePosition = fire.getWorldPosition(new THREE.Vector3());
assert.deepEqual(firePosition.toArray(), [-0.05, 0, 3.35]);
const hearthBounds = new THREE.Box3().setFromObject(hearth);
const flyBounds = new THREE.Box3().setFromObject(physicalPanels[0]!);
const tentBounds = new THREE.Box3().setFromObject(tent);
assert.ok(hearthBounds.min.z > flyBounds.max.z + 0.2, 'hearth tripod must clear the entire work canopy');
assert.ok(!hearthBounds.intersectsBox(tentBounds), 'hearth must clear the tent and all guy ropes');
assert.ok(hearthBounds.min.x > tent.position.x + 0.8, 'leave a clear approach to the tent entrance');
const { halfWidth, halfDepth } = getBuildingFootprintHalfExtents('hunters_hall');
const campBounds = new THREE.Box3().setFromObject(camp);
assert.ok(Math.max(-campBounds.min.x, campBounds.max.x) <= halfWidth + 0.05, 'camp exceeds its existing X placement footprint');
assert.ok(Math.max(-campBounds.min.z, campBounds.max.z) <= halfDepth, 'front hearth exceeds its existing Z placement footprint');
const secondCamp = createHuntersHallMesh();
assert.equal((secondCamp.getObjectByName(physicalPanels[0]!.name) as THREE.Mesh).material, physicalPanels[0]!.material);
assert.equal(camp.getObjectByName('HuntersFoodStockpile')?.visible, false, 'empty camp must not show harvested food');

assert.ok(triangles <= 6_500, `hunter camp exceeds its 6,500 triangle ceiling (${triangles})`);
console.log(`hunter camp architecture passed (shared founder tent, stitched hide fly, clear front hearth, ${triangles} triangles)`);

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
