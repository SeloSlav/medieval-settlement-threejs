import * as THREE from 'three';
import { addMesh, timberMaterial } from './buildingMaterials.ts';

export const FIREWOOD_LOG_MESH_ID = 'gorski-split-firewood-billet-v1';
export const FIREWOOD_LOG_LENGTH = 0.86;
export const FIREWOOD_LOG_RADIUS = 0.12;

export type FirewoodPilePlacement = readonly [
  x: number,
  y: number,
  z: number,
  yaw: number,
];

const FIREWOOD_LOG_GEOMETRY = new THREE.CylinderGeometry(
  FIREWOOD_LOG_RADIUS * 0.93,
  FIREWOOD_LOG_RADIUS * 1.05,
  FIREWOOD_LOG_LENGTH,
  7,
);
FIREWOOD_LOG_GEOMETRY.name = 'Shared split firewood billet';
FIREWOOD_LOG_GEOMETRY.userData.firewoodMeshId = FIREWOOD_LOG_MESH_ID;

export function sharedFirewoodLogGeometry(): THREE.CylinderGeometry {
  return FIREWOOD_LOG_GEOMETRY;
}

export function addSharedFirewoodLog(
  parent: THREE.Group,
  name: string,
  position: THREE.Vector3,
  axis: 'x' | 'z' = 'x',
  shade: 'weathered' | 'mid' = 'weathered',
): THREE.Mesh {
  const mesh = addMesh(
    parent,
    FIREWOOD_LOG_GEOMETRY,
    timberMaterial(shade),
    position,
    axis === 'x'
      ? new THREE.Euler(0, 0, Math.PI * 0.5)
      : new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  mesh.name = name;
  mesh.userData.firewoodMeshId = FIREWOOD_LOG_MESH_ID;
  return mesh;
}

/**
 * Emit a stable triangular pile from the shared short-billet mesh. The pile
 * grows from a broad ground row, so inventory reveal order never floats logs.
 */
export function addSharedFirewoodPile(
  parent: THREE.Group,
  baseX: number,
  baseZ: number,
  floorY: number,
  pileRows: number,
  namePrefix = 'Split firewood billet',
): THREE.Mesh[] {
  const logs: THREE.Mesh[] = [];
  const logSpacing = FIREWOOD_LOG_RADIUS * 1.72;
  const rowSpacing = FIREWOOD_LOG_RADIUS * 1.82;
  for (let row = 0; row < pileRows; row += 1) {
    const logsInRow = pileRows - row;
    const rowY = floorY + FIREWOOD_LOG_RADIUS + row * rowSpacing;
    const rowSpan = (logsInRow - 1) * logSpacing;
    for (let column = 0; column < logsInRow; column += 1) {
      logs.push(addSharedFirewoodLog(
        parent,
        `${namePrefix} ${logs.length + 1}`,
        new THREE.Vector3(
          baseX,
          rowY,
          baseZ - rowSpan * 0.5 + column * logSpacing,
        ),
        'x',
        (row + column) % 2 === 0 ? 'weathered' : 'mid',
      ));
    }
  }
  return logs;
}

/** Quantity-addressable firewood groups used by production/storage markers. */
export function addSegmentedFirewoodStockpile(
  parent: THREE.Group,
  containerName: string,
  segmentName: string,
  placements: readonly FirewoodPilePlacement[],
  pileRows = 2,
): THREE.Group {
  const stockpile = new THREE.Group();
  stockpile.name = containerName;
  stockpile.visible = false;
  stockpile.userData.firewoodMeshId = FIREWOOD_LOG_MESH_ID;
  for (const [x, y, z, yaw] of placements) {
    const segment = new THREE.Group();
    segment.name = segmentName;
    segment.position.set(x, y, z);
    segment.rotation.y = yaw;
    segment.visible = false;
    segment.userData.firewoodMeshId = FIREWOOD_LOG_MESH_ID;
    addSharedFirewoodPile(segment, 0, 0, 0, pileRows, `${segmentName} billet`);
    stockpile.add(segment);
  }
  parent.add(stockpile);
  return stockpile;
}
