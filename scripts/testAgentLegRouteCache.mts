import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {AgentLegRouteCache} from '../src/settlement/AgentLegRouteCache.ts';
import {routeAgentPolyline,routeAgentPolylineWithDeferredObstacle} from '../src/settlement/agentNavigation.ts';
import {FpCollisionWorld,StaticColliderIndex,type FpCollider} from '../src/camera/fp/fpCollisionWorld.ts';
import type {PointXZ} from '../src/utils/pathGeometry.ts';

const cache=new AgentLegRouteCache(32);let solves=0;
const a={x:-0,z:0},b={x:3,z:0};
const solve=()=>{solves++;return[{...a},{...b}];};
const first=cache.resolve(a,b,.28,solve)!;first[0]!.x=99;
const second=cache.resolve(a,b,.28,solve)!;assert(Object.is(second[0]!.x,-0));second[0]!.z=88;
assert.equal(cache.resolve(a,b,.28,solve)![0]!.z,0);assert.equal(solves,1);
cache.resolve({...a,x:0},b,.28,solve);assert.equal(solves,2,'signed-zero endpoints retain distinct keys');
cache.resolve(a,b,.4,solve);assert.equal(solves,3,'body radius is part of the key');
let failedSolves=0;
for(let i=0;i<3;i++)assert.equal(cache.resolve(b,a,.28,()=>{failedSolves++;return null;}),null);
assert.equal(failedSolves,1);cache.clear();assert.equal(cache.size,0);
cache.resolve(a,b,.28,solve);assert.equal(solves,4,'clear invalidates old static legs');
const bounded=new AgentLegRouteCache(2);
for(let i=0;i<5;i++)bounded.resolve({x:i,z:0},b,.28,()=>[]);
assert.equal(bounded.size,2);
let invalidSolves=0;
for(let i=0;i<2;i++)bounded.resolve({x:NaN,z:0},b,.28,()=>{invalidSolves++;return null;});
assert.equal(invalidSolves,2,'non-finite requests bypass the cache');

const index=new StaticColliderIndex();
index.add({shape:'box',centerX:0,centerZ:0,halfX:2,halfZ:8,yaw:.2,minY:0,maxY:3});
index.add({shape:'cylinder',x:8,z:12,radius:2,minY:0,maxY:3});
const legs=new AgentLegRouteCache();let radius=.28;
const blocked=(x:number,z:number)=>index.diskOverlaps(x,z,radius);
const segment=(start:PointXZ,end:PointXZ)=>index.segmentIsClear(start,end,radius);
let successes=0;
for(let i=0;i<150;i++) {
  radius=i%2?.28:.4;
  const path=[{x:-20,z:(i%5)*2},{x:20,z:(i%5)*2},{x:24,z:10+i*.1}];
  const expected=routeAgentPolyline(path,blocked,segment);
  const actual=routeAgentPolyline(path,blocked,segment,(start,end,solve)=>legs.resolve(start,end,radius,solve));
  assert.deepEqual(actual,expected);if(actual)successes++;
}
assert(successes>100,'parity corpus must cover reachable detours');assert(legs.hits>100);

let waterActive=false;
const world=new FpCollisionWorld({getStaticRoots:()=>[],getHeightAt:()=>0,
  isAgentNavigationBlocked:(x,z)=>waterActive&&Math.abs(x)<1&&Math.abs(z)<2,
  mayAgentNavigationPathBeBlocked:()=>true});
const path=[{x:-5,z:0},{x:5,z:0}];
assert.deepEqual(world.routeAgentPath(path),path);
waterActive=true;const wetRoute=world.routeAgentPath(path)!;
assert(wetRoute.length>2,'an unversioned moving hazard must replan a cached static leg');
assert.deepEqual(wetRoute,routeAgentPolylineWithDeferredObstacle(path,()=>false,
  (x,z)=>Math.abs(x)<1&&Math.abs(z)<2,()=>true,()=>true));
waterActive=false;assert.deepEqual(world.routeAgentPath(path),path);

const box=new THREE.Mesh(new THREE.BoxGeometry(4,4,16),new THREE.MeshBasicMaterial());box.position.y=2;
let roots:THREE.Object3D[]=[];
const staticWorld=new FpCollisionWorld({getStaticRoots:()=>roots,getHeightAt:()=>0});
const crossing=[{x:-20,z:0},{x:20,z:0}];assert.deepEqual(staticWorld.routeAgentPath(crossing),crossing);
roots=[box];staticWorld.invalidateStatic();assert(staticWorld.routeAgentPath(crossing)!.length>2);
roots=[];staticWorld.invalidateStatic();assert.deepEqual(staticWorld.routeAgentPath(crossing),crossing);
box.geometry.dispose();box.material.dispose();

const captureFile=process.argv[2];const captured=[];
if(captureFile) {
  const workload=JSON.parse(readFileSync(captureFile,'utf8'));
  for(const group of workload.groups) {
    const colliders=new StaticColliderIndex();for(const collider of group.colliders as FpCollider[])colliders.add(collider);
    const memo=new AgentLegRouteCache();
    const uncached=(colliders as unknown as {diskOverlapsUncached(x:number,z:number,r:number):boolean}).diskOverlapsUncached.bind(colliders);
    const run=(cached:boolean)=>{
      const started=performance.now();const routes=group.routes.map((route:{path:PointXZ[];radius:number})=>routeAgentPolyline(route.path,
        (x,z)=>cached?colliders.diskOverlaps(x,z,route.radius):uncached(x,z,route.radius),(a,b)=>colliders.segmentIsClear(a,b,route.radius),
        cached?(a,b,solve)=>memo.resolve(a,b,route.radius,solve):undefined));
      return{ms:performance.now()-started,routes};
    };
    const reference=run(false),actual=run(true);assert.deepEqual(actual.routes,reference.routes);
    captured.push({routes:reference.routes.length,reachable:reference.routes.filter(Boolean).length,referenceMs:reference.ms,
      cachedMs:actual.ms,hits:memo.hits,misses:memo.misses,entries:memo.size});
  }
}
console.log(JSON.stringify({syntheticCases:150,reachable:successes,staticLegHits:legs.hits,captured}));
