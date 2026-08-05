import * as THREE from 'three';
import { loadBitmapTexture } from '../utils/textureLoad.ts';
import { supportsNodeMaterials, type RendererBackendKind } from '../scene/RendererBackend.ts';
import {
  createCelestialStarMapPlaceholder,
  hydrateCelestialStarMapTexture,
  loadCelestialStarMapForStartup,
} from './CelestialStarMapLoader.ts';
import {
  GORSKI_KOTAR_1550_TO_J2000_PRECESSION,
  GORSKI_KOTAR_LATITUDE_DEG,
} from './gorskiKotarCelestial.ts';
import type { OpenSkyFallback } from './OpenSkyFallback.ts';
import { SKY_DEPTH_OCCLUSION_RADIUS } from './skyDepthOcclusionPolicy.ts';

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
  observerLatitudeDeg?: number;
  /** Retained temporarily for fixture/startup compatibility; Eanpa generates its own noise. */
  perlinTexture?: THREE.Texture;
  radius?: number;
  rayleigh?: number;
  rendererBackend?: RendererBackendKind;
  siderealAngle?: number;
  starMap?: THREE.Texture;
  sunDirection?: THREE.Vector3;
  turbidity?: number;
  windSpeedX?: number;
  windSpeedZ?: number;
  width?: number;
  height?: number;
  widthSegments?: number;
  heightSegments?: number;
};

type EanpaUniform<T = unknown> = { value: T };

type EanpaSkySystem = {
  domes: THREE.Object3D[];
  uniforms: Record<string, EanpaUniform>;
  setConstellationVisibility(visibility: number): void;
  setMoonDirection(direction: THREE.Vector3): void;
  setSiderealAngle(angle: number): void;
  setSunDirection(direction: THREE.Vector3): void;
  update(time: number, camera?: THREE.Camera): void;
  dispose(): void;
};

const DEFAULTS = {
  cloudCoverage: 0.34,
  constellationVisibility: 0,
  maxCloudDistance: 6200,
  observerLatitudeDeg: GORSKI_KOTAR_LATITUDE_DEG,
  radius: SKY_DEPTH_OCCLUSION_RADIUS,
  siderealAngle: 0,
  sunDirection: new THREE.Vector3(0.5, 0.5, -0.5).normalize(),
};

const EANPA_MOON_TEXTURE_URL = new URL(
  '../../vendor/eanpa-sky/assets/moon_color_1k.jpg',
  import.meta.url,
).href;
const EANPA_TYCHO_TEXTURE_URL = new URL(
  '../../vendor/eanpa-sky/assets/starmap_tycho_4k.jpg',
  import.meta.url,
).href;
const MOON_DIRECTION = new THREE.Vector3();

/**
 * Compatibility texture for the old progressive-startup contract. Eanpa's
 * analytic cloud field does not consume it; keeping the stable async boundary
 * avoids coupling this rendering migration to unrelated startup fixtures.
 */
export async function loadSkyPerlinTexture(): Promise<THREE.DataTexture> {
  const texture = new THREE.DataTexture(
    new Uint8Array([128, 128, 128, 255]),
    1,
    1,
    THREE.RGBAFormat,
  );
  texture.name = 'Retired sky-noise compatibility texture';
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

/**
 * App facade for the MIT Eanpa Sky engine. The native node path supplies the
 * atmosphere and volumetric clouds; the game's generated 1550 catalogue stays
 * bound as Eanpa's celestial texture and is rotated by local sidereal time.
 */
export class SkyCloudMesh extends THREE.Group {
  readonly isSkyCloudMesh = true;
  readonly ready: Promise<SkyCloudMesh>;
  private readonly starMap: THREE.DataTexture | THREE.Texture;
  private readonly usesDeferredStarMap: boolean;
  private readonly sunDirection = DEFAULTS.sunDirection.clone();
  private readonly observerLatitudeDeg: number;
  private readonly radius: number;
  private readonly rendererBackend: RendererBackendKind;
  private readonly maxCloudDistance: number;
  private readonly cloudCoverage: number;
  private eanpa: EanpaSkySystem | null = null;
  private fallback: OpenSkyFallback | null = null;
  private moonTexture: THREE.Texture | null = null;
  private starBackdrop: THREE.Texture | null = null;
  private camera: THREE.Camera | null = null;
  private celestialLoadPromise: Promise<void> | null = null;
  private siderealAngle: number;
  private constellationVisibility: number;
  private dawnAmount: number;
  private duskAmount: number;
  private animationTime = 0;
  private disposed = false;

  constructor(options: SkyCloudOptions = {}) {
    super();
    this.name = 'Eanpa Sky volumetric atmosphere and historical sky';
    this.userData.isSkyCloudMesh = true;
    this.starMap = options.starMap ?? createCelestialStarMapPlaceholder();
    this.usesDeferredStarMap = options.starMap === undefined;
    this.rendererBackend = options.rendererBackend ?? 'webgl';
    this.radius = options.radius ?? DEFAULTS.radius;
    this.maxCloudDistance = options.maxCloudDistance ?? DEFAULTS.maxCloudDistance;
    this.cloudCoverage = options.cloudCoverage ?? DEFAULTS.cloudCoverage;
    this.observerLatitudeDeg = options.observerLatitudeDeg ?? DEFAULTS.observerLatitudeDeg;
    this.siderealAngle = options.siderealAngle ?? DEFAULTS.siderealAngle;
    this.constellationVisibility = THREE.MathUtils.clamp(
      options.constellationVisibility ?? DEFAULTS.constellationVisibility,
      0,
      1,
    );
    this.dawnAmount = options.dawnAmount ?? 0;
    this.duskAmount = options.duskAmount ?? 0;
    this.sunDirection.copy(options.sunDirection ?? DEFAULTS.sunDirection).normalize();
    this.ready = this.initialize();
  }

  loadCelestialSky(): Promise<void> {
    if (!this.usesDeferredStarMap || this.disposed) {
      return this.ready.then(() => undefined);
    }
    if (!this.celestialLoadPromise) {
      this.celestialLoadPromise = this.hydrateCelestialSky();
    }
    return Promise.all([this.ready, this.celestialLoadPromise]).then(() => undefined);
  }

  preloadCelestialTexture(
    renderer: { initTexture(texture: THREE.Texture): void },
  ): void {
    renderer.initTexture(this.starMap);
    if (this.starBackdrop) renderer.initTexture(this.starBackdrop);
    if (this.moonTexture) renderer.initTexture(this.moonTexture);
  }

  get celestialGenerationMs(): number | null {
    const duration = this.starMap.userData.generationMs;
    return typeof duration === 'number' && Number.isFinite(duration)
      ? duration
      : null;
  }

  updateSun(direction: THREE.Vector3): void {
    this.sunDirection.copy(direction).normalize();
    this.applySunDirection();
    this.fallback?.updateSun(this.sunDirection);
  }

  updateTime(time: number): void {
    this.animationTime = Number.isFinite(time) ? time : 0;
    this.fallback?.updateTime(this.animationTime);
    this.eanpa?.update(this.animationTime, this.camera ?? undefined);
  }

  updateSiderealAngle(angle: number): void {
    this.siderealAngle = Number.isFinite(angle) ? angle : 0;
    this.eanpa?.setSiderealAngle(this.siderealAngle);
    this.fallback?.updateSiderealAngle(this.siderealAngle);
  }

  updateConstellationVisibility(visibility: number): void {
    this.constellationVisibility = THREE.MathUtils.clamp(visibility, 0, 1);
    this.eanpa?.setConstellationVisibility(this.constellationVisibility);
    this.fallback?.updateConstellationVisibility(this.constellationVisibility);
  }

  updateAtmosphere(dawnAmount: number, duskAmount: number): void {
    this.dawnAmount = THREE.MathUtils.clamp(dawnAmount, 0, 1);
    this.duskAmount = THREE.MathUtils.clamp(duskAmount, 0, 1);
    // Eanpa keys its authored palette directly from the authoritative solar
    // elevation. The explicit dawn/dusk envelopes remain for legacy WebGL.
    this.fallback?.updateAtmosphere(this.dawnAmount, this.duskAmount);
  }

  updateResolution(_width: number, _height: number): void {
    // Eanpa reconstructs rays from the live camera matrices and does not need
    // a screen-resolution uniform. Kept as a stable facade method.
  }

  updateCamera(camera: THREE.Camera): void {
    this.camera = camera;
    this.fallback?.updateCamera(camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.eanpa?.dispose();
    this.eanpa = null;
    this.fallback?.dispose();
    this.fallback = null;
    this.moonTexture?.dispose();
    this.moonTexture = null;
    this.starBackdrop?.dispose();
    this.starBackdrop = null;
    this.starMap.dispose();
    this.clear();
  }

  private async initialize(): Promise<SkyCloudMesh> {
    const starBackdropPromise = loadBitmapTexture(EANPA_TYCHO_TEXTURE_URL, 4, {
        anisotropyLimit: 4,
      })
      .then((texture) => {
        texture.name = 'Eanpa Tycho 4K dense star field (J2000)';
        return texture;
      })
      .catch((error: unknown) => {
        console.warn('Eanpa Tycho texture could not be loaded; using the historical catalogue alone.', error);
        return undefined;
      });

    if (!supportsNodeMaterials(this.rendererBackend)) {
      const { OpenSkyFallback } = await import('./OpenSkyFallback.ts');
      const starBackdrop = await starBackdropPromise;
      const fallback = new OpenSkyFallback({
        cloudCoverage: this.cloudCoverage,
        constellationVisibility: this.constellationVisibility,
        epochToJ2000Precession: GORSKI_KOTAR_1550_TO_J2000_PRECESSION,
        observerLatitudeDeg: this.observerLatitudeDeg,
        radius: this.radius,
        siderealAngle: this.siderealAngle,
        starBackdrop,
        starMap: this.starMap,
        sunDirection: this.sunDirection,
      });
      if (this.disposed) {
        fallback.dispose();
        starBackdrop?.dispose();
        return this;
      }
      this.starBackdrop = starBackdrop ?? null;
      this.fallback = fallback;
      this.add(fallback);
      this.applyCachedState();
      return this;
    }

    const enginePromise = import('../../vendor/eanpa-sky/engine/sky_system.js');
    const moonTexturePromise = loadBitmapTexture(EANPA_MOON_TEXTURE_URL, 1, {
        srgb: true,
        anisotropyLimit: 1,
      })
      .then((texture) => {
        texture.name = 'Eanpa / NASA LROC moon color map';
        return texture;
      })
      .catch((error: unknown) => {
        console.warn('Eanpa moon texture could not be loaded; continuing without the moon disc.', error);
        return undefined;
      });
    const [{ makeSkySystem }, moonTexture, starBackdrop] = await Promise.all([
      enginePromise,
      moonTexturePromise,
      starBackdropPromise,
    ]);
    if (this.disposed) {
      moonTexture?.dispose();
      starBackdrop?.dispose();
      return this;
    }

    const system = await makeSkySystem({
      scene: this,
      textures: {
        stars: this.starMap,
        starBackdrop,
        moon: moonTexture,
      },
      opts: {
        cloudFadeDist: this.maxCloudDistance,
        cloudPasses: 1,
        clouds: 'cumulus',
        constellationVisibility: this.constellationVisibility,
        domeRadius: this.radius,
        lightSamples: 8,
        observerLatitudeDeg: this.observerLatitudeDeg,
        outputDither: 0,
        siderealAngle: this.siderealAngle,
        skySamples: 28,
        starBackdropTransform: GORSKI_KOTAR_1550_TO_J2000_PRECESSION,
        stableCloudPhase: true,
        worldRayDir: true,
      },
    }) as EanpaSkySystem;
    if (this.disposed) {
      system.dispose();
      moonTexture?.dispose();
      starBackdrop?.dispose();
      return this;
    }

    this.moonTexture = moonTexture ?? null;
    this.starBackdrop = starBackdrop ?? null;
    this.eanpa = system;
    for (const [index, dome] of system.domes.entries()) {
      dome.name = index === 0
        ? 'Eanpa atmospheric and historical celestial dome'
        : 'Eanpa volumetric cloud dome';
      dome.userData.isSkyCloudMesh = true;
    }
    this.applyCachedState();
    return this;
  }

  private applyCachedState(): void {
    this.applySunDirection();
    this.eanpa?.setSiderealAngle(this.siderealAngle);
    this.eanpa?.setConstellationVisibility(this.constellationVisibility);
    this.fallback?.updateSun(this.sunDirection);
    this.fallback?.updateSiderealAngle(this.siderealAngle);
    this.fallback?.updateConstellationVisibility(this.constellationVisibility);
    this.fallback?.updateAtmosphere(this.dawnAmount, this.duskAmount);
    if (this.camera) this.fallback?.updateCamera(this.camera);
    this.updateTime(this.animationTime);
  }

  private applySunDirection(): void {
    if (!this.eanpa) return;
    MOON_DIRECTION.copy(this.sunDirection).negate();
    // Eanpa chooses its night cloud key from the moon direction while setting
    // the solar palette, so update the moon first.
    this.eanpa.setMoonDirection(MOON_DIRECTION);
    this.eanpa.setSunDirection(this.sunDirection);
  }

  private async hydrateCelestialSky(): Promise<void> {
    const loadedStarMap = await loadCelestialStarMapForStartup();
    if (this.disposed) {
      loadedStarMap.dispose();
      return;
    }
    hydrateCelestialStarMapTexture(this.starMap as THREE.DataTexture, loadedStarMap);
    // The placeholder now owns the generated pixel buffer. The temporary
    // texture was never uploaded, so disposing its shell is safe.
    loadedStarMap.dispose();
  }
}
