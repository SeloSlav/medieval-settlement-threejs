import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createLumberMillMesh } from '../src/buildings/meshes/industryBuildingMeshes.ts';
import { createWindmillMesh } from '../src/buildings/meshes/expandedBuildingMeshes.ts';
import { PROCEDURAL_BUILDING_CATALOG } from '../src/buildings/proceduralArchitecture/catalog.ts';

function objectsNamed(root: THREE.Object3D, name: string): THREE.Object3D[] {
  const matches: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object.name === name) matches.push(object);
  });
  return matches;
}

function objectsWithData(root: THREE.Object3D, key: string, value: unknown): THREE.Object3D[] {
  const matches: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object.userData[key] === value) matches.push(object);
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

function deterministicSignature(root: THREE.Object3D): readonly string[] {
  root.updateMatrixWorld(true);
  const signature: string[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const bounds = new THREE.Box3().setFromObject(object);
    const index = object.geometry.getIndex();
    const position = object.geometry.getAttribute('position');
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    signature.push([
      object.name,
      position?.count ?? 0,
      index?.count ?? 0,
      material.userData.buildingMaterialKey ?? material.userData.buildingDetailMaterialKey ?? material.name,
      ...bounds.min.toArray().map((value) => value.toFixed(5)),
      ...bounds.max.toArray().map((value) => value.toFixed(5)),
    ].join('|'));
  });
  return signature;
}

function assertJoined(left: THREE.Object3D, right: THREE.Object3D, message: string): void {
  const leftBounds = new THREE.Box3().setFromObject(left).expandByScalar(0.015);
  const rightBounds = new THREE.Box3().setFromObject(right).expandByScalar(0.015);
  assert.ok(leftBounds.intersectsBox(rightBounds), message);
}

function assertLiteralAperture(
  opening: THREE.Object3D,
  wall: THREE.Mesh,
  message: string,
): void {
  const origin = opening.getWorldPosition(new THREE.Vector3());
  const outward = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(opening.getWorldQuaternion(new THREE.Quaternion()))
    .normalize();
  const ray = new THREE.Raycaster(
    origin.clone().addScaledVector(outward, 0.6),
    outward.clone().negate(),
    0,
    1.0,
  );
  assert.equal(ray.intersectObject(wall, false).length, 0, message);
}

function assertBrownTimberAndNoVegetation(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      const key = material.userData.buildingMaterialKey as string | undefined;
      assert.notEqual(key, 'timberLight', `${root.name} must not use pale timber on shared woodwork`);
      assert.notEqual(key, 'foliage', `${root.name} must not author vegetation`);
      assert.notEqual(key, 'crop', `${root.name} must not author crops`);
      assert.notEqual(key, 'grassRoof', `${root.name} must not author vegetation roof dressing`);
    }
  });
}

const lumberMill = createLumberMillMesh();
lumberMill.updateMatrixWorld(true);
assert.equal(lumberMill.name, 'Lumber mill');
const lumberFacade = lumberMill.getObjectByName('Lumber mill front perforated work wall');
assert.ok(lumberFacade instanceof THREE.Mesh);
assert.equal(lumberFacade.geometry.type, 'ExtrudeGeometry');
assert.equal(lumberFacade.userData.literalFacadeApertures, true);
assert.equal(lumberFacade.userData.proceduralFacadeOpeningCount, 4);
const serviceBay = lumberMill.getObjectByName('Lumber mill open saw service bay');
assert.ok(serviceBay instanceof THREE.Group);
assert.equal(serviceBay.userData.literalWallAperture, true);
assertLiteralAperture(serviceBay, lumberFacade, 'the saw service bay must be a hole through the work wall');
assert.equal(objectsNamed(lumberMill, 'Building dark structural opening frame').length, 0);
assert.equal(objectsNamed(lumberMill, 'Building dark recessed opening').length, 0);
assert.equal(objectsWithData(lumberMill, 'facadeOpeningKind', 'door').length, 1);
assert.equal(objectsWithData(lumberMill, 'facadeOpeningKind', 'window').length, 2);

const serviceLintel = lumberMill.getObjectByName('Lumber mill service bay structural lintel');
const serviceJambs = objectsNamed(lumberMill, 'Lumber mill service bay load-bearing jamb');
assert.ok(serviceLintel);
assert.equal(serviceJambs.length, 2);
for (const jamb of serviceJambs) assertJoined(serviceLintel, jamb, 'service-bay lintel must bear on both jambs');
const sawBed = lumberMill.getObjectByName('Lumber mill saw carriage bed');
const sawRail = lumberMill.getObjectByName('Lumber mill saw frame joined top rail');
const sawPosts = objectsNamed(lumberMill, 'Lumber mill saw frame bearing post');
assert.ok(sawBed && sawRail);
assert.equal(sawPosts.length, 2);
for (const post of sawPosts) {
  assertJoined(sawBed, post, 'saw frame post must meet the carriage bed');
  assertJoined(sawRail, post, 'saw frame post must meet the joined top rail');
}
const driveWheel = lumberMill.getObjectByName('Lumber mill saw drive wheel');
const driveAxle = lumberMill.getObjectByName('Lumber mill saw drive axle');
assert.ok(driveWheel && driveAxle);
assertJoined(driveWheel, driveAxle, 'saw drive wheel must be carried by its axle');

const lumberCanopyRoof = lumberMill.getObjectByName('Lumber mill intake canopy roof');
const lumberCanopyLedger = lumberMill.getObjectByName('Lumber mill canopy wall ledger');
const lumberCanopyEave = lumberMill.getObjectByName('Lumber mill canopy post-supported eave beam');
const lumberCanopyPosts = objectsNamed(lumberMill, 'Lumber mill canopy roof-bearing post');
assert.ok(lumberCanopyRoof && lumberCanopyLedger && lumberCanopyEave);
assert.equal(lumberCanopyPosts.length, 2);
assertJoined(lumberCanopyRoof, lumberCanopyLedger, 'saw-bay canopy must meet its wall ledger');
assertJoined(lumberCanopyRoof, lumberCanopyEave, 'saw-bay canopy must meet its outer eave beam');
for (const post of lumberCanopyPosts) assertJoined(post, lumberCanopyEave, 'canopy posts must carry the eave beam');

const timberStock = lumberMill.getObjectByName('TimberStockpile');
assert.ok(timberStock instanceof THREE.Group);
assert.equal(timberStock.visible, false);
assert.equal(objectsNamed(timberStock, 'TimberStockSegment').length, 5);
assertBrownTimberAndNoVegetation(lumberMill);
assert.deepEqual(deterministicSignature(lumberMill), deterministicSignature(createLumberMillMesh()));
const lumberTriangles = triangleCount(lumberMill);
assert.ok(lumberTriangles <= PROCEDURAL_BUILDING_CATALOG.lumber_mill.triangleCeiling);

const windmill = createWindmillMesh();
windmill.updateMatrixWorld(true);
assert.equal(windmill.name, 'Windmill');
assert.equal(objectsNamed(windmill, 'Windmill tapered tower facet 1').length, 1);
assert.equal(objectsNamed(windmill, 'Windmill joined tapered plaster tower wall').length, 9);
const perforatedTowerWalls = objectsWithData(windmill, 'literalFacadeApertures', true);
assert.equal(perforatedTowerWalls.length, 3);
for (const opening of objectsWithData(windmill, 'literalWallAperture', true)) {
  assert.ok(opening.parent instanceof THREE.Group);
  const wall = opening.parent.children.find(
    (child): child is THREE.Mesh => child instanceof THREE.Mesh && child.userData.literalFacadeApertures === true,
  );
  assert.ok(wall, `${opening.name} must share a facet with its perforated tower wall`);
  assertLiteralAperture(opening, wall, `${opening.name} must pass through the tapered tower shell`);
}
assert.equal(objectsWithData(windmill, 'facadeOpeningKind', 'door').length, 1);
assert.equal(objectsWithData(windmill, 'facadeOpeningKind', 'window').length, 2);

const sails = windmill.getObjectByName('Windmill sails');
assert.ok(sails instanceof THREE.Group);
assert.equal(objectsNamed(sails, 'Windmill joined sail blade').length, 4);
assert.equal(objectsNamed(sails, 'Windmill sail brown timber lattice rung').length, 28);
const bearing = windmill.getObjectByName('Windmill cap axle bearing housing');
const hub = windmill.getObjectByName('Windmill sail timber hub');
const axle = windmill.getObjectByName('Windmill sail iron axle');
assert.ok(bearing && hub && axle);
assertJoined(bearing, hub, 'windmill sail hub must seat into its cap bearing');
assertJoined(bearing, axle, 'windmill sail axle must penetrate its cap bearing');
const capDrum = windmill.getObjectByName('Windmill joined timber rotating cap drum');
const capRoof = windmill.getObjectByName('Windmill joined shingle cap roof');
assert.ok(capDrum && capRoof);
assertJoined(capDrum, capRoof, 'windmill cap roof must sit on the timber cap drum');

const porchRoof = windmill.getObjectByName('Windmill loading porch roof');
const porchLedger = windmill.getObjectByName('Windmill loading porch wall ledger');
const porchEave = windmill.getObjectByName('Windmill loading porch post-supported eave beam');
const porchPosts = objectsNamed(windmill, 'Windmill loading porch roof-bearing post');
assert.ok(porchRoof && porchLedger && porchEave);
assert.equal(porchPosts.length, 2);
assertJoined(porchRoof, porchLedger, 'windmill porch roof must meet its wall ledger');
assertJoined(porchRoof, porchEave, 'windmill porch roof must meet its outer eave beam');
for (const post of porchPosts) assertJoined(post, porchEave, 'windmill porch posts must carry the eave beam');

for (const [containerName, segmentName] of [
  ['WatermillGrainStockpile', 'WatermillGrainSegment'],
  ['WatermillFlourStockpile', 'WatermillFlourSegment'],
] as const) {
  const stockpile = windmill.getObjectByName(containerName);
  assert.ok(stockpile instanceof THREE.Group, `${containerName} runtime anchor must remain present`);
  assert.equal(stockpile.visible, false);
  assert.equal(objectsNamed(stockpile, segmentName).length, 3);
}
assertBrownTimberAndNoVegetation(windmill);
assert.deepEqual(deterministicSignature(windmill), deterministicSignature(createWindmillMesh()));
const windmillTriangles = triangleCount(windmill);
assert.ok(windmillTriangles <= PROCEDURAL_BUILDING_CATALOG.windmill.triangleCeiling);

console.log(
  `lumber mill/windmill architecture tests passed (${lumberTriangles} + ${windmillTriangles} triangles)`,
);
