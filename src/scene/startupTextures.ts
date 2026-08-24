import * as THREE from 'three';
import { loadSkyPerlinTexture } from '../sky/SkyCloudMesh.ts';
import {
  loadQuarryRockTextures,
  loadRiverRockTextures,
  type RockTextureRole,
  type RockTextureSet,
} from '../utils/propTextureLoad.ts';

export type SceneStartupTextures = {
  riverRock: RockTextureSet<'river'>;
  quarryRock: RockTextureSet<'quarry'>;
  skyPerlin: THREE.Texture;
  ready?: Promise<void>;
};

const DEFAULT_MAX_ANISOTROPY = 8;

export function beginStartupTextureLoad(maxAnisotropy = DEFAULT_MAX_ANISOTROPY): Promise<SceneStartupTextures> {
  return Promise.all([
    loadRiverRockTextures(maxAnisotropy),
    loadQuarryRockTextures(maxAnisotropy),
    loadSkyPerlinTexture(),
  ]).then(([riverRock, quarryRock, skyPerlin]) => ({ riverRock, quarryRock, skyPerlin }));
}

export function beginProgressiveStartupTextureLoad(
  maxAnisotropy = DEFAULT_MAX_ANISOTROPY,
): Promise<SceneStartupTextures> {
  // Match the shared mossy-rock identity during progressive loading so the
  // scene never flashes pale river or quarry stones before hydration.
  const riverRock = placeholderRockTextureSet('river', [95, 102, 91, 255]);
  const quarryRock = placeholderRockTextureSet('quarry', [95, 102, 91, 255]);
  const skyPerlin = placeholderTexture([128, 128, 128, 255], false);
  const textures: SceneStartupTextures = { riverRock, quarryRock, skyPerlin };
  textures.ready = beginStartupTextureLoad(maxAnisotropy)
    .then((loaded) => {
      hydrateRockTextureSet(riverRock, loaded.riverRock);
      hydrateRockTextureSet(quarryRock, loaded.quarryRock);
      hydrateTexture(skyPerlin, loaded.skyPerlin);
    });
  return Promise.resolve(textures);
}

export function applyMaxAnisotropy(textures: SceneStartupTextures, maxAnisotropy: number): void {
  const limit = Math.max(1, Math.min(16, maxAnisotropy));
  for (const texture of [
    ...rockTextures(textures.riverRock),
    ...rockTextures(textures.quarryRock),
  ]) {
    texture.anisotropy = limit;
  }
}

function placeholderRockTextureSet<Role extends 'river' | 'quarry'>(
  role: Role,
  albedo: [number, number, number, number],
): RockTextureSet<Role> {
  const aoMap = placeholderTexture([242, 242, 242, 255], false);
  aoMap.channel = 1;
  return {
    role,
    map: placeholderTexture(albedo, true),
    normalMap: placeholderTexture([128, 128, 255, 255], false),
    roughnessMap: placeholderTexture([235, 235, 235, 255], false),
    aoMap,
  };
}

function rockTextures(set: RockTextureSet<RockTextureRole>): THREE.Texture[] {
  return [
    set.map,
    set.normalMap,
    set.roughnessMap,
    ...(set.aoMap ? [set.aoMap] : []),
  ];
}

function hydrateRockTextureSet<Role extends 'river' | 'quarry'>(
  target: RockTextureSet<Role>,
  source: RockTextureSet<Role>,
): void {
  hydrateTexture(target.map, source.map);
  hydrateTexture(target.normalMap, source.normalMap);
  hydrateTexture(target.roughnessMap, source.roughnessMap);
  if (target.aoMap && source.aoMap) hydrateTexture(target.aoMap, source.aoMap);
}

function placeholderTexture(
  rgba: [number, number, number, number],
  srgb: boolean,
): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${rgba[3] / 255})`;
    context.fillRect(0, 0, 1, 1);
  }
  const texture = new THREE.Texture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function hydrateTexture(target: THREE.Texture, source: THREE.Texture): void {
  // Renderer capability negotiation happens against the stable placeholder
  // identity. Texture.copy() also copies source anisotropy, so preserve the
  // negotiated target value while hydrating the decoded image and sampler.
  const anisotropy = target.anisotropy;
  target.copy(source);
  target.anisotropy = anisotropy;
  target.needsUpdate = true;
}
