import * as THREE from 'three';
import {
  addMesh,
  sharedBuildingDetailMaterial,
  shingleMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';

export type StableOxRestAnchor = Readonly<{
  id: `stable-ox-rest-${1 | 2 | 3}`;
  slotIndex: 0 | 1 | 2;
  /** Local building-space position; local +Z is the road-facing entrance. */
  localPosition: readonly [x: number, y: number, z: number];
  /** Oxen face the rear mangers while resting, ready to turn toward local +Z. */
  localYaw: number;
}>;

const STABLE_BAY_CENTERS_X = [-3, 0, 3] as const;

/**
 * Stable simulation and presentation share these three authored rest slots.
 * Keep them as plain serializable data so dynamic ox visuals do not need to
 * inspect or retain the statically batched building mesh.
 */
export const STABLE_OX_REST_ANCHORS = [
  {
    id: 'stable-ox-rest-1',
    slotIndex: 0,
    localPosition: [STABLE_BAY_CENTERS_X[0], 0.08, 0.35],
    localYaw: Math.PI,
  },
  {
    id: 'stable-ox-rest-2',
    slotIndex: 1,
    localPosition: [STABLE_BAY_CENTERS_X[1], 0.08, 0.35],
    localYaw: Math.PI,
  },
  {
    id: 'stable-ox-rest-3',
    slotIndex: 2,
    localPosition: [STABLE_BAY_CENTERS_X[2], 0.08, 0.35],
    localYaw: Math.PI,
  },
] as const satisfies readonly StableOxRestAnchor[];

export type StableArchitecturePlan = Readonly<{
  typology: 'three-bay-open-ox-stable';
  bayCount: 3;
  bayCentersX: readonly [-3, 0, 3];
  roadFacingSide: 'positive-z';
  oxRestAnchorIds: readonly [
    'stable-ox-rest-1',
    'stable-ox-rest-2',
    'stable-ox-rest-3',
  ];
  diagnostics: Readonly<{
    overlappingBayPairs: readonly string[];
    duplicateAnchorIds: readonly string[];
    outOfBoundsAnchorIds: readonly string[];
    misalignedAnchorIds: readonly string[];
    minimumAnchorSpacing: number;
  }>;
}>;

function compileStablePlanDiagnostics(): StableArchitecturePlan['diagnostics'] {
  const seenIds = new Set<string>();
  const duplicateAnchorIds: string[] = [];
  const outOfBoundsAnchorIds: string[] = [];
  const misalignedAnchorIds: string[] = [];
  const overlappingBayPairs: string[] = [];
  let minimumAnchorSpacing = Number.POSITIVE_INFINITY;

  for (const anchor of STABLE_OX_REST_ANCHORS) {
    if (seenIds.has(anchor.id)) duplicateAnchorIds.push(anchor.id);
    seenIds.add(anchor.id);
    const [x, , z] = anchor.localPosition;
    if (Math.abs(x) > 4.35 || z < -1.15 || z > 1.35) {
      outOfBoundsAnchorIds.push(anchor.id);
    }
    if (Math.abs(x - STABLE_BAY_CENTERS_X[anchor.slotIndex]) > 1e-6) {
      misalignedAnchorIds.push(anchor.id);
    }
  }

  for (let left = 0; left < STABLE_OX_REST_ANCHORS.length; left += 1) {
    for (let right = left + 1; right < STABLE_OX_REST_ANCHORS.length; right += 1) {
      const leftAnchor = STABLE_OX_REST_ANCHORS[left]!;
      const rightAnchor = STABLE_OX_REST_ANCHORS[right]!;
      const distance = Math.hypot(
        leftAnchor.localPosition[0] - rightAnchor.localPosition[0],
        leftAnchor.localPosition[2] - rightAnchor.localPosition[2],
      );
      minimumAnchorSpacing = Math.min(minimumAnchorSpacing, distance);
      if (distance < 2.4) {
        overlappingBayPairs.push(`${leftAnchor.id}/${rightAnchor.id}`);
      }
    }
  }

  return {
    overlappingBayPairs,
    duplicateAnchorIds,
    outOfBoundsAnchorIds,
    misalignedAnchorIds,
    minimumAnchorSpacing,
  };
}

/** Semantic plan retained on the mesh for lineup/debug validation. */
export const STABLE_ARCHITECTURE_PLAN: StableArchitecturePlan = {
  typology: 'three-bay-open-ox-stable',
  bayCount: 3,
  bayCentersX: STABLE_BAY_CENTERS_X,
  roadFacingSide: 'positive-z',
  oxRestAnchorIds: [
    'stable-ox-rest-1',
    'stable-ox-rest-2',
    'stable-ox-rest-3',
  ],
  diagnostics: compileStablePlanDiagnostics(),
};

const STABLE_WIDTH = 10.2;
const STABLE_HALF_WIDTH = STABLE_WIDTH * 0.5;
const POST_LINE_Z = 2.2;
const EAVE_HEIGHT = 3.25;
const RIDGE_RISE = 2.25;
const RIDGE_HEIGHT = EAVE_HEIGHT + RIDGE_RISE;
const ROOF_PITCH = Math.atan2(RIDGE_RISE, POST_LINE_Z + 0.48);
const ROOF_SLOPE_LENGTH = (POST_LINE_Z + 0.48) / Math.cos(ROOF_PITCH) + 0.24;
const POST_X = [-4.5, -1.5, 1.5, 4.5] as const;

const timberDark = timberMaterial('dark');
const timberWeathered = timberMaterial('weathered');
const timberLight = timberMaterial('light');
const roof = shingleMaterial();
const earth = sharedBuildingDetailMaterial('earth');

function addNamedMesh(
  group: THREE.Group,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: THREE.Vector3,
  rotation = new THREE.Euler(),
): THREE.Mesh {
  const mesh = addMesh(group, geometry, material, position, rotation);
  mesh.name = name;
  return mesh;
}

function addSquareBeamBetween(
  group: THREE.Group,
  name: string,
  start: THREE.Vector3,
  end: THREE.Vector3,
  thickness: number,
  material: THREE.Material,
): THREE.Mesh {
  const delta = end.clone().sub(start);
  const beam = addNamedMesh(
    group,
    name,
    new THREE.BoxGeometry(thickness, delta.length(), thickness),
    material,
    start.clone().add(end).multiplyScalar(0.5),
  );
  beam.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    delta.normalize(),
  );
  return beam;
}

function addPostFrame(group: THREE.Group): void {
  for (const x of POST_X) {
    for (const z of [-POST_LINE_Z, POST_LINE_Z] as const) {
      addNamedMesh(
        group,
        'Stable limestone post footing',
        new THREE.BoxGeometry(0.48, 0.3, 0.48),
        stoneMaterial('mid'),
        new THREE.Vector3(x, 0.15, z),
      );
      addNamedMesh(
        group,
        'Stable oak post',
        new THREE.BoxGeometry(0.25, EAVE_HEIGHT - 0.18, 0.25),
        timberDark,
        new THREE.Vector3(x, EAVE_HEIGHT * 0.5 + 0.1, z),
      );
    }
  }

  for (const z of [-POST_LINE_Z, POST_LINE_Z] as const) {
    addNamedMesh(
      group,
      'Stable eave plate',
      new THREE.BoxGeometry(STABLE_WIDTH - 0.7, 0.24, 0.28),
      timberDark,
      new THREE.Vector3(0, EAVE_HEIGHT, z),
    );
    for (const bayLeft of [-4.5, -1.5, 1.5] as const) {
      addSquareBeamBetween(
        group,
        'Stable knee brace',
        new THREE.Vector3(bayLeft + 0.08, EAVE_HEIGHT - 1.05, z),
        new THREE.Vector3(bayLeft + 0.78, EAVE_HEIGHT - 0.1, z),
        0.15,
        timberWeathered,
      );
      addSquareBeamBetween(
        group,
        'Stable knee brace',
        new THREE.Vector3(bayLeft + 2.92, EAVE_HEIGHT - 1.05, z),
        new THREE.Vector3(bayLeft + 2.22, EAVE_HEIGHT - 0.1, z),
        0.15,
        timberWeathered,
      );
    }
  }
}

function addRoofFrame(group: THREE.Group): void {
  for (const side of [-1, 1] as const) {
    addNamedMesh(
      group,
      'Stable shingle roof plane',
      new THREE.BoxGeometry(STABLE_WIDTH + 0.62, 0.16, ROOF_SLOPE_LENGTH),
      roof,
      new THREE.Vector3(
        0,
        EAVE_HEIGHT + RIDGE_RISE * 0.5,
        side * (POST_LINE_Z + 0.48) * 0.5,
      ),
      new THREE.Euler(side * ROOF_PITCH, 0, 0),
    );
    for (let row = 0; row < 4; row += 1) {
      const t = (row + 0.6) / 4.6;
      addNamedMesh(
        group,
        'Stable shingle course',
        new THREE.BoxGeometry(STABLE_WIDTH + 0.66, 0.045, 0.07),
        roof,
        new THREE.Vector3(
          0,
          EAVE_HEIGHT + RIDGE_RISE * t + 0.035,
          side * (POST_LINE_Z + 0.48) * (1 - t),
        ),
        new THREE.Euler(side * ROOF_PITCH, 0, 0),
      );
    }
  }
  addNamedMesh(
    group,
    'Stable roof ridge',
    new THREE.BoxGeometry(STABLE_WIDTH + 0.78, 0.2, 0.25),
    roof,
    new THREE.Vector3(0, RIDGE_HEIGHT + 0.03, 0),
  );

  for (const x of [-STABLE_HALF_WIDTH + 0.28, STABLE_HALF_WIDTH - 0.28] as const) {
    addNamedMesh(
      group,
      'Stable gable tie',
      new THREE.BoxGeometry(0.2, 0.2, POST_LINE_Z * 2 + 0.2),
      timberDark,
      new THREE.Vector3(x, EAVE_HEIGHT, 0),
    );
    addSquareBeamBetween(
      group,
      'Stable gable rafter',
      new THREE.Vector3(x, EAVE_HEIGHT, -POST_LINE_Z),
      new THREE.Vector3(x, RIDGE_HEIGHT, 0),
      0.16,
      timberDark,
    );
    addSquareBeamBetween(
      group,
      'Stable gable rafter',
      new THREE.Vector3(x, RIDGE_HEIGHT, 0),
      new THREE.Vector3(x, EAVE_HEIGHT, POST_LINE_Z),
      0.16,
      timberDark,
    );
    addNamedMesh(
      group,
      'Stable king post',
      new THREE.BoxGeometry(0.17, RIDGE_RISE, 0.17),
      timberWeathered,
      new THREE.Vector3(x, EAVE_HEIGHT + RIDGE_RISE * 0.5, 0),
    );
  }
}

function addStalls(group: THREE.Group): void {
  for (const [bayIndex, centerX] of STABLE_ARCHITECTURE_PLAN.bayCentersX.entries()) {
    addNamedMesh(
      group,
      'Stable worn stall floor',
      new THREE.BoxGeometry(2.72, 0.08, 4.05),
      earth,
      new THREE.Vector3(centerX, 0.04, 0.02),
    );

    const manger = new THREE.Group();
    manger.name = `Stable manger ${bayIndex + 1}`;
    manger.position.set(centerX, 0, -1.76);
    addNamedMesh(
      manger,
      'Stable manger timber box',
      new THREE.BoxGeometry(2.25, 0.48, 0.58),
      timberWeathered,
      new THREE.Vector3(0, 0.42, 0),
    );
    group.add(manger);
  }

  for (const dividerX of [-1.5, 1.5] as const) {
    for (const y of [0.82, 1.42] as const) {
      addNamedMesh(
        group,
        'Stable stall divider rail',
        new THREE.BoxGeometry(0.14, 0.14, 3.35),
        timberLight,
        new THREE.Vector3(dividerX, y, -0.28),
      );
    }
  }
}

function addRestAnchors(group: THREE.Group): void {
  for (const anchor of STABLE_OX_REST_ANCHORS) {
    const marker = new THREE.Group();
    marker.name = `Stable ox rest anchor ${anchor.slotIndex + 1}`;
    marker.position.fromArray(anchor.localPosition);
    marker.rotation.y = anchor.localYaw;
    marker.userData.stableOxRestAnchorId = anchor.id;
    marker.userData.stableOxSlotIndex = anchor.slotIndex;
    group.add(marker);
  }
}

/** Open roadside shed with three deterministic draft-ox bays. */
export function createStableMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Stable';
  group.userData.architecturePlan = STABLE_ARCHITECTURE_PLAN;
  group.userData.oxRestAnchors = STABLE_OX_REST_ANCHORS;

  addPostFrame(group);
  addRoofFrame(group);
  addStalls(group);
  addRestAnchors(group);
  return group;
}
