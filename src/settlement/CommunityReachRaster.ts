import type { TerrainBounds } from '../terrain/Terrain.ts';
import type {
  BuildingState,
  ResidenceState,
  SettlementState,
} from '../resources/types.ts';

export const COMMUNITY_REACH_RESOLUTION = 160;
const MIN_VISIBLE_INFLUENCE = 0.055;

export type CommunityReachRasterOptions = {
  resolution: number;
  bounds: TerrainBounds;
  settlements: Iterable<SettlementState>;
  buildings: Iterable<BuildingState>;
  residences: Iterable<ResidenceState>;
};

export type CommunityReachRaster = {
  resolution: number;
  /** Stable sorted lookup. `cells` contains indices into this array. */
  settlementIds: string[];
  /** Logical rows run minZ to maxZ; -1 is neutral wilderness. */
  cells: Int16Array;
  /** Texture rows are vertically flipped to match PlaneGeometry UVs. */
  rgba: Uint8Array;
};

type InfluenceSeed = {
  settlementIndex: number;
  x: number;
  z: number;
  radius: number;
  strength: number;
};

const COMMUNITY_ANCHOR_BUILDINGS = new Map<BuildingState['kind'], [number, number]>([
  ['founders_camp', [86, 0.82]],
  ['town_hall', [96, 1.05]],
  ['chapel', [82, 0.86]],
  ['marketplace', [80, 0.82]],
  ['tavern', [68, 0.66]],
  ['well', [62, 0.58]],
  ['granary', [58, 0.48]],
  ['village_storehouse', [58, 0.48]],
]);

export const COMMUNITY_REACH_PALETTE = [
  [199, 114, 75],
  [94, 151, 187],
  [156, 136, 68],
  [139, 99, 172],
  [74, 157, 124],
  [190, 91, 123],
  [181, 139, 78],
  [86, 128, 178],
] as const;

/**
 * Organic, porous presentation derived from authoritative sticky membership.
 * It does not gate movement, logistics, construction, or the global ledger.
 */
export function rasterizeCommunityReach(
  options: CommunityReachRasterOptions,
): CommunityReachRaster {
  const resolution = Math.max(2, Math.floor(options.resolution));
  const settlements = [...options.settlements]
    .filter((settlement) => settlement.active)
    .sort((a, b) => a.id.localeCompare(b.id));
  const settlementIds = settlements.map((settlement) => settlement.id);
  const indexById = new Map(settlementIds.map((id, index) => [id, index]));
  const seeds: InfluenceSeed[] = settlements.map((settlement, settlementIndex) => ({
    settlementIndex,
    x: settlement.anchorX,
    z: settlement.anchorZ,
    radius: 76,
    strength: 0.52,
  }));

  for (const residence of options.residences) {
    const settlementIndex = residence.settlementId
      ? indexById.get(residence.settlementId)
      : undefined;
    if (settlementIndex == null || residence.tier <= 0 || residence.abandoned) continue;
    seeds.push({
      settlementIndex,
      x: residence.x,
      z: residence.z,
      radius: 66 + Math.min(12, residence.tier * 3),
      strength: 0.88 + Math.min(0.18, Math.max(0, residence.population) * 0.025),
    });
  }

  for (const building of options.buildings) {
    const settlementIndex = building.settlementId
      ? indexById.get(building.settlementId)
      : undefined;
    const profile = COMMUNITY_ANCHOR_BUILDINGS.get(building.kind);
    if (settlementIndex == null || !profile) continue;
    if (building.constructionComplete === false && building.kind !== 'founders_camp') continue;
    seeds.push({
      settlementIndex,
      x: building.x,
      z: building.z,
      radius: profile[0],
      strength: profile[1],
    });
  }

  const seedsBySettlement = settlements.map((_, settlementIndex) =>
    seeds.filter((seed) => seed.settlementIndex === settlementIndex));
  const cells = new Int16Array(resolution * resolution);
  cells.fill(-1);
  const denominator = resolution - 1;
  for (let row = 0; row < resolution; row += 1) {
    const z = options.bounds.minZ
      + row / denominator * (options.bounds.maxZ - options.bounds.minZ);
    for (let column = 0; column < resolution; column += 1) {
      const x = options.bounds.minX
        + column / denominator * (options.bounds.maxX - options.bounds.minX);
      let bestIndex = -1;
      let bestInfluence = MIN_VISIBLE_INFLUENCE;
      for (let settlementIndex = 0; settlementIndex < settlements.length; settlementIndex += 1) {
        let influence = 0;
        for (const seed of seedsBySettlement[settlementIndex]) {
          const distance = Math.hypot(x - seed.x, z - seed.z);
          if (distance >= seed.radius) continue;
          const normalized = 1 - distance / seed.radius;
          influence = Math.max(influence, seed.strength * normalized * normalized);
        }
        // Strict comparison preserves the earlier, stable-sorted id on ties.
        if (influence > bestInfluence) {
          bestInfluence = influence;
          bestIndex = settlementIndex;
        }
      }
      cells[row * resolution + column] = bestIndex;
    }
  }

  return {
    resolution,
    settlementIds,
    cells,
    rgba: colorizeCommunityReach(cells, settlementIds, resolution),
  };
}

export function communityReachSettlementAt(
  raster: CommunityReachRaster,
  bounds: TerrainBounds,
  x: number,
  z: number,
): string | null {
  if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) return null;
  const column = Math.max(0, Math.min(
    raster.resolution - 1,
    Math.round((x - bounds.minX) / Math.max(1e-9, bounds.maxX - bounds.minX)
      * (raster.resolution - 1)),
  ));
  const row = Math.max(0, Math.min(
    raster.resolution - 1,
    Math.round((z - bounds.minZ) / Math.max(1e-9, bounds.maxZ - bounds.minZ)
      * (raster.resolution - 1)),
  ));
  const index = raster.cells[row * raster.resolution + column];
  return index >= 0 ? raster.settlementIds[index] ?? null : null;
}

export function stableCommunityPaletteIndex(settlementId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < settlementId.length; index += 1) {
    hash ^= settlementId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % COMMUNITY_REACH_PALETTE.length;
}

function colorizeCommunityReach(
  cells: Int16Array,
  settlementIds: readonly string[],
  resolution: number,
): Uint8Array {
  const rgba = new Uint8Array(resolution * resolution * 4);
  for (let row = 0; row < resolution; row += 1) {
    const dataRow = resolution - 1 - row;
    for (let column = 0; column < resolution; column += 1) {
      const cellIndex = row * resolution + column;
      const settlementIndex = cells[cellIndex];
      if (settlementIndex < 0) continue;
      const color = COMMUNITY_REACH_PALETTE[
        stableCommunityPaletteIndex(settlementIds[settlementIndex] ?? String(settlementIndex))
      ];
      const boundary = neighborDiffers(cells, resolution, row, column, settlementIndex);
      const outputIndex = (dataRow * resolution + column) * 4;
      rgba[outputIndex] = boundary ? Math.round(color[0] * 0.72) : color[0];
      rgba[outputIndex + 1] = boundary ? Math.round(color[1] * 0.72) : color[1];
      rgba[outputIndex + 2] = boundary ? Math.round(color[2] * 0.72) : color[2];
      rgba[outputIndex + 3] = boundary ? 205 : 98;
    }
  }
  return rgba;
}

function neighborDiffers(
  cells: Int16Array,
  resolution: number,
  row: number,
  column: number,
  value: number,
): boolean {
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
    const nextRow = row + dr;
    const nextColumn = column + dc;
    if (nextRow < 0 || nextRow >= resolution || nextColumn < 0 || nextColumn >= resolution) {
      return true;
    }
    if (cells[nextRow * resolution + nextColumn] !== value) return true;
  }
  return false;
}
