import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  quarryRockMaterial,
  sharedBuildingMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import { addDarkOpening, addGableShell, addPlankDoor } from './buildingMeshKit.ts';
import { createCivilianToolStockpile } from './civilianToolStockpileMesh.ts';

function addShaft(group: THREE.Group): void {
  addMesh(
    group,
    new THREE.CylinderGeometry(4.25, 4.65, 0.5, 20),
    quarryRockMaterial('cut'),
    new THREE.Vector3(0, 0.2, 0),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(3.45, 3.45, 0.16, 20),
    sharedBuildingMaterial('interiorDark'),
    new THREE.Vector3(0, 0.5, 0),
  );

  for (let index = 0; index < 12; index++) {
    const angle = index / 12 * Math.PI * 2;
    addMesh(
      group,
      new THREE.BoxGeometry(1.7, 0.5, 0.78),
      quarryRockMaterial(index % 3 === 0 ? 'light' : index % 2 === 0 ? 'dark' : 'mid'),
      new THREE.Vector3(Math.sin(angle) * 4, 0.64, Math.cos(angle) * 4),
      new THREE.Euler(0, angle, 0),
    );
  }
}

function addHeadframe(group: THREE.Group): void {
  const darkTimber = timberMaterial('dark');
  const weatheredTimber = timberMaterial('weathered');
  for (const x of [-2.75, 2.75]) {
    for (const z of [-1.9, 1.9]) {
      addMesh(
        group,
        new THREE.BoxGeometry(0.42, 8.4, 0.42),
        darkTimber,
        new THREE.Vector3(x * 0.72, 4.45, z * 0.72),
        new THREE.Euler(x * z > 0 ? 0.12 : -0.12, 0, x < 0 ? -0.28 : 0.28),
      );
    }
  }
  for (const z of [-1.75, 1.75]) {
    addMesh(
      group,
      new THREE.BoxGeometry(6.35, 0.42, 0.5),
      weatheredTimber,
      new THREE.Vector3(0, 8.05, z),
    );
  }
  addMesh(
    group,
    new THREE.BoxGeometry(0.5, 0.48, 4.1),
    weatheredTimber,
    new THREE.Vector3(0, 8.12, 0),
  );

  const drum = addMesh(
    group,
    new THREE.CylinderGeometry(0.74, 0.74, 2.25, 16),
    timberMaterial('mid'),
    new THREE.Vector3(0, 7.35, 0),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  drum.name = 'Large quarry winding drum';
  for (const x of [-1.18, 1.18]) {
    addMesh(
      group,
      new THREE.TorusGeometry(0.76, 0.09, 8, 18),
      metalMaterial('iron'),
      new THREE.Vector3(x, 7.35, 0),
      new THREE.Euler(0, Math.PI * 0.5, 0),
    );
  }
  addMesh(
    group,
    new THREE.CylinderGeometry(0.055, 0.055, 5.7, 7),
    metalMaterial('iron'),
    new THREE.Vector3(0, 4.2, 0),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(1.35, 0.68, 1.25),
    quarryRockMaterial('cut'),
    new THREE.Vector3(0, 1.15, 0),
  );
}

function addWinchHouse(group: THREE.Group): void {
  const house = new THREE.Group();
  house.position.set(7.15, 0, 1.6);
  house.rotation.y = -Math.PI * 0.5;
  const shell = addGableShell(house, {
    width: 5.4,
    depth: 4.5,
    stoneHeight: 1.05,
    wallHeight: 2.35,
    ridgeHeight: 1.75,
    wallMaterial: quarryRockMaterial('light'),
    roofMaterial: sharedBuildingMaterial('clayRed'),
    stoneGroundFloor: true,
  });
  addPlankDoor(house, -1.35, 1.03, shell.frontZ + 0.02, 0.95, 1.95);
  addDarkOpening(house, 1.18, 2.18, shell.frontZ + 0.04, 0.95, 0.82);
  group.add(house);
}

function addWorkPlatforms(group: THREE.Group): void {
  const timber = timberMaterial('weathered');
  for (const z of [-4.9, 4.9]) {
    addMesh(
      group,
      new THREE.BoxGeometry(9.4, 0.28, 2.1),
      timber,
      new THREE.Vector3(-0.8, 0.76, z),
    );
    for (const x of [-4.8, -2.2, 0.4, 3.0]) {
      addMesh(
        group,
        new THREE.BoxGeometry(0.28, 1.1, 0.28),
        timberMaterial('dark'),
        new THREE.Vector3(x, 0.42, z),
      );
    }
  }
}

function addStoneYard(group: THREE.Group): void {
  const stockpile = new THREE.Group();
  stockpile.name = 'LargeQuarryStockpile';
  stockpile.visible = false;
  const stacks = [
    [-8.4, -5.3, 0],
    [-7.4, -3.8, Math.PI * 0.5],
    [7.7, -5.4, 0.08],
    [9.2, -4.0, Math.PI * 0.5],
  ] as const;
  for (const [x, z, yaw] of stacks) {
    const stack = new THREE.Group();
    stack.name = 'LargeQuarryStockSegment';
    stack.position.set(x, 0, z);
    stack.rotation.y = yaw;
    for (const [bx, by] of [[-0.65, 0.38], [0.65, 0.38], [0, 1.08]] as const) {
      addMesh(
        stack,
        new THREE.BoxGeometry(1.15, 0.72, 1.55),
        quarryRockMaterial(by > 1 ? 'light' : bx < 0 ? 'dark' : 'mid'),
        new THREE.Vector3(bx, by, 0),
      );
    }
    stockpile.add(stack);
  }
  group.add(stockpile);

  for (let index = 0; index < 14; index++) {
    const angle = index / 14 * Math.PI * 2 + 0.16;
    const radius = 10.7 + (index % 3) * 0.45;
    addMesh(
      group,
      new THREE.DodecahedronGeometry(0.62 + (index % 4) * 0.12, 0),
      quarryRockMaterial(index % 3 === 0 ? 'light' : index % 2 === 0 ? 'dark' : 'mid'),
      new THREE.Vector3(Math.sin(angle) * radius, 0.48, Math.cos(angle) * radius),
      new THREE.Euler(index * 0.19, index * 0.37, index * 0.11),
      new THREE.Vector3(1.2, 0.7, 0.95),
    );
  }
}

function addChamberSupportStockpile(group: THREE.Group): void {
  const stockpile = new THREE.Group();
  stockpile.name = 'LargeQuarrySupportStockpile';
  stockpile.visible = false;
  stockpile.position.set(-8.8, 0, 3.5);
  stockpile.rotation.y = 0.12;

  for (let segmentIndex = 0; segmentIndex < 6; segmentIndex += 1) {
    const segment = new THREE.Group();
    segment.name = 'LargeQuarrySupportSegment';
    segment.visible = false;
    segment.position.set(
      (segmentIndex % 3) * 2.25,
      0,
      Math.floor(segmentIndex / 3) * 1.0,
    );
    for (let beamIndex = 0; beamIndex < 3; beamIndex += 1) {
      const beam = addMesh(
        segment,
        new THREE.BoxGeometry(1.95, 0.22, 0.28),
        timberMaterial(beamIndex === 1 ? 'dark' : 'weathered'),
        new THREE.Vector3(
          0,
          0.24 + beamIndex * 0.22,
          (beamIndex - 1) * 0.11,
        ),
        new THREE.Euler(0, (beamIndex - 1) * 0.03, 0),
      );
      beam.name = 'Prepared quarry chamber beam';
    }
    stockpile.add(segment);
  }
  group.add(stockpile);
}

/** Permanent shaft quarry for the underground source of a rich stone deposit. */
export function createLargeQuarryMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Large Quarry';
  addMesh(
    group,
    new THREE.CylinderGeometry(11.7, 12.25, 0.3, 20),
    quarryRockMaterial('dust'),
    new THREE.Vector3(0, 0.1, 0),
  );
  addShaft(group);
  addHeadframe(group);
  addWinchHouse(group);
  addWorkPlatforms(group);
  addStoneYard(group);
  addChamberSupportStockpile(group);
  group.add(createCivilianToolStockpile(new THREE.Vector3(7.8, 0, 5.45), -0.18));
  return group;
}
