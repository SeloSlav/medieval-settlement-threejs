import * as THREE from 'three';
import { loadBitmapTexture } from '../utils/textureLoad.ts';
import { SkyCloudMesh as WebGPUSkyCloudMesh } from 'sky-cloud-3d';
import { SkyCloudMesh as WebGLSkyCloudMesh } from 'sky-cloud-3d/webgl';
import { supportsNodeMaterials, type RendererBackendKind } from '../scene/RendererBackend.ts';
import {
  createCelestialStarMapPlaceholder,
  hydrateCelestialStarMapTexture,
  loadCelestialStarMapDeferred,
} from './CelestialStarMapLoader.ts';

type SkyCloudOptions = {
  cloudAbsorption?: number;
  cloudCoverage?: number;
  cloudHeight?: number;
  cloudThickness?: number;
  constellationVisibility?: number;
  dawnAmount?: number;
  duskAmount?: number;
  hazeStrength?: number;
  maxCloudDistance?: number;
  mieCoefficient?: number;
  mieDirectionalG?: number;
  perlinTexture?: THREE.Texture;
  radius?: number;
  rayleigh?: number;
  rendererBackend?: RendererBackendKind;
  sunDirection?: THREE.Vector3;
  starMap?: THREE.Texture;
  siderealAngle?: number;
  turbidity?: number;
  windSpeedX?: number;
  windSpeedZ?: number;
  width?: number;
  height?: number;
  widthSegments?: number;
  heightSegments?: number;
};

type SkyCloudNativeMesh = THREE.Mesh & {
  isSkyCloudMesh?: boolean;
  ready?: Promise<unknown>;
  dispose?: () => void;
  updateCamera?: (camera: THREE.Camera) => void;
  updateAtmosphere?: (dawnAmount: number, duskAmount: number) => void;
  updateConstellationVisibility?: (visibility: number) => void;
  updateResolution?: (width: number, height: number) => void;
  updateSiderealAngle?: (angle: number) => void;
  updateSun?: (direction: THREE.Vector3) => void;
  updateTime?: (time: number) => void;
};

const DEFAULTS = {
  cloudAbsorption: 0.38,
  cloudCoverage: 0.3,
  cloudHeight: 185,
  cloudThickness: 58,
  hazeStrength: 0.08,
  maxCloudDistance: 6200,
  mieCoefficient: 0.0028,
  mieDirectionalG: 0.52,
  radius: 1900,
  rayleigh: 0.62,
  turbidity: 1.2,
  windSpeedX: 0.12,
  windSpeedZ: 0.07,
  width: 1280,
  height: 720,
  widthSegments: 56,
  heightSegments: 28,
};

const WEBGL_PERLIN_TEXTURE_URL = new URL('../../vendor/sky-cloud-3d/perlin256.png', import.meta.url).href;

export function configureSkyPerlinTexture(texture: THREE.Texture): THREE.Texture {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export async function loadSkyPerlinTexture(): Promise<THREE.Texture> {
  const texture = await loadBitmapTexture(WEBGL_PERLIN_TEXTURE_URL, 1, {
    generateMipmaps: false,
    flipY: false,
  });
  return configureSkyPerlinTexture(texture);
}

/**
 * Thin app wrapper around the actual sky-cloud-3d volumetric package.
 * WebGPU uses the package's TSL/NodeMaterial path; WebGL uses its shader fallback.
 */
export class SkyCloudMesh extends THREE.Group {
  readonly isSkyCloudMesh = true;
  readonly ready: Promise<SkyCloudMesh>;
  private readonly nativeSky: SkyCloudNativeMesh;
  private readonly starMap: THREE.DataTexture | THREE.Texture;
  private readonly usesDeferredStarMap: boolean;
  private celestialLoadPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(options: SkyCloudOptions = {}) {
    super();
    const usesDeferredStarMap = options.starMap === undefined;
    const starMap = options.starMap ?? createCelestialStarMapPlaceholder();
    const config = { ...DEFAULTS, ...options, starMap };
    const rendererBackend = config.rendererBackend ?? 'webgl';
    const useNodeMaterials = supportsNodeMaterials(rendererBackend);
    const NativeSky = useNodeMaterials ? WebGPUSkyCloudMesh : WebGLSkyCloudMesh;
    // sky-cloud-3d otherwise generates a 96³ multi-octave volume texture
    // synchronously, even while its supplied 2D Perlin path is active.
    const inactiveVolumeNoise = useNodeMaterials && config.perlinTexture
      ? createInactiveVolumeNoiseTexture()
      : undefined;
    const nativeOptions = {
      ...config,
      perlinTexture: config.perlinTexture,
      perlinTextureUrl: config.perlinTexture ? undefined : WEBGL_PERLIN_TEXTURE_URL,
      volumeNoiseTexture: inactiveVolumeNoise,
    };
    const nativeSky = new NativeSky(nativeOptions) as SkyCloudNativeMesh;
    nativeSky.name = useNodeMaterials
      ? 'sky-cloud-3d node volumetric sky'
      : 'sky-cloud-3d WebGL volumetric sky';
    nativeSky.renderOrder = -1000;
    nativeSky.frustumCulled = false;
    nativeSky.userData.isSkyCloudMesh = true;

    this.name = nativeSky.name;
    this.nativeSky = nativeSky;
    this.starMap = starMap;
    this.usesDeferredStarMap = usesDeferredStarMap;
    this.add(nativeSky);
    this.ready = Promise.resolve(nativeSky.ready).then(() => this);

    if (options.sunDirection) this.updateSun(options.sunDirection);
  }

  loadCelestialSky(): Promise<void> {
    if (!this.usesDeferredStarMap || this.disposed) return Promise.resolve();
    if (!this.celestialLoadPromise) {
      this.celestialLoadPromise = this.hydrateCelestialSky();
    }
    return this.celestialLoadPromise;
  }

  updateSun(direction: THREE.Vector3): void {
    this.nativeSky.updateSun?.(direction);
  }

  updateTime(time: number): void {
    this.nativeSky.updateTime?.(time);
  }

  updateSiderealAngle(angle: number): void {
    this.nativeSky.updateSiderealAngle?.(angle);
  }

  updateConstellationVisibility(visibility: number): void {
    this.nativeSky.updateConstellationVisibility?.(THREE.MathUtils.clamp(visibility, 0, 1));
  }

  updateAtmosphere(dawnAmount: number, duskAmount: number): void {
    this.nativeSky.updateAtmosphere?.(dawnAmount, duskAmount);
  }

  updateResolution(width: number, height: number): void {
    this.nativeSky.updateResolution?.(width, height);
  }

  updateCamera(camera: THREE.Camera): void {
    if (this.nativeSky.updateCamera) {
      this.nativeSky.updateCamera(camera);
      return;
    }

    this.nativeSky.position.copy(camera.position);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.nativeSky.removeFromParent();
    disposeSky(this.nativeSky);
    this.starMap.dispose();
  }

  private async hydrateCelestialSky(): Promise<void> {
    const loadedStarMap = await loadCelestialStarMapDeferred();
    if (this.disposed) {
      loadedStarMap.dispose();
      return;
    }

    hydrateCelestialStarMapTexture(
      this.starMap as THREE.DataTexture,
      loadedStarMap,
    );
    // The placeholder now owns the generated pixel buffer. The temporary
    // texture was never uploaded, so disposing its shell is safe.
    loadedStarMap.dispose();
  }
}

function createInactiveVolumeNoiseTexture(): THREE.Data3DTexture {
  const texture = new THREE.Data3DTexture(new Uint8Array([128]), 1, 1, 1);
  texture.name = 'Inactive sky volume noise';
  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.wrapR = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.colorSpace = THREE.NoColorSpace;
  texture.userData.isSkyCloudManagedNoiseTexture = true;
  texture.needsUpdate = true;
  return texture;
}

function disposeSky(sky: SkyCloudNativeMesh): void {
  if (typeof sky.dispose === 'function') {
    sky.dispose();
    return;
  }

  sky.geometry?.dispose();
  const materials = Array.isArray(sky.material) ? sky.material : [sky.material];
  for (const material of materials) {
    material?.dispose();
  }
}
