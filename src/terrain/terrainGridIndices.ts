/** Same heightfield triangles and vertex IDs, visited in small GPU-cache tiles. */
export function createTerrainGridIndices(resolution: number): Uint32Array {
  if (!Number.isInteger(resolution) || resolution < 2) throw new Error('Terrain resolution must be an integer >= 2');
  const cells = resolution - 1, indices = new Uint32Array(cells * cells * 6);
  let offset = 0;
  for (let tileZ = 0; tileZ < cells; tileZ += 8) {
    for (let tileX = 0; tileX < cells; tileX += 8) {
      for (let z = tileZ; z < Math.min(tileZ + 8, cells); z++) {
        for (let x = tileX; x < Math.min(tileX + 8, cells); x++) {
          const a = z * resolution + x, b = a + 1, c = a + resolution, d = c + 1;
          indices[offset++] = a; indices[offset++] = c; indices[offset++] = b;
          indices[offset++] = b; indices[offset++] = c; indices[offset++] = d;
        }
      }
    }
  }
  return indices;
}
