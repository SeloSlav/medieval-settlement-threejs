import assert from 'node:assert/strict';
import { MathUtils } from 'three';
import { HorizonWaterPathIndex,type HorizonWaterPath,type HorizonWaterPoint } from '../src/terrain/HorizonWaterPathIndex.ts';

// Retain the original exhaustive sampler as a numerical reference.
function reference(paths: readonly HorizonWaterPath[],x: number,z: number) {
  let best: {distance:number;halfWidth:number;channelDepth:number;surfaceY:number} | null = null;
  for (const path of paths) for (let i=0;i<path.points.length-1;i++) {
    const a=path.points[i]!,b=path.points[i+1]!;
    const vx=b.x-a.x,vz=b.z-a.z,lengthSquared=vx*vx+vz*vz;
    const t=lengthSquared<=1e-6?0:MathUtils.clamp(((x-a.x)*vx+(z-a.z)*vz)/lengthSquared,0,1);
    const px=MathUtils.lerp(a.x,b.x,t),pz=MathUtils.lerp(a.z,b.z,t);
    const distance=Math.hypot(x-px,z-pz);
    if(best&&distance>=best.distance)continue;
    best={distance,halfWidth:MathUtils.lerp(a.halfWidth,b.halfWidth,t),
      channelDepth:MathUtils.lerp(a.channelDepth,b.channelDepth,t),surfaceY:MathUtils.lerp(a.surfaceY,b.surfaceY,t)};
  }
  return best;
}
const carve = (sample:ReturnType<typeof reference>) => sample&&sample.distance<sample.halfWidth*.86?sample:null;
const point = (x:number,z:number,width:number,surfaceY=8):HorizonWaterPoint => ({x,z,halfWidth:width,surfaceY,channelDepth:4});
const competitors:HorizonWaterPath[]=[
  {points:[point(-1000,130,100),point(1000,130,100)]},
  {points:[point(-1000,100,2),point(1000,100,2)]},
];
const narrowWinner=new HorizonWaterPathIndex(competitors);
assert.equal(carve(reference(competitors,0,80)),null);
assert.equal(carve(narrowWinner.sample(0,80)),null,'nearest narrow channel suppresses farther wide carving');
const paths:HorizonWaterPath[]=[...competitors,
  {points:[point(-128,-128,28,3),point(128,128,2,9)]},
  {points:[point(-128,128,28,5),point(128,-128,2,15)]},
  {points:[point(0,0,6,17),point(0,0,6,17)]},
  {points:[point(100,100,0),point(200,100,0)]},
];
for(let k=0;k<4;k++) {
  const points:HorizonWaterPoint[]=[];
  for(let i=0;i<500;i++)points.push(point(-7000+i*28,Math.sin(i*.019+k)*800+k*850,2+(i%31),100-i*.02));
  paths.push({points});
}
const index=new HorizonWaterPathIndex(paths);
let comparisons=0;
function compare(x:number,z:number) {
  assert.deepEqual(carve(index.sample(x,z)),carve(reference(paths,x,z)),`carving at ${x},${z}`); comparisons++;
}
let seed=17;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return(seed>>>0)/2**32;};
for(let i=0;i<10_000;i++)compare((random()-.5)*18_000,(random()-.5)*18_000);
for(const path of paths) for(const a of path.points) {
  for(const delta of [-1e-6,0,1e-6]) {
    compare(a.x+a.halfWidth*.86+delta,a.z);
    compare(Math.floor(a.x/128)*128+delta,Math.floor(a.z/128)*128+delta);
  }
}
for(const x of [NaN,Infinity,-Infinity])for(const z of [0,NaN,Infinity,-Infinity])compare(x,z);
assert.equal(new HorizonWaterPathIndex([]).sample(0,0),null);
const queries=Array.from({length:20_000},()=>[(random()-.5)*18_000,(random()-.5)*18_000] as const);
function measure(sample:(x:number,z:number)=>ReturnType<typeof reference>) {
  let count=0; const start=performance.now();
  for(const [x,z] of queries)if(carve(sample(x,z)))count++;
  return {ms:performance.now()-start,carved:count};
}
const exhaustive=measure((x,z)=>reference(paths,x,z)),indexed=measure((x,z)=>index.sample(x,z));
assert.equal(indexed.carved,exhaustive.carved);
console.log(JSON.stringify({comparisons,queries:queries.length,exhaustive,indexed}));
