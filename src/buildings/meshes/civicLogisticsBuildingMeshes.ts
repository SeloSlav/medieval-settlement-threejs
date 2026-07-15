import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  residenceFacadeMaterial,
  sharedBuildingDetailMaterial,
  shingleMaterial,
  stoneMaterial,
  tileMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import { addDarkOpening, addGableShell, addPlankDoor, addSmallWindow } from './buildingMeshKit.ts';

const earth = sharedBuildingDetailMaterial('earth');

function addCrate(group: THREE.Group, x: number, y: number, z: number, scale = 1): void {
  addMesh(group, new THREE.BoxGeometry(1.0 * scale, 0.78 * scale, 0.82 * scale), timberMaterial('weathered'), new THREE.Vector3(x, y + 0.39 * scale, z));
  for (const offset of [-0.38, 0.38]) {
    addMesh(group, new THREE.BoxGeometry(0.09 * scale, 0.82 * scale, 0.88 * scale), timberMaterial('dark'), new THREE.Vector3(x + offset * scale, y + 0.4 * scale, z));
  }
}

function addBell(group: THREE.Group, x: number, y: number, z: number): void {
  addMesh(group, new THREE.CylinderGeometry(0.12, 0.34, 0.52, 10), sharedBuildingDetailMaterial('brass'), new THREE.Vector3(x, y, z));
  addMesh(group, new THREE.SphereGeometry(0.09, 7, 5), metalMaterial('iron'), new THREE.Vector3(x, y - 0.34, z));
}

export function createTownHallMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Town Hall';
  const shell = addGableShell(group, {
    width: 11.2,
    depth: 7.4,
    stoneHeight: 1.4,
    wallHeight: 4.05,
    ridgeHeight: 2.65,
    wallMaterial: residenceFacadeMaterial('yellow'),
    roofMaterial: tileMaterial(0),
    stoneGroundFloor: true,
  });

  // An arcaded public ground floor and balcony give the hall a civic facade.
  for (const x of [-3.75, -1.25, 1.25, 3.75]) {
    addDarkOpening(group, x, 1.35, shell.frontZ + 0.04, 1.45, 2.15);
    addSmallWindow(group, x, 4.0, shell.frontZ + 0.08, 0.74, 1.02);
  }
  addPlankDoor(group, 0, 1.43, -shell.frontZ - 0.05, 1.24, 2.2);
  addMesh(group, new THREE.BoxGeometry(10.2, 0.22, 1.35), timberMaterial('dark'), new THREE.Vector3(0, 2.66, 4.05));
  for (let x = -4.8; x <= 4.8; x += 1.2) {
    addMesh(group, new THREE.BoxGeometry(0.12, 1.02, 0.12), timberMaterial('dark'), new THREE.Vector3(x, 3.12, 4.58));
  }
  addMesh(group, new THREE.BoxGeometry(10.15, 0.12, 0.12), timberMaterial('weathered'), new THREE.Vector3(0, 3.58, 4.58));

  // Exterior stair, proclamation board, and bench communicate public use at street level.
  for (let i = 0; i < 6; i++) {
    addMesh(group, new THREE.BoxGeometry(2.15, 0.2, 0.48), stoneMaterial(i % 2 ? 'mid' : 'light'), new THREE.Vector3(-4.25, 0.12 + i * 0.2, 4.15 + i * 0.4));
  }
  addMesh(group, new THREE.BoxGeometry(2.25, 1.45, 0.12), timberMaterial('weathered'), new THREE.Vector3(3.55, 1.45, 4.72));
  for (const x of [2.6, 4.5]) addMesh(group, new THREE.BoxGeometry(0.16, 2.4, 0.16), timberMaterial('dark'), new THREE.Vector3(x, 1.2, 4.68));
  addMesh(group, new THREE.BoxGeometry(2.7, 0.18, 0.64), timberMaterial('mid'), new THREE.Vector3(0.25, 0.58, 5.05));
  for (const x of [-0.75, 1.25]) addMesh(group, new THREE.BoxGeometry(0.16, 0.58, 0.16), timberMaterial('dark'), new THREE.Vector3(x, 0.3, 5.05));

  // Compact bell cupola: a recognizable settlement landmark without reading as a church.
  addMesh(group, new THREE.BoxGeometry(2.25, 1.8, 2.25), timberMaterial('dark'), new THREE.Vector3(0, 7.55, 0));
  for (const z of [-1.14, 1.14]) addDarkOpening(group, 0, 7.55, z, 0.78, 0.92);
  addBell(group, 0, 7.55, 1.22);
  addMesh(group, new THREE.ConeGeometry(1.65, 2.0, 4), tileMaterial(1), new THREE.Vector3(0, 9.38, 0), new THREE.Euler(0, Math.PI * 0.25, 0));
  addMesh(group, new THREE.BoxGeometry(0.1, 0.92, 0.1), metalMaterial('iron'), new THREE.Vector3(0, 10.72, 0));
  addMesh(group, new THREE.BoxGeometry(0.58, 0.1, 0.1), metalMaterial('iron'), new THREE.Vector3(0, 10.88, 0));
  return group;
}

export function createVillageStorehouseMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Village storehouse';

  // Raised masonry plinth protects construction stock from damp ground.
  addMesh(group, new THREE.BoxGeometry(10.8, 0.7, 7.2), stoneMaterial('mid'), new THREE.Vector3(-0.35, 0.35, 0));
  const shell = addGableShell(group, {
    width: 10.2,
    depth: 6.6,
    stoneHeight: 0.82,
    wallHeight: 3.25,
    ridgeHeight: 2.5,
    wallMaterial: timberMaterial('weathered'),
    roofMaterial: shingleMaterial(),
    centerX: -0.7,
  });
  addPlankDoor(group, -0.7, 0.88, shell.frontZ + 0.04, 2.65, 2.72);
  for (const x of [-4.2, 2.8]) addSmallWindow(group, x, 2.75, shell.frontZ + 0.06, 0.62, 0.52);

  // Loading platform and deep canopy make the warehouse function legible at game camera distance.
  addMesh(group, new THREE.BoxGeometry(9.2, 0.32, 2.2), timberMaterial('dark'), new THREE.Vector3(-0.4, 0.72, 4.2));
  for (const x of [-4.6, 3.8]) addMesh(group, new THREE.BoxGeometry(0.22, 2.6, 0.22), timberMaterial('dark'), new THREE.Vector3(x, 1.65, 5.0));
  addMesh(group, new THREE.BoxGeometry(9.4, 0.16, 2.75), shingleMaterial(), new THREE.Vector3(-0.4, 3.0, 4.25), new THREE.Euler(-0.14, 0, 0));
  for (let i = 0; i < 4; i++) addMesh(group, new THREE.BoxGeometry(2.7 - i * 0.18, 0.18, 0.52), stoneMaterial(i % 2 ? 'light' : 'mid'), new THREE.Vector3(-0.55, 0.1 + i * 0.18, 5.25 + i * 0.4));

  addCrate(group, 2.8, 0.92, 4.18, 1.05);
  addCrate(group, 4.0, 0.92, 4.28, 0.82);
  addCrate(group, 3.45, 1.75, 4.25, 0.72);

  // Separate visible bays for timber, firewood, and quarried stone reinforce specialization.
  for (let row = 0; row < 3; row++) for (let i = 0; i < 5; i++) {
    addMesh(group, new THREE.CylinderGeometry(0.15, 0.18, 2.25, 8), timberMaterial(row % 2 ? 'mid' : 'light'), new THREE.Vector3(-5.5 + i * 0.43, 0.24 + row * 0.32, -4.15), new THREE.Euler(0, 0, Math.PI * 0.5));
  }
  for (let i = 0; i < 9; i++) {
    const x = 3.2 + (i % 3) * 0.55;
    const z = -4.5 + Math.floor(i / 3) * 0.5;
    addMesh(group, new THREE.DodecahedronGeometry(0.38 + (i % 2) * 0.08, 0), stoneMaterial(i % 3 === 0 ? 'mortar' : 'mid'), new THREE.Vector3(x, 0.3 + Math.floor(i / 6) * 0.35, z), new THREE.Euler(i * 0.2, i * 0.31, 0));
  }
  addMesh(group, new THREE.BoxGeometry(3.4, 0.12, 2.2), timberMaterial('dark'), new THREE.Vector3(0, 0.08, -4.2));
  for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) {
    addMesh(group, new THREE.CylinderGeometry(0.12, 0.15, 0.95, 7), timberMaterial('dark'), new THREE.Vector3(-1.25 + i * 0.48, 0.2 + row * 0.27, -4.2), new THREE.Euler(0, 0, Math.PI * 0.5));
  }
  addMesh(group, new THREE.BoxGeometry(0.7, 0.06, 1.8), earth, new THREE.Vector3(-0.4, 0.06, 6.35));
  return group;
}
