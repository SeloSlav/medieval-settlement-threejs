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
let steppedClock = false, fakeMs = 0;
const realm = new RealmTerrainStream(terrain, scene, () => steppedClock ? (fakeMs += 0.9) : performance.now());
const attached = (realm as unknown as { attached: Map<number, { mesh: THREE.Mesh }> }).attached;
const residentMeshes = () => [...attached.values()].map(tile => tile.mesh);
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
async function drain(paper = false) {
  for (let i = 0; i < 150; i++) {
    realm.update(100, 100, paper); await settle();
    if (!realm.stream.stats.loading && !realm.stream.stats.queued && !realm.stats.pendingRefreshes) break;
  }
  assert.equal(realm.stream.stats.loading, 0); assert.equal(realm.stream.stats.queued, 0);
  assert.equal(realm.stats.pendingRefreshes, 0);
}
await drain();
assert.equal(realm.stream.stats.resident, 81);
assert.equal(realm.stats.allocations, 81);
assert.equal(realm.stats.draws.draws, 9); assert.equal(realm.stats.draws.triangles, 81 * 512);
const center = attached.get(worldChunk(100, 100)!)!.mesh;
const sourceGeometry = center.geometry, sourcePosition = sourceGeometry.getAttribute('position');
assert(Math.abs(sourcePosition.getY(0) - 144) < 1e-5);
assert(Math.abs(sourceGeometry.getAttribute('mask').getX(0) - 128 / 255) < 1e-6, 'Normalized interleaved sources must retain their values');
const initialRefreshes = realm.stats.refreshes;
const initialChecks = realm.stats.tileChecks;
for (let i = 0; i < 100; i++) realm.update(100, 100, false);
assert.equal(realm.stats.refreshes, initialRefreshes, 'Idle frames must not upload or rebuild terrain');
assert.equal(realm.stats.tileChecks, initialChecks, 'Idle frames must not visit all resident tile attributes');
const idleVisits = realm.stats.tileChecks - initialChecks;

const originalMaterial = mesh.material, replacementMaterial = new THREE.MeshBasicMaterial({ color: 0x608040 });
mesh.material = replacementMaterial; realm.update(100, 100, false);
assert(residentMeshes().every(child => child.material === replacementMaterial), 'Material replacement must propagate without an attribute edit');
assert(realm.group.children[0].children.every(child => (child as THREE.Mesh).material === replacementMaterial), 'Spatial draws must observe the material swap');
assert.equal(realm.stats.tileChecks, initialChecks, 'A material swap does not resample heightfield attributes');
mesh.material = originalMaterial; realm.update(100, 100, false); replacementMaterial.dispose();

const buffers = new Map(residentMeshes().map(child => {
  const tile = child as THREE.Mesh;
  return [tile.name, { geometry: tile.geometry, version: (tile.geometry.getAttribute('position') as THREE.InterleavedBufferAttribute).data.version }];
}));
// A single source sample sits on a chunk boundary. Both adjacent chunks
// require interpolation support; distant resident chunks must stay untouched.
const vertex = 49 * resolution + 50;
position.setY(vertex, 777); position.clearUpdateRanges(); position.addUpdateRange(vertex * 3 + 1, 1); position.needsUpdate = true;
for (let i = 0; i < 10; i++) realm.update(100, 100, false);
let uploads = 0;
for (const child of residentMeshes()) {
  const tile = child as THREE.Mesh, before = buffers.get(tile.name)!;
  assert.equal(tile.geometry, before.geometry, 'Height edits must retain geometry, attributes and index allocation');
  if ((tile.geometry.getAttribute('position') as THREE.InterleavedBufferAttribute).data.version !== before.version) uploads++;
}
assert(uploads >= 2 && uploads <= 6, `A seam edit should update only its neighboring chunks, got ${uploads}`);
const seam = attached.get(worldChunk(256, 128)!)!.mesh;
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

// A deterministic two-tile budget proves that late tiles finish instead of
// revisiting the first tiles forever. A second edit arrives before completion.
steppedClock = true;
wet.array.fill(0.35); wet.clearUpdateRanges(); wet.needsUpdate = true;
const budgetStart = realm.stats.tileChecks;
realm.update(100, 100, false);
assert.equal(realm.stats.tileChecks - budgetStart, 2);
assert.equal(realm.stats.pendingRefreshes, 79);
wet.array.fill(0.625); wet.needsUpdate = true;
for (let frame = 0; frame < 45 && realm.stats.pendingRefreshes; frame++) realm.update(100, 100, false);
assert.equal(realm.stats.pendingRefreshes, 0, 'Every queued tile must finish within a finite number of frames');
for (const child of residentMeshes()) assert.equal(child.geometry.getAttribute('color').getX(0), 0.625);

// Detaching cancels pending work; returning refreshes the cached CPU buffers.
wet.array.fill(0.875); wet.needsUpdate = true; realm.update(100, 100, false);
assert(realm.stats.pendingRefreshes > 0); realm.update(100, 100, true);
assert.equal(realm.stats.pendingRefreshes, 0); assert.equal(realm.stream.stats.resident, 0);
steppedClock = false; await drain();
for (const child of residentMeshes()) assert.equal(child.geometry.getAttribute('color').getX(0), 0.875);
console.log(`Idle terrain frames: 100 × 81 resident tiles -> ${idleVisits} tile visits; budgeted edits reach all 81 tiles`);

const beforeLayout = realm.stats.allocations;
geometry.setAttribute('extraLayer', new THREE.BufferAttribute(new Uint16Array(count).fill(32768), 1, true));
await drain();
for (const child of residentMeshes()) {
  const value = (child as THREE.Mesh).geometry.getAttribute('extraLayer').getX(0);
  assert(Math.abs(value - 32768 / 65535) < 1e-7, 'Queued layout additions retain normalized values');
}
assert.equal(realm.stats.allocations - beforeLayout, 81, 'A changed layout rebuilds each resident tile exactly once');
geometry.deleteAttribute('extraLayer'); await drain();
assert(residentMeshes().every(child => !child.geometry.hasAttribute('extraLayer')));
assert.equal(realm.stats.allocations - beforeLayout, 162, 'Removing an attribute also propagates to late tiles');

let disposed = 0;
for (const child of residentMeshes()) child.geometry.addEventListener('dispose', () => disposed++);
realm.dispose(); assert.equal(disposed, 81); assert.equal(mesh.visible, true);
let gatesA = 0, gatesB = 0;
const firstTerrain = { setDirtZoomGate() { gatesA++; } } as unknown as Terrain;
const secondTerrain = { setDirtZoomGate() { gatesB++; } } as unknown as Terrain;
updateTerrainZoomBlend(firstTerrain, 100); updateTerrainZoomBlend(firstTerrain, 100);
updateTerrainZoomBlend(secondTerrain, 100);
assert.equal(gatesA, 1); assert.equal(gatesB, 1, 'Terrain zoom state must belong to each world instance');
mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
console.log('Realm terrain allocation reuse, local seam invalidation, normalized attributes, weather replacement, cached changes and disposal passed');
