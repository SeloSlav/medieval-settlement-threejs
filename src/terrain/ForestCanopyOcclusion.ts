import * as THREE from 'three';

export const FOREST_CANOPY_OCCLUSION_TEXTURE_SIZE = 512;

export type ForestCanopyOcclusionSource = {
  x: number;
  z: number;
  canopyRadius: number;
};

export type ForestCanopyOcclusionDebugMode = 'final' | 'coverage' | 'mottle';

type ForestCanopyStamp = {
  indices: Uint32Array;
  weights: Float32Array;
};

type DebugUniform = { value: number };

const DEBUG_MODE_VALUES: Record<ForestCanopyOcclusionDebugMode, number> = {
  final: 0,
  coverage: 1,
  mottle: 2,
};

/**
 * Low-resolution world-space canopy field consumed by the terrain material.
 * Each tree owns one soft elliptical stamp, so felling or restoring a tree can
 * remove or re-add only its contribution without rebuilding the forest floor.
 */
export class ForestCanopyOcclusionMap {
  readonly worldSize: number;
  readonly resolution: number;

  private readonly accumulation: Float32Array;
  private readonly pixels: Uint8Array;
  private stamps: ForestCanopyStamp[] = [];
  private active: boolean[] = [];
  private debugUniform: DebugUniform | null = null;
  private terrainGeometry: THREE.BufferGeometry | null = null;
  private terrainAttribute: THREE.BufferAttribute | null = null;

  constructor(
    worldSize: number,
    resolution = FOREST_CANOPY_OCCLUSION_TEXTURE_SIZE,
  ) {
    this.worldSize = Math.max(1, worldSize);
    this.resolution = Math.max(8, Math.floor(resolution));
    const pixelCount = this.resolution * this.resolution;
    this.accumulation = new Float32Array(pixelCount);
    this.pixels = new Uint8Array(pixelCount * 4);
    for (let index = 0; index < pixelCount; index++) {
      this.pixels[index * 4 + 3] = 255;
    }
  }

  /**
   * Installs the live field as one scalar terrain vertex attribute. Keeping
   * this out of the sampled-texture set preserves the WebGPU baseline limit
   * while the heightfield interpolates the soft coverage between vertices.
   */
  bindTerrainGeometry(geometry: THREE.BufferGeometry): void {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const attribute = new THREE.BufferAttribute(new Float32Array(position.count), 1);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('forestCanopyOcclusion', attribute);
    this.terrainGeometry = geometry;
    this.terrainAttribute = attribute;
    this.updateTerrainAttribute();
  }

  rebuild(sources: readonly ForestCanopyOcclusionSource[]): void {
    this.accumulation.fill(0);
    this.pixels.fill(0);
    for (let index = 0; index < this.accumulation.length; index++) {
      this.pixels[index * 4 + 3] = 255;
    }

    this.stamps = sources.map((source, index) => this.createStamp(source, index));
    this.active = sources.map(() => true);
    for (const stamp of this.stamps) this.applyStamp(stamp, 1);
    this.writeAllPixels();
    this.updateTerrainAttribute();
  }

  setTreeActive(treeIndex: number, active: boolean): boolean {
    const stamp = this.stamps[treeIndex];
    if (!stamp || this.active[treeIndex] === active) return false;
    this.active[treeIndex] = active;
    this.applyStamp(stamp, active ? 1 : -1);
    this.writeStampPixels(stamp);
    this.updateTerrainAttribute();
    return true;
  }

  isTreeActive(treeIndex: number): boolean {
    return this.active[treeIndex] ?? false;
  }

  setDebugMode(mode: ForestCanopyOcclusionDebugMode): void {
    if (this.debugUniform) this.debugUniform.value = DEBUG_MODE_VALUES[mode];
  }

  attachDebugUniform(debugUniform: DebugUniform): void {
    this.debugUniform = debugUniform;
  }

  sampleWorld(x: number, z: number): number {
    const pixelX = this.worldToPixel(x);
    const pixelZ = this.worldToPixel(z);
    const index = pixelZ * this.resolution + pixelX;
    return this.pixels[index * 4] / 255;
  }

  dispose(): void {
    this.terrainGeometry = null;
    this.terrainAttribute = null;
  }

  private createStamp(
    source: ForestCanopyOcclusionSource,
    sourceIndex: number,
  ): ForestCanopyStamp {
    const baseRadius = Math.max(1.8, source.canopyRadius);
    const seedA = hash01(sourceIndex * 17.17 + source.x * 0.037 + source.z * 0.019);
    const seedB = hash01(sourceIndex * 31.93 - source.x * 0.023 + source.z * 0.043);
    const seedC = hash01(sourceIndex * 47.11 + source.x * 0.013 - source.z * 0.029);
    const yaw = seedA * Math.PI * 2;
    // Canopy occlusion reaches beyond a trunk's nominal crown. Neighbouring
    // ellipses therefore merge into a woodland body while preserving gaps.
    const radiusX = baseRadius * THREE.MathUtils.lerp(1.28, 1.66, seedB) + 1.35;
    const radiusZ = baseRadius * THREE.MathUtils.lerp(1.22, 1.58, seedC) + 1.35;
    const offsetDistance = baseRadius * THREE.MathUtils.lerp(0.04, 0.22, seedA);
    const centerX = source.x + Math.cos(yaw * 1.73) * offsetDistance;
    const centerZ = source.z + Math.sin(yaw * 1.73) * offsetDistance;
    const maxRadius = Math.max(radiusX, radiusZ);
    const minX = this.worldToPixelUnclamped(centerX - maxRadius);
    const maxX = this.worldToPixelUnclamped(centerX + maxRadius);
    const minZ = this.worldToPixelUnclamped(centerZ - maxRadius);
    const maxZ = this.worldToPixelUnclamped(centerZ + maxRadius);
    const cos = Math.cos(-yaw);
    const sin = Math.sin(-yaw);
    const indices: number[] = [];
    const weights: number[] = [];

    for (let pixelZ = Math.max(0, minZ); pixelZ <= Math.min(this.resolution - 1, maxZ); pixelZ++) {
      for (let pixelX = Math.max(0, minX); pixelX <= Math.min(this.resolution - 1, maxX); pixelX++) {
        const worldX = this.pixelToWorld(pixelX);
        const worldZ = this.pixelToWorld(pixelZ);
        const dx = worldX - centerX;
        const dz = worldZ - centerZ;
        const localX = dx * cos - dz * sin;
        const localZ = dx * sin + dz * cos;
        const edgeBreakup = THREE.MathUtils.lerp(
          0.86,
          1.14,
          hashGrid(pixelX, pixelZ, sourceIndex),
        );
        const distanceSquared = (
          (localX / radiusX) ** 2
          + (localZ / radiusZ) ** 2
        ) * edgeBreakup;
        if (distanceSquared >= 1) continue;
        const radial = 1 - distanceSquared;
        const smoothRadial = radial * radial * (3 - 2 * radial);
        const weight = smoothRadial * THREE.MathUtils.lerp(0.54, 0.74, seedB);
        if (weight <= 0.002) continue;
        indices.push(pixelZ * this.resolution + pixelX);
        weights.push(weight);
      }
    }

    return {
      indices: Uint32Array.from(indices),
      weights: Float32Array.from(weights),
    };
  }

  private applyStamp(stamp: ForestCanopyStamp, direction: 1 | -1): void {
    for (let index = 0; index < stamp.indices.length; index++) {
      const pixelIndex = stamp.indices[index]!;
      this.accumulation[pixelIndex] = Math.max(
        0,
        this.accumulation[pixelIndex]! + stamp.weights[index]! * direction,
      );
    }
  }

  private writeAllPixels(): void {
    for (let index = 0; index < this.accumulation.length; index++) {
      this.writePixel(index);
    }
  }

  private writeStampPixels(stamp: ForestCanopyStamp): void {
    for (let index = 0; index < stamp.indices.length; index++) {
      this.writePixel(stamp.indices[index]!);
    }
  }

  private writePixel(pixelIndex: number): void {
    const coverage = 1 - Math.exp(-this.accumulation[pixelIndex]! * 0.76);
    const value = Math.round(THREE.MathUtils.clamp(coverage, 0, 1) * 255);
    const offset = pixelIndex * 4;
    this.pixels[offset] = value;
    this.pixels[offset + 1] = value;
    this.pixels[offset + 2] = value;
    this.pixels[offset + 3] = 255;
  }

  private updateTerrainAttribute(): void {
    if (!this.terrainGeometry || !this.terrainAttribute) return;
    const position = this.terrainGeometry.getAttribute('position') as THREE.BufferAttribute;
    const values = this.terrainAttribute.array as Float32Array;
    for (let index = 0; index < position.count; index++) {
      values[index] = this.sampleWorld(position.getX(index), position.getZ(index));
    }
    this.terrainAttribute.needsUpdate = true;
  }

  private worldToPixel(value: number): number {
    return THREE.MathUtils.clamp(
      this.worldToPixelUnclamped(value),
      0,
      this.resolution - 1,
    );
  }

  private worldToPixelUnclamped(value: number): number {
    return Math.floor((value / this.worldSize + 0.5) * this.resolution);
  }

  private pixelToWorld(pixel: number): number {
    return ((pixel + 0.5) / this.resolution - 0.5) * this.worldSize;
  }
}

export function forestCanopyOcclusionMapFromMaterial(
  material: THREE.Material | THREE.Material[],
): ForestCanopyOcclusionMap | null {
  const materials = Array.isArray(material) ? material : [material];
  for (const entry of materials) {
    const map = entry.userData.forestCanopyOcclusionMap;
    if (map instanceof ForestCanopyOcclusionMap) return map;
  }
  return null;
}

function hash01(value: number): number {
  const hashed = Math.sin(value * 12.9898) * 43758.5453123;
  return hashed - Math.floor(hashed);
}

function hashGrid(x: number, z: number, seed: number): number {
  let hash = Math.imul(x + seed * 11, 0x45d9f3b)
    ^ Math.imul(z - seed * 7, 0x27d4eb2d);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  return (hash >>> 0) / 0xffffffff;
}
