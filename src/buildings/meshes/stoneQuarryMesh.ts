import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  quarryRockMaterial,
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import { addGableShell, addPlankDoor, addSmallWindow } from './buildingMeshKit.ts';
import { createCivilianToolStockpile } from './civilianToolStockpileMesh.ts';

type MiningPitCommodity = 'iron' | 'salt' | 'clay';

const IRON_ORE_DARK = metalMaterial('iron');
const IRON_ORE_OXIDE = sharedBuildingDetailMaterial('paintRed');
const SALT_ROCK_DARK = sharedBuildingMaterial('masonryMid');
const SALT_ROCK_LIGHT = sharedBuildingMaterial('masonryLight');
const CLAY_DARK = sharedBuildingDetailMaterial('earth');
const CLAY_LIGHT = sharedBuildingDetailMaterial('paintOchre');

function addCutBlockStack(
  group: THREE.Group,
  x: number,
  z: number,
  rotation = 0,
): void {
  const stack = new THREE.Group();
  stack.name = 'StoneQuarryStockSegment';
  stack.position.set(x, 0, z);
  stack.rotation.y = rotation;
  const blocks = [
    [-0.68, 0.28, 0],
    [0.68, 0.28, 0],
    [0, 0.84, 0],
  ] as const;
  for (let i = 0; i < blocks.length; i++) {
    const [bx, by, bz] = blocks[i];
    addMesh(
      stack,
      new THREE.BoxGeometry(1.15, i === 2 ? 0.5 : 0.56, 1.5),
      quarryRockMaterial(i === 2 ? 'light' : i === 1 ? 'dark' : 'mid'),
      new THREE.Vector3(bx, by, bz),
      new THREE.Euler(0, (i - 1) * 0.025, 0),
    );
  }
  group.add(stack);
}

function createStoneStockpile(): THREE.Group {
  const stockpile = new THREE.Group();
  stockpile.name = 'StoneQuarryStockpile';
  stockpile.visible = false;
  addCutBlockStack(stockpile, -7.45, -6.55, 0.05);
  addCutBlockStack(stockpile, -5.95, -6.55, -0.04);
  addCutBlockStack(stockpile, -4.45, -6.55, 0.08);
  return stockpile;
}

function commodityStockpileNames(commodity: MiningPitCommodity): {
  container: string;
  segment: string;
  item: string;
} {
  if (commodity === 'iron') {
    return {
      container: 'MiningPitIronStockpile',
      segment: 'MiningPitIronSegment',
      item: 'Mining pit iron-ore lump',
    };
  }
  if (commodity === 'salt') {
    return {
      container: 'MiningPitSaltStockpile',
      segment: 'MiningPitSaltSegment',
      item: 'Mining pit salt-rock lump',
    };
  }
  return {
    container: 'MiningPitClayStockpile',
    segment: 'MiningPitClaySegment',
    item: 'Mining pit clay lump',
  };
}

function commodityStockpilePositions(
  commodity: MiningPitCommodity,
): readonly (readonly [number, number, number])[] {
  if (commodity === 'iron') {
    return [
      [4.45, -6.55, -0.08],
      [5.95, -6.55, 0.04],
      [7.45, -6.55, -0.05],
    ];
  }
  if (commodity === 'salt') {
    return [
      [-8.1, -2.15, 0.04],
      [-8.1, -0.2, -0.08],
      [-8.1, 1.75, 0.06],
    ];
  }
  return [
    [8.15, -2.15, -0.05],
    [8.15, -0.2, 0.07],
    [8.15, 1.75, -0.08],
  ];
}

function commodityStockpileMaterials(
  commodity: MiningPitCommodity,
): readonly [THREE.Material, THREE.Material] {
  if (commodity === 'iron') return [IRON_ORE_DARK, IRON_ORE_OXIDE];
  if (commodity === 'salt') return [SALT_ROCK_DARK, SALT_ROCK_LIGHT];
  return [CLAY_DARK, CLAY_LIGHT];
}

function createCommodityStockpile(commodity: MiningPitCommodity): THREE.Group {
  const names = commodityStockpileNames(commodity);
  const materials = commodityStockpileMaterials(commodity);
  const stockpile = new THREE.Group();
  stockpile.name = names.container;
  stockpile.visible = false;

  commodityStockpilePositions(commodity).forEach(([x, z, rotation], segmentIndex) => {
    const segment = new THREE.Group();
    segment.name = names.segment;
    segment.visible = false;
    segment.position.set(x, 0, z);
    segment.rotation.y = rotation;

    for (let itemIndex = 0; itemIndex < 5; itemIndex += 1) {
      const angle = itemIndex / 5 * Math.PI * 2;
      const geometry = commodity === 'clay'
        ? new THREE.SphereGeometry(0.48 + (itemIndex % 2) * 0.07, 8, 5)
        : new THREE.DodecahedronGeometry(0.42 + (itemIndex % 3) * 0.08, 0);
      const item = addMesh(
        segment,
        geometry,
        materials[(itemIndex + segmentIndex) % 3 === 0 ? 0 : 1],
        new THREE.Vector3(
          Math.cos(angle) * 0.58,
          0.34 + (itemIndex === 4 ? 0.46 : 0),
          Math.sin(angle) * 0.45,
        ),
        new THREE.Euler(itemIndex * 0.19, angle, segmentIndex * 0.08),
        commodity === 'clay'
          ? new THREE.Vector3(1.22, 0.66, 1.02)
          : new THREE.Vector3(1.12, 0.78, 0.96),
      );
      item.name = names.item;
    }
    stockpile.add(segment);
  });
  return stockpile;
}

function addRubble(group: THREE.Group): void {
  const pieces = [
    [-7.7, -6.7, 1.2, 0.9], [-6.2, -7.5, 0.85, 1.15], [-4.6, -7.15, 1.0, 0.7],
    [-8.4, -4.8, 0.75, 0.85], [-7.1, -3.8, 1.1, 0.8], [-8.55, -2.15, 0.7, 1.0],
    [7.8, -6.9, 0.9, 0.75], [8.45, -5.15, 1.15, 0.9], [7.75, -3.35, 0.72, 0.82],
    [-7.9, 6.9, 0.8, 1.0], [-6.2, 7.6, 1.05, 0.7], [7.4, 7.25, 0.9, 1.1],
  ] as const;
  for (let i = 0; i < pieces.length; i++) {
    const [x, z, sx, sz] = pieces[i];
    addMesh(
      group,
      new THREE.DodecahedronGeometry(0.72, 0),
      quarryRockMaterial(i % 3 === 0 ? 'light' : i % 2 === 0 ? 'dark' : 'mid'),
      new THREE.Vector3(x, 0.3 + (i % 2) * 0.08, z),
      new THREE.Euler(i * 0.19, i * 0.31, i * 0.11),
      new THREE.Vector3(sx, 0.68 + (i % 3) * 0.12, sz),
    );
  }
}

function addDerrick(group: THREE.Group): void {
  const timber = timberMaterial('dark');
  for (const x of [-2.15, 2.15]) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.28, 6.35, 0.28),
      timber,
      new THREE.Vector3(x, 3.08, 0),
      new THREE.Euler(0, 0, x < 0 ? -0.34 : 0.34),
    );
  }
  addMesh(
    group,
    new THREE.BoxGeometry(5.05, 0.32, 0.32),
    timberMaterial('weathered'),
    new THREE.Vector3(0, 5.88, 0),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.24, 0.24, 5.75),
    timberMaterial('weathered'),
    new THREE.Vector3(0, 5.74, 2.48),
    new THREE.Euler(-0.09, 0, 0),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(0.3, 0.3, 0.34, 12),
    metalMaterial('iron'),
    new THREE.Vector3(0, 5.48, 4.95),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(0.035, 0.035, 3.8, 6),
    metalMaterial('iron'),
    new THREE.Vector3(0, 3.45, 4.95),
  );
  addMesh(
    group,
    new THREE.TorusGeometry(0.24, 0.055, 6, 12),
    metalMaterial('iron'),
    new THREE.Vector3(0, 1.5, 4.95),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(1.1, 0.75, 1.42),
    quarryRockMaterial('cut'),
    new THREE.Vector3(0, 0.75, 4.95),
    new THREE.Euler(0, 0.06, 0),
  );
}

function addStonecuttersShelter(group: THREE.Group): void {
  const shelter = new THREE.Group();
  shelter.position.set(-5.7, 0, 4.7);
  shelter.rotation.y = -0.07;
  const shell = addGableShell(shelter, {
    width: 5.55,
    depth: 4.25,
    stoneHeight: 0.52,
    wallHeight: 2.25,
    ridgeHeight: 1.7,
    wallMaterial: stoneMaterial('light'),
    roofMaterial: sharedBuildingMaterial('slate'),
  });
  addPlankDoor(shelter, -0.9, 0.56, shell.frontZ + 0.02, 0.88, 1.72);
  addSmallWindow(shelter, 1.08, 1.48, shell.frontZ + 0.02, 0.7, 0.78);
  group.add(shelter);
}

function addStonecuttingBench(group: THREE.Group): void {
  addMesh(
    group,
    new THREE.BoxGeometry(3.2, 0.28, 1.25),
    timberMaterial('weathered'),
    new THREE.Vector3(5.75, 0.92, 4.8),
  );
  for (const x of [4.55, 6.95]) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.24, 1.02, 0.92),
      timberMaterial('dark'),
      new THREE.Vector3(x, 0.5, 4.8),
    );
  }
  for (let i = 0; i < 3; i++) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.09, 1.35, 0.09),
      metalMaterial('steel'),
      new THREE.Vector3(5.15 + i * 0.55, 1.62, 4.75),
      new THREE.Euler(0, 0, -0.52 + i * 0.09),
    );
  }

  const samples = [
    ['stone', quarryRockMaterial('mid')],
    ['iron', IRON_ORE_OXIDE],
    ['salt', SALT_ROCK_LIGHT],
    ['clay', CLAY_LIGHT],
  ] as const;
  samples.forEach(([commodity, material], index) => {
    const sample = addMesh(
      group,
      commodity === 'clay'
        ? new THREE.SphereGeometry(0.22, 8, 5)
        : new THREE.DodecahedronGeometry(0.22, 0),
      material,
      new THREE.Vector3(4.65 + index * 0.72, 1.17, 4.43),
      new THREE.Euler(index * 0.13, index * 0.52, -index * 0.07),
      commodity === 'clay'
        ? new THREE.Vector3(1.2, 0.7, 1)
        : undefined,
    );
    sample.name = `Mining pit ${commodity} sorting sample`;
  });
}

/** Open surface-extraction yard for finite stone, iron, salt, and clay deposits. */
export function createStoneQuarryMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Mining Pit';
  group.userData.semanticRole = 'general-surface-extraction';
  group.userData.extractionResources = ['stone', 'iron', 'salt', 'clay'];
  group.userData.silhouette = 'open-yard-derrick';
  addRubble(group);
  addDerrick(group);
  addStonecuttersShelter(group);
  addStonecuttingBench(group);
  group.add(createStoneStockpile());
  group.add(createCommodityStockpile('iron'));
  group.add(createCommodityStockpile('salt'));
  group.add(createCommodityStockpile('clay'));
  group.add(createCivilianToolStockpile(new THREE.Vector3(3.65, 0, 5.4), -0.08));
  return group;
}
