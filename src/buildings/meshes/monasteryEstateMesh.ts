import * as THREE from 'three';
import { createBackyardGardenMesh } from '../../residences/backyardGardenMesh.ts';
import { mulberry32 } from '../../utils/random.ts';
import {
  MONASTERY_ESTATE_FRONT_DEPTH,
  MONASTERY_ESTATE_HALF_WIDTH,
  MONASTERY_ESTATE_REAR_DEPTH,
  normalizeMonasteryEstateLevel,
} from '../monasteryEstate.ts';
import {
  addMesh,
  metalMaterial,
  residenceFacadeMaterial,
  sharedBuildingDetailMaterial,
  shingleMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import { addBarrel, addGableShell, addLeanToRoof, addPlankDoor } from './buildingMeshKit.ts';

const grass = sharedBuildingDetailMaterial('foliage');
const earth = sharedBuildingDetailMaterial('earth');
const foliage = sharedBuildingDetailMaterial('foliage');
const copper = sharedBuildingDetailMaterial('brass');

function addFenceRun(
  parent: THREE.Group,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
  name: string,
): void {
  const length = Math.hypot(endX - startX, endZ - startZ);
  const yaw = Math.atan2(endX - startX, endZ - startZ);
  const run = new THREE.Group();
  run.name = name;
  const posts = Math.max(2, Math.ceil(length / 2.7));
  for (let index = 0; index <= posts; index += 1) {
    const t = index / posts;
    addMesh(
      run,
      new THREE.BoxGeometry(0.18, 1.35, 0.18),
      timberMaterial('weathered'),
      new THREE.Vector3(
        THREE.MathUtils.lerp(startX, endX, t),
        0.68,
        THREE.MathUtils.lerp(startZ, endZ, t),
      ),
    );
  }
  for (const height of [0.48, 0.98]) {
    addMesh(
      run,
      new THREE.BoxGeometry(0.13, 0.13, length),
      timberMaterial('mid'),
      new THREE.Vector3((startX + endX) * 0.5, height, (startZ + endZ) * 0.5),
      new THREE.Euler(0, yaw, 0),
    );
  }
  parent.add(run);
}

function addPerimeterFence(parent: THREE.Group): void {
  const rear = -MONASTERY_ESTATE_REAR_DEPTH;
  const front = MONASTERY_ESTATE_FRONT_DEPTH;
  const half = MONASTERY_ESTATE_HALF_WIDTH;
  addFenceRun(parent, -half, rear, half, rear, 'Monastery estate rear fence');
  addFenceRun(parent, -half, rear, -half, front, 'Monastery estate west fence');
  addFenceRun(parent, half, rear, half, front, 'Monastery estate east fence');
  addFenceRun(parent, -half, front, -4.2, front, 'Monastery estate front fence west');
  addFenceRun(parent, 4.2, front, half, front, 'Monastery estate front fence east');

  for (const x of [-4.2, 4.2]) {
    addMesh(parent, new THREE.BoxGeometry(0.45, 2.5, 0.45), stoneMaterial('mid'), new THREE.Vector3(x, 1.25, front));
    addMesh(parent, new THREE.ConeGeometry(0.45, 0.65, 4), stoneMaterial('light'), new THREE.Vector3(x, 2.82, front), new THREE.Euler(0, Math.PI * 0.25, 0));
  }
  const gate = addMesh(
    parent,
    new THREE.BoxGeometry(7.7, 1.25, 0.16),
    timberMaterial('dark'),
    new THREE.Vector3(0, 0.74, front),
  );
  gate.name = 'Monastery estate main gate';
  for (let x = -3.5; x <= 3.5; x += 0.7) {
    addMesh(parent, new THREE.BoxGeometry(0.11, 1.35, 0.19), timberMaterial('weathered'), new THREE.Vector3(x, 0.77, front + 0.02));
  }
}

function placeGarden(
  parent: THREE.Group,
  kind: 'apple_orchard' | 'vegetable_garden' | 'herb_garden' | 'flower_garden' | 'hen_yard' | 'goat_pen' | 'backyard_apiary',
  name: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  seed: number,
): void {
  const garden = createBackyardGardenMesh(kind, { width, depth, seed });
  garden.name = name;
  garden.position.set(x, 0.03, z);
  parent.add(garden);
}

function addAnimal(
  parent: THREE.Group,
  species: 'cow' | 'pig',
  x: number,
  z: number,
  heading: number,
  variant: number,
): void {
  const animal = new THREE.Group();
  animal.name = species === 'cow' ? 'Monastery dairy cow' : 'Monastery pig';
  const bodyMaterial = species === 'cow'
    ? residenceFacadeMaterial(variant % 2 === 0 ? 'white' : 'orange')
    : residenceFacadeMaterial('lightOrange');
  const bodyY = species === 'cow' ? 0.88 : 0.48;
  const length = species === 'cow' ? 1.75 : 1.15;
  addMesh(animal, new THREE.SphereGeometry(0.6, 10, 7), bodyMaterial, new THREE.Vector3(0, bodyY, 0), new THREE.Euler(), new THREE.Vector3(0.82, species === 'cow' ? 1 : 0.75, length));
  addMesh(animal, new THREE.SphereGeometry(species === 'cow' ? 0.4 : 0.34, 9, 6), bodyMaterial, new THREE.Vector3(0, bodyY + 0.08, length * 0.55));
  for (const legX of [-0.34, 0.34]) for (const legZ of [-0.48, 0.48]) {
    addMesh(animal, new THREE.CylinderGeometry(0.075, 0.09, species === 'cow' ? 0.72 : 0.38, 6), bodyMaterial, new THREE.Vector3(legX, species === 'cow' ? 0.36 : 0.2, legZ));
  }
  animal.position.set(x, 0, z);
  animal.rotation.y = heading;
  parent.add(animal);
}

function addBrewhouse(parent: THREE.Group, level: number): void {
  const yard = new THREE.Group();
  yard.name = 'Monastery ale brewhouse and cellar yard';
  yard.position.set(-16.5, 0, -11.5);
  const shell = addGableShell(yard, {
    width: 8.2,
    depth: 6.3,
    stoneHeight: 1.0,
    wallHeight: 2.75,
    ridgeHeight: 2.15,
    wallMaterial: residenceFacadeMaterial('white'),
    roofMaterial: shingleMaterial(),
  });
  addPlankDoor(yard, 0, 1.05, shell.frontZ + 0.03, 1.2, 1.95);
  addLeanToRoof(yard, {
    width: 4.4,
    depth: 3.0,
    thickness: 0.14,
    material: shingleMaterial(),
    position: new THREE.Vector3(5.0, 2.35, 0.2),
    pitch: 0.12,
    highEdge: 'negativeX',
    name: 'Monastery open brewing bay',
  });
  addMesh(yard, new THREE.SphereGeometry(0.82, 12, 8), copper, new THREE.Vector3(5.0, 0.95, 0.2), new THREE.Euler(), new THREE.Vector3(1, 1.1, 1));
  addMesh(yard, new THREE.CylinderGeometry(0.14, 0.14, 1.55, 8), copper, new THREE.Vector3(5.0, 1.95, 0.2));
  for (let index = 0; index < 3 + level * 2; index += 1) {
    addBarrel(yard, -3.2 + (index % 4) * 1.05, 4.0 + Math.floor(index / 4) * 1.0, 0.92);
  }
  parent.add(yard);
}

function addInvestmentBuildings(parent: THREE.Group, level: number): void {
  if (level < 1) return;
  const dairy = new THREE.Group();
  dairy.name = 'Monastery invested dairy';
  dairy.position.set(15, 0, -17);
  const shell = addGableShell(dairy, {
    width: 6.8,
    depth: 4.8,
    stoneHeight: 0.9,
    wallHeight: 2.35,
    ridgeHeight: 1.75,
    wallMaterial: residenceFacadeMaterial('white'),
    roofMaterial: shingleMaterial(),
  });
  addPlankDoor(dairy, 0, 0.95, shell.frontZ + 0.03, 1.0, 1.75);
  parent.add(dairy);

  if (level < 2) return;
  const barn = new THREE.Group();
  barn.name = 'Monastery invested tithe barn';
  barn.position.set(1.5, 0, -34.5);
  const barnShell = addGableShell(barn, {
    width: 10.5,
    depth: 6.5,
    stoneHeight: 0.8,
    wallHeight: 3.0,
    ridgeHeight: 2.5,
    wallMaterial: timberMaterial('mid'),
    roofMaterial: shingleMaterial(),
  });
  addPlankDoor(barn, 0, 0.92, barnShell.frontZ + 0.03, 1.8, 2.3);
  parent.add(barn);

  if (level < 3) return;
  const press = new THREE.Group();
  press.name = 'Monastery invested apple press';
  press.position.set(-22, 0, -21);
  addMesh(press, new THREE.CylinderGeometry(1.2, 1.2, 0.5, 12), stoneMaterial('mid'), new THREE.Vector3(0, 0.25, 0));
  addMesh(press, new THREE.CylinderGeometry(0.18, 0.18, 2.6, 8), timberMaterial('dark'), new THREE.Vector3(0, 1.55, 0));
  addMesh(press, new THREE.BoxGeometry(3.3, 0.22, 0.28), timberMaterial('weathered'), new THREE.Vector3(0.65, 2.55, 0), new THREE.Euler(0, 0, -0.18));
  addMesh(press, new THREE.CylinderGeometry(0.42, 0.5, 0.7, 10), metalMaterial('iron'), new THREE.Vector3(0, 0.8, 0));
  parent.add(press);
}

export function createMonasteryEstateMesh(rawLevel: number): THREE.Group {
  const level = normalizeMonasteryEstateLevel(rawLevel);
  const group = new THREE.Group();
  group.name = `Monastery enclosed estate level ${level}`;
  group.userData.monasteryEstateLevel = level;
  group.userData.reservedLand = { width: 68, depth: 53 };

  addPerimeterFence(group);
  addMesh(group, new THREE.BoxGeometry(7.2, 0.06, 51.5), earth, new THREE.Vector3(0, 0.03, -19));
  addMesh(group, new THREE.BoxGeometry(66.5, 0.04, 51.5), grass, new THREE.Vector3(0, 0.01, -19));
  addBrewhouse(group, level);
  placeGarden(group, 'apple_orchard', 'Monastery apple orchard', -23, -34, 18, 16, 8301);
  placeGarden(group, 'backyard_apiary', 'Monastery bee garden', -25, -19, 12, 8, 8302);
  placeGarden(group, 'vegetable_garden', 'Monastery kitchen vegetable garden', -7, -21, 13, 9, 8303);
  placeGarden(group, 'herb_garden', 'Monastery physic herb garden', 3.5, -20, 8, 7, 8304);
  placeGarden(group, 'flower_garden', 'Monastery pollinator garden', -6, -31, 11, 7, 8305);
  placeGarden(group, 'hen_yard', 'Monastery chicken yard', 25, -12, 11, 8, 8306);
  placeGarden(group, 'goat_pen', 'Monastery small-stock enclosure', 24, -25, 12, 9, 8307);

  const random = mulberry32(8310 + level * 19);
  for (let index = 0; index < 2 + level; index += 1) {
    addAnimal(group, 'cow', 14 + random() * 15, -34 - random() * 7, random() * Math.PI * 2, index);
  }
  for (let index = 0; index < 3 + level * 2; index += 1) {
    addAnimal(group, 'pig', 18 + random() * 11, -17 - random() * 7, random() * Math.PI * 2, index);
  }
  for (let index = 0; index < 4 + level * 2; index += 1) {
    addMesh(group, new THREE.SphereGeometry(0.16, 7, 5), foliage, new THREE.Vector3(-27 + random() * 8, 0.18, -29 + random() * 9));
  }
  addInvestmentBuildings(group, level);
  return group;
}
