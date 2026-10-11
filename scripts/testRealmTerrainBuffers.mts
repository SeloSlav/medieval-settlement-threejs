import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { Terrain } from '../src/terrain/Terrain.ts';
import { RealmTerrainStream } from '../src/multiplayer/RealmTerrainStream.ts';
import { REALM, worldChunk } from '../src/multiplayer/realmPolicy.ts';
import { updateTerrainZoomBlend } from '../src/grass/GrassLodConfig.ts';

const resolution = 97, count = resolution ** 2;
const geometry = new THREE.BufferGeometry();
const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
const bytes = new Uint8Array(count * 2);
for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) {
  const i = z * resolution + x;
  positions.set([x * 128 - REALM.size / 2, x + z * 2, z * 128 - REALM.size / 2], i * 3);
  colors.set([0.2, 0.4, 0.6], i * 3); bytes.set([128, 255], i * 2);
}
const position = new THREE.BufferAttribute(positions, 3);
geometry.setAttribute('position', position);
geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
const masks = new THREE.InterleavedBuffer(bytes, 2);
geometry.setAttribute('mask', new THREE.InterleavedBufferAttribute(masks, 1, 0, true));
geometry.setAttribute('secondMask', new THREE.InterleavedBufferAttribute(masks, 1, 1, true));
const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
const terrain = { resolution, mesh } as unknown as Terrain;
const scene = new THREE.Scene(); scene.add(mesh);
const realm = new RealmTerrainStream(terrain, scene);
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
async function drain(paper = false) {
  for (let i = 0; i < 150; i++) {
    realm.update(100, 100, paper); await settle();
    if (!realm.stream.stats.loading && !realm.stream.stats.queued) break;
  }
  assert.equal(realm.stream.stats.loading, 0); assert.equal(realm.stream.stats.queued, 0);
}
await drain();
assert.equal(realm.stream.stats.resident, 81);
assert.equal(realm.stats.allocations, 81);
const center = realm.group.getObjectByName(`Realm terrain chunk ${worldChunk(100, 100)}`) as THREE.Mesh;
const sourceGeometry = center.geometry, sourcePosition = sourceGeometry.getAttribute('position');
assert(Math.abs(sourcePosition.getY(0) - 144) < 1e-5);
assert(Math.abs(sourceGeometry.getAttribute('mask').getX(0) - 128 / 255) < 1e-6, 'Normalized interleaved sources must retain their values');
const initialRefreshes = realm.stats.refreshes;
for (let i = 0; i < 100; i++) realm.update(100, 100, false);
assert.equal(realm.stats.refreshes, initialRefreshes, 'Idle frames must not upload or rebuild terrain');

const buffers = new Map(realm.group.children.map(child => {
  const tile = child as THREE.Mesh;
  return [tile.name, { geometry: tile.geometry, version: (tile.geometry.getAttribute('position') as THREE.InterleavedBufferAttribute).data.version }];
}));
// A single source sample sits on a chunk boundary. Both adjacent chunks
// require interpolation support; distant resident chunks must stay untouched.
const vertex = 49 * resolution + 50;
position.setY(vertex, 777); position.clearUpdateRanges(); position.addUpdateRange(vertex * 3 + 1, 1); position.needsUpdate = true;
for (let i = 0; i < 10; i++) realm.update(100, 100, false);
let uploads = 0;
for (const child of realm.group.children) {
  const tile = child as THREE.Mesh, before = buffers.get(tile.name)!;
  assert.equal(tile.geometry, before.geometry, 'Height edits must retain geometry, attributes and index allocation');
  if ((tile.geometry.getAttribute('position') as THREE.InterleavedBufferAttribute).data.version !== before.version) uploads++;
}
assert(uploads >= 2 && uploads <= 6, `A seam edit should update only its neighboring chunks, got ${uploads}`);
const seam = realm.group.getObjectByName(`Realm terrain chunk ${worldChunk(256, 128)}`) as THREE.Mesh;
assert.equal(seam.geometry.getAttribute('position').getY(8 * 17), 777);
assert.equal(realm.stats.allocations, 81);

// Replacing a version-zero attribute used to evade string-version tracking.
const wet = new THREE.BufferAttribute(new Float32Array(count * 3).fill(0.75), 3);
geometry.setAttribute('color', wet);
for (let i = 0; i < 20; i++) realm.update(100, 100, false);
assert.equal(center.geometry.getAttribute('color').getX(0), 0.75);
assert.equal(center.geometry, sourceGeometry); assert.equal(center.geometry.getAttribute('position'), sourcePosition);
await drain(true); assert.equal(realm.stream.stats.resident, 0);
const misses = realm.stream.stats.misses;
wet.array.fill(0.125); wet.clearUpdateRanges(); wet.needsUpdate = true;
await drain();
assert.equal(realm.stream.stats.misses, misses, 'Returning to a changed cached tile must reuse its allocation');
assert.equal(center.geometry.getAttribute('color').getX(0), 0.125);
assert.equal(realm.stats.allocations, 81);

// If two writes occur between frames, the last range cannot describe both.
position.setY(48 * resolution + 48, 900); position.needsUpdate = true;
position.setY(vertex, 888); position.clearUpdateRanges(); position.addUpdateRange(vertex * 3 + 1, 1); position.needsUpdate = true;
for (let i = 0; i < 20; i++) realm.update(100, 100, false);
assert.equal(center.geometry.getAttribute('position').getY(0), 900);
assert.equal(seam.geometry.getAttribute('position').getY(8 * 17), 888);
assert(center.geometry.boundingBox!.max.y >= 900, 'Changed positions must update culling bounds');

let disposed = 0;
for (const child of realm.group.children) (child as THREE.Mesh).geometry.addEventListener('dispose', () => disposed++);
realm.dispose(); assert.equal(disposed, 81); assert.equal(mesh.visible, true);
let gatesA = 0, gatesB = 0;
const firstTerrain = { setDirtZoomGate() { gatesA++; } } as unknown as Terrain;
const secondTerrain = { setDirtZoomGate() { gatesB++; } } as unknown as Terrain;
updateTerrainZoomBlend(firstTerrain, 100); updateTerrainZoomBlend(firstTerrain, 100);
updateTerrainZoomBlend(secondTerrain, 100);
assert.equal(gatesA, 1); assert.equal(gatesB, 1, 'Terrain zoom state must belong to each world instance');
mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
console.log('Realm terrain allocation reuse, local seam invalidation, normalized attributes, weather replacement, cached changes and disposal passed');
