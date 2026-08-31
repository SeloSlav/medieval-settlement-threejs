import * as THREE from 'three';
import {
  addDarkOpening,
  addGableShell,
  addPlankDoor,
  addSmallWindow,
} from '../src/buildings/meshes/buildingMeshKit.ts';
import {
  residenceFacadeMaterial,
  shingleMaterial,
} from '../src/buildings/buildingMaterials.ts';

const root = new THREE.Group();
const shell = addGableShell(root, {
  width: 6.4,
  depth: 5.2,
  stoneHeight: 0.62,
  wallHeight: 2.48,
  ridgeHeight: 2.24,
  wallMaterial: residenceFacadeMaterial('white'),
  roofMaterial: shingleMaterial(),
  centerX: 0.35,
  centerZ: 0.18,
});
addPlankDoor(root, -1.15, 0.66, shell.frontZ + 0.03, 1.0, 1.82);
addSmallWindow(root, 1.38, 1.72, shell.frontZ + 0.03, 0.72, 0.82);
addSmallWindow(root, -0.65, 1.76, shell.backZ - 0.03, 0.68, 0.78);
addDarkOpening(root, 0.28, 1.55, shell.frontZ + 0.04, 0.48, 0.44);
// A high free-standing tower vent in the same parent must not punch the house.
addDarkOpening(root, 0, 7.2, 0, 0.52, 0.62);
root.updateMatrixWorld(true);

const frontWall = requiredMesh(root, 'Gable shell positive-z perforated wall');
const rearWall = requiredMesh(root, 'Gable shell negative-z perforated wall');
assert(frontWall.userData.proceduralFacadeOpeningCount === 3, 'front facade did not register all three apertures');
assert(rearWall.userData.proceduralFacadeOpeningCount === 1, 'rear facade did not register its aperture');

assertRayMisses(frontWall, new THREE.Vector3(-1.15, 1.45, shell.frontZ + 1), new THREE.Vector3(0, 0, -1), 'front door');
assertRayMisses(frontWall, new THREE.Vector3(1.38, 1.72, shell.frontZ + 1), new THREE.Vector3(0, 0, -1), 'front window');
assertRayMisses(frontWall, new THREE.Vector3(0.28, 1.55, shell.frontZ + 1), new THREE.Vector3(0, 0, -1), 'front dark opening');
assertRayMisses(rearWall, new THREE.Vector3(-0.65, 1.76, shell.backZ - 1), new THREE.Vector3(0, 0, 1), 'rear window');
assertRayHits(frontWall, new THREE.Vector3(0.35, 2.8, shell.frontZ + 1), new THREE.Vector3(0, 0, -1), 'front wall field');

const roofs: THREE.Mesh[] = [];
const posts: THREE.Mesh[] = [];
const transversePlates: THREE.Mesh[] = [];
const longitudinalPlates: THREE.Mesh[] = [];
root.traverse((object) => {
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh) return;
  if (mesh.userData.proceduralRoofShell === true && mesh.name.includes('roof plane')) roofs.push(mesh);
  if (mesh.name === 'Gable shell corner post joined below wall plate') posts.push(mesh);
  if (mesh.name === 'Gable shell transverse wall plate') transversePlates.push(mesh);
  if (mesh.name === 'Gable shell longitudinal wall plate') longitudinalPlates.push(mesh);
});
assert(roofs.length === 2, `expected two joined roof planes, received ${roofs.length}`);
assert(posts.length === 4, `expected four bounded corner posts, received ${posts.length}`);
assert(transversePlates.length === 2, `expected two transverse wall plates, received ${transversePlates.length}`);
assert(longitudinalPlates.length === 2, `expected two longitudinal wall plates, received ${longitudinalPlates.length}`);
for (const roof of roofs) {
  assert(
    roof.geometry.userData.proceduralGeometryWriter === 'semantic-physical-uv-v1',
    `${roof.name} lost semantic physical UV geometry`,
  );
}
for (const post of posts) {
  const bounds = new THREE.Box3().setFromObject(post);
  assert(bounds.max.y <= shell.wallTop - 0.14 + 1e-4, `${post.name} protrudes through its wall plate`);
}

const structuralMembers = [...posts, ...transversePlates, ...longitudinalPlates];
const roofBounds = new THREE.Box3();
for (const roof of roofs) roofBounds.union(new THREE.Box3().setFromObject(roof));
for (const member of structuralMembers) {
  assertSharedBrownTimber(member);
  const bounds = new THREE.Box3().setFromObject(member);
  assert(
    bounds.max.y <= shell.wallTop + 1e-4,
    `${member.name} protrudes above the roof-support plane`,
  );
  const memberCenter = bounds.getCenter(new THREE.Vector3());
  const coveringRoofHit = new THREE.Raycaster(
    new THREE.Vector3(memberCenter.x, roofBounds.max.y + 1, memberCenter.z),
    new THREE.Vector3(0, -1, 0),
    0,
    10,
  ).intersectObjects(roofs, false)[0];
  assert(coveringRoofHit, `${member.name} has no covering roof skin`);
  assert(
    bounds.max.y <= coveringRoofHit.point.y + 1e-4,
    `${member.name} protrudes through the roof skin`,
  );
}

const frontCrossMember = transversePlates.find((plate) =>
  plate.getWorldPosition(new THREE.Vector3()).z > shell.centerZ
);
assert(frontCrossMember, 'front gable lost its transverse cross member');
const frontBounds = new THREE.Box3().setFromObject(frontCrossMember).expandByScalar(1e-4);
for (const edgePlate of longitudinalPlates) {
  assert(
    frontBounds.intersectsBox(new THREE.Box3().setFromObject(edgePlate)),
    'front gable cross member no longer reaches both supporting edge plates',
  );
}
for (const post of posts) {
  const postBounds = new THREE.Box3().setFromObject(post).expandByScalar(1e-4);
  assert(
    transversePlates.some((plate) => postBounds.intersectsBox(new THREE.Box3().setFromObject(plate))),
    'gable corner post is disconnected from its transverse wall plate',
  );
  assert(
    longitudinalPlates.some((plate) => postBounds.intersectsBox(new THREE.Box3().setFromObject(plate))),
    'gable corner post is disconnected from its longitudinal wall plate',
  );
}

console.log('procedural gable shell passed (physical apertures, joined roof planes, connected brown-timber frame)');

function requiredMesh(parent: THREE.Object3D, name: string): THREE.Mesh {
  const object = parent.getObjectByName(name);
  if (!(object instanceof THREE.Mesh)) throw new Error(`Missing ${name}.`);
  return object;
}

function assertRayMisses(
  target: THREE.Mesh,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  label: string,
): void {
  const hits = new THREE.Raycaster(origin, direction.normalize(), 0, 3).intersectObject(target, false);
  assert(hits.length === 0, `${label} is not a physical aperture`);
}

function assertRayHits(
  target: THREE.Mesh,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  label: string,
): void {
  const hits = new THREE.Raycaster(origin, direction.normalize(), 0, 3).intersectObject(target, false);
  assert(hits.length > 0, `${label} unexpectedly removed structural wall`);
}

function assertSharedBrownTimber(mesh: THREE.Mesh): void {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const key = material.userData.buildingMaterialKey;
  assert(
    material.userData.sharedBuildingMaterial === true
      && material.userData.buildingWeatheringProfile === 'timber'
      && ['timberDark', 'timberMid', 'timberLight', 'timberWeathered', 'stackedTimber'].includes(key),
    `${mesh.name} does not use the shared brown timber family`,
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
