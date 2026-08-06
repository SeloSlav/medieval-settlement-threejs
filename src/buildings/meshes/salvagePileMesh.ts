import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import {
  SALVAGE_GOODS_VISUAL_SEGMENTS,
  SALVAGE_STONE_VISUAL_SEGMENTS,
  SALVAGE_TIMBER_VISUAL_SEGMENTS,
} from '../buildingStockpileVisuals.ts';

function addTimberSalvage(parent: THREE.Group): void {
  const stockpile = new THREE.Group();
  stockpile.name = 'SalvageTimberStockpile';
  for (let index = 0; index < SALVAGE_TIMBER_VISUAL_SEGMENTS; index += 1) {
    const segment = new THREE.Group();
    segment.name = 'SalvageTimberSegment';
    const row = Math.floor(index / 3);
    const column = index % 3;
    segment.position.set(-3.4 + column * 0.72, 0, -1.65 + row * 0.58);
    for (let log = 0; log < 2; log += 1) {
      addMesh(
        segment,
        new THREE.CylinderGeometry(0.15, 0.18, 2.6 - index * 0.06, 7),
        timberMaterial((index + log) % 2 === 0 ? 'weathered' : 'mid'),
        new THREE.Vector3(0, 0.2 + log * 0.28, 0),
        new THREE.Euler(0, 0, Math.PI * 0.5 + (index % 2) * 0.08),
      );
    }
    stockpile.add(segment);
  }
  parent.add(stockpile);
}

function addStoneSalvage(parent: THREE.Group): void {
  const stockpile = new THREE.Group();
  stockpile.name = 'SalvageStoneStockpile';
  for (let index = 0; index < SALVAGE_STONE_VISUAL_SEGMENTS; index += 1) {
    const stone = addMesh(
      stockpile,
      new THREE.DodecahedronGeometry(0.42 + (index % 2) * 0.12, 0),
      stoneMaterial(index % 3 === 0 ? 'light' : 'mid'),
      new THREE.Vector3(
        2.2 + (index % 3) * 0.72,
        0.35 + Math.floor(index / 3) * 0.45,
        -1.7 + (index % 2) * 0.22,
      ),
      new THREE.Euler(index * 0.31, index * 0.47, index * 0.19),
    );
    stone.name = 'SalvageStoneSegment';
  }
  parent.add(stockpile);
}

function addCratedSalvage(parent: THREE.Group): void {
  const goods = new THREE.Group();
  goods.name = 'SalvageCratedGoods';
  for (let index = 0; index < SALVAGE_GOODS_VISUAL_SEGMENTS; index += 1) {
    const segment = new THREE.Group();
    segment.name = 'SalvageGoodsSegment';
    const x = -2.25 + index * 0.9;
    const z = 2.05 + (index % 2) * 0.28;
    if (index % 2 === 0) {
      addMesh(
        segment,
        new THREE.BoxGeometry(0.74, 0.65, 0.72),
        timberMaterial('weathered'),
        new THREE.Vector3(x, 0.36, z),
        new THREE.Euler(0, index * 0.11, 0),
      );
    } else {
      addMesh(
        segment,
        new THREE.CylinderGeometry(0.33, 0.3, 0.82, 10),
        timberMaterial('mid'),
        new THREE.Vector3(x, 0.43, z),
      );
    }
    goods.add(segment);
  }
  parent.add(goods);
}

function addBrokenStructure(parent: THREE.Group): void {
  for (const [index, beam] of [
    [-0.7, 0.92, 0.22],
    [0.15, 1.08, -0.18],
    [0.95, 0.78, 0.31],
  ].entries()) {
    addMesh(
      parent,
      new THREE.BoxGeometry(3.1 - index * 0.25, 0.24, 0.28),
      timberMaterial(index % 2 === 0 ? 'dark' : 'weathered'),
      new THREE.Vector3(beam[0], beam[1], beam[2]),
      new THREE.Euler(0.08 * index, 0.35 + index * 0.44, 0.16 - index * 0.1),
    );
  }
}

function addTreasuryChest(parent: THREE.Group): void {
  const chest = new THREE.Group();
  chest.name = 'SalvageTreasuryChest';
  addMesh(
    chest,
    new THREE.BoxGeometry(1.05, 0.58, 0.68),
    timberMaterial('dark'),
    new THREE.Vector3(3.25, 0.34, 2.0),
  );
  addMesh(
    chest,
    new THREE.CylinderGeometry(0.34, 0.34, 1.05, 8, 1, false, 0, Math.PI),
    timberMaterial('weathered'),
    new THREE.Vector3(3.25, 0.67, 2.0),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  addMesh(
    chest,
    new THREE.BoxGeometry(0.1, 0.62, 0.72),
    metalMaterial('iron'),
    new THREE.Vector3(3.25, 0.45, 2.0),
  );
  parent.add(chest);
}

export function createSalvagePileMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Physical reclamation pile';

  addBrokenStructure(group);
  addTimberSalvage(group);
  addStoneSalvage(group);
  addCratedSalvage(group);
  addTreasuryChest(group);
  return group;
}
