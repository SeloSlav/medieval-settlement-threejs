import * as THREE from 'three';
import { addMesh, timberMaterial } from './buildingMaterials.ts';

export function addLogPile(
  group: THREE.Group,
  baseX: number,
  baseZ: number,
  floorY: number,
  pileRows: number,
  logLength: number,
  logRadius: number,
): void {
  const logSpacing = logRadius * 1.72;
  const rowSpacing = logRadius * 1.82;
  const logGeometry = new THREE.CylinderGeometry(
    logRadius * 0.93,
    logRadius * 1.05,
    logLength,
    8,
  );

  for (let row = 0; row < pileRows; row++) {
    const logsInRow = pileRows - row;
    const rowY = floorY + logRadius + row * rowSpacing;
    const rowSpan = (logsInRow - 1) * logSpacing;
    for (let col = 0; col < logsInRow; col++) {
      addMesh(
        group,
        logGeometry,
        (row + col) % 2 === 0 ? timberMaterial('weathered') : timberMaterial('mid'),
        new THREE.Vector3(baseX, rowY, baseZ - rowSpan * 0.5 + col * logSpacing),
        new THREE.Euler(0, 0, Math.PI * 0.5),
      );
    }
  }
}
