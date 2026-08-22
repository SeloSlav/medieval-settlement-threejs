import * as THREE from 'three';
import { createTerrainGrassMaterial, createTerrainGrassMaterialWithRiverShore } from '../terrain/TerrainGrassMaterial.ts';
import type { EnvironmentState } from '../world/seasonPolicy.ts';
import { roadWeatherProfile } from '../weather/precipitationPolicy.ts';
import {
  createRoadCoreMaterial,
  createRoadEdgeMaterial,
  createRoadWeatherUniforms,
  createRiverBankMaterial,
} from './RoadSurfaceMaterial.ts';
import { RoadTextureLoader, type TerrainBlendTextureSet, type TextureSet } from './RoadTextureLoader.ts';
import type { MeshStandardNodeMaterial } from 'three/webgpu';

export class RoadMaterialFactory {
  readonly road!: MeshStandardNodeMaterial;
  readonly roadEdge!: MeshStandardNodeMaterial;
  readonly riverBank!: MeshStandardNodeMaterial;
  readonly terrain!: MeshStandardNodeMaterial;
  readonly rainTerrain!: THREE.MeshStandardMaterial;
  readonly bridgeSupport!: THREE.MeshStandardMaterial;
  readonly previewValid: THREE.MeshBasicMaterial;
  readonly previewInvalid: THREE.MeshBasicMaterial;
  readonly previewBlendValid: THREE.MeshBasicMaterial;
  readonly previewBlendInvalid: THREE.MeshBasicMaterial;
  readonly previewBridge: THREE.MeshBasicMaterial;
  readonly selection: THREE.MeshBasicMaterial;
  readonly snap: THREE.MeshBasicMaterial;
  private roadTextures: TextureSet | null = null;
  private bridgeTextures: TextureSet | null = null;
  private terrainBlendTextures: TerrainBlendTextureSet | null = null;
  private rainTerrainTexture: THREE.DataTexture | null = null;
  private texturesReadyPromise: Promise<void> = Promise.resolve();
  private readonly roadWeatherUniforms = createRoadWeatherUniforms();
  private targetRoadWetness = 0;
  private targetRoadFrost = 0;

  private constructor() {
    this.previewValid = new THREE.MeshBasicMaterial({
      color: 0xc8c5be,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    });
    this.previewInvalid = new THREE.MeshBasicMaterial({
      color: 0xcc4444,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    });
    this.previewBlendValid = new THREE.MeshBasicMaterial({
      color: 0xc8c5be,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    this.previewBlendInvalid = new THREE.MeshBasicMaterial({
      color: 0xcc4444,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });
    this.previewBridge = new THREE.MeshBasicMaterial({
      color: 0xb8946e,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
    });
    this.selection = new THREE.MeshBasicMaterial({
      color: 0xc8c2b8,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    this.snap = new THREE.MeshBasicMaterial({
      color: 0xb8b0a4,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
  }

  static async create(maxAnisotropy: number): Promise<RoadMaterialFactory> {
    const factory = RoadMaterialFactory.createProgressive(maxAnisotropy);
    await factory.whenTexturesReady();
    return factory;
  }

  static createProgressive(maxAnisotropy: number): RoadMaterialFactory {
    const factory = new RoadMaterialFactory();
    factory.roadTextures = createPlaceholderTextureSet(THREE.RepeatWrapping, true);
    factory.bridgeTextures = createPlaceholderTextureSet(THREE.RepeatWrapping, false);
    factory.terrainBlendTextures = {
      meadow: createPlaceholderTextureSet(THREE.MirroredRepeatWrapping, false),
      dense: createPlaceholderTextureSet(THREE.MirroredRepeatWrapping, false),
      dry: createPlaceholderTextureSet(THREE.MirroredRepeatWrapping, false),
    };
    Object.assign(factory, factory.createMaterials());

    const textureLoader = new RoadTextureLoader(Math.min(maxAnisotropy, 8));
    factory.texturesReadyPromise = Promise.all([
      textureLoader.loadRoadTextures(),
      textureLoader.loadBridgeTextures(),
      textureLoader.loadTerrainBlendTextures(),
    ]).then(([roadTextures, bridgeTextures, terrainBlendTextures]) => {
      hydrateTextureSet(factory.roadTextures!, roadTextures);
      hydrateTextureSet(factory.bridgeTextures!, bridgeTextures);
      hydrateTextureSet(factory.terrainBlendTextures!.meadow, terrainBlendTextures.meadow);
      hydrateTextureSet(factory.terrainBlendTextures!.dense, terrainBlendTextures.dense);
      hydrateTextureSet(factory.terrainBlendTextures!.dry, terrainBlendTextures.dry);
    });
    return factory;
  }

  whenTexturesReady(): Promise<void> {
    return this.texturesReadyPromise;
  }

  setEnvironment(environment: EnvironmentState): void {
    const profile = roadWeatherProfile(environment);
    this.targetRoadWetness = profile.wetness;
    this.targetRoadFrost = profile.frost;
  }

  updateWeather(dt: number): void {
    const blend = 1 - Math.exp(-Math.max(0, dt) * 2.8);
    this.roadWeatherUniforms.wetness.value += (
      this.targetRoadWetness - this.roadWeatherUniforms.wetness.value
    ) * blend;
    this.roadWeatherUniforms.frost.value += (
      this.targetRoadFrost - this.roadWeatherUniforms.frost.value
    ) * blend;
  }

  dispose(): void {
    const materials = [
      this.road,
      this.roadEdge,
      this.riverBank,
      this.terrain,
      this.rainTerrain,
      this.bridgeSupport,
      this.previewValid,
      this.previewInvalid,
      this.previewBlendValid,
      this.previewBlendInvalid,
      this.previewBridge,
      this.selection,
      this.snap,
    ];
    materials.forEach((material) => material.dispose());
    this.rainTerrainTexture?.dispose();
    this.rainTerrainTexture = null;
    if (this.roadTextures) this.disposeTextureSet(this.roadTextures);
    if (this.bridgeTextures) this.disposeTextureSet(this.bridgeTextures);
    if (this.terrainBlendTextures) {
      this.disposeTextureSet(this.terrainBlendTextures.meadow);
      this.disposeTextureSet(this.terrainBlendTextures.dense);
      this.disposeTextureSet(this.terrainBlendTextures.dry);
    }
  }

  createTerrainMaterialWithRiverShore(terrainSize = 1080): MeshStandardNodeMaterial {
    if (!this.roadTextures || !this.terrainBlendTextures) {
      throw new Error('Textures are not loaded.');
    }
    return createTerrainGrassMaterialWithRiverShore(
      this.terrainBlendTextures,
      this.roadTextures,
      this.roadWeatherUniforms,
      terrainSize,
    );
  }

  private createMaterials(): {
    road: MeshStandardNodeMaterial;
    roadEdge: MeshStandardNodeMaterial;
    riverBank: MeshStandardNodeMaterial;
    terrain: MeshStandardNodeMaterial;
    rainTerrain: THREE.MeshStandardMaterial;
    bridgeSupport: THREE.MeshStandardMaterial;
  } {
    if (
      !this.roadTextures
      || !this.bridgeTextures
      || !this.terrainBlendTextures
    ) {
      throw new Error('Textures are not loaded.');
    }
    const road = createRoadCoreMaterial(
      this.roadTextures,
      this.roadWeatherUniforms,
      this.bridgeTextures,
    );
    const roadEdge = createRoadEdgeMaterial(this.roadTextures, this.roadWeatherUniforms, true);
    const riverBank = createRiverBankMaterial(this.roadTextures);
    const terrain = createTerrainGrassMaterial(
      this.terrainBlendTextures,
      this.roadWeatherUniforms,
    );
    // The WebGPU node-material path can expose sub-pixel triangle seams on the
    // 769² heightfield under fully overcast rain. A conventional PBR material
    // avoids that backend artifact. Its low-contrast procedural albedo retains
    // broad wet-ground variation without repeating the close grass weave over
    // the entire overview. SceneManager activates it only for rain.
    const rainTerrainTexture = createRainTerrainAlbedoTexture();
    this.rainTerrainTexture = rainTerrainTexture;
    const rainTerrain = new THREE.MeshStandardMaterial({
      name: 'Overcast rain terrain',
      map: rainTerrainTexture,
      color: 0xcbd7cb,
      roughness: 0.9,
      metalness: 0,
      vertexColors: true,
    });
    const bridgeSupport = new THREE.MeshStandardMaterial({
      map: this.bridgeTextures.albedo,
      color: 0xa07850,
      roughness: 0.94,
      metalness: 0,
    });
    if (this.bridgeTextures.normal) {
      bridgeSupport.normalMap = this.bridgeTextures.normal;
      bridgeSupport.normalScale.set(0.45, 0.45);
    }
    return { road, roadEdge, riverBank, terrain, rainTerrain, bridgeSupport };
  }

  private disposeTextureSet(set: TextureSet): void {
    Object.values(set).forEach((texture) => texture?.dispose());
  }
}

function createPlaceholderTextureSet(
  wrapping: THREE.Wrapping,
  includeRoadMasks: boolean,
): TextureSet {
  const set: TextureSet = {
    albedo: createPlaceholderTexture([104, 122, 76, 255], true, wrapping),
    normal: createPlaceholderTexture([128, 128, 255, 255], false, wrapping),
    roughness: createPlaceholderTexture([230, 230, 230, 255], false, wrapping),
    ao: createPlaceholderTexture([255, 255, 255, 255], false, wrapping),
    height: createPlaceholderTexture([128, 128, 128, 255], false, wrapping),
  };
  if (includeRoadMasks) {
    set.edgeMask = createPlaceholderTexture([255, 255, 255, 255], false, wrapping);
    set.rutMask = createPlaceholderTexture([0, 0, 0, 255], false, wrapping);
  } else {
    set.edgeMask = createPlaceholderTexture([255, 255, 255, 255], false, wrapping);
  }
  return set;
}

function createPlaceholderTexture(
  rgba: [number, number, number, number],
  srgb: boolean,
  wrapping: THREE.Wrapping,
): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${rgba[3] / 255})`;
    context.fillRect(0, 0, 1, 1);
  }
  // Keep this generic so WebGPU does not retain DataTexture upload semantics
  // after the placeholder is hydrated with an ImageBitmap.
  const texture = new THREE.Texture(canvas);
  texture.wrapS = wrapping;
  texture.wrapT = wrapping;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function hydrateTextureSet(target: TextureSet, source: TextureSet): void {
  for (const key of Object.keys(source) as Array<keyof TextureSet>) {
    const targetTexture = target[key];
    const sourceTexture = source[key];
    if (!targetTexture || !sourceTexture) continue;
    targetTexture.copy(sourceTexture);
    targetTexture.needsUpdate = true;
  }
}

function createRainTerrainAlbedoTexture(): THREE.DataTexture {
  const size = 256;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const broad = tileableValueNoise(u, v, 3, 41) * 0.58;
      const middle = tileableValueNoise(u, v, 7, 83) * 0.24;
      const fine = tileableValueNoise(u, v, 15, 137) * 0.1;
      const micro = tileableValueNoise(u, v, 64, 173) * 0.08;
      const warmth = tileableValueNoise(u, v, 5, 211);
      const tone = (broad + middle + fine + micro - 0.5) * 2;
      const offset = (y * size + x) * 4;
      pixels[offset] = THREE.MathUtils.clamp(118 + tone * 44 + warmth * 6, 0, 255);
      pixels[offset + 1] = THREE.MathUtils.clamp(136 + tone * 48, 0, 255);
      pixels[offset + 2] = THREE.MathUtils.clamp(105 + tone * 38 - warmth * 5, 0, 255);
      pixels[offset + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(
    pixels,
    size,
    size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = 'Procedural overcast meadow albedo';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // Terrain UVs are world-scaled for close grass detail. Expanding this
  // weather texture keeps its dominant forms at landscape scale; the high
  // octave retains restrained near-camera breakup.
  texture.repeat.set(0.14, 0.14);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function tileableValueNoise(
  u: number,
  v: number,
  cells: number,
  seed: number,
): number {
  const px = u * cells;
  const py = v * cells;
  const x0 = Math.floor(px) % cells;
  const y0 = Math.floor(py) % cells;
  const x1 = (x0 + 1) % cells;
  const y1 = (y0 + 1) % cells;
  const tx = smoothNoiseStep(px - Math.floor(px));
  const ty = smoothNoiseStep(py - Math.floor(py));
  const a = rainNoiseHash(x0, y0, seed);
  const b = rainNoiseHash(x1, y0, seed);
  const c = rainNoiseHash(x0, y1, seed);
  const d = rainNoiseHash(x1, y1, seed);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, tx),
    THREE.MathUtils.lerp(c, d, tx),
    ty,
  );
}

function smoothNoiseStep(value: number): number {
  return value * value * (3 - 2 * value);
}

function rainNoiseHash(x: number, y: number, seed: number): number {
  let hash = Math.imul(x + seed, 0x45d9f3b) ^ Math.imul(y + seed * 3, 0x27d4eb2d);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  return (hash >>> 0) / 0xffffffff;
}
