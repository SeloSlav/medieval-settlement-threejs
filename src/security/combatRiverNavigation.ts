import type { RiverField } from '../rivers/RiverField.ts';

export const COMBAT_RIVER_NAVIGATION_RESOLUTION = 256;
export const COMBAT_WADING_SPEED_MULTIPLIER = 0.6;

export type CombatRiverNavigationGrid = {
  resolution: number;
  startX: number;
  startZ: number;
  spanX: number;
  spanZ: number;
  wetCellsHex: string;
};

const BYTE_HEX = Array.from(
  { length: 256 },
  (_, value) => value.toString(16).padStart(2, '0'),
);

/**
 * Packs the exact rendered river mask into a small road-snapshot attachment.
 *
 * The authoritative combat loop receives the same wet/dry geography the
 * player sees without reconstructing the seed-aware organic river in Rust.
 * At 256 x 256 this costs 8 KiB before hexadecimal transport and resolves even the
 * narrowest authored headwaters with several cells.
 */
export function encodeCombatRiverNavigation(
  riverField: RiverField,
): CombatRiverNavigationGrid {
  const resolution = COMBAT_RIVER_NAVIGATION_RESOLUTION;
  const cellCount = resolution * resolution;
  const bytes = new Uint8Array(Math.ceil(cellCount / 8));
  const stepX = riverField.spanX / (resolution - 1);
  const stepZ = riverField.spanZ / (resolution - 1);

  for (let gridZ = 0; gridZ < resolution; gridZ++) {
    const z = riverField.startZ + gridZ * stepZ;
    for (let gridX = 0; gridX < resolution; gridX++) {
      const x = riverField.startX + gridX * stepX;
      if (!riverField.isRenderedWetAt(x, z)) continue;
      const index = gridZ * resolution + gridX;
      bytes[index >>> 3] |= 1 << (index & 7);
    }
  }

  return {
    resolution,
    startX: riverField.startX,
    startZ: riverField.startZ,
    spanX: riverField.spanX,
    spanZ: riverField.spanZ,
    wetCellsHex: Array.from(bytes, (value) => BYTE_HEX[value]).join(''),
  };
}

export function combatRiverNavigationIsWaterAt(
  grid: CombatRiverNavigationGrid,
  x: number,
  z: number,
): boolean {
  if (
    !Number.isFinite(x)
    || !Number.isFinite(z)
    || grid.resolution < 2
    || grid.spanX <= 0
    || grid.spanZ <= 0
  ) {
    return false;
  }
  const gridX = Math.round(
    (x - grid.startX) / grid.spanX * (grid.resolution - 1),
  );
  const gridZ = Math.round(
    (z - grid.startZ) / grid.spanZ * (grid.resolution - 1),
  );
  if (
    gridX < 0
    || gridZ < 0
    || gridX >= grid.resolution
    || gridZ >= grid.resolution
  ) {
    return false;
  }
  const index = gridZ * grid.resolution + gridX;
  const byteOffset = (index >>> 3) * 2;
  const byte = Number.parseInt(
    grid.wetCellsHex.slice(byteOffset, byteOffset + 2),
    16,
  );
  return Number.isFinite(byte) && (byte & (1 << (index & 7))) !== 0;
}
