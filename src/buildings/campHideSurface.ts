import * as THREE from 'three';
import { mix, texture } from 'three/tsl';
import type { MeshPhysicalNodeMaterial } from 'three/webgpu';
import type { BuildingAtlasMaterial } from './buildingMaterialAtlas.ts';
import { loadBitmapTexture } from '../utils/textureLoad.ts';

export const CAMP_HIDE_METERS_PER_REPEAT = 1.6;
export const CAMP_HIDE_TEXTURE_ROOT = '/assets/textures/buildings/gorski_camp_surfaces_v1';
const CHANNELS = ['albedo', 'normal', 'material'] as const;
type HideTextures = Record<(typeof CHANNELS)[number], THREE.Texture>;
let textures: HideTextures | null = null;
let loadPromise: Promise<void> | null = null;
let loaded = false;

function getTextures(): HideTextures {
  if (!textures) {
    const makeTexture = (channel: (typeof CHANNELS)[number]): THREE.Texture => {
      const handle = new THREE.Texture();
      handle.name = `Stitched brown hide ${channel}`;
      handle.wrapS = handle.wrapT = THREE.RepeatWrapping;
      handle.minFilter = THREE.LinearMipmapLinearFilter;
      handle.magFilter = THREE.LinearFilter;
      handle.generateMipmaps = true;
      if (channel === 'albedo') handle.colorSpace = THREE.SRGBColorSpace;
      handle.userData.sourceUrl = `${CAMP_HIDE_TEXTURE_ROOT}/stitched_hide_${channel}.png`;
      return handle;
    };
    textures = { albedo: makeTexture('albedo'), normal: makeTexture('normal'), material: makeTexture('material') };
  }
  return textures;
}

/** The existing sewn animal-hide asset is a specialty surface, not linen atlas UVs. */
export function applyCampHideSurface(material: BuildingAtlasMaterial): void {
  const maps = getTextures();
  material.userData.campSurface = 'stitched-brown-hide';
  material.userData.metricUvMeters = CAMP_HIDE_METERS_PER_REPEAT;
  material.map = maps.albedo;
  material.normalMap = maps.normal;
  material.normalScale.setScalar(0.48);
  // Broad, restrained fibre/suede grazing response; never glossy plastic or
  // transparent glass. MeshPhysicalNodeMaterial owns the energy-conserving BRDF.
  const physical = material as unknown as MeshPhysicalNodeMaterial & THREE.MeshPhysicalMaterial;
  physical.sheen = 0.22;
  physical.sheenColor.setHex(0x9b7652);
  physical.sheenRoughness = 0.92;
  physical.specularIntensity = 0.35;
  physical.clearcoat = 0;
  physical.transmission = 0;
  // This asset packs roughness in R and AO in B, not glTF's G roughness.
  const packed = texture(maps.material) as {
    r: { clamp(min: number, max: number): unknown };
    b: unknown;
  };
  material.roughnessNode = packed.r.clamp(0.78, 1) as never;
  material.aoNode = mix(1, packed.b, 0.5) as never;
  material.needsUpdate = true;
}

export async function initializeCampHideSurface(
  maxAnisotropy = 8,
  preloadTexture?: (texture: THREE.Texture) => void,
): Promise<void> {
  const shared = getTextures();
  if (!loadPromise) {
    loadPromise = Promise.all(CHANNELS.map(async (channel) => {
      const source = await loadBitmapTexture(
        `${CAMP_HIDE_TEXTURE_ROOT}/stitched_hide_${channel}.png`,
        maxAnisotropy,
        { srgb: channel === 'albedo', anisotropyLimit: 8 },
      );
      const target = shared[channel];
      const name = target.name;
      const sourceUrl = target.userData.sourceUrl;
      target.copy(source);
      target.name = name;
      target.userData.sourceUrl = sourceUrl;
      target.needsUpdate = true;
      source.dispose();
    })).then(() => { loaded = true; }).catch((error: unknown) => {
      loadPromise = null;
      throw error;
    });
  }
  await loadPromise;
  for (const channel of CHANNELS) preloadTexture?.(shared[channel]);
}

export function getCampHideSurfaceStats(): { loaded: boolean; textures: number } {
  return { loaded, textures: loaded ? CHANNELS.length : 0 };
}

export function disposeCampHideSurface(): void {
  if (textures) for (const channel of CHANNELS) textures[channel].dispose();
  textures = null;
  loadPromise = null;
  loaded = false;
}
