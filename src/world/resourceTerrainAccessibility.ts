import type { RiverLayout } from '../rivers/RiverLayout.ts';
import { sampleWorldRawTerrainHeight } from '../terrain/TerrainHeight.ts';
import type {
  WorldDimensions,
  WorldGenerationSettings,
} from './worldGenerationSettings.ts';

export type ResourceTerrainAccessibility = {
  /** True when a road-valid grade can connect this ground to the founding meadow. */
  isAccessible: (x: number, z: number) => boolean;
};

export type ResourceTerrainAccessibilityTest = (x: number, z: number) => boolean;

/** Must stay in sync with the authored road placement grade limit. */
export const RESOURCE_ACCESS_MAX_GRADE = 0.45;
/** Practical vertical reach above the founding meadow on a condensed map. */
export const RESOURCE_ACCESS_MAX_RISE = 48;
export const RESOURCE_ACCESS_GRID_STEP = 12;

const ACCESS_EPSILON = 1e-6;
const DIRECTIONS = [
  { x: -1, z: 0, distance: 1 },
  { x: 1, z: 0, distance: 1 },
  { x: 0, z: -1, distance: 1 },
  { x: 0, z: 1, distance: 1 },
  { x: -1, z: -1, distance: Math.SQRT2 },
  { x: 1, z: -1, distance: Math.SQRT2 },
  { x: -1, z: 1, distance: Math.SQRT2 },
  { x: 1, z: 1, distance: Math.SQRT2 },
] as const;

/**
 * Floods the terrain outward from the central founding meadow using the same
 * maximum grade accepted by authored roads. Resource generation can then
 * reject isolated shelves and steep mountain rims without forcing every node
 * into one hard-coded central rectangle.
 */
export function createResourceTerrainAccessibility(
  settings: WorldGenerationSettings,
  dimensions: WorldDimensions,
  riverLayout: RiverLayout,
): ResourceTerrainAccessibility {
  const half = dimensions.generationHalf;
  const width = Math.ceil(half * 2 / RESOURCE_ACCESS_GRID_STEP) + 1;
  const origin = -half;
  const heights = new Float64Array(width * width);
  const reachable = new Uint8Array(width * width);
  const queue = new Int32Array(width * width);
  let queueStart = 0;
  let queueEnd = 0;

  for (let gridZ = 0; gridZ < width; gridZ++) {
    const z = gridToWorld(gridZ, origin);
    for (let gridX = 0; gridX < width; gridX++) {
      const x = gridToWorld(gridX, origin);
      heights[gridZ * width + gridX] = sampleWorldRawTerrainHeight(
        x,
        z,
        settings,
        dimensions,
        riverLayout,
      );
    }
  }

  // Seed a modest area rather than one cell so a narrow stream or a noisy
  // sample at the exact origin cannot falsely strand the whole world.
  const foundingSeedRadius = Math.min(30, half * 0.1);
  let foundingHeightSum = 0;
  let foundingHeightSamples = 0;
  for (let gridZ = 0; gridZ < width; gridZ++) {
    const z = gridToWorld(gridZ, origin);
    for (let gridX = 0; gridX < width; gridX++) {
      const x = gridToWorld(gridX, origin);
      if (Math.hypot(x, z) > foundingSeedRadius) continue;
      foundingHeightSum += heights[gridZ * width + gridX];
      foundingHeightSamples++;
    }
  }
  const foundingMeadowHeight = foundingHeightSum / Math.max(1, foundingHeightSamples);
  const accessibleHeightCeiling = foundingMeadowHeight + RESOURCE_ACCESS_MAX_RISE;

  for (let gridZ = 0; gridZ < width; gridZ++) {
    const z = gridToWorld(gridZ, origin);
    for (let gridX = 0; gridX < width; gridX++) {
      const x = gridToWorld(gridX, origin);
      if (Math.hypot(x, z) > foundingSeedRadius) continue;
      const key = gridZ * width + gridX;
      if (heights[key] > accessibleHeightCeiling) continue;
      reachable[key] = 1;
      queue[queueEnd++] = key;
    }
  }

  while (queueStart < queueEnd) {
    const key = queue[queueStart++];
    const gridX = key % width;
    const gridZ = Math.floor(key / width);
    for (const direction of DIRECTIONS) {
      const nextX = gridX + direction.x;
      const nextZ = gridZ + direction.z;
      if (nextX < 0 || nextZ < 0 || nextX >= width || nextZ >= width) continue;
      const nextKey = nextZ * width + nextX;
      if (reachable[nextKey]) continue;
      if (heights[nextKey] > accessibleHeightCeiling) continue;
      const grade = Math.abs(heights[nextKey] - heights[key])
        / (RESOURCE_ACCESS_GRID_STEP * direction.distance);
      if (grade > RESOURCE_ACCESS_MAX_GRADE + ACCESS_EPSILON) continue;
      reachable[nextKey] = 1;
      queue[queueEnd++] = nextKey;
    }
  }

  return {
    isAccessible: (x: number, z: number): boolean => {
      if (
        !Number.isFinite(x)
        || !Number.isFinite(z)
        || Math.abs(x) > half
        || Math.abs(z) > half
      ) {
        return false;
      }
      const height = sampleWorldRawTerrainHeight(
        x,
        z,
        settings,
        dimensions,
        riverLayout,
      );
      if (height > accessibleHeightCeiling) return false;
      const centerGridX = clampGrid(Math.round((x - origin) / RESOURCE_ACCESS_GRID_STEP), width);
      const centerGridZ = clampGrid(Math.round((z - origin) / RESOURCE_ACCESS_GRID_STEP), width);

      // Connect the exact candidate to a nearby flooded sample. This prevents
      // an inaccessible point between two coarse cells from borrowing the
      // reachable status of a gentler neighboring shelf.
      for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
        const gridZ = centerGridZ + offsetZ;
        if (gridZ < 0 || gridZ >= width) continue;
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          const gridX = centerGridX + offsetX;
          if (gridX < 0 || gridX >= width) continue;
          const key = gridZ * width + gridX;
          if (!reachable[key]) continue;
          const sampleX = gridToWorld(gridX, origin);
          const sampleZ = gridToWorld(gridZ, origin);
          const distance = Math.hypot(x - sampleX, z - sampleZ);
          if (distance <= ACCESS_EPSILON) return true;
          const grade = Math.abs(height - heights[key]) / distance;
          if (grade <= RESOURCE_ACCESS_MAX_GRADE + ACCESS_EPSILON) return true;
        }
      }
      return false;
    },
  };
}

function gridToWorld(index: number, origin: number): number {
  return origin + index * RESOURCE_ACCESS_GRID_STEP;
}

function clampGrid(value: number, width: number): number {
  return Math.max(0, Math.min(width - 1, value));
}
