import * as THREE from 'three';
import { MeshSSSNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import {
  cameraViewMatrix,
  float,
  luminance,
  mix,
  normalMap,
  normalView,
  normalize,
  texture,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { WIND_DIR } from '@seedthree/core/wind.js';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RendererBackendKind } from '../scene/RendererBackend.ts';
import { supportsNodeMaterials } from '../scene/RendererBackend.ts';
import { applyFoliageDoubleSideNormals } from '../scene/foliageDoubleSideNormals.ts';
import { chainMaterialShaderPatch } from '../scene/materialShaderPatch.ts';
import { SpatialHash2D } from '../utils/SpatialHash2D.ts';
import { mulberry32 } from '../utils/random.ts';
import type { DeciduousFoliagePresentation } from '../world/deciduousFoliagePolicy.ts';
import {
  createGorskiShrubPrototype,
  GORSKI_SHRUB_VARIANT_COUNT,
  type GorskiShrubPrototype,
} from '../vegetation/seedthree/gorskiShrubPrototypes.ts';
import { createRootedGeometryWindPosition } from '../vegetation/seedthree/seedThreeFoliageWind.ts';
import {
  seedThreeBarkUrl,
  seedThreeLeafUrl,
} from '../vegetation/seedthree/seedThreeTextures.ts';
import type { ForestTreePlacement } from './forestPlacements.ts';

export const FOREST_FLOOR_NETTLE_SEED = 0x75727469;
export const FOREST_FLOOR_NETTLE_MAX_INSTANCES = 3_200;
export const FOREST_FLOOR_NETTLE_MIN_SPACING = 0.48;

const NETTLE_LEAF_FILES = {
  albedo: 'stinging_nettle_single_albedo.png',
  normal: 'stinging_nettle_single_normal.png',
  roughness: 'stinging_nettle_single_roughness.png',
  translucency: 'stinging_nettle_single_translucency.png',
} as const;

const NETTLE_STEM_FILES = {
  albedo: 'stinging_nettle_stem_albedo.png',
  normal: 'stinging_nettle_stem_normal.png',
  roughness: 'stinging_nettle_stem_roughness.png',
} as const;

const HIDDEN_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

type TslNode = {
  mul(value: unknown): TslNode;
  add(value: unknown): TslNode;
  sub(value: unknown): TslNode;
  div(value: unknown): TslNode;
  max(value: unknown): TslNode;
  clamp(minimum: unknown, maximum: unknown): TslNode;
  r: TslNode;
  a: TslNode;
  rgb: TslNode;
  xyz: TslNode;
};

const tsl = {
  cameraViewMatrix: cameraViewMatrix as unknown as TslNode,
  float: float as (value: number) => TslNode,
  luminance: luminance as (value: unknown) => TslNode,
  mix: mix as (left: unknown, right: unknown, amount: unknown) => TslNode,
  normalMap: normalMap as (sample: unknown) => TslNode,
  normalView: normalView as unknown as TslNode,
  normalize: normalize as (value: unknown) => TslNode,
  texture: texture as (map: THREE.Texture) => TslNode,
  uniform: uniform as <T>(value: T) => { value: T } & TslNode,
  vec3: vec3 as (x: unknown, y?: unknown, z?: unknown) => TslNode,
  vec4: vec4 as (x: unknown, y?: unknown, z?: unknown, w?: unknown) => TslNode,
};

type NettleTextureSet = {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
  translucency?: THREE.Texture;
};

export type ForestFloorNettlePlacement = {
  x: number;
  z: number;
  sourceTreeIndex: number;
  scale: number;
  yaw: number;
  lean: number;
  leanDirection: number;
  prototypeIndex: number;
  meshIndex: number;
};

export type ForestFloorNettleStats = {
  instances: number;
  drawCalls: number;
  trianglesPerPrototype: number[];
  triangles: number;
  seed: number;
};

type NettleBucket = {
  mesh: THREE.InstancedMesh;
  placements: ForestFloorNettlePlacement[];
  matrices: THREE.Matrix4[];
};

export type ForestFloorNettleInstances = {
  group: THREE.Group;
  placements: ForestFloorNettlePlacement[];
  buckets: NettleBucket[];
  stats: ForestFloorNettleStats;
  setTreeActive(treeIndex: number, active: boolean): boolean;
  setDeciduousFoliage(presentation: DeciduousFoliagePresentation): boolean;
  commit(): void;
  dispose(): void;
};

export async function createForestFloorNettleInstances(
  trees: readonly ForestTreePlacement[],
  terrain: Terrain,
  maxAnisotropy: number,
  rendererBackend: RendererBackendKind | undefined,
  seed = FOREST_FLOOR_NETTLE_SEED,
  isBlockedAt?: (x: number, z: number) => boolean,
): Promise<ForestFloorNettleInstances> {
  const [leafTextures, stemTextures] = await Promise.all([
    loadLeafTextures(maxAnisotropy),
    loadStemTextures(maxAnisotropy),
  ]);
  const useNodeMaterials = supportsNodeMaterials(rendererBackend ?? 'webgl');
  const branchMaterial = createNettleBranchMaterial(stemTextures, useNodeMaterials);
  const foliageMaterial = createNettleFoliageMaterial(leafTextures, useNodeMaterials);
  const prototypes = Array.from(
    { length: GORSKI_SHRUB_VARIANT_COUNT },
    (_, variant) => createGorskiShrubPrototype('nettle', variant),
  );
  const placements = createForestFloorNettlePlacements(trees, seed, isBlockedAt);
  const placementIndicesByTree = Array.from(
    { length: trees.length },
    () => [] as number[],
  );
  placements.forEach((placement, index) => {
    placementIndicesByTree[placement.sourceTreeIndex]?.push(index);
  });

  const group = new THREE.Group();
  group.name = 'SeedThree young stinging nettles';
  const buckets = prototypes.map((prototype, prototypeIndex) => {
    const bucketPlacements = placements.filter(
      (placement) => placement.prototypeIndex === prototypeIndex,
    );
    const bucket = createNettleBucket(
      prototype,
      prototypeIndex,
      bucketPlacements,
      terrain,
      branchMaterial,
      foliageMaterial,
      seed,
    );
    group.add(bucket.mesh);
    return bucket;
  });
  const treeActive = trees.map(() => true);
  let matricesDirty = false;
  const textures = [
    leafTextures.albedo,
    leafTextures.normal,
    leafTextures.roughness,
    leafTextures.translucency,
    stemTextures.albedo,
    stemTextures.normal,
    stemTextures.roughness,
  ].filter((candidate): candidate is THREE.Texture => Boolean(candidate));

  return {
    group,
    placements,
    buckets,
    stats: {
      instances: placements.length,
      drawCalls: buckets.filter((bucket) => bucket.placements.length > 0).length * 2,
      trianglesPerPrototype: prototypes.map((prototype) => prototype.triangleCount),
      triangles: buckets.reduce(
        (total, bucket, index) => total
          + bucket.placements.length * prototypes[index]!.triangleCount,
        0,
      ),
      seed,
    },
    setTreeActive(treeIndex: number, active: boolean): boolean {
      if (treeActive[treeIndex] === active) return false;
      treeActive[treeIndex] = active;
      for (const placementIndex of placementIndicesByTree[treeIndex] ?? []) {
        const placement = placements[placementIndex]!;
        const bucket = buckets[placement.prototypeIndex]!;
        bucket.mesh.setMatrixAt(
          placement.meshIndex,
          active ? bucket.matrices[placement.meshIndex]! : HIDDEN_MATRIX,
        );
      }
      matricesDirty = true;
      return true;
    },
    setDeciduousFoliage(presentation): boolean {
      const changed = setNettleSeason(foliageMaterial, presentation);
      updateNettleStemSeason(branchMaterial, presentation);
      return changed;
    },
    commit(): void {
      if (!matricesDirty) return;
      for (const bucket of buckets) bucket.mesh.instanceMatrix.needsUpdate = true;
      matricesDirty = false;
    },
    dispose(): void {
      group.removeFromParent();
      branchMaterial.dispose();
      foliageMaterial.dispose();
      for (const prototype of prototypes) prototype.geometry.dispose();
      for (const item of textures) item.dispose();
    },
  };
}

export function createForestFloorNettlePlacements(
  trees: readonly ForestTreePlacement[],
  seed = FOREST_FLOOR_NETTLE_SEED,
  isBlockedAt?: (x: number, z: number) => boolean,
): ForestFloorNettlePlacement[] {
  const placements: ForestFloorNettlePlacement[] = [];
  const spatial = new SpatialHash2D<ForestFloorNettlePlacement>(0.75);
  for (let treeIndex = 0; treeIndex < trees.length; treeIndex++) {
    if (placements.length >= FOREST_FLOOR_NETTLE_MAX_INSTANCES) break;
    const tree = trees[treeIndex]!;
    const rng = mulberry32((seed ^ Math.imul(treeIndex + 1, 0x9e3779b1)) >>> 0);
    const attempts = 1 + (rng() < 0.28 ? 1 : 0);
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (placements.length >= FOREST_FLOOR_NETTLE_MAX_INSTANCES) break;
      if (attempt === 0 && rng() > 0.9) continue;
      const radius = THREE.MathUtils.lerp(1.15, 4.8, Math.sqrt(rng()));
      const angle = rng() * Math.PI * 2;
      const x = tree.x + Math.cos(angle) * radius;
      const z = tree.z + Math.sin(angle) * radius;
      if (isBlockedAt?.(x, z)) continue;
      if (spatial.hasPointWithin(x, z, FOREST_FLOOR_NETTLE_MIN_SPACING)) continue;
      const placement: ForestFloorNettlePlacement = {
        x,
        z,
        sourceTreeIndex: treeIndex,
        scale: THREE.MathUtils.lerp(0.64, 1.22, Math.pow(rng(), 0.72)),
        yaw: rng() * Math.PI * 2,
        lean: THREE.MathUtils.lerp(0.015, 0.085, rng()),
        leanDirection: rng() * Math.PI * 2,
        prototypeIndex: Math.floor(rng() * GORSKI_SHRUB_VARIANT_COUNT),
        meshIndex: -1,
      };
      placements.push(placement);
      spatial.add(placement);
    }
  }
  return placements;
}

function createNettleBucket(
  prototype: GorskiShrubPrototype,
  prototypeIndex: number,
  placements: ForestFloorNettlePlacement[],
  terrain: Terrain,
  branchMaterial: THREE.Material,
  foliageMaterial: THREE.Material,
  seed: number,
): NettleBucket {
  const capacity = Math.max(1, placements.length);
  const geometry = prototype.geometry;
  const anchors = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const windVectors = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  geometry.setAttribute('aAnchorPos', anchors);
  geometry.setAttribute('aWindVec', windVectors);
  const mesh = new THREE.InstancedMesh(
    geometry,
    [branchMaterial, foliageMaterial],
    capacity,
  );
  mesh.name = `SeedThree stinging nettle prototype ${prototypeIndex + 1}`;
  mesh.count = placements.length;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  mesh.userData.seedThreeGenerator = prototype.geometry.userData.seedThreeGenerator;
  mesh.userData.prototypeTriangleCount = prototype.triangleCount;

  const matrices: THREE.Matrix4[] = [];
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const wind = new THREE.Vector3();
  const color = new THREE.Color();
  const inverseYaw = new THREE.Quaternion();
  placements.forEach((placement, meshIndex) => {
    placement.meshIndex = meshIndex;
    position.set(
      placement.x,
      terrain.getHeightAt(placement.x, placement.z) + 0.018,
      placement.z,
    );
    quaternion.setFromEuler(new THREE.Euler(
      Math.cos(placement.leanDirection) * placement.lean,
      placement.yaw,
      Math.sin(placement.leanDirection) * placement.lean,
      'YXZ',
    ));
    const width = placement.scale * 0.96;
    scale.set(width, placement.scale, width);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(meshIndex, matrix);
    matrices.push(matrix.clone());
    anchors.setXYZ(meshIndex, position.x, position.y, position.z);
    inverseYaw.setFromAxisAngle(Y_AXIS, -placement.yaw);
    wind.copy(WIND_DIR).applyQuaternion(inverseYaw);
    if (scale.x !== 0) wind.x /= scale.x;
    if (scale.y !== 0) wind.y /= scale.y;
    if (scale.z !== 0) wind.z /= scale.z;
    windVectors.setXYZ(meshIndex, wind.x, wind.y, wind.z);
    const tintRng = mulberry32(
      (seed ^ Math.imul(placement.sourceTreeIndex + 17, 0x85ebca6b) ^ meshIndex) >>> 0,
    );
    color.setRGB(
      THREE.MathUtils.lerp(0.82, 0.96, tintRng()),
      THREE.MathUtils.lerp(0.88, 1.02, tintRng()),
      THREE.MathUtils.lerp(0.76, 0.92, tintRng()),
    );
    mesh.setColorAt(meshIndex, color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  anchors.needsUpdate = true;
  windVectors.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return { mesh, placements, matrices };
}

function createNettleFoliageMaterial(
  textures: NettleTextureSet,
  useNodeMaterial: boolean,
): THREE.Material {
  if (!useNodeMaterial) {
    const material = new THREE.MeshStandardMaterial({
      name: 'SeedThree stinging nettle paired leaves',
      map: textures.albedo,
      normalMap: textures.normal,
      roughnessMap: textures.roughness,
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      roughness: 1,
      metalness: 0,
      vertexColors: true,
    });
    material.forceSinglePass = true;
    material.normalScale.set(0.52, 0.52);
    applyFoliageDoubleSideNormals(material);
    applyNettleWebGLSeason(material);
    return material;
  }

  const material = new MeshSSSNodeMaterial({
    map: textures.albedo,
    roughnessMap: textures.roughness,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
  });
  material.name = 'SeedThree stinging nettle paired leaves';
  material.forceSinglePass = true;
  material.positionNode = createRootedGeometryWindPosition(0.07) as never;
  const texel = tsl.texture(textures.albedo);
  const spring = tsl.uniform(0);
  const autumn = tsl.uniform(0);
  const dormancy = tsl.uniform(0);
  const value = tsl.luminance(texel.rgb);
  const springLeaf = tsl.vec3(0.63, 0.94, 0.26)
    .mul(value.mul(1.34)).clamp(0, 1);
  const autumnLeaf = tsl.vec3(0.9, 0.39, 0.065)
    .mul(value.mul(1.55)).clamp(0, 1);
  const dormantLeaf = tsl.vec3(0.53, 0.31, 0.16)
    .mul(value.mul(1.72)).clamp(0, 1);
  let seasonal = tsl.mix(texel.rgb, springLeaf, spring.mul(0.58));
  seasonal = tsl.mix(seasonal, autumnLeaf, autumn);
  seasonal = tsl.mix(seasonal, dormantLeaf, dormancy.mul(0.86));
  material.colorNode = seasonal as never;
  material.opacityNode = texel.a as never;
  const transmit = tsl.vec3(0.24, 0.43, 0.14);
  material.thicknessColorNode = tsl.texture(textures.translucency!).r
    .mul(transmit)
    .mul(tsl.float(1).sub(dormancy.mul(0.68))) as never;
  material.thicknessDistortionNode = tsl.uniform(0.3) as never;
  material.thicknessAmbientNode = tsl.uniform(0.026) as never;
  material.thicknessAttenuationNode = tsl.uniform(1) as never;
  material.thicknessPowerNode = tsl.uniform(5) as never;
  material.thicknessScaleNode = tsl.uniform(1.55) as never;
  const upView = tsl.cameraViewMatrix.mul(tsl.vec4(0, 1, 0, 0)).xyz;
  const relief = tsl.normalMap(tsl.texture(textures.normal)).sub(tsl.normalView);
  material.normalNode = tsl.normalize(upView.add(relief.mul(0.52))) as never;
  material.userData.forestSeasonalSpringFlush = spring;
  material.userData.forestSeasonalAutumnColor = autumn;
  material.userData.forestSeasonalDormancy = dormancy;
  return material;
}

function createNettleBranchMaterial(
  textures: NettleTextureSet,
  useNodeMaterial: boolean,
): THREE.Material {
  if (!useNodeMaterial) {
    const material = new THREE.MeshStandardMaterial({
      name: 'SeedThree living stinging nettle stem',
      map: textures.albedo,
      normalMap: textures.normal,
      roughnessMap: textures.roughness,
      roughness: 1,
      metalness: 0,
    });
    material.normalScale.set(0.38, 0.38);
    return material;
  }
  const material = new MeshStandardNodeMaterial();
  material.name = 'SeedThree living stinging nettle stem';
  material.map = textures.albedo;
  material.normalMap = textures.normal;
  material.roughnessMap = textures.roughness;
  material.roughness = 1;
  material.metalness = 0;
  material.positionNode = createRootedGeometryWindPosition(0.07) as never;
  return material;
}

function applyNettleWebGLSeason(material: THREE.MeshStandardMaterial): void {
  const spring = { value: 0 };
  const autumn = { value: 0 };
  const dormancy = { value: 0 };
  material.userData.forestSeasonalSpringFlush = spring;
  material.userData.forestSeasonalAutumnColor = autumn;
  material.userData.forestSeasonalDormancy = dormancy;
  chainMaterialShaderPatch(material, 'seedthree-nettle-season-v1', (shader) => {
    shader.uniforms.uNettleSpring = spring;
    shader.uniforms.uNettleAutumn = autumn;
    shader.uniforms.uNettleDormancy = dormancy;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
uniform float uNettleSpring;
uniform float uNettleAutumn;
uniform float uNettleDormancy;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
float nettleValue = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
vec3 nettleSpring = clamp( vec3( 0.63, 0.94, 0.26 ) * nettleValue * 1.34, 0.0, 1.0 );
vec3 nettleAutumn = clamp( vec3( 0.90, 0.39, 0.065 ) * nettleValue * 1.55, 0.0, 1.0 );
vec3 nettleDormant = clamp( vec3( 0.53, 0.31, 0.16 ) * nettleValue * 1.72, 0.0, 1.0 );
diffuseColor.rgb = mix( diffuseColor.rgb, nettleSpring, uNettleSpring * 0.58 );
diffuseColor.rgb = mix( diffuseColor.rgb, nettleAutumn, uNettleAutumn );
diffuseColor.rgb = mix( diffuseColor.rgb, nettleDormant, uNettleDormancy * 0.86 );`,
    );
  });
  material.needsUpdate = true;
}

function setNettleSeason(
  material: THREE.Material,
  presentation: DeciduousFoliagePresentation,
): boolean {
  let changed = false;
  changed = setSeasonUniform(material, 'forestSeasonalSpringFlush', presentation.springFlush) || changed;
  changed = setSeasonUniform(material, 'forestSeasonalAutumnColor', presentation.autumnColor) || changed;
  changed = setSeasonUniform(material, 'forestSeasonalDormancy', presentation.dormancy) || changed;
  return changed;
}

function setSeasonUniform(material: THREE.Material, key: string, amount: number): boolean {
  const target = material.userData[key] as { value: number } | undefined;
  if (!target) return false;
  const next = THREE.MathUtils.clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
  if (target.value === next) return false;
  target.value = next;
  return true;
}

function updateNettleStemSeason(
  material: THREE.Material,
  presentation: DeciduousFoliagePresentation,
): void {
  if (!('color' in material) || !(material.color instanceof THREE.Color)) return;
  material.color.setRGB(1, 1, 1);
  material.color.lerp(new THREE.Color(0xd8ffae), presentation.springFlush * 0.28);
  material.color.lerp(new THREE.Color(0xd7a454), presentation.autumnColor * 0.62);
  material.color.lerp(new THREE.Color(0x9b795b), presentation.dormancy * 0.8);
}

async function loadLeafTextures(maxAnisotropy: number): Promise<NettleTextureSet> {
  const [albedo, normal, roughness, translucency] = await Promise.all([
    loadSeedThreeTexture(seedThreeLeafUrl(NETTLE_LEAF_FILES.albedo), true, false, maxAnisotropy),
    loadSeedThreeTexture(seedThreeLeafUrl(NETTLE_LEAF_FILES.normal), false, false, maxAnisotropy),
    loadSeedThreeTexture(seedThreeLeafUrl(NETTLE_LEAF_FILES.roughness), false, false, maxAnisotropy),
    loadSeedThreeTexture(seedThreeLeafUrl(NETTLE_LEAF_FILES.translucency), false, false, maxAnisotropy),
  ]);
  return { albedo, normal, roughness, translucency };
}

async function loadStemTextures(maxAnisotropy: number): Promise<NettleTextureSet> {
  const [albedo, normal, roughness] = await Promise.all([
    loadSeedThreeTexture(seedThreeBarkUrl(NETTLE_STEM_FILES.albedo), true, true, maxAnisotropy),
    loadSeedThreeTexture(seedThreeBarkUrl(NETTLE_STEM_FILES.normal), false, true, maxAnisotropy),
    loadSeedThreeTexture(seedThreeBarkUrl(NETTLE_STEM_FILES.roughness), false, true, maxAnisotropy),
  ]);
  return { albedo, normal, roughness };
}

async function loadSeedThreeTexture(
  source: string | undefined,
  srgb: boolean,
  repeat: boolean,
  maxAnisotropy: number,
): Promise<THREE.Texture> {
  if (!source) throw new Error('A dedicated stinging-nettle PBR map is missing');
  const loaded = await new THREE.TextureLoader().loadAsync(source);
  loaded.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  loaded.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  loaded.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  loaded.anisotropy = Math.max(1, Math.min(16, maxAnisotropy));
  return loaded;
}
