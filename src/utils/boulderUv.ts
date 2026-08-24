import * as THREE from 'three';

/**
 * Unwraps the U=0/1 discontinuity independently for each non-indexed triangle.
 * Repeat-wrapped rock maps then interpolate across the short seam instead of
 * smearing almost an entire texture across one face.
 */
export function unwrapTriangleUvSeams(
  geometry: THREE.BufferGeometry,
  attributeName = 'uv',
): void {
  if (geometry.getIndex()) {
    throw new Error('unwrapTriangleUvSeams requires non-indexed triangle geometry');
  }
  const uv = geometry.getAttribute(attributeName) as THREE.BufferAttribute | undefined;
  if (!uv || uv.itemSize < 2 || uv.count % 3 !== 0) {
    throw new Error(`unwrapTriangleUvSeams requires triangle ${attributeName} coordinates`);
  }

  for (let triangle = 0; triangle < uv.count; triangle += 3) {
    const u0 = uv.getX(triangle);
    const u1 = uv.getX(triangle + 1);
    const u2 = uv.getX(triangle + 2);
    const minU = Math.min(u0, u1, u2);
    const maxU = Math.max(u0, u1, u2);
    if (maxU - minU <= 0.5) continue;
    for (let corner = 0; corner < 3; corner += 1) {
      const index = triangle + corner;
      const u = uv.getX(index);
      if (u < 0.5) uv.setX(index, u + 1);
    }
  }
  uv.needsUpdate = true;
}
