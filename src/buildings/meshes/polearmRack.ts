import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';

type StockedPolearmRackOptions = {
  x: number;
  z: number;
  width?: number;
  stockpileName: string;
  segmentName: string;
  segmentCount: number;
};

export function addStockedPolearmRack(
  group: THREE.Group,
  options: StockedPolearmRackOptions,
): void {
  const width = options.width ?? 3;
  const lowerRail = addMesh(
    group,
    new THREE.BoxGeometry(width, 0.16, 0.18),
    timberMaterial('dark'),
    new THREE.Vector3(options.x, 0.72, options.z),
  );
  lowerRail.name = 'Stocked polearm rack lower brown timber rail';
  const upperRail = addMesh(
    group,
    new THREE.BoxGeometry(width, 0.16, 0.18),
    timberMaterial('dark'),
    new THREE.Vector3(options.x, 1.64, options.z),
  );
  upperRail.name = 'Stocked polearm rack upper brown timber rail';
  for (const offset of [-width * 0.43, width * 0.43]) {
    const upright = addMesh(
      group,
      new THREE.BoxGeometry(0.16, 1.95, 0.18),
      timberMaterial('dark'),
      new THREE.Vector3(options.x + offset, 0.98, options.z),
    );
    upright.name = 'Stocked polearm rack brown timber upright';
  }

  const stockpile = new THREE.Group();
  stockpile.name = options.stockpileName;
  stockpile.visible = false;
  for (let index = 0; index < options.segmentCount; index += 1) {
    const segment = new THREE.Group();
    segment.name = options.segmentName;
    const shaftX = options.x
      - width * 0.34
      + index * (width * 0.68 / Math.max(1, options.segmentCount - 1));
    const shaft = addMesh(
      segment,
      new THREE.CylinderGeometry(0.035, 0.045, 2.45, 6),
      timberMaterial('mid'),
      new THREE.Vector3(shaftX, 1.42, options.z - 0.12),
    );
    shaft.name = 'Stocked polearm brown timber shaft';
    const head = addMesh(
      segment,
      new THREE.ConeGeometry(0.12, 0.38, 5),
      metalMaterial('iron'),
      new THREE.Vector3(shaftX, 2.81, options.z - 0.12),
    );
    head.name = 'Stocked polearm iron head';
    stockpile.add(segment);
  }
  group.add(stockpile);
}
