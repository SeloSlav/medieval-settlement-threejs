import hydrologyGrid from '../../server/generated/hydrology_grid.json' with { type: 'json' };

type HydrologyGrid = {
  resolution: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  scores: number[];
};

const grid = hydrologyGrid as HydrologyGrid;

/** Matches the bilinear sampler used by the authoritative SpacetimeDB simulation. */
export function sampleAuthoritativeHydrologyScore(x: number, z: number): number {
  if (x < grid.minX || x > grid.maxX || z < grid.minZ || z > grid.maxZ) return 0;
  const gx = ((x - grid.minX) / (grid.maxX - grid.minX)) * (grid.resolution - 1);
  const gz = ((z - grid.minZ) / (grid.maxZ - grid.minZ)) * (grid.resolution - 1);
  const ix0 = Math.max(0, Math.min(grid.resolution - 2, Math.floor(gx)));
  const iz0 = Math.max(0, Math.min(grid.resolution - 2, Math.floor(gz)));
  const tx = gx - ix0;
  const tz = gz - iz0;
  const at = (ix: number, iz: number): number => grid.scores[iz * grid.resolution + ix] ?? 0;
  const top = at(ix0, iz0) * (1 - tx) + at(ix0 + 1, iz0) * tx;
  const bottom = at(ix0, iz0 + 1) * (1 - tx) + at(ix0 + 1, iz0 + 1) * tx;
  return Math.max(0, Math.min(1, top * (1 - tz) + bottom * tz));
}
