import * as THREE from 'three';
import { addMesh, shingleMaterial, stoneMaterial, timberMaterial } from '../buildings/buildingMaterials.ts';
import { MAIN_HOUSE_DEPTH, MAIN_HOUSE_WIDTH } from './burgageLayout.ts';

const WINDOW_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x2a3540,
  roughness: 0.35,
  metalness: 0.05,
  emissive: 0x1a2530,
  emissiveIntensity: 0.15,
});

function addGableWall(
  group: THREE.Group,
  planeZ: number,
  halfSpan: number,
  wallTop: number,
  ridgeHeight: number,
  material: THREE.Material,
  faceSign: 1 | -1,
): void {
  const span = halfSpan - 0.08;
  const shape = new THREE.Shape();
  shape.moveTo(-span, 0);
  shape.lineTo(span, 0);
  shape.lineTo(0, ridgeHeight);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false });
  geometry.translate(0, wallTop, faceSign > 0 ? planeZ : planeZ - 0.18);
  if (faceSign < 0) geometry.rotateY(Math.PI);
  addMesh(group, geometry, material, new THREE.Vector3(0, 0, 0));
}

function addWindow(
  group: THREE.Group,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
): void {
  addMesh(
    group,
    new THREE.BoxGeometry(width, height, 0.1),
    WINDOW_MATERIAL,
    new THREE.Vector3(x, y, z),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.14, height + 0.14, 0.05),
    timberMaterial('dark'),
    new THREE.Vector3(x, y, z - 0.03),
  );
}

export function createResidenceMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Residence';

  const width = MAIN_HOUSE_WIDTH;
  const depth = MAIN_HOUSE_DEPTH;
  const stoneHeight = 0.95;
  const storeyHeight = 2.55;
  const wallHeight = storeyHeight * 2;
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const wallTop = stoneHeight + wallHeight;
  const ridgeHeight = 2.85;
  const roofPitch = Math.atan2(ridgeHeight, halfW);
  const slopeLen = halfW / Math.cos(roofPitch) + 0.22;
  const frontZ = halfD - 0.1;

  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.34, stoneHeight, depth + 0.34),
    stoneMaterial('light'),
    new THREE.Vector3(0, stoneHeight * 0.5, 0),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.08, 0.14, depth + 0.08),
    stoneMaterial('mortar'),
    new THREE.Vector3(0, stoneHeight + 0.07, 0),
  );

  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.36, wallHeight + 0.1, 0.36),
      stoneMaterial('mid'),
      new THREE.Vector3(sx * (halfW - 0.12), stoneHeight + (wallHeight + 0.1) * 0.5, sz * (halfD - 0.12)),
    );
  }

  addMesh(
    group,
    new THREE.BoxGeometry(width - 0.28, wallHeight, depth - 0.28),
    timberMaterial('mid'),
    new THREE.Vector3(0, stoneHeight + wallHeight * 0.5, 0),
  );

  const floorY = stoneHeight + storeyHeight;
  addMesh(
    group,
    new THREE.BoxGeometry(width - 0.34, 0.12, depth - 0.34),
    timberMaterial('dark'),
    new THREE.Vector3(0, floorY, 0),
  );

  addWindow(group, -1.55, stoneHeight + storeyHeight * 0.55, frontZ, 1.05, 1.35);
  addWindow(group, 1.55, stoneHeight + storeyHeight * 0.55, frontZ, 1.05, 1.35);
  addWindow(group, -1.55, stoneHeight + storeyHeight + storeyHeight * 0.55, frontZ, 1.0, 1.25);
  addWindow(group, 1.55, stoneHeight + storeyHeight + storeyHeight * 0.55, frontZ, 1.0, 1.25);
  addWindow(group, -halfW + 0.1, stoneHeight + storeyHeight * 0.55, 0, 0.1, 1.2);
  addWindow(group, -halfW + 0.1, stoneHeight + storeyHeight + storeyHeight * 0.5, 0, 0.1, 1.15);
  addWindow(group, halfW - 0.1, stoneHeight + storeyHeight * 0.55, 0, 0.1, 1.2);
  addWindow(group, halfW - 0.1, stoneHeight + storeyHeight + storeyHeight * 0.5, 0, 0.1, 1.15);

  const doorWidth = 1.2;
  const doorHeight = 2.1;
  addMesh(
    group,
    new THREE.BoxGeometry(doorWidth, doorHeight, 0.14),
    timberMaterial('dark'),
    new THREE.Vector3(0, stoneHeight + doorHeight * 0.5, frontZ),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(doorWidth + 0.18, doorHeight + 0.12, 0.08),
    timberMaterial('weathered'),
    new THREE.Vector3(0, stoneHeight + doorHeight * 0.5 + 0.06, frontZ - 0.04),
  );

  addMesh(
    group,
    new THREE.BoxGeometry(width - 0.5, 0.14, depth - 0.5),
    timberMaterial('light'),
    new THREE.Vector3(0, wallTop - 0.06, 0),
  );

  addMesh(
    group,
    new THREE.BoxGeometry(0.16, 0.16, depth - 0.2),
    timberMaterial('dark'),
    new THREE.Vector3(0, wallTop + ridgeHeight, 0),
  );

  for (const side of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(slopeLen, 0.13, depth + 0.36),
      shingleMaterial(),
      new THREE.Vector3(side * halfW * 0.46, wallTop + ridgeHeight * 0.48, 0),
      new THREE.Euler(0, 0, side * -roofPitch),
    );
  }

  addGableWall(group, halfD - 0.08, halfW, wallTop, ridgeHeight, timberMaterial('mid'), 1);
  addGableWall(group, -halfD + 0.08, halfW, wallTop, ridgeHeight, timberMaterial('mid'), -1);

  addMesh(
    group,
    new THREE.BoxGeometry(0.82, 2.6, 0.82),
    stoneMaterial('mid'),
    new THREE.Vector3(halfW - 1.25, wallTop + 1.15, -halfD + 1.35),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.92, 0.2, 0.92),
    stoneMaterial('light'),
    new THREE.Vector3(halfW - 1.25, wallTop + 2.55, -halfD + 1.35),
  );

  return group;
}

export class ResidenceMarkers {
  private readonly root: THREE.Group;
  private readonly meshes = new Map<string, THREE.Group>();

  constructor(parent: THREE.Group) {
    this.root = new THREE.Group();
    this.root.name = 'Residences';
    parent.add(this.root);
  }

  syncResidences(
    residences: Iterable<{
      id: string;
      x: number;
      z: number;
      yaw: number;
    }>,
    getHeightAt: (x: number, z: number) => number,
  ): void {
    const nextIds = new Set<string>();
    for (const residence of residences) {
      nextIds.add(residence.id);
      let marker = this.meshes.get(residence.id);
      if (!marker) {
        marker = createResidenceMesh();
        this.root.add(marker);
        this.meshes.set(residence.id, marker);
      }
      const y = getHeightAt(residence.x, residence.z);
      marker.position.set(residence.x, y, residence.z);
      marker.rotation.y = residence.yaw;
    }

    for (const [id, marker] of this.meshes) {
      if (nextIds.has(id)) continue;
      this.root.remove(marker);
      disposeGroup(marker);
      this.meshes.delete(id);
    }
  }

  dispose(): void {
    for (const marker of this.meshes.values()) {
      disposeGroup(marker);
    }
    this.meshes.clear();
    this.root.removeFromParent();
  }
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const material = child.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material.dispose();
    }
  });
}
