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

// Keep separate role-owned texture instances so river/quarry lifecycles can
// dispose independently, but deliberately give every natural rock the same
// established mossy visual identity.
const MOSSY_ROCK_TEXTURE_BASE = '/assets/textures/props/mossy_rock';

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
    MOSSY_ROCK_TEXTURE_BASE,
    maxAnisotropy,
    false,
  );
}

export function loadNeutralMeadowRockTextures(maxAnisotropy: number): Promise<RockTextureSet<'meadow'>> {
  return loadRockTextureSet(
    'meadow',
    MOSSY_ROCK_TEXTURE_BASE,
    maxAnisotropy,
    false,
  );
}

export function loadRiverRockTextures(maxAnisotropy: number): Promise<RockTextureSet<'river'>> {
  return loadRockTextureSet(
    'river',
    MOSSY_ROCK_TEXTURE_BASE,
    maxAnisotropy,
    false,
  );
}

export function loadQuarryRockTextures(maxAnisotropy: number): Promise<RockTextureSet<'quarry'>> {
  return loadRockTextureSet(
    'quarry',
    MOSSY_ROCK_TEXTURE_BASE,
    maxAnisotropy,
    false,
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
