import * as THREE from 'three';

/** Height on the rendered a-c-b / b-c-d triangles, for surface decals. */
export function sampleTerrainMeshSurfaceHeight(
  geometry: THREE.BufferGeometry,
  x: number,
  z: number,
  resolution: number,
  size: number,
): number {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const step = size / (resolution - 1);
  const gridX = THREE.MathUtils.clamp((x + size * 0.5) / step, 0, resolution - 1);
  const gridZ = THREE.MathUtils.clamp((z + size * 0.5) / step, 0, resolution - 1);
  const x0 = Math.min(Math.floor(gridX), resolution - 2);
  const z0 = Math.min(Math.floor(gridZ), resolution - 2);
  const tx = gridX - x0;
  const tz = gridZ - z0;
  const h10 = readVertexY(positions, resolution, x0 + 1, z0);
  const h01 = readVertexY(positions, resolution, x0, z0 + 1);
  if (tx + tz <= 1) {
    const h00 = readVertexY(positions, resolution, x0, z0);
    return h00 + tx * (h10 - h00) + tz * (h01 - h00);
  }
  const h11 = readVertexY(positions, resolution, x0 + 1, z0 + 1);
  return h11 + (1 - tx) * (h01 - h11) + (1 - tz) * (h10 - h11);
}

export function sampleTerrainMeshHeight(
  geometry: THREE.BufferGeometry,
  x: number,
  z: number,
  resolution: number,
  size: number,
): number {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const step = size / (resolution - 1);
  const half = size * 0.5;

  const gridX = (x + half) / step;
  const gridZ = (z + half) / step;

  const x0 = THREE.MathUtils.clamp(Math.floor(gridX), 0, resolution - 1);
  const z0 = THREE.MathUtils.clamp(Math.floor(gridZ), 0, resolution - 1);
  const x1 = Math.min(x0 + 1, resolution - 1);
  const z1 = Math.min(z0 + 1, resolution - 1);
  const tx = gridX - x0;
  const tz = gridZ - z0;

  const h00 = readVertexY(positions, resolution, x0, z0);
  const h10 = readVertexY(positions, resolution, x1, z0);
  const h01 = readVertexY(positions, resolution, x0, z1);
  const h11 = readVertexY(positions, resolution, x1, z1);

  const hBottom = THREE.MathUtils.lerp(h00, h10, tx);
  const hTop = THREE.MathUtils.lerp(h01, h11, tx);
  return THREE.MathUtils.lerp(hBottom, hTop, tz);
}

export function sampleTerrainMeshAttributeX(
  geometry: THREE.BufferGeometry,
  attributeName: string,
  x: number,
  z: number,
  resolution: number,
  size: number,
): number {
  const attribute = geometry.getAttribute(attributeName);
  if (!attribute) return 0;

  const step = size / (resolution - 1);
  const half = size * 0.5;
  const gridX = THREE.MathUtils.clamp((x + half) / step, 0, resolution - 1);
  const gridZ = THREE.MathUtils.clamp((z + half) / step, 0, resolution - 1);
  const x0 = Math.floor(gridX);
  const z0 = Math.floor(gridZ);
  const x1 = Math.min(x0 + 1, resolution - 1);
  const z1 = Math.min(z0 + 1, resolution - 1);
  const tx = gridX - x0;
  const tz = gridZ - z0;
  const valueAt = (xIndex: number, zIndex: number): number => (
    attribute.getX(zIndex * resolution + xIndex)
  );
  const bottom = THREE.MathUtils.lerp(valueAt(x0, z0), valueAt(x1, z0), tx);
  const top = THREE.MathUtils.lerp(valueAt(x0, z1), valueAt(x1, z1), tx);
  return THREE.MathUtils.lerp(bottom, top, tz);
}

function readVertexY(
  positions: THREE.BufferAttribute,
  resolution: number,
  xIndex: number,
  zIndex: number,
): number {
  return positions.array[(zIndex * resolution + xIndex) * 3 + 1] as number;
}
