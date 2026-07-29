import * as THREE from 'three';
import {
  addMesh,
  sharedBuildingDetailMaterial,
} from '../buildingMaterials.ts';

export const MANURE_STOCKPILE_VISUAL_SEGMENTS = 4;
export const MANURE_STOCK_SEGMENT_NAME = 'ManureStockSegment';

const manure = sharedBuildingDetailMaterial('earth');
const bedding = sharedBuildingDetailMaterial('crop');

export function createManureStockpile(
  name: string,
  x: number,
  z: number,
): THREE.Group {
  const stockpile = new THREE.Group();
  stockpile.name = name;
  stockpile.position.set(x, 0, z);
  stockpile.visible = false;

  for (let index = 0; index < MANURE_STOCKPILE_VISUAL_SEGMENTS; index += 1) {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const segment = new THREE.Group();
    segment.name = MANURE_STOCK_SEGMENT_NAME;
    segment.position.set(
      (column === 0 ? -0.42 : 0.42) + row * 0.08,
      0,
      (row === 0 ? -0.32 : 0.34),
    );
    addMesh(
      segment,
      new THREE.DodecahedronGeometry(0.48, 1),
      manure,
      new THREE.Vector3(0, 0.3, 0),
      new THREE.Euler(0.03, index * 0.43, index % 2 === 0 ? 0.04 : -0.03),
      new THREE.Vector3(1.18, 0.62, 0.96),
    );
    for (let straw = 0; straw < 3; straw += 1) {
      addMesh(
        segment,
        new THREE.CylinderGeometry(0.012, 0.016, 0.55, 5),
        bedding,
        new THREE.Vector3((straw - 1) * 0.16, 0.54 + straw * 0.025, 0),
        new THREE.Euler(0.08, index * 0.31 + straw * 0.6, Math.PI * 0.5),
      );
    }
    stockpile.add(segment);
  }
  return stockpile;
}
