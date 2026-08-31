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
root.traverse((object) => {
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh) return;
  if (mesh.userData.proceduralRoofShell === true && mesh.name.includes('roof plane')) roofs.push(mesh);
  if (mesh.name === 'Gable shell corner post joined below wall plate') posts.push(mesh);
});
assert(roofs.length === 2, `expected two joined roof planes, received ${roofs.length}`);
assert(posts.length === 4, `expected four bounded corner posts, received ${posts.length}`);
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

console.log('procedural gable shell passed (physical apertures, joined roof planes, bounded posts)');

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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
