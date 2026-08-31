import * as THREE from 'three';
import {
  addMesh,
  sharedBuildingDetailMaterial,
  shingleMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';

export type KennelDogRestAnchor = Readonly<{
  slotIndex: 0 | 1 | 2 | 3;
  localPosition: readonly [number, number, number];
  localYaw: number;
}>;

export const KENNEL_DOG_REST_ANCHORS = [
  { slotIndex: 0, localPosition: [-2.55, 0.04, 0.7], localYaw: 0 },
  { slotIndex: 1, localPosition: [-0.85, 0.04, 0.7], localYaw: 0 },
  { slotIndex: 2, localPosition: [0.85, 0.04, 0.7], localYaw: 0 },
  { slotIndex: 3, localPosition: [2.55, 0.04, 0.7], localYaw: 0 },
] as const satisfies readonly KennelDogRestAnchor[];

const timber = timberMaterial('weathered');
const darkTimber = timberMaterial('dark');
const roof = shingleMaterial();
const earth = sharedBuildingDetailMaterial('earth');
const wicker = sharedBuildingDetailMaterial('wicker');

function box(
  group: THREE.Group,
  name: string,
  size: readonly [number, number, number],
  position: readonly [number, number, number],
  material: THREE.Material,
): THREE.Mesh {
  const mesh = addMesh(
    group,
    new THREE.BoxGeometry(...size),
    material,
    new THREE.Vector3(...position),
  );
  mesh.name = name;
  return mesh;
}

function addFence(group: THREE.Group): void {
  for (const x of [-3.8, -1.9, 0, 1.9, 3.8]) {
    box(group, 'Kennel yard post', [0.18, 1.18, 0.18], [x, 0.59, 3.25], darkTimber);
  }
  for (const z of [1.55, 3.25]) {
    for (const x of [-3.8, 3.8]) {
      box(group, 'Kennel side-yard post', [0.18, 1.18, 0.18], [x, 0.59, z], darkTimber);
    }
  }
  for (const y of [0.42, 0.92]) {
    box(group, 'Kennel front fence rail', [7.6, 0.13, 0.13], [0, y, 3.25], timber);
    box(group, 'Kennel left fence rail', [0.13, 0.13, 3.4], [-3.8, y, 1.55], timber);
    box(group, 'Kennel right fence rail', [0.13, 0.13, 3.4], [3.8, y, 1.55], timber);
  }
  // A visible road-facing gate opening keeps the yard readable from play height.
  box(group, 'Kennel gate left leaf', [1.45, 0.92, 0.12], [-1.95, 0.56, 3.18], wicker);
  box(group, 'Kennel gate right leaf', [1.45, 0.92, 0.12], [1.95, 0.56, 3.18], wicker);
}

/** Four-bay roadside kennel with a fenced exercise yard and deterministic dog rests. */
export function createKennelMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Kennel';
  group.userData.dogRestAnchors = KENNEL_DOG_REST_ANCHORS;

  box(group, 'Kennel packed-earth yard', [7.8, 0.08, 6.2], [0, 0.04, 0.25], earth);
  box(group, 'Kennel stone footing', [7.55, 0.32, 2.5], [0, 0.16, -1.62], stoneMaterial('mid'));
  box(group, 'Kennel timber range', [7.25, 2.35, 2.2], [0, 1.42, -1.62], timber);

  for (const x of [-2.7, -0.9, 0.9, 2.7]) {
    box(group, 'Kennel dark dog-bay opening', [1.28, 1.18, 0.08], [x, 0.94, -0.47], darkTimber);
    box(group, 'Kennel straw bed', [1.2, 0.09, 0.85], [x, 0.35, -0.9], wicker);
  }
  for (const x of [-3.6, -1.8, 0, 1.8, 3.6]) {
    box(group, 'Kennel bay pier', [0.18, 2.45, 0.25], [x, 1.45, -0.42], darkTimber);
  }

  for (const side of [-1, 1] as const) {
    const roofPlane = box(
      group,
      'Kennel shingle roof plane',
      [7.9, 0.16, 2.15],
      [0, 3.1, -1.62 + side * 0.86],
      roof,
    );
    roofPlane.rotation.x = side * 0.55;
  }
  box(group, 'Kennel roof ridge', [8.0, 0.18, 0.2], [0, 3.68, -1.62], roof);
  addFence(group);

  box(group, 'Kennel water trough', [1.55, 0.38, 0.72], [2.55, 0.27, 2.15], timber);
  for (const anchor of KENNEL_DOG_REST_ANCHORS) {
    const marker = new THREE.Group();
    marker.name = `Kennel dog rest ${anchor.slotIndex + 1}`;
    marker.position.fromArray(anchor.localPosition);
    marker.rotation.y = anchor.localYaw;
    marker.userData.kennelDogSlotIndex = anchor.slotIndex;
    group.add(marker);
  }
  return group;
}
