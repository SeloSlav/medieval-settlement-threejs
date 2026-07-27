/**
 * Produces smooth heightfield normals without inheriting the arbitrary
 * diagonal used to split each terrain cell into render triangles. A two-cell
 * derivative span suppresses one-pixel direct-light contours from the narrow
 * river-valley carve while preserving the terrain's broad authored relief.
 */
export function createHeightfieldNormals(
  positions: Float32Array,
  resolution: number,
): Float32Array {
  const normals = new Float32Array(positions.length);
  updateHeightfieldNormalsInRegion(
    positions,
    normals,
    resolution,
    0,
    resolution - 1,
    0,
    resolution - 1,
  );
  return normals;
}

/**
 * Updates every central-difference normal that can depend on a rectangular
 * position edit. The two-vertex halo matches the derivative sample radius.
 */
export function updateHeightfieldNormalsInRegion(
  positions: Float32Array,
  normals: Float32Array,
  resolution: number,
  minXIndex: number,
  maxXIndex: number,
  minZIndex: number,
  maxZIndex: number,
): void {
  const sampleRadius = 2;
  const normalMinX = Math.max(0, minXIndex - sampleRadius);
  const normalMaxX = Math.min(resolution - 1, maxXIndex + sampleRadius);
  const normalMinZ = Math.max(0, minZIndex - sampleRadius);
  const normalMaxZ = Math.min(resolution - 1, maxZIndex + sampleRadius);

  for (let zIndex = normalMinZ; zIndex <= normalMaxZ; zIndex++) {
    for (let xIndex = normalMinX; xIndex <= normalMaxX; xIndex++) {
      const leftIndex = zIndex * resolution + Math.max(0, xIndex - sampleRadius);
      const rightIndex = zIndex * resolution + Math.min(resolution - 1, xIndex + sampleRadius);
      const downIndex = Math.max(0, zIndex - sampleRadius) * resolution + xIndex;
      const upIndex = Math.min(resolution - 1, zIndex + sampleRadius) * resolution + xIndex;
      const xSpan = positions[rightIndex * 3] - positions[leftIndex * 3];
      const zSpan = positions[upIndex * 3 + 2] - positions[downIndex * 3 + 2];
      const dx = xSpan !== 0
        ? (positions[rightIndex * 3 + 1] - positions[leftIndex * 3 + 1]) / xSpan
        : 0;
      const dz = zSpan !== 0
        ? (positions[upIndex * 3 + 1] - positions[downIndex * 3 + 1]) / zSpan
        : 0;
      const inverseLength = 1 / Math.hypot(dx, 1, dz);
      const normalOffset = (zIndex * resolution + xIndex) * 3;
      normals[normalOffset] = -dx * inverseLength;
      normals[normalOffset + 1] = inverseLength;
      normals[normalOffset + 2] = -dz * inverseLength;
    }
  }
}
