import * as THREE from 'three';
import { addTriangularGableWall } from '../meshPrimitives.ts';
import {
  addMesh,
  sharedBuildingMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import { addProceduralDoor, addProceduralWindow } from './facadeOpeningKit.ts';

export type GableShellOptions = {
  width: number;
  depth: number;
  stoneHeight: number;
  wallHeight: number;
  ridgeHeight: number;
  wallMaterial: THREE.Material;
  roofMaterial: THREE.Material;
  centerX?: number;
  centerZ?: number;
  stoneGroundFloor?: boolean;
};

export type GableShell = {
  width: number;
  depth: number;
  halfW: number;
  halfD: number;
  wallTop: number;
  ridgeHeight: number;
  frontZ: number;
  centerX: number;
  centerZ: number;
};

export type LeanToHighEdge = 'negativeX' | 'positiveX' | 'negativeZ' | 'positiveZ';

export type LeanToRoofOptions = {
  width: number;
  depth: number;
  thickness: number;
  material: THREE.Material;
  position: THREE.Vector3;
  pitch: number;
  highEdge: LeanToHighEdge;
  name: string;
};

/**
 * Adds a shallow attached roof with an explicit high edge.
 *
 * Lean-tos occur on every side of a building, and raw Euler signs are easy to
 * reverse: positive X rotation lowers +Z, while positive Z rotation raises +X.
 * Naming the attachment edge here keeps roofs draining away from their wall.
 */
export function addLeanToRoof(group: THREE.Group, options: LeanToRoofOptions): THREE.Mesh {
  const {
    width,
    depth,
    thickness,
    material,
    position,
    pitch,
    highEdge,
    name,
  } = options;
  const rotation = new THREE.Euler();
  switch (highEdge) {
    case 'negativeX':
      rotation.z = -Math.abs(pitch);
      break;
    case 'positiveX':
      rotation.z = Math.abs(pitch);
      break;
    case 'negativeZ':
      rotation.x = Math.abs(pitch);
      break;
    case 'positiveZ':
      rotation.x = -Math.abs(pitch);
      break;
  }

  const roof = addMesh(
    group,
    new THREE.BoxGeometry(width, thickness, depth),
    material,
    position,
    rotation,
  );
  roof.name = name;
  roof.userData.leanToHighEdge = highEdge;
  roof.userData.leanToPitch = Math.abs(pitch);
  return roof;
}

export function addGableShell(group: THREE.Group, options: GableShellOptions): GableShell {
  const {
    width,
    depth,
    stoneHeight,
    wallHeight,
    ridgeHeight,
    wallMaterial,
    roofMaterial,
    centerX = 0,
    centerZ = 0,
    stoneGroundFloor = false,
  } = options;
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const wallTop = stoneHeight + wallHeight;
  const frontZ = centerZ + halfD - 0.075;
  const roofPitch = Math.atan2(ridgeHeight, halfW);
  const slopeLen = halfW / Math.cos(roofPitch) + 0.28;

  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.38, stoneHeight, depth + 0.38),
    stoneMaterial(stoneGroundFloor ? 'mid' : 'light'),
    new THREE.Vector3(centerX, stoneHeight * 0.5, centerZ),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(width - 0.12, wallHeight, depth - 0.12),
    wallMaterial,
    new THREE.Vector3(centerX, stoneHeight + wallHeight * 0.5, centerZ),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.08, 0.14, depth + 0.08),
    stoneMaterial('mortar'),
    new THREE.Vector3(centerX, wallTop - 0.07, centerZ),
  );

  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.22, wallHeight, 0.22),
      timberMaterial('dark'),
      new THREE.Vector3(
        centerX + sx * (halfW - 0.12),
        stoneHeight + wallHeight * 0.5,
        centerZ + sz * (halfD - 0.12),
      ),
    );
  }

  for (const side of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(slopeLen, 0.13, depth + 0.48),
      roofMaterial,
      new THREE.Vector3(centerX + side * halfW * 0.46, wallTop + ridgeHeight * 0.48, centerZ),
      new THREE.Euler(0, 0, side * -roofPitch),
    );
    for (let row = 0; row < 3; row++) {
      const t = (row + 0.5) / 3.8;
      addMesh(
        group,
        new THREE.BoxGeometry(0.07, 0.055, depth + 0.5),
        roofMaterial,
        new THREE.Vector3(
          centerX + side * halfW * (1 - t),
          wallTop + ridgeHeight * t + 0.02,
          centerZ,
        ),
        new THREE.Euler(0, 0, side * -roofPitch),
      );
    }
  }

  addMesh(
    group,
    new THREE.BoxGeometry(0.24, 0.18, depth + 0.62),
    roofMaterial,
    new THREE.Vector3(centerX, wallTop + ridgeHeight + 0.035, centerZ),
  );

  for (const zSign of [-1, 1] as const) {
    addTriangularGableWall(
      group,
      'z',
      zSign * (halfD - 0.065),
      halfW,
      wallTop,
      ridgeHeight,
      0.16,
      wallMaterial,
      0,
      centerX,
      centerZ,
    );
    for (const side of [-1, 1] as const) {
      addMesh(
        group,
        new THREE.BoxGeometry(slopeLen, 0.14, 0.15),
        timberMaterial('dark'),
        new THREE.Vector3(
          centerX + side * halfW * 0.46,
          wallTop + ridgeHeight * 0.48,
          centerZ + zSign * (halfD + 0.16),
        ),
        new THREE.Euler(0, 0, side * -roofPitch),
      );
    }
  }

  return { width, depth, halfW, halfD, wallTop, ridgeHeight, frontZ, centerX, centerZ };
}

export function addPlankDoor(
  group: THREE.Group,
  x: number,
  baseY: number,
  z: number,
  width = 1.02,
  height = 1.92,
): void {
  addProceduralDoor(group, {
    position: new THREE.Vector3(x, baseY, z),
    face: z < 0 ? 'negative-z' : 'positive-z',
    width,
    height,
    namePrefix: 'Building',
  });
}

export function addDarkOpening(
  group: THREE.Group,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
): void {
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.24, height + 0.2, 0.1),
    timberMaterial('dark'),
    new THREE.Vector3(x, y, z),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(width, height, 0.12),
    sharedBuildingMaterial('interiorDark'),
    new THREE.Vector3(x, y, z + 0.07),
  );
}

export function addSmallWindow(
  group: THREE.Group,
  x: number,
  y: number,
  z: number,
  width = 0.78,
  height = 1.0,
): void {
  addProceduralWindow(group, {
    position: new THREE.Vector3(x, y, z),
    face: z < 0 ? 'negative-z' : 'positive-z',
    width,
    height,
    namePrefix: 'Building',
  });
}

export function addBarrel(group: THREE.Group, x: number, z: number, scale = 1): void {
  addMesh(
    group,
    new THREE.CylinderGeometry(0.34 * scale, 0.38 * scale, 0.72 * scale, 10),
    timberMaterial('mid'),
    new THREE.Vector3(x, 0.36 * scale, z),
  );
  for (const y of [0.14, 0.58]) {
    addMesh(
      group,
      new THREE.TorusGeometry(0.36 * scale, 0.025 * scale, 5, 10),
      timberMaterial('dark'),
      new THREE.Vector3(x, y * scale, z),
      new THREE.Euler(Math.PI * 0.5, 0, 0),
    );
  }
}

export function addCrate(group: THREE.Group, x: number, z: number, scale = 1): void {
  addMesh(
    group,
    new THREE.BoxGeometry(0.78 * scale, 0.58 * scale, 0.68 * scale),
    timberMaterial('weathered'),
    new THREE.Vector3(x, 0.29 * scale, z),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.84 * scale, 0.07 * scale, 0.08 * scale),
    timberMaterial('dark'),
    new THREE.Vector3(x, 0.42 * scale, z + 0.34 * scale),
  );
}
