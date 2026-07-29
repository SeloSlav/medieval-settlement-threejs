import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';

/**
 * A compact rack of axes, picks, wedges, and hammer heads. Each bundle is a
 * direct stock segment so the shared stock visual can hide it as ironwork wears.
 */
export function createCivilianToolStockpile(
  position: THREE.Vector3,
  yaw = 0,
): THREE.Group {
  const stockpile = new THREE.Group();
  stockpile.name = 'CivilianToolStockpile';
  stockpile.position.copy(position);
  stockpile.rotation.y = yaw;
  stockpile.visible = false;

  for (let index = 0; index < 4; index++) {
    const segment = new THREE.Group();
    segment.name = 'CivilianToolSegment';
    const x = (index % 2) * 0.58 - 0.29;
    const z = Math.floor(index / 2) * 0.42 - 0.21;
    segment.position.set(x, 0, z);
    segment.rotation.y = index % 2 === 0 ? -0.16 : 0.18;

    addMesh(
      segment,
      new THREE.CylinderGeometry(0.045, 0.055, 1.12, 6),
      timberMaterial(index % 2 === 0 ? 'weathered' : 'mid'),
      new THREE.Vector3(0, 0.64, 0),
      new THREE.Euler(0, 0, index % 2 === 0 ? -0.34 : 0.31),
    );
    addMesh(
      segment,
      index % 2 === 0
        ? new THREE.BoxGeometry(0.42, 0.13, 0.16)
        : new THREE.ConeGeometry(0.16, 0.5, 4),
      metalMaterial(index % 3 === 0 ? 'steel' : 'iron'),
      new THREE.Vector3(
        index % 2 === 0 ? -0.17 : 0.16,
        1.15,
        0,
      ),
      new THREE.Euler(
        index % 2 === 0 ? 0 : Math.PI * 0.5,
        0,
        index % 2 === 0 ? -0.34 : 0.31,
      ),
    );
    stockpile.add(segment);
  }

  return stockpile;
}
