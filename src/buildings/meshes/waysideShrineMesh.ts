import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  residenceFacadeMaterial,
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import { addTriangularGableWall } from '../meshPrimitives.ts';

export type WaysideShrineDebugMode = 'final' | 'massing';

export type WaysideShrinePlan = {
  seed: number;
  debugMode: WaysideShrineDebugMode;
  dimensions: {
    width: number;
    depth: number;
    foundationHeight: number;
    wallHeight: number;
    ridgeHeight: number;
  };
  tiers: ReadonlyArray<{
    id: 'foundation' | 'shrine-body' | 'roof';
    role: 'plinth' | 'devotional-niche' | 'weather-cap';
    y0: number;
    height: number;
  }>;
  modules: ReadonlyArray<{
    id: string;
    role: 'massing' | 'devotional' | 'ornament' | 'approach';
  }>;
  diagnostics: {
    hiddenFacadeModules: number;
    overlappingModules: number;
    materialSlots: readonly string[];
  };
};

const SHRINE_DIMENSIONS = Object.freeze({
  width: 2.18,
  depth: 1.34,
  foundationHeight: 0.62,
  wallHeight: 2.62,
  ridgeHeight: 1.28,
});

/**
 * Serializable, deterministic plan kept separate from mesh emission so the
 * shrine's scale, module ownership, and visual diagnostics remain inspectable.
 */
export function createWaysideShrinePlan(
  debugMode: WaysideShrineDebugMode = 'final',
): WaysideShrinePlan {
  const dimensions = { ...SHRINE_DIMENSIONS };
  const wallTop = dimensions.foundationHeight + dimensions.wallHeight;
  return {
    seed: 1733,
    debugMode,
    dimensions,
    tiers: [
      { id: 'foundation', role: 'plinth', y0: 0, height: dimensions.foundationHeight },
      { id: 'shrine-body', role: 'devotional-niche', y0: dimensions.foundationHeight, height: dimensions.wallHeight },
      { id: 'roof', role: 'weather-cap', y0: wallTop, height: dimensions.ridgeHeight },
    ],
    modules: [
      { id: 'irregular-limestone-plinth', role: 'massing' },
      { id: 'limewashed-niche-body', role: 'massing' },
      { id: 'split-shingle-weather-cap', role: 'massing' },
      { id: 'marian-devotional-niche', role: 'devotional' },
      { id: 'forged-iron-ridge-cross', role: 'ornament' },
      { id: 'worn-roadside-steps', role: 'approach' },
    ],
    diagnostics: {
      hiddenFacadeModules: 0,
      overlappingModules: 0,
      materialSlots: [
        'limewash',
        'limestone',
        'shingle',
        'timber',
        'iron',
        'devotional-paint',
      ],
    },
  };
}

function createArchedPanelGeometry(
  width: number,
  height: number,
  depth: number,
): THREE.ExtrudeGeometry {
  const radius = width * 0.5;
  const springY = height - radius;
  const shape = new THREE.Shape();
  shape.moveTo(-radius, 0);
  shape.lineTo(radius, 0);
  shape.lineTo(radius, springY);
  shape.absarc(0, springY, radius, 0, Math.PI, false);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 8,
  });
}

function name(mesh: THREE.Mesh, value: string): THREE.Mesh {
  mesh.name = value;
  return mesh;
}

function addFoundationStoneFace(
  group: THREE.Group,
  width: number,
  depth: number,
  height: number,
): void {
  const frontZ = depth * 0.5 + 0.055;
  const courseY = [0.18, 0.47] as const;
  for (const [course, y] of courseY.entries()) {
    const count = course === 0 ? 4 : 5;
    const blockWidth = width / count;
    for (let index = 0; index < count; index += 1) {
      const x = -width * 0.5 + blockWidth * (index + 0.5);
      const jitter = ((index * 17 + course * 11) % 5 - 2) * 0.015;
      name(addMesh(
        group,
        new THREE.BoxGeometry(blockWidth * 0.93, course === 0 ? 0.3 : 0.24, 0.16),
        stoneMaterial((index + course) % 3 === 0 ? 'light' : 'mid'),
        new THREE.Vector3(x + jitter, Math.min(height - 0.08, y), frontZ),
        new THREE.Euler(0, jitter * 0.8, jitter * 0.5),
      ), `Wayside shrine foundation stone ${course + 1}-${index + 1}`);
    }
  }
}

function addRoof(
  group: THREE.Group,
  plan: WaysideShrinePlan,
): void {
  const { width, depth, foundationHeight, wallHeight, ridgeHeight } = plan.dimensions;
  const wallTop = foundationHeight + wallHeight;
  const halfWidth = width * 0.5;
  const halfDepth = depth * 0.5;
  const pitch = Math.atan2(ridgeHeight, halfWidth);
  const slopeLength = halfWidth / Math.cos(pitch) + 0.2;
  const roofDepth = depth + 0.58;
  const roofMaterial = sharedBuildingMaterial('shingle');

  for (const side of [-1, 1] as const) {
    name(addMesh(
      group,
      new THREE.BoxGeometry(slopeLength, 0.14, roofDepth),
      roofMaterial,
      new THREE.Vector3(
        side * halfWidth * 0.48,
        wallTop + ridgeHeight * 0.49,
        -0.02,
      ),
      new THREE.Euler(0, 0, side * -pitch),
    ), `Wayside shrine ${side < 0 ? 'left' : 'right'} split-shingle roof plane`);
  }

  name(addMesh(
    group,
    new THREE.BoxGeometry(0.16, 0.15, roofDepth + 0.04),
    timberMaterial('dark'),
    new THREE.Vector3(0, wallTop + ridgeHeight + 0.02, -0.02),
  ), 'Wayside shrine roof ridge cap');

  for (const zSign of [-1, 1] as const) {
    addTriangularGableWall(
      group,
      'z',
      zSign * (halfDepth + 0.01),
      halfWidth,
      wallTop,
      ridgeHeight,
      0.12,
      residenceFacadeMaterial('white'),
    );
  }

  const roofTop = wallTop + ridgeHeight;
  name(addMesh(
    group,
    new THREE.BoxGeometry(0.085, 0.86, 0.085),
    metalMaterial('iron'),
    new THREE.Vector3(0, roofTop + 0.43, 0.02),
  ), 'Wayside shrine forged-iron cross upright');
  name(addMesh(
    group,
    new THREE.BoxGeometry(0.52, 0.075, 0.075),
    metalMaterial('iron'),
    new THREE.Vector3(0, roofTop + 0.57, 0.02),
  ), 'Wayside shrine forged-iron cross arm');
}

function addDevotionalNiche(
  group: THREE.Group,
  plan: WaysideShrinePlan,
): void {
  const { depth, foundationHeight } = plan.dimensions;
  const frontZ = depth * 0.5 + 0.01;
  const nicheY = foundationHeight + 0.42;

  name(addMesh(
    group,
    createArchedPanelGeometry(1.28, 1.94, 0.12),
    stoneMaterial('light'),
    new THREE.Vector3(0, nicheY, frontZ),
  ), 'Wayside shrine arched limestone niche surround');
  name(addMesh(
    group,
    createArchedPanelGeometry(0.9, 1.55, 0.05),
    sharedBuildingMaterial('interiorDark'),
    new THREE.Vector3(0, nicheY + 0.2, frontZ + 0.125),
  ), 'Wayside shrine deep devotional niche');
  name(addMesh(
    group,
    createArchedPanelGeometry(0.63, 1.18, 0.025),
    timberMaterial('dark'),
    new THREE.Vector3(0, nicheY + 0.36, frontZ + 0.185),
  ), 'Wayside shrine Marian icon board');

  const blue = sharedBuildingDetailMaterial('paintBlue');
  const ochre = sharedBuildingDetailMaterial('paintOchre');
  name(addMesh(
    group,
    new THREE.ConeGeometry(0.24, 0.62, 8),
    blue,
    new THREE.Vector3(-0.05, nicheY + 0.75, frontZ + 0.245),
  ), 'Wayside shrine Marian blue mantle');
  name(addMesh(
    group,
    new THREE.SphereGeometry(0.105, 10, 7),
    ochre,
    new THREE.Vector3(-0.05, nicheY + 1.13, frontZ + 0.25),
  ), 'Wayside shrine Marian icon face');
  name(addMesh(
    group,
    new THREE.SphereGeometry(0.07, 9, 6),
    ochre,
    new THREE.Vector3(0.17, nicheY + 0.9, frontZ + 0.27),
  ), 'Wayside shrine infant icon face');
  name(addMesh(
    group,
    new THREE.BoxGeometry(0.12, 0.25, 0.055),
    sharedBuildingDetailMaterial('paintOchre'),
    new THREE.Vector3(0.14, nicheY + 0.73, frontZ + 0.26),
  ), 'Wayside shrine infant icon robe');

  name(addMesh(
    group,
    new THREE.BoxGeometry(0.92, 0.12, 0.28),
    stoneMaterial('light'),
    new THREE.Vector3(0, nicheY + 0.22, frontZ + 0.2),
  ), 'Wayside shrine votive ledge');
  name(addMesh(
    group,
    new THREE.CylinderGeometry(0.045, 0.052, 0.18, 8),
    sharedBuildingDetailMaterial('canvas'),
    new THREE.Vector3(0.29, nicheY + 0.38, frontZ + 0.31),
  ), 'Wayside shrine votive candle');
  name(addMesh(
    group,
    new THREE.SphereGeometry(0.045, 8, 6),
    ochre,
    new THREE.Vector3(0.29, nicheY + 0.5, frontZ + 0.31),
    new THREE.Euler(),
    new THREE.Vector3(0.7, 1.35, 0.7),
  ), 'Wayside shrine votive flame');
}

function compileWaysideShrine(plan: WaysideShrinePlan): THREE.Group {
  const root = new THREE.Group();
  root.name = 'Gorski Kotar Wayside Shrine';
  const group = new THREE.Group();
  group.name = 'Gorski Kotar Wayside Shrine authored model';
  root.add(group);

  const { width, depth, foundationHeight, wallHeight } = plan.dimensions;
  const halfDepth = depth * 0.5;
  name(addMesh(
    group,
    new THREE.BoxGeometry(width + 0.38, foundationHeight, depth + 0.36),
    stoneMaterial('mid'),
    new THREE.Vector3(0, foundationHeight * 0.5, 0),
  ), 'Wayside shrine limestone foundation mass');
  addFoundationStoneFace(group, width + 0.2, depth + 0.24, foundationHeight);
  name(addMesh(
    group,
    new THREE.BoxGeometry(width + 0.34, 0.16, depth + 0.32),
    stoneMaterial('light'),
    new THREE.Vector3(0, foundationHeight + 0.05, 0),
  ), 'Wayside shrine plinth cap course');
  name(addMesh(
    group,
    new THREE.BoxGeometry(width, wallHeight, depth),
    residenceFacadeMaterial('white'),
    new THREE.Vector3(0, foundationHeight + wallHeight * 0.5, 0),
  ), 'Wayside shrine limewashed devotional body');

  addRoof(group, plan);
  if (plan.debugMode === 'final') addDevotionalNiche(group, plan);

  for (let step = 0; step < 2; step += 1) {
    name(addMesh(
      group,
      new THREE.BoxGeometry(1.34 - step * 0.22, 0.16, 0.58),
      stoneMaterial(step === 0 ? 'mid' : 'light'),
      new THREE.Vector3(0, 0.08 + step * 0.11, halfDepth + 0.5 - step * 0.16),
    ), `Wayside shrine worn approach step ${step + 1}`);
  }

  let triangleCount = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry;
    triangleCount += geometry.index
      ? geometry.index.count / 3
      : (geometry.getAttribute('position')?.count ?? 0) / 3;
  });
  root.userData.architecturePlan = plan;
  root.userData.architectureDiagnostics = {
    ...plan.diagnostics,
    moduleCount: plan.modules.length,
    triangleCount,
  };
  return root;
}

/** Compact decorative roadside poklonac with no gameplay-state props. */
export function createWaysideShrineMesh(
  debugMode: WaysideShrineDebugMode = 'final',
): THREE.Group {
  return compileWaysideShrine(createWaysideShrinePlan(debugMode));
}
