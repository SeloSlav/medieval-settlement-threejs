import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import {
  FOUNDING_STONE_VISUAL_SEGMENTS,
  FOUNDING_TIMBER_VISUAL_SEGMENTS,
} from '../buildingStockpileVisuals.ts';

function addAFrameShelter(
  parent: THREE.Group,
  x: number,
  z: number,
  yaw: number,
): void {
  const shelter = new THREE.Group();
  shelter.position.set(x, 0, z);
  shelter.rotation.y = yaw;
  for (const side of [-1, 1]) {
    addMesh(
      shelter,
      new THREE.BoxGeometry(2.75, 0.1, 3.5),
      sharedBuildingMaterial('plasterGrey'),
      new THREE.Vector3(side * 0.82, 1.28, 0),
      new THREE.Euler(0, 0, side * -0.61),
    );
  }
  for (const zEnd of [-1.58, 1.58]) {
    for (const side of [-1, 1]) {
      addMesh(
        shelter,
        new THREE.CylinderGeometry(0.065, 0.085, 2.75, 6),
        timberMaterial('dark'),
        new THREE.Vector3(side * 0.74, 1.25, zEnd),
        new THREE.Euler(0, 0, side * -0.61),
      );
    }
  }
  addMesh(
    shelter,
    new THREE.CylinderGeometry(0.07, 0.08, 3.72, 6),
    timberMaterial('dark'),
    new THREE.Vector3(0, 2.24, 0),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  parent.add(shelter);
}

function addTimberStock(parent: THREE.Group): void {
  const stockpile = new THREE.Group();
  stockpile.name = 'FoundingTimberStockpile';
  for (let segmentIndex = 0; segmentIndex < FOUNDING_TIMBER_VISUAL_SEGMENTS; segmentIndex += 1) {
    const segment = new THREE.Group();
    segment.name = 'FoundingTimberSegment';
    const row = Math.floor(segmentIndex / 4);
    const column = segmentIndex % 4;
    segment.position.set(-5.7 + column * 0.62, 0, -2.55 + row * 0.48);
    for (let log = 0; log < 3; log += 1) {
      addMesh(
        segment,
        new THREE.CylinderGeometry(0.13, 0.16, 2.55, 7),
        timberMaterial(log === 1 ? 'light' : 'mid'),
        new THREE.Vector3(0, 0.18 + log * 0.26, 0),
        new THREE.Euler(0, 0, Math.PI * 0.5),
      );
    }
    stockpile.add(segment);
  }
  parent.add(stockpile);
}

function addStoneStock(parent: THREE.Group): void {
  const stockpile = new THREE.Group();
  stockpile.name = 'FoundingStoneStockpile';
  for (let index = 0; index < FOUNDING_STONE_VISUAL_SEGMENTS; index += 1) {
    const stone = addMesh(
      stockpile,
      new THREE.DodecahedronGeometry(0.42 + (index % 3) * 0.08, 0),
      stoneMaterial(index % 3 === 0 ? 'light' : 'mid'),
      new THREE.Vector3(
        3.8 + (index % 4) * 0.62,
        0.34 + Math.floor(index / 4) * 0.42,
        -2.8,
      ),
      new THREE.Euler(index * 0.23, index * 0.41, index * 0.17),
    );
    stone.name = 'FoundingStoneSegment';
  }
  parent.add(stockpile);
}

function addTreasuryChest(parent: THREE.Group): void {
  const chest = new THREE.Group();
  chest.name = 'FoundingTreasuryChest';
  addMesh(
    chest,
    new THREE.BoxGeometry(1.25, 0.68, 0.75),
    timberMaterial('dark'),
    new THREE.Vector3(5.1, 0.4, 2.8),
  );
  addMesh(
    chest,
    new THREE.CylinderGeometry(0.38, 0.38, 1.25, 8, 1, false, 0, Math.PI),
    timberMaterial('weathered'),
    new THREE.Vector3(5.1, 0.78, 2.8),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  addMesh(
    chest,
    new THREE.BoxGeometry(0.12, 0.72, 0.8),
    metalMaterial('iron'),
    new THREE.Vector3(5.1, 0.53, 2.8),
  );
  parent.add(chest);
}

export function createFoundersCampMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "Founders' camp and open stockyard";

  const earth = addMesh(
    group,
    new THREE.CircleGeometry(8.1, 28),
    sharedBuildingDetailMaterial('earth'),
    new THREE.Vector3(0, 0.025, 0),
    new THREE.Euler(-Math.PI * 0.5, 0, 0),
  );
  earth.name = 'Founding stockyard trampled earth';

  const shelters = new THREE.Group();
  shelters.name = 'FoundingShelters';
  addAFrameShelter(shelters, -2.9, 2.8, 0.16);
  addAFrameShelter(shelters, 0.5, 3.25, -0.08);
  addAFrameShelter(shelters, 3.7, 2.65, -0.2);
  group.add(shelters);

  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    addMesh(
      shelters,
      new THREE.DodecahedronGeometry(0.18, 0),
      stoneMaterial('mid'),
      new THREE.Vector3(Math.cos(angle) * 0.65, 0.17, Math.sin(angle) * 0.65),
    );
  }
  addMesh(
    shelters,
    new THREE.ConeGeometry(0.34, 0.7, 6),
    sharedBuildingDetailMaterial('paintOchre'),
    new THREE.Vector3(0, 0.43, 0),
  );
  addMesh(
    shelters,
    new THREE.BoxGeometry(2.4, 0.18, 0.42),
    timberMaterial('weathered'),
    new THREE.Vector3(-1.9, 0.52, -0.15),
  );

  addTimberStock(group);
  addStoneStock(group);
  addTreasuryChest(group);
  return group;
}
