import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { DbConnection } from '../src/generated/index.ts';

const uri = process.env.REALM_TEST_URI || 'http://127.0.0.1:3100';
const database = process.env.REALM_TEST_DB || 'city-builder-realm-loadtest';
assert(['127.0.0.1','localhost','[::1]'].includes(new URL(uri).hostname), 'Computer players are loopback only');
const saved = JSON.parse(readFileSync('.tmp-realm-test-clients.json','utf8'));
assert.equal(saved.database,database); assert.equal(saved.tokens.length,50,'Run the 50-player admission test first');
const clients: { connection: DbConnection; token: string }[] = [];
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve,ms));
async function waitFor(test: () => boolean, label: string, timeout = 30_000) {
  const start=performance.now(); while (!test()) {assert(performance.now()-start<timeout,label); await delay(100);}
}
async function fixture(token: string, reducer: string, args: unknown[]) {
  const response = await fetch(`${uri}/v1/database/${database}/call/${reducer}`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(args),
  });
  assert(response.ok,`${reducer}: ${response.status} ${await response.text()}`);
}
function connect(token: string): Promise<DbConnection> {
  return new Promise((resolve,reject) => {
    DbConnection.builder().withUri(uri).withDatabaseName(database).withToken(token)
      .onConnect(c => c.subscriptionBuilder().onApplied(() => resolve(c)).onError(ctx => reject(ctx.event))
        .subscribe(['world_config','my_realm_member','my_realm_scout','my_realm_fog','visible_realm_entity',
          'visible_building','visible_residence','visible_settlement','visible_delivery_trip'].map(t=>`SELECT * FROM ${t}`)))
      .onConnectError((_c,e)=>reject(e)).build();
  });
}
const report: Record<string,unknown>={players:50,outposts:17,seedMs:[],orderMs:[]};
try {
  for (const token of saved.tokens) clients.push({connection:await connect(token),token});
  clients.sort((a,b)=>a.connection.identity!.toHexString().localeCompare(b.connection.identity!.toHexString()));
  for (const [i,client] of clients.entries()) {
    const start=performance.now(); await fixture(client.token,'loadtest_seed_town',[i<17]);
    (report.seedMs as number[]).push(performance.now()-start);
    await waitFor(()=>[...client.connection.db.visible_residence.iter()].length >= (i<17?108:96),'Town households not replicated');
    const settlements=[...client.connection.db.visible_settlement.iter()];
    assert.equal(settlements.length,i<17?2:1,'Outposts must have an independent civic identity');
    if (i<17) {
      const outpost=settlements.find(s=>Math.hypot(s.anchorX-[...client.connection.db.my_realm_member.iter()][0].campX,
        s.anchorZ-[...client.connection.db.my_realm_member.iter()][0].campZ)>500)!;
      const homes=[...client.connection.db.visible_residence.iter()].filter(r=>r.settlementId===outpost.id);
      assert.equal(homes.length,12,'Outpost houses must belong to the outpost');
      assert([...client.connection.db.visible_building.iter()].some(b=>b.settlementId===outpost.id&&b.kind==='town_hall'));
      const before=homes.reduce((n,r)=>n+r.population,0);
      if ([...client.connection.db.my_realm_scout.iter()].some(s=>s.settlementId===outpost.id&&s.health>0)) {
        await fixture(client.token,'loadtest_surveyor_loss',[Number(outpost.id),false]);
        await waitFor(()=>[...client.connection.db.my_realm_scout.iter()].find(s=>s.settlementId===outpost.id)?.health===0,'Outpost loss not replicated');
      }
      await client.connection.reducers.recruitRealmScout({settlementId:outpost.id});
      await waitFor(()=>[...client.connection.db.my_realm_scout.iter()].some(s=>s.settlementId===outpost.id&&s.health>0),'Outpost surveyor not recruited');
      assert.equal([...client.connection.db.visible_residence.iter()].filter(r=>r.settlementId===outpost.id)
        .reduce((n,r)=>n+r.population,0),before-1,'Outpost recruitment must use its own population');
    }
    if ((i+1)%10===0) console.log(`Seeded ${i+1}/50 production towns`);
  }
  report.houses=clients.reduce((n,c)=>n+[...c.connection.db.visible_residence.iter()].length,0);
  report.buildings=clients.reduce((n,c)=>n+[...c.connection.db.visible_building.iter()].length,0);
  report.settlements=clients.reduce((n,c)=>n+[...c.connection.db.visible_settlement.iter()].length,0);
  assert.equal(report.settlements,67);
  report.independentOutpostRecruitment=true;
  const first=clients[0];
  const mainScout=(connection:DbConnection)=>{
    const member=[...connection.db.my_realm_member.iter()][0];
    const settlement=[...connection.db.visible_settlement.iter()].find(s=>s.anchorX===member.campX&&s.anchorZ===member.campZ)!;
    return [...connection.db.my_realm_scout.iter()].find(s=>s.settlementId===settlement.id)!;
  };
  const scout=mainScout(first.connection);
  assert(scout.health>0);
  await assert.rejects(first.connection.reducers.recruitRealmScout({settlementId:scout.settlementId}));
  const explored=()=>[...first.connection.db.my_realm_fog.iter()].reduce((n,f)=>n+f.explored.toString(2).replaceAll('0','').length,0);
  const beforeExplored=explored();
  const beforeTick=[...first.connection.db.world_config.iter()][0].simTick;
  const inventory=()=>clients.map(c=>[...c.connection.db.visible_building.iter()].map(b=>`${b.id}:${b.timber}:${b.water}:${b.ryeBread}:${b.actionCooldown}`).join('|')).join(';');
  const beforeInventory=inventory();
  for (const [i,client] of clients.entries()) {
    const member=[...client.connection.db.my_realm_member.iter()][0];
    const s=mainScout(client.connection);
    const angle=i*2.399963; const start=performance.now();
    await client.connection.reducers.orderRealmScout({settlementId:s.settlementId,x:member.campX+Math.cos(angle)*480,z:member.campZ+Math.sin(angle)*480});
    (report.orderMs as number[]).push(performance.now()-start);
  }
  await waitFor(()=>[...first.connection.db.world_config.iter()][0].simTick>beforeTick+5n,'Populated simulation stopped',60_000);
  assert.notEqual(inventory(),beforeInventory,'Real workshop buffers must change under simulation');
  report.productionAdvanced=true;
  report.deliveryTrips=clients.reduce((n,c)=>n+[...c.connection.db.visible_delivery_trip.iter()].length,0);
  // Town buildings reveal their footprint. Walking past that footprint must add exploration.
  await waitFor(()=>explored()>beforeExplored,'Walking surveyor did not reveal new cells',120_000);
  report.movingUnitsReveal=true;
  await fixture(first.token,'loadtest_surveyor_loss',[Number(scout.settlementId),true]);
  await waitFor(()=>[...first.connection.db.my_realm_scout.iter()].find(s=>s.settlementId===scout.settlementId)?.health===0,'Loss not replicated');
  await assert.rejects(first.connection.reducers.orderRealmScout({settlementId:scout.settlementId,x:scout.x,z:scout.z}));
  const oldPopulation=[...first.connection.db.visible_residence.iter()].reduce((n,r)=>n+r.population,0);
  await first.connection.reducers.recruitRealmScout({settlementId:scout.settlementId});
  await waitFor(()=>[...first.connection.db.my_realm_scout.iter()].find(s=>s.settlementId===scout.settlementId)?.health!>0,'Home fallback recruitment failed');
  assert.equal([...first.connection.db.visible_residence.iter()].reduce((n,r)=>n+r.population,0),oldPopulation-1);
  assert(explored()>=beforeExplored,'Losing surveyor erased explored land');
  report.homeFallbackRecruitment=true;
  report.populationCostEnforced=true;
  report.fogMemorySurvivesDeath=true;
  report.tickAdvance=String([...first.connection.db.world_config.iter()][0].simTick-beforeTick);
  report.orderMs={max:Math.max(...report.orderMs as number[]),mean:(report.orderMs as number[]).reduce((a,b)=>a+b,0)/50};
  writeFileSync('artifacts/realm-production-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,seedMs:{max:Math.max(...report.seedMs as number[]) }},null,2));
} finally {for(const c of clients)c.connection.disconnect();}
