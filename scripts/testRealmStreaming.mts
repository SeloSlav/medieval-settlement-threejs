import assert from 'node:assert/strict';
import { ChunkStream } from '../src/multiplayer/ChunkStream.ts';
import { FogOfWar } from '../src/multiplayer/FogOfWar.ts';
import { REALM, chunkBounds, realmRegionCenter, worldChunk } from '../src/multiplayer/realmPolicy.ts';

const disposed: number[] = [], attached = new Set<number>();
const releases = new Map<number, () => void>();
let loadCount = 0;
const stream = new ChunkStream({ capacity: 4, cacheCapacity: 2, concurrency: 2,
  load: async (id: number) => {
    loadCount++;
    await new Promise<void>(resolve => releases.set(id, resolve));
    return { dispose: () => disposed.push(id) };
  }, attach: id => attached.add(id), detach: id => attached.delete(id),
});
const settle = () => new Promise(resolve => setImmediate(resolve));
stream.setInterest([1, 2, 3, 4, 5]); stream.pump(2);
await settle();
assert.equal(stream.stats.loading, 2); assert.equal(stream.stats.queued, 2);
releases.get(1)!(); releases.get(2)!(); await settle();
assert.equal(attached.size, 0, 'Async loading must not attach outside the frame budget');
stream.pump(2); await settle();
assert.deepEqual([...attached], [2, 1]);
releases.get(3)!(); releases.get(4)!(); await settle(); stream.pump(2);
assert.equal(attached.size, 4);
stream.setInterest([2, 3]); stream.pump(2);
assert.equal(loadCount, 4, 'Resident chunks must not reload');
stream.setInterest([1, 4]); stream.pump(2);
assert.equal(loadCount, 4, 'Warm chunks must reattach from cache');
stream.setInterest([10, 11]); stream.pump(2); await settle();
stream.setInterest([20]);
releases.get(10)!(); releases.get(11)!(); await settle();
assert(disposed.includes(10) && disposed.includes(11), 'Cancelled late responses must release their resources');
stream.pump(2); await settle(); stream.dispose(); releases.get(20)!(); await settle();
assert.equal(attached.size, 0); assert(disposed.includes(20));
assert.equal(new Set(disposed).size, disposed.length, 'Dispose must be exactly once');

const fog = new FogOfWar();
const chunk = worldChunk(1, 1)!;
fog.apply([{ chunk, explored: 3n, visible: 1n }]);
assert.equal(fog.stateAt(1, 1), 'visible');
assert.equal(fog.stateAt(33, 1), 'explored');
assert.equal(fog.stateAt(65, 1), 'unexplored');
fog.disconnect(); assert.equal(fog.stateAt(1, 1), 'explored');
fog.apply([]); assert.equal(fog.stateAt(1, 1), 'unexplored');
assert.equal(worldChunk(-6144, -6144), 0); assert.equal(worldChunk(6144, 0), null);
for (let slot = 0; slot < 81; slot++) {
  const p = realmRegionCenter(slot), bounds = chunkBounds(worldChunk(p.x, p.z)!);
  assert(p.x >= bounds.minX && p.x < bounds.maxX && p.z >= bounds.minZ && p.z < bounds.maxZ);
  assert(Math.abs(p.x) + REALM.townRadius < REALM.size / 2);
}
console.log('Realm streaming, cancellation, bounded admission, resource disposal, fog and coordinate tests passed');
