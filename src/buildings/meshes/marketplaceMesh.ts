import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  stoneMaterial,
  tileMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import { addTriangularGableWall } from '../meshPrimitives.ts';
import { addBarrel, addCrate } from './buildingMeshKit.ts';

export const MARKET_STAGING_VISUAL_SEGMENTS = 5;

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
  addMesh(
    chest,
    new THREE.BoxGeometry(0.92, 0.52, 0.62),
    timberMaterial('dark'),
    new THREE.Vector3(0, 0.28, 0),
  );
  addMesh(
    chest,
    new THREE.CylinderGeometry(0.31, 0.31, 0.92, 8, 1, false, 0, Math.PI),
    timberMaterial('weathered'),
    new THREE.Vector3(0, 0.57, 0),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  addMesh(
    chest,
    new THREE.BoxGeometry(0.09, 0.58, 0.67),
    metalMaterial('iron'),
    new THREE.Vector3(0, 0.38, 0),
  );
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
  addCrate(group, 2.65, 1.45, 0.86);
  addCrate(group, 2.8, 0.55, 0.72);
  addBarrel(group, -2.8, 1.45, 0.88);
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
