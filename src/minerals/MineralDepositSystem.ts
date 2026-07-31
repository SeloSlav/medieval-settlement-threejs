import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import type { ResourceNodeState } from '../resources/types.ts';
import type {
  MineralDepositLayout,
  MineralDepositResource,
  MineralDepositSite,
} from './MineralDepositLayout.ts';
import {
  mineralDepositNodeId,
} from './MineralDepositLayout.ts';

type SiteVisual = {
  nodeId: string;
  grade: MineralDepositSite['grade'];
  stones: THREE.Mesh[];
};

type WeatheredTextureSet = {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
};

type MineralSurfaceStyle = {
  materials: Record<MineralDepositResource, THREE.MeshStandardMaterial[]>;
  geometries: THREE.BufferGeometry[];
  textures: THREE.DataTexture[];
};

export type MineralDepositSystem = {
  group: THREE.Group;
  syncNodes: (nodes: Iterable<ResourceNodeState>) => boolean;
  isBlockedAt: (x: number, z: number) => boolean;
  isGrassBlockedAt: (x: number, z: number) => boolean;
  dispose: () => void;
};

const MATERIAL_COLORS: Record<MineralDepositResource, readonly [number, number]> = {
  iron: [0x6a4032, 0x98583d],
  salt: [0xbeb9a7, 0xddd8c8],
};

const TAU = Math.PI * 2;
const WEATHER_TEXTURE_SIZE = 64;

export function createMineralDepositSystem(
  terrain: Terrain,
  layout: MineralDepositLayout,
): MineralDepositSystem {
  const group = new THREE.Group();
  group.name = 'Mineral deposits';
  const surfaceStyle = createSurfaceStyle();
  const { materials, geometries } = surfaceStyle;
  const visuals: SiteVisual[] = layout.sites.map((site, index) => {
    const visual = createSiteVisual(terrain, site, index, materials, geometries);
    group.add(visual.group);
    return {
      nodeId: mineralDepositNodeId(site, index),
      grade: site.grade,
      stones: visual.stones,
    };
  });

  return {
    group,
    syncNodes: (nodes) => {
      const byId = new Map([...nodes].map((node) => [node.nodeId, node]));
      let changed = false;
      for (const visual of visuals) {
        const node = byId.get(visual.nodeId);
        const visibleShare = visual.grade === 'rich' || !node
          ? 1
          : Math.max(0, Math.min(1, node.remaining / Math.max(1, node.maxYield)));
        const visibleCount = Math.ceil(visual.stones.length * visibleShare);
        visual.stones.forEach((stone, index) => {
          const visible = index < visibleCount;
          if (stone.visible !== visible) {
            stone.visible = visible;
            changed = true;
          }
        });
      }
      return changed;
    },
    isBlockedAt: (x, z) => layout.isBlockedForProps(x, z),
    isGrassBlockedAt: (x, z) => layout.isBlockedForGrass(x, z),
    dispose: () => {
      for (const geometry of geometries) geometry.dispose();
      for (const material of Object.values(materials).flat()) material.dispose();
      for (const texture of surfaceStyle.textures) texture.dispose();
    },
  };
}

function createSurfaceStyle(): MineralSurfaceStyle {
  const ironTextures = createWeatheredTextureSet('iron');
  const saltTextures = createWeatheredTextureSet('salt');
  const textureSets: Record<MineralDepositResource, WeatheredTextureSet> = {
    iron: ironTextures,
    salt: saltTextures,
  };
  const materials = {
    iron: MATERIAL_COLORS.iron.map((color, index) =>
      new THREE.MeshStandardMaterial({
        color,
        map: ironTextures.map,
        normalMap: ironTextures.normalMap,
        roughnessMap: ironTextures.roughnessMap,
        roughness: 0.98 - index * 0.04,
        metalness: 0.04 + index * 0.03,
      })
    ),
    salt: MATERIAL_COLORS.salt.map((color, index) =>
      new THREE.MeshStandardMaterial({
        color,
        map: saltTextures.map,
        normalMap: saltTextures.normalMap,
        roughnessMap: saltTextures.roughnessMap,
        roughness: 0.96 - index * 0.04,
        metalness: 0,
      })
    ),
  };
  for (const resource of ['iron', 'salt'] as const) {
    for (const material of materials[resource]) {
      material.normalScale.set(0.46, 0.46);
      material.userData.weatheredMineralSurface = {
        resource,
        textureSize: WEATHER_TEXTURE_SIZE,
        static: true,
      };
    }
  }

  return {
    materials,
    geometries: [4.7, 13.1, 29.3].map(createWeatheredOutcropGeometry),
    textures: Object.values(textureSets).flatMap((set) => [
      set.map,
      set.normalMap,
      set.roughnessMap,
    ]),
  };
}

function createSiteVisual(
  terrain: Terrain,
  site: MineralDepositSite,
  siteIndex: number,
  materials: Record<MineralDepositResource, THREE.MeshStandardMaterial[]>,
  geometries: THREE.BufferGeometry[],
): { group: THREE.Group; stones: THREE.Mesh[] } {
  const group = new THREE.Group();
  group.name = `${site.grade === 'rich' ? 'Rich ' : ''}${site.resource} deposit`;
  const stones: THREE.Mesh[] = [];
  const count = site.grade === 'rich' ? 18 : 10;
  const seed = ((siteIndex + 1) * 0x9e3779b1) ^ Math.round(site.x * 97) ^ Math.round(site.z * 193);

  for (let index = 0; index < count; index++) {
    const angle = pseudoRandom(seed, index * 3) * Math.PI * 2;
    const radius = Math.sqrt(pseudoRandom(seed, index * 3 + 1)) * 0.78;
    const localX = Math.cos(angle) * site.radiusX * radius;
    const localZ = Math.sin(angle) * site.radiusZ * radius;
    const cos = Math.cos(site.rotation);
    const sin = Math.sin(site.rotation);
    const x = site.x + localX * cos - localZ * sin;
    const z = site.z + localX * sin + localZ * cos;
    const scale = (site.grade === 'rich' ? 1.15 : 0.9)
      * (0.68 + pseudoRandom(seed, index * 3 + 2) * 0.82);
    const geometryIndex = (
      index + Math.floor(pseudoRandom(seed ^ 0x4f1b, index) * geometries.length)
    ) % geometries.length;
    const stone = new THREE.Mesh(
      geometries[geometryIndex],
      materials[site.resource][index % materials[site.resource].length],
    );
    stone.name = `${site.resource} outcrop ${index + 1}`;
    stone.position.set(
      x,
      terrain.getHeightAt(x, z)
        + scale * (0.15 + pseudoRandom(seed ^ 0x73c1, index) * 0.04),
      z,
    );
    stone.rotation.set(
      (pseudoRandom(seed ^ 0x5a17, index) - 0.5) * 0.24,
      angle,
      (pseudoRandom(seed ^ 0x29c3, index) - 0.5) * 0.2,
    );
    stone.scale.set(
      scale * (0.96 + pseudoRandom(seed ^ 0x3d67, index) * 0.3),
      scale * (0.58 + pseudoRandom(seed ^ 0x8b31, index) * 0.22),
      scale * (0.84 + pseudoRandom(seed ^ 0x1ca7, index) * 0.34),
    );
    stone.castShadow = true;
    stone.receiveShadow = true;
    stone.userData.mineralSurface = {
      resource: site.resource,
      weathered: true,
      grounded: true,
      geometryVariant: geometryIndex,
    };
    stones.push(stone);
    group.add(stone);
  }
  return { group, stones };
}

function createWeatheredTextureSet(resource: MineralDepositResource): WeatheredTextureSet {
  const size = WEATHER_TEXTURE_SIZE;
  const texelCount = size * size;
  const height = new Float32Array(texelCount);
  const albedo = new Uint8Array(texelCount * 4);
  const normal = new Uint8Array(texelCount * 4);
  const roughness = new Uint8Array(texelCount * 4);
  const seed = resource === 'iron' ? 2.37 : 5.81;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const broad =
        Math.sin(TAU * (u * 3 + v * 2) + seed) * 0.24
        + Math.cos(TAU * (u * 5 - v * 4) - seed * 0.7) * 0.16;
      const grain =
        Math.sin(TAU * (u * 17 + v * 13) + seed * 2.1) * 0.09
        + Math.cos(TAU * (u * 23 - v * 19) - seed * 1.4) * 0.06;
      const pittingWave = Math.sin(TAU * (u * 7 + v * 9) + seed * 3.3)
        * Math.cos(TAU * (u * 11 - v * 5) - seed);
      const pitting = Math.pow(Math.max(0, pittingWave), 5) * 0.28;
      height[y * size + x] = broad + grain - pitting;
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const pixel = y * size + x;
      const offset = pixel * 4;
      const h = height[pixel];
      const crevice = THREE.MathUtils.clamp((-h - 0.05) * 2.7, 0, 1);
      const lichenWave =
        Math.sin(TAU * (x / size * 2 - y / size * 3) + seed * 0.8)
        + Math.cos(TAU * (x / size * 4 + y / size * 2) - seed * 1.7);
      const lichen = THREE.MathUtils.clamp((lichenWave - 0.45) * 0.58, 0, 1);
      const value = THREE.MathUtils.clamp(0.84 + h * 0.22 - crevice * 0.2, 0.5, 1);
      const dirt = THREE.MathUtils.clamp(crevice * 0.7 + lichen * 0.28, 0, 1);
      const tint = resource === 'iron'
        ? [value, value * (0.82 - dirt * 0.08), value * (0.71 - dirt * 0.07)]
        : [value * (0.99 - dirt * 0.08), value * (0.97 - dirt * 0.05), value * (0.91 - dirt * 0.1)];

      albedo[offset] = toByte(tint[0]);
      albedo[offset + 1] = toByte(tint[1]);
      albedo[offset + 2] = toByte(tint[2]);
      albedo[offset + 3] = 255;

      const hLeft = height[y * size + ((x - 1 + size) % size)];
      const hRight = height[y * size + ((x + 1) % size)];
      const hDown = height[((y - 1 + size) % size) * size + x];
      const hUp = height[((y + 1) % size) * size + x];
      const nx = (hLeft - hRight) * 1.9;
      const ny = (hDown - hUp) * 1.9;
      const invLength = 1 / Math.hypot(nx, ny, 1);
      normal[offset] = toByte(nx * invLength * 0.5 + 0.5);
      normal[offset + 1] = toByte(ny * invLength * 0.5 + 0.5);
      normal[offset + 2] = toByte(invLength * 0.5 + 0.5);
      normal[offset + 3] = 255;

      const roughnessValue = THREE.MathUtils.clamp(0.82 + crevice * 0.13 + lichen * 0.09, 0, 1);
      const roughnessByte = toByte(roughnessValue);
      roughness[offset] = roughnessByte;
      roughness[offset + 1] = roughnessByte;
      roughness[offset + 2] = roughnessByte;
      roughness[offset + 3] = 255;
    }
  }

  const map = createDataTexture(albedo, size, `${resource} weathered albedo`, true);
  const normalMap = createDataTexture(normal, size, `${resource} weathered normal`, false);
  const roughnessMap = createDataTexture(roughness, size, `${resource} weathered roughness`, false);
  return { map, normalMap, roughnessMap };
}

function createDataTexture(
  data: Uint8Array,
  size: number,
  name: string,
  srgb: boolean,
): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = name;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.65, 1.65);
  texture.anisotropy = 2;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createWeatheredOutcropGeometry(seed: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const point = new THREE.Vector3();
  const uvs: number[] = [];

  for (let index = 0; index < position.count; index++) {
    point.fromBufferAttribute(position, index).normalize();
    const radialNoise =
      stableSurfaceNoise(point, seed) * 0.24
      + Math.sin(point.x * 7.1 + point.z * 4.3 + seed) * 0.07;
    point.multiplyScalar(0.84 + radialNoise);
    point.x *= 0.94 + stableSurfaceNoise(point, seed + 7.3) * 0.18;
    point.z *= 0.92 + stableSurfaceNoise(point, seed + 14.9) * 0.2;
    point.y *= 0.76 + stableSurfaceNoise(point, seed + 22.7) * 0.14;
    if (point.y < -0.16) {
      point.y = THREE.MathUtils.lerp(point.y, -0.28, 0.68);
      point.x *= 1.06;
      point.z *= 1.06;
    }
    position.setXYZ(index, point.x, point.y, point.z);
    uvs.push(
      Math.atan2(point.z, point.x) / TAU + 0.5,
      THREE.MathUtils.clamp(point.y * 0.5 + 0.5, 0, 1),
    );
  }

  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function stableSurfaceNoise(point: THREE.Vector3, seed: number): number {
  const value = Math.sin(
    point.x * 127.1 + point.y * 311.7 + point.z * 74.7 + seed * 19.19,
  ) * 43758.5453123;
  return value - Math.floor(value);
}

function toByte(value: number): number {
  return Math.round(THREE.MathUtils.clamp(value, 0, 1) * 255);
}

function pseudoRandom(seed: number, index: number): number {
  let value = (seed + Math.imul(index + 1, 0x6d2b79f5)) | 0;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
}
