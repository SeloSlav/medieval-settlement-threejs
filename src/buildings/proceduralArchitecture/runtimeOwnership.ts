import type * as THREE from 'three';

/** Explicit boundary between immutable architecture and simulation-owned props. */
export const PROCEDURAL_RUNTIME_OWNED_FLAG = 'proceduralRuntimeOwned';

export function markProceduralRuntimeOwned<T extends THREE.Object3D>(object: T): T {
  object.userData[PROCEDURAL_RUNTIME_OWNED_FLAG] = true;
  return object;
}

export function isProceduralRuntimeOwned(object: THREE.Object3D): boolean {
  return object.userData[PROCEDURAL_RUNTIME_OWNED_FLAG] === true;
}
