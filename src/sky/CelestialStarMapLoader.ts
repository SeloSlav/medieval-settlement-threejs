import * as THREE from 'three';

/**
 * Keeps the sky shader valid while the historical catalogue stays outside the
 * first-playable bundle. The same texture object is hydrated later so neither
 * renderer backend has to rebuild its sky material.
 */
export function createCelestialStarMapPlaceholder(): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    new Uint8Array([0, 0, 0, 0]),
    1,
    1,
    THREE.RGBAFormat,
  );
  texture.name = 'Deferred celestial sky placeholder';
  configureCelestialStarMapTexture(texture);
  texture.userData.isCelestialStarMapPlaceholder = true;
  return texture;
}

/**
 * Keeps the catalogue in a separate chunk and yields around its CPU-heavy
 * texture generation. Startup awaits this work while the loading cover remains
 * visible so it can never become a post-play long task.
 */
export async function loadCelestialStarMapForStartup(): Promise<THREE.DataTexture> {
  const celestialModulePromise = import('./CelestialStarMap.ts');
  await waitForCelestialIdleTurn();
  const { createCelestialStarMap } = await celestialModulePromise;
  await waitForCelestialIdleTurn();
  return createCelestialStarMap();
}

export function hydrateCelestialStarMapTexture(
  target: THREE.DataTexture,
  source: THREE.DataTexture,
): void {
  // WebGPU allocates the placeholder's first 1x1 upload as a physical GPU
  // texture. Release that allocation before changing dimensions; otherwise a
  // later needsUpdate attempts to write the 2048x1024 catalogue into the old
  // 1x1 resource. dispose() keeps the Texture object (and shader binding)
  // intact while making both renderer backends recreate its backing resource.
  target.dispose();
  target.name = source.name;
  target.image = source.image;
  target.mapping = source.mapping;
  target.channel = source.channel;
  target.wrapS = source.wrapS;
  target.wrapT = source.wrapT;
  target.magFilter = source.magFilter;
  target.minFilter = source.minFilter;
  target.anisotropy = source.anisotropy;
  target.format = source.format;
  target.internalFormat = source.internalFormat;
  target.type = source.type;
  target.offset.copy(source.offset);
  target.repeat.copy(source.repeat);
  target.center.copy(source.center);
  target.rotation = source.rotation;
  target.matrixAutoUpdate = source.matrixAutoUpdate;
  target.generateMipmaps = source.generateMipmaps;
  target.premultiplyAlpha = source.premultiplyAlpha;
  target.flipY = source.flipY;
  target.unpackAlignment = source.unpackAlignment;
  target.colorSpace = source.colorSpace;
  target.userData = {
    ...source.userData,
    isCelestialStarMapPlaceholder: false,
  };
  target.needsUpdate = true;
}

function configureCelestialStarMapTexture(texture: THREE.DataTexture): void {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
}

function waitForCelestialIdleTurn(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: 48 });
      return;
    }
    window.setTimeout(resolve, 0);
  });
}
