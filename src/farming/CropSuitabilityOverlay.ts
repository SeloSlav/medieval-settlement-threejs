import * as THREE from 'three';
import { sampleAuthoritativeHydrologyScore } from '../hydrology/sampleAuthoritativeHydrology.ts';
import type { Terrain, TerrainBounds } from '../terrain/Terrain.ts';
import type { FarmCrop } from '../resources/types.ts';
import { cropSiteSuitability } from './farmFieldMath.ts';
import { vineyardSiteSuitability } from '../vineyards/vineyardSuitability.ts';

export const CROP_SUITABILITY_OVERLAY_RESOLUTION = 192;
const OVERLAY_MESH_SEGMENTS = 96;
const OVERLAY_HEIGHT_OFFSET = 0.38;

export type CropSuitabilityRasterOptions = {
  crop: FarmCrop;
  resolution: number;
  bounds: TerrainBounds;
  sampleMoisture: (x: number, z: number) => number;
  sampleSlopeDegrees: (x: number, z: number) => number;
};

export type VineyardSuitabilityRasterOptions = Omit<CropSuitabilityRasterOptions, 'crop'> & {
  sampleSouthExposure: (x: number, z: number) => number;
};

export type CropSuitabilityOverlayOptions = {
  terrain: Terrain;
  parent: THREE.Object3D;
};

/**
 * One lazy terrain-draped mesh. Crop changes swap a cached 192² data texture,
 * so field-layout feedback adds no simulation work or per-frame sampling.
 */
export class CropSuitabilityOverlay {
  private readonly terrain: Terrain;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly textures = new Map<FarmCrop | 'grapes', THREE.DataTexture>();
  private crop: FarmCrop | 'grapes' | null = null;
  private visible = false;

  constructor(options: CropSuitabilityOverlayOptions) {
    this.terrain = options.terrain;
    this.material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(createDrapedOverlayGeometry(this.terrain), this.material);
    this.mesh.name = 'Crop suitability overlay';
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    this.mesh.frustumCulled = true;
    options.parent.add(this.mesh);
  }

  setCrop(crop: FarmCrop): void {
    if (crop === this.crop) return;
    this.crop = crop;
    let texture = this.textures.get(crop);
    if (!texture) {
      texture = createCropSuitabilityTexture(this.terrain, crop);
      this.textures.set(crop, texture);
    }
    this.material.map = texture;
    this.material.needsUpdate = true;
  }

  setVineyard(): void {
    if (this.crop === 'grapes') return;
    this.crop = 'grapes';
    let texture = this.textures.get('grapes');
    if (!texture) {
      texture = createVineyardSuitabilityTexture(this.terrain);
      this.textures.set('grapes', texture);
    }
    this.material.map = texture;
    this.material.needsUpdate = true;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.mesh.visible = visible;
  }

  isVisible(): boolean {
    return this.visible;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}

export function rasterizeCropSuitability(
  options: CropSuitabilityRasterOptions,
): Uint8Array {
  const resolution = Math.max(2, Math.floor(options.resolution));
  const data = new Uint8Array(resolution * resolution * 4);
  const columnDenominator = resolution - 1;
  const rowDenominator = resolution - 1;

  for (let row = 0; row < resolution; row++) {
    const z = options.bounds.minZ
      + (row / rowDenominator) * (options.bounds.maxZ - options.bounds.minZ);
    const dataRow = resolution - 1 - row;
    for (let column = 0; column < resolution; column++) {
      const x = options.bounds.minX
        + (column / columnDenominator) * (options.bounds.maxX - options.bounds.minX);
      const score = cropSiteSuitability(
        options.crop,
        options.sampleMoisture(x, z),
        options.sampleSlopeDegrees(x, z),
        x,
        z,
      );
      const color = cropSuitabilityColor(score);
      const index = (dataRow * resolution + column) * 4;
      data[index] = color.r;
      data[index + 1] = color.g;
      data[index + 2] = color.b;
      data[index + 3] = color.a;
    }
  }
  return data;
}

export function cropSuitabilityColor(
  score: number,
): { r: number; g: number; b: number; a: number } {
  const poor = { r: 117, g: 48, b: 38 };
  const marginal = { r: 190, g: 112, b: 42 };
  const good = { r: 156, g: 158, b: 56 };
  const prime = { r: 48, g: 142, b: 76 };
  const clamped = Math.max(0, Math.min(1, score));
  const rgb = clamped < 0.4
    ? lerpColor(poor, marginal, clamped / 0.4)
    : clamped < 0.7
      ? lerpColor(marginal, good, (clamped - 0.4) / 0.3)
      : lerpColor(good, prime, (clamped - 0.7) / 0.3);
  return { ...rgb, a: Math.round(178 + clamped * 55) };
}

export function rasterizeVineyardSuitability(
  options: VineyardSuitabilityRasterOptions,
): Uint8Array {
  const resolution = Math.max(2, Math.floor(options.resolution));
  const data = new Uint8Array(resolution * resolution * 4);
  const denominator = resolution - 1;
  for (let row = 0; row < resolution; row += 1) {
    const z = options.bounds.minZ
      + (row / denominator) * (options.bounds.maxZ - options.bounds.minZ);
    const dataRow = resolution - 1 - row;
    for (let column = 0; column < resolution; column += 1) {
      const x = options.bounds.minX
        + (column / denominator) * (options.bounds.maxX - options.bounds.minX);
      const score = vineyardSiteSuitability(
        options.sampleMoisture(x, z),
        options.sampleSlopeDegrees(x, z),
        options.sampleSouthExposure(x, z),
        x,
        z,
      );
      const color = cropSuitabilityColor(score);
      const index = (dataRow * resolution + column) * 4;
      data[index] = color.r;
      data[index + 1] = color.g;
      data[index + 2] = color.b;
      data[index + 3] = color.a;
    }
  }
  return data;
}

function createCropSuitabilityTexture(
  terrain: Terrain,
  crop: FarmCrop,
): THREE.DataTexture {
  const data = rasterizeCropSuitability({
    crop,
    resolution: CROP_SUITABILITY_OVERLAY_RESOLUTION,
    bounds: terrain.bounds,
    sampleMoisture: sampleAuthoritativeHydrologyScore,
    sampleSlopeDegrees: (x, z) => sampleTerrainSlopeDegrees(terrain, x, z),
  });
  const texture = new THREE.DataTexture(
    data,
    CROP_SUITABILITY_OVERLAY_RESOLUTION,
    CROP_SUITABILITY_OVERLAY_RESOLUTION,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = `${crop} field suitability`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

function createVineyardSuitabilityTexture(terrain: Terrain): THREE.DataTexture {
  const data = rasterizeVineyardSuitability({
    resolution: CROP_SUITABILITY_OVERLAY_RESOLUTION,
    bounds: terrain.bounds,
    sampleMoisture: sampleAuthoritativeHydrologyScore,
    sampleSlopeDegrees: (x, z) => sampleTerrainSlopeDegrees(terrain, x, z),
    sampleSouthExposure: (x, z) => sampleTerrainSouthExposure(terrain, x, z),
  });
  const texture = new THREE.DataTexture(
    data,
    CROP_SUITABILITY_OVERLAY_RESOLUTION,
    CROP_SUITABILITY_OVERLAY_RESOLUTION,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = 'grape vineyard suitability';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

function createDrapedOverlayGeometry(terrain: Terrain): THREE.BufferGeometry {
  const width = terrain.bounds.maxX - terrain.bounds.minX;
  const depth = terrain.bounds.maxZ - terrain.bounds.minZ;
  const centerX = (terrain.bounds.minX + terrain.bounds.maxX) * 0.5;
  const centerZ = (terrain.bounds.minZ + terrain.bounds.maxZ) * 0.5;
  const geometry = new THREE.PlaneGeometry(
    width,
    depth,
    OVERLAY_MESH_SEGMENTS,
    OVERLAY_MESH_SEGMENTS,
  );
  geometry.rotateX(-Math.PI * 0.5);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let index = 0; index < position.count; index++) {
    const worldX = position.getX(index) + centerX;
    const worldZ = position.getZ(index) + centerZ;
    position.setY(
      index,
      terrain.getHeightAt(worldX, worldZ) + OVERLAY_HEIGHT_OFFSET,
    );
  }
  position.needsUpdate = true;
  geometry.translate(centerX, 0, centerZ);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function sampleTerrainSlopeDegrees(terrain: Terrain, x: number, z: number): number {
  const radius = 1;
  const hx = (
    terrain.getHeightAt(x + radius, z)
    - terrain.getHeightAt(x - radius, z)
  ) / (radius * 2);
  const hz = (
    terrain.getHeightAt(x, z + radius)
    - terrain.getHeightAt(x, z - radius)
  ) / (radius * 2);
  return Math.atan(Math.hypot(hx, hz)) * 180 / Math.PI;
}

function sampleTerrainSouthExposure(terrain: Terrain, x: number, z: number): number {
  const radius = 1;
  const hx = terrain.getHeightAt(x + radius, z) - terrain.getHeightAt(x - radius, z);
  const hz = terrain.getHeightAt(x, z + radius) - terrain.getHeightAt(x, z - radius);
  const gradient = Math.hypot(hx, hz);
  if (gradient <= 1e-6) return 0.5;
  const facingSouth = 0.5 + (-hz / gradient) * 0.5;
  const slopeWeight = Math.min(1, gradient * 0.75);
  return 0.5 * (1 - slopeWeight) + facingSouth * slopeWeight;
}

function lerpColor(
  from: { r: number; g: number; b: number },
  to: { r: number; g: number; b: number },
  t: number,
): { r: number; g: number; b: number } {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    r: Math.round(from.r + (to.r - from.r) * clamped),
    g: Math.round(from.g + (to.g - from.g) * clamped),
    b: Math.round(from.b + (to.b - from.b) * clamped),
  };
}
