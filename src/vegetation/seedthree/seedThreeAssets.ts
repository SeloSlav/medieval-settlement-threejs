import * as THREE from 'three';
import { makeBarkMaterial } from '@seedthree/core/tree.js';
import { makeFoliageMaterial } from '@seedthree/core/leaf-cards.js';
import { seedThreeBarkUrl, seedThreeLeafUrl } from './seedThreeTextures.ts';

export type SeedThreeSpeciesPreset = {
  name: string;
  bark: string;
  leaf: string;
  foliage?: Record<string, unknown>;
  foliageType?: string;
  cactus?: boolean;
  thatchBark?: string;
  params?: Record<string, unknown>;
};

export type SeedThreeCanopyCenterUniform = {
  value: THREE.Vector3;
};

export type SeedThreeFoliageColorUniform = {
  value: THREE.Color;
};

export type SeedThreeFoliageAmountUniform = {
  value: number;
};

export type SeedThreeSpeciesAssets = {
  barkTexture: THREE.Texture | null;
  barkNormal: THREE.Texture | null;
  barkRoughness: THREE.Texture | null;
  leafTexture: THREE.Texture | null;
  leafTranslucency: THREE.Texture | null;
  leafNormal: THREE.Texture | null;
  leafRoughness: THREE.Texture | null;
  barkMat: THREE.Material;
  leafMat: THREE.Material;
  clusterMat: THREE.Material;
  leafCenter: SeedThreeCanopyCenterUniform;
  clusterCenter: SeedThreeCanopyCenterUniform;
  leafTintColor: SeedThreeFoliageColorUniform;
  leafTintAmount: SeedThreeFoliageAmountUniform;
  clusterTintColor: SeedThreeFoliageColorUniform;
  clusterTintAmount: SeedThreeFoliageAmountUniform;
};

export type SeedThreeSpeciesAssetStartupTiming = {
  species: string;
  source: 'memory' | 'loaded';
  startedAtMs: number;
  completedAtMs: number;
  durationMs: number;
  textureCount: number;
};

const loader = new THREE.TextureLoader();
const assetCache = new Map<string, SeedThreeSpeciesAssets>();
const assetPromiseCache = new Map<string, Promise<SeedThreeSpeciesAssets>>();
const startupTimings = new Map<string, SeedThreeSpeciesAssetStartupTiming>();
let assetCacheGeneration = 0;

async function loadTex(url: string | undefined, srgb: boolean): Promise<THREE.Texture | null> {
  if (!url) return null;
  const tex = await loader.loadAsync(url);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return tex;
}

async function loadOptional(url: string | undefined, srgb: boolean): Promise<THREE.Texture | null> {
  if (!url) return null;
  try {
    return await loadTex(url, srgb);
  } catch {
    return null;
  }
}

export async function loadSeedThreeSpeciesAssets(
  species: SeedThreeSpeciesPreset,
  maxAnisotropy: number,
): Promise<SeedThreeSpeciesAssets> {
  const cached = assetCache.get(species.name);
  if (cached) {
    const prior = startupTimings.get(species.name);
    if (prior) startupTimings.set(species.name, { ...prior, source: 'memory' });
    return cached;
  }
  const pending = assetPromiseCache.get(species.name);
  if (pending) return pending;

  const startedAtMs = performance.now();
  const requestGeneration = assetCacheGeneration;
  const request = createSeedThreeSpeciesAssets(species, maxAnisotropy);
  assetPromiseCache.set(species.name, request);
  try {
    const assets = await request;
    if (requestGeneration !== assetCacheGeneration) {
      disposeSpeciesAssets(assets);
      throw new Error(`SeedThree asset load invalidated during disposal: ${species.name}`);
    }
    assetCache.set(species.name, assets);
    const completedAtMs = performance.now();
    startupTimings.set(species.name, {
      species: species.name,
      source: 'loaded',
      startedAtMs,
      completedAtMs,
      durationMs: completedAtMs - startedAtMs,
      textureCount: countSpeciesTextures(assets),
    });
    return assets;
  } catch (error) {
    if (assetPromiseCache.get(species.name) === request) {
      assetPromiseCache.delete(species.name);
    }
    throw error;
  }
}

export function getSeedThreeSpeciesAssetStartupTimings(): SeedThreeSpeciesAssetStartupTiming[] {
  return [...startupTimings.values()].map((timing) => ({ ...timing }));
}

/** Read-only cache access for props that deliberately share the live tree's GPU textures. */
export function getCachedSeedThreeSpeciesAssets(
  speciesName: string,
): SeedThreeSpeciesAssets | null {
  return assetCache.get(speciesName) ?? null;
}

async function createSeedThreeSpeciesAssets(
  species: SeedThreeSpeciesPreset,
  maxAnisotropy: number,
): Promise<SeedThreeSpeciesAssets> {

  const base = species.bark.replace('_albedo.png', '');
  const leafBase = species.leaf.replace(/(_albedo)?\.png$/, '');

  const textureResults = await Promise.allSettled([
    loadTex(seedThreeBarkUrl(species.bark), true),
    loadOptional(seedThreeBarkUrl(`${base}_normal.png`), false),
    loadOptional(seedThreeBarkUrl(`${base}_roughness.png`), false),
    loadTex(seedThreeLeafUrl(species.leaf), true),
    loadOptional(seedThreeLeafUrl(`${leafBase}_translucency.png`), false),
    loadOptional(seedThreeLeafUrl(`${leafBase}_normal.png`), false),
    loadOptional(seedThreeLeafUrl(`${leafBase}_roughness.png`), false),
  ]);
  const requiredFailure = [textureResults[0], textureResults[3]].find(
    (result): result is PromiseRejectedResult => result?.status === 'rejected',
  );
  if (requiredFailure) {
    // Promise.all abandoned already-fulfilled sibling textures on a required
    // bark/leaf failure. Wait for the fixed seven-request cohort, release every
    // successful decode, then preserve the original required-error behavior.
    for (const result of textureResults) {
      if (result.status === 'fulfilled') result.value?.dispose();
    }
    throw requiredFailure.reason;
  }
  const textures = textureResults.map((result) => (
    result.status === 'fulfilled' ? result.value : null
  ));
  const [
    barkTexture,
    barkNormal,
    barkRoughness,
    leafTexture,
    leafTranslucency,
    leafNormal,
    leafRoughness,
  ] = textures;

  for (const tex of [barkTexture, barkNormal, barkRoughness, leafTexture, leafTranslucency, leafNormal, leafRoughness]) {
    if (tex) tex.anisotropy = maxAnisotropy;
  }

  const vendorAssets = {
    barkTexture,
    barkNormal,
    barkRoughness,
    leafTexture,
    leafTranslucency,
    leafNormal,
    leafRoughness,
  };

  const barkMat = makeBarkMaterial(vendorAssets);
  const leafFol = makeFoliageMaterial(vendorAssets, { ...species.foliage, mode: 'leaves' });
  const clusterFol = makeFoliageMaterial(vendorAssets, { ...species.foliage, mode: 'clusters' });

  return {
    ...vendorAssets,
    barkMat,
    leafMat: leafFol.material,
    clusterMat: clusterFol.material,
    leafCenter: leafFol.centerUniform as SeedThreeCanopyCenterUniform,
    clusterCenter: clusterFol.centerUniform as SeedThreeCanopyCenterUniform,
    leafTintColor: leafFol.tintNode as SeedThreeFoliageColorUniform,
    leafTintAmount: leafFol.tintAmount as SeedThreeFoliageAmountUniform,
    clusterTintColor: clusterFol.tintNode as SeedThreeFoliageColorUniform,
    clusterTintAmount: clusterFol.tintAmount as SeedThreeFoliageAmountUniform,
  };

}

function countSpeciesTextures(assets: SeedThreeSpeciesAssets): number {
  return [
    assets.barkTexture,
    assets.barkNormal,
    assets.barkRoughness,
    assets.leafTexture,
    assets.leafTranslucency,
    assets.leafNormal,
    assets.leafRoughness,
  ].filter(Boolean).length;
}

export function disposeSeedThreeAssetCache(): void {
  assetCacheGeneration += 1;
  for (const assets of assetCache.values()) {
    disposeSpeciesAssets(assets);
  }
  assetCache.clear();
  assetPromiseCache.clear();
  startupTimings.clear();
}

function disposeSpeciesAssets(assets: SeedThreeSpeciesAssets): void {
  assets.barkTexture?.dispose();
  assets.barkNormal?.dispose();
  assets.barkRoughness?.dispose();
  assets.leafTexture?.dispose();
  assets.leafTranslucency?.dispose();
  assets.leafNormal?.dispose();
  assets.leafRoughness?.dispose();
  assets.barkMat.dispose();
  assets.leafMat.dispose();
  assets.clusterMat.dispose();
}
