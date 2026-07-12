import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import { ForestManager, type MixedForestInstances } from './ForestManager.ts';
import { applyForestFoliageMaterialPatches, applyTreeShadowReceiveFilter, setTreeShadowInstanceAttributes } from './treeShadowReceiveFilter.ts';
import { TREE_SHADOW_CAST_LAYER } from '../scene/SceneLayers.ts';
import type { RendererBackendKind } from '../scene/RendererBackend.ts';
import {
  CENTRAL_CLEARING_RADIUS,
  createForestCores,
  createForestSpawnConfig,
  distanceToNearest,
  fbm2,
  forestDensityAt,
  hasMinimumDistance,
  isInsidePlayableExtent,
  mulberry32,
  samplePointInPlayableExtent,
  type ForestCore,
  type ForestSpawnConfig,
} from './forestField.ts';
type ForestMaterialSet = {
  bark: THREE.MeshStandardMaterial;
  coniferFoliage: THREE.MeshStandardMaterial;
  broadleafFoliage: THREE.MeshStandardMaterial;
  rock: THREE.MeshStandardMaterial;
  shadowCast: THREE.MeshStandardMaterial;
  shadowDepth: THREE.MeshDepthMaterial;
  textures: THREE.Texture[];
};

import { loadMossyRockTextures, loadPineFoliageTextures } from '../utils/propTextureLoad.ts';
import { createStubForestInstances } from './forestInstanceStub.ts';
import {
  computeForestTreePlacements,
  getEstimatedCanopyRadius,
  getTreeSpeciesProfile,
  valueNoise2,
  type ForestTreePlacement,
  type TreeSpeciesProfile,
} from './forestPlacements.ts';

const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;

export type ForestPropsOptions = {
  isBlockedAt?: (x: number, z: number) => boolean;
  rendererBackend?: RendererBackendKind;
  treeSeed?: number;
  densityScale?: number;
  forestCores?: ForestCore[];
};

type TreePlacement = ForestTreePlacement;

type RockProfile = 'flat' | 'moderate' | 'tall';

type RockPlacement = {
  x: number;
  z: number;
  scale: number;
  profile: RockProfile;
};

type RockOutcrop = {
  x: number;
  z: number;
  radius: number;
  count: number;
  strength: number;
};

export async function createForestProps(
  terrain: Terrain,
  maxAnisotropy: number,
  options?: ForestPropsOptions,
): Promise<ForestManager> {
  const rng = mulberry32(options?.treeSeed ?? 0x5eedf0a5);
  const spawnConfig = createForestSpawnConfig(
    terrain.playableSize,
    terrain.size,
    options?.densityScale ?? 1,
  );
  const isBlockedAt = options?.isBlockedAt;
  const enableTreeShadowFilter = options?.rendererBackend !== 'webgpu';
  const materials = await createForestMaterials(maxAnisotropy, enableTreeShadowFilter);
  const forest = new THREE.Group();
  forest.name = 'Road-scale forest props';
  const allTreePlacements = computeForestTreePlacements(
    terrain.playableSize,
    terrain.size,
    isBlockedAt,
    {
      treeSeed: options?.treeSeed,
      densityScale: options?.densityScale,
      forestCores: options?.forestCores,
    },
  );
  const rockPlacements = createRockPlacements(rng, options?.forestCores ?? createForestCores(rng, spawnConfig), allTreePlacements, spawnConfig, isBlockedAt);

  if (options?.rendererBackend === 'webgpu') {
    const seedThree = await import('../vegetation/seedthree/seedThreeForestBuilder.ts');
    const { disposeSeedThreeAssetCache } = await import('../vegetation/seedthree/seedThreeAssets.ts');
    const seedThreeForest = await seedThree.createSeedThreeForest(
      allTreePlacements,
      terrain,
      maxAnisotropy,
      options?.treeSeed ?? 0x5eedf0a5,
    );
    const seedThreeController = seedThree.createSeedThreeForestController(seedThreeForest);
    const treeInstances = createStubForestInstances(allTreePlacements);
    forest.add(seedThreeForest.group);
    forest.add(
      createRockField(
        rockPlacements,
        terrain,
        materials.rock,
        materials.shadowCast,
        materials.shadowDepth,
        rng,
      ),
    );

    return new ForestManager(
      forest,
      treeInstances,
      rockPlacements,
      null,
      [],
      terrain,
      () => {
        disposeForestMaterials(materials);
        seedThreeController.dispose();
        disposeSeedThreeAssetCache();
      },
      seedThreeController,
    );
  }

  const treeInstances = createMixedMountainForest(allTreePlacements, terrain, materials, rng);

  forest.add(treeInstances.group);
  forest.add(
    createRockField(
      rockPlacements,
      terrain,
      materials.rock,
      materials.shadowCast,
      materials.shadowDepth,
      rng,
    ),
  );

  return new ForestManager(
    forest,
    treeInstances,
    rockPlacements,
    null,
    [],
    terrain,
    () => {
      disposeForestMaterials(materials);
    },
  );
}

async function createForestMaterials(maxAnisotropy: number, enableTreeShadowFilter: boolean): Promise<ForestMaterialSet> {
  const [rockTextures, foliageTextures] = await Promise.all([
    loadMossyRockTextures(maxAnisotropy),
    loadPineFoliageTextures(maxAnisotropy),
  ]);
  const textures: THREE.Texture[] = [rockTextures.map, rockTextures.normalMap, rockTextures.roughnessMap];

  const barkMap = createPineBarkTexture(maxAnisotropy);
  textures.push(barkMap, foliageTextures.needleMap, foliageTextures.needleRoughnessMap);

  const bark = new THREE.MeshStandardMaterial({
    map: barkMap,
    color: 0xffffff,
    roughness: 0.94,
    metalness: 0,
  });

  const rock = new THREE.MeshStandardMaterial({
    map: rockTextures.map,
    normalMap: rockTextures.normalMap,
    roughnessMap: rockTextures.roughnessMap,
    color: 0xb6b3a4,
    roughness: 0.9,
    metalness: 0,
  });
  rock.normalScale.set(0.55, 0.55);

  const coniferFoliage = new THREE.MeshStandardMaterial({
    map: foliageTextures.needleMap,
    roughnessMap: foliageTextures.needleRoughnessMap,
    color: 0xffffff,
    roughness: 0.98,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const broadleafFoliage = new THREE.MeshStandardMaterial({
    map: foliageTextures.needleMap,
    roughnessMap: foliageTextures.needleRoughnessMap,
    color: 0xffffff,
    roughness: 0.98,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  applyForestFoliageMaterialPatches(coniferFoliage, { enableTreeShadowFilter });
  applyForestFoliageMaterialPatches(broadleafFoliage, { enableTreeShadowFilter });
  if (enableTreeShadowFilter) applyTreeShadowReceiveFilter(bark);

  return {
    bark,
    rock,
    shadowCast: new THREE.MeshStandardMaterial({
      transparent: true,
      opacity: 0,
      colorWrite: false,
      depthWrite: false,
    }),
    shadowDepth: new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
    }),
    coniferFoliage,
    broadleafFoliage,
    textures,
  };
}

function createPineBarkTexture(maxAnisotropy: number): THREE.Texture {
  const width = 96;
  const height = 192;
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;
      const fiber =
        valueNoise2(u * 12 + Math.sin(v * 28) * 0.16, v * 56) * 0.58 +
        valueNoise2(u * 34, v * 128 + 17.2) * 0.28 +
        Math.abs(Math.sin(u * 36 + valueNoise2(u * 9, v * 18) * 4.5)) * 0.14;
      const groove = smoothstep(0.5, 0.92, fiber);
      const warm = valueNoise2(u * 5.5 - 4.3, v * 12.5 + 8.7);
      const shade = 0.82 + groove * 0.18;
      const index = (y * width + x) * 4;
      data[index] = Math.round((78 + warm * 24) * shade);
      data[index + 1] = Math.round((62 + warm * 18) * shade);
      data[index + 2] = Math.round((48 + warm * 14) * shade);
      data[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = Math.max(1, Math.min(16, maxAnisotropy));
  texture.needsUpdate = true;
  return texture;
}

function createRockPlacements(
  rng: () => number,
  forestCores: ForestCore[],
  treePlacements: TreePlacement[],
  spawnConfig: ForestSpawnConfig,
  isBlockedAt?: (x: number, z: number) => boolean,
): RockPlacement[] {
  const placements: RockPlacement[] = [];
  const outcrops = createRockOutcrops(rng, forestCores, spawnConfig);

  for (const outcrop of outcrops) {
    let placedInOutcrop = 0;
    let attempts = 0;
    while (placedInOutcrop < outcrop.count && attempts < outcrop.count * 24) {
      attempts++;
      const angle = rng() * TAU;
      const radius = Math.pow(rng(), 0.58) * outcrop.radius;
      const stretch = 0.7 + rng() * 0.65;
      const x = outcrop.x + Math.cos(angle) * radius * stretch + (rng() - 0.5) * 3.6;
      const z = outcrop.z + Math.sin(angle) * radius * (1.2 - stretch * 0.28) + (rng() - 0.5) * 3.6;
      if (!isInsidePlayableExtent(x, z, spawnConfig.extent)) continue;
      if (isBlockedAt?.(x, z)) continue;
      if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS * 0.62) continue;

      const forestDensity = forestDensityAt(x, z, forestCores, spawnConfig.extent, spawnConfig.terrainExtent);
      if (forestDensity > 0.88 && rng() < 0.55) continue;

      const scale = THREE.MathUtils.lerp(0.55, 2.8, Math.pow(rng(), 1.35)) * THREE.MathUtils.lerp(0.92, 1.28, outcrop.strength);
      if (distanceToNearest(treePlacements, x, z) < 2.7 + scale * 0.78) continue;
      if (!hasMinimumDistance(placements, x, z, 2.8 + scale * 1.35)) continue;

      placements.push({ x, z, scale, profile: rockProfileForScale(scale, rng) });
      placedInOutcrop++;
    }
  }

  let attempts = 0;
  while (placements.length < spawnConfig.rockTargetCount && attempts < spawnConfig.rockTargetCount * 40) {
    attempts++;
    const { x, z } = samplePointInPlayableExtent(rng, spawnConfig.extent);
    if (isBlockedAt?.(x, z)) continue;
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS * 0.78) continue;

    const suitability = rockSuitabilityAt(x, z, forestCores, spawnConfig.extent, spawnConfig.terrainExtent);
    if (suitability < 0.28 || rng() > suitability * 0.92) continue;

    const scale = THREE.MathUtils.lerp(0.45, 2.2, Math.pow(rng(), 1.45));
    if (distanceToNearest(treePlacements, x, z) < 3.2 + scale * 0.7) continue;
    if (!hasMinimumDistance(placements, x, z, 5.4 + scale * 1.2)) continue;
    placements.push({ x, z, scale, profile: rockProfileForScale(scale, rng) });
  }

  return placements;
}

function createRockOutcrops(
  rng: () => number,
  forestCores: ForestCore[],
  spawnConfig: ForestSpawnConfig,
): RockOutcrop[] {
  const outcrops: RockOutcrop[] = [];
  let attempts = 0;
  const minOutcropDistance = spawnConfig.extent * 0.11;

  while (outcrops.length < spawnConfig.rockOutcropCount && attempts < spawnConfig.rockOutcropCount * 90) {
    attempts++;
    const { x, z } = samplePointInPlayableExtent(rng, spawnConfig.extent);
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + 12) continue;
    if (!hasMinimumDistance(outcrops, x, z, minOutcropDistance)) continue;

    const suitability = rockSuitabilityAt(x, z, forestCores, spawnConfig.extent, spawnConfig.terrainExtent);
    if (suitability < 0.32 || rng() > suitability) continue;

    outcrops.push({
      x,
      z,
      radius: THREE.MathUtils.lerp(10, 24, rng()),
      count: 5 + Math.floor(rng() * 7),
      strength: suitability,
    });
  }

  return outcrops;
}

/** Standing eye height is ~1.55 m; large outcrop boulders can exceed that when profile is tall. */
function rockProfileForScale(scale: number, rng: () => number): RockProfile {
  const roll = rng();
  if (scale < 0.75) {
    return roll < 0.68 ? 'flat' : 'moderate';
  }
  if (scale < 1.3) {
    if (roll < 0.38) return 'flat';
    if (roll < 0.8) return 'moderate';
    return 'tall';
  }
  if (roll < 0.16) return 'flat';
  if (roll < 0.5) return 'moderate';
  return 'tall';
}

function rockSuitabilityAt(
  x: number,
  z: number,
  forestCores: ForestCore[],
  extent: number,
  terrainExtent: number,
): number {
  const forestDensity = forestDensityAt(x, z, forestCores, extent, terrainExtent);
  const forestEdge = 1 - Math.abs(forestDensity - 0.46) / 0.46;
  const stoneNoise = fbm2(x * 0.018 + 18.5, z * 0.018 - 4.4, 4);
  const openGround = 1 - smoothstep(0.74, 1, forestDensity);
  const edgeDistance = Math.max(Math.abs(x), Math.abs(z));
  const ridgeBias = smoothstep(extent * 0.42, extent * 0.82, edgeDistance) * 0.14;
  return saturate(forestEdge * 0.38 + stoneNoise * 0.4 + openGround * 0.14 + ridgeBias);
}

function createMixedMountainForest(
  placements: TreePlacement[],
  terrain: Terrain,
  materials: ForestMaterialSet,
  rng: () => number,
): MixedForestInstances {
  const group = new THREE.Group();
  group.name = 'Instanced Gorski kotar mixed mountain forest';

  const trunkGeometry = new THREE.CylinderGeometry(0.28, 1, 1, 8, 1, false);
  const coniferGeometry = createPineTierGeometry();
  const coniferShadowGeometry = createPineShadowTierGeometry();
  const broadleafGeometry = createPineTierGeometry();
  const broadleafShadowGeometry = createPineShadowTierGeometry();
  const trunkMesh = new THREE.InstancedMesh(trunkGeometry, materials.bark, placements.length);
  const coniferLayerCounts = placements.map((placement) => getConiferLayerCount(placement, rng));
  const broadleafLayerCounts = placements.map((placement) => getBroadleafLayerCount(placement, rng));
  const coniferStartIndex: number[] = [];
  const broadleafStartIndex: number[] = [];
  let totalConiferLayers = 0;
  let totalBroadleafLayers = 0;
  for (let i = 0; i < placements.length; i++) {
    coniferStartIndex[i] = totalConiferLayers;
    broadleafStartIndex[i] = totalBroadleafLayers;
    totalConiferLayers += coniferLayerCounts[i];
    totalBroadleafLayers += broadleafLayerCounts[i];
  }

  const coniferFoliageMesh = new THREE.InstancedMesh(coniferGeometry, materials.coniferFoliage, totalConiferLayers);
  const broadleafFoliageMesh = new THREE.InstancedMesh(broadleafGeometry, materials.broadleafFoliage, totalBroadleafLayers);
  const coniferShadowMesh = new THREE.InstancedMesh(coniferShadowGeometry, materials.shadowCast, totalConiferLayers);
  const broadleafShadowMesh = new THREE.InstancedMesh(broadleafShadowGeometry, materials.shadowCast, totalBroadleafLayers);
  const trunkMatrices = placements.map(() => new THREE.Matrix4());
  const coniferFoliageMatrices = Array.from({ length: totalConiferLayers }, () => new THREE.Matrix4());
  const broadleafFoliageMatrices = Array.from({ length: totalBroadleafLayers }, () => new THREE.Matrix4());
  const coniferTreeRoots = new Float32Array(totalConiferLayers * 2);
  const coniferTreeBaseYs = new Float32Array(totalConiferLayers);
  const coniferTreeHeights = new Float32Array(totalConiferLayers);
  const coniferCanopyRadii = new Float32Array(totalConiferLayers);
  const broadleafTreeRoots = new Float32Array(totalBroadleafLayers * 2);
  const broadleafTreeBaseYs = new Float32Array(totalBroadleafLayers);
  const broadleafTreeHeights = new Float32Array(totalBroadleafLayers);
  const broadleafCanopyRadii = new Float32Array(totalBroadleafLayers);
  const trunkTreeRoots = new Float32Array(placements.length * 2);
  const trunkTreeBaseYs = new Float32Array(placements.length);
  const trunkTreeHeights = new Float32Array(placements.length);
  const trunkCanopyRadii = new Float32Array(placements.length);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scaleVector = new THREE.Vector3();
  const position = new THREE.Vector3();
  const color = new THREE.Color();
  const root = new THREE.Vector3();
  let coniferLayerIndex = 0;
  let broadleafLayerIndex = 0;

  trunkMesh.name = 'Instanced mixed forest trunks';
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  coniferShadowMesh.name = 'Instanced conifer crown shadows';
  coniferShadowMesh.layers.set(TREE_SHADOW_CAST_LAYER);
  coniferShadowMesh.castShadow = true;
  coniferShadowMesh.receiveShadow = false;
  coniferShadowMesh.customDepthMaterial = materials.shadowDepth;
  broadleafShadowMesh.name = 'Instanced broadleaf crown shadows';
  broadleafShadowMesh.layers.set(TREE_SHADOW_CAST_LAYER);
  broadleafShadowMesh.castShadow = true;
  broadleafShadowMesh.receiveShadow = false;
  broadleafShadowMesh.customDepthMaterial = materials.shadowDepth;
  coniferFoliageMesh.name = 'Instanced fir spruce pine larch tiers';
  coniferFoliageMesh.castShadow = false;
  coniferFoliageMesh.receiveShadow = true;
  broadleafFoliageMesh.name = 'Instanced beech maple ash elm lime oak textured tiers';
  broadleafFoliageMesh.castShadow = false;
  broadleafFoliageMesh.receiveShadow = true;

  placements.forEach((placement, treeIndex) => {
    const profile = getTreeSpeciesProfile(placement.species);
    const rootY = terrain.getHeightAt(placement.x, placement.z);
    const height = getRenderedTreeHeight(placement, profile, rng);
    const trunkRadius = getRenderedTrunkRadius(placement, profile, rng);
    const lean = new THREE.Vector3(
      (rng() - 0.5) * (profile.canopy === 'broadleaf' ? 0.058 : 0.042),
      1,
      (rng() - 0.5) * (profile.canopy === 'broadleaf' ? 0.058 : 0.042),
    ).normalize();
    const trunkHeight = getRenderedTrunkHeight(placement, profile, height);
    root.set(placement.x, rootY, placement.z);
    const trunkTop = root.clone().addScaledVector(lean, trunkHeight);
    composeBranchMatrix(root, trunkTop, trunkRadius, matrix, quaternion, scaleVector, position);
    trunkMesh.setMatrixAt(treeIndex, matrix);
    trunkMatrices[treeIndex].copy(matrix);
    color.set(profile.barkColor).offsetHSL((rng() - 0.5) * 0.012, (rng() - 0.5) * 0.04, (rng() - 0.5) * 0.08);
    trunkMesh.setColorAt(treeIndex, color);

    let treeCanopyRadius = getEstimatedCanopyRadius(placement.species, placement.form, placement.scale);
    if (profile.canopy === 'conifer') {
      treeCanopyRadius = Math.max(
        treeCanopyRadius,
        placeConiferCrown({
          placement,
          profile,
          rootY,
          height,
          lean,
          rng,
          layers: coniferLayerCounts[treeIndex],
          coniferFoliageMesh,
          coniferShadowMesh,
          coniferFoliageMatrices,
          coniferTreeRoots,
          coniferTreeBaseYs,
          coniferTreeHeights,
          coniferCanopyRadii,
          startIndex: coniferLayerIndex,
          matrix,
          quaternion,
          scaleVector,
          position,
          color,
        }),
      );
      coniferLayerIndex += coniferLayerCounts[treeIndex];
    } else {
      treeCanopyRadius = Math.max(
        treeCanopyRadius,
        placeBroadleafCrown({
          placement,
          profile,
          rootY,
          height,
          lean,
          rng,
          layers: broadleafLayerCounts[treeIndex],
          broadleafFoliageMesh,
          broadleafShadowMesh,
          broadleafFoliageMatrices,
          broadleafTreeRoots,
          broadleafTreeBaseYs,
          broadleafTreeHeights,
          broadleafCanopyRadii,
          startIndex: broadleafLayerIndex,
          matrix,
          quaternion,
          scaleVector,
          position,
          color,
        }),
      );
      broadleafLayerIndex += broadleafLayerCounts[treeIndex];
    }

    trunkTreeRoots[treeIndex * 2] = placement.x;
    trunkTreeRoots[treeIndex * 2 + 1] = placement.z;
    trunkTreeBaseYs[treeIndex] = rootY;
    trunkTreeHeights[treeIndex] = height;
    trunkCanopyRadii[treeIndex] = treeCanopyRadius;
  });

  setTreeShadowInstanceAttributes(trunkGeometry, trunkTreeRoots, trunkTreeBaseYs, trunkTreeHeights, trunkCanopyRadii);
  setTreeShadowInstanceAttributes(coniferGeometry, coniferTreeRoots, coniferTreeBaseYs, coniferTreeHeights, coniferCanopyRadii);
  setTreeShadowInstanceAttributes(broadleafGeometry, broadleafTreeRoots, broadleafTreeBaseYs, broadleafTreeHeights, broadleafCanopyRadii);

  trunkMesh.instanceMatrix.needsUpdate = true;
  coniferShadowMesh.instanceMatrix.needsUpdate = true;
  broadleafShadowMesh.instanceMatrix.needsUpdate = true;
  coniferFoliageMesh.instanceMatrix.needsUpdate = true;
  broadleafFoliageMesh.instanceMatrix.needsUpdate = true;
  if (trunkMesh.instanceColor) trunkMesh.instanceColor.needsUpdate = true;
  if (coniferFoliageMesh.instanceColor) coniferFoliageMesh.instanceColor.needsUpdate = true;
  if (broadleafFoliageMesh.instanceColor) broadleafFoliageMesh.instanceColor.needsUpdate = true;
  group.add(trunkMesh, coniferShadowMesh, broadleafShadowMesh, coniferFoliageMesh, broadleafFoliageMesh);
  return {
    group,
    trunkMesh,
    coniferFoliageMesh,
    broadleafFoliageMesh,
    coniferShadowMesh,
    broadleafShadowMesh,
    placements,
    coniferLayerCounts,
    broadleafLayerCounts,
    coniferStartIndex,
    broadleafStartIndex,
    trunkMatrices,
    coniferFoliageMatrices,
    broadleafFoliageMatrices,
  };
}

function getConiferLayerCount(placement: TreePlacement, rng: () => number): number {
  if (getTreeSpeciesProfile(placement.species).canopy !== 'conifer') return 0;
  const base =
    placement.form === 'young'
      ? 5
      : placement.species === 'norwaySpruce'
        ? 9
        : placement.species === 'silverFir'
          ? 8
          : placement.species === 'scotsPine'
            ? 6
            : 7;
  return base + Math.floor(rng() * 2);
}

function getBroadleafLayerCount(placement: TreePlacement, rng: () => number): number {
  if (getTreeSpeciesProfile(placement.species).canopy !== 'broadleaf') return 0;
  const base =
    placement.form === 'young'
      ? 4
      : placement.form === 'midstory'
        ? 5
        : placement.species === 'sessileOak'
          ? 10
          : placement.species === 'ash'
            ? 7
            : 8;
  return base + Math.floor(rng() * 3);
}

function getRenderedTreeHeight(
  placement: TreePlacement,
  profile: TreeSpeciesProfile,
  rng: () => number,
): number {
  const base =
    placement.form === 'midstory'
      ? 4.8 + rng() * 3.8
      : placement.form === 'young'
        ? 7.2 + rng() * 4.4
        : 15.5 + rng() * 7.5;
  const formMul = placement.form === 'young' ? 0.78 : placement.form === 'midstory' ? 0.82 : 1;
  return Math.min(47.5, base * placement.scale * profile.heightMul * formMul);
}

function getRenderedTrunkRadius(
  placement: TreePlacement,
  profile: TreeSpeciesProfile,
  rng: () => number,
): number {
  const formMul = placement.form === 'young' || placement.form === 'midstory' ? 0.68 : 1;
  return (0.25 + rng() * 0.14) * placement.scale * profile.trunkMul * formMul;
}

function getConiferCrownBounds(
  profile: TreeSpeciesProfile,
  isYoung: boolean,
): { crownBase: number; crownTop: number } {
  const crownBase = Math.min(isYoung ? Math.max(profile.lowWhorl, 0.22) : profile.lowWhorl, 0.42);
  const crownSpan = Math.min(profile.crownSpan * (isYoung ? 0.78 : 1), 0.86 - crownBase);
  return { crownBase, crownTop: crownBase + crownSpan };
}

function getBroadleafCrownBounds(
  profile: TreeSpeciesProfile,
  isYoung: boolean,
  isMidstory: boolean,
): { crownBase: number; crownTop: number } {
  const crownBase = Math.min(isYoung ? Math.max(profile.lowWhorl, 0.28) : profile.lowWhorl, 0.64);
  const crownSpan = Math.min(
    profile.crownSpan * (isMidstory ? 0.78 : isYoung ? 0.72 : 1),
    0.94 - crownBase,
  );
  return { crownBase, crownTop: crownBase + crownSpan };
}

function getRenderedTrunkHeight(
  placement: TreePlacement,
  profile: TreeSpeciesProfile,
  height: number,
): number {
  const isYoung = placement.form === 'young';
  const isMidstory = placement.form === 'midstory';

  if (profile.canopy === 'conifer') {
    const { crownTop } = getConiferCrownBounds(profile, isYoung);
    // Meet the top foliage tier at its center; foliage geometry extends above this point.
    return height * crownTop;
  }

  const { crownTop } = getBroadleafCrownBounds(profile, isYoung, isMidstory);
  const broadleafCap = isMidstory ? 0.74 : 0.82;
  return height * Math.min(broadleafCap, crownTop);
}

function placeConiferCrown(options: {
  placement: TreePlacement;
  profile: TreeSpeciesProfile;
  rootY: number;
  height: number;
  lean: THREE.Vector3;
  rng: () => number;
  layers: number;
  coniferFoliageMesh: THREE.InstancedMesh;
  coniferShadowMesh: THREE.InstancedMesh;
  coniferFoliageMatrices: THREE.Matrix4[];
  coniferTreeRoots: Float32Array;
  coniferTreeBaseYs: Float32Array;
  coniferTreeHeights: Float32Array;
  coniferCanopyRadii: Float32Array;
  startIndex: number;
  matrix: THREE.Matrix4;
  quaternion: THREE.Quaternion;
  scaleVector: THREE.Vector3;
  position: THREE.Vector3;
  color: THREE.Color;
}): number {
  const {
    placement,
    profile,
    rootY,
    height,
    lean,
    rng,
    layers,
    coniferFoliageMesh,
    coniferShadowMesh,
    coniferFoliageMatrices,
    coniferTreeRoots,
    coniferTreeBaseYs,
    coniferTreeHeights,
    coniferCanopyRadii,
    startIndex,
    matrix,
    quaternion,
    scaleVector,
    position,
    color,
  } = options;
  const yawOffset = rng() * TAU;
  const isYoung = placement.form === 'young';
  const { crownBase: lowWhorl, crownTop } = getConiferCrownBounds(profile, isYoung);
  const crownSpan = crownTop - lowWhorl;
  const scaleMul = isYoung ? 0.74 : 1;
  let maxTierRadius = 0;

  for (let i = 0; i < layers; i++) {
    const t = layers > 1 ? i / (layers - 1) : 0;
    const layerIndex = startIndex + i;
    const whorl = lowWhorl + t * crownSpan;
    const tierRadius =
      (3.15 * Math.pow(1 - t, profile.radiusPower) + (isYoung ? 0.34 : 0.5)) *
      placement.scale *
      profile.spreadMul *
      scaleMul *
      (0.92 + rng() * 0.16);
    const tierHeight =
      (1.95 * (1 - t * (placement.species === 'norwaySpruce' ? 0.28 : 0.36)) + 0.18) *
      placement.scale *
      scaleMul *
      (placement.species === 'silverFir' ? 0.9 : placement.species === 'norwaySpruce' ? 1.08 : 1);
    const sway = (1 - t) * (placement.species === 'scotsPine' ? 0.7 : 0.46);

    position.set(
      placement.x + lean.x * height * whorl + Math.cos(yawOffset + i * 1.74) * sway * rng(),
      rootY + height * whorl,
      placement.z + lean.z * height * whorl + Math.sin(yawOffset + i * 1.74) * sway * rng(),
    );
    quaternion.setFromEuler(
      new THREE.Euler((rng() - 0.5) * 0.075, yawOffset + i * 0.83, (rng() - 0.5) * 0.075),
    );
    scaleVector.set(tierRadius, tierHeight, tierRadius * (0.9 + rng() * 0.16));
    maxTierRadius = Math.max(maxTierRadius, tierRadius);
    matrix.compose(position, quaternion, scaleVector);
    coniferFoliageMesh.setMatrixAt(layerIndex, matrix);
    coniferShadowMesh.setMatrixAt(layerIndex, matrix);
    coniferFoliageMatrices[layerIndex].copy(matrix);
    color
      .set(profile.foliageColor)
      .offsetHSL((rng() - 0.5) * 0.018, (rng() - 0.5) * 0.052, (t - 0.45) * 0.055 + (rng() - 0.5) * 0.04);
    coniferFoliageMesh.setColorAt(layerIndex, color);
    coniferTreeRoots[layerIndex * 2] = placement.x;
    coniferTreeRoots[layerIndex * 2 + 1] = placement.z;
    coniferTreeBaseYs[layerIndex] = rootY;
    coniferTreeHeights[layerIndex] = height;
  }

  const canopyRadius = maxTierRadius * 1.06;
  for (let i = 0; i < layers; i++) {
    coniferCanopyRadii[startIndex + i] = canopyRadius;
  }
  return canopyRadius;
}

function placeBroadleafCrown(options: {
  placement: TreePlacement;
  profile: TreeSpeciesProfile;
  rootY: number;
  height: number;
  lean: THREE.Vector3;
  rng: () => number;
  layers: number;
  broadleafFoliageMesh: THREE.InstancedMesh;
  broadleafShadowMesh: THREE.InstancedMesh;
  broadleafFoliageMatrices: THREE.Matrix4[];
  broadleafTreeRoots: Float32Array;
  broadleafTreeBaseYs: Float32Array;
  broadleafTreeHeights: Float32Array;
  broadleafCanopyRadii: Float32Array;
  startIndex: number;
  matrix: THREE.Matrix4;
  quaternion: THREE.Quaternion;
  scaleVector: THREE.Vector3;
  position: THREE.Vector3;
  color: THREE.Color;
}): number {
  const {
    placement,
    profile,
    rootY,
    height,
    lean,
    rng,
    layers,
    broadleafFoliageMesh,
    broadleafShadowMesh,
    broadleafFoliageMatrices,
    broadleafTreeRoots,
    broadleafTreeBaseYs,
    broadleafTreeHeights,
    broadleafCanopyRadii,
    startIndex,
    matrix,
    quaternion,
    scaleVector,
    position,
    color,
  } = options;
  const yawOffset = rng() * TAU;
  const isYoung = placement.form === 'young';
  const isMidstory = placement.form === 'midstory';
  const { crownBase, crownTop } = getBroadleafCrownBounds(profile, isYoung, isMidstory);
  const crownSpan = crownTop - crownBase;
  const scaleMul = isYoung ? 0.72 : isMidstory ? 0.82 : 1;
  const crownBreadth =
    placement.species === 'sessileOak'
      ? 1.14
      : placement.species === 'ash'
        ? 0.86
        : placement.species === 'hornbeam'
          ? 0.84
          : 1;
  let maxTierRadius = 0;

  for (let i = 0; i < layers; i++) {
    const layerIndex = startIndex + i;
    const t = layers > 1 ? i / (layers - 1) : 0;
    const whorl = crownBase + t * crownSpan;
    const shoulder = 1 - Math.abs(t - 0.34) * 0.44;
    const tierRadius =
      (2.95 * Math.pow(1 - t * 0.72, profile.radiusPower) * shoulder + 0.42) *
      placement.scale *
      profile.spreadMul *
      crownBreadth *
      scaleMul *
      (0.9 + rng() * 0.18);
    const tierHeight =
      (1.48 * (1 - t * 0.2) + 0.22) *
      placement.scale *
      scaleMul *
      (placement.species === 'ash' || placement.species === 'wychElm' ? 1.08 : 1);
    const sway = (1 - t) * (placement.species === 'sessileOak' ? 0.82 : 0.52);

    position.set(
      placement.x + lean.x * height * whorl + Math.cos(yawOffset + i * 1.58) * sway * rng(),
      rootY + height * whorl,
      placement.z + lean.z * height * whorl + Math.sin(yawOffset + i * 1.58) * sway * rng(),
    );
    quaternion.setFromEuler(
      new THREE.Euler((rng() - 0.5) * 0.08, yawOffset + i * 0.92, (rng() - 0.5) * 0.08),
    );
    scaleVector.set(tierRadius, tierHeight, tierRadius * (0.88 + rng() * 0.18));
    maxTierRadius = Math.max(maxTierRadius, tierRadius);
    matrix.compose(position, quaternion, scaleVector);
    broadleafFoliageMesh.setMatrixAt(layerIndex, matrix);
    broadleafShadowMesh.setMatrixAt(layerIndex, matrix);
    broadleafFoliageMatrices[layerIndex].copy(matrix);
    color
      .set(profile.foliageColor)
      .offsetHSL((rng() - 0.5) * 0.026, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.075);
    broadleafFoliageMesh.setColorAt(layerIndex, color);
    broadleafTreeRoots[layerIndex * 2] = placement.x;
    broadleafTreeRoots[layerIndex * 2 + 1] = placement.z;
    broadleafTreeBaseYs[layerIndex] = rootY;
    broadleafTreeHeights[layerIndex] = height;
  }

  const canopyRadius = maxTierRadius * 1.08;
  for (let i = 0; i < layers; i++) {
    broadleafCanopyRadii[startIndex + i] = canopyRadius;
  }
  return canopyRadius;
}

function composeBranchMatrix(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  matrix: THREE.Matrix4,
  quaternion: THREE.Quaternion,
  scaleVector: THREE.Vector3,
  position: THREE.Vector3,
): void {
  const direction = end.clone().sub(start);
  const length = direction.length();
  position.copy(start).addScaledVector(direction, 0.5);
  quaternion.setFromUnitVectors(UP, direction.normalize());
  scaleVector.set(radius, length, radius);
  matrix.compose(position, quaternion, scaleVector);
}

/** Solid cone envelope aligned to unit pine needle tiers — fills gaps between star arms for coherent shadows. */
function createPineShadowTierGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(0.14, 1.0, 0.88, 12, 1, false);
  geometry.translate(0, -0.05, 0);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createPineTierGeometry(): THREE.BufferGeometry {
  const arms = 12;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let ring = 0; ring < 2; ring++) {
    for (let i = 0; i < arms; i++) {
      const span = TAU / arms;
      const angle = (i / arms) * TAU + ring * span * 0.5;
      const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const bend = stableSurfaceNoise(direction, 10.3 + ring) - 0.5;
      const ringScale = ring === 0 ? 1 : 0.68;
      const outerRadius = (0.9 + stableSurfaceNoise(direction, 16.8 + ring) * 0.16) * ringScale;
      const spread = ring === 0 ? 0.38 : 0.32;
      const leftAngle = angle - span * (spread + stableSurfaceNoise(direction, 22.1 + ring) * 0.08);
      const rightAngle = angle + span * (spread + stableSurfaceNoise(direction, 28.6 + ring) * 0.08);
      const midRadius = outerRadius * (0.56 + stableSurfaceNoise(direction, 32.4 + ring) * 0.06);
      const innerRadius = 0.1 + stableSurfaceNoise(direction, 37.9 + ring) * 0.04;
      const rootY = (ring === 0 ? 0.34 : 0.44) + bend * 0.05;
      const midY = (ring === 0 ? -0.05 : 0.04) - stableSurfaceNoise(direction, 42.7 + ring) * 0.07;
      const tipY = (ring === 0 ? -0.43 : -0.24) - stableSurfaceNoise(direction, 47.5 + ring) * 0.14;
      const base = positions.length / 3;

      positions.push(
        Math.cos(angle) * innerRadius,
        rootY,
        Math.sin(angle) * innerRadius,
        Math.cos(leftAngle) * midRadius,
        midY,
        Math.sin(leftAngle) * midRadius,
        Math.cos(angle + bend * 0.08) * outerRadius,
        tipY,
        Math.sin(angle + bend * 0.08) * outerRadius,
        Math.cos(rightAngle) * midRadius,
        midY,
        Math.sin(rightAngle) * midRadius,
      );
      uvs.push(0.5, 1, 0, 0.42, 0.5, 0, 1, 0.42);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Solid dome envelope for boulder shadow proxies — stable ground silhouettes without mesh self-shadow. */
export function createRockShadowGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, Math.PI * 0.52);
  geometry.scale(1, 0.48, 1);
  geometry.translate(0, -0.12, 0);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createRockField(
  placements: RockPlacement[],
  terrain: Terrain,
  material: THREE.Material,
  shadowCast: THREE.MeshStandardMaterial,
  shadowDepth: THREE.MeshDepthMaterial,
  rng: () => number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Instanced mossy boulder field';
  const shapeSeeds = [1.3, 7.7, 13.2] as const;
  const profiles: RockProfile[] = ['flat', 'moderate', 'tall'];
  const variants = profiles.flatMap((profile) =>
    shapeSeeds.map((seed) => createBoulderGeometry(seed, profile)),
  );
  const shadowGeometry = createRockShadowGeometry();
  const buckets = variants.map(() => [] as RockPlacement[]);
  placements.forEach((placement, index) => {
    const profileIndex = profiles.indexOf(placement.profile);
    const bucketIndex = profileIndex * shapeSeeds.length + (index % shapeSeeds.length);
    buckets[bucketIndex].push(placement);
  });
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scaleVector = new THREE.Vector3();

  buckets.forEach((bucket, variantIndex) => {
    if (bucket.length === 0) return;
    const mesh = new THREE.InstancedMesh(variants[variantIndex], material, bucket.length);
    mesh.name = `Instanced mossy boulders ${variantIndex + 1}`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    const shadowMesh = new THREE.InstancedMesh(shadowGeometry, shadowCast, bucket.length);
    shadowMesh.name = `Instanced mossy boulder shadows ${variantIndex + 1}`;
    shadowMesh.layers.set(TREE_SHADOW_CAST_LAYER);
    shadowMesh.castShadow = true;
    shadowMesh.receiveShadow = false;
    shadowMesh.customDepthMaterial = shadowDepth;
    bucket.forEach((rock, rockIndex) => {
      const y = terrain.getHeightAt(rock.x, rock.z);
      position.set(rock.x, y + rock.scale * 0.18, rock.z);
      quaternion.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.18, rng() * TAU, (rng() - 0.5) * 0.18));
      rockInstanceScaleForProfile(rock.profile, rock.scale, rng, scaleVector);
      matrix.compose(position, quaternion, scaleVector);
      mesh.setMatrixAt(rockIndex, matrix);
      shadowMesh.setMatrixAt(rockIndex, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    shadowMesh.instanceMatrix.needsUpdate = true;
    group.add(mesh, shadowMesh);
  });

  return group;
}

function rockInstanceScaleForProfile(
  profile: RockProfile,
  scale: number,
  rng: () => number,
  target: THREE.Vector3,
): THREE.Vector3 {
  switch (profile) {
    case 'flat':
      return target.set(
        scale * (1.12 + rng() * 0.72),
        scale * (0.34 + rng() * 0.22),
        scale * (0.95 + rng() * 0.55),
      );
    case 'moderate':
      return target.set(
        scale * (1.02 + rng() * 0.58),
        scale * (0.62 + rng() * 0.36),
        scale * (0.88 + rng() * 0.48),
      );
    case 'tall':
      return target.set(
        scale * (0.84 + rng() * 0.42),
        scale * (0.96 + rng() * 0.68),
        scale * (0.8 + rng() * 0.38),
      );
    default: {
      const _exhaustive: never = profile;
      throw new Error(`Unhandled rock profile: ${_exhaustive}`);
    }
  }
}

function createBoulderGeometry(seed: number, profile: RockProfile = 'moderate'): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uvs: number[] = [];
  const point = new THREE.Vector3();

  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).normalize();
    const ridge =
      0.82 +
      stableSurfaceNoise(point, seed) * 0.28 +
      Math.sin(point.x * 7.1 + point.z * 3.3 + seed) * 0.06;
    point.multiplyScalar(ridge);
    const ySquash =
      profile === 'flat'
        ? 0.46 + stableSurfaceNoise(point, seed + 4.1) * 0.14
        : profile === 'moderate'
          ? 0.68 + stableSurfaceNoise(point, seed + 4.1) * 0.16
          : 0.9 + stableSurfaceNoise(point, seed + 4.1) * 0.18;
    point.y *= ySquash;
    const bottomFlatten = profile === 'tall' ? 0.42 : 0.58;
    if (point.y < -0.24) point.y = THREE.MathUtils.lerp(point.y, -0.28, bottomFlatten);
    position.setXYZ(i, point.x, point.y, point.z);
    uvs.push(Math.atan2(point.z, point.x) / TAU + 0.5, point.y * 0.42 + 0.5);
  }

  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = saturate((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function saturate(value: number): number {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function stableSurfaceNoise(point: THREE.Vector3, seed: number): number {
  const value = Math.sin(point.x * 127.1 + point.y * 311.7 + point.z * 74.7 + seed * 19.19) * 43758.5453123;
  return value - Math.floor(value);
}

function disposeForestMaterials(materials: ForestMaterialSet): void {
  materials.bark.dispose();
  materials.rock.dispose();
  materials.shadowCast.dispose();
  materials.shadowDepth.dispose();
  materials.coniferFoliage.dispose();
  materials.broadleafFoliage.dispose();
  materials.textures.forEach((texture) => texture.dispose());
}
