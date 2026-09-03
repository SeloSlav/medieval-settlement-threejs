import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFishingCampMesh } from '../src/buildings/meshes/serviceBuildingMeshes.ts';

const fishingCamp = createFishingCampMesh();
fishingCamp.updateMatrixWorld(true);

assert.equal(
  fishingCamp.userData.enclosure,
  'none',
  'the fishing frontage must remain an open working shore rather than a fenced yard',
);

const enclosingNames: string[] = [];
const doors: THREE.Object3D[] = [];
const rackPosts: THREE.Mesh[] = [];
const rackCrossbars: THREE.Mesh[] = [];
const rackParts: THREE.Object3D[] = [];
const workCanParts: THREE.Object3D[] = [];
const gablePosts: THREE.Mesh[] = [];
const transversePlates: THREE.Mesh[] = [];
const longitudinalPlates: THREE.Mesh[] = [];
const roofPlanes: THREE.Mesh[] = [];
fishingCamp.traverse((object) => {
  if (/(?:^|[\s:_-])(?:fence|gate)(?:$|[\s:_-])/i.test(object.name)) {
    enclosingNames.push(object.name);
  }
  if (object.userData.facadeOpeningKind === 'door') doors.push(object);
  if (object.name.startsWith('Fishing rack')) rackParts.push(object);
  if (object.name === 'Fishing work can' || object.name === 'Fishing work can handle') {
    workCanParts.push(object);
  }
  if ((object as THREE.Mesh).isMesh && object.name === 'Fishing rack timber post') {
    rackPosts.push(object as THREE.Mesh);
  }
  if ((object as THREE.Mesh).isMesh && object.name === 'Fishing rack timber crossbar') {
    rackCrossbars.push(object as THREE.Mesh);
  }
  if ((object as THREE.Mesh).isMesh && object.name === 'Gable shell corner post joined below wall plate') {
    gablePosts.push(object as THREE.Mesh);
  }
  if ((object as THREE.Mesh).isMesh && object.name === 'Gable shell transverse wall plate') {
    transversePlates.push(object as THREE.Mesh);
  }
  if ((object as THREE.Mesh).isMesh && object.name === 'Gable shell longitudinal wall plate') {
    longitudinalPlates.push(object as THREE.Mesh);
  }
  if (
    (object as THREE.Mesh).isMesh
    && object.userData.proceduralRoofShell === true
    && object.name.includes('roof plane')
  ) {
    roofPlanes.push(object as THREE.Mesh);
  }
});

assert.deepEqual(enclosingNames, [], 'the fishing frontage contains fence/gate geometry');
assert.equal(doors.length, 2, 'the fishing camp must expose both working-shed doors');
assert.equal(rackPosts.length, 2, 'the fishing drying rack must retain two support posts');
assert.equal(rackCrossbars.length, 1, 'the fishing drying rack must retain one connected crossbar');
assert.ok(workCanParts.length >= 4, 'the fishing work cans and handles must remain explicit');
assert.equal(gablePosts.length, 8, 'both fishing sheds must retain four corner posts');
assert.equal(transversePlates.length, 4, 'both fishing sheds must retain front/rear cross members');
assert.equal(longitudinalPlates.length, 4, 'both fishing sheds must retain their supporting edge plates');
assert.equal(roofPlanes.length, 4, 'both fishing sheds must retain two joined roof planes');

for (const member of [...rackPosts, ...rackCrossbars]) {
  assertSharedBrownTimber(member, member.name);
}
const rackCrossbarBounds = boundsOf(rackCrossbars);
for (const post of rackPosts) {
  assert.ok(
    rackCrossbarBounds.intersectsBox(new THREE.Box3().setFromObject(post)),
    'the fishing rack crossbar must overlap both supporting posts',
  );
}

const roofBounds = boundsOf(roofPlanes);
for (const member of [...gablePosts, ...transversePlates, ...longitudinalPlates]) {
  assertSharedBrownTimber(member, member.name);
  const memberBounds = new THREE.Box3().setFromObject(member);
  const center = memberBounds.getCenter(new THREE.Vector3());
  const coveringRoofHit = new THREE.Raycaster(
    new THREE.Vector3(center.x, roofBounds.max.y + 1, center.z),
    new THREE.Vector3(0, -1, 0),
    0,
    10,
  ).intersectObjects(roofPlanes, false)[0];
  assert.ok(coveringRoofHit, `${member.name} has no covering fishing-shed roof plane`);
  assert.ok(
    memberBounds.max.y <= coveringRoofHit.point.y + 1e-4,
    `${member.name} protrudes through its fishing-shed roof plane`,
  );
}
for (const crossMember of transversePlates) {
  const crossBounds = new THREE.Box3().setFromObject(crossMember).expandByScalar(1e-4);
  const reachedEdges = longitudinalPlates.filter((edgePlate) =>
    crossBounds.intersectsBox(new THREE.Box3().setFromObject(edgePlate))
  );
  assert.equal(
    reachedEdges.length,
    2,
    'a fishing-shed front/rear cross member no longer reaches both supporting edges',
  );
}
for (const post of gablePosts) {
  const postBounds = new THREE.Box3().setFromObject(post).expandByScalar(1e-4);
  assert.ok(
    transversePlates.some((plate) => postBounds.intersectsBox(new THREE.Box3().setFromObject(plate))),
    'a fishing-shed corner post is disconnected from its cross member',
  );
  assert.ok(
    longitudinalPlates.some((plate) => postBounds.intersectsBox(new THREE.Box3().setFromObject(plate))),
    'a fishing-shed corner post is disconnected from its edge plate',
  );
}

for (const [label, obstacleBounds] of [
  ['drying rack', boundsOf(rackParts)],
  ['work cans', boundsOf(workCanParts)],
] as const) {
  for (const door of doors) {
    const protectedApproach = new THREE.Box3()
      .setFromObject(door)
      .expandByVector(new THREE.Vector3(0.4, 0, 0.12));
    // Protect a person's walk-up beyond the steps, not just the door leaf.
    protectedApproach.max.z += 1.8;
    protectedApproach.min.y = 0;
    assert.equal(
      protectedApproach.intersectsBox(obstacleBounds),
      false,
      `${label} clips the protected approach to ${door.name}`,
    );
  }
}

const boat = fishingCamp.getObjectByName('Pulled-up fishing boat');
assert.ok(boat, 'the fishing camp must include its pulled-up boat');
const hull = boat.getObjectByName('Fishing boat closed hull') as THREE.Mesh;
assert.ok(hull?.isMesh, 'the boat needs a hull enclosing its floor and sides');
assertSharedBrownTimber(hull, 'boat hull');

// Single-sided ray hits prove the bottom, both side walls and both ends are
// present and face the viewer correctly inside and beneath the open cockpit.
for (const [label, origin, direction] of [
  ['interior floor', [0, 0.4, 0.3], [0, -1, 0]],
  ['underside', [0, -1, 0], [0, 1, 0]],
  ['port side', [0, 0.45, 0.3], [-1, 0, 0]],
  ['starboard side', [0, 0.45, 0.3], [1, 0, 0]],
  ['stern', [0, 0.55, -1.5], [0, 0, -1]],
  ['bow', [0, 0.65, 1.5], [0, 0, 1]],
] as const) {
  const hits = new THREE.Raycaster(
    boat.localToWorld(new THREE.Vector3(...origin)),
    new THREE.Vector3(...direction).transformDirection(boat.matrixWorld),
    0,
    2,
  ).intersectObject(hull, false);
  assert.ok(hits.length > 0, `the boat is missing a correctly facing ${label}`);
}
const floorHit = new THREE.Raycaster(
  boat.localToWorld(new THREE.Vector3(0, 1.5, 0.3)),
  new THREE.Vector3(0, -1, 0),
).intersectObject(hull, false)[0];
assert.ok(floorHit && boat.worldToLocal(floorHit.point.clone()).y < 0.25,
  'the cockpit must remain open down to its recessed floor');

const boatClearance = new THREE.Box3().setFromObject(boat).expandByScalar(0.3);
for (const object of fishingCamp.children) {
  if (!(object as THREE.Mesh).isMesh) continue;
  assert.equal(boatClearance.intersectsBox(new THREE.Box3().setFromObject(object)), false,
    `the boat needs at least 0.3 m clearance from ${object.name || 'camp architecture'}`);
}

console.log('procedural fishing camp architecture passed (clear walk-ups, closed boat hull, boat clearance, connected timber frames)');

function boundsOf(objects: readonly THREE.Object3D[]): THREE.Box3 {
  assert.ok(objects.length > 0, 'cannot measure an empty fishing architecture assembly');
  const bounds = new THREE.Box3();
  for (const object of objects) bounds.union(new THREE.Box3().setFromObject(object));
  return bounds;
}

function assertSharedBrownTimber(mesh: THREE.Mesh, label: string): void {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  assert.ok(
    material.userData.sharedBuildingMaterial === true
      && material.userData.buildingWeatheringProfile === 'timber'
      && ['timberDark', 'timberMid', 'timberLight', 'timberWeathered', 'stackedTimber']
        .includes(material.userData.buildingMaterialKey),
    `${label} must use the shared brown timber family`,
  );
}
