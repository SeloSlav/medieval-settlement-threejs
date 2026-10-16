import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';

const uri=process.env.REALM_TEST_URI||'http://127.0.0.1:3100';
const database=process.env.REALM_TEST_DB||'city-builder-realm-loadtest';
assert(['localhost','127.0.0.1','[::1]'].includes(new URL(uri).hostname),'Local fixture only');
const saved=JSON.parse(readFileSync('.tmp-realm-test-clients.json','utf8'));
const publisher=JSON.parse(readFileSync('.tmp-realm-publisher/identity.json','utf8'));
assert.equal(saved.database,database);assert.equal(saved.tokens.length,50);
const count=Number(process.env.REALM_PRODUCTION_PLAYERS||50);assert(Number.isInteger(count)&&count>0&&count<=50);
const output=process.env.REALM_PRODUCTION_OUTPUT||'artifacts/realm-production-coverage.json';
const report={players:count,seedMs:[],failures:[]};
async function query(table,columns){
  const response=await fetch(`${uri}/v1/database/${database}/sql`,{method:'POST',headers:{Authorization:`Bearer ${publisher.token}`},
    body:`SELECT ${columns.join(', ')} FROM ${table}`,signal:AbortSignal.timeout(30000)});
  if(!response.ok)assert.fail(`Fixture query ${table}: ${response.status} ${await response.text()}`);
  return (await response.json())[0].rows.map(row=>Object.fromEntries(columns.map((name,i)=>[name,name==='owner'?JSON.stringify(row[i]):row[i]])));
}
try {
  for(const [i,token] of saved.tokens.slice(0,count).entries()){
    const start=performance.now();
    const response=await fetch(`${uri}/v1/database/${database}/call/loadtest_complete_production_town`,{
      method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'[]',signal:AbortSignal.timeout(120000)});
    const result=await response.text();
    report.seedMs.push(performance.now()-start);
    if(!response.ok){report.failures.push({player:i,status:response.status,reason:result});break;}
    console.log(`Completed real production coverage ${i+1}/${count}`);
  }
  const [buildings,homes,fields,herds,yards]=await Promise.all([
    query('building',['id','owner','settlement_id','kind','x','z']),
    query('residence',['id','owner','settlement_id','x','z','population']),
    query('farm_field',['id','owner','farmstead_id','area','stage','stage_progress','crop','next_crop','following_crop']),
    query('pasture_herd',['pasture_id','owner','farmstead_id','species','head_count','health','breeding_progress','hay_stock']),
    query('graveyard',['id','owner','chapel_id','capacity','burials']),
  ]);
  report.homes=homes.length;report.buildings=buildings.length;report.fields=fields.length;report.fieldArea=fields.reduce((n,r)=>n+r.area,0);
  report.herds=herds.length;report.animals=herds.reduce((n,r)=>n+r.head_count,0);report.graveyards=yards.length;report.burialCapacity=yards.reduce((n,r)=>n+r.capacity,0);
  const owners=new Set(fields.map(f=>f.owner));
  report.coveredOwners=owners.size;
  // The fixture reducer validates each road-linked claim as it adds wells.
  // Confirm enough household slots remain after the completed town is read back.
  report.wellsHaveHouseholdSlots=owners.size>0&&[...owners].every(owner=>
    homes.filter(h=>h.owner===owner&&h.population>0).length
      <=buildings.filter(b=>b.owner===owner&&b.kind==='well').length*50);
  assert.equal(report.failures.length,0,'Production fixture coverage failed; raw failure saved');
  assert.equal(report.coveredOwners,count);assert(report.fields>=count*12);assert(report.herds>=count*2);
  assert(herds.every(h=>h.head_count>=2),'Every seeded holding needs a real breeding herd');
  assert(report.graveyards>=count*2);assert(report.wellsHaveHouseholdSlots);
  const previous=new Map(fields.map(f=>[f.id,`${f.stage}:${f.stage_progress}`]));
  const herdState=h=>`${h.head_count}:${h.health}:${h.breeding_progress}:${h.hay_stock}`;
  const previousHerds=new Map(herds.map(h=>[h.pasture_id,herdState(h)]));
  await new Promise(resolve=>setTimeout(resolve,30000));
  const after=await query('farm_field',['id','owner','stage','stage_progress']);
  report.fieldsAdvanced=after.filter(f=>previous.get(f.id)!==`${f.stage}:${f.stage_progress}`).length;
  const afterHerds=await query('pasture_herd',['pasture_id','head_count','health','breeding_progress','hay_stock']);
  report.herdsAdvanced=afterHerds.filter(h=>previousHerds.get(h.pasture_id)!==herdState(h)).length;
  assert(report.fieldsAdvanced>0||report.herdsAdvanced>0,'Real farm/livestock work did not advance');
  console.log(JSON.stringify(report,null,2));
} finally {mkdirSync('artifacts',{recursive:true});writeFileSync(output,JSON.stringify(report,null,2));}
