import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import type { RoadEdge } from '../src/roads/RoadEdge.ts';
import type { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import { RoadClearanceIndex } from '../src/roads/RoadClearanceIndex.ts';
import { collectRoadRemovedRockIndices } from '../src/roads/roadRockClearance.ts';
import { distancePointToPolylineXZ,isRockNearPath } from '../src/utils/pathGeometry.ts';

let nextId=0;
const edge=(points:Vector3[],width:number,sampledPath=points):RoadEdge=>({id:String(nextId++),startNodeId:'a',endNodeId:'b',controlPoints:points,sampledPath,width,length:0,editableState:'normal',revision:0});
const roads=[
  edge([new Vector3(-1000,0,-128),new Vector3(1000,0,-128)],7.6),
  edge([new Vector3(-500,0,-500),new Vector3(500,0,500)],4),
  edge([new Vector3(0,0,0),new Vector3(0,0,0)],3),
  edge([new Vector3(100,0,-100),new Vector3(600,0,-100)],1,[]),
  edge([new Vector3(100,0,500)],2),
];
for(let k=0;k<8;k++)roads.push(edge(Array.from({length:500},(_,i)=>new Vector3(-6144+i*24,0,Math.sin(i*.02+k)*300+k*640-2500)),2+k*.8));
function reference(x:number,z:number,margin:number,extra=0,source=roads) {
  return source.some(road=>{const path=road.sampledPath.length>=2?road.sampledPath:road.controlPoints;
    return path.length>=2&&distancePointToPolylineXZ(x,z,path)<=road.width*.5+margin+extra;});
}
const index=new RoadClearanceIndex(roads);let comparisons=0,seed=21;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return(seed>>>0)/2**32;};
function compare(x:number,z:number,margin:number,extra=0) {
  assert.equal(index.isNear(x,z,margin,extra),reference(x,z,margin,extra),`at ${x},${z} margin ${margin}+${extra}`);comparisons++;
}
for(let i=0;i<10_000;i++)compare((random()-.5)*14_000,(random()-.5)*14_000,random()*15,random()*.95);
for(const road of roads)for(const p of road.controlPoints)for(const margin of [.95,4.1,15,32])for(const delta of [-1e-7,0,1e-7]) {
  compare(p.x,p.z+road.width*.5+margin+delta,margin);
  compare(Math.floor(p.x/128)*128+delta,Math.floor(p.z/128)*128+delta,margin);
}
for(const x of [NaN,Infinity,-Infinity])for(const margin of [.95,NaN,Infinity,-Infinity])compare(x,0,margin);
// Preserve left-to-right tree/rock threshold arithmetic at exact boundaries.
for(const scale of [.1,.3,.6,1,1.7,3,20])for(const extra of [.8,1.35])for(const delta of [-1e-12,0,1e-12]) {
  const margin=scale*4.1;compare(0,-128+(7.6*.5+margin+extra)+delta,margin,extra);
}
const invalidRoads=[edge([new Vector3(-1,0,0),new Vector3(1,0,0),new Vector3(NaN,0,3)],4),
  edge([new Vector3(-1,0,0),new Vector3(1,0,0)],NaN),edge([new Vector3(-1,0,2),new Vector3(1,0,2)],Infinity)];
const invalidIndex=new RoadClearanceIndex(invalidRoads);
for(const x of [0,5,Infinity,NaN])for(const margin of [0,.95,Infinity,-Infinity]) {
  assert.equal(invalidIndex.isNear(x,0,margin),reference(x,0,margin,0,invalidRoads));comparisons++;
}
const rocks=Array.from({length:500},()=>({x:(random()-.5)*14_000,z:(random()-.5)*14_000,scale:random()*20}));
const expectedRockIds=new Set(rocks.flatMap((rock,i)=>roads.some(road=>{const path=road.sampledPath.length>=2?road.sampledPath:road.controlPoints;
  return path.length>=2&&isRockNearPath(rock,path,road.width*.5);})?[i]:[]));
assert.deepEqual(collectRoadRemovedRockIndices(rocks,{edges:new Map(roads.map(road=>[road.id,road]))} as RoadNetwork),expectedRockIds);
assert.equal(new RoadClearanceIndex([]).isNear(0,0,.95),false);
const queries=Array.from({length:20_000},()=>[(random()-.5)*14_000,(random()-.5)*14_000] as const);
function measure(sample:(x:number,z:number)=>boolean) {const start=performance.now();let blocked=0;
  for(const [x,z]of queries)if(sample(x,z))blocked++;return{ms:performance.now()-start,blocked};}
const exhaustive=measure((x,z)=>reference(x,z,.95)),indexed=measure((x,z)=>index.isNear(x,z,.95));
assert.equal(indexed.blocked,exhaustive.blocked);
console.log(JSON.stringify({comparisons,queries:queries.length,exhaustive,indexed,clearedRocks:expectedRockIds.size}));
