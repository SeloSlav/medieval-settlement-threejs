import * as THREE from 'three';

export const FOREST_CANOPY_OCCLUSION_TEXTURE_SIZE = 512;

/**
 * Perceptual controls for the event-driven forest-light field. Distances are
 * world metres and remain stable across terrain and camera resolutions.
 */
export const FOREST_CANOPY_FIELD_PARAMETERS = Object.freeze({
  crownExtinction: 0.76,
  closure: Object.freeze({
    radiusMeters: 5.5,
    interiorStart: 0.1,
    interiorFull: 0.26,
  }),
  sunOpenings: Object.freeze({
    orientationRadians: -0.68,
    alongScaleMeters: 13.5,
    acrossScaleMeters: 4.2,
    patternStart: 0.76,
    patternFull: 0.92,
    crownCoverageStart: 0.14,
    crownCoverageFull: 0.52,
    interiorStart: 0.58,
    interiorFull: 0.9,
    maximumAccess: 0.82,
    shadeRelief: 0.72,
    seed: 173,
  }),
});

export type ForestCanopyOcclusionSource = {
  x: number;
  z: number;
  canopyRadius: number;
};

export type ForestCanopyFieldSample = {
  coverage: number;
  interior: number;
  sunAccess: number;
  shade: number;
};

export type ForestCanopyOcclusionDebugMode =
  | 'final'
  | 'coverage'
  | 'interior'
  | 'sun-access'
  | 'mottle';

type ForestCanopyStamp = {
  indices: Uint32Array;
  weights: Float32Array;
  bounds: PixelBounds;
};

type PixelBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

type DebugUniform = { value: number };

const DEBUG_MODE_VALUES: Record<ForestCanopyOcclusionDebugMode, number> = {
  final: 0,
  coverage: 1,
  interior: 2,
  'sun-access': 3,
  // Historical console/debug callers used "mottle" for the light-well view.
  mottle: 3,
};

const FIELD_CHANNELS = 4;
const COVERAGE_CHANNEL = 0;
const INTERIOR_CHANNEL = 1;
const SUN_ACCESS_CHANNEL = 2;
const SHADE_CHANNEL = 3;

/**
 * Low-resolution world-space canopy-light field consumed by the terrain
 * material. Individual crowns own additive optical-depth stamps so felling
 * remains reversible. A neighbourhood envelope is derived from their summed
 * coverage, closing incidental crown gaps into one forest interior. Sparse
 * deterministic light wells are then cut only through genuine local canopy
 * openings.
 *
 * RGBA field channels:
 *   R = live crown coverage
 *   G = gap-closing forest interior
 *   B = normalized sun access through local openings
 *   A = resolved broad shade before camera-distance filtering
 */
export class ForestCanopyOcclusionMap {
  readonly worldSize: number;
  readonly resolution: number;

  private readonly accumulation: Float32Array;
  private readonly crownCoverage: Float32Array;
  private readonly neighbourhoodCoverage: Float32Array;
  private readonly pixels: Uint8Array;
  private stamps: ForestCanopyStamp[] = [];
  private active: boolean[] = [];
  private derivedFieldsDirty = false;
  private fullRebuildDirty = false;
  private pendingDirtyBounds: PixelBounds | null = null;
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
    this.crownCoverage = new Float32Array(pixelCount);
    this.neighbourhoodCoverage = new Float32Array(pixelCount);
    this.pixels = new Uint8Array(pixelCount * FIELD_CHANNELS);
  }

  /**
   * Installs the field as one normalized RGBA vertex attribute. Packing every
   * named field into one buffer preserves the existing WebGPU vertex-buffer
   * slot count and avoids adding a sampled texture to the terrain material.
   */
  bindTerrainGeometry(geometry: THREE.BufferGeometry): void {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const attribute = new THREE.BufferAttribute(
      new Uint8Array(position.count * FIELD_CHANNELS),
      FIELD_CHANNELS,
      true,
    );
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('forestCanopyOcclusion', attribute);
    this.terrainGeometry = geometry;
    this.terrainAttribute = attribute;
    this.updateTerrainAttribute();
  }

  rebuild(sources: readonly ForestCanopyOcclusionSource[]): void {
    this.accumulation.fill(0);
    this.stamps = sources.map((source, index) => this.createStamp(source, index));
    this.active = sources.map(() => true);
    for (const stamp of this.stamps) this.applyStamp(stamp, 1);
    this.derivedFieldsDirty = true;
    this.fullRebuildDirty = true;
    this.pendingDirtyBounds = null;
    this.commit();
  }

  /**
   * Updates one tree's ownership. ForestManager defers the expensive derived
   * field rebuild while applying a batch, then calls commit once alongside
   * the instance-matrix commit.
   */
  setTreeActive(treeIndex: number, active: boolean, deferUpdate = false): boolean {
    const stamp = this.stamps[treeIndex];
    if (!stamp || this.active[treeIndex] === active) return false;
    this.active[treeIndex] = active;
    this.applyStamp(stamp, active ? 1 : -1);
    this.derivedFieldsDirty = true;
    this.pendingDirtyBounds = unionPixelBounds(
      this.pendingDirtyBounds,
      stamp.bounds,
    );
    if (!deferUpdate) this.commit();
    return true;
  }

  commit(): boolean {
    if (!this.derivedFieldsDirty) return false;
    const rawDirtyBounds = this.fullRebuildDirty
      ? undefined
      : this.pendingDirtyBounds ?? undefined;
    const derivedDirtyBounds = this.rebuildDerivedFields(rawDirtyBounds);
    this.updateTerrainAttribute(derivedDirtyBounds);
    this.derivedFieldsDirty = false;
    this.fullRebuildDirty = false;
    this.pendingDirtyBounds = null;
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

  /** Returns the resolved broad shade amount for legacy scalar callers. */
  sampleWorld(x: number, z: number): number {
    return this.sampleFieldWorld(x, z).shade;
  }

  sampleFieldWorld(x: number, z: number): ForestCanopyFieldSample {
    return {
      coverage: this.sampleChannelWorld(x, z, COVERAGE_CHANNEL),
      interior: this.sampleChannelWorld(x, z, INTERIOR_CHANNEL),
      sunAccess: this.sampleChannelWorld(x, z, SUN_ACCESS_CHANNEL),
      shade: this.sampleChannelWorld(x, z, SHADE_CHANNEL),
    };
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
    // Crown coverage reaches modestly beyond the nominal visible cards. The
    // larger forest-scale joining is owned by the derived closure field below.
    const radiusX = baseRadius * THREE.MathUtils.lerp(1.18, 1.42, seedB) + 0.9;
    const radiusZ = baseRadius * THREE.MathUtils.lerp(1.14, 1.38, seedC) + 0.9;
    const offsetDistance = baseRadius * THREE.MathUtils.lerp(0.04, 0.18, seedA);
    const centerX = source.x + Math.cos(yaw * 1.73) * offsetDistance;
    const centerZ = source.z + Math.sin(yaw * 1.73) * offsetDistance;
    const maxRadius = Math.max(radiusX, radiusZ);
    const minX = this.worldToPixelUnclamped(centerX - maxRadius);
    const maxX = this.worldToPixelUnclamped(centerX + maxRadius);
    const minZ = this.worldToPixelUnclamped(centerZ - maxRadius);
    const maxZ = this.worldToPixelUnclamped(centerZ + maxRadius);
    const bounds: PixelBounds = {
      minX: THREE.MathUtils.clamp(minX, 0, this.resolution - 1),
      maxX: THREE.MathUtils.clamp(maxX, 0, this.resolution - 1),
      minZ: THREE.MathUtils.clamp(minZ, 0, this.resolution - 1),
      maxZ: THREE.MathUtils.clamp(maxZ, 0, this.resolution - 1),
    };
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
          0.88,
          1.12,
          hashGrid(pixelX, pixelZ, sourceIndex),
        );
        const distanceSquared = (
          (localX / radiusX) ** 2
          + (localZ / radiusZ) ** 2
        ) * edgeBreakup;
        if (distanceSquared >= 1) continue;
        const radial = 1 - distanceSquared;
        const smoothRadial = radial * radial * (3 - 2 * radial);
        const weight = smoothRadial * THREE.MathUtils.lerp(0.58, 0.78, seedB);
        if (weight <= 0.002) continue;
        indices.push(pixelZ * this.resolution + pixelX);
        weights.push(weight);
      }
    }

    return {
      indices: Uint32Array.from(indices),
      weights: Float32Array.from(weights),
      bounds,
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

  private rebuildDerivedFields(rawDirtyBounds?: PixelBounds): PixelBounds | undefined {
    const parameters = FOREST_CANOPY_FIELD_PARAMETERS;
    const rawBounds = rawDirtyBounds ?? {
      minX: 0,
      maxX: this.resolution - 1,
      minZ: 0,
      maxZ: this.resolution - 1,
    };
    for (let pixelZ = rawBounds.minZ; pixelZ <= rawBounds.maxZ; pixelZ++) {
      for (let pixelX = rawBounds.minX; pixelX <= rawBounds.maxX; pixelX++) {
        const index = pixelZ * this.resolution + pixelX;
        this.crownCoverage[index] = 1 - Math.exp(
          -this.accumulation[index]! * parameters.crownExtinction,
        );
      }
    }

    const metersPerPixel = this.worldSize / this.resolution;
    const closureRadiusPixels = THREE.MathUtils.clamp(
      Math.round(parameters.closure.radiusMeters / metersPerPixel),
      1,
      Math.max(1, Math.floor(this.resolution / 12)),
    );
    const derivedBounds = rawDirtyBounds
      ? expandPixelBounds(rawBounds, closureRadiusPixels, this.resolution)
      : rawBounds;
    this.buildClosureEnvelope(closureRadiusPixels, derivedBounds);

    const opening = parameters.sunOpenings;
    const cos = Math.cos(opening.orientationRadians);
    const sin = Math.sin(opening.orientationRadians);
    for (let pixelZ = derivedBounds.minZ; pixelZ <= derivedBounds.maxZ; pixelZ++) {
      for (let pixelX = derivedBounds.minX; pixelX <= derivedBounds.maxX; pixelX++) {
        const index = pixelZ * this.resolution + pixelX;
        const coverage = this.crownCoverage[index]!;
        const closure = smoothstep01(
          parameters.closure.interiorStart,
          parameters.closure.interiorFull,
          this.neighbourhoodCoverage[index]!,
        );
        const interior = Math.max(coverage, closure);
        const worldX = this.pixelToWorld(pixelX);
        const worldZ = this.pixelToWorld(pixelZ);
        const along = (worldX * cos + worldZ * sin) / opening.alongScaleMeters;
        const across = (-worldX * sin + worldZ * cos) / opening.acrossScaleMeters;
        const openingStructure = valueNoise2D(along, across, opening.seed);
        const openingPattern = smoothstep01(
          opening.patternStart,
          opening.patternFull,
          openingStructure,
        );
        const localGap = 1 - smoothstep01(
          opening.crownCoverageStart,
          opening.crownCoverageFull,
          coverage,
        );
        const deepInterior = smoothstep01(
          opening.interiorStart,
          opening.interiorFull,
          interior,
        );
        const sunAccess = THREE.MathUtils.clamp(
          openingPattern * localGap * deepInterior * opening.maximumAccess,
          0,
          1,
        );
        const shade = interior * (1 - sunAccess * opening.shadeRelief);
        const offset = index * FIELD_CHANNELS;
        this.pixels[offset + COVERAGE_CHANNEL] = toByte(coverage);
        this.pixels[offset + INTERIOR_CHANNEL] = toByte(interior);
        this.pixels[offset + SUN_ACCESS_CHANNEL] = toByte(sunAccess);
        this.pixels[offset + SHADE_CHANNEL] = toByte(shade);
      }
    }
    return rawDirtyBounds ? derivedBounds : undefined;
  }

  private buildClosureEnvelope(radius: number, bounds: PixelBounds): void {
    const width = this.resolution;
    const radiusSquared = radius * radius;
    const kernel: Array<{ x: number; z: number; weight: number }> = [];
    for (let z = -radius; z <= radius; z++) {
      for (let x = -radius; x <= radius; x++) {
        const distanceSquared = x * x + z * z;
        if (distanceSquared > radiusSquared) continue;
        const normalizedDistance = Math.sqrt(distanceSquared) / radius;
        const feather = smoothstep01(0, 1, normalizedDistance);
        kernel.push({
          x,
          z,
          weight: THREE.MathUtils.lerp(1, 0.38, feather),
        });
      }
    }

    for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        let envelope = 0;
        for (const sample of kernel) {
          const sampleX = THREE.MathUtils.clamp(x + sample.x, 0, width - 1);
          const sampleZ = THREE.MathUtils.clamp(z + sample.z, 0, width - 1);
          envelope = Math.max(
            envelope,
            this.crownCoverage[sampleZ * width + sampleX]! * sample.weight,
          );
        }
        this.neighbourhoodCoverage[z * width + x] = envelope;
      }
    }
  }

  private updateTerrainAttribute(bounds?: PixelBounds): void {
    if (!this.terrainGeometry || !this.terrainAttribute) return;
    const position = this.terrainGeometry.getAttribute('position') as THREE.BufferAttribute;
    const values = this.terrainAttribute.array as Uint8Array;
    let firstUpdatedVertex = Number.POSITIVE_INFINITY;
    let lastUpdatedVertex = -1;
    for (let index = 0; index < position.count; index++) {
      if (bounds) {
        const coordinate = this.worldToPixelCoordinate(
          position.getX(index),
          position.getZ(index),
        );
        if (
          coordinate.x0 < bounds.minX - 1
          || coordinate.x0 > bounds.maxX
          || coordinate.z0 < bounds.minZ - 1
          || coordinate.z0 > bounds.maxZ
        ) {
          continue;
        }
      }
      this.sampleFieldBytesInto(
        position.getX(index),
        position.getZ(index),
        values,
        index * FIELD_CHANNELS,
      );
      firstUpdatedVertex = Math.min(firstUpdatedVertex, index);
      lastUpdatedVertex = Math.max(lastUpdatedVertex, index);
    }
    if (lastUpdatedVertex < 0) return;
    this.terrainAttribute.clearUpdateRanges();
    this.terrainAttribute.addUpdateRange(
      firstUpdatedVertex * FIELD_CHANNELS,
      (lastUpdatedVertex - firstUpdatedVertex + 1) * FIELD_CHANNELS,
    );
    if (!bounds) {
      // The complete initialization is already contiguous; make that explicit
      // so render backends do not retain ranges from an earlier local update.
      this.terrainAttribute.clearUpdateRanges();
      this.terrainAttribute.addUpdateRange(0, values.length);
    }
    this.terrainAttribute.needsUpdate = true;
  }

  private sampleChannelWorld(x: number, z: number, channel: number): number {
    const coordinate = this.worldToPixelCoordinate(x, z);
    const x1 = Math.min(coordinate.x0 + 1, this.resolution - 1);
    const z1 = Math.min(coordinate.z0 + 1, this.resolution - 1);
    const a = this.pixelChannel(coordinate.x0, coordinate.z0, channel);
    const b = this.pixelChannel(x1, coordinate.z0, channel);
    const c = this.pixelChannel(coordinate.x0, z1, channel);
    const d = this.pixelChannel(x1, z1, channel);
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(a, b, coordinate.tx),
      THREE.MathUtils.lerp(c, d, coordinate.tx),
      coordinate.tz,
    ) / 255;
  }

  private sampleFieldBytesInto(
    x: number,
    z: number,
    target: Uint8Array,
    targetOffset: number,
  ): void {
    const coordinate = this.worldToPixelCoordinate(x, z);
    const x1 = Math.min(coordinate.x0 + 1, this.resolution - 1);
    const z1 = Math.min(coordinate.z0 + 1, this.resolution - 1);
    for (let channel = 0; channel < FIELD_CHANNELS; channel++) {
      const a = this.pixelChannel(coordinate.x0, coordinate.z0, channel);
      const b = this.pixelChannel(x1, coordinate.z0, channel);
      const c = this.pixelChannel(coordinate.x0, z1, channel);
      const d = this.pixelChannel(x1, z1, channel);
      target[targetOffset + channel] = Math.round(THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(a, b, coordinate.tx),
        THREE.MathUtils.lerp(c, d, coordinate.tx),
        coordinate.tz,
      ));
    }
  }

  private worldToPixelCoordinate(x: number, z: number): {
    x0: number;
    z0: number;
    tx: number;
    tz: number;
  } {
    const pixelX = THREE.MathUtils.clamp(
      (x / this.worldSize + 0.5) * this.resolution - 0.5,
      0,
      this.resolution - 1,
    );
    const pixelZ = THREE.MathUtils.clamp(
      (z / this.worldSize + 0.5) * this.resolution - 0.5,
      0,
      this.resolution - 1,
    );
    const x0 = Math.floor(pixelX);
    const z0 = Math.floor(pixelZ);
    return {
      x0,
      z0,
      tx: pixelX - x0,
      tz: pixelZ - z0,
    };
  }

  private pixelChannel(x: number, z: number, channel: number): number {
    return this.pixels[(z * this.resolution + x) * FIELD_CHANNELS + channel]!;
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

function unionPixelBounds(
  current: PixelBounds | null,
  next: PixelBounds,
): PixelBounds {
  if (!current) return { ...next };
  return {
    minX: Math.min(current.minX, next.minX),
    maxX: Math.max(current.maxX, next.maxX),
    minZ: Math.min(current.minZ, next.minZ),
    maxZ: Math.max(current.maxZ, next.maxZ),
  };
}

function expandPixelBounds(
  bounds: PixelBounds,
  radius: number,
  resolution: number,
): PixelBounds {
  return {
    minX: Math.max(0, bounds.minX - radius),
    maxX: Math.min(resolution - 1, bounds.maxX + radius),
    minZ: Math.max(0, bounds.minZ - radius),
    maxZ: Math.min(resolution - 1, bounds.maxZ + radius),
  };
}

function smoothstep01(edge0: number, edge1: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function toByte(value: number): number {
  return Math.round(THREE.MathUtils.clamp(value, 0, 1) * 255);
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

function valueNoise2D(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smoothstep01(0, 1, x - x0);
  const tz = smoothstep01(0, 1, z - z0);
  const a = hashGrid(x0, z0, seed);
  const b = hashGrid(x0 + 1, z0, seed);
  const c = hashGrid(x0, z0 + 1, seed);
  const d = hashGrid(x0 + 1, z0 + 1, seed);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, tx),
    THREE.MathUtils.lerp(c, d, tx),
    tz,
  );
}
