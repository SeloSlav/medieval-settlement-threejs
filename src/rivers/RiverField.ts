import type { TerrainBounds } from '../terrain/Terrain.ts';
import type { RiverLayout } from './RiverLayout.ts';
import { buildOrganicShoreSignedDistance, computeShoreSignedDistance, dilateRiverMask } from './organicShoreField.ts';

export type RiverFieldOptions = {
  bounds: TerrainBounds;
  layout: RiverLayout;
  resolution?: number;
};

const DEFAULT_RESOLUTION = 296;
const WATER_THRESHOLD = 0.48;
const MASK_DILATE_THRESHOLD = 0.38;
const RENDER_WATER_MASK_THRESHOLD = MASK_DILATE_THRESHOLD;
const MASK_DILATE_RADIUS = 1.75;
const SHORE_BAND_MAX = 5.2;

export class RiverField {
  readonly resolution: number;
  readonly startX: number;
  readonly startZ: number;
  readonly spanX: number;
  readonly spanZ: number;
  readonly stepX: number;
  readonly stepZ: number;
  readonly riverMask: Float32Array;
  readonly shoreDistance: Float32Array;
  readonly organicSignedDistance: Float32Array;
  readonly layout: RiverLayout;
  readonly maxCarveDepth = 0;

  private constructor(
    resolution: number,
    startX: number,
    startZ: number,
    spanX: number,
    spanZ: number,
    riverMask: Float32Array,
    shoreDistance: Float32Array,
    organicSignedDistance: Float32Array,
    layout: RiverLayout,
  ) {
    this.resolution = resolution;
    this.startX = startX;
    this.startZ = startZ;
    this.spanX = spanX;
    this.spanZ = spanZ;
    this.stepX = spanX / (resolution - 1);
    this.stepZ = spanZ / (resolution - 1);
    this.riverMask = riverMask;
    this.shoreDistance = shoreDistance;
    this.organicSignedDistance = organicSignedDistance;
    this.layout = layout;
  }

  static fromLayout(options: RiverFieldOptions): RiverField {
    const resolution = options.resolution ?? DEFAULT_RESOLUTION;
    const { bounds, layout } = options;
    const startX = bounds.minX;
    const startZ = bounds.minZ;
    const spanX = bounds.maxX - bounds.minX;
    const spanZ = bounds.maxZ - bounds.minZ;
    const stepX = spanX / (resolution - 1);
    const stepZ = spanZ / (resolution - 1);
    const riverMask = layout.buildRiverMaskGrid(resolution);
    const connectedMask = dilateRiverMask(riverMask, resolution, MASK_DILATE_THRESHOLD, MASK_DILATE_RADIUS);
    const shoreSigned = computeShoreSignedDistance(connectedMask, resolution, RENDER_WATER_MASK_THRESHOLD);
    const organicSignedDistance = buildOrganicShoreSignedDistance({
      shoreSignedDistance: shoreSigned,
      resolution,
      stepX,
      stepZ,
      startX,
      startZ,
    });
    const shoreDistance = computeShoreDistanceField(
      connectedMask,
      resolution,
      WATER_THRESHOLD,
      stepX,
      stepZ,
    );

    return new RiverField(
      resolution,
      startX,
      startZ,
      spanX,
      spanZ,
      connectedMask,
      shoreDistance,
      organicSignedDistance,
      layout,
    );
  }

  sampleRiverMask(x: number, z: number): number {
    return this.layout.sampleRiverMask(x, z);
  }

  getCarveDepthAt(_x: number, _z: number): number {
    return 0;
  }

  isWaterAt(x: number, z: number): boolean {
    return this.layout.isWaterAt(x, z);
  }

  isWetAt(x: number, z: number): boolean {
    return this.sampleConnectedMask(x, z) >= WATER_THRESHOLD;
  }

  isOrganicWetAt(x: number, z: number): boolean {
    return this.sampleOrganicSignedDistance(x, z) >= -0.08;
  }

  sampleConnectedMask(x: number, z: number): number {
    return sampleBilinear(this.riverMask, this.resolution, this.worldToGrid(x, z));
  }

  isRenderedWetAt(x: number, z: number): boolean {
    const grid = this.worldToGrid(x, z);
    const ix = Math.round(grid.gx);
    const iz = Math.round(grid.gz);
    return this.isRenderedWetAtGrid(ix, iz);
  }

  isRenderedWetAtGrid(ix: number, iz: number): boolean {
    if (ix < 0 || iz < 0 || ix >= this.resolution || iz >= this.resolution) return false;
    const i = iz * this.resolution + ix;
    return this.riverMask[i] >= RENDER_WATER_MASK_THRESHOLD;
  }

  sampleOrganicSignedDistance(x: number, z: number): number {
    return sampleBilinear(this.organicSignedDistance, this.resolution, this.worldToGrid(x, z));
  }

  sampleMudBlendAt(x: number, z: number): number {
    if (this.isRenderedWetAt(x, z)) return 0;
    const shore = this.sampleShoreDistance(x, z);
    const t = clamp01((shore - 0.1) / 9.2);
    const fade = t * t * (3 - 2 * t);
    return 1 - fade;
  }

  isBlockedForProps(x: number, z: number, margin = 4.2): boolean {
    if (this.isWaterAt(x, z)) return true;
    return this.sampleShoreDistance(x, z) < margin;
  }

  isShoreStoneCandidate(x: number, z: number): boolean {
    const shore = this.sampleShoreDistance(x, z);
    return shore >= 0.45 && shore <= SHORE_BAND_MAX && !this.isWaterAt(x, z);
  }

  sampleShoreDistance(x: number, z: number): number {
    return sampleBilinear(this.shoreDistance, this.resolution, this.worldToGrid(x, z));
  }

  forEachWetCell(callback: (x: number, z: number, mask: number, gridX: number, gridZ: number) => void): void {
    const { resolution, riverMask } = this;
    for (let gridZ = 0; gridZ < resolution; gridZ++) {
      for (let gridX = 0; gridX < resolution; gridX++) {
        const mask = riverMask[gridZ * resolution + gridX];
        if (mask < WATER_THRESHOLD) continue;
        callback(this.startX + gridX * this.stepX, this.startZ + gridZ * this.stepZ, mask, gridX, gridZ);
      }
    }
  }

  private worldToGrid(x: number, z: number): { gx: number; gz: number } {
    return {
      gx: (x - this.startX) / this.stepX,
      gz: (z - this.startZ) / this.stepZ,
    };
  }
}

function computeShoreDistanceField(
  riverMask: Float32Array,
  resolution: number,
  waterThreshold: number,
  stepX: number,
  stepZ: number,
): Float32Array {
  const shoreDistance = new Float32Array(riverMask.length);
  const cellStep = (stepX + stepZ) * 0.5;
  const isWet = (ix: number, iz: number): boolean => {
    if (ix < 0 || iz < 0 || ix >= resolution || iz >= resolution) return false;
    return riverMask[iz * resolution + ix] >= waterThreshold;
  };

  for (let iz = 0; iz < resolution; iz++) {
    for (let ix = 0; ix < resolution; ix++) {
      const i = iz * resolution + ix;
      const wet = isWet(ix, iz);
      let bestSq = Number.POSITIVE_INFINITY;

      for (let dz = -10; dz <= 10; dz++) {
        for (let dx = -10; dx <= 10; dx++) {
          if (dx === 0 && dz === 0) continue;
          const neighborWet = isWet(ix + dx, iz + dz);
          if (neighborWet === wet) continue;
          bestSq = Math.min(bestSq, dx * dx + dz * dz);
        }
      }

      shoreDistance[i] = Number.isFinite(bestSq) ? Math.sqrt(bestSq) * cellStep : 10 * cellStep;
    }
  }

  return shoreDistance;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function sampleBilinear(
  values: Float32Array,
  resolution: number,
  grid: { gx: number; gz: number },
): number {
  const gx = Math.max(0, Math.min(resolution - 1, grid.gx));
  const gz = Math.max(0, Math.min(resolution - 1, grid.gz));
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const x1 = Math.min(resolution - 1, x0 + 1);
  const z1 = Math.min(resolution - 1, z0 + 1);
  const tx = gx - x0;
  const tz = gz - z0;
  const h00 = values[z0 * resolution + x0] ?? 0;
  const h10 = values[z0 * resolution + x1] ?? h00;
  const h01 = values[z1 * resolution + x0] ?? h00;
  const h11 = values[z1 * resolution + x1] ?? h10;
  const hx0 = h00 + (h10 - h00) * tx;
  const hx1 = h01 + (h11 - h01) * tx;
  return hx0 + (hx1 - hx0) * tz;
}
