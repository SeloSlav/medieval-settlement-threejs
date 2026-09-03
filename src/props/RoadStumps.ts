import * as THREE from 'three';
import type { RoadEdge } from '../roads/RoadEdge.ts';
import { chainMaterialShaderPatch } from '../scene/materialShaderPatch.ts';
import { distancePointToPolylineXZ } from '../utils/pathGeometry.ts';

type StumpPlacement = {
  species: string;
};

type StumpSlot = {
  mesh: THREE.InstancedMesh;
  /** Dense draw index, or -1 while this tree has no visible stump. */
  instanceIndex: number;
};

type StumpTextureSet = {
  map: THREE.Texture;
  heightMap: THREE.Texture;
  roughnessMap: THREE.Texture;
};

export type HarvestStumpBarkSource = {
  key: string;
  name: string;
  map: THREE.Texture;
  normalMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
};

export type HarvestStumpBarkResolver = (
  gameplaySpecies: string,
) => HarvestStumpBarkSource | null;

export type HarvestStumpInstances = {
  group: THREE.Group;
  meshes: THREE.InstancedMesh[];
  slots: StumpSlot[];
  activeLayoutIndices: Map<THREE.InstancedMesh, number[]>;
  dirtyMeshes: Set<THREE.InstancedMesh>;
  ownedMaterials: THREE.Material[];
  ownedTextures: THREE.Texture[];
  cutFaceMaterial: THREE.MeshStandardMaterial;
  snowCoverage: number;
};

const STUMP_RADIAL_SEGMENTS = 12;
const STUMP_TEXTURE_SIZE = 128;

/**
 * Harvest sites are gameplay information, including in the default 240 m RTS
 * view and the outermost ~346 m live-world zoom. Cull only beyond that envelope;
 * sparse instance prefixes keep the cost proportional to actual cut trees.
 */
export const HARVEST_STUMP_HIDE_DISTANCE = 384;

/** Re-enter slightly closer than the hide boundary to avoid wheel-zoom flicker. */
export const HARVEST_STUMP_SHOW_DISTANCE = 360;

export function shouldShowHarvestStumps(
  currentlyVisible: boolean,
  cameraDistance: number,
  firstPersonActive: boolean,
): boolean {
  if (firstPersonActive) return true;
  if (!Number.isFinite(cameraDistance)) return false;
  const threshold = currentlyVisible
    ? HARVEST_STUMP_HIDE_DISTANCE
    : HARVEST_STUMP_SHOW_DISTANCE;
  return cameraDistance <= threshold;
}

/**
 * Keeps felled-tree bark tied to the same cached species textures as the live
 * SeedThree tree. A bucket is submitted only while that species has a visible
 * stump, so exact bark identity does not add idle forest draw calls.
 */
export function createHarvestStumpInstances(
  placements: ReadonlyArray<StumpPlacement>,
  maxAnisotropy = 1,
  resolveBark?: HarvestStumpBarkResolver,
): HarvestStumpInstances {
  const group = new THREE.Group();
  group.name = 'Harvest stumps';
  const meshes: THREE.InstancedMesh[] = [];
  const slots: StumpSlot[] = Array.from({ length: placements.length });
  const activeLayoutIndices = new Map<THREE.InstancedMesh, number[]>();
  const dirtyMeshes = new Set<THREE.InstancedMesh>();
  const ownedMaterials: THREE.Material[] = [];
  const ownedTextures: THREE.Texture[] = [];
  const cutFaceTextures = createCutFaceTextureSet(maxAnisotropy);
  const cutFaceMaterial = new THREE.MeshStandardMaterial({
    name: 'Fresh stump growth rings',
    map: cutFaceTextures.map,
    bumpMap: cutFaceTextures.heightMap,
    bumpScale: 0.018,
    roughnessMap: cutFaceTextures.roughnessMap,
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0,
  });
  const cutFaceSnowCoverage = { value: 0 };
  cutFaceMaterial.userData.harvestStumpSnowCoverage = cutFaceSnowCoverage;
  chainMaterialShaderPatch(cutFaceMaterial, 'harvest-stump-snow-v1', (shader) => {
    shader.uniforms.uHarvestStumpSnowCoverage = cutFaceSnowCoverage;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
uniform float uHarvestStumpSnowCoverage;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  vec3( 0.92, 0.955, 0.98 ),
  uHarvestStumpSnowCoverage * 0.86
);`,
    );
  });
  cutFaceMaterial.needsUpdate = true;
  ownedMaterials.push(cutFaceMaterial);
  ownedTextures.push(
    cutFaceTextures.map,
    cutFaceTextures.heightMap,
    cutFaceTextures.roughnessMap,
  );

  const buckets = new Map<string, {
    name: string;
    source: HarvestStumpBarkSource | null;
    layoutIndices: number[];
  }>();
  placements.forEach((placement, layoutIndex) => {
    const source = resolveBark?.(placement.species) ?? null;
    const key = source?.key ?? fallbackBarkKey(placement.species);
    const bucket = buckets.get(key) ?? {
      name: source?.name ?? fallbackBarkName(key),
      source,
      layoutIndices: [],
    };
    bucket.layoutIndices.push(layoutIndex);
    buckets.set(key, bucket);
  });

  for (const [key, bucket] of buckets) {
    const { layoutIndices, source } = bucket;
    let barkMap = source?.map ?? null;
    let barkNormal = source?.normalMap ?? null;
    let barkRoughness = source?.roughnessMap ?? null;
    let fallbackHeightMap: THREE.Texture | null = null;

    if (!barkMap) {
      const fallback = createFallbackBarkTextureSet(key, maxAnisotropy);
      barkMap = fallback.map;
      barkRoughness = fallback.roughnessMap;
      fallbackHeightMap = fallback.heightMap;
      ownedTextures.push(fallback.map, fallback.heightMap, fallback.roughnessMap);
    }

    const barkMaterial = new THREE.MeshStandardMaterial({
      name: `Felled ${bucket.name} bark`,
      map: barkMap,
      normalMap: barkNormal,
      normalScale: new THREE.Vector2(0.72, 0.72),
      bumpMap: fallbackHeightMap,
      bumpScale: fallbackHeightMap ? 0.035 : 0,
      roughnessMap: barkRoughness,
      color: 0xffffff,
      roughness: 0.96,
      metalness: 0,
    });
    ownedMaterials.push(barkMaterial);

    const geometry = createStumpGeometry();
    // CylinderGeometry assigns material slots 0/1/2 to side/top/bottom.
    const mesh = new THREE.InstancedMesh(
      geometry,
      [barkMaterial, cutFaceMaterial, barkMaterial],
      layoutIndices.length,
    );
    mesh.name = `${bucket.name} harvest stumps`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    meshes.push(mesh);
    activeLayoutIndices.set(mesh, []);
    group.add(mesh);

    layoutIndices.forEach((layoutIndex) => {
      slots[layoutIndex] = { mesh, instanceIndex: -1 };
    });
  }

  return {
    group,
    meshes,
    slots,
    activeLayoutIndices,
    dirtyMeshes,
    ownedMaterials,
    ownedTextures,
    cutFaceMaterial,
    snowCoverage: 0,
  };
}

export function updateHarvestStumpInstance(
  instances: HarvestStumpInstances,
  layoutIndex: number,
  x: number,
  z: number,
  y: number,
  treeScale: number,
): void {
  const slot = instances.slots[layoutIndex];
  if (!slot) return;
  if (slot.instanceIndex < 0) {
    const active = instances.activeLayoutIndices.get(slot.mesh)!;
    slot.instanceIndex = active.length;
    active.push(layoutIndex);
    slot.mesh.count = active.length;
    slot.mesh.visible = true;
  }

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3(x, y, z);
  const stumpScale = 0.95 + treeScale * 0.35;
  const scaleVector = new THREE.Vector3(stumpScale, stumpScale * 0.62, stumpScale);
  const yaw = stumpHash(x, z) * 0.01;
  quaternion.setFromEuler(new THREE.Euler(0, yaw, 0));
  matrix.compose(position, quaternion, scaleVector);
  slot.mesh.setMatrixAt(slot.instanceIndex, matrix);
  instances.dirtyMeshes.add(slot.mesh);
}

export function hideHarvestStumpInstance(
  instances: HarvestStumpInstances,
  layoutIndex: number,
): void {
  const slot = instances.slots[layoutIndex];
  if (!slot || slot.instanceIndex < 0) return;
  const mesh = slot.mesh;
  const active = instances.activeLayoutIndices.get(mesh)!;
  const lastInstanceIndex = active.length - 1;
  const lastLayoutIndex = active.pop()!;
  if (slot.instanceIndex !== lastInstanceIndex) {
    // Fill the hole with the final live stump and move its reverse mapping too.
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(lastInstanceIndex, matrix);
    mesh.setMatrixAt(slot.instanceIndex, matrix);
    active[slot.instanceIndex] = lastLayoutIndex;
    instances.slots[lastLayoutIndex].instanceIndex = slot.instanceIndex;
  }
  slot.instanceIndex = -1;
  mesh.count = active.length;
  mesh.visible = mesh.count > 0;
  instances.dirtyMeshes.add(mesh);
}

export function commitHarvestStumpInstanceUpdates(
  instances: HarvestStumpInstances,
): void {
  for (const mesh of instances.dirtyMeshes) {
    mesh.instanceMatrix.needsUpdate = true;
  }
  instances.dirtyMeshes.clear();
}

export function setHarvestStumpShadowsEnabled(
  instances: HarvestStumpInstances,
  enabled: boolean,
): void {
  for (const mesh of instances.meshes) mesh.castShadow = enabled;
}

/** The upward cut face is the natural accumulation surface on a low stump. */
export function setHarvestStumpSnowCoverage(
  instances: HarvestStumpInstances,
  coverage: number,
): boolean {
  const next = THREE.MathUtils.clamp(
    Number.isFinite(coverage) ? coverage : 0,
    0,
    1,
  );
  if (Math.abs(instances.snowCoverage - next) <= 1e-6) return false;
  instances.snowCoverage = next;
  const uniform = instances.cutFaceMaterial.userData.harvestStumpSnowCoverage as
    { value: number } | undefined;
  if (uniform) uniform.value = next;
  instances.cutFaceMaterial.roughness = THREE.MathUtils.lerp(0.88, 1, next);
  return true;
}

export function disposeHarvestStumpInstances(instances: HarvestStumpInstances): void {
  for (const mesh of instances.meshes) mesh.geometry.dispose();
  for (const material of new Set(instances.ownedMaterials)) material.dispose();
  for (const texture of new Set(instances.ownedTextures)) texture.dispose();
}

function createStumpGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(
    0.42,
    0.52,
    0.38,
    STUMP_RADIAL_SEGMENTS,
    1,
    false,
  );
  geometry.translate(0, 0.19, 0);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createCutFaceTextureSet(maxAnisotropy: number): StumpTextureSet {
  return createCoupledTextureSet(
    'stump growth rings',
    maxAnisotropy,
    (u, v) => {
      const dx = u - 0.5;
      const dy = v - 0.5;
      const radius = Math.hypot(dx * 1.02, dy * 0.98);
      const angle = Math.atan2(dy, dx);
      const warp = fbm(u * 5.2 + 7.1, v * 5.2 - 2.8) * 0.075;
      const rings = 0.5 + 0.5 * Math.sin((radius + warp) * 92);
      const rayDistance = Math.abs(Math.sin(angle * 6 + radius * 8 + warp * 18));
      const cracks = (1 - smoothstep(0.025, 0.095, rayDistance))
        * smoothstep(0.18, 0.47, radius);
      const edgeDarkening = smoothstep(0.39, 0.55, radius);
      const grain = fbm(u * 18 + 21.7, v * 18 - 9.2);
      const height = clamp01(0.5 + rings * 0.24 + grain * 0.12 - cracks * 0.62);
      const warm = rings * 8 + grain * 10;
      return {
        color: [
          167 + warm - edgeDarkening * 42 - cracks * 60,
          118 + warm * 0.7 - edgeDarkening * 35 - cracks * 48,
          70 + warm * 0.35 - edgeDarkening * 24 - cracks * 34,
        ],
        height,
        roughness: clamp01(0.72 + grain * 0.13 + cracks * 0.13 + edgeDarkening * 0.08),
      };
    },
  );
}

function createFallbackBarkTextureSet(
  barkKey: string,
  maxAnisotropy: number,
): StumpTextureSet {
  const seed = stringSeed(barkKey);
  return createCoupledTextureSet(
    `${barkKey} fallback bark`,
    maxAnisotropy,
    (u, v) => {
      const coarse = fbm(u * 7 + seed * 0.001, v * 18 - seed * 0.002);
      const verticalWarp = fbm(u * 3.5 + 14.2, v * 6.5 - 8.1);
      const fissureWave = Math.abs(Math.sin((u + verticalWarp * 0.08) * Math.PI * 15));
      const fissures = 1 - smoothstep(0.035, 0.2, fissureWave);
      const plates = fbm(u * 20 - 4.7, v * 34 + 12.3);
      const height = clamp01(0.34 + coarse * 0.34 + plates * 0.22 - fissures * 0.52);
      const conifer = barkKey === 'fir' || barkKey === 'spruce' || barkKey === 'pine';
      const base = conifer ? [105, 73, 53] : [111, 103, 80];
      const lift = coarse * 28 + plates * 13 - fissures * 45;
      return {
        color: [base[0] + lift, base[1] + lift * 0.78, base[2] + lift * 0.55],
        height,
        roughness: clamp01(0.82 + fissures * 0.13 + (1 - plates) * 0.06),
      };
    },
  );
}

function fallbackBarkKey(species: string): string {
  switch (species) {
    case 'silverFir':
    case 'larch':
      return 'fir';
    case 'norwaySpruce':
      return 'spruce';
    case 'scotsPine':
    case 'blackPine':
      return 'pine';
    case 'sessileOak':
      return 'oak';
    case 'sycamoreMaple':
    case 'norwayMaple':
    case 'wychElm':
      return 'maple';
    case 'ash':
      return 'ash';
    default:
      return 'beech';
  }
}

function fallbackBarkName(key: string): string {
  return key[0]?.toUpperCase() + key.slice(1);
}

function createCoupledTextureSet(
  name: string,
  maxAnisotropy: number,
  sample: (u: number, v: number) => {
    color: [number, number, number];
    height: number;
    roughness: number;
  },
): StumpTextureSet {
  const colorData = new Uint8Array(STUMP_TEXTURE_SIZE * STUMP_TEXTURE_SIZE * 4);
  const heightData = new Uint8Array(colorData.length);
  const roughnessData = new Uint8Array(colorData.length);
  for (let y = 0; y < STUMP_TEXTURE_SIZE; y++) {
    for (let x = 0; x < STUMP_TEXTURE_SIZE; x++) {
      const u = x / (STUMP_TEXTURE_SIZE - 1);
      const v = y / (STUMP_TEXTURE_SIZE - 1);
      const texel = sample(u, v);
      const index = (y * STUMP_TEXTURE_SIZE + x) * 4;
      writeColor(colorData, index, texel.color);
      writeGray(heightData, index, texel.height);
      writeGray(roughnessData, index, texel.roughness);
    }
  }
  return {
    map: createDataTexture(colorData, `${name} albedo`, maxAnisotropy, true),
    heightMap: createDataTexture(heightData, `${name} height`, maxAnisotropy, false),
    roughnessMap: createDataTexture(
      roughnessData,
      `${name} roughness`,
      maxAnisotropy,
      false,
    ),
  };
}

function createDataTexture(
  data: Uint8Array,
  name: string,
  maxAnisotropy: number,
  srgb: boolean,
): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    data,
    STUMP_TEXTURE_SIZE,
    STUMP_TEXTURE_SIZE,
    THREE.RGBAFormat,
  );
  texture.name = name;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
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

function fbm(x: number, y: number): number {
  let value = 0;
  let amplitude = 0.57;
  let frequency = 1;
  let total = 0;
  for (let octave = 0; octave < 4; octave++) {
    value += valueNoise(x * frequency, y * frequency) * amplitude;
    total += amplitude;
    frequency *= 2.03;
    amplitude *= 0.5;
  }
  return value / total;
}

function valueNoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = hash2(x0, y0);
  const b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1);
  const d = hash2(x0 + 1, y0 + 1);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, tx),
    THREE.MathUtils.lerp(c, d, tx),
    ty,
  );
}

function hash2(x: number, y: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
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

function stringSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stumpHash(x: number, z: number): number {
  return Math.abs(Math.floor(Math.sin(x * 127.1 + z * 311.7) * 43758.5453));
}

export function isUndergrowthNearAnyEdge(
  x: number,
  z: number,
  edges: RoadEdge[],
  margin: number,
): boolean {
  for (const edge of edges) {
    const path = edge.sampledPath.length >= 2 ? edge.sampledPath : edge.controlPoints;
    if (path.length < 2) continue;
    const distance = distancePointToPolylineXZ(x, z, path);
    if (distance <= edge.width * 0.5 + margin) return true;
  }
  return false;
}
