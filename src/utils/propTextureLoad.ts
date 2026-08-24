import * as THREE from 'three';
import { loadBitmapTexture } from './textureLoad.ts';

export type RockTextureRole = 'forest' | 'meadow' | 'river' | 'quarry';

export type RockTextureSet<Role extends RockTextureRole> = {
  role: Role;
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  aoMap?: THREE.Texture;
};

export type MossyRockTextureSet = RockTextureSet<'forest'>;

async function loadRockTextureSet<Role extends RockTextureRole>(
  role: Role,
  base: string,
  maxAnisotropy: number,
  withAo: boolean,
): Promise<RockTextureSet<Role>> {
  const [map, normalMap, roughnessMap, aoMap] = await Promise.all([
    loadBitmapTexture(`${base}/albedo.png`, maxAnisotropy, { srgb: true }),
    loadBitmapTexture(`${base}/normal.png`, maxAnisotropy),
    loadBitmapTexture(`${base}/roughness.png`, maxAnisotropy),
    withAo ? loadBitmapTexture(`${base}/ao.png`, maxAnisotropy) : Promise.resolve(undefined),
  ]);
  if (aoMap) aoMap.channel = 1;
  return { role, map, normalMap, roughnessMap, aoMap };
}

export function loadForestRockTextures(maxAnisotropy: number): Promise<RockTextureSet<'forest'>> {
  return loadRockTextureSet(
    'forest',
    '/assets/textures/props/gorski_forest_mossy_rock_v1',
    maxAnisotropy,
    true,
  );
}

export function loadNeutralMeadowRockTextures(maxAnisotropy: number): Promise<RockTextureSet<'meadow'>> {
  return loadRockTextureSet(
    'meadow',
    '/assets/textures/props/mossy_rock',
    maxAnisotropy,
    false,
  );
}

export function loadRiverRockTextures(maxAnisotropy: number): Promise<RockTextureSet<'river'>> {
  return loadRockTextureSet(
    'river',
    '/assets/textures/props/gorski_river_stone_v1',
    maxAnisotropy,
    true,
  );
}

export function loadQuarryRockTextures(maxAnisotropy: number): Promise<RockTextureSet<'quarry'>> {
  return loadRockTextureSet(
    'quarry',
    '/assets/textures/props/gorski_quarry_limestone_v1',
    maxAnisotropy,
    true,
  );
}

/** Compatibility name for isolated forest-material lineups. */
export function loadMossyRockTextures(maxAnisotropy: number): Promise<MossyRockTextureSet> {
  return loadForestRockTextures(maxAnisotropy);
}

export function disposeRockTextureSet(set: RockTextureSet<RockTextureRole>): void {
  const owned = new Set<THREE.Texture>([
    set.map,
    set.normalMap,
    set.roughnessMap,
    ...(set.aoMap ? [set.aoMap] : []),
  ]);
  owned.forEach((texture) => texture.dispose());
}

export async function loadPineFoliageTextures(maxAnisotropy: number): Promise<{
  needleMap: THREE.Texture;
  needleRoughnessMap: THREE.Texture;
}> {
  const base = '/assets/textures/props/pine_foliage';
  const [needleMap, needleRoughnessMap] = await Promise.all([
    loadBitmapTexture(`${base}/albedo.png`, maxAnisotropy, { srgb: true, anisotropyLimit: 4 }),
    loadBitmapTexture(`${base}/roughness.png`, maxAnisotropy, { anisotropyLimit: 4 }),
  ]);
  return { needleMap, needleRoughnessMap };
}
