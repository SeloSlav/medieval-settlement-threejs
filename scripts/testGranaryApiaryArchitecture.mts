import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  APIARY_ARCHITECTURE_PLAN,
  GRANARY_ARCHITECTURE_PLAN,
  createApiaryMesh,
  createGranaryMesh,
} from '../src/buildings/meshes/expandedBuildingMeshes.ts';
import { PROCEDURAL_BUILDING_CATALOG } from '../src/buildings/proceduralArchitecture/catalog.ts';

function objectsNamed(root: THREE.Object3D, name: string): THREE.Object3D[] {
  const matches: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object.name === name) matches.push(object);
  });
  return matches;
}

function objectsWithRole(root: THREE.Object3D, role: string): THREE.Object3D[] {
  const matches: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object.userData.architectureRole === role) matches.push(object);
  });
  return matches;
}

function triangleCount(root: THREE.Object3D): number {
  let triangles = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const index = object.geometry.getIndex();
    const position = object.geometry.getAttribute('position');
    triangles += index ? index.count / 3 : (position?.count ?? 0) / 3;
  });
  return triangles;
}

function segmentAnchors(
  root: THREE.Object3D,
  containerName: string,
): Array<readonly [number, number, number]> {
  const container = root.getObjectByName(containerName);
  assert.ok(container instanceof THREE.Group, `${containerName} must remain a group anchor.`);
  return container.children.map((segment) => [
    segment.position.x,
    segment.position.y,
    segment.position.z,
  ] as const);
}

function hasAncestorNamed(object: THREE.Object3D, name: string): boolean {
  let cursor: THREE.Object3D | null = object.parent;
  while (cursor) {
    if (cursor.name === name) return true;
    cursor = cursor.parent;
  }
  return false;
}

const granary = createGranaryMesh();
granary.updateMatrixWorld(true);
assert.equal(granary.name, 'Granary');
assert.equal(granary.userData.architecturePlan, GRANARY_ARCHITECTURE_PLAN);
assert.equal(GRANARY_ARCHITECTURE_PLAN.semanticId, 'granary-raised-staddle-store-v1');
assert.equal(granary.getObjectByName('GranaryGroundedStore'), undefined);
assert.equal(granary.getObjectByName('Granary roof grain silo'), undefined);

const raisedStore = granary.getObjectByName('GranaryRaisedStore');
assert.ok(raisedStore instanceof THREE.Group, 'granary must expose its raised store root');
assert.equal(raisedStore.userData.architectureRole, 'raised-staddle-grain-store');
const staddles = objectsWithRole(raisedStore, 'discrete-staddle-support');
assert.equal(staddles.length, 8, 'granary must stand on the planned eight discrete staddles');
for (const staddle of staddles) {
  const bounds = new THREE.Box3().setFromObject(staddle);
  assert.ok(Math.abs(bounds.min.y) < 1e-5, `${staddle.name} must meet terrain`);
  assert.ok(bounds.max.y <= 1.01, `${staddle.name} must remain below the raised floor`);
  const size = bounds.getSize(new THREE.Vector3());
  // Box3 conservatively rotates each low-poly cylinder's local AABB; the
  // authored support radius is 0.5 m even when that transformed AABB reaches
  // sqrt(2) metres corner-to-corner.
  assert.ok(size.x < 1.5 && size.z < 1.5, `${staddle.name} must remain a discrete support`);
}

raisedStore.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return;
  const bounds = new THREE.Box3().setFromObject(object);
  const size = bounds.getSize(new THREE.Vector3());
  const broadGroundSlab = bounds.min.y <= 1e-5
    && bounds.max.y <= 0.5
    && size.x >= GRANARY_ARCHITECTURE_PLAN.store.width * 0.8
    && size.z >= GRANARY_ARCHITECTURE_PLAN.store.depth * 0.8;
  assert.equal(broadGroundSlab, false, 'granary must not regress to a continuous ground foundation');
});

const granaryFloor = raisedStore.getObjectByName('Granary raised timber floor deck');
assert.ok(granaryFloor instanceof THREE.Mesh);
assert.ok(
  new THREE.Box3().setFromObject(granaryFloor).min.y >= GRANARY_ARCHITECTURE_PLAN.store.floorBaseY - 1e-4,
  'granary floor must remain visibly raised above its staddles',
);
for (const name of [
  'Granary joined negative-X roof plane',
  'Granary joined positive-X roof plane',
] as const) {
  const roof = raisedStore.getObjectByName(name);
  assert.ok(roof instanceof THREE.Mesh, `${name} must exist`);
  assert.equal(roof.userData.proceduralRoofShell, true);
  assert.equal(roof.userData.architectureRole, 'split-shingle-roof');
  assert.equal(roof.geometry.userData.proceduralGeometryWriter, 'semantic-physical-uv-v1');
}
assert.equal(objectsNamed(raisedStore, 'Granary gable ventilation louver').length, 6);
assert.equal(objectsWithRole(raisedStore, 'vented-gable').length, 2);
assert.equal(objectsWithRole(raisedStore, 'loading-platform').length, 1);
assert.equal(objectsNamed(raisedStore, 'Granary loading stair tread 1').length, 1);
assert.equal(objectsNamed(raisedStore, 'Granary loading stair tread 4').length, 1);
const granaryBearers = objectsNamed(raisedStore, 'Granary staddle-supported floor bearer');
assert.equal(granaryBearers.length, GRANARY_ARCHITECTURE_PLAN.supportZ.length);
assert.deepEqual(
  granaryBearers.map((bearer) => bearer.position.z),
  [...GRANARY_ARCHITECTURE_PLAN.supportZ],
  'granary floor bearers must sit directly over each staddle row',
);
assert.ok(
  objectsNamed(raisedStore, 'Building facade opening').length >= 1
    || objectsWithRole(raisedStore, 'facade-opening').length >= 1
    || (() => {
      let doors = 0;
      raisedStore.traverse((object) => {
        if (object.userData.facadeOpeningKind === 'door') doors += 1;
      });
      return doors >= 1;
    })(),
  'granary must retain a procedural loading door',
);

assert.deepEqual(
  segmentAnchors(granary, 'GranaryGrainStockpile'),
  GRANARY_ARCHITECTURE_PLAN.grainStockAnchors.map(([x, y, z]) => [x, y, z]),
);
assert.deepEqual(
  segmentAnchors(granary, 'GranaryProvisionStockpile'),
  GRANARY_ARCHITECTURE_PLAN.provisionStockAnchors.map(([x, y, z]) => [x, y, z]),
);
const granaryTriangles = triangleCount(granary);
assert.ok(
  granaryTriangles <= PROCEDURAL_BUILDING_CATALOG.granary.triangleCeiling,
  `granary exceeds triangle ceiling (${granaryTriangles})`,
);

const apiary = createApiaryMesh();
apiary.updateMatrixWorld(true);
assert.equal(apiary.name, 'Apiary');
assert.equal(apiary.userData.architecturePlan, APIARY_ARCHITECTURE_PLAN);
assert.equal(APIARY_ARCHITECTURE_PLAN.semanticId, 'apiary-open-covered-skep-stand-v1');
assert.equal(apiary.getObjectByName('Gable shell joined left roof plane'), undefined);
assert.equal(apiary.getObjectByName('Gable shell joined right roof plane'), undefined);

const leanToRoof = apiary.getObjectByName('Apiary joined split-shingle lean-to roof');
assert.ok(leanToRoof instanceof THREE.Mesh, 'apiary must have one joined lean-to roof');
assert.equal(leanToRoof.userData.leanToHighEdge, 'negativeZ');
assert.equal(leanToRoof.userData.proceduralRoofShell, true);
assert.equal(leanToRoof.userData.architectureRole, 'covered-skep-stand');
assert.equal(leanToRoof.geometry.userData.proceduralGeometryWriter, 'semantic-physical-uv-v1');
assert.equal(objectsNamed(apiary, 'Apiary roof-bearing post').length, 4);
assert.equal(objectsNamed(apiary, 'Apiary discrete fieldstone post footing').length, 4);
assert.equal(objectsWithRole(apiary, 'woven-skep').filter((object) => object instanceof THREE.Group).length, 6);
assert.equal(objectsNamed(apiary, 'Apiary woven skep body').length, 6);
assert.equal(objectsNamed(apiary, 'Apiary raised skep bench').length, 2);
assert.equal(objectsWithRole(apiary, 'processing-table').length, 1);
assert.equal(objectsNamed(apiary, 'Apiary processing table leg').length, 4);
assert.equal(objectsWithRole(apiary, 'tool-chest').length, 1);

apiary.traverse((object) => {
  if (!(object instanceof THREE.Mesh) || hasAncestorNamed(object, 'ApiaryHoneyStockpile')) return;
  const material = Array.isArray(object.material) ? object.material[0] : object.material;
  assert.notEqual(material.userData.buildingDetailMaterialKey, 'paintBlue');
  assert.notEqual(material.userData.buildingDetailMaterialKey, 'paintRed');
  assert.notEqual(material.userData.buildingMaterialKey, 'plasterYellow');
  if (object.name === 'Apiary woven skep body' || object.name === 'Apiary skep woven binding course') {
    assert.equal(material.userData.buildingDetailMaterialKey, 'wicker');
  }
  if (object.name.startsWith('Apiary brown timber tool chest')) {
    assert.ok(
      material.userData.buildingMaterialKey === 'timberWeathered'
        || material.userData.buildingMaterialKey === 'timberMid',
      'apiary tool chest must use the shared brown timber roles',
    );
  }
});

let apiaryFacadeOpenings = 0;
apiary.traverse((object) => {
  if (object.userData.facadeOpeningKind === 'door' || object.userData.facadeOpeningKind === 'window') {
    apiaryFacadeOpenings += 1;
  }
});
assert.equal(apiaryFacadeOpenings, 0, 'open apiary must not retain the old cottage door/window facade');
assert.deepEqual(
  segmentAnchors(apiary, 'ApiaryHoneyStockpile'),
  APIARY_ARCHITECTURE_PLAN.honeyStockAnchors
    .slice(0, 3)
    .map(([x, y, z]) => [x, y, z]),
);
const apiaryTriangles = triangleCount(apiary);
assert.ok(
  apiaryTriangles <= PROCEDURAL_BUILDING_CATALOG.apiary.triangleCeiling,
  `apiary exceeds triangle ceiling (${apiaryTriangles})`,
);

console.log(
  `granary/apiary architecture tests passed (${granaryTriangles} + ${apiaryTriangles} triangles)`,
);
