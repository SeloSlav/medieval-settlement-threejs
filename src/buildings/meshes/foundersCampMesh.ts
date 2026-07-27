import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import {
  FOUNDING_STONE_VISUAL_SEGMENTS,
  FOUNDING_TIMBER_VISUAL_SEGMENTS,
} from '../buildingStockpileVisuals.ts';
import {
  createFireEffect,
  setFireEffectNightLighting,
  updateFireEffect,
} from '../../fires/FireEffect.ts';
import { markBuildingDetailShadowCaster } from '../buildingShadowProxy.ts';

export const FOUNDERS_CAMPFIRE_NAME = 'FoundingCampfire';
const FOUNDERS_CAMPFIRE_EMBERS_NAME = 'FoundingCampfireEmbers';
const FOUNDERS_CAMPFIRE_LIT_SMOKE_NAME = 'FoundingCampfireLitSmoke';
const TENT_HALF_WIDTH = 1.62;
const TENT_HALF_DEPTH = 1.92;
const TENT_EAVE_Y = 0.2;
const TENT_RIDGE_Y = 2.32;
let campGroundMaterial: THREE.MeshStandardMaterial | null = null;

type CampInstance = {
  position: THREE.Vector3;
  rotation?: THREE.Euler;
  scale?: THREE.Vector3;
};

function addCampInstances(
  parent: THREE.Group,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  instances: readonly CampInstance[],
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
  mesh.name = name;
  mesh.receiveShadow = true;

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  for (let index = 0; index < instances.length; index += 1) {
    const instance = instances[index]!;
    quaternion.setFromEuler(instance.rotation ?? new THREE.Euler());
    matrix.compose(
      instance.position,
      quaternion,
      instance.scale ?? new THREE.Vector3(1, 1, 1),
    );
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  parent.add(mesh);
  return mesh;
}

function addCampGrounding(parent: THREE.Group): void {
  const ground = addCampInstances(
    parent,
    'Feathered trampled founding yard',
    new THREE.CircleGeometry(1, 32),
    getCampGroundMaterial(),
    [
      {
        position: new THREE.Vector3(-0.25, 0.034, 0.55),
        rotation: new THREE.Euler(-Math.PI * 0.5, 0, -0.08),
        scale: new THREE.Vector3(6.6, 4.7, 1),
      },
      {
        position: new THREE.Vector3(0.55, 0.038, -1.65),
        rotation: new THREE.Euler(-Math.PI * 0.5, 0, 0.22),
        scale: new THREE.Vector3(3.7, 2.3, 1),
      },
      {
        position: new THREE.Vector3(-4.22, 0.041, -1.7),
        rotation: new THREE.Euler(-Math.PI * 0.5, 0, -0.36),
        scale: new THREE.Vector3(2.75, 1.72, 1),
      },
      {
        position: new THREE.Vector3(4.62, 0.044, -0.48),
        rotation: new THREE.Euler(-Math.PI * 0.5, 0, 0.3),
        scale: new THREE.Vector3(2.62, 1.62, 1),
      },
    ],
  );
  ground.userData.campGrounding = true;
  ground.userData.fpNoCollision = true;
}

function getCampGroundMaterial(): THREE.MeshStandardMaterial {
  if (campGroundMaterial) return campGroundMaterial;

  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size * 2 - 1;
      const v = (y + 0.5) / size * 2 - 1;
      const radius = Math.hypot(u, v);
      const feather = 1 - THREE.MathUtils.smoothstep(radius, 0.46, 0.98);
      const broadMottle = 0.82
        + Math.sin(u * 8.7 + v * 3.1) * 0.08
        + Math.sin(u * -3.9 + v * 11.3) * 0.06;
      const centerBreakup = 0.9 + Math.sin((u + v) * 17.2) * 0.04;
      const alpha = Math.round(
        THREE.MathUtils.clamp(feather * broadMottle * centerBreakup, 0, 1) * 255,
      );
      const offset = (y * size + x) * 4;
      data[offset] = alpha;
      data[offset + 1] = alpha;
      data[offset + 2] = alpha;
      data[offset + 3] = 255;
    }
  }
  const alphaMap = new THREE.DataTexture(
    data,
    size,
    size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  alphaMap.name = 'Procedural feathered camp-ground opacity';
  alphaMap.colorSpace = THREE.NoColorSpace;
  alphaMap.wrapS = THREE.ClampToEdgeWrapping;
  alphaMap.wrapT = THREE.ClampToEdgeWrapping;
  alphaMap.minFilter = THREE.LinearMipmapLinearFilter;
  alphaMap.magFilter = THREE.LinearFilter;
  alphaMap.generateMipmaps = true;
  alphaMap.needsUpdate = true;

  campGroundMaterial = new THREE.MeshStandardMaterial({
    color: 0x4b4338,
    roughness: 1,
    metalness: 0,
    alphaMap,
    transparent: true,
    opacity: 0.42,
    alphaTest: 0.018,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  campGroundMaterial.name = 'Shared feathered desaturated camp earth';
  campGroundMaterial.userData.sharedBuildingMaterial = true;
  return campGroundMaterial;
}

function addFoundingFootTraffic(parent: THREE.Group): void {
  const footprints: CampInstance[] = [];
  const trail = [
    [-0.72, -2.74, -0.18],
    [-0.42, -2.18, 0.12],
    [-0.15, -1.58, -0.1],
    [0.16, -1.02, 0.16],
    [0.38, -0.42, -0.12],
    [0.02, 0.38, 0.1],
    [-0.32, 1.08, -0.14],
    [-0.18, 1.82, 0.12],
  ] as const;
  for (const [index, [x, z, angle]] of trail.entries()) {
    for (const side of [-1, 1] as const) {
      footprints.push({
        position: new THREE.Vector3(
          x + side * 0.13,
          0.052 + index * 0.0004,
          z + side * 0.1,
        ),
        rotation: new THREE.Euler(-Math.PI * 0.5, 0, angle + side * 0.04),
        scale: new THREE.Vector3(0.13, 0.32, 1),
      });
    }
  }
  const traffic = addCampInstances(
    parent,
    'Founders boot-worn foot trail',
    new THREE.CircleGeometry(1, 8),
    getCampGroundMaterial(),
    footprints,
  );
  traffic.userData.campGrounding = true;
  traffic.userData.fpNoCollision = true;
}

function addFoundingStandard(parent: THREE.Group): void {
  const standard = new THREE.Group();
  standard.name = 'Founding wool field standard';
  standard.position.set(-6.12, 0, 1.15);

  const pole = addMesh(
    standard,
    new THREE.CylinderGeometry(0.075, 0.1, 4.35, 7),
    timberMaterial('dark'),
    new THREE.Vector3(0, 2.18, 0),
    new THREE.Euler(0, 0, -0.035),
  );
  pole.name = 'Founding standard pole';

  const pennantGeometry = new THREE.BufferGeometry();
  pennantGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([
      0.03, 4.07, 0.015,
      1.78, 3.68, 0.015,
      0.03, 3.26, 0.015,
    ], 3),
  );
  pennantGeometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute([
      0, 1,
      1, 0.5,
      0, 0,
    ], 2),
  );
  pennantGeometry.setIndex([0, 2, 1]);
  pennantGeometry.computeVertexNormals();
  const pennant = addMesh(
    standard,
    pennantGeometry,
    sharedBuildingDetailMaterial('paintRed'),
    new THREE.Vector3(),
  );
  pennant.name = 'Weathered red wool pennant';
  pennant.userData.fpNoCollision = true;

  parent.add(standard);
}

function addFoundingProvisions(parent: THREE.Group): void {
  const provisions = new THREE.Group();
  provisions.name = 'Founding provisions';

  const barrelPositions = [
    new THREE.Vector3(4.2, 0.6, 1.22),
    new THREE.Vector3(5.28, 0.54, 1.02),
  ];
  addCampInstances(
    provisions,
    'Coopered provision barrels',
    new THREE.CylinderGeometry(0.48, 0.52, 1.16, 10),
    timberMaterial('weathered'),
    barrelPositions.map((position, index) => ({
      position,
      rotation: new THREE.Euler(0, index * 0.23, index === 0 ? -0.035 : 0.04),
    })),
  );
  addCampInstances(
    provisions,
    'Iron barrel hoops',
    new THREE.TorusGeometry(0.49, 0.035, 5, 10),
    metalMaterial('iron'),
    barrelPositions.flatMap((position) => [0.27, 0.86].map((y) => ({
      position: new THREE.Vector3(position.x, y, position.z),
      rotation: new THREE.Euler(Math.PI * 0.5, 0, 0),
    }))),
  );

  const basket = addMesh(
    provisions,
    new THREE.CylinderGeometry(0.43, 0.32, 0.58, 10, 1, true),
    timberMaterial('light'),
    new THREE.Vector3(5.98, 0.3, 1.58),
  );
  basket.name = 'Woven provision basket';
  basket.userData.fpNoCollision = true;
  const basketRim = addMesh(
    provisions,
    new THREE.TorusGeometry(0.43, 0.045, 5, 10),
    timberMaterial('dark'),
    new THREE.Vector3(5.98, 0.59, 1.58),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  basketRim.name = 'Woven basket rim';
  basketRim.userData.fpNoCollision = true;
  const basketContents = addMesh(
    provisions,
    new THREE.CircleGeometry(0.37, 10),
    sharedBuildingDetailMaterial('crop'),
    new THREE.Vector3(5.98, 0.575, 1.58),
    new THREE.Euler(-Math.PI * 0.5, 0, 0),
  );
  basketContents.name = 'Dry provisions in basket';
  basketContents.userData.fpNoCollision = true;

  parent.add(provisions);
}

function addFoundingWorkyard(parent: THREE.Group): void {
  const workyard = new THREE.Group();
  workyard.name = 'Founding timber workyard';

  addCampInstances(
    workyard,
    'Timber tool rack',
    new THREE.BoxGeometry(1, 1, 1),
    timberMaterial('dark'),
    [
      {
        position: new THREE.Vector3(-5.35, 0.88, -0.05),
        scale: new THREE.Vector3(0.15, 1.76, 0.15),
      },
      {
        position: new THREE.Vector3(-3.65, 0.88, -0.05),
        scale: new THREE.Vector3(0.15, 1.76, 0.15),
      },
      {
        position: new THREE.Vector3(-4.5, 1.57, -0.05),
        scale: new THREE.Vector3(1.86, 0.16, 0.16),
      },
    ],
  );

  const toolHandles = [
    { x: -5.05, yaw: -0.07, roll: -0.1 },
    { x: -4.52, yaw: 0.04, roll: 0.08 },
    { x: -3.94, yaw: -0.03, roll: -0.06 },
  ];
  addCampInstances(
    workyard,
    'Long handled founding tools',
    new THREE.CylinderGeometry(0.042, 0.052, 1.48, 6),
    timberMaterial('light'),
    toolHandles.map(({ x, yaw, roll }) => ({
      position: new THREE.Vector3(x, 0.78, -0.2),
      rotation: new THREE.Euler(roll, yaw, roll),
    })),
  );
  addCampInstances(
    workyard,
    'Forged founding axe heads',
    new THREE.ConeGeometry(0.18, 0.42, 4),
    metalMaterial('iron'),
    toolHandles.slice(0, 2).map(({ x }, index) => ({
      position: new THREE.Vector3(x + (index === 0 ? -0.04 : 0.04), 1.48, -0.2),
      rotation: new THREE.Euler(0, 0, Math.PI * 0.5),
      scale: new THREE.Vector3(1, 1, 0.48),
    })),
  );

  const block = addMesh(
    workyard,
    new THREE.CylinderGeometry(0.55, 0.63, 0.72, 9),
    timberMaterial('dark'),
    new THREE.Vector3(-4.48, 0.37, -1.2),
  );
  block.name = 'Founding chopping block';
  addCampInstances(
    workyard,
    'Split firewood by chopping block',
    new THREE.CylinderGeometry(0.1, 0.13, 0.86, 6),
    timberMaterial('light'),
    [
      {
        position: new THREE.Vector3(-5.18, 0.22, -1.3),
        rotation: new THREE.Euler(Math.PI * 0.5, 0.2, 0),
      },
      {
        position: new THREE.Vector3(-4.95, 0.25, -1.62),
        rotation: new THREE.Euler(Math.PI * 0.5, -0.35, 0),
      },
      {
        position: new THREE.Vector3(-3.85, 0.2, -1.38),
        rotation: new THREE.Euler(Math.PI * 0.5, 0.65, 0),
      },
    ],
  );

  parent.add(workyard);
}

function addLivedInTextiles(parent: THREE.Group): void {
  const textiles = new THREE.Group();
  textiles.name = 'Founders drying wool and blankets';

  addRopeBetween(
    textiles,
    new THREE.Vector3(-2.92, 1.66, 1.72),
    new THREE.Vector3(2.72, 1.55, 1.92),
  );
  const redCloths = addCampInstances(
    textiles,
    'Drying red wool cloths',
    new THREE.BoxGeometry(1, 1, 0.035),
    sharedBuildingDetailMaterial('paintRed'),
    [
      {
        position: new THREE.Vector3(-1.34, 1.26, 1.79),
        rotation: new THREE.Euler(0.03, -0.04, 0.045),
        scale: new THREE.Vector3(0.68, 0.72, 1),
      },
      {
        position: new THREE.Vector3(1.48, 1.25, 1.88),
        rotation: new THREE.Euler(-0.025, 0.06, -0.035),
        scale: new THREE.Vector3(0.58, 0.62, 1),
      },
    ],
  );
  redCloths.userData.fpNoCollision = true;
  const ochreCloth = addMesh(
    textiles,
    new THREE.BoxGeometry(0.82, 0.84, 0.035),
    sharedBuildingDetailMaterial('paintOchre'),
    new THREE.Vector3(0.12, 1.2, 1.84),
    new THREE.Euler(0.02, 0.03, 0.028),
  );
  ochreCloth.name = 'Drying ochre wool blanket';
  ochreCloth.userData.fpNoCollision = true;

  parent.add(textiles);
}

function addAFrameShelter(
  parent: THREE.Group,
  x: number,
  z: number,
  yaw: number,
  fabricVariant: number,
): void {
  const shelter = new THREE.Group();
  shelter.name = 'Founding canvas tent';
  shelter.position.set(x, 0, z);
  shelter.rotation.y = yaw;
  shelter.userData.fpCollisionAggregate = true;

  for (const side of [-1, 1] as const) {
    const panel = addMesh(
      shelter,
      createTentSideGeometry(side),
      sharedBuildingDetailMaterial('canvas'),
      new THREE.Vector3(),
    );
    panel.name = 'Weathered tent side';
  }
  addTentRepairPatch(
    shelter,
    fabricVariant % 2 === 0 ? -1 : 1,
    0.2 + (fabricVariant % 3) * 0.08,
    0.54 + (fabricVariant % 2) * 0.08,
    -0.72 + fabricVariant * 0.34,
    sharedBuildingDetailMaterial(fabricVariant === 1 ? 'paintOchre' : 'paintRed'),
  );

  const back = addMesh(
    shelter,
    createTentTriangleGeometry(
      -TENT_HALF_WIDTH,
      TENT_HALF_WIDTH,
      TENT_HALF_DEPTH,
    ),
    sharedBuildingDetailMaterial('canvas'),
    new THREE.Vector3(),
  );
  back.name = 'Tent rear canvas';

  const interior = addMesh(
    shelter,
    createTentTriangleGeometry(
      -TENT_HALF_WIDTH + 0.07,
      TENT_HALF_WIDTH - 0.07,
      -TENT_HALF_DEPTH + 0.035,
    ),
    sharedBuildingMaterial('interiorDark'),
    new THREE.Vector3(),
  );
  interior.name = 'Open tent interior';
  interior.userData.fpNoCollision = true;

  for (const side of [-1, 1] as const) {
    const front = addMesh(
      shelter,
      createTentFrontPanelGeometry(side),
      sharedBuildingDetailMaterial('canvas'),
      new THREE.Vector3(),
    );
    front.name = side < 0 ? 'Left tied tent flap' : 'Right tied tent flap';
  }

  for (const zEnd of [-TENT_HALF_DEPTH, TENT_HALF_DEPTH]) {
    addPoleBetween(
      shelter,
      new THREE.Vector3(0, TENT_RIDGE_Y + 0.08, zEnd),
      new THREE.Vector3(-TENT_HALF_WIDTH - 0.08, 0.04, zEnd),
      0.065,
    );
    addPoleBetween(
      shelter,
      new THREE.Vector3(0, TENT_RIDGE_Y + 0.08, zEnd),
      new THREE.Vector3(TENT_HALF_WIDTH + 0.08, 0.04, zEnd),
      0.065,
    );
  }
  addPoleBetween(
    shelter,
    new THREE.Vector3(0, TENT_RIDGE_Y + 0.1, -TENT_HALF_DEPTH - 0.18),
    new THREE.Vector3(0, TENT_RIDGE_Y + 0.1, TENT_HALF_DEPTH + 0.18),
    0.07,
  );

  for (const zEnd of [-TENT_HALF_DEPTH, TENT_HALF_DEPTH]) {
    const outwardZ = zEnd + Math.sign(zEnd) * 1.32;
    addRopeBetween(
      shelter,
      new THREE.Vector3(0, TENT_RIDGE_Y + 0.04, zEnd),
      new THREE.Vector3(0, 0.08, outwardZ),
    );
    addTentStake(shelter, 0, outwardZ);
  }
  for (const side of [-1, 1]) {
    for (const zEnd of [-TENT_HALF_DEPTH * 0.86, TENT_HALF_DEPTH * 0.86]) {
      const stakeX = side * (TENT_HALF_WIDTH + 0.68);
      const stakeZ = zEnd + Math.sign(zEnd) * 0.44;
      addRopeBetween(
        shelter,
        new THREE.Vector3(side * TENT_HALF_WIDTH, TENT_EAVE_Y + 0.06, zEnd),
        new THREE.Vector3(stakeX, 0.08, stakeZ),
      );
      addTentStake(shelter, stakeX, stakeZ);
    }
  }

  const bedroll = addMesh(
    shelter,
    new THREE.CylinderGeometry(0.22, 0.22, 1.5, 12),
    sharedBuildingDetailMaterial(
      fabricVariant === 0
        ? 'paintRed'
        : fabricVariant === 1
          ? 'paintOchre'
          : 'paintBlue',
    ),
    new THREE.Vector3(-0.62, 0.24, -0.82),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  bedroll.name = 'Rolled wool blanket';
  bedroll.userData.fpNoCollision = true;

  parent.add(shelter);
}

function createTentSideGeometry(side: -1 | 1): THREE.BufferGeometry {
  const acrossSegments = 4;
  const lengthSegments = 8;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let lengthIndex = 0; lengthIndex <= lengthSegments; lengthIndex += 1) {
    const v = lengthIndex / lengthSegments;
    const z = THREE.MathUtils.lerp(-TENT_HALF_DEPTH, TENT_HALF_DEPTH, v);
    const endTension = Math.sin(v * Math.PI);
    for (let acrossIndex = 0; acrossIndex <= acrossSegments; acrossIndex += 1) {
      const u = acrossIndex / acrossSegments;
      const x = side * TENT_HALF_WIDTH * (1 - u);
      const sag = Math.sin(u * Math.PI) * endTension * 0.065;
      const y = THREE.MathUtils.lerp(TENT_EAVE_Y, TENT_RIDGE_Y, u) - sag;
      positions.push(x, y, z);
      uvs.push(u, v);
    }
  }

  const row = acrossSegments + 1;
  for (let v = 0; v < lengthSegments; v += 1) {
    for (let u = 0; u < acrossSegments; u += 1) {
      const a = v * row + u;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      if (side > 0) indices.push(a, c, b, b, c, d);
      else indices.push(a, b, c, b, d, c);
    }
  }
  return createTentGeometry(positions, indices, uvs);
}

function createTentTriangleGeometry(
  minX: number,
  maxX: number,
  z: number,
): THREE.BufferGeometry {
  const positions = [
    minX, TENT_EAVE_Y, z,
    maxX, TENT_EAVE_Y, z,
    0, TENT_RIDGE_Y, z,
  ];
  return createTentGeometry(
    positions,
    z > 0 ? [0, 1, 2] : [0, 2, 1],
    [0, 0, 1, 0, 0.5, 1],
  );
}

function createTentFrontPanelGeometry(side: -1 | 1): THREE.BufferGeometry {
  const outerX = side * TENT_HALF_WIDTH;
  const doorX = side * 0.48;
  const z = -TENT_HALF_DEPTH - 0.015;
  const positions = [
    outerX, TENT_EAVE_Y, z,
    doorX, TENT_EAVE_Y, z,
    side * 0.13, TENT_RIDGE_Y - 0.08, z,
  ];
  return createTentGeometry(
    positions,
    side > 0 ? [0, 2, 1] : [0, 1, 2],
    [0, 0, 1, 0, 0.55, 1],
  );
}

function createTentGeometry(
  positions: number[],
  indices: number[],
  uvs: number[],
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function addTentRepairPatch(
  shelter: THREE.Group,
  side: -1 | 1,
  uMin: number,
  uMax: number,
  centerZ: number,
  material: THREE.Material,
): void {
  const halfLength = 0.48;
  const normal = new THREE.Vector3(
    side * (TENT_RIDGE_Y - TENT_EAVE_Y),
    TENT_HALF_WIDTH,
    0,
  ).normalize().multiplyScalar(0.018);
  const point = (u: number, z: number): THREE.Vector3 => new THREE.Vector3(
    side * TENT_HALF_WIDTH * (1 - u) + normal.x,
    THREE.MathUtils.lerp(TENT_EAVE_Y, TENT_RIDGE_Y, u) + normal.y,
    z,
  );
  const lowerNear = point(uMin, centerZ - halfLength);
  const lowerFar = point(uMin + 0.025, centerZ + halfLength);
  const upperNear = point(uMax, centerZ - halfLength * 0.9);
  const upperFar = point(uMax - 0.018, centerZ + halfLength * 0.92);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([
      lowerNear.x, lowerNear.y, lowerNear.z,
      lowerFar.x, lowerFar.y, lowerFar.z,
      upperNear.x, upperNear.y, upperNear.z,
      upperFar.x, upperFar.y, upperFar.z,
    ], 3),
  );
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute([
      0, 0,
      1, 0,
      0, 1,
      1, 1,
    ], 2),
  );
  geometry.setIndex(side > 0
    ? [0, 2, 1, 1, 2, 3]
    : [0, 1, 2, 1, 3, 2]);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const patch = addMesh(
    shelter,
    geometry,
    material,
    new THREE.Vector3(),
  );
  patch.name = 'Hand-stitched colored canvas repair';
  patch.userData.fpNoCollision = true;
}

function addPoleBetween(
  parent: THREE.Group,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
): THREE.Mesh {
  const pole = addCylinderBetween(
    parent,
    from,
    to,
    radius,
    timberMaterial('dark'),
    7,
  );
  pole.name = 'Tent frame pole';
  return pole;
}

function addRopeBetween(
  parent: THREE.Group,
  from: THREE.Vector3,
  to: THREE.Vector3,
): void {
  const rope = addCylinderBetween(
    parent,
    from,
    to,
    0.018,
    timberMaterial('weathered'),
    5,
  );
  rope.name = 'Taut tent guy rope';
  rope.userData.fpNoCollision = true;
}

function addCylinderBetween(
  parent: THREE.Group,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  radialSegments: number,
): THREE.Mesh {
  const direction = to.clone().sub(from);
  const length = direction.length();
  const mesh = addMesh(
    parent,
    new THREE.CylinderGeometry(radius, radius * 1.08, length, radialSegments),
    material,
    from.clone().add(to).multiplyScalar(0.5),
  );
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  return mesh;
}

function addTentStake(parent: THREE.Group, x: number, z: number): void {
  const stake = addMesh(
    parent,
    new THREE.CylinderGeometry(0.035, 0.055, 0.42, 6),
    timberMaterial('weathered'),
    new THREE.Vector3(x, 0.12, z),
    new THREE.Euler(0.17, 0, -0.12),
  );
  stake.name = 'Tent stake';
  stake.userData.fpNoCollision = true;
}

function addTimberStock(parent: THREE.Group): void {
  const stockpile = new THREE.Group();
  stockpile.name = 'FoundingTimberStockpile';
  for (let segmentIndex = 0; segmentIndex < FOUNDING_TIMBER_VISUAL_SEGMENTS; segmentIndex += 1) {
    const segment = new THREE.Group();
    segment.name = 'FoundingTimberSegment';
    const row = Math.floor(segmentIndex / 4);
    const column = segmentIndex % 4;
    segment.position.set(-5.7 + column * 0.62, 0, -2.55 + row * 0.48);
    for (let log = 0; log < 3; log += 1) {
      addMesh(
        segment,
        new THREE.CylinderGeometry(0.13, 0.16, 2.55, 7),
        timberMaterial(log === 1 ? 'light' : 'mid'),
        new THREE.Vector3(0, 0.18 + log * 0.26, 0),
        new THREE.Euler(0, 0, Math.PI * 0.5),
      );
    }
    stockpile.add(segment);
  }
  parent.add(stockpile);
}

function addStoneStock(parent: THREE.Group): void {
  const stockpile = new THREE.Group();
  stockpile.name = 'FoundingStoneStockpile';
  for (let index = 0; index < FOUNDING_STONE_VISUAL_SEGMENTS; index += 1) {
    const stone = addMesh(
      stockpile,
      new THREE.DodecahedronGeometry(0.42 + (index % 3) * 0.08, 0),
      stoneMaterial(index % 3 === 0 ? 'light' : 'mid'),
      new THREE.Vector3(
        3.8 + (index % 4) * 0.62,
        0.34 + Math.floor(index / 4) * 0.42,
        -2.8,
      ),
      new THREE.Euler(index * 0.23, index * 0.41, index * 0.17),
    );
    stone.name = 'FoundingStoneSegment';
  }
  parent.add(stockpile);
}

function addTreasuryChest(parent: THREE.Group): void {
  const chest = new THREE.Group();
  chest.name = 'FoundingTreasuryChest';
  addMesh(
    chest,
    new THREE.BoxGeometry(1.25, 0.68, 0.75),
    timberMaterial('dark'),
    new THREE.Vector3(5.1, 0.4, 2.8),
  );
  addMesh(
    chest,
    new THREE.CylinderGeometry(0.38, 0.38, 1.25, 8, 1, false, 0, Math.PI),
    timberMaterial('weathered'),
    new THREE.Vector3(5.1, 0.78, 2.8),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  addMesh(
    chest,
    new THREE.BoxGeometry(0.12, 0.72, 0.8),
    metalMaterial('iron'),
    new THREE.Vector3(5.1, 0.53, 2.8),
  );
  parent.add(chest);
}

function addFirelitCampSmoke(campfire: THREE.Group): void {
  const smoke = addCampInstances(
    campfire,
    FOUNDERS_CAMPFIRE_LIT_SMOKE_NAME,
    new THREE.IcosahedronGeometry(0.52, 1),
    sharedBuildingDetailMaterial('smoke'),
    Array.from({ length: 5 }, (_, index) => ({
      position: new THREE.Vector3(0, 1.05 + index * 0.68, 0),
      scale: new THREE.Vector3(
        0.58 + index * 0.16,
        0.76 + index * 0.2,
        0.58 + index * 0.16,
      ),
    })),
  );
  smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  smoke.renderOrder = 16;
  smoke.userData.campSmoke = true;
  smoke.userData.fpNoCollision = true;
  campfire.userData.litSmokeElapsedSeconds = 0;
}

function animateFirelitCampSmoke(
  campfire: THREE.Group,
  dtSeconds: number,
): void {
  const smoke = campfire.getObjectByName(FOUNDERS_CAMPFIRE_LIT_SMOKE_NAME);
  if (!(smoke instanceof THREE.InstancedMesh)) return;

  const elapsed = Math.max(
    0,
    Number(campfire.userData.litSmokeElapsedSeconds ?? 0) + Math.max(0, dtSeconds),
  );
  campfire.userData.litSmokeElapsedSeconds = elapsed;
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  for (let index = 0; index < smoke.count; index += 1) {
    const age = (elapsed * 0.115 + index / smoke.count) % 1;
    const phase = index * 2.37;
    const curl = age * Math.PI * 1.7 + phase;
    const breadth = 0.4 + age * 0.95;
    position.set(
      Math.sin(curl) * (0.1 + age * 0.48) + age * 0.26,
      1.02 + age * 4.25,
      Math.cos(curl * 0.82) * (0.08 + age * 0.34),
    );
    quaternion.setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      curl * 0.38,
    );
    scale.set(
      breadth * 1.03,
      breadth * (1.24 + age * 0.22),
      breadth * 0.82,
    );
    matrix.compose(position, quaternion, scale);
    smoke.setMatrixAt(index, matrix);
  }
  smoke.instanceMatrix.needsUpdate = true;
}

function addCampfire(parent: THREE.Group): THREE.Group {
  const fire = createFireEffect({
    name: FOUNDERS_CAMPFIRE_NAME,
    scale: 0.74,
    intensity: 0.82,
    nightLighting: 1,
    spread: 0.58,
    flameCount: 5,
    smokeCount: 7,
    smokeRise: 3.5,
    smokeDrift: 0.62,
    smokeOpacity: 0.3,
    lightDistance: 23,
    lightIntensity: 22,
  });
  const campfire = fire.root;
  campfire.position.set(0.55, 0, -0.6);

  for (let index = 0; index < 10; index += 1) {
    const angle = index / 10 * Math.PI * 2;
    const stone = addMesh(
      campfire,
      new THREE.DodecahedronGeometry(0.22 + (index % 2) * 0.04, 0),
      stoneMaterial(index % 3 === 0 ? 'light' : 'mid'),
      new THREE.Vector3(Math.cos(angle) * 0.82, 0.2, Math.sin(angle) * 0.82),
      new THREE.Euler(index * 0.13, angle, index * 0.19),
    );
    stone.name = 'Founding campfire hearth stone';
  }

  const embers = addMesh(
    campfire,
    new THREE.CylinderGeometry(0.58, 0.67, 0.1, 12),
    sharedBuildingDetailMaterial('paintRed'),
    new THREE.Vector3(0, 0.14, 0),
  );
  embers.name = FOUNDERS_CAMPFIRE_EMBERS_NAME;

  for (const [index, yaw] of [Math.PI * 0.25, -Math.PI * 0.25].entries()) {
    const log = addMesh(
      campfire,
      new THREE.CylinderGeometry(0.12, 0.15, 1.55, 7),
      timberMaterial(index === 0 ? 'dark' : 'weathered'),
      new THREE.Vector3(0, 0.28 + index * 0.05, 0),
      new THREE.Euler(Math.PI * 0.5, yaw, 0),
    );
    log.name = 'Founding campfire crossed log';
  }

  for (let index = 0; index < 3; index += 1) {
    const angle = index / 3 * Math.PI * 2 + 0.35;
    addPoleBetween(
      campfire,
      new THREE.Vector3(Math.cos(angle) * 0.66, 0.08, Math.sin(angle) * 0.66),
      new THREE.Vector3(Math.cos(angle + Math.PI) * 0.08, 1.65, Math.sin(angle + Math.PI) * 0.08),
      0.035,
    ).name = 'Campfire cooking tripod';
  }

  const pot = addMesh(
    campfire,
    new THREE.CylinderGeometry(0.28, 0.36, 0.34, 10),
    metalMaterial('iron'),
    new THREE.Vector3(0, 0.84, 0),
  );
  pot.name = 'Hanging camp cookpot';
  const potHandle = addMesh(
    campfire,
    new THREE.TorusGeometry(0.3, 0.025, 5, 12, Math.PI),
    metalMaterial('iron'),
    new THREE.Vector3(0, 1.03, 0),
    new THREE.Euler(0, 0, Math.PI),
  );
  potHandle.name = 'Camp cookpot handle';
  addRopeBetween(
    campfire,
    new THREE.Vector3(0, 1.58, 0),
    new THREE.Vector3(0, 1.18, 0),
  );
  addFirelitCampSmoke(campfire);

  parent.add(campfire);
  return campfire;
}

export function setFoundersCampfireNightLighting(
  campfire: THREE.Group,
  nightLighting: number,
): void {
  setFireEffectNightLighting(campfire, nightLighting);
}

export function animateFoundersCampfire(
  campfire: THREE.Group,
  dtSeconds: number,
): void {
  updateFireEffect(campfire, dtSeconds, 0.82);
  animateFirelitCampSmoke(campfire, dtSeconds);
}

export function createFoundersCampMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "Founders' camp and open stockyard";
  group.userData.fpCollisionChildrenOnly = true;

  addCampGrounding(group);
  addFoundingFootTraffic(group);

  const shelters = new THREE.Group();
  shelters.name = 'FoundingShelters';
  addAFrameShelter(shelters, -3.7, 2.7, 0.3, 0);
  addAFrameShelter(shelters, -0.1, 4.15, 0, 1);
  addAFrameShelter(shelters, 3.7, 2.7, -0.3, 2);
  group.add(shelters);

  addCampfire(shelters);
  const benchSeat = addMesh(
    shelters,
    new THREE.BoxGeometry(2.4, 0.18, 0.42),
    timberMaterial('weathered'),
    new THREE.Vector3(-1.9, 0.52, -0.15),
  );
  benchSeat.name = 'Camp bench seat';
  for (const x of [-2.72, -1.08]) {
    const leg = addMesh(
      shelters,
      new THREE.BoxGeometry(0.18, 0.48, 0.34),
      timberMaterial('dark'),
      new THREE.Vector3(x, 0.25, -0.15),
    );
    leg.name = 'Camp bench leg';
  }

  addFoundingStandard(shelters);
  addFoundingProvisions(shelters);
  addFoundingWorkyard(shelters);
  addLivedInTextiles(shelters);
  addTimberStock(group);
  addStoneStock(group);
  addTreasuryChest(group);
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (
      mesh.isMesh
      && !mesh.name.startsWith('Animated fire')
      && mesh.userData.campGrounding !== true
      && mesh.userData.campSmoke !== true
    ) {
      markBuildingDetailShadowCaster(mesh);
    }
  });
  return group;
}
