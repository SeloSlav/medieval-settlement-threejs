import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

function fn(source, name) {
  const start = source.indexOf(`fn ${name}(`); assert(start >= 0, name);
  let p = source.indexOf('{', start) + 1, depth = 1;
  for (; depth; p++) { if (source[p] === '{') depth++; else if (source[p] === '}') depth--; assert(p < source.length); }
  return source.slice(start, p);
}
const source = readFileSync('server/src/reducers/realm_loadtest/production.rs', 'utf8');
const path = name => resolve(`server/src/${name}.rs`).replaceAll('\\', '/');
const code = `
#![allow(dead_code)]
#[path="${path('burgage')}"]mod burgage;
#[path="${path('realm_policy')}"]mod realm_policy;
use burgage::{Point2,ZoneCorners,convex_zones_overlap};
${fn(readFileSync('server/src/farming.rs','utf8'),'corners_from_values').replace('fn corners_from_values','fn corners_from_values')}
${['rectangle','polygon','polygon_values'].map(n=>fn(source,n)).join('\n')}
#[derive(Default)]struct ReducerContext{deposits:Vec<[Point2;4]>}
fn zone_overlaps_resource_deposit(ctx:&ReducerContext,c:&ZoneCorners)->bool{
 ctx.deposits.iter().any(|other|convex_zones_overlap(&[c.a,c.b,c.c,c.d],other))
}
#[derive(Default,Clone)]struct RoadNetwork{water:Vec<[f64;4]>,gradient_x:f64,gradient_z:f64}
impl RoadNetwork{
 fn segment_avoids_open_water(&self,ax:f64,z:f64,bx:f64,_bz:f64)->bool{
  !self.water.iter().any(|r|z>=r[1]&&z<=r[3]&&ax.min(bx)<=r[2]&&ax.max(bx)>=r[0])
 }
 fn combat_elevation(&self,x:f64,z:f64)->f64{x*self.gradient_x+z*self.gradient_z}
}
struct Building{x:f64,z:f64}
struct FixtureSpace{land:RoadNetwork,occupied:Vec<[Point2;4]>}
impl FixtureSpace{${fn(source,'slope_if_free')} ${fn(source,'parcel')}}
fn space()->FixtureSpace{FixtureSpace{land:RoadNetwork::default(),occupied:vec![]}}
#[test]fn rejects_internal_water_and_steep_or_occupied_ground(){
 let ctx=ReducerContext::default();let mut s=space();let p=polygon(rectangle(0.0,0.0,96.0,64.0));
 s.land.water.push([-12.0,-12.0,12.0,12.0]);assert!(s.slope_if_free(&ctx,p,18.0).is_none());
 s.land.water.clear();s.land.gradient_x=30.0_f64.to_radians().tan();assert!(s.slope_if_free(&ctx,p,18.0).is_none());
 assert!((s.slope_if_free(&ctx,p,31.0).unwrap()-30.0).abs()<1e-9);
 s.land.gradient_x=0.0;s.occupied.push(polygon(rectangle(1.0,1.0,10.0,10.0)));assert!(s.slope_if_free(&ctx,p,18.0).is_none());
 s.occupied.clear();let ctx=ReducerContext{deposits:vec![polygon(rectangle(1.0,1.0,10.0,10.0))]};
 assert!(s.slope_if_free(&ctx,p,18.0).is_none());
}
#[test]fn bounded_working_range_world_edges_and_failed_search_are_stable(){
 let ctx=ReducerContext::default();let mut s=space();let b=Building{x:6112.0,z:6100.0};
 let (v,_)=s.parcel(&ctx,&b,&[(96.0,64.0),(48.0,40.0)],250.0,18.0).unwrap();
 for p in polygon(v){assert!(realm_policy::world_chunk(p.x,p.z).is_some());assert!((p.x-b.x).hypot(p.z-b.z)<=250.0);}
 let mut wet=space();wet.land.water.push([-6144.0,-6144.0,6144.0,6144.0]);
 assert!(wet.parcel(&ctx,&Building{x:0.0,z:0.0},&[(48.0,40.0)],110.0,18.0).is_none());assert!(wet.occupied.is_empty());
}
#[test]fn reserves_a_cemetery_beside_the_permanent_churchyard(){
 let ctx=ReducerContext::default();let mut s=space();let chapel=Building{x:0.0,z:0.0};
 s.occupied.push(polygon(rectangle(0.0,0.0,27.0,34.2)));
 let (v,_)=s.parcel(&ctx,&chapel,&[(20.0,16.0),(16.0,12.0),(12.0,8.0)],38.0,12.0).unwrap();
 let p=polygon(v);assert!(!convex_zones_overlap(&p,&s.occupied[0]));
 assert!(p.iter().all(|p|p.x.hypot(p.z)<=38.0));assert!((v[2]-v[0])*(v[5]-v[1])>=96.0);
}
#[test]fn packs_two_barns_around_dense_towns_without_overlap(){
 let ctx=ReducerContext::default();let mut total=0.0;
 for town in 0..50 {
  let x=(town%9) as f64*1280.0-5120.0;let z=(town/9) as f64*1280.0-5120.0;let mut s=space();
  for i in 0..48 {s.occupied.push(polygon(rectangle(x-160.0+(i%8) as f64*40.0,z-120.0+(i/8) as f64*24.0,16.0,16.0)));}
  for i in 0..96 {s.occupied.push(polygon(rectangle(x-150.0+(i%12) as f64*25.0,z+50.0+(i/12) as f64*24.0,20.0,20.0)));}
  let original=s.occupied.len();
  for _ in 0..6 {for bz in [z-96.0,z-24.0] {let b=Building{x,z:bz};
   let (v,_)=s.parcel(&ctx,&b,&[(96.0,64.0),(64.0,48.0),(48.0,40.0),(32.0,24.0),(24.0,16.0)],250.0,18.0).unwrap();
    let p=polygon(v);assert!(s.occupied[..s.occupied.len()-1].iter().all(|other|!convex_zones_overlap(&p,other)));
    assert!(p.iter().all(|p|(p.x-b.x).hypot(p.z-b.z)<=250.0));total+=(v[2]-v[0])*(v[5]-v[1]);}
  }
  assert_eq!(s.occupied.len(),original+12);
 }
 println!("Packed 600 legal fields around 50 dense towns: {total} square metres");
}
`;
const directory='.tmp-realm-production-parcel-tests';mkdirSync(directory,{recursive:true});
const file=join(directory,'parcels.rs'),binary=join(directory,'parcels.exe');writeFileSync(file,code);
for (const [command,args] of [['rustc',['--edition=2021','--test','-O',file,'-o',binary]],[binary,['--nocapture']]]) {
  const result=spawnSync(command,args,{encoding:'utf8',windowsHide:true});
  if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
  assert.equal(result.status,0,result.error?.message??'Actual local parcel search failed');
}
if(process.argv.includes('--real-terrain')) {
  const build=spawnSync('cargo',['build','--manifest-path','server/logic/Cargo.toml'],{encoding:'utf8',windowsHide:true});
  assert.equal(build.status,0,build.stderr);
  const deps='server/target/debug/deps';
  const library=readdirSync(deps).filter(f=>/^libmedieval_server_logic.*\.rlib$/.test(f))
    .map(f=>join(deps,f)).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs)[0];assert(library);
  const spawns=JSON.parse(readFileSync('server/generated/realm_world.json','utf8')).spawns;
  const realCode=code.slice(0,code.indexOf('#[derive(Default,Clone)]struct RoadNetwork'))+`
use medieval_server_logic::road_network::{RoadNetwork,RiverNavigationGrid};
struct Building{x:f64,z:f64}
struct FixtureSpace{land:RoadNetwork,occupied:Vec<[Point2;4]>}
impl FixtureSpace{${fn(source,'slope_if_free')} ${fn(source,'parcel')}}
#[test]fn actual_terrain_supports_fields_around_every_founding_region(){
 let navigation=RiverNavigationGrid::from_json(include_str!("${resolve('server/generated/realm_navigation.json').replaceAll('\\','/')}" )).unwrap();
 let spawns=[${spawns.map(s=>`(${s.slot},${s.x.toFixed(14)},${s.z.toFixed(14)})`).join(',')}];
 let ctx=ReducerContext::default();let mut failures=vec![];let mut total=0.0;
 for (slot,x,z) in spawns {
  let mut land=RoadNetwork::from_snapshot_json("{\\\"nodes\\\":[],\\\"edges\\\":[]}").unwrap();land.set_river_navigation(navigation.clone());
  let mut s=FixtureSpace{land,occupied:vec![]};
  for i in 0..48 {s.occupied.push(polygon(rectangle(x-160.0+(i%8) as f64*40.0,z-120.0+(i/8) as f64*24.0,16.0,16.0)));}
  for i in 0..96 {s.occupied.push(polygon(rectangle(x-150.0+(i%12) as f64*25.0,z+50.0+(i/12) as f64*24.0,20.0,20.0)));}
  let mut count=0;
  for _ in 0..6 {for bz in [z-96.0,z-24.0] {let b=Building{x,z:bz};
   if let Some((v,_))=s.parcel(&ctx,&b,&[(96.0,64.0),(64.0,48.0),(48.0,40.0),(32.0,24.0),(24.0,16.0)],250.0,18.0){count+=1;total+=(v[2]-v[0])*(v[5]-v[1]);}
  }}
  if count!=12 {failures.push((slot,count));}
 }
 println!("Actual 81-region terrain field area: {total} m2; failed regions: {failures:?}");assert!(failures.is_empty());
}
`;
  const actual=join(directory,'actual_terrain.rs'),actualBinary=join(directory,'actual_terrain.exe');writeFileSync(actual,realCode);
  for (const [command,args] of [['rustc',['--edition=2021','--test','-O',actual,'--extern',`medieval_server_logic=${library}`,'-L',`dependency=${deps}`,'-o',actualBinary]],[actualBinary,['--nocapture']]]) {
    const result=spawnSync(command,args,{encoding:'utf8',windowsHide:true});
    if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
    assert.equal(result.status,0,result.error?.message??'Actual embedded terrain parcel check failed');
  }
}
