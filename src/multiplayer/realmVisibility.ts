import * as THREE from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import { FogOfWar } from './FogOfWar.ts';
import { REALM_FOG_CELLS_PER_SIDE } from './realmPolicy.ts';
import { gameMode } from './gameMode.ts';
export const realmFog = new FogOfWar();
const bufferValues = new Uint32Array(REALM_FOG_CELLS_PER_SIDE ** 2);
export const realmFogBuffer = new StorageBufferAttribute(bufferValues, 1);
export function uploadRealmFog(): void {
  bufferValues.set(realmFog.pixels);
  realmFogBuffer.needsUpdate = true;
}
let texture: THREE.DataTexture | null = null;
export function realmFogTexture(): THREE.DataTexture {
  if (!texture) {
    texture = new THREE.DataTexture(realmFog.pixels, REALM_FOG_CELLS_PER_SIDE, REALM_FOG_CELLS_PER_SIDE, THREE.RedFormat);
    texture.name = 'Server-authoritative realm visibility';
    texture.minFilter = THREE.NearestFilter; texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false; texture.needsUpdate = true;
  }
  return texture;
}
export function isWorldPointExplored(x: number, z: number): boolean {
  return gameMode() !== 'multiplayer' || realmFog.stateAt(x, z) !== 'unexplored';
}
export function isWorldPointVisible(x: number, z: number): boolean {
  return gameMode() !== 'multiplayer' || realmFog.stateAt(x, z) === 'visible';
}
