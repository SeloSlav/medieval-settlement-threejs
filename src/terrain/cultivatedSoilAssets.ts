import * as THREE from 'three';

export const CULTIVATED_SOIL_TEXTURE_PATHS = Object.freeze({
  albedo: '/assets/textures/terrain/mammoth_terrain_dirt/albedo.png',
  normal: '/assets/textures/terrain/mammoth_terrain_dirt/normal.png',
  roughness: '/assets/textures/terrain/mammoth_terrain_dirt/roughness.png',
});

export type CultivatedSoilTextures = {
  albedo: THREE.Texture | null;
  normal: THREE.Texture | null;
  roughness: THREE.Texture | null;
};

function loadTexture(
  path: string,
  name: string,
  colorSpace: THREE.ColorSpace,
): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const texture = new THREE.TextureLoader().load(path);
  texture.name = name;
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  return texture;
}

/** Shared PBR identity used by backyard beds and full agricultural parcels. */
export const CULTIVATED_SOIL_TEXTURES: CultivatedSoilTextures = Object.freeze({
  albedo: loadTexture(
    CULTIVATED_SOIL_TEXTURE_PATHS.albedo,
    'Shared cultivated-soil albedo',
    THREE.SRGBColorSpace,
  ),
  normal: loadTexture(
    CULTIVATED_SOIL_TEXTURE_PATHS.normal,
    'Shared cultivated-soil normal',
    THREE.NoColorSpace,
  ),
  roughness: loadTexture(
    CULTIVATED_SOIL_TEXTURE_PATHS.roughness,
    'Shared cultivated-soil roughness',
    THREE.NoColorSpace,
  ),
});

