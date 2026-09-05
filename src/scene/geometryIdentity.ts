import type * as THREE from 'three';

function arrays(geometry: THREE.BufferGeometry): ArrayBufferView[] {
  return [geometry.index?.array, ...Object.keys(geometry.attributes).sort().map(name => geometry.getAttribute(name).array)]
    .filter((array): array is NonNullable<typeof array> => !!array);
}

export function geometryFingerprint(geometry: THREE.BufferGeometry): string {
  let hash = 0x811c9dc5, length = 0;
  for (const array of arrays(geometry)) {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    length += bytes.length;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193);
  }
  return `${length}:${hash >>> 0}`;
}

/** Hashes only select candidates; exact structure and byte equality decide reuse. */
export function geometryEqualsGeometry(a: THREE.BufferGeometry, b: THREE.BufferGeometry): boolean {
  const names = Object.keys(a.attributes).sort(), other = Object.keys(b.attributes).sort();
  if (names.join('|') !== other.join('|') || !!a.index !== !!b.index) return false;
  for (const name of names) {
    const x = a.getAttribute(name), y = b.getAttribute(name);
    if (x.itemSize !== y.itemSize || x.normalized !== y.normalized || x.array.constructor !== y.array.constructor
      || (x as THREE.BufferAttribute).gpuType !== (y as THREE.BufferAttribute).gpuType) return false;
  }
  if (a.drawRange.start !== b.drawRange.start || a.drawRange.count !== b.drawRange.count
    || JSON.stringify(a.groups) !== JSON.stringify(b.groups)) return false;
  const left = arrays(a), right = arrays(b);
  return left.every((array, i) => {
    const target = right[i]!;
    if (array.byteLength !== target.byteLength) return false;
    const x = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const y = new Uint8Array(target.buffer, target.byteOffset, target.byteLength);
    return x.every((byte, j) => byte === y[j]);
  });
}
