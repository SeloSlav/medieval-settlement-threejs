import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {StaticColliderIndex,type FpCollider} from './src/camera/fp/fpCollisionWorld.ts';
import {routeAgentPolyline} from './src/settlement/agentNavigation.ts';
const workload=JSON.parse(readFileSync('artifacts/realm-browser-indexed-clearance-ui-diagnostic/navigation-workload.json','utf8'));
for(const group of workload.groups) {
  const index=new StaticColliderIndex();for(const collider of group.colliders as FpCollider[])index.add(collider);
  const seen=new Set();const routes=group.routes.filter(route=>{const key=JSON.stringify(route);if(seen.has(key))return false;seen.add(key);return true;});
  const memo=new Map<number,Map<number,Map<number,boolean>>>();let hits=0,misses=0,size=0;
  const cached=(x:number,z:number,r:number)=>{
    let plane=memo.get(r),row=plane?.get(x);const previous=row?.get(z);if(previous!==undefined){hits++;return previous;}
    misses++;const value=index.diskOverlaps(x,z,r);
    if(size>=65536){memo.clear();size=0;plane=undefined;row=undefined;}
    if(!plane){plane=new Map();memo.set(r,plane);}if(!row){row=new Map();plane.set(x,row);}row.set(z,value);size++;return value;
  };
  function run(query:(x:number,z:number,r:number)=>boolean) {
    const start=performance.now();const output=routes.map(route=>routeAgentPolyline(route.path,(x,z)=>query(x,z,route.radius),(a,b)=>index.segmentIsClear(a,b,route.radius)));
    return{ms:performance.now()-start,output};
  }
  const original=run((x,z,r)=>index.diskOverlaps(x,z,r));const cachedRun=run(cached);
  assert.deepEqual(cachedRun.output,original.output);
  console.log(JSON.stringify({routes:routes.length,originalMs:original.ms,cachedMs:cachedRun.ms,hits,misses,size,reachable:original.output.filter(Boolean).length}));
}
