import assert from 'node:assert/strict';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';

const navigation={resolution:16,startX:0,startZ:0,spanX:15,spanZ:15,
  wetCellsHex:'00'.repeat(32),heights:Array.from({length:256},(_,i)=>i)};
const descriptor=Object.getOwnPropertyDescriptor(globalThis,'window');
const location={search:'?mode=single'};
Object.defineProperty(globalThis,'window',{value:{location},configurable:true});
try {
  const network=new RoadNetwork();
  network.setRiverNavigation(navigation);
  const single=network.snapshot();
  assert.equal(single.riverNavigation,navigation,'Single-player must publish its generated terrain');
  location.search='?mode=multiplayer';
  const realm=network.snapshot();
  assert(!('riverNavigation' in realm),'Realm road snapshots must omit duplicate terrain');
  assert(JSON.stringify(realm).length<JSON.stringify(single).length/2);
  network.restore(realm);
  location.search='?mode=single';
  assert.equal(network.snapshot().riverNavigation,navigation,'Restoring geometry must retain the local terrain reference');
  console.log('Realm geometry-only road snapshots and single-player terrain retention passed');
} finally {
  if (descriptor) Object.defineProperty(globalThis,'window',descriptor);
  else Reflect.deleteProperty(globalThis,'window');
}
