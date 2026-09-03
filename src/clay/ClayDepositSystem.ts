import * as THREE from 'three';
import type { ResourceNodeState } from '../resources/types.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import { StaticInstancedShadowBatch } from '../scene/StaticInstancedShadowBatch.ts';
import {
  clayDepositNodeId,
  type ClayDepositLayout,
  type ClayDepositSite,
} from './ClayDepositLayout.ts';

export type ClayDepositSystem = {
  group: THREE.Group;
  syncNodes: (nodes: Iterable<ResourceNodeState>) => boolean;
  isBlockedAt: (x: number, z: number) => boolean;
  isGrassBlockedAt: (x: number, z: number) => boolean;
  dispose: () => void;
};

const CLAY_COLORS = [0x8f5338, 0xa96643, 0xc18155] as const;
const CLAY_TEXTURE_SIZE = 64;

type ClayTextureSet = {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
};

type ClayDepositVisual = {
  nodeId: string;
  isRich: boolean;
  clods: THREE.Mesh[];
};

export function createClayDepositSystem(
  terrain: Terrain,
  layout: ClayDepositLayout,
): ClayDepositSystem {
  const group = new THREE.Group();
  group.name = 'Clay deposits';
  const textures = createClayTextureSet();
  const materials = CLAY_COLORS.map((color, index) =>
    new THREE.MeshStandardMaterial({
      color,
      map: textures.map,
      normalMap: textures.normalMap,
      roughnessMap: textures.roughnessMap,
      normalScale: new THREE.Vector2(0.46, 0.46),
      roughness: 0.94 - index * 0.03,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1 - index,
      polygonOffsetUnits: -1 - index,
    })
  );
  const clodGeometry = new THREE.DodecahedronGeometry(1, 0);
  for (const material of materials) {
    material.userData.claySurface = {
      revision: 'alluvial-clay-v2',
      textureSize: CLAY_TEXTURE_SIZE,
      detail: 'granular-clods-with-fine-drying-cracks',
    };
  }

  const visuals: ClayDepositVisual[] = layout.sites.map((site, index) => {
    const visual = createClayDepositVisual(terrain, site, materials, clodGeometry);
    group.add(visual.group);
    return {
      nodeId: clayDepositNodeId(site, index),
      isRich: site.kind === 'rich',
      clods: visual.clods,
    };
  });
  const shadowBatch = new StaticInstancedShadowBatch(
    group,
    visuals.flatMap((visual) => visual.clods),
    'Clay deposit exact caster batches',
  );

  return {
    group,
    syncNodes: (nodes) => {
      const byId = new Map([...nodes].map((node) => [node.nodeId, node]));
      let changed = false;
      for (const visual of visuals) {
        const node = byId.get(visual.nodeId);
        const hasExposedClay = visual.isRich
          || !node
          || node.remaining > 1e-6;
        for (const clod of visual.clods) {
          if (clod.visible === hasExposedClay) continue;
          clod.visible = hasExposedClay;
          changed = true;
        }
      }
      if (changed) shadowBatch.rebuild();
      return changed;
    },
    isBlockedAt: (x, z) => layout.isBlockedForProps(x, z),
    isGrassBlockedAt: (x, z) => layout.isBlockedForGrass(x, z),
    dispose: () => {
      shadowBatch.dispose();
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      for (const material of materials) material.dispose();
      textures.map.dispose();
      textures.normalMap.dispose();
      textures.roughnessMap.dispose();
    },
  };
}

function createClayDepositVisual(
  terrain: Terrain,
  site: ClayDepositSite,
  materials: readonly THREE.MeshStandardMaterial[],
  clodGeometry: THREE.BufferGeometry,
): { group: THREE.Group; clods: THREE.Mesh[] } {
  const group = new THREE.Group();
  const gradeLabel = site.kind === 'rich' ? 'rich' : 'ordinary';
  const formationLabel = site.formation === 'coastal'
    ? 'coastal'
    : site.formation === 'inland_basin'
      ? 'inland-basin'
      : 'alluvial';
  group.name = `Exposed ${gradeLabel} ${formationLabel} clay`;

  const clods = createClayClods(terrain, site, materials, clodGeometry);
  group.add(...clods);

  return { group, clods };
}

function createClayClods(
  terrain: Terrain,
  site: ClayDepositSite,
  materials: readonly THREE.MeshStandardMaterial[],
  clodGeometry: THREE.BufferGeometry,
): THREE.Mesh[] {
  const clods: THREE.Mesh[] = [];
  const count = site.kind === 'rich' ? 18 : 11;
  const seed = Math.round(site.x * 97)
    ^ Math.round(site.z * 193)
    ^ (site.kind === 'rich' ? 0x6d2b79f5 : 0x29c3);
  const cos = Math.cos(site.rotation);
  const sin = Math.sin(site.rotation);

  for (let index = 0; index < count; index++) {
    const angle = pseudoRandom(seed, index * 4) * Math.PI * 2;
    const radius = Math.sqrt(pseudoRandom(seed, index * 4 + 1)) * 0.82;
    const localX = Math.cos(angle) * site.radiusX * radius;
    const localZ = Math.sin(angle) * site.radiusZ * radius;
    const x = site.x + localX * cos - localZ * sin;
    const z = site.z + localX * sin + localZ * cos;
    const size = (site.kind === 'rich' ? 0.86 : 0.72)
      * (0.62 + pseudoRandom(seed, index * 4 + 2) * 0.72);
    const verticalScale = size * (0.48 + pseudoRandom(seed, index * 4 + 3) * 0.22);
    const clod = new THREE.Mesh(
      clodGeometry,
      materials[1 + index % (materials.length - 1)],
    );
    clod.name = `${site.kind === 'rich' ? 'Rich' : 'Ordinary'} clay clod ${index + 1}`;
    clod.position.set(x, terrain.getHeightAt(x, z) + verticalScale * 0.42, z);
    clod.rotation.set(
      (pseudoRandom(seed ^ 0x5a17, index) - 0.5) * 0.3,
      angle,
      (pseudoRandom(seed ^ 0x71c9, index) - 0.5) * 0.3,
    );
    clod.scale.set(size * 1.18, verticalScale, size * 0.92);
    clod.castShadow = true;
    clod.receiveShadow = true;
    clods.push(clod);
  }

  return clods;
}

function createClayTextureSet(): ClayTextureSet {
  const size = CLAY_TEXTURE_SIZE;
  const height = new Float32Array(size * size);
  const cracks = new Float32Array(size * size);
  const pits = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  const seed = 0x5c71;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const broad = periodicClayNoise(u, v, 3, seed);
      const medium = periodicClayNoise(u, v, 8, seed ^ 0x39d7);
      const fine = periodicClayNoise(u, v, 21, seed ^ 0x714b);
      const crack = 1 - THREE.MathUtils.smoothstep(
        Math.abs(medium - (0.47 + (broad - 0.5) * 0.08)),
        0.007,
        0.034,
      );
      const pit = Math.pow(THREE.MathUtils.clamp((0.24 - fine) * 3.2, 0, 1), 2);
      const pixel = y * size + x;
      cracks[pixel] = crack;
      pits[pixel] = pit;
      height[pixel] = (broad - 0.5) * 0.075
        + (medium - 0.5) * 0.032
        + (fine - 0.5) * 0.014
        - crack * 0.028
        - pit * 0.022;
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const pixel = y * size + x;
      const offset = pixel * 4;
      const u = x / size;
      const v = y / size;
      const broad = periodicClayNoise(u, v, 3, seed);
      const fine = periodicClayNoise(u, v, 21, seed ^ 0x714b);
      const crack = cracks[pixel];
      const pit = pits[pixel];
      const value = THREE.MathUtils.clamp(
        0.92 + (broad - 0.5) * 0.16 + (fine - 0.5) * 0.075
          - crack * 0.075 - pit * 0.075,
        0.7,
        1,
      );
      albedo[offset] = clayByte(value);
      albedo[offset + 1] = clayByte(value * 0.985);
      albedo[offset + 2] = clayByte(value * 0.955);
      albedo[offset + 3] = 255;

      const hLeft = height[y * size + ((x - 1 + size) % size)];
      const hRight = height[y * size + ((x + 1) % size)];
      const hDown = height[((y - 1 + size) % size) * size + x];
      const hUp = height[((y + 1) % size) * size + x];
      const nx = (hLeft - hRight) * 1.55;
      const ny = (hDown - hUp) * 1.55;
      const inverseLength = 1 / Math.hypot(nx, ny, 1);
      normal[offset] = clayByte(nx * inverseLength * 0.5 + 0.5);
      normal[offset + 1] = clayByte(ny * inverseLength * 0.5 + 0.5);
      normal[offset + 2] = clayByte(inverseLength * 0.5 + 0.5);
      normal[offset + 3] = 255;

      const roughnessValue = THREE.MathUtils.clamp(
        0.86 + (1 - fine) * 0.08 + crack * 0.045 + pit * 0.035,
        0.84,
        1,
      );
      const roughnessByte = clayByte(roughnessValue);
      roughness[offset] = roughnessByte;
      roughness[offset + 1] = roughnessByte;
      roughness[offset + 2] = roughnessByte;
      roughness[offset + 3] = 255;
    }
  }

  return {
    map: createClayDataTexture(albedo, size, 'Clay granular albedo', true),
    normalMap: createClayDataTexture(normal, size, 'Clay granular normal', false),
    roughnessMap: createClayDataTexture(roughness, size, 'Clay granular roughness', false),
  };
}

function createClayDataTexture(
  data: Uint8Array,
  size: number,
  name: string,
  srgb: boolean,
): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = name;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6.5, 6.5);
  texture.anisotropy = 2;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function periodicClayNoise(
  u: number,
  v: number,
  cells: number,
  seed: number,
): number {
  const px = u * cells;
  const py = v * cells;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = (x0 + 1) % cells;
  const y1 = (y0 + 1) % cells;
  const wrappedX0 = ((x0 % cells) + cells) % cells;
  const wrappedY0 = ((y0 % cells) + cells) % cells;
  const tx = smoothClayNoiseStep(px - x0);
  const ty = smoothClayNoiseStep(py - y0);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(
      clayGridNoise(wrappedX0, wrappedY0, seed),
      clayGridNoise(x1, wrappedY0, seed),
      tx,
    ),
    THREE.MathUtils.lerp(
      clayGridNoise(wrappedX0, y1, seed),
      clayGridNoise(x1, y1, seed),
      tx,
    ),
    ty,
  );
}

function smoothClayNoiseStep(value: number): number {
  return value * value * (3 - 2 * value);
}

function clayGridNoise(x: number, y: number, seed: number): number {
  let value = Math.imul(x + 17, 0x1f123bb5)
    ^ Math.imul(y + 31, 0x5f356495)
    ^ Math.imul(seed, 0x6c8e9cf5);
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
}

function clayByte(value: number): number {
  return Math.round(THREE.MathUtils.clamp(value, 0, 1) * 255);
}

function pseudoRandom(seed: number, index: number): number {
  let value = (seed + Math.imul(index + 1, 0x6d2b79f5)) | 0;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
}
