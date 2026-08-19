import * as THREE from 'three';
import type { RiverField } from '../rivers/RiverField.ts';
import type { QuarryLayout } from '../quarries/QuarryLayout.ts';
import { sampleTerrainMeshHeight } from './TerrainMeshHeight.ts';
import type { WorldDimensions } from '../world/worldGenerationSettings.ts';
import { resolveWorldDimensions } from '../world/worldGenerationSettings.ts';
import { DEFAULT_WORLD_GENERATION_SETTINGS } from '../world/worldGenerationSettings.ts';
import { yieldToMain } from '../utils/yieldToMain.ts';
import { fullTerrainBounds } from './terrainBounds.ts';
import {
  buildTerrainGeometryData,
  createTerrainGeometry,
  TERRAIN_RESOLUTION,
  type TerrainGeometryData,
} from './terrainGeometryData.ts';

export type TerrainBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export class Terrain {
  readonly size: number;
  readonly playableSize: number;
  readonly generationSize: number;
  readonly resolution = TERRAIN_RESOLUTION;
  readonly bounds: TerrainBounds;
  readonly mesh: THREE.Mesh;
  private dirtZoomGateAttr!: THREE.BufferAttribute;
  private readonly fairColorAttr: THREE.BufferAttribute;
  private readonly rainColorAttr: THREE.BufferAttribute;

  static fullBounds(size = resolveWorldDimensions(DEFAULT_WORLD_GENERATION_SETTINGS.mapSize).terrainSize): TerrainBounds {
    return fullTerrainBounds(size);
  }

  static async create(
    material: THREE.Material,
    riverField?: RiverField,
    quarryLayout?: QuarryLayout,
    onProgress?: (completedRows: number, totalRows: number) => void,
    dimensions: WorldDimensions = resolveWorldDimensions(DEFAULT_WORLD_GENERATION_SETTINGS.mapSize),
  ): Promise<Terrain> {
    const data = await buildTerrainGeometryData(riverField, quarryLayout, dimensions, onProgress, yieldToMain);
    return Terrain.fromGeometryData(material, data, dimensions);
  }

  static fromGeometryData(
    material: THREE.Material,
    data: TerrainGeometryData,
    dimensions: WorldDimensions,
  ): Terrain {
    return new Terrain(material, createTerrainGeometry(data), dimensions);
  }

  private constructor(material: THREE.Material, geometry: THREE.BufferGeometry, dimensions: WorldDimensions) {
    this.size = dimensions.terrainSize;
    this.playableSize = dimensions.playableSize;
    this.generationSize = dimensions.generationSize;
    const half = this.playableSize * 0.5;
    this.bounds = { minX: -half, maxX: half, minZ: -half, maxZ: half };
    this.dirtZoomGateAttr = geometry.getAttribute('dirtZoomGate') as THREE.BufferAttribute;
    this.fairColorAttr = geometry.getAttribute('color') as THREE.BufferAttribute;
    this.rainColorAttr = createRainColorAttribute(geometry, this.fairColorAttr);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'Continuous terrain heightfield';
    this.mesh.receiveShadow = true;
    this.mesh.userData.terrain = true;
  }

  getHeightAt(x: number, z: number): number {
    return sampleTerrainMeshHeight(this.mesh.geometry, x, z, this.resolution, this.size);
  }

  getPointAt(x: number, z: number, offset = 0): THREE.Vector3 {
    return new THREE.Vector3(x, this.getHeightAt(x, z) + offset, z);
  }

  getPointAtInto(x: number, z: number, target: THREE.Vector3, offset = 0): THREE.Vector3 {
    return target.set(x, this.getHeightAt(x, z) + offset, z);
  }

  clampXZ(x: number, z: number): { x: number; z: number } {
    return {
      x: THREE.MathUtils.clamp(x, this.bounds.minX, this.bounds.maxX),
      z: THREE.MathUtils.clamp(z, this.bounds.minZ, this.bounds.maxZ),
    };
  }

  setDirtZoomGate(value: number): void {
    const array = this.dirtZoomGateAttr.array as Float32Array;
    array.fill(value);
    this.dirtZoomGateAttr.needsUpdate = true;
  }

  setRainColorMode(enabled: boolean): void {
    this.mesh.geometry.setAttribute('color', enabled ? this.rainColorAttr : this.fairColorAttr);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    const { material } = this.mesh;
    if (Array.isArray(material)) {
      for (const entry of material) entry.dispose();
    } else {
      material.dispose();
    }
  }

}

function createRainColorAttribute(
  geometry: THREE.BufferGeometry,
  fairColor: THREE.BufferAttribute,
): THREE.BufferAttribute {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const shore = geometry.getAttribute('shoreBlend') as THREE.BufferAttribute;
  const roadWear = geometry.getAttribute('roadWearBlend') as THREE.BufferAttribute;
  const quarry = geometry.getAttribute('quarryPadBlend') as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);

  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index);
    const z = position.getZ(index);
    const meadowWeight = fairColor.getX(index);
    const denseWeight = fairColor.getY(index);
    const dryWeight = fairColor.getZ(index);
    const broad = terrainRainValueNoise(x * 0.0065, z * 0.0065, 47);
    const middle = terrainRainValueNoise(x * 0.017, z * 0.017, 113);
    const lowToMiddle = rainSmoothStep(
      THREE.MathUtils.clamp((broad - 0.32) / 0.16, 0, 1),
    );
    const middleToHigh = rainSmoothStep(
      THREE.MathUtils.clamp((broad - 0.58) / 0.14, 0, 1),
    );
    // Three broad, softly connected value families remain legible at the
    // strategic camera while avoiding a contour-map edge or texture tiling.
    const value = 0.42
      + lowToMiddle * 0.48
      + middleToHigh * 0.42
      + (middle - 0.5) * 0.08;
    const zoneWarmth = middleToHigh * 0.065 - (1 - lowToMiddle) * 0.035;
    const ecologyWarmth = dryWeight * 0.08 - denseWeight * 0.055 + zoneWarmth;
    const ecologyShade = denseWeight * 0.08 - meadowWeight * 0.025;

    let r = (0.97 + ecologyWarmth - ecologyShade) * value;
    let g = (1.02 - dryWeight * 0.035 - ecologyShade * 0.45) * value;
    let b = (0.91 - dryWeight * 0.075 - denseWeight * 0.045) * value;

    const shoreBlend = Math.sqrt(THREE.MathUtils.clamp(shore.getX(index), 0, 1)) * 0.98;
    r = THREE.MathUtils.lerp(r, 1.35, shoreBlend);
    g = THREE.MathUtils.lerp(g, 0.72, shoreBlend);
    b = THREE.MathUtils.lerp(b, 0.25, shoreBlend);

    const wearBlend = THREE.MathUtils.clamp(roadWear.getX(index) * 0.62, 0, 0.62);
    r = THREE.MathUtils.lerp(r, 0.72, wearBlend);
    g = THREE.MathUtils.lerp(g, 0.61, wearBlend);
    b = THREE.MathUtils.lerp(b, 0.45, wearBlend);

    const quarryBlend = THREE.MathUtils.clamp(quarry.getX(index) * 0.76, 0, 0.76);
    r = THREE.MathUtils.lerp(r, 0.68, quarryBlend);
    g = THREE.MathUtils.lerp(g, 0.7, quarryBlend);
    b = THREE.MathUtils.lerp(b, 0.67, quarryBlend);

    const offset = index * 3;
    colors[offset] = r;
    colors[offset + 1] = g;
    colors[offset + 2] = b;
  }

  return new THREE.BufferAttribute(colors, 3);
}

function terrainRainValueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = rainSmoothStep(x - x0);
  const tz = rainSmoothStep(z - z0);
  const a = terrainRainHash(x0, z0, seed);
  const b = terrainRainHash(x0 + 1, z0, seed);
  const c = terrainRainHash(x0, z0 + 1, seed);
  const d = terrainRainHash(x0 + 1, z0 + 1, seed);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, tx),
    THREE.MathUtils.lerp(c, d, tx),
    tz,
  );
}

function rainSmoothStep(value: number): number {
  return value * value * (3 - 2 * value);
}

function terrainRainHash(x: number, z: number, seed: number): number {
  let hash = Math.imul(x + seed, 0x45d9f3b) ^ Math.imul(z + seed * 5, 0x27d4eb2d);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  return (hash >>> 0) / 0xffffffff;
}
