import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  residenceFacadeMaterial,
  sharedBuildingDetailMaterial,
  shingleMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import {
  addGableShell,
  addHippedRoof,
  addLeanToRoof,
  addPlankDoor,
  addSmallWindow,
} from './buildingMeshKit.ts';
import {
  HAYLOFT_VISUAL_SEGMENTS,
  PASTORAL_SALT_VISUAL_SEGMENTS,
  WOOL_STOCKPILE_VISUAL_SEGMENTS,
} from '../buildingStockpileVisuals.ts';
import { createManureStockpile } from './manureStockpileMesh.ts';

const earth = sharedBuildingDetailMaterial('earth');
const storedFodderCover = sharedBuildingDetailMaterial('canvas');
const storedFodderBinding = sharedBuildingDetailMaterial('wicker');

function createBareManureStockpile(
  name: string,
  x: number,
  z: number,
): THREE.Group {
  const stockpile = createManureStockpile(name, x, z);
  stockpile.traverse((object) => {
    if (!(object instanceof THREE.Group) || object.name !== 'ManureStockSegment') return;
    for (const child of [...object.children]) {
      if (child instanceof THREE.Mesh && child.material !== earth) object.remove(child);
    }
  });
  return stockpile;
}

function addFenceRun(
  group: THREE.Group,
  x: number,
  z: number,
  length: number,
  alongX: boolean,
): void {
  const posts = Math.max(2, Math.ceil(length / 2.2));
  for (let i = 0; i <= posts; i++) {
    const offset = (i / posts - 0.5) * length;
    addMesh(
      group,
      new THREE.CylinderGeometry(0.1, 0.13, 1.45, 6),
      timberMaterial('dark'),
      new THREE.Vector3(x + (alongX ? offset : 0), 0.72, z + (alongX ? 0 : offset)),
      new THREE.Euler(0, 0, i % 2 ? 0.035 : -0.025),
    );
  }
  for (const y of [0.48, 1.04]) {
    addMesh(
      group,
      new THREE.BoxGeometry(alongX ? length : 0.12, 0.12, alongX ? 0.12 : length),
      timberMaterial('weathered'),
      new THREE.Vector3(x, y, z),
    );
  }
}

function addTrough(group: THREE.Group, x: number, z: number, length = 2.8): void {
  addMesh(group, new THREE.BoxGeometry(length, 0.18, 0.9), timberMaterial('dark'), new THREE.Vector3(x, 0.38, z));
  addMesh(group, new THREE.BoxGeometry(length - 0.25, 0.12, 0.54), earth, new THREE.Vector3(x, 0.53, z));
  for (const end of [-1, 1]) {
    addMesh(group, new THREE.BoxGeometry(0.18, 0.48, 1.0), timberMaterial('weathered'), new THREE.Vector3(x + end * length * 0.48, 0.35, z));
  }
}

function createHayloftStockpile(): THREE.Group {
  const stockpile = new THREE.Group();
  stockpile.name = 'HayloftStockpile';
  stockpile.position.set(-4.5, 0, -4.25);
  stockpile.visible = false;

  for (let index = 0; index < HAYLOFT_VISUAL_SEGMENTS; index++) {
    const layer = Math.floor(index / 2);
    const column = index % 2;
    const segment = new THREE.Group();
    segment.name = 'HayStockSegment';
    segment.position.set(
      (column === 0 ? -0.34 : 0.34) * (1 - layer * 0.035),
      1.08 + layer * 0.27,
      0,
    );
    segment.rotation.set(
      0,
      (column === 0 ? -1 : 1) * (0.08 + layer * 0.014),
      (column === 0 ? 1 : -1) * 0.035,
    );
    const coveredBale = addMesh(
      segment,
      new THREE.BoxGeometry(0.72, 0.34, 0.58),
      storedFodderCover,
      new THREE.Vector3(),
      new THREE.Euler(
        (column === 0 ? -1 : 1) * 0.08,
        layer * 0.17,
        (column === 0 ? 1 : -1) * 0.06,
      ),
      new THREE.Vector3(0.94 - layer * 0.025, 1, 0.9),
    );
    coveredBale.name = 'Covered fodder bale';
    for (const [x, yaw] of [[-0.16, -0.24], [0.15, 0.31]] as const) {
      const binding = addMesh(
        segment,
        new THREE.BoxGeometry(0.045, 0.38, 0.61),
        storedFodderBinding,
        new THREE.Vector3(x, 0, 0),
        new THREE.Euler(0, yaw * 0.08, 0),
      );
      binding.name = 'Covered fodder bale binding';
    }
    stockpile.add(segment);
  }
  return stockpile;
}

function createWoolStockpile(): THREE.Group {
  const stockpile = new THREE.Group();
  stockpile.name = 'WoolStockpile';
  stockpile.position.set(-1.6, 0, 4.0);
  stockpile.visible = false;
  for (let index = 0; index < WOOL_STOCKPILE_VISUAL_SEGMENTS; index++) {
    const segment = new THREE.Group();
    segment.name = 'WoolStockSegment';
    const column = index % 2;
    const layer = Math.floor(index / 2);
    segment.position.set((column - 0.5) * 0.82, 0.36 + layer * 0.52, 0);
    addMesh(
      segment,
      new THREE.DodecahedronGeometry(0.48, 1),
      residenceFacadeMaterial(index % 2 === 0 ? 'white' : 'grey'),
      new THREE.Vector3(),
      new THREE.Euler(0.08, index * 0.29, column ? 0.06 : -0.05),
      new THREE.Vector3(1, 0.72, 0.88),
    );
    addMesh(
      segment,
      new THREE.TorusGeometry(0.35, 0.025, 5, 10),
      sharedBuildingDetailMaterial('wicker'),
      new THREE.Vector3(0, 0, 0),
      new THREE.Euler(Math.PI * 0.5, 0, 0),
    );
    stockpile.add(segment);
  }
  return stockpile;
}

function createPastoralSaltStockpile(): THREE.Group {
  const stockpile = new THREE.Group();
  stockpile.name = 'PastoralSaltStockpile';
  stockpile.visible = false;

  const placements = [
    [1.65, 4.02, 1],
    [2.2, 4.12, 0.86],
    [1.92, 3.58, 0.73],
  ] as const;
  for (
    let index = 0;
    index < Math.min(PASTORAL_SALT_VISUAL_SEGMENTS, placements.length);
    index += 1
  ) {
    const [x, z, scale] = placements[index];
    const segment = new THREE.Group();
    segment.name = 'PastoralSaltSegment';
    segment.visible = false;
    segment.position.set(x, 0, z);
    const sack = addMesh(
      segment,
      new THREE.SphereGeometry(0.32 * scale, 8, 6),
      residenceFacadeMaterial('white'),
      new THREE.Vector3(0, 0.33 * scale, 0),
      new THREE.Euler(0, index * 0.23, index % 2 === 0 ? -0.07 : 0.06),
      new THREE.Vector3(0.84, 1.22, 0.8),
    );
    sack.name = 'Farmstead salt sack';
    addMesh(
      segment,
      new THREE.CylinderGeometry(0.055 * scale, 0.11 * scale, 0.16 * scale, 7),
      sharedBuildingDetailMaterial('wicker'),
      new THREE.Vector3(0, 0.74 * scale, 0),
    );
    stockpile.add(segment);
  }
  return stockpile;
}

export function createPastoralFarmsteadMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Pastoral farmstead';
  const shell = addGableShell(group, {
    width: 9.6,
    depth: 6.4,
    stoneHeight: 0.85,
    wallHeight: 2.85,
    ridgeHeight: 2.35,
    wallMaterial: residenceFacadeMaterial('white'),
    roofMaterial: shingleMaterial(),
    centerX: -1.8,
  });
  addPlankDoor(group, -3.8, 0.9, shell.frontZ + 0.03, 1.05, 1.9);
  addSmallWindow(group, -0.8, 2.05, shell.frontZ + 0.03, 0.72, 0.86);

  // Deep open byre under a lean-to roof: immediately separates this from the crop farmstead.
  for (const z of [-2.6, 2.6]) {
    addMesh(group, new THREE.BoxGeometry(0.2, 2.55, 0.2), timberMaterial('dark'), new THREE.Vector3(5.2, 1.28, z));
  }
  addLeanToRoof(group, {
    width: 4.8,
    depth: 6.2,
    thickness: 0.16,
    material: shingleMaterial(),
    position: new THREE.Vector3(3.8, 2.78, 0),
    pitch: 0.17,
    highEdge: 'negativeX',
    name: 'Pastoral farmstead byre roof',
  });
  addMesh(group, new THREE.BoxGeometry(3.2, 0.18, 5.4), earth, new THREE.Vector3(3.65, 0.1, 0));
  addTrough(group, 3.7, 0, 3.2);

  // Hayrack and churns communicate dairy/fodder rather than grain processing.
  for (const x of [-5.2, -3.8]) {
    addMesh(group, new THREE.BoxGeometry(0.14, 2.0, 0.14), timberMaterial('dark'), new THREE.Vector3(x, 1.0, -4.25));
  }
  for (let i = 0; i < 6; i++) {
    addMesh(group, new THREE.CylinderGeometry(0.05, 0.05, 2.0, 5), timberMaterial('weathered'), new THREE.Vector3(-4.5 + (i - 2.5) * 0.26, 1.02, -4.25), new THREE.Euler(0, 0, 0.3));
  }
  group.add(createHayloftStockpile());
  group.add(createWoolStockpile());
  group.add(createPastoralSaltStockpile());
  group.add(createBareManureStockpile('PastoralManureStockpile', 5.45, -3.65));
  for (const [x, scale] of [[-0.2, 1], [0.65, 0.78]] as const) {
    addMesh(group, new THREE.CylinderGeometry(0.3 * scale, 0.36 * scale, 0.82 * scale, 10), metalMaterial('iron'), new THREE.Vector3(x, 0.42 * scale, 4.0));
    addMesh(group, new THREE.TorusGeometry(0.22 * scale, 0.035, 5, 10), metalMaterial('steel'), new THREE.Vector3(x, 0.9 * scale, 4.0), new THREE.Euler(Math.PI * 0.5, 0, 0));
  }
  addFenceRun(group, 3.7, 4.7, 7.6, true);
  return group;
}

export function createSwineherdMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Woodland swineherd';
  const shell = addGableShell(group, {
    width: 6.2,
    depth: 4.8,
    stoneHeight: 0.45,
    wallHeight: 1.95,
    ridgeHeight: 1.65,
    wallMaterial: timberMaterial('weathered'),
    roofMaterial: shingleMaterial(),
    centerX: -1.6,
  });
  addPlankDoor(group, -2.5, 0.48, shell.frontZ + 0.03, 0.82, 1.45);
  addSmallWindow(group, -0.5, 1.42, shell.frontZ + 0.03, 0.55, 0.58);

  // Low sleeping sty with a broad fenced gate into woodland pannage.
  addMesh(group, new THREE.BoxGeometry(4.7, 1.25, 3.1), timberMaterial('dark'), new THREE.Vector3(3.6, 0.65, -0.4));
  addHippedRoof(group, {
    width: 5.25,
    depth: 3.65,
    eaveY: 1.225,
    peakY: 2.375,
    thickness: 0.1,
    material: shingleMaterial(),
    centerX: 3.6,
    centerZ: -0.4,
    name: 'Swineherd joined sleeping-sty roof',
  });
  addMesh(group, new THREE.BoxGeometry(1.7, 1.0, 0.12), timberMaterial('dark'), new THREE.Vector3(3.6, 0.62, 1.18));
  addTrough(group, 2.6, 3.2, 3.0);
  addFenceRun(group, 1.3, 5.0, 8.8, true);
  addFenceRun(group, 6.0, 3.0, 4.0, false);

  // Mast baskets and a rough stone wash trough reinforce the forest-seasonal identity.
  for (const [x, z] of [[-4.3, 3.4], [-3.5, 3.7]] as const) {
    addMesh(group, new THREE.CylinderGeometry(0.34, 0.43, 0.75, 9), sharedBuildingDetailMaterial('wicker'), new THREE.Vector3(x, 0.38, z));
    for (let band = 0; band < 3; band++) {
      addMesh(group, new THREE.TorusGeometry(0.38 - band * 0.025, 0.025, 4, 10), sharedBuildingDetailMaterial('wicker'), new THREE.Vector3(x, 0.2 + band * 0.23, z), new THREE.Euler(Math.PI * 0.5, 0, 0));
    }
  }
  addMesh(group, new THREE.BoxGeometry(2.1, 0.52, 1.0), stoneMaterial('mortar'), new THREE.Vector3(-4.0, 0.28, -3.4));
  addMesh(group, new THREE.BoxGeometry(1.65, 0.12, 0.55), sharedBuildingDetailMaterial('water'), new THREE.Vector3(-4.0, 0.57, -3.4));
  return group;
}
