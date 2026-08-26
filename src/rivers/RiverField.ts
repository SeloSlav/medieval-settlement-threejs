import * as THREE from 'three';
import type { TerrainBounds } from '../terrain/Terrain.ts';
import type { PointXZ } from '../utils/pathGeometry.ts';
import type { RiverLayout } from './RiverLayout.ts';
import { buildOrganicShoreSignedDistance, computeShoreSignedDistance, dilateRiverMask } from './organicShoreField.ts';

export type RiverFieldOptions = {
  bounds: TerrainBounds;
  layout: RiverLayout;
  resolution?: number;
};

export type SerializedRiverField = {
  resolution: number;
  startX: number;
  startZ: number;
  spanX: number;
  spanZ: number;
  riverMask: Float32Array;
  shoreDistance: Float32Array;
  organicSignedDistance: Float32Array;
};

const DEFAULT_RESOLUTION = 512;
const WATER_THRESHOLD = 0.48;
const MASK_DILATE_THRESHOLD = 0.38;
const RENDER_WATER_MASK_THRESHOLD = MASK_DILATE_THRESHOLD;
const MASK_DILATE_RADIUS = 1.75;
const SHORE_BAND_MAX = 5.2;
const SHORE_MUD_FADE_START = 0.18;
const SHORE_MUD_FADE_SPAN = 10.8;
const SHORE_ORGANIC_DISTANCE_BLEND = 0.34;
const NAVIGATION_WATER_TILE_CELLS = 4;

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
  private navigationWaterTiles: Uint8Array | null = null;

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

  static fromSerialized(data: SerializedRiverField, layout: RiverLayout): RiverField {
    return new RiverField(
      data.resolution,
      data.startX,
      data.startZ,
      data.spanX,
      data.spanZ,
      data.riverMask,
      data.shoreDistance,
      data.organicSignedDistance,
      layout,
    );
  }

  serialize(): SerializedRiverField {
    return {
      resolution: this.resolution,
      startX: this.startX,
      startZ: this.startZ,
      spanX: this.spanX,
      spanZ: this.spanZ,
      riverMask: this.riverMask,
      shoreDistance: this.shoreDistance,
      organicSignedDistance: this.organicSignedDistance,
    };
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

  /**
   * Exact disk query against the rendered water cells. Agent navigation uses
   * this instead of nine independent world-to-grid probes; at normal map
   * scales an agent overlaps only one to four river-mask cells.
   */
  renderedWaterTouchesDisk(x: number, z: number, radius: number): boolean {
    if (!Number.isFinite(radius) || radius <= 1e-6) {
      return this.isRenderedWetAt(x, z);
    }
    const minGridX = Math.max(
      0,
      Math.ceil((x - radius - this.startX) / this.stepX - 0.5),
    );
    const maxGridX = Math.min(
      this.resolution - 1,
      Math.floor((x + radius - this.startX) / this.stepX + 0.5),
    );
    const minGridZ = Math.max(
      0,
      Math.ceil((z - radius - this.startZ) / this.stepZ - 0.5),
    );
    const maxGridZ = Math.min(
      this.resolution - 1,
      Math.floor((z + radius - this.startZ) / this.stepZ + 0.5),
    );
    if (minGridX > maxGridX || minGridZ > maxGridZ) return false;

    const radiusSq = radius * radius;
    for (let gridZ = minGridZ; gridZ <= maxGridZ; gridZ += 1) {
      for (let gridX = minGridX; gridX <= maxGridX; gridX += 1) {
        if (!this.isRenderedWetAtGrid(gridX, gridZ)) continue;
        const cellCenterX = this.startX + gridX * this.stepX;
        const cellCenterZ = this.startZ + gridZ * this.stepZ;
        const dx = Math.max(0, Math.abs(x - cellCenterX) - this.stepX * 0.5);
        const dz = Math.max(0, Math.abs(z - cellCenterZ) - this.stepZ * 0.5);
        if (dx * dx + dz * dz <= radiusSq) return true;
      }
    }
    return false;
  }

  /**
   * Conservative tile-level rejection for whole routes. It lets navigation
   * avoid all detailed water probes when a completed land route is nowhere
   * near the river. Detailed disk checks still own the final decision.
   */
  renderedWaterMayTouchPolyline(
    path: readonly PointXZ[],
    radius: number,
  ): boolean {
    if (path.length === 0) return false;
    const tiles = this.getNavigationWaterTiles();
    const tileResolution = Math.ceil(
      this.resolution / NAVIGATION_WATER_TILE_CELLS,
    );
    const tileSizeX = this.stepX * NAVIGATION_WATER_TILE_CELLS;
    const tileSizeZ = this.stepZ * NAVIGATION_WATER_TILE_CELLS;
    const tileOriginX = this.startX - this.stepX * 0.5;
    const tileOriginZ = this.startZ - this.stepZ * 0.5;
    const neighborRadius = Math.max(
      1,
      Math.ceil(Math.max(0, radius) / Math.min(tileSizeX, tileSizeZ)),
    );
    const sampleStep = Math.min(tileSizeX, tileSizeZ) * 0.75;
    const tileNeighborhoodIsWet = (x: number, z: number): boolean => {
      const centerTileX = Math.floor((x - tileOriginX) / tileSizeX);
      const centerTileZ = Math.floor((z - tileOriginZ) / tileSizeZ);
      for (let dz = -neighborRadius; dz <= neighborRadius; dz += 1) {
        const tileZ = centerTileZ + dz;
        if (tileZ < 0 || tileZ >= tileResolution) continue;
        for (let dx = -neighborRadius; dx <= neighborRadius; dx += 1) {
          const tileX = centerTileX + dx;
          if (tileX < 0 || tileX >= tileResolution) continue;
          if (tiles[tileZ * tileResolution + tileX] !== 0) return true;
        }
      }
      return false;
    };

    if (path.length === 1) {
      return tileNeighborhoodIsWet(path[0].x, path[0].z);
    }
    for (let index = 0; index < path.length - 1; index += 1) {
      const start = path[index];
      const end = path[index + 1];
      const length = Math.hypot(end.x - start.x, end.z - start.z);
      const steps = Math.max(1, Math.ceil(length / sampleStep));
      const startTileX = Math.floor((start.x - tileOriginX) / tileSizeX);
      const startTileZ = Math.floor((start.z - tileOriginZ) / tileSizeZ);
      const endTileX = Math.floor((end.x - tileOriginX) / tileSizeX);
      const endTileZ = Math.floor((end.z - tileOriginZ) / tileSizeZ);
      const minTileX = Math.max(
        0,
        Math.min(startTileX, endTileX) - neighborRadius,
      );
      const maxTileX = Math.min(
        tileResolution - 1,
        Math.max(startTileX, endTileX) + neighborRadius,
      );
      const minTileZ = Math.max(
        0,
        Math.min(startTileZ, endTileZ) - neighborRadius,
      );
      const maxTileZ = Math.min(
        tileResolution - 1,
        Math.max(startTileZ, endTileZ) + neighborRadius,
      );
      const rectangleChecks = Math.max(0, maxTileX - minTileX + 1)
        * Math.max(0, maxTileZ - minTileZ + 1);
      const sampleChecks = (steps + 1) * (neighborRadius * 2 + 1) ** 2;
      if (rectangleChecks <= sampleChecks) {
        for (let tileZ = minTileZ; tileZ <= maxTileZ; tileZ += 1) {
          for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
            if (tiles[tileZ * tileResolution + tileX] !== 0) return true;
          }
        }
        continue;
      }
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        if (tileNeighborhoodIsWet(
          start.x + (end.x - start.x) * t,
          start.z + (end.z - start.z) * t,
        )) return true;
      }
    }
    return false;
  }

  prepareNavigationWaterIndex(): void {
    this.getNavigationWaterTiles();
  }

  private getNavigationWaterTiles(): Uint8Array {
    if (this.navigationWaterTiles) return this.navigationWaterTiles;
    const tileResolution = Math.ceil(
      this.resolution / NAVIGATION_WATER_TILE_CELLS,
    );
    const tiles = new Uint8Array(tileResolution * tileResolution);
    for (let gridZ = 0; gridZ < this.resolution; gridZ += 1) {
      for (let gridX = 0; gridX < this.resolution; gridX += 1) {
        if (!this.isRenderedWetAtGrid(gridX, gridZ)) continue;
        const tileX = Math.floor(gridX / NAVIGATION_WATER_TILE_CELLS);
        const tileZ = Math.floor(gridZ / NAVIGATION_WATER_TILE_CELLS);
        tiles[tileZ * tileResolution + tileX] = 1;
      }
    }
    this.navigationWaterTiles = tiles;
    return tiles;
  }

  sampleOrganicSignedDistance(x: number, z: number): number {
    return sampleBilinear(this.organicSignedDistance, this.resolution, this.worldToGrid(x, z));
  }

  sampleMudBlendAt(x: number, z: number): number {
    if (this.isRenderedWetAt(x, z)) return 0;
    const gridShore = this.sampleShoreDistance(x, z);
    const cellStep = (this.stepX + this.stepZ) * 0.5;
    const organicShore = Math.max(0, -this.sampleOrganicSignedDistance(x, z)) * cellStep;
    const shore = THREE.MathUtils.lerp(gridShore, organicShore, SHORE_ORGANIC_DISTANCE_BLEND);
    const t = clamp01((shore - SHORE_MUD_FADE_START) / SHORE_MUD_FADE_SPAN);
    const fade = t * t * (3 - 2 * t);
    return 1 - fade;
  }

  isBlockedForProps(x: number, z: number, margin = 4.2): boolean {
    if (this.isRenderedWetAt(x, z)) return true;
    return this.sampleShoreDistance(x, z) < margin;
  }

  /** Close-up grass tufts — keep off water and the river-edge reed band. */
  isGrassBlockedAt(x: number, z: number): boolean {
    if (this.isRenderedWetAt(x, z)) return true;
    const shore = this.sampleShoreDistance(x, z);
    return shore >= 0.45 && shore <= SHORE_BAND_MAX;
  }

  isShoreStoneCandidate(x: number, z: number): boolean {
    const shore = this.sampleShoreDistance(x, z);
    return shore >= 0.45 && shore <= SHORE_BAND_MAX && !this.isWaterAt(x, z);
  }

  sampleShoreDistance(x: number, z: number): number {
    return sampleBilinear(this.shoreDistance, this.resolution, this.worldToGrid(x, z));
  }

  createShoreBlendTexture(): THREE.DataTexture {
    const { resolution, startX, startZ, stepX, stepZ } = this;
    const data = new Uint8Array(resolution * resolution);
    for (let iz = 0; iz < resolution; iz++) {
      for (let ix = 0; ix < resolution; ix++) {
        const x = startX + ix * stepX;
        const z = startZ + iz * stepZ;
        data[iz * resolution + ix] = Math.round(this.sampleMudBlendAt(x, z) * 255);
      }
    }

    const texture = new THREE.DataTexture(data, resolution, resolution, THREE.RedFormat, THREE.UnsignedByteType);
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
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
