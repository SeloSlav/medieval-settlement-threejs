import * as THREE from 'three';
import { mulberry32 } from '../props/forestField.ts';
import type { ForagingNodeState } from '../resources/types.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import type { ForagingSite } from './ForagingLayout.ts';
import { isForagingHarvestAvailable } from './foragingSeason.ts';
import { MUSHROOM_PATCH_MAX_SPAWN_RADIUS } from './foragingYields.ts';

export type MushroomPatchVisuals = {
  group: THREE.Group;
  mushroomCount: number;
  sync: (nodes: Iterable<ForagingNodeState>, month: number) => void;
  updateCameraState: (cameraDistance: number, firstPersonActive: boolean) => void;
  dispose: () => void;
};

type MushroomPlacement = {
  nodeId: string;
  x: number;
  z: number;
  yaw: number;
  scale: number;
  visibilityNoise: number;
};

type MushroomTextureSet = {
  map: THREE.Texture;
  heightMap: THREE.Texture;
  roughnessMap: THREE.Texture;
};

const TAU = Math.PI * 2;
const MUSHROOMS_PER_PATCH = 26;
const RICH_MUSHROOMS_PER_PATCH = 40;
const CLOSE_WORLD_MAX_CAMERA_DISTANCE = 155;
const MUSHROOM_TEXTURE_SIZE = 128;

/** Close-zoom, low-poly mushrooms for persistent deep-forest resource beds. */
export function createMushroomPatchVisuals(
  terrain: Terrain,
  sites: ReadonlyArray<ForagingSite>,
  seed: number,
  isBlockedAt?: (x: number, z: number) => boolean,
  maxAnisotropy = 1,
): MushroomPatchVisuals {
  const mushroomSites = sites.filter((site) => site.kind === 'mushrooms');
  const rng = mulberry32(seed ^ 0x5a17c3);
  const placements = createPlacements(mushroomSites, rng, isBlockedAt);
  const capacity = Math.max(placements.length, 1);

  const stemGeometry = new THREE.CylinderGeometry(0.055, 0.085, 0.42, 7, 1);
  stemGeometry.translate(0, 0.21, 0);
  const capGeometry = new THREE.SphereGeometry(0.24, 9, 5, 0, TAU, 0, Math.PI * 0.56);
  capGeometry.scale(1, 0.55, 1);
  capGeometry.translate(0, 0.43, 0);

  const surfaceTextures = createMushroomSurfaceTextures(maxAnisotropy);

  const stemMaterial = new THREE.MeshStandardMaterial({
    name: 'Mushroom stems',
    map: surfaceTextures.stem.map,
    bumpMap: surfaceTextures.stem.heightMap,
    bumpScale: 0.012,
    roughnessMap: surfaceTextures.stem.roughnessMap,
    color: 0xffffff,
    roughness: 0.96,
    metalness: 0,
  });
  const capMaterial = new THREE.MeshStandardMaterial({
    name: 'Forest mushroom caps',
    map: surfaceTextures.cap.map,
    bumpMap: surfaceTextures.cap.heightMap,
    bumpScale: 0.016,
    roughnessMap: surfaceTextures.cap.roughnessMap,
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0,
  });
  const stems = new THREE.InstancedMesh(stemGeometry, stemMaterial, capacity);
  const caps = new THREE.InstancedMesh(capGeometry, capMaterial, capacity);
  stems.name = 'Harvestable mushroom stems';
  caps.name = 'Harvestable mushroom caps';
  stems.count = placements.length;
  caps.count = placements.length;
  stems.castShadow = false;
  caps.castShadow = false;
  stems.receiveShadow = true;
  caps.receiveShadow = true;
  stems.frustumCulled = false;
  caps.frustumCulled = false;

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const tint = new THREE.Color();
  const baseMatrices: THREE.Matrix4[] = [];
  placements.forEach((placement, index) => {
    position.set(
      placement.x,
      terrain.getHeightAt(placement.x, placement.z) + 0.025,
      placement.z,
    );
    quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.yaw);
    scale.setScalar(placement.scale);
    matrix.compose(position, quaternion, scale);
    baseMatrices.push(matrix.clone());
    stems.setMatrixAt(index, matrix);
    caps.setMatrixAt(index, matrix);
    tint.setHSL(
      THREE.MathUtils.lerp(0.035, 0.095, rng()),
      THREE.MathUtils.lerp(0.14, 0.38, rng()),
      THREE.MathUtils.lerp(0.72, 0.92, rng()),
    );
    caps.setColorAt(index, tint);
  });
  stems.instanceMatrix.needsUpdate = true;
  caps.instanceMatrix.needsUpdate = true;
  if (caps.instanceColor) caps.instanceColor.needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'Deep-forest mushroom resource beds';
  group.userData.mushroomPatchCenters = mushroomSites.map((site, index) => ({
    nodeId: `foraging-mushrooms-${index}`,
    x: site.x,
    z: site.z,
  }));
  group.add(stems, caps);

  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  const sync = (nodes: Iterable<ForagingNodeState>, month: number): void => {
    const byId = new Map(Array.from(nodes, (node) => [node.nodeId, node] as const));
    const seasonAvailable = isForagingHarvestAvailable('mushrooms', month);
    placements.forEach((placement, index) => {
      const node = byId.get(placement.nodeId);
      const ratio = node && node.maxYield > 0
        ? THREE.MathUtils.clamp(node.remaining / node.maxYield, 0, 1)
        : 0;
      const visible = seasonAvailable && placement.visibilityNoise < ratio;
      const next = visible ? baseMatrices[index] : hiddenMatrix;
      stems.setMatrixAt(index, next);
      caps.setMatrixAt(index, next);
    });
    stems.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
  };

  return {
    group,
    mushroomCount: placements.length,
    sync,
    updateCameraState: (cameraDistance, firstPersonActive) => {
      group.visible = firstPersonActive || cameraDistance <= CLOSE_WORLD_MAX_CAMERA_DISTANCE;
    },
    dispose: () => {
      stemGeometry.dispose();
      capGeometry.dispose();
      stemMaterial.dispose();
      capMaterial.dispose();
      for (const texture of [
        surfaceTextures.stem.map,
        surfaceTextures.stem.heightMap,
        surfaceTextures.stem.roughnessMap,
        surfaceTextures.cap.map,
        surfaceTextures.cap.heightMap,
        surfaceTextures.cap.roughnessMap,
      ]) {
        texture.dispose();
      }
    },
  };
}

function createMushroomSurfaceTextures(maxAnisotropy: number): {
  stem: MushroomTextureSet;
  cap: MushroomTextureSet;
} {
  const spotRandom = mulberry32(0x6d757368);
  const spots = Array.from({ length: 28 }, () => ({
    u: spotRandom(),
    v: THREE.MathUtils.lerp(0.08, 0.94, spotRandom()),
    radius: THREE.MathUtils.lerp(0.018, 0.065, spotRandom()),
  }));
  const stem = createCoupledTextureSet(
    'mushroom stem',
    maxAnisotropy,
    THREE.RepeatWrapping,
    (u, v) => {
      const fiber = 0.5 + 0.5 * Math.sin(
        u * TAU * 17
        + Math.sin(v * TAU * 3.2) * 1.3
        + Math.sin(u * TAU * 5 - v * TAU * 2) * 0.45,
      );
      const verticalMottle = 0.5 + 0.5 * Math.sin(v * TAU * 6.3 + u * TAU * 2);
      const basalShade = smoothstep(0.68, 1, 1 - v);
      const height = clamp01(0.48 + fiber * 0.34 + verticalMottle * 0.08);
      return {
        color: [
          219 + fiber * 21 - basalShade * 27,
          207 + fiber * 18 - basalShade * 25,
          171 + fiber * 16 - basalShade * 19,
        ],
        height,
        roughness: clamp01(0.82 + (1 - fiber) * 0.13 + basalShade * 0.04),
      };
    },
  );
  const cap = createCoupledTextureSet(
    'mushroom cap',
    maxAnisotropy,
    THREE.ClampToEdgeWrapping,
    (u, v) => {
      const radialMottle = 0.5 + 0.25 * Math.sin(u * TAU * 7 + v * 13)
        + 0.25 * Math.sin(u * TAU * 13 - v * 21);
      let spotMask = 0;
      for (const spot of spots) {
        const rawDu = Math.abs(u - spot.u);
        const du = Math.min(rawDu, 1 - rawDu);
        const dv = v - spot.v;
        const distance = Math.hypot(du * 0.76, dv);
        spotMask = Math.max(
          spotMask,
          1 - smoothstep(spot.radius * 0.58, spot.radius, distance),
        );
      }
      const crown = smoothstep(0.5, 1, v);
      const rimShade = smoothstep(0.68, 1, 1 - v);
      const height = clamp01(0.44 + radialMottle * 0.2 + spotMask * 0.3 - rimShade * 0.08);
      return {
        color: [
          163 + radialMottle * 35 + spotMask * 65 + crown * 9 - rimShade * 24,
          91 + radialMottle * 26 + spotMask * 105 + crown * 5 - rimShade * 20,
          45 + radialMottle * 18 + spotMask * 105 - rimShade * 14,
        ],
        height,
        roughness: clamp01(0.73 + radialMottle * 0.12 + spotMask * 0.11),
      };
    },
  );
  return { stem, cap };
}

function createCoupledTextureSet(
  name: string,
  maxAnisotropy: number,
  wrapT: THREE.Wrapping,
  sample: (u: number, v: number) => {
    color: [number, number, number];
    height: number;
    roughness: number;
  },
): MushroomTextureSet {
  const colorData = new Uint8Array(MUSHROOM_TEXTURE_SIZE * MUSHROOM_TEXTURE_SIZE * 4);
  const heightData = new Uint8Array(colorData.length);
  const roughnessData = new Uint8Array(colorData.length);
  for (let y = 0; y < MUSHROOM_TEXTURE_SIZE; y++) {
    for (let x = 0; x < MUSHROOM_TEXTURE_SIZE; x++) {
      const u = x / (MUSHROOM_TEXTURE_SIZE - 1);
      const v = y / (MUSHROOM_TEXTURE_SIZE - 1);
      const texel = sample(u, v);
      const index = (y * MUSHROOM_TEXTURE_SIZE + x) * 4;
      writeColor(colorData, index, texel.color);
      writeGray(heightData, index, texel.height);
      writeGray(roughnessData, index, texel.roughness);
    }
  }
  return {
    map: createDataTexture(colorData, `${name} albedo`, maxAnisotropy, wrapT, true),
    heightMap: createDataTexture(heightData, `${name} height`, maxAnisotropy, wrapT, false),
    roughnessMap: createDataTexture(
      roughnessData,
      `${name} roughness`,
      maxAnisotropy,
      wrapT,
      false,
    ),
  };
}

function createDataTexture(
  data: Uint8Array,
  name: string,
  maxAnisotropy: number,
  wrapT: THREE.Wrapping,
  srgb: boolean,
): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    data,
    MUSHROOM_TEXTURE_SIZE,
    MUSHROOM_TEXTURE_SIZE,
    THREE.RGBAFormat,
  );
  texture.name = name;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = wrapT;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.max(1, Math.min(8, maxAnisotropy));
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function writeColor(
  data: Uint8Array,
  index: number,
  color: [number, number, number],
): void {
  data[index] = clampByte(color[0]);
  data[index + 1] = clampByte(color[1]);
  data[index + 2] = clampByte(color[2]);
  data[index + 3] = 255;
}

function writeGray(data: Uint8Array, index: number, value: number): void {
  const byte = clampByte(value * 255);
  data[index] = byte;
  data[index + 1] = byte;
  data[index + 2] = byte;
  data[index + 3] = 255;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(edge1 - edge0, 1e-6));
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampByte(value: number): number {
  return Math.round(Math.max(0, Math.min(255, value)));
}

function createPlacements(
  sites: ReadonlyArray<ForagingSite>,
  random: () => number,
  isBlockedAt?: (x: number, z: number) => boolean,
): MushroomPlacement[] {
  const placements: MushroomPlacement[] = [];
  sites.forEach((site, siteIndex) => {
    const patch: MushroomPlacement[] = [];
    const targetCount = site.isRich ? RICH_MUSHROOMS_PER_PATCH : MUSHROOMS_PER_PATCH;
    let attempts = 0;
    while (patch.length < targetCount && attempts < targetCount * 24) {
      attempts++;
      const radius = Math.sqrt(random()) * MUSHROOM_PATCH_MAX_SPAWN_RADIUS;
      const angle = random() * TAU;
      const x = site.x + Math.cos(angle) * radius;
      const z = site.z + Math.sin(angle) * radius * 0.82;
      if (isBlockedAt?.(x, z)) continue;
      if (patch.some((entry) => Math.hypot(entry.x - x, entry.z - z) < 0.62)) continue;
      patch.push({
        nodeId: `foraging-mushrooms-${siteIndex}`,
        x,
        z,
        yaw: random() * TAU,
        scale: THREE.MathUtils.lerp(0.72, 1.42, random()),
        visibilityNoise: random(),
      });
    }
    placements.push(...patch);
  });
  return placements;
}
