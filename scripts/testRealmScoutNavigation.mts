/** Inspect server-owned paths and observe real movement in the populated local realm. */
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { DbConnection } from '../src/generated/index.ts';
import { getBuildingFootprintCorners } from '../src/buildings/BuildingTerrainLayout.ts';
import type { BuildingKind } from '../src/resources/types.ts';

const uri=process.env.REALM_TEST_URI||'http://127.0.0.1:3100';
const database=process.env.REALM_TEST_DB||'city-builder-realm-loadtest';
assert(['localhost','127.0.0.1','[::1]'].includes(new URL(uri).hostname));
const saved=JSON.parse(readFileSync('.tmp-realm-test-clients.json','utf8'));
assert.equal(saved.database,database);
const {token:publisher}=JSON.parse(readFileSync('.tmp-realm-publisher/identity.json','utf8'));
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function sql(query:string):Promise<any[][]> {
  const response=await fetch(`${uri}/v1/database/${database}/sql`,{method:'POST',
    headers:{Authorization:`Bearer ${publisher}`},body:query,signal:AbortSignal.timeout(15000)});
  assert(response.ok,`Local inspection failed: ${response.status}`);
  return (await response.json())[0].rows;
}
async function connect(token:string):Promise<DbConnection> {
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Navigation client timed out')),30000);
    DbConnection.builder().withUri(uri).withDatabaseName(database).withToken(token)
      .onConnect(c=>c.subscriptionBuilder().onApplied(()=>{clearTimeout(timeout);resolve(c);})
        .onError(ctx=>{clearTimeout(timeout);reject(ctx.event);})
        .subscribe(['my_realm_member','my_realm_scout','visible_residence','visible_settlement'].map(t=>`SELECT * FROM ${t}`)))
      .onConnectError((_c,e)=>{clearTimeout(timeout);reject(e);}).build();
  });
}
type Point=[number,number];
type Obstacle={x:number;z:number;ux:number;uz:number;hx:number;hz:number};
const obstacles:Obstacle[]=[];
for (const [,kind,x,z,yaw] of await sql('SELECT id,kind,x,z,placement_yaw FROM building')) {
  const corners=getBuildingFootprintCorners(kind as BuildingKind,x,z,yaw);
  const dx=corners[1].x-corners[0].x,dz=corners[1].z-corners[0].z,length=Math.hypot(dx,dz);
  obstacles.push({x,z,ux:dx/length,uz:dz/length,hx:length/2+0.55,
    hz:Math.hypot(corners[2].x-corners[1].x,corners[2].z-corners[1].z)/2+0.55});
}
for (const [,x,z,yaw] of await sql('SELECT id,x,z,yaw FROM residence')) {
  obstacles.push({x,z,ux:Math.cos(yaw),uz:-Math.sin(yaw),hx:3.85,hz:4.25});
}
function local(point:Point,o:Obstacle):Point {
  const x=point[0]-o.x,z=point[1]-o.z;
  return [x*o.ux+z*o.uz,-x*o.uz+z*o.ux];
}
function inside(point:Point,o:Obstacle):boolean {
  const p=local(point,o);return Math.abs(p[0])<o.hx-1e-5&&Math.abs(p[1])<o.hz-1e-5;
}
function assertClearSegment(start:Point,end:Point):void {
  for(const o of obstacles) {
    if(inside(start,o))continue; // A newly built structure may cover an existing unit.
    const a=local(start,o),b=local(end,o);let near=0,far=1;
    for(const [origin,delta,half] of [[a[0],b[0]-a[0],o.hx-1e-5],[a[1],b[1]-a[1],o.hz-1e-5]]) {
      if(Math.abs(delta)<1e-5) {if(Math.abs(origin)>=half){near=2;break;}}
      else {const t0=(-half-origin)/delta,t1=(half-origin)/delta;near=Math.max(near,Math.min(t0,t1));far=Math.min(far,Math.max(t0,t1));}
    }
    assert(!(near<far&&far>1e-5&&near<1-1e-5),'A server route enters a physical structure');
  }
}
let connection:DbConnection|undefined;
try {
  connection=await connect(saved.tokens[0]);
  const member=[...connection.db.my_realm_member.iter()][0];
  const settlement=[...connection.db.visible_settlement.iter()].find(s=>s.anchorX===member.campX&&s.anchorZ===member.campZ)!;
  const scout=()=>[...connection!.db.my_realm_scout.iter()].find(s=>s.settlementId===settlement.id)!;
  if(scout().health<=0)await connection.reducers.recruitRealmScout({settlementId:settlement.id});
  const initial:Point=[scout().x,scout().z];
  const home=[...connection.db.visible_residence.iter()].filter(r=>r.settlementId===settlement.id)
    .sort((a,b)=>Math.hypot(a.x-initial[0],a.z-initial[1])-Math.hypot(b.x-initial[0],b.z-initial[1]))[0];
  assert(home,'Seed the developed towns first');
  await connection.reducers.orderRealmScout({settlementId:settlement.id,x:home.x,z:home.z});
  const [[encoded]]=await sql(`SELECT waypoints_json FROM realm_scout_route WHERE settlement_id = ${settlement.id}`);
  const path:Point[]=JSON.parse(encoded);
  assert(path.length>=2);assert(path.every(p=>p.every(Number.isFinite)));
  assert(obstacles.every(o=>!inside(path.at(-1)!,o)),'Structure clicks must resolve to an accessible perimeter');
  for(let i=1;i<path.length;i++)assertClearSegment(path[i-1],path[i]);
  const routeLength=path.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-path[i][0],p[1]-path[i][1]),0);
  const navigation=JSON.parse(readFileSync('server/generated/realm_navigation.json','utf8'));
  const wet=Buffer.from(navigation.wetCellsHex,'hex');
  let water:Point|undefined;
  for(let i=0;i<navigation.resolution**2;i++)if(wet[i>>3]&(1<<(i&7))) {
    water=[navigation.startX+(i%navigation.resolution)*navigation.spanX/(navigation.resolution-1),
      navigation.startZ+Math.floor(i/navigation.resolution)*navigation.spanZ/(navigation.resolution-1)];break;
  }
  assert(water);await assert.rejects(connection.reducers.orderRealmScout({settlementId:settlement.id,x:water[0],z:water[1]}));
  const [[unchanged]]=await sql(`SELECT waypoints_json FROM realm_scout_route WHERE settlement_id = ${settlement.id}`);
  assert.equal(unchanged,encoded,'Rejected water orders must retain the previous route');
  connection.disconnect();connection=await connect(saved.tokens[0]);
  const deadline=performance.now()+Math.max(15000,routeLength/4*2000+15000);
  let previous:Point=[scout().x,scout().z],samples=0;
  while(Math.hypot(scout().targetX-scout().x,scout().targetZ-scout().z)>0.01) {
    assert(performance.now()<deadline,'Surveyor did not complete the persisted route');
    await delay(200);
    const point:Point=[scout().x,scout().z];
    // Consecutive observations can straddle a waypoint; validate each observed
    // position against all owners' structures, and the stored legs separately.
    assert(obstacles.every(o=>!inside(point,o)),'Surveyor entered a structure during movement');
    if(point[0]!==previous[0]||point[1]!==previous[1])samples++;
    previous=point;
  }
  assert(samples>0||routeLength<1,'No real surveyor movement observed');
  assert.equal((await sql(`SELECT settlement_id FROM realm_scout_route WHERE settlement_id = ${settlement.id}`)).length,0,
    'Completed routes must release their private storage');
  // From the first home's near perimeter, cross several occupied house rows.
  // A straight order would cut through them; inspect and complete the detour.
  await connection.reducers.orderRealmScout({settlementId:settlement.id,x:home.x,z:home.z+80});
  const [[detourEncoded]]=await sql(`SELECT waypoints_json FROM realm_scout_route WHERE settlement_id = ${settlement.id}`);
  const detour:Point[]=JSON.parse(detourEncoded);
  assert(detour.length>2,'Occupied house rows must require an actual detour');
  for(let i=1;i<detour.length;i++)assertClearSegment(detour[i-1],detour[i]);
  const detourLength=detour.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-detour[i][0],p[1]-detour[i][1]),0);
  const detourDeadline=performance.now()+Math.max(15000,detourLength/4*2000+15000);
  while(Math.hypot(scout().targetX-scout().x,scout().targetZ-scout().z)>0.01) {
    assert(performance.now()<detourDeadline,'Surveyor did not complete the house-row detour');
    await delay(200);
    assert(obstacles.every(o=>!inside([scout().x,scout().z],o)),'Surveyor entered a house on its detour');
  }
  const report={obstacles:obstacles.length,waypoints:path.length,routeLength,movementSamples:samples,
    detourWaypoints:detour.length,detourLength,houseRowsAvoided:true,
    structureClicksResolveToPerimeter:true,waterOrdersRejected:true,rejectedOrderPreservesRoute:true,reconnectCompletesRoute:true};
  writeFileSync('artifacts/realm-scout-navigation.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {connection?.disconnect();}
