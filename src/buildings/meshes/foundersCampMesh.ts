import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  addMesh,
  metalMaterial,
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import {
  FOUNDING_IRONWORK_VISUAL_SEGMENTS,
  FOUNDING_STONE_VISUAL_SEGMENTS,
  FOUNDING_TIMBER_VISUAL_SEGMENTS,
} from '../buildingStockpileVisuals.ts';
import {
  createFireEffect,
  setFireEffectNightLighting,
  updateFireEffect,
} from '../../fires/FireEffect.ts';
import { markBuildingDetailShadowCaster } from '../buildingShadowProxy.ts';
import {
  installBuildingDetailCasterBatches,
} from '../buildingDetailShadowBatch.ts';
import {
  FOUNDERS_CAMP_BENCH_SEAT,
  FOUNDERS_CAMP_FIRESIDE_STUMP_SEAT,
  FOUNDERS_CAMP_SEAT_SURFACE_HEIGHT,
  FOUNDERS_CAMPFIRE_POSITION,
} from '../foundersCampLandmarks.ts';
import {
  REMOTE_WORK_CAMP_NAME,
  REMOTE_WORK_CAMPFIRE_NAME,
  remoteWorkCampLayout,
} from '../remoteWorkCamp.ts';

export const FOUNDERS_CAMPFIRE_NAME = 'FoundingCampfire';
export const FOUNDERS_CAMP_TIMBER_WINTER_ACCUMULATION_NAME =
  'Founding timber winter accumulation';
export const FOUNDERS_CAMP_STONE_WINTER_ACCUMULATION_NAME =
  'Founding stone winter accumulation';
const FOUNDERS_CAMPFIRE_EMBERS_NAME = 'FoundingCampfireEmbers';
const FOUNDERS_CAMPFIRE_LIT_SMOKE_NAME = 'FoundingCampfireLitSmoke';
const FOUNDERS_CAMP_WINTER_ACCUMULATION_NAME =
  'Founders camp winter accumulation';
const TENT_HALF_WIDTH = 1.62;
const TENT_HALF_DEPTH = 1.92;
const TENT_EAVE_Y = 0.2;
const TENT_RIDGE_Y = 2.32;
const FOUNDERS_CAMP_TENT_PLACEMENTS = [
  { x: -5.15, z: 4.35, yaw: 0.12 },
  { x: 0, z: 4.7, yaw: 0 },
  { x: 5.15, z: 4.35, yaw: -0.12 },
] as const;
const LIT_SMOKE_UPLOAD_INTERVAL_SECONDS = 1 / 12;
const litSmokeMatrix = new THREE.Matrix4();
const litSmokeQuaternion = new THREE.Quaternion();
const litSmokePosition = new THREE.Vector3();
const litSmokeScale = new THREE.Vector3();
const litSmokeUpAxis = new THREE.Vector3(0, 1, 0);
const litSmokeByCampfire = new WeakMap<THREE.Group, THREE.InstancedMesh>();
let campGroundMaterial: THREE.MeshStandardMaterial | null = null;
let tentCanvasMaterial: THREE.MeshStandardMaterial | null = null;

type CampInstance = {
  position: THREE.Vector3;
  rotation?: THREE.Euler;
  quaternion?: THREE.Quaternion;
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
    if (instance.quaternion) quaternion.copy(instance.quaternion);
    else quaternion.setFromEuler(instance.rotation ?? new THREE.Euler());
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

function addFoundersCampWinterAccumulation(parent: THREE.Group): void {
  const parts: THREE.BufferGeometry[] = [];
  FOUNDERS_CAMP_TENT_PLACEMENTS.forEach(({ x, z, yaw }, index) => {
    const geometry = createTentRoofFrostGeometry(index);
    geometry.rotateY(yaw);
    geometry.translate(x, 0, z);
    parts.push(geometry);
  });

  // Work surfaces retain deliberately incomplete cover so timber, iron, and
  // canvas continue to identify the camp beneath the pale winter read.
  addHorizontalWinterPatch(parts, 2.28, 0.36, -1.9, 0.63, -0.15);
  addHorizontalWinterPatch(parts, 1.62, 0.54, -0.95, 0.865, -2.15, -0.16);
  addHorizontalWinterPatch(parts, 0.82, 0.62, 5.56, 0.87, -1.42, 0.18);
  addHorizontalWinterPatch(parts, 0.64, 0.52, 4.65, 0.73, -1.66, -0.12);
  addHorizontalWinterPatch(parts, 0.55, 0.46, 5.2, 1.32, -1.34, 0.08);
  addHorizontalWinterPatch(parts, 0.16, 1.25, 2.38, 1.43, -1.8, 0.02);
  addHorizontalWinterDisc(parts, 0.5, -4.48, 0.75, -1.2, 9, 0.18);
  addHorizontalWinterDisc(parts, 0.45, 6.15, 1.2, 0.3, 10, -0.12);
  addHorizontalWinterDisc(parts, 0.43, 7.35, 1.2, 0.43, 10, 0.16);

  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error('Could not merge founders camp winter accumulation.');
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const accumulation = new THREE.Mesh(
    geometry,
    sharedBuildingMaterial('plasterWhite'),
  );
  accumulation.name = FOUNDERS_CAMP_WINTER_ACCUMULATION_NAME;
  accumulation.visible = false;
  accumulation.receiveShadow = true;
  accumulation.userData.foundersCampWinterAccumulation = true;
  accumulation.userData.fpNoCollision = true;
  parent.add(accumulation);
}

function createTentRoofFrostGeometry(variant: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const lengthSegments = 8;
  const lowerCoverage = [0.37, 0.3, 0.42, 0.33, 0.46, 0.34, 0.4, 0.31, 0.38];
  const baseOffset = 0.018;
  const snowDepth = 0.072;

  for (const side of [-1, 1] as const) {
    const sideVertexOffset = positions.length / 3;
    const outwardNormal = new THREE.Vector3(
      side * (TENT_RIDGE_Y - TENT_EAVE_Y),
      TENT_HALF_WIDTH,
      0,
    ).normalize();
    for (let lengthIndex = 0; lengthIndex <= lengthSegments; lengthIndex += 1) {
      const v = lengthIndex / lengthSegments;
      const z = THREE.MathUtils.lerp(
        -TENT_HALF_DEPTH + 0.035,
        TENT_HALF_DEPTH - 0.035,
        v,
      );
      const shiftedIndex = (
        lengthIndex + variant * 2 + (side > 0 ? 1 : 0)
      ) % lowerCoverage.length;
      const lowerU = lowerCoverage[shiftedIndex]!;
      for (const [u, offset] of [
        [lowerU, baseOffset],
        [lowerU, snowDepth],
        [0.992, snowDepth * 0.9],
      ] as const) {
        const endTension = Math.sin(v * Math.PI);
        const sag = Math.sin(u * Math.PI) * endTension * 0.095;
        const fold = Math.sin(v * Math.PI * 7 + side * 0.57)
          * Math.sin(v * Math.PI)
          * (0.025 + (1 - u) * 0.045);
        positions.push(
          side * (TENT_HALF_WIDTH * (1 - u) + fold * 0.78)
            + outwardNormal.x * offset,
          THREE.MathUtils.lerp(TENT_EAVE_Y, TENT_RIDGE_Y, u)
            - sag
            + fold * 0.42
            + outwardNormal.y * offset,
          z,
        );
        uvs.push(v * 1.7, u * 1.7);
      }
    }
    for (let segment = 0; segment < lengthSegments; segment += 1) {
      const base = sideVertexOffset + segment * 3;
      const surface = base + 1;
      const ridge = base + 2;
      const nextBase = base + 3;
      const nextSurface = base + 4;
      const nextRidge = base + 5;
      if (side > 0) {
        indices.push(
          surface, nextSurface, ridge,
          ridge, nextSurface, nextRidge,
        );
      } else {
        indices.push(
          surface, ridge, nextSurface,
          ridge, nextRidge, nextSurface,
        );
      }
      // Both windings keep the thin jagged snow lip legible from the high
      // overview and the low walk camera without a second material/draw.
      indices.push(
        base, surface, nextBase,
        surface, nextSurface, nextBase,
        base, nextBase, surface,
        surface, nextBase, nextSurface,
      );
    }
  }

  const mantle = new THREE.BufferGeometry();
  mantle.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  mantle.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  mantle.setIndex(indices);
  mantle.computeVertexNormals();

  const ridge = new THREE.CylinderGeometry(0.075, 0.095, 3.76, 6);
  ridge.rotateX(Math.PI * 0.5);
  ridge.translate(0, TENT_RIDGE_Y + 0.068, 0);
  const geometry = mergeGeometries([mantle, ridge], false);
  mantle.dispose();
  ridge.dispose();
  if (!geometry) throw new Error('Could not merge tent winter mantle.');
  return geometry;
}

function addHorizontalWinterPatch(
  parts: THREE.BufferGeometry[],
  width: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  yaw = 0,
): void {
  const geometry = new THREE.BoxGeometry(width, 0.055, depth);
  geometry.rotateY(yaw);
  geometry.translate(x, y + 0.018, z);
  parts.push(geometry);
}

function addHorizontalWinterDisc(
  parts: THREE.BufferGeometry[],
  radius: number,
  x: number,
  y: number,
  z: number,
  segments: number,
  yaw: number,
): void {
  const geometry = new THREE.CylinderGeometry(
    radius * 0.82,
    radius,
    0.06,
    segments,
  );
  geometry.rotateY(yaw);
  geometry.translate(x, y + 0.02, z);
  parts.push(geometry);
}

function createTimberWinterAccumulationGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(3.05, 0.055, 0.14);
}

function createStoneWinterAccumulationGeometry(): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(0.29, 0.36, 0.065, 7);
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
  const mudBlotches = [
    [-0.48, -0.34, 0.58, 0.34, 0.94, 0.34, 0.88, 0.3],
    [-0.06, -0.43, 0.62, 0.29, 0.98, -0.2, 0.78, 1.1],
    [0.43, -0.25, 0.46, 0.37, 0.88, 0.48, 0.84, 2.2],
    [-0.42, 0.12, 0.39, 0.5, 0.9, -0.44, 0.72, 3.3],
    [0.04, 0.08, 0.52, 0.43, 0.99, 0.12, 0.94, 4.4],
    [0.48, 0.3, 0.43, 0.31, 0.95, -0.31, 0.74, 5.5],
    [-0.17, 0.5, 0.56, 0.28, 0.97, 0.25, 0.69, 6.6],
  ] as const;
  const footfallBlotches = [
    [-0.66, 0.34, 0.17, 0.1, 0.54],
    [-0.43, 0.27, 0.14, 0.085, 0.48],
    [-0.2, 0.17, 0.18, 0.1, 0.56],
    [0.2, -0.08, 0.19, 0.105, 0.52],
    [0.48, -0.2, 0.16, 0.09, 0.47],
    [0.67, -0.32, 0.14, 0.08, 0.42],
  ] as const;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size * 2 - 1;
      const v = (y + 0.5) / size * 2 - 1;
      let coverage = 0;
      for (const [
        centerX,
        centerY,
        radiusX,
        radiusY,
        cosine,
        sine,
        strength,
        phase,
      ] of mudBlotches) {
        const deltaX = u - centerX;
        const deltaY = v - centerY;
        const localX = (deltaX * cosine + deltaY * sine) / radiusX;
        const localY = (-deltaX * sine + deltaY * cosine) / radiusY;
        const edgeWarp = (
          Math.sin(u * 5.1 + v * 2.7 + phase) * 0.07
          + Math.sin(u * -2.9 + v * 6.3 - phase * 0.4) * 0.045
        );
        const distance = Math.hypot(localX, localY) + edgeWarp;
        const blotch = (
          1 - THREE.MathUtils.smoothstep(distance, 0.46, 1.04)
        ) * strength;
        coverage = Math.max(coverage, blotch);
      }
      for (const [
        centerX,
        centerY,
        radiusX,
        radiusY,
        strength,
      ] of footfallBlotches) {
        const distance = Math.hypot(
          (u - centerX) / radiusX,
          (v - centerY) / radiusY,
        );
        const footfall = (
          1 - THREE.MathUtils.smoothstep(distance, 0.24, 1)
        ) * strength;
        coverage = Math.max(coverage, footfall);
      }
      const lowFrequencyMud = (
        0.88
        + Math.sin(u * 3.7 + v * 2.1 + 0.4) * 0.065
        + Math.sin(u * -2.3 + v * 4.1 + 1.7) * 0.045
      );
      const alpha = Math.round(
        THREE.MathUtils.clamp(coverage * lowFrequencyMud, 0, 1) * 255,
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
  alphaMap.name = 'Procedural irregular camp-ground mud blotches';
  alphaMap.colorSpace = THREE.NoColorSpace;
  alphaMap.wrapS = THREE.ClampToEdgeWrapping;
  alphaMap.wrapT = THREE.ClampToEdgeWrapping;
  alphaMap.minFilter = THREE.LinearMipmapLinearFilter;
  alphaMap.magFilter = THREE.LinearFilter;
  alphaMap.generateMipmaps = true;
  alphaMap.needsUpdate = true;

  campGroundMaterial = new THREE.MeshStandardMaterial({
    color: 0x39332c,
    roughness: 1,
    metalness: 0,
    alphaMap,
    transparent: true,
    opacity: 0.5,
    alphaTest: 0.025,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  campGroundMaterial.name = 'Shared feathered desaturated camp earth';
  campGroundMaterial.userData.sharedBuildingMaterial = true;
  return campGroundMaterial;
}

function getAgedTentCanvasMaterial(_variant: number): THREE.MeshStandardMaterial {
  if (tentCanvasMaterial) return tentCanvasMaterial;

  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const [baseRed, baseGreen, baseBlue] = [166, 148, 111] as const;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const broadFold = Math.sin(v * Math.PI * 9) * 0.055;
      const weave = (
        Math.sin(u * 49.7 + v * 17.3)
        + Math.sin(u * -21.1 + v * 43.9)
      ) * 0.018;
      const lowerMud = 1 - THREE.MathUtils.smoothstep(Math.min(u, v), 0.04, 0.29);
      const splash = Math.max(
        0,
        Math.sin(v * 37.1) * Math.sin(u * 29.3),
      );
      const damp = lowerMud * (0.22 + splash * 0.13);
      const age = 1 + broadFold + weave;
      const offset = (y * size + x) * 4;
      data[offset] = Math.round(THREE.MathUtils.clamp(
        baseRed * age * (1 - damp * 0.7),
        0,
        255,
      ));
      data[offset + 1] = Math.round(THREE.MathUtils.clamp(
        baseGreen * age * (1 - damp * 0.58),
        0,
        255,
      ));
      data[offset + 2] = Math.round(THREE.MathUtils.clamp(
        baseBlue * age * (1 - damp * 0.5),
        0,
        255,
      ));
      data[offset + 3] = 255;
    }
  }
  const map = new THREE.DataTexture(
    data,
    size,
    size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  map.name = 'Procedural aged founding canvas';
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;

  // Hydrate the existing shared canvas material instead of adding one shader
  // permutation per tent. Geometry, seams, patches, and lived-in props retain
  // the camp's variation while the building-material ceiling stays flat.
  tentCanvasMaterial = sharedBuildingDetailMaterial('canvas');
  tentCanvasMaterial.color.setHex(0xffffff);
  tentCanvasMaterial.map = map;
  tentCanvasMaterial.roughness = 0.96;
  tentCanvasMaterial.needsUpdate = true;
  return tentCanvasMaterial;
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

function addFoundingProvisions(parent: THREE.Group): void {
  const provisions = new THREE.Group();
  provisions.name = 'Founding provisions';

  const barrelPositions = [
    new THREE.Vector3(6.15, 0.6, 0.3),
    new THREE.Vector3(7.35, 0.6, 0.43),
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
    barrelPositions.flatMap((position) => [-0.33, 0.27].map((offsetY) => ({
      position: new THREE.Vector3(
        position.x,
        position.y + offsetY,
        position.z,
      ),
      rotation: new THREE.Euler(Math.PI * 0.5, 0, 0),
    }))),
  );

  const basket = addMesh(
    provisions,
    new THREE.CylinderGeometry(0.43, 0.32, 0.58, 10, 1, true),
    timberMaterial('light'),
    new THREE.Vector3(7.55, 0.3, -0.95),
  );
  basket.name = 'Woven provision basket';
  basket.userData.fpNoCollision = true;
  const basketRim = addMesh(
    provisions,
    new THREE.TorusGeometry(0.43, 0.045, 5, 10),
    timberMaterial('dark'),
    new THREE.Vector3(7.55, 0.59, -0.95),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  basketRim.name = 'Woven basket rim';
  basketRim.userData.fpNoCollision = true;
  const basketContents = addMesh(
    provisions,
    new THREE.CircleGeometry(0.37, 10),
    sharedBuildingDetailMaterial('crop'),
    new THREE.Vector3(7.55, 0.575, -0.95),
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

function addFoundingUtilityStores(parent: THREE.Group): void {
  const stores = new THREE.Group();
  stores.name = 'Founders lived-in utility stores';

  addCampInstances(
    stores,
    'Asymmetric founding supply crates',
    new THREE.BoxGeometry(1, 1, 1),
    timberMaterial('mid'),
    [
      {
        position: new THREE.Vector3(5.56, 0.43, -1.42),
        rotation: new THREE.Euler(0, 0.18, 0),
        scale: new THREE.Vector3(0.98, 0.84, 0.82),
      },
      {
        position: new THREE.Vector3(4.65, 0.36, -1.66),
        rotation: new THREE.Euler(0, -0.12, 0),
        scale: new THREE.Vector3(0.76, 0.7, 0.72),
      },
      {
        position: new THREE.Vector3(5.2, 1.03, -1.34),
        rotation: new THREE.Euler(0.03, 0.08, -0.02),
        scale: new THREE.Vector3(0.68, 0.54, 0.62),
      },
    ],
  );
  addCampInstances(
    stores,
    'Dark crate braces',
    new THREE.BoxGeometry(1, 1, 1),
    timberMaterial('dark'),
    [
      {
        position: new THREE.Vector3(5.56, 0.52, -1.84),
        rotation: new THREE.Euler(0, 0.18, 0),
        scale: new THREE.Vector3(0.86, 0.1, 0.06),
      },
      {
        position: new THREE.Vector3(4.65, 0.43, -2.03),
        rotation: new THREE.Euler(0, -0.12, 0),
        scale: new THREE.Vector3(0.66, 0.09, 0.055),
      },
      {
        position: new THREE.Vector3(5.2, 1.08, -1.66),
        rotation: new THREE.Euler(0.03, 0.08, -0.02),
        scale: new THREE.Vector3(0.58, 0.085, 0.05),
      },
    ],
  );
  const sacks = addCampInstances(
    stores,
    'Slumped canvas provision sacks',
    new THREE.SphereGeometry(0.5, 8, 6),
    getAgedTentCanvasMaterial(1),
    [
      {
        position: new THREE.Vector3(4.2, 0.38, -1.04),
        rotation: new THREE.Euler(0.04, 0.24, -0.2),
        scale: new THREE.Vector3(0.72, 0.9, 0.58),
      },
      {
        position: new THREE.Vector3(4.65, 0.31, -0.82),
        rotation: new THREE.Euler(-0.08, -0.32, 0.34),
        scale: new THREE.Vector3(0.64, 0.72, 0.54),
      },
      {
        position: new THREE.Vector3(5.08, 0.27, -0.72),
        rotation: new THREE.Euler(0.13, 0.15, -0.48),
        scale: new THREE.Vector3(0.58, 0.63, 0.52),
      },
    ],
  );
  sacks.userData.fpNoCollision = true;

  const wheel = addMesh(
    stores,
    new THREE.TorusGeometry(0.68, 0.075, 7, 18),
    timberMaterial('dark'),
    new THREE.Vector3(5.92, 0.78, -0.9),
    new THREE.Euler(0.04, -0.18, 0.08),
  );
  wheel.name = 'Spare founding cart wheel';
  wheel.userData.fpNoCollision = true;
  const spokes = addCampInstances(
    stores,
    'Spare wheel spokes',
    new THREE.BoxGeometry(0.1, 1.22, 0.085),
    timberMaterial('weathered'),
    Array.from({ length: 6 }, (_, index) => ({
      position: new THREE.Vector3(5.92, 0.78, -0.9),
      rotation: new THREE.Euler(0.04, -0.18, index * Math.PI / 6 + 0.08),
    })),
  );
  spokes.userData.fpNoCollision = true;

  const firewoodPlacements: CampInstance[] = [];
  for (let row = 0; row < 6; row += 1) {
    const rowCount = 6 - row;
    for (let column = 0; column < rowCount; column += 1) {
      firewoodPlacements.push({
        position: new THREE.Vector3(
          2.38 + (column - (rowCount - 1) / 2) * 0.31,
          0.17 + row * 0.22,
          -1.8 + (column % 2) * 0.025,
        ),
        rotation: new THREE.Euler(Math.PI * 0.5, 0, 0),
      });
    }
  }
  const firewood = addCampInstances(
    stores,
    'Stacked cut camp firewood',
    new THREE.CylinderGeometry(0.105, 0.13, 1.72, 6),
    timberMaterial('light'),
    firewoodPlacements,
  );
  firewood.userData.fpNoCollision = true;

  const prepBoard = addMesh(
    stores,
    new THREE.BoxGeometry(1.78, 0.14, 0.68),
    timberMaterial('weathered'),
    new THREE.Vector3(-0.95, 0.78, -2.15),
    new THREE.Euler(0, -0.16, 0),
  );
  prepBoard.name = 'Camp cook preparation board';
  const prepLegs = addCampInstances(
    stores,
    'Camp preparation trestles',
    new THREE.BoxGeometry(0.14, 0.72, 0.14),
    timberMaterial('dark'),
    [
      { position: new THREE.Vector3(-1.6, 0.38, -2.05) },
      { position: new THREE.Vector3(-0.3, 0.38, -2.25) },
    ],
  );
  prepLegs.userData.fpNoCollision = true;
  const cookware = addCampInstances(
    stores,
    'Iron bowls and kettle by fire',
    new THREE.SphereGeometry(0.22, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.58),
    metalMaterial('iron'),
    [
      {
        position: new THREE.Vector3(-1.2, 0.89, -2.11),
        rotation: new THREE.Euler(Math.PI, 0, 0),
        scale: new THREE.Vector3(1.2, 0.48, 1),
      },
      {
        position: new THREE.Vector3(-0.72, 0.89, -2.18),
        rotation: new THREE.Euler(Math.PI, 0.2, 0),
        scale: new THREE.Vector3(0.92, 0.42, 0.86),
      },
    ],
  );
  cookware.userData.fpNoCollision = true;

  parent.add(stores);
}

function addLivedInTextiles(parent: THREE.Group): void {
  const textiles = new THREE.Group();
  textiles.name = 'Founders drying wool and blankets';

  const lineStart = new THREE.Vector3(-1.55, 1.72, -3.38);
  const lineEnd = new THREE.Vector3(2.65, 1.61, -3.18);
  addCampInstances(
    textiles,
    'Freestanding founders clothesline poles',
    new THREE.CylinderGeometry(0.055, 0.075, 1.74, 7),
    timberMaterial('dark'),
    [lineStart, lineEnd].map((point, index) => ({
      position: new THREE.Vector3(point.x, 0.87, point.z),
      rotation: new THREE.Euler(0, 0, index === 0 ? -0.025 : 0.035),
    })),
  );
  addRopeBetween(
    textiles,
    lineStart,
    lineEnd,
  );
  const redCloths = addCampInstances(
    textiles,
    'Drying red wool cloths',
    new THREE.BoxGeometry(1, 1, 0.035),
    sharedBuildingDetailMaterial('paintRed'),
    [
      {
        position: new THREE.Vector3(-0.62, 1.3, -3.33),
        rotation: new THREE.Euler(0.03, -0.04, 0.045),
        scale: new THREE.Vector3(0.68, 0.72, 1),
      },
      {
        position: new THREE.Vector3(1.83, 1.25, -3.22),
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
    new THREE.Vector3(0.56, 1.23, -3.28),
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
  omittedGuySide: -1 | 1 | null = null,
): void {
  const shelter = new THREE.Group();
  shelter.name = 'Founding canvas tent';
  shelter.position.set(x, 0, z);
  shelter.rotation.y = yaw;
  shelter.userData.fpCollisionAggregate = true;
  const canvasMaterial = getAgedTentCanvasMaterial(fabricVariant);

  // Submit the five canvas pieces as one shell. They already share one
  // material, so keeping them as separate meshes only multiplied draw calls;
  // the disconnected vertices retain the exact folds, normals, UVs, and bounds.
  const canvasShell = addMesh(
    shelter,
    createAFrameCanvasGeometry(),
    canvasMaterial,
    new THREE.Vector3(),
  );
  canvasShell.name = 'Weathered tent canvas shell';
  addTentRepairPatch(
    shelter,
    fabricVariant % 2 === 0 ? -1 : 1,
    0.2 + (fabricVariant % 3) * 0.08,
    0.54 + (fabricVariant % 2) * 0.08,
    -0.72 + fabricVariant * 0.34,
    sharedBuildingDetailMaterial(fabricVariant === 1 ? 'paintOchre' : 'paintRed'),
  );
  addTentCanvasSeams(shelter);

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
    const outwardZ = zEnd + Math.sign(zEnd) * 1.08;
    addRopeBetween(
      shelter,
      new THREE.Vector3(0, TENT_RIDGE_Y + 0.04, zEnd),
      new THREE.Vector3(0, 0.08, outwardZ),
    );
    addTentStake(shelter, 0, outwardZ);
  }
  for (const side of [-1, 1]) {
    if (side === omittedGuySide) continue;
    for (const zEnd of [-TENT_HALF_DEPTH * 0.86, TENT_HALF_DEPTH * 0.86]) {
      const stakeX = side * (TENT_HALF_WIDTH + 0.55);
      const stakeZ = zEnd + Math.sign(zEnd) * 0.34;
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

function createAFrameCanvasGeometry(): THREE.BufferGeometry {
  const parts = [
    createTentSideGeometry(-1),
    createTentSideGeometry(1),
    createTentTriangleGeometry(
      -TENT_HALF_WIDTH,
      TENT_HALF_WIDTH,
      TENT_HALF_DEPTH,
    ),
    createTentFrontPanelGeometry(-1),
    createTentFrontPanelGeometry(1),
  ];
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  for (const part of parts) {
    const position = part.getAttribute('position');
    const uv = part.getAttribute('uv');
    const index = part.getIndex();
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      positions.push(
        position.getX(vertex),
        position.getY(vertex),
        position.getZ(vertex),
      );
      uvs.push(uv.getX(vertex), uv.getY(vertex));
    }
    if (index) {
      for (let element = 0; element < index.count; element += 1) {
        indices.push(vertexOffset + index.getX(element));
      }
    }
    vertexOffset += position.count;
  }

  return createTentGeometry(positions, indices, uvs);
}

function createTentSideGeometry(side: -1 | 1): THREE.BufferGeometry {
  const acrossSegments = 6;
  const lengthSegments = 12;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let lengthIndex = 0; lengthIndex <= lengthSegments; lengthIndex += 1) {
    const v = lengthIndex / lengthSegments;
    const z = THREE.MathUtils.lerp(-TENT_HALF_DEPTH, TENT_HALF_DEPTH, v);
    const endTension = Math.sin(v * Math.PI);
    for (let acrossIndex = 0; acrossIndex <= acrossSegments; acrossIndex += 1) {
      const u = acrossIndex / acrossSegments;
      const sag = Math.sin(u * Math.PI) * endTension * 0.095;
      const fold = Math.sin(v * Math.PI * 7 + side * 0.57)
        * Math.sin(v * Math.PI)
        * (0.025 + (1 - u) * 0.045);
      const x = side * (
        TENT_HALF_WIDTH * (1 - u)
        + fold * 0.78
      );
      const y = THREE.MathUtils.lerp(TENT_EAVE_Y, TENT_RIDGE_Y, u)
        - sag
        + fold * 0.42;
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

function addTentCanvasSeams(shelter: THREE.Group): void {
  const seams: CampInstance[] = [];
  for (const side of [-1, 1] as const) {
    seams.push(cylinderInstanceBetween(
      new THREE.Vector3(side * TENT_HALF_WIDTH, TENT_EAVE_Y + 0.035, -TENT_HALF_DEPTH),
      new THREE.Vector3(side * TENT_HALF_WIDTH, TENT_EAVE_Y + 0.035, TENT_HALF_DEPTH),
      0.028,
    ));
    for (const z of [-0.82, 0.86]) {
      seams.push(cylinderInstanceBetween(
        new THREE.Vector3(0, TENT_RIDGE_Y + 0.012, z),
        new THREE.Vector3(side * TENT_HALF_WIDTH, TENT_EAVE_Y + 0.025, z),
        0.022,
      ));
    }
  }
  const seamMesh = addCampInstances(
    shelter,
    'Dark stitched canvas edge and tension seams',
    new THREE.CylinderGeometry(1, 1, 1, 5),
    timberMaterial('dark'),
    seams,
  );
  seamMesh.userData.fpNoCollision = true;
}

function cylinderInstanceBetween(
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
): CampInstance {
  const direction = to.clone().sub(from);
  const length = direction.length();
  return {
    position: from.clone().add(to).multiplyScalar(0.5),
    quaternion: new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.normalize(),
    ),
    scale: new THREE.Vector3(radius, length, radius),
  };
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
    0.03,
    timberMaterial('dark'),
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
    new THREE.CylinderGeometry(0.055, 0.082, 0.54, 6),
    timberMaterial('dark'),
    new THREE.Vector3(x, 0.15, z),
    new THREE.Euler(0.17, 0, -0.12),
  );
  stake.name = 'Tent stake';
  stake.userData.fpNoCollision = true;
}

function addTimberStock(parent: THREE.Group): void {
  const stockpile = new THREE.Group();
  stockpile.name = 'FoundingTimberStockpile';
  const winterAccumulationPlacements: CampInstance[] = [];
  const stackSlots = [
    { z: -0.54, y: 0.17 },
    { z: -0.18, y: 0.17 },
    { z: 0.18, y: 0.17 },
    { z: 0.54, y: 0.17 },
    { z: -0.36, y: 0.45 },
    { z: 0, y: 0.45 },
    { z: 0.36, y: 0.45 },
    { z: 0, y: 0.73 },
  ] as const;
  for (let segmentIndex = 0; segmentIndex < FOUNDING_TIMBER_VISUAL_SEGMENTS; segmentIndex += 1) {
    const slot = stackSlots[segmentIndex]!;
    const segment = new THREE.Group();
    segment.name = 'FoundingTimberSegment';
    segment.position.set(-5.2, slot.y, -3.25 + slot.z);
    const yaw = (segmentIndex % 3 - 1) * 0.025;
    winterAccumulationPlacements.push({
      position: new THREE.Vector3(
        segment.position.x,
        segment.position.y + 0.165,
        segment.position.z,
      ),
      rotation: new THREE.Euler(0, yaw, 0),
    });
    const log = addMesh(
      segment,
      new THREE.CylinderGeometry(0.13, 0.16, 3.4, 7),
      timberMaterial(segmentIndex % 3 === 1 ? 'light' : 'mid'),
      new THREE.Vector3(),
      new THREE.Euler(0, yaw, Math.PI * 0.5),
    );
    log.name = 'Triangular founding timber log';
    stockpile.add(segment);
  }
  const winterAccumulation = addCampInstances(
    stockpile,
    FOUNDERS_CAMP_TIMBER_WINTER_ACCUMULATION_NAME,
    createTimberWinterAccumulationGeometry(),
    sharedBuildingMaterial('plasterWhite'),
    winterAccumulationPlacements,
  );
  winterAccumulation.visible = false;
  winterAccumulation.userData.foundersCampWinterAccumulation = true;
  winterAccumulation.userData.fpNoCollision = true;
  parent.add(stockpile);
}

function addStoneStock(parent: THREE.Group): void {
  const stockpile = new THREE.Group();
  stockpile.name = 'FoundingStoneStockpile';
  const winterAccumulationPlacements: CampInstance[] = [];
  for (let index = 0; index < FOUNDING_STONE_VISUAL_SEGMENTS; index += 1) {
    const radius = 0.42 + (index % 3) * 0.08;
    const position = new THREE.Vector3(
      4.2 + (index % 4) * 0.62,
      0.34 + Math.floor(index / 4) * 0.42,
      -3.65,
    );
    const stone = addMesh(
      stockpile,
      new THREE.DodecahedronGeometry(radius, 0),
      stoneMaterial(index % 3 === 0 ? 'light' : 'mid'),
      position,
      new THREE.Euler(index * 0.23, index * 0.41, index * 0.17),
    );
    stone.name = 'FoundingStoneSegment';
    winterAccumulationPlacements.push({
      position: new THREE.Vector3(
        position.x,
        position.y + radius * 0.76,
        position.z,
      ),
      rotation: new THREE.Euler(0, index * 0.49, 0),
      scale: new THREE.Vector3(
        0.88 + (index % 3) * 0.1,
        1,
        0.8 + ((index + 1) % 3) * 0.08,
      ),
    });
  }
  const winterAccumulation = addCampInstances(
    stockpile,
    FOUNDERS_CAMP_STONE_WINTER_ACCUMULATION_NAME,
    createStoneWinterAccumulationGeometry(),
    sharedBuildingMaterial('plasterWhite'),
    winterAccumulationPlacements,
  );
  winterAccumulation.visible = false;
  winterAccumulation.userData.foundersCampWinterAccumulation = true;
  winterAccumulation.userData.fpNoCollision = true;
  parent.add(stockpile);
}

type AssemblyPart = {
  geometry: THREE.BufferGeometry;
  position: THREE.Vector3;
  rotation?: THREE.Euler;
};

function addMergedAssemblyMesh(
  parent: THREE.Group,
  name: string,
  material: THREE.Material,
  parts: readonly AssemblyPart[],
): THREE.Mesh {
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const transformed = parts.map((part) => {
    quaternion.setFromEuler(part.rotation ?? new THREE.Euler());
    matrix.compose(part.position, quaternion, new THREE.Vector3(1, 1, 1));
    return part.geometry.applyMatrix4(matrix);
  });
  const geometry = mergeGeometries(transformed, false);
  for (const part of transformed) part.dispose();
  if (!geometry) throw new Error(`Could not merge ${name}.`);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = addMesh(parent, geometry, material, new THREE.Vector3());
  mesh.name = name;
  return mesh;
}

function addIronworkStock(parent: THREE.Group): void {
  const stockpile = new THREE.Group();
  stockpile.name = 'FoundingIronworkStockpile';
  stockpile.visible = false;
  stockpile.position.set(-4.2, 0, 0);
  stockpile.rotation.y = -0.08;

  for (let index = 0; index < FOUNDING_IRONWORK_VISUAL_SEGMENTS; index += 1) {
    const segment = new THREE.Group();
    segment.name = 'FoundingIronworkSegment';
    const column = index % 3;
    const row = Math.floor(index / 3);
    segment.position.set((column - 1) * 1.02, 0, (row - 0.5) * 0.9);
    segment.rotation.y = (column - 1) * 0.04 + (row === 0 ? -0.03 : 0.03);

    addMergedAssemblyMesh(
      segment,
      'Founding ironwork open crate',
      timberMaterial(index % 2 === 0 ? 'dark' : 'weathered'),
      [
        {
          geometry: new THREE.BoxGeometry(0.96, 0.12, 0.76),
          position: new THREE.Vector3(0, 0.06, 0),
        },
        {
          geometry: new THREE.BoxGeometry(0.76, 0.08, 0.58),
          position: new THREE.Vector3(0, 0.18, 0),
        },
        ...[-0.31, 0.31].map((z) => ({
          geometry: new THREE.BoxGeometry(0.82, 0.38, 0.08),
          position: new THREE.Vector3(0, 0.38, z),
        })),
        ...[-0.37, 0.37].map((x) => ({
          geometry: new THREE.BoxGeometry(0.08, 0.38, 0.54),
          position: new THREE.Vector3(x, 0.38, 0),
        })),
      ],
    );

    addMergedAssemblyMesh(
      segment,
      'Founding ironwork crate reinforcement',
      metalMaterial('iron'),
      [-0.27, 0.27].flatMap((x) => [-0.355, 0.355].map((z) => ({
        geometry: new THREE.BoxGeometry(0.065, 0.34, 0.035),
        position: new THREE.Vector3(x, 0.38, z),
      }))),
    );

    addMergedAssemblyMesh(
      segment,
      'Founding ironwork nested fittings',
      metalMaterial('iron'),
      [
        {
          geometry: new THREE.BoxGeometry(0.56, 0.1, 0.12),
          position: new THREE.Vector3(-0.03, 0.27, -0.13),
          rotation: new THREE.Euler(0, -0.22, 0),
        },
        {
          geometry: new THREE.CylinderGeometry(0.055, 0.055, 0.52, 7),
          position: new THREE.Vector3(0.04, 0.35, 0),
          rotation: new THREE.Euler(0, 0, Math.PI * 0.5),
        },
        {
          geometry: new THREE.BoxGeometry(0.52, 0.1, 0.12),
          position: new THREE.Vector3(0.02, 0.42, 0.11),
          rotation: new THREE.Euler(0, 0.24, 0),
        },
      ],
    );

    stockpile.add(segment);
  }

  parent.add(stockpile);
}

function addTreasuryChest(parent: THREE.Group): void {
  const chest = new THREE.Group();
  chest.name = 'FoundingTreasuryChest';
  chest.position.set(-7, 0, -0.9);

  addMergedAssemblyMesh(
    chest,
    'Founding treasury chest grounded body',
    timberMaterial('dark'),
    [
      {
        geometry: new THREE.BoxGeometry(1.68, 0.62, 0.96),
        position: new THREE.Vector3(0, 0.47, 0),
      },
      {
        geometry: new THREE.BoxGeometry(1.8, 0.12, 1.04),
        position: new THREE.Vector3(0, 0.15, 0),
      },
      ...[-0.58, 0.58].map((x) => ({
        geometry: new THREE.BoxGeometry(0.22, 0.14, 1.02),
        position: new THREE.Vector3(x, 0.07, 0),
      })),
    ],
  );

  const lid = addMesh(
    chest,
    new THREE.CylinderGeometry(0.49, 0.49, 1.68, 12, 1, false, 0, Math.PI),
    timberMaterial('weathered'),
    new THREE.Vector3(0, 0.78, 0),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  lid.name = 'Founding treasury chest arched lid';

  addMergedAssemblyMesh(
    chest,
    'Founding treasury chest iron straps and hinges',
    metalMaterial('iron'),
    [
      ...[-0.55, 0, 0.55].flatMap((x) => [
        {
          geometry: new THREE.BoxGeometry(0.075, 0.58, 0.035),
          position: new THREE.Vector3(x, 0.49, 0.5),
        },
        {
          geometry: new THREE.BoxGeometry(0.075, 0.58, 0.035),
          position: new THREE.Vector3(x, 0.49, -0.5),
        },
        {
          geometry: new THREE.TorusGeometry(0.49, 0.035, 5, 12, Math.PI),
          position: new THREE.Vector3(x, 0.78, 0),
          rotation: new THREE.Euler(0, Math.PI * 0.5, 0),
        },
      ]),
      ...[-0.5, 0.5].map((x) => ({
        geometry: new THREE.CylinderGeometry(0.055, 0.055, 0.28, 7),
        position: new THREE.Vector3(x, 0.75, -0.54),
        rotation: new THREE.Euler(0, 0, Math.PI * 0.5),
      })),
      {
        geometry: new THREE.TorusGeometry(0.11, 0.025, 5, 10, Math.PI),
        position: new THREE.Vector3(0, 0.63, 0.535),
      },
    ],
  );

  addMergedAssemblyMesh(
    chest,
    'Founding treasury chest brass lock plate',
    sharedBuildingDetailMaterial('brass'),
    [
      {
        geometry: new THREE.BoxGeometry(0.28, 0.27, 0.045),
        position: new THREE.Vector3(0, 0.49, 0.525),
      },
      ...[-0.1, 0.1].flatMap((x) => [-0.09, 0.09].map((y) => ({
        geometry: new THREE.SphereGeometry(0.028, 6, 4),
        position: new THREE.Vector3(x, 0.49 + y, 0.555),
      }))),
    ],
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
  litSmokeByCampfire.set(campfire, smoke);
  campfire.userData.litSmokeElapsedSeconds = 0;
  campfire.userData.litSmokeUploadAccumulatorSeconds =
    LIT_SMOKE_UPLOAD_INTERVAL_SECONDS;
}

function animateFirelitCampSmoke(
  campfire: THREE.Group,
  dtSeconds: number,
): void {
  const smoke = litSmokeByCampfire.get(campfire);
  if (!smoke) return;

  const elapsed = Math.max(
    0,
    Number(campfire.userData.litSmokeElapsedSeconds ?? 0) + Math.max(0, dtSeconds),
  );
  campfire.userData.litSmokeElapsedSeconds = elapsed;
  const uploadAccumulator = Math.max(
    0,
    Number(campfire.userData.litSmokeUploadAccumulatorSeconds ?? 0)
      + Math.max(0, dtSeconds),
  );
  if (uploadAccumulator < LIT_SMOKE_UPLOAD_INTERVAL_SECONDS) {
    campfire.userData.litSmokeUploadAccumulatorSeconds = uploadAccumulator;
    return;
  }
  campfire.userData.litSmokeUploadAccumulatorSeconds =
    uploadAccumulator % LIT_SMOKE_UPLOAD_INTERVAL_SECONDS;

  for (let index = 0; index < smoke.count; index += 1) {
    const age = (elapsed * 0.115 + index / smoke.count) % 1;
    const phase = index * 2.37;
    const curl = age * Math.PI * 1.7 + phase;
    const breadth = 0.4 + age * 0.95;
    litSmokePosition.set(
      Math.sin(curl) * (0.1 + age * 0.48) + age * 0.26,
      1.02 + age * 4.25,
      Math.cos(curl * 0.82) * (0.08 + age * 0.34),
    );
    litSmokeQuaternion.setFromAxisAngle(
      litSmokeUpAxis,
      curl * 0.38,
    );
    litSmokeScale.set(
      breadth * 1.03,
      breadth * (1.24 + age * 0.22),
      breadth * 0.82,
    );
    litSmokeMatrix.compose(
      litSmokePosition,
      litSmokeQuaternion,
      litSmokeScale,
    );
    smoke.setMatrixAt(index, litSmokeMatrix);
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
  campfire.position.set(
    FOUNDERS_CAMPFIRE_POSITION.x,
    0,
    FOUNDERS_CAMPFIRE_POSITION.z,
  );

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

export function setFoundersCampWinterAccumulation(
  camp: THREE.Group,
  enabled: boolean,
): void {
  camp.traverse((object) => {
    if (object.userData.foundersCampWinterAccumulation !== true) return;
    object.visible = enabled;
  });
}

export function createFoundersCampMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "Founders' camp and open stockyard";
  group.userData.fpCollisionChildrenOnly = true;

  addCampGrounding(group);
  addFoundingFootTraffic(group);

  const shelters = new THREE.Group();
  shelters.name = 'FoundingShelters';
  FOUNDERS_CAMP_TENT_PLACEMENTS.forEach(({ x, z, yaw }, index) => {
    addAFrameShelter(shelters, x, z, yaw, index);
  });
  group.add(shelters);

  addCampfire(shelters);
  const benchSeatThickness = 0.18;
  const benchSeatDepth = 0.54;
  const benchSeatBottom = FOUNDERS_CAMP_SEAT_SURFACE_HEIGHT
    - benchSeatThickness;
  const benchSeat = addMesh(
    shelters,
    new THREE.BoxGeometry(2.4, benchSeatThickness, benchSeatDepth),
    timberMaterial('weathered'),
    new THREE.Vector3(
      FOUNDERS_CAMP_BENCH_SEAT.supportPosition.x,
      FOUNDERS_CAMP_SEAT_SURFACE_HEIGHT - benchSeatThickness / 2,
      FOUNDERS_CAMP_BENCH_SEAT.supportPosition.z,
    ),
  );
  benchSeat.name = 'Camp bench seat';
  for (const x of [-2.72, -1.08]) {
    const legHeight = benchSeatBottom - 0.02;
    const leg = addMesh(
      shelters,
      new THREE.BoxGeometry(0.18, legHeight, 0.38),
      timberMaterial('dark'),
      new THREE.Vector3(
        x,
        0.02 + legHeight / 2,
        FOUNDERS_CAMP_BENCH_SEAT.supportPosition.z,
      ),
    );
    leg.name = 'Camp bench leg';
  }
  const stumpCapThickness = 0.05;
  const stumpBodyHeight = FOUNDERS_CAMP_SEAT_SURFACE_HEIGHT
    - stumpCapThickness;
  const stumpSeat = addMesh(
    shelters,
    new THREE.CylinderGeometry(0.38, 0.43, stumpBodyHeight, 10),
    timberMaterial('dark'),
    new THREE.Vector3(
      FOUNDERS_CAMP_FIRESIDE_STUMP_SEAT.supportPosition.x,
      stumpBodyHeight / 2,
      FOUNDERS_CAMP_FIRESIDE_STUMP_SEAT.supportPosition.z,
    ),
    new THREE.Euler(0, 0.18, 0),
  );
  stumpSeat.name = 'Camp fireside stump seat';
  const stumpSeatTop = addMesh(
    shelters,
    new THREE.CylinderGeometry(0.37, 0.38, stumpCapThickness, 10),
    timberMaterial('weathered'),
    new THREE.Vector3(
      FOUNDERS_CAMP_FIRESIDE_STUMP_SEAT.supportPosition.x,
      FOUNDERS_CAMP_SEAT_SURFACE_HEIGHT - stumpCapThickness / 2,
      FOUNDERS_CAMP_FIRESIDE_STUMP_SEAT.supportPosition.z,
    ),
    new THREE.Euler(0, 0.18, 0),
  );
  stumpSeatTop.name = 'Camp fireside stump seat top';

  addFoundingProvisions(shelters);
  addFoundingWorkyard(shelters);
  addFoundingUtilityStores(shelters);
  addLivedInTextiles(shelters);
  addFoundersCampWinterAccumulation(shelters);
  addTimberStock(group);
  addStoneStock(group);
  addIronworkStock(group);
  addTreasuryChest(group);
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (
      mesh.isMesh
      && !mesh.name.startsWith('Animated fire')
      && mesh.userData.campGrounding !== true
      && mesh.userData.campSmoke !== true
      && mesh.userData.foundersCampWinterAccumulation !== true
    ) {
      markBuildingDetailShadowCaster(mesh);
    }
  });
  installBuildingDetailCasterBatches(group, 'Founders exact caster batches');
  return group;
}

/** Reuses the founding tents and fire treatment for opt-in rural lodging. */
export function createRemoteWorkCampMesh(): THREE.Group {
  const layout = remoteWorkCampLayout();
  const camp = new THREE.Group();
  camp.name = REMOTE_WORK_CAMP_NAME;
  camp.userData.fpCollisionChildrenOnly = true;

  layout.tents.forEach((tent, index) => {
    // The reusable shelter is authored with its opening on local -Z, while
    // camp placement (and the worker door targets) use local +Z as the side
    // facing the snapped road. Turn only the overnight-camp instances around
    // so their visible openings honor that shared road-facing convention.
    const shelterYaw = tent.yaw + Math.PI;
    // Leave the shared aisle free of crossed guy ropes and doubled stakes.
    // The half-turn reverses each shelter's local X axis, so omit the adjusted
    // inward side and retain the outer guys plus both ridge-end anchors.
    const inwardSide = tent.x < 0 ? -1 : 1;
    addAFrameShelter(camp, tent.x, tent.z, shelterYaw, index + 1, inwardSide);
  });
  const campfire = addCampfire(camp);
  campfire.name = REMOTE_WORK_CAMPFIRE_NAME;
  campfire.position.set(layout.campfire.x, 0, layout.campfire.z);
  camp.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && !mesh.name.startsWith('Animated fire')) {
      markBuildingDetailShadowCaster(mesh);
    }
  });
  installBuildingDetailCasterBatches(camp, 'Remote camp exact caster batches');
  return camp;
}
