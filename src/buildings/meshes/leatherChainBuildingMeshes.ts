import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import {
  addBarrel,
  addCrate,
  addDarkOpening,
  addGableShell,
  addLeanToRoof,
  addPlankDoor,
  addSmallWindow,
} from './buildingMeshKit.ts';
import { addLeanToSupportFrame } from './ruralWorkshopStructureKit.ts';

const LEATHER = sharedBuildingDetailMaterial('canvas');
const DARK_LEATHER = sharedBuildingMaterial('timberDark');
const TANNIN = sharedBuildingDetailMaterial('earth');
const WATER = sharedBuildingDetailMaterial('water');

function addStockGroup(
  root: THREE.Group,
  name: string,
  segmentName: string,
  placements: readonly THREE.Vector3[],
  build: (segment: THREE.Group, index: number) => void,
): void {
  const stock = new THREE.Group();
  stock.name = name;
  stock.visible = false;
  for (const [index, position] of placements.entries()) {
    const segment = new THREE.Group();
    segment.name = segmentName;
    segment.position.copy(position);
    segment.visible = false;
    build(segment, index);
    stock.add(segment);
  }
  root.add(stock);
}

function addHideFrame(group: THREE.Group, scale = 1): void {
  for (const x of [-0.58, 0.58]) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.12 * scale, 1.55 * scale, 0.12 * scale),
      timberMaterial('dark'),
      new THREE.Vector3(x * scale, 0.78 * scale, 0),
    );
  }
  for (const y of [0.13, 1.43]) {
    addMesh(
      group,
      new THREE.BoxGeometry(1.28 * scale, 0.11 * scale, 0.11 * scale),
      timberMaterial('weathered'),
      new THREE.Vector3(0, y * scale, 0),
    );
  }
  const hide = addMesh(
    group,
    new THREE.SphereGeometry(0.54 * scale, 8, 6),
    LEATHER,
    new THREE.Vector3(0, 0.79 * scale, 0.02 * scale),
  );
  hide.scale.set(0.9, 1.15, 0.08);
  hide.name = 'Stretched untanned hide';
}

function addLeatherRoll(group: THREE.Group, scale = 1): void {
  addMesh(
    group,
    new THREE.CylinderGeometry(0.2 * scale, 0.2 * scale, 0.78 * scale, 10),
    DARK_LEATHER,
    new THREE.Vector3(0, 0.2 * scale, 0),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  for (const x of [-0.29, 0.29]) {
    addMesh(
      group,
      new THREE.TorusGeometry(0.205 * scale, 0.022 * scale, 5, 10),
      sharedBuildingDetailMaterial('wicker'),
      new THREE.Vector3(x * scale, 0.2 * scale, 0),
      new THREE.Euler(0, Math.PI * 0.5, 0),
    );
  }
}

function addShoePair(group: THREE.Group, scale = 1): void {
  for (const z of [-0.17, 0.17]) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.58 * scale, 0.16 * scale, 0.23 * scale),
      DARK_LEATHER,
      new THREE.Vector3(0.08 * scale, 0.12 * scale, z * scale),
    );
    addMesh(
      group,
      new THREE.BoxGeometry(0.24 * scale, 0.3 * scale, 0.22 * scale),
      DARK_LEATHER,
      new THREE.Vector3(-0.16 * scale, 0.26 * scale, z * scale),
    );
  }
}

function addDiagnostics(root: THREE.Group, signature: string, modules: readonly string[]): void {
  let triangleCount = 0;
  let meshCount = 0;
  const materialKeys = new Set<string>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshCount += 1;
    const geometry = object.geometry;
    triangleCount += geometry.index
      ? geometry.index.count / 3
      : (geometry.getAttribute('position')?.count ?? 0) / 3;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materialKeys.add(String(
        material.userData.buildingMaterialKey
        ?? material.userData.buildingDetailMaterialKey
        ?? material.name,
      ));
    }
  });
  root.userData.architecturePlan = {
    signature,
    modules: [...modules],
    deterministic: true,
    roadFace: 'positive-z',
    vegetationOwner: 'SeedThree',
    embeddedVegetationGeometry: false,
  };
  root.userData.architectureDiagnostics = {
    moduleCount: modules.length,
    meshCount,
    triangleCount: Math.round(triangleCount),
    materialSlotCount: materialKeys.size,
  };
  root.userData.embeddedVegetationGeometry = false;
}

/**
 * Long, low wet-work shed with the open vats and louvered drying loft that
 * make the tannery readable before any small props or UI labels are visible.
 */
export function createTanneryMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Tannery';
  const shell = addGableShell(group, {
    width: 7.1,
    depth: 4.2,
    stoneHeight: 0.58,
    wallHeight: 2.35,
    ridgeHeight: 1.75,
    wallMaterial: sharedBuildingMaterial('plasterGrey'),
    roofMaterial: sharedBuildingMaterial('shingle'),
  });

  addPlankDoor(group, -2.25, 0.58, shell.frontZ + 0.07, 1.18, 1.92);
  addSmallWindow(group, 2.35, 1.65, shell.frontZ + 0.08, 0.9, 0.9);
  addDarkOpening(group, 0.25, 3.25, shell.frontZ + 0.11, 2.85, 0.62);
  for (let x = -1.0; x <= 1.5; x += 0.5) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.1, 0.7, 0.08),
      timberMaterial('weathered'),
      new THREE.Vector3(x, 3.25, shell.frontZ + 0.2),
      new THREE.Euler(0, 0, -0.12),
    ).name = 'Drying-loft louver';
  }

  const wetYardRoof = addLeanToRoof(group, {
    width: 5.55,
    depth: 2.45,
    thickness: 0.15,
    material: sharedBuildingMaterial('shingle'),
    position: new THREE.Vector3(0, 2.22, 3.26),
    pitch: 0.16,
    highEdge: 'negativeZ',
    name: 'Deep tannery wet-yard roof',
  });
  addLeanToSupportFrame(group, wetYardRoof, {
    namePrefix: 'Tannery wet-yard',
    highEdge: 'negativeZ',
    postCount: 3,
  });

  for (const x of [-1.85, 0, 1.85]) {
    const vat = new THREE.Group();
    vat.name = 'Bark-liquor tanning vat';
    vat.position.set(x, 0, 3.42);
    group.add(vat);
    addMesh(
      vat,
      new THREE.CylinderGeometry(0.68, 0.76, 0.65, 12, 1, true),
      timberMaterial('weathered'),
      new THREE.Vector3(0, 0.34, 0),
    );
    addMesh(
      vat,
      new THREE.CylinderGeometry(0.61, 0.61, 0.05, 12),
      x === 0 ? TANNIN : WATER,
      new THREE.Vector3(0, 0.63, 0),
    );
    for (const y of [0.14, 0.52]) {
      addMesh(
        vat,
        new THREE.TorusGeometry(0.72, 0.03, 5, 12),
        metalMaterial('iron'),
        new THREE.Vector3(0, y, 0),
        new THREE.Euler(Math.PI * 0.5, 0, 0),
      );
    }
  }

  addBarrel(group, 3.82, 0.78, 0.85);
  addCrate(group, -3.9, 1.1, 0.85);
  const permanentFrame = new THREE.Group();
  permanentFrame.position.set(-4.25, 0, 3.45);
  permanentFrame.rotation.y = Math.PI * 0.5;
  addHideFrame(permanentFrame, 1.05);
  group.add(permanentFrame);

  addStockGroup(
    group,
    'HidesStock',
    'HidesStockSegment',
    [new THREE.Vector3(-4.2, 0, 1.55), new THREE.Vector3(-4.2, 0, 0), new THREE.Vector3(-4.2, 0, -1.55)],
    (segment) => {
      segment.rotation.y = Math.PI * 0.5;
      addHideFrame(segment, 0.82);
    },
  );
  addStockGroup(
    group,
    'LeatherStock',
    'LeatherStockSegment',
    [new THREE.Vector3(2.65, 0.03, 2.25), new THREE.Vector3(3.3, 0.03, 2.25), new THREE.Vector3(2.95, 0.42, 2.25)],
    (segment) => addLeatherRoll(segment, 0.9),
  );

  addDiagnostics(group, 'gorski-tannery-v1', [
    'wet-work-shed',
    'deep-yard-roof',
    'bark-liquor-vats',
    'louvered-drying-loft',
    'hide-frames',
    'typed-stock-props',
  ]);
  return group;
}

/** Compact road-facing workshop whose porch, broad window and hanging boot
 * sign distinguish it from the heavier industrial buildings. */
export function createCobblerMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Cobbler';
  const shell = addGableShell(group, {
    width: 5.15,
    depth: 4.05,
    stoneHeight: 0.62,
    wallHeight: 2.55,
    ridgeHeight: 1.82,
    wallMaterial: sharedBuildingMaterial('plasterYellow'),
    roofMaterial: sharedBuildingMaterial('shingle'),
  });
  addPlankDoor(group, -1.55, 0.62, shell.frontZ + 0.08, 1.02, 1.9);
  addSmallWindow(group, 0.95, 1.67, shell.frontZ + 0.1, 1.48, 1.15);

  const workPorchRoof = addLeanToRoof(group, {
    width: 4.85,
    depth: 1.72,
    thickness: 0.14,
    material: sharedBuildingMaterial('shingle'),
    position: new THREE.Vector3(0, 2.31, 2.65),
    pitch: 0.16,
    highEdge: 'negativeZ',
    name: 'Cobbler work porch roof',
  });
  addLeanToSupportFrame(group, workPorchRoof, {
    namePrefix: 'Cobbler work porch',
    highEdge: 'negativeZ',
  });
  addMesh(
    group,
    new THREE.BoxGeometry(1.55, 0.12, 0.62),
    timberMaterial('mid'),
    new THREE.Vector3(0.9, 0.76, 2.48),
  ).name = 'Cobbler cutting bench';
  for (const x of [0.3, 0.9, 1.5]) {
    addMesh(
      group,
      new THREE.CylinderGeometry(0.1, 0.15, 0.55, 8),
      timberMaterial('mid'),
      new THREE.Vector3(x, 1.1, 2.48),
    ).name = 'Shoe last';
  }

  const sign = new THREE.Group();
  sign.name = 'Boot-shaped cobbler sign';
  sign.position.set(2.72, 2.55, 2.35);
  group.add(sign);
  addMesh(sign, new THREE.BoxGeometry(0.72, 0.26, 0.12), DARK_LEATHER, new THREE.Vector3(0.12, -0.35, 0));
  addMesh(sign, new THREE.BoxGeometry(0.3, 0.78, 0.12), DARK_LEATHER, new THREE.Vector3(-0.1, 0.05, 0));
  addMesh(sign, new THREE.BoxGeometry(0.05, 0.65, 0.05), metalMaterial('iron'), new THREE.Vector3(0, 0.72, 0));

  addStockGroup(
    group,
    'LeatherStock',
    'LeatherStockSegment',
    [new THREE.Vector3(-2.2, 0.02, 2.48), new THREE.Vector3(-1.65, 0.02, 2.48), new THREE.Vector3(-1.95, 0.42, 2.48)],
    (segment) => addLeatherRoll(segment, 0.82),
  );
  addStockGroup(
    group,
    'ShoesStock',
    'ShoesStockSegment',
    [new THREE.Vector3(0.2, 0.78, 2.48), new THREE.Vector3(0.9, 0.78, 2.48), new THREE.Vector3(1.6, 0.78, 2.48)],
    (segment) => addShoePair(segment, 0.72),
  );

  addDiagnostics(group, 'gorski-cobbler-v1', [
    'compact-workshop',
    'deep-work-porch',
    'broad-road-window',
    'cutting-bench-and-lasts',
    'boot-trade-sign',
    'typed-stock-props',
  ]);
  return group;
}
