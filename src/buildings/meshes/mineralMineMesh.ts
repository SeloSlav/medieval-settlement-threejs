import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  sharedBuildingMaterial,
  sharedBuildingDetailMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import { createLargeQuarryMesh } from './largeQuarryMesh.ts';

const IRON_DARK = metalMaterial('iron');
const IRON_OXIDE = sharedBuildingDetailMaterial('paintRed');
const SALT_DARK = sharedBuildingMaterial('masonryMid');
const SALT_LIGHT = sharedBuildingMaterial('masonryLight');

/**
 * A compact mineral working. It shares the proven hand-winch structure of the
 * deep stone quarry while the sorting floor, chute, tubs, and inventory-driven
 * iron or salt piles give it a distinct and readable production state.
 */
export function createMineralMineMesh(): THREE.Group {
  const group = createLargeQuarryMesh();
  group.name = 'Mineral Mine';

  const stoneStock = group.getObjectByName('LargeQuarryStockpile');
  if (stoneStock) stoneStock.name = 'MineralMineUnusedStoneStockpile';

  addOreSortingFloor(group);
  addMineralStockpile(group, 'iron');
  addMineralStockpile(group, 'salt');
  return group;
}

function addOreSortingFloor(group: THREE.Group): void {
  const floor = new THREE.Group();
  floor.name = 'Mineral mine sorting floor';
  floor.position.set(-7.3, 0, 4.1);
  floor.rotation.y = 0.18;

  addMesh(
    floor,
    new THREE.BoxGeometry(5.8, 0.22, 2.8),
    timberMaterial('weathered'),
    new THREE.Vector3(0, 0.62, 0),
  );
  for (const x of [-2.55, -0.85, 0.85, 2.55]) {
    addMesh(
      floor,
      new THREE.BoxGeometry(0.22, 1.15, 0.22),
      timberMaterial('dark'),
      new THREE.Vector3(x, 0.25, 0),
    );
  }

  const chute = addMesh(
    floor,
    new THREE.BoxGeometry(1.55, 0.26, 5.2),
    timberMaterial('mid'),
    new THREE.Vector3(2.25, 1.42, -1.25),
    new THREE.Euler(-0.28, 0.08, 0),
  );
  chute.name = 'Mineral mine hand-sorting chute';

  for (const x of [-1.7, 0, 1.7]) {
    const tub = addMesh(
      floor,
      new THREE.CylinderGeometry(0.62, 0.5, 0.72, 10, 1, true),
      timberMaterial('mid'),
      new THREE.Vector3(x, 1.08, 0.38),
    );
    tub.name = 'Mineral mine sorting tub';
  }
  group.add(floor);
}

function addMineralStockpile(
  group: THREE.Group,
  resource: 'iron' | 'salt',
): void {
  const stockpile = new THREE.Group();
  const isIron = resource === 'iron';
  stockpile.name = isIron ? 'IronMineStockpile' : 'SaltMineStockpile';
  stockpile.visible = false;

  const positions = [
    [7.4, -5.7],
    [8.7, -4.5],
    [9.5, -2.9],
    [8.3, 4.6],
    [9.6, 3.2],
    [7.1, 5.8],
  ] as const;
  positions.forEach(([x, z], segmentIndex) => {
    const segment = new THREE.Group();
    segment.name = isIron ? 'IronMineOreSegment' : 'SaltMineSaltSegment';
    segment.visible = false;
    segment.position.set(x, 0, z);
    segment.rotation.y = segmentIndex * 0.57;
    for (let index = 0; index < 5; index++) {
      const angle = index / 5 * Math.PI * 2;
      const ore = addMesh(
        segment,
        new THREE.DodecahedronGeometry(0.46 + (index % 3) * 0.09, 0),
        (index + segmentIndex) % 3 === 0
          ? (isIron ? IRON_DARK : SALT_DARK)
          : (isIron ? IRON_OXIDE : SALT_LIGHT),
        new THREE.Vector3(
          Math.cos(angle) * 0.62,
          0.36 + (index === 4 ? 0.48 : 0),
          Math.sin(angle) * 0.48,
        ),
        new THREE.Euler(index * 0.23, angle, segmentIndex * 0.11),
        new THREE.Vector3(1.18, 0.76, 0.96),
      );
      ore.name = isIron ? 'Sorted iron ore' : 'Sorted salt rock';
    }
    stockpile.add(segment);
  });
  group.add(stockpile);
}
