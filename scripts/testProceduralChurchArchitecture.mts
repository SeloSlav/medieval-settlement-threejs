import * as THREE from 'three';
import { createChapelMesh } from '../src/buildings/meshes/chapelMesh.ts';

for (const tier of [1, 2, 3] as const) {
  const church = createChapelMesh(tier);
  church.updateMatrixWorld(true);
  const modelName = tier === 1
    ? 'Small Wooden Church'
    : tier === 2
      ? 'Small Stone Church'
      : 'Large Stone Church';
  const rightWall = requiredMesh(
    church,
    `${modelName} right physical window wall`,
  );
  const frontWall = requiredMesh(
    church,
    `${modelName} physical front wall apertures`,
  );
  const pane = tier === 1
    ? requiredObject(church, 'Small wooden church right window pane 1')
    : requiredObject(church, 'Chapel clear lancet window pane');
  const paneWorld = pane.getWorldPosition(new THREE.Vector3());
  assertRayMisses(
    rightWall,
    paneWorld.clone().add(new THREE.Vector3(2, 0, 0)),
    new THREE.Vector3(-1, 0, 0),
    `${modelName} side window`,
  );

  const door = tier === 1
    ? requiredObject(church, 'Small wooden church timber plank door leaf')
    : requiredObject(church, 'Chapel visible arched timber door leaf');
  const doorWorld = door.getWorldPosition(new THREE.Vector3());
  assertRayMisses(
    frontWall,
    doorWorld.clone().add(new THREE.Vector3(0, 0, 2)),
    new THREE.Vector3(0, 0, -1),
    `${modelName} front door`,
  );

  const roofPlanes: THREE.Mesh[] = [];
  church.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (
      mesh.isMesh
      && mesh.userData.proceduralRoofShell === true
      && mesh.name.includes('roof plane')
    ) {
      roofPlanes.push(mesh);
    }
  });
  assert(roofPlanes.length === 2, `${modelName} does not have exactly two joined nave roof planes`);
  for (const roof of roofPlanes) {
    assert(
      roof.geometry.userData.proceduralGeometryWriter === 'semantic-physical-uv-v1',
      `${modelName} roof lost semantic physical UV geometry`,
    );
  }

  if (tier === 3) {
    const gable = requiredMesh(church, 'Large Stone Church physical oculus gable wall');
    const oculus = requiredObject(church, 'Chapel clear oculus window pane');
    const oculusWorld = oculus.getWorldPosition(new THREE.Vector3());
    assertRayMisses(
      gable,
      oculusWorld.clone().add(new THREE.Vector3(0, 0, 2)),
      new THREE.Vector3(0, 0, -1),
      'Large Stone Church oculus',
    );
  }
}

console.log('procedural church architecture passed (3 tiers, physical apertures, joined metric-UV roofs)');

function requiredObject(parent: THREE.Object3D, name: string): THREE.Object3D {
  const object = parent.getObjectByName(name);
  if (!object) throw new Error(`Missing ${name}.`);
  return object;
}

function requiredMesh(parent: THREE.Object3D, name: string): THREE.Mesh {
  const object = requiredObject(parent, name);
  if (!(object instanceof THREE.Mesh)) throw new Error(`${name} is not a mesh.`);
  return object;
}

function assertRayMisses(
  target: THREE.Mesh,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  label: string,
): void {
  const hits = new THREE.Raycaster(origin, direction.normalize(), 0, 5)
    .intersectObject(target, false);
  assert(hits.length === 0, `${label} is not physically cut through its wall`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
