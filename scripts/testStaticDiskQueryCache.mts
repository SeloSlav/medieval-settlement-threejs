import assert from 'node:assert/strict';
import {StaticColliderIndex,type FpCollider} from '../src/camera/fp/fpCollisionWorld.ts';

const index=new StaticColliderIndex();
const colliders:FpCollider[]=[{shape:'box',centerX:-8,centerZ:-8,halfX:3,halfZ:4,yaw:.27,minY:0,maxY:4},
  {shape:'box',centerX:8,centerZ:8,halfX:.025,halfZ:8,yaw:Math.PI/4,minY:0,maxY:4},
  {shape:'cylinder',x:-16,z:16,radius:2,minY:0,maxY:4}];
for(const collider of colliders)index.add(collider);
const original=(index as unknown as {diskOverlapsUncached(x:number,z:number,radius:number):boolean}).diskOverlapsUncached.bind(index);
let seed=29,comparisons=0;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return(seed>>>0)/2**32;};
for(let i=0;i<20_000;i++) {
  const x=(random()-.5)*64,z=(random()-.5)*64,r=random();
  const expected=original(x,z,r);assert.equal(index.diskOverlaps(x,z,r),expected);assert.equal(index.diskOverlaps(x,z,r),expected);comparisons+=2;
}
for(const x of [-16,-8,0,8,16])for(const z of [-16,-8,-0,0,8,16])for(const radius of [0,.28,2]) {
  assert.equal(index.diskOverlaps(x,z,radius),original(x,z,radius));comparisons++;
}
assert(index.diskQueryHits>=20_000);
assert.equal(index.diskOverlaps(0,0,.28),false);
index.add({shape:'cylinder',x:0,z:0,radius:1,minY:0,maxY:4});assert.equal(index.diskOverlaps(0,0,.28),true,'adding obstacles invalidates cached clearance');
index.clear();assert.equal(index.diskOverlaps(0,0,.28),false,'clearing obstacles invalidates cached overlap');
for(let i=0;i<70_000;i++)index.diskOverlaps(i,0,.28);
const entries=(index as unknown as {diskQueryEntries:number}).diskQueryEntries;assert(entries<=65536,'cache storage stays bounded');
console.log(JSON.stringify({comparisons,hits:index.diskQueryHits,entries}));
