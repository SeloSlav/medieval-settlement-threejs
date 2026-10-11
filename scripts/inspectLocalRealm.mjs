import {readFileSync} from 'node:fs';
const {token}=JSON.parse(readFileSync('.tmp-realm-publisher/identity.json','utf8'));
const uri=process.env.REALM_TEST_URI||'http://127.0.0.1:3100';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(uri).hostname))throw Error('Local inspection only');
const db=process.env.REALM_TEST_DB||'city-builder-realm-loadtest';
const clockOnly=process.argv.includes('--clock');
const inspections=clockOnly?[['sql','SELECT world_config.sim_tick, realm_clock.last_wall_micros FROM world_config JOIN realm_clock ON world_config.id = realm_clock.id']]
  :[['sql','SELECT sim_tick, game_speed FROM world_config'],['logs?num_lines=32',null]];
for(const [path,body] of inspections) {
 const r=await fetch(`${uri}/v1/database/${db}/${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`},body,signal:AbortSignal.timeout(15000)});
 const result=await r.text();
 if(clockOnly&&r.ok) {
  const [[tick,lastWall]]=JSON.parse(result)[0].rows;
  console.log(JSON.stringify({tick,lagMs:Math.round(Date.now()-lastWall/1000)}));
 } else console.log(path,r.status,result.slice(-11000));
}
