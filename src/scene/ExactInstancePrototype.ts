import type { BufferGeometry } from 'three';

// An authored owner explicitly identifies immutable base geometry. Instance
// attributes belong to each draw and are always copied from its live prefix.
const prototypes = new WeakMap<BufferGeometry, BufferGeometry>();
export function setExactInstancePrototype(geometry: BufferGeometry, prototype: BufferGeometry): void {
  prototypes.set(geometry, prototype);
}
export function exactInstancePrototype(geometry: BufferGeometry): BufferGeometry | undefined {
  return prototypes.get(geometry);
}
export function inheritExactInstancePrototype(geometry: BufferGeometry, source: BufferGeometry): void {
  const prototype = prototypes.get(source);
  if (prototype) prototypes.set(geometry, prototype);
}
