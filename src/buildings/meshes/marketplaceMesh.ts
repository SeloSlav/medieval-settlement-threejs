import * as THREE from 'three';
import { STOREHOUSE_HAUL_PER_WORKER } from '../../generated/gameBalance.ts';
import {
  addMesh,
  metalMaterial,
  residenceFacadeMaterial,
  stoneMaterial,
  tileMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import {
  MARKET_ALE_VISUAL_SEGMENTS,
  MARKET_CLOTH_VISUAL_SEGMENTS,
  MARKET_HONEY_VISUAL_SEGMENTS,
  MARKET_WINE_VISUAL_SEGMENTS,
} from '../marketplaceSpecialtyStockpileVisuals.ts';
import { addTriangularGableWall } from '../meshPrimitives.ts';
import { addBarrel, addCrate } from './buildingMeshKit.ts';

export const MARKET_STAGING_VISUAL_SEGMENTS = 5;
export const MARKET_RECEIPT_VISUAL_SEGMENTS = 3;
export const MARKET_RECEIPT_VISUAL_CAPACITY =
  STOREHOUSE_HAUL_PER_WORKER * MARKET_RECEIPT_VISUAL_SEGMENTS;

function addMarketTable(group: THREE.Group, x: number, z: number, rotation = 0): void {
  const table = new THREE.Group();
  table.position.set(x, 0, z);
  table.rotation.y = rotation;
  addMesh(
    table,
    new THREE.BoxGeometry(2.0, 0.16, 0.86),
    timberMaterial('light'),
    new THREE.Vector3(0, 0.98, 0),
  );
  for (const px of [-0.72, 0.72]) {
    for (const pz of [-0.27, 0.27]) {
      addMesh(
        table,
        new THREE.BoxGeometry(0.13, 0.9, 0.13),
        timberMaterial('dark'),
        new THREE.Vector3(px, 0.48, pz),
      );
    }
  }
  group.add(table);
}

type MarketStockPlacement = readonly [
  x: number,
  y: number,
  z: number,
  scale: number,
];

function addMarketSpecialtyStock(
  group: THREE.Group,
  containerName: string,
  segmentName: string,
  placements: readonly MarketStockPlacement[],
  addSegment: (segment: THREE.Group, scale: number, index: number) => void,
): void {
  const stockpile = new THREE.Group();
  stockpile.name = containerName;
  stockpile.visible = false;
  for (const [index, [x, y, z, scale]] of placements.entries()) {
    const segment = new THREE.Group();
    segment.name = segmentName;
    segment.visible = false;
    segment.position.set(x, y, z);
    addSegment(segment, scale, index);
    stockpile.add(segment);
  }
  group.add(stockpile);
}

function addHoneyJarPair(group: THREE.Group, scale: number): void {
  addMesh(
    group,
    new THREE.BoxGeometry(0.52 * scale, 0.07 * scale, 0.3 * scale),
    timberMaterial('light'),
    new THREE.Vector3(0, 0.035 * scale, 0),
  );
  for (const x of [-0.13, 0.13]) {
    addMesh(
      group,
      new THREE.CylinderGeometry(0.14 * scale, 0.19 * scale, 0.4 * scale, 9),
      residenceFacadeMaterial('yellow'),
      new THREE.Vector3(x * scale, 0.27 * scale, 0),
    );
    addMesh(
      group,
      new THREE.TorusGeometry(0.11 * scale, 0.022 * scale, 4, 9),
      timberMaterial('dark'),
      new THREE.Vector3(x * scale, 0.48 * scale, 0),
      new THREE.Euler(Math.PI * 0.5, 0, 0),
    );
  }
}

function addWineCask(group: THREE.Group, scale: number): void {
  addMesh(
    group,
    new THREE.CylinderGeometry(0.3 * scale, 0.3 * scale, 0.68 * scale, 10),
    timberMaterial('mid'),
    new THREE.Vector3(0, 0.32 * scale, 0),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  for (const x of [-0.25, 0.25]) {
    addMesh(
      group,
      new THREE.TorusGeometry(0.3 * scale, 0.022 * scale, 5, 10),
      timberMaterial('dark'),
      new THREE.Vector3(x * scale, 0.32 * scale, 0),
      new THREE.Euler(0, Math.PI * 0.5, 0),
    );
  }
  addMesh(
    group,
    new THREE.CylinderGeometry(0.055 * scale, 0.055 * scale, 0.045 * scale, 8),
    tileMaterial(1),
    new THREE.Vector3(0, 0.625 * scale, 0),
  );
}

function addFoldedCloth(group: THREE.Group, scale: number, variant: number): void {
  const clothMaterial = variant % 3 === 0
    ? residenceFacadeMaterial('grey')
    : variant % 3 === 1
      ? residenceFacadeMaterial('lightOrange')
      : residenceFacadeMaterial('yellow');
  for (let layer = 0; layer < 2; layer += 1) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.58 * scale, 0.14 * scale, 0.42 * scale),
      clothMaterial,
      new THREE.Vector3(
        (layer === 0 ? -0.04 : 0.04) * scale,
        (0.08 + layer * 0.14) * scale,
        0,
      ),
      new THREE.Euler(0, layer === 0 ? -0.08 : 0.07, 0),
    );
  }
  addMesh(
    group,
    new THREE.BoxGeometry(0.07 * scale, 0.31 * scale, 0.46 * scale),
    timberMaterial('dark'),
    new THREE.Vector3(0, 0.15 * scale, 0),
  );
}

function addMarketSpecialtyStalls(group: THREE.Group): void {
  addMarketSpecialtyStock(
    group,
    'MarketAleStockpile',
    'MarketAleSegment',
    ([
      [-3.0, 0, 1.45, 0.9],
      [-2.35, 0, 1.42, 0.78],
      [-3.15, 0, 0.78, 0.7],
    ] as const).slice(0, MARKET_ALE_VISUAL_SEGMENTS),
    (segment, scale) => addBarrel(segment, 0, 0, scale),
  );
  addMarketSpecialtyStock(
    group,
    'MarketHoneyStockpile',
    'MarketHoneySegment',
    ([
      [-2.05, 0, 3.02, 1.35],
      [-1.58, 0, 3.08, 1.2],
      [-1.13, 0, 3.0, 1.05],
    ] as const).slice(0, MARKET_HONEY_VISUAL_SEGMENTS),
    (segment, scale) => addHoneyJarPair(segment, scale),
  );
  addMarketSpecialtyStock(
    group,
    'MarketWineStockpile',
    'MarketWineSegment',
    ([
      [2.75, 0, 1.5, 1],
      [2.08, 0, 1.45, 0.88],
      [3.0, 0, 0.82, 0.78],
    ] as const).slice(0, MARKET_WINE_VISUAL_SEGMENTS),
    (segment, scale) => addWineCask(segment, scale),
  );
  addMarketSpecialtyStock(
    group,
    'MarketClothStockpile',
    'MarketClothSegment',
    ([
      [1.02, 0, 3.0, 1.4],
      [1.68, 0, 3.08, 1.24],
      [2.3, 0, 3.0, 1.08],
    ] as const).slice(0, MARKET_CLOTH_VISUAL_SEGMENTS),
    (segment, scale, index) => addFoldedCloth(segment, scale, index),
  );
}

function addMarketStagingStock(group: THREE.Group): void {
  const timber = new THREE.Group();
  timber.name = 'MarketTimberStaging';
  timber.position.set(-4.55, 0.1, 1.25);
  for (let index = 0; index < MARKET_STAGING_VISUAL_SEGMENTS; index++) {
    const beam = addMesh(
      timber,
      new THREE.BoxGeometry(2.15, 0.18, 0.2),
      timberMaterial(index % 2 === 0 ? 'weathered' : 'dark'),
      new THREE.Vector3(
        0,
        0.12 + Math.floor(index / 2) * 0.2,
        (index % 2) * 0.26,
      ),
    );
    beam.name = `MarketTimberStageSegment${index}`;
    beam.visible = false;
  }
  group.add(timber);

  const stone = new THREE.Group();
  stone.name = 'MarketStoneStaging';
  stone.position.set(4.5, 0.1, -1.25);
  for (let index = 0; index < MARKET_STAGING_VISUAL_SEGMENTS; index++) {
    const block = addMesh(
      stone,
      new THREE.BoxGeometry(0.58, 0.38, 0.5),
      stoneMaterial(index % 2 === 0 ? 'mid' : 'light'),
      new THREE.Vector3(
        (index % 3) * 0.54 - 0.54,
        0.2 + Math.floor(index / 3) * 0.36,
        (index % 2) * 0.18,
      ),
      new THREE.Euler(0, (index % 3 - 1) * 0.08, 0),
    );
    block.name = `MarketStoneStageSegment${index}`;
    block.visible = false;
  }
  group.add(stone);

  const crates = new THREE.Group();
  crates.name = 'MarketCratedGoodsStaging';
  crates.position.set(4.5, 0, 1.25);
  for (let index = 0; index < MARKET_STAGING_VISUAL_SEGMENTS; index++) {
    const crate = new THREE.Group();
    crate.name = `MarketCratedStageSegment${index}`;
    crate.visible = false;
    crate.position.set(
      (index % 2) * 0.7 - 0.35,
      Math.floor(index / 4) * 0.62,
      Math.floor(index / 2) % 2 * 0.72,
    );
    addCrate(crate, 0, 0, index % 2 === 0 ? 0.62 : 0.54);
    crates.add(crate);
  }
  group.add(crates);
}

function addMarketProceedsChest(group: THREE.Group): void {
  const chest = new THREE.Group();
  chest.name = 'MarketProceedsChest';
  chest.visible = false;
  chest.position.set(2.6, 0.25, -1.45);
  for (let index = 0; index < MARKET_RECEIPT_VISUAL_SEGMENTS; index += 1) {
    const segment = new THREE.Group();
    segment.name = 'MarketReceiptSegment';
    segment.visible = false;
    const [x, y, z] = [
      [0, 0.08, 0.1],
      [-0.62, 0, 0],
      [0.62, 0, 0],
    ][index];
    segment.position.set(x, y, z);
    addMesh(
      segment,
      new THREE.BoxGeometry(0.58, 0.4, 0.48),
      timberMaterial(index === 1 ? 'weathered' : 'dark'),
      new THREE.Vector3(0, 0.22, 0),
    );
    addMesh(
      segment,
      new THREE.CylinderGeometry(0.24, 0.24, 0.58, 8, 1, false, 0, Math.PI),
      timberMaterial('weathered'),
      new THREE.Vector3(0, 0.45, 0),
      new THREE.Euler(0, 0, Math.PI * 0.5),
    );
    addMesh(
      segment,
      new THREE.BoxGeometry(0.065, 0.46, 0.52),
      metalMaterial('iron'),
      new THREE.Vector3(0, 0.3, 0),
    );
    chest.add(segment);
  }
  group.add(chest);
}

/** Open Croatian market loggia: a permanent civic roof, not a carnival tent. */
export function createMarketplaceMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Marketplace';
  const width = 7.55;
  const depth = 5.35;
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const floorY = 0.24;
  const wallTop = 3.15;
  const ridgeHeight = 2.05;
  const pitch = Math.atan2(ridgeHeight, halfW);
  const slope = halfW / Math.cos(pitch) + 0.3;

  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.55, floorY, depth + 0.55),
    stoneMaterial('light'),
    new THREE.Vector3(0, floorY * 0.5, 0),
  );
  for (const z of [-halfD + 0.28, halfD - 0.28]) {
    addMesh(
      group,
      new THREE.BoxGeometry(width - 0.3, 0.24, 0.42),
      stoneMaterial('mid'),
      new THREE.Vector3(0, 0.36, z),
    );
  }

  for (const x of [-halfW + 0.38, 0, halfW - 0.38]) {
    for (const z of [-halfD + 0.3, halfD - 0.3]) {
      addMesh(
        group,
        new THREE.BoxGeometry(0.28, wallTop - floorY, 0.28),
        timberMaterial('dark'),
        new THREE.Vector3(x, floorY + (wallTop - floorY) * 0.5, z),
      );
      addMesh(
        group,
        new THREE.BoxGeometry(0.5, 0.18, 0.5),
        stoneMaterial('light'),
        new THREE.Vector3(x, floorY + 0.09, z),
      );
    }
  }
  for (const z of [-halfD + 0.3, halfD - 0.3]) {
    addMesh(
      group,
      new THREE.BoxGeometry(width - 0.32, 0.2, 0.22),
      timberMaterial('weathered'),
      new THREE.Vector3(0, wallTop - 0.08, z),
    );
  }

  for (const side of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(slope, 0.14, depth + 0.58),
      tileMaterial(side > 0 ? 0 : 1),
      new THREE.Vector3(side * halfW * 0.46, wallTop + ridgeHeight * 0.48, 0),
      new THREE.Euler(0, 0, side * -pitch),
    );
    for (let row = 0; row < 4; row++) {
      const t = (row + 0.5) / 4.8;
      addMesh(
        group,
        new THREE.BoxGeometry(0.07, 0.055, depth + 0.6),
        tileMaterial(row % 2 === 0 ? 0 : 1),
        new THREE.Vector3(side * halfW * (1 - t), wallTop + ridgeHeight * t + 0.02, 0),
        new THREE.Euler(0, 0, side * -pitch),
      );
    }
  }
  addMesh(
    group,
    new THREE.BoxGeometry(0.24, 0.18, depth + 0.72),
    tileMaterial(2),
    new THREE.Vector3(0, wallTop + ridgeHeight + 0.04, 0),
  );
  for (const zSign of [-1, 1] as const) {
    addTriangularGableWall(
      group,
      'z',
      zSign * (halfD - 0.05),
      halfW,
      wallTop,
      ridgeHeight,
      0.14,
      timberMaterial('weathered'),
    );
  }

  addMarketTable(group, -1.95, -0.65);
  addMarketTable(group, 1.15, -0.65);
  addMarketTable(group, -0.45, 1.15);
  addMarketSpecialtyStalls(group);
  addMarketStagingStock(group);
  addMarketProceedsChest(group);

  // A simple hanging steelyard gives the open loggia a strong trade silhouette.
  addMesh(
    group,
    new THREE.BoxGeometry(1.55, 0.08, 0.08),
    metalMaterial('iron'),
    new THREE.Vector3(0, 2.55, halfD - 0.22),
    new THREE.Euler(0, 0, 0.08),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(0.022, 0.022, 0.72, 6),
    metalMaterial('iron'),
    new THREE.Vector3(0.48, 2.18, halfD - 0.22),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(0.34, 0.28, 0.08, 12),
    metalMaterial('iron'),
    new THREE.Vector3(0.48, 1.8, halfD - 0.22),
  );
  return group;
}
