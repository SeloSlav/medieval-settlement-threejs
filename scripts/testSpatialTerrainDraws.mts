import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SpatialTerrainDraws, type TerrainDrawTile } from '../src/multiplayer/SpatialTerrainDraws.ts';
import { REALM_CHUNKS_PER_SIDE } from '../src/multiplayer/realmPolicy.ts';

const material = new THREE.MeshBasicMaterial();
const draws = new SpatialTerrainDraws(material);
const sources = new Map<number, TerrainDrawTile>();
function tile(id: number, extra = false): TerrainDrawTile {
  const stride = extra ? 9 : 8, data = new Float32Array(4 * stride);
  const x = (id % REALM_CHUNKS_PER_SIDE) * 256 - 6144, z = Math.floor(id / REALM_CHUNKS_PER_SIDE) * 256 - 6144;
  const corners = [[x,z],[x+256,z],[x,z+256],[x+256,z+256]];
  for (let i = 0; i < 4; i++) {
    data.set([corners[i][0], id / 10 + i, corners[i][1], .2+i/10, .4, .7, .5, .9], i * stride);
    if (extra) data[i * stride + 8] = .625;
  }
  const buffer = new THREE.InterleavedBuffer(data, stride);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
  geometry.setAttribute('color', new THREE.InterleavedBufferAttribute(buffer, 3, 3));
  geometry.setAttribute('mask', new THREE.InterleavedBufferAttribute(buffer, 2, 6));
  if (extra) geometry.setAttribute('extraLayer', new THREE.InterleavedBufferAttribute(buffer, 1, 8));
  geometry.setIndex([0,2,1,1,2,3]); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return { mesh: new THREE.Mesh(geometry, material), buffer };
}
type Debug = { entries: Map<number, { slot: number; cell: { mesh: THREE.Mesh; buffer: THREE.InterleavedBuffer; vertexCount: number; indexCount: number } }> };
const debug = draws as unknown as Debug;
let byteComparisons = 0;
function parity() {
  draws.flush();
  assert.equal(draws.stats.chunks, sources.size);
  assert.equal(draws.stats.triangles, sources.size * 2);
  for (const [id, source] of sources) {
    const entry = debug.entries.get(id)!;
    const count = source.buffer.array.length, start = entry.slot * count;
    const actual = new Uint32Array(entry.cell.buffer.array.buffer, start * 4, count);
    const expected = new Uint32Array(source.buffer.array.buffer, 0, count);
    assert.deepEqual(actual, expected, `Exact float bytes for chunk ${id}`); byteComparisons += count;
    const index = entry.cell.mesh.geometry.index!, original = source.mesh.geometry.index!;
    for (let i = 0; i < original.count; i++) {
      assert.equal(index.getX(entry.slot * original.count + i) - entry.slot * entry.cell.vertexCount, original.getX(i));
    }
    assert(entry.cell.mesh.geometry.boundingBox!.containsBox(source.mesh.geometry.boundingBox!));
  }
}
for (let z = 20; z < 29; z++) for (let x = 20; x < 29; x++) {
  const id = z * REALM_CHUNKS_PER_SIDE + x, source = tile(id);
  sources.set(id, source); draws.upsert(id, source); parity();
}
assert.equal(draws.stats.draws, 9);
const unchanged = { ...draws.stats };
for (const [id, source] of sources) draws.upsert(id, source);
draws.flush(); assert.deepEqual(draws.stats, unchanged, 'Unchanged tiles must not copy or allocate');

const ids = [...sources.keys()];
for (let i = 0; i < ids.length; i += 5) {
  const id = ids[i], source = sources.get(id)!;
  source.mesh.geometry.getAttribute('position').setY(2, 1000+i); source.buffer.needsUpdate = true;
  source.mesh.geometry.computeBoundingBox(); draws.upsert(id, source); parity();
}
// A replacement can have the same version as the former buffer.
const replacementId = ids[0], source = sources.get(replacementId)!;
const sameVersion = source.buffer.version;
source.buffer = new THREE.InterleavedBuffer(source.buffer.array.slice(), source.buffer.stride);
source.buffer.version = sameVersion;
source.buffer.array[1] = -700;
for (const attr of Object.values(source.mesh.geometry.attributes)) (attr as THREE.InterleavedBufferAttribute).data = source.buffer;
source.mesh.geometry.computeBoundingBox(); draws.upsert(replacementId, source); parity();

for (let i = 2; i < ids.length; i += 3) { draws.remove(ids[i]); sources.get(ids[i])!.mesh.geometry.dispose(); sources.delete(ids[i]); parity(); }
for (const id of ids.filter(id => !sources.has(id))) { const source = tile(id); sources.set(id, source); draws.upsert(id, source); parity(); }
// Mixed layouts during a budgeted update keep every old and new tile drawable.
for (const id of ids) {
  sources.get(id)!.mesh.geometry.dispose(); const source = tile(id, true);
  sources.set(id, source); draws.upsert(id, source); parity();
}
assert.equal(draws.stats.draws, 9);
const nextMaterial = new THREE.MeshBasicMaterial({color:0x123456}); draws.setMaterial(nextMaterial);
assert(draws.group.children.every(mesh => (mesh as THREE.Mesh).material === nextMaterial));
let released = 0;
const allocationsBeforeReturn = draws.stats.allocations;
for (const mesh of draws.group.children) (mesh as THREE.Mesh).geometry.addEventListener('dispose', () => released++);
for (const id of ids) draws.remove(id);
draws.flush(); assert.equal(draws.stats.draws, 0); assert.equal(draws.stats.chunks, 0); assert.equal(released, 0);
assert(draws.stats.cachedSlots <= 128);
for (const [id, source] of sources) draws.upsert(id, source);
parity(); assert.equal(draws.stats.allocations, allocationsBeforeReturn); assert(draws.stats.cacheHits >= 9);
draws.dispose(); assert.equal(released, 9);
for (const source of sources.values()) source.mesh.geometry.dispose();

const bounded = new SpatialTerrainDraws(material); let expired = 0;
for (let i = 0; i < 80; i++) {
  const id = Math.floor(i / 12) * 4 * REALM_CHUNKS_PER_SIDE + (i % 12) * 4;
  const source = tile(id); bounded.upsert(id, source); bounded.flush();
  (bounded.group.children[0] as THREE.Mesh).geometry.addEventListener('dispose', () => expired++);
  bounded.remove(id); source.mesh.geometry.dispose(); assert(bounded.stats.cachedSlots <= 128);
}
assert.equal(expired, 48, 'Old cells must be evicted at the bounded GPU cache limit');
bounded.dispose(); assert.equal(expired, 80, 'Every allocation must be released exactly once');
material.dispose(); nextMaterial.dispose();
console.log(JSON.stringify({ byteComparisons, chunks:81, draws:9, exactIndices:true, mixedLayouts:true, released }));
