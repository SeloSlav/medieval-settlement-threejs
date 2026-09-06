import { MeshoptEncoder } from 'meshoptimizer/encoder';

/** Reorder whole triangles for the vertex cache, retaining original vertex IDs. */
export async function optimizeTriangleIndices(indices) {
  await MeshoptEncoder.ready;
  if (indices.length % 3) throw new Error('Only complete triangle lists can be reordered');
  const reordered = Uint32Array.from(indices);
  const [remap] = MeshoptEncoder.reorderMesh(reordered, true, false);
  const inverse = new Uint32Array(remap.length);
  for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff) inverse[remap[i]] = i;
  const result = new indices.constructor(indices.length);
  for (let i = 0; i < reordered.length; i++) result[i] = inverse[reordered[i]];
  return result;
}

export function vertexCacheMisses(indices, size = 32) {
  const cache = []; let misses = 0;
  for (const index of indices) {
    const at = cache.indexOf(index);
    if (at < 0) { misses++; if (cache.length === size) cache.pop(); }
    else cache.splice(at, 1);
    cache.unshift(index);
  }
  return misses;
}

/** Canonical oriented triangle set: preserves winding and duplicate faces. */
export function triangleSet(indices) {
  const triangles = [];
  for (let i = 0; i < indices.length; i += 3) {
    const rotations = [0, 1, 2].map(k => [indices[i+k], indices[i+(k+1)%3], indices[i+(k+2)%3]].join(','));
    triangles.push(rotations.sort()[0]);
  }
  return triangles.sort();
}
