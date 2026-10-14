import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
function fn(source,name){const start=source.indexOf(`fn ${name}(`);assert(start>=0,name);let p=source.indexOf('{',start)+1,d=1;
 for(;d;p++){if(source[p]==='{')d++;else if(source[p]==='}')d--;assert(p<source.length);}return source.slice(start,p);}
const source=readFileSync('server/src/simulation/burial.rs','utf8');
const dispatch=fn(source,'dispatch_waiting_corpses').replace('fn dispatch_waiting_corpses(', 'pub(super) fn dispatch_waiting_corpses(');
const start=dispatch.indexOf('for chapel_id in tick.building_ids_for_kinds'),end=dispatch.indexOf('            for graveyard ',start);
assert(start>=0&&end>start);
const reference=dispatch.slice(0,start)+`for chapel in ctx.db.building().owner().filter(&corpse.owner).filter(|building|{
 building.kind=="chapel"&&building.construction_complete&&building.assigned_labor>active_by_chapel.get(&building.id).copied().unwrap_or(0)
 &&!tick.building_disabled_by_fire(ctx,building.id)}){\n`+dispatch.slice(end);
const centroid=fn(source,'graveyard_centroid');
const code=`
use std::cell::{Cell,RefCell};use std::collections::{BTreeMap,HashMap,HashSet};use std::borrow::Borrow;
const BURIAL_CART_SPEED_MPS:f64=3.0;
#[derive(Clone,Debug,PartialEq)]struct Corpse{id:u64,owner:u64,state:u8,created_tick:u64,x:f64,z:f64,chapel_id:u64,graveyard_id:u64,
 progress:f64,speed_mps:f64,path_distance:f64,route_polyline_json:String,cart_x:f64,cart_z:f64}
#[derive(Clone)]struct Building{id:u64,owner:u64,kind:String,construction_complete:bool,assigned_labor:u32,x:f64,z:f64}
#[derive(Clone)]struct Graveyard{id:u64,chapel_id:u64,burials:u32,capacity:u32,corner_ax:f64,corner_az:f64,corner_bx:f64,corner_bz:f64,
 corner_cx:f64,corner_cz:f64,corner_dx:f64,corner_dz:f64}
#[derive(Default)]struct Database{buildings:RefCell<BTreeMap<u64,Building>>,corpses:RefCell<BTreeMap<u64,Corpse>>,yards:RefCell<Vec<Graveyard>>,
 building_reads:Cell<usize>,building_queries:Cell<usize>,fires:RefCell<HashSet<u64>>,paused:RefCell<HashSet<u64>>}
#[derive(Default)]struct ReducerContext{db:Database}struct GameClock;
struct BuildingTable<'a>{db:&'a Database}struct CorpseTable<'a>{db:&'a Database}struct YardTable<'a>{db:&'a Database}
impl Database{fn building(&self)->BuildingTable<'_>{BuildingTable{db:self}}fn corpse(&self)->CorpseTable<'_>{CorpseTable{db:self}}
 fn graveyard(&self)->YardTable<'_>{YardTable{db:self}}}
impl BuildingTable<'_>{fn owner(self)->Self{self}fn id(self)->Self{self}
 fn iter(self)->std::vec::IntoIter<Building>{self.db.building_queries.set(self.db.building_queries.get()+1);
  let rows:Vec<_>=self.db.buildings.borrow().values().cloned().collect();self.db.building_reads.set(self.db.building_reads.get()+rows.len());rows.into_iter()}
 fn filter(self,owner:&u64)->std::vec::IntoIter<Building>{self.db.building_queries.set(self.db.building_queries.get()+1);
  let rows:Vec<_>=self.db.buildings.borrow().values().filter(|b|b.owner==*owner).cloned().collect();
  self.db.building_reads.set(self.db.building_reads.get()+rows.len());rows.into_iter()}
 fn find(self,id:impl Borrow<u64>)->Option<Building>{self.db.building_queries.set(self.db.building_queries.get()+1);
  let row=self.db.buildings.borrow().get(id.borrow()).cloned();self.db.building_reads.set(self.db.building_reads.get()+usize::from(row.is_some()));row}}
impl CorpseTable<'_>{fn id(self)->Self{self}fn iter(self)->std::vec::IntoIter<Corpse>{self.db.corpses.borrow().values().cloned().collect::<Vec<_>>().into_iter()}
 fn update(self,row:Corpse){self.db.corpses.borrow_mut().insert(row.id,row);}}
impl YardTable<'_>{fn chapel_id(self)->Self{self}fn filter(self,id:&u64)->std::vec::IntoIter<Graveyard>{
 self.db.yards.borrow().iter().filter(|g|g.chapel_id==*id).cloned().collect::<Vec<_>>().into_iter()}}
struct RoadNetwork;#[derive(Clone)]struct RoadPathRoute{distance:f64,polyline:Vec<[f64;2]>}
impl RoadNetwork{fn road_path_route(&self,ax:f64,az:f64,bx:f64,bz:f64)->Option<RoadPathRoute>{if bx>=9900.0{return None}
 Some(RoadPathRoute{distance:(bx-ax).hypot(bz-az),polyline:vec![[ax,az],[bx,bz]]})}
 fn sample_polyline_xz(p:&[[f64;2]],_distance:f64)->(f64,f64){(p[0][0],p[0][1])}}
fn serialize_route_polyline(p:&[[f64;2]])->String{format!("{:?}",p)}
struct SimTickContext{index:RefCell<Option<HashMap<(u64,String),Vec<u64>>>>,roads:RoadNetwork,no_roads:HashSet<u64>}
impl Default for SimTickContext{fn default()->Self{Self{index:RefCell::new(None),roads:RoadNetwork,no_roads:HashSet::new()}}}
impl SimTickContext{fn building_ids_for_kinds(&self,ctx:&ReducerContext,owner:u64,kinds:&[&str])->Vec<u64>{
 if self.index.borrow().is_none(){let mut index=HashMap::<(u64,String),Vec<u64>>::new();
 for b in ctx.db.building().iter(){index.entry((b.owner,b.kind)).or_default().push(b.id);}*self.index.borrow_mut()=Some(index);}
 let index=self.index.borrow();kinds.iter().flat_map(|kind|index.as_ref().unwrap().get(&(owner,kind.to_string())).cloned().unwrap_or_default()).collect()}
 fn building_disabled_by_fire(&self,ctx:&ReducerContext,id:u64)->bool{ctx.db.fires.borrow().contains(&id)}
 fn road_network(&self,owner:u64)->Option<&RoadNetwork>{(!self.no_roads.contains(&owner)).then_some(&self.roads)}}
fn labor_and_logistics_paused(ctx:&ReducerContext,_tick:&SimTickContext,owner:u64,_clock:&GameClock)->bool{ctx.db.paused.borrow().contains(&owner)}
mod current{use super::*;${dispatch}${centroid}}
mod reference{use super::*;${reference}${centroid}}
fn corpse(id:u64,owner:u64,x:f64,z:f64)->Corpse{Corpse{id,owner,x,z,state:0,created_tick:id%7,chapel_id:0,graveyard_id:0,
 progress:0.0,speed_mps:0.0,path_distance:0.0,route_polyline_json:String::new(),cart_x:x,cart_z:z}}
fn world(owners:u64)->ReducerContext{let ctx=ReducerContext::default();for owner in 1..=owners{
 for i in 0..48{let id=owner*100+i;ctx.db.buildings.borrow_mut().insert(id,Building{id,owner,kind:if i<2{"chapel"}else{"weaver"}.into(),
 construction_complete:true,assigned_labor:3,x:i as f64*10.0,z:0.0});if i<2{let x=i as f64*10.0;
 ctx.db.yards.borrow_mut().push(Graveyard{id,chapel_id:id,burials:0,capacity:8,corner_ax:x,corner_bx:x+2.0,corner_cx:x+2.0,corner_dx:x,
 corner_az:14.0,corner_bz:14.0,corner_cz:16.0,corner_dz:16.0});}}
 for i in 0..5{let c=corpse(owner*10+i,owner,5.0,3.0+i as f64);ctx.db.corpses.borrow_mut().insert(c.id,c);}}
 ctx}
#[test]fn exact_dispatches_share_the_existing_building_index(){
 let old=world(50);let new=world(50);let a=SimTickContext::default();let b=SimTickContext::default();
 b.building_ids_for_kinds(&new,1,&["weaver"]);new.db.building_reads.set(0);new.db.building_queries.set(0);
 reference::dispatch_waiting_corpses(&old,&a,&GameClock);current::dispatch_waiting_corpses(&new,&b,&GameClock);
 assert_eq!(*old.db.corpses.borrow(),*new.db.corpses.borrow());
 assert_eq!(old.db.building_reads.get(),12000);assert_eq!(new.db.building_reads.get(),500);
 println!("250 burial requests: building row reads {} -> {} with exact reservations and routes",old.db.building_reads.get(),new.db.building_reads.get());
}
#[test]fn eligibility_capacity_ties_outbound_zero_and_failures_match(){
 let old=world(8);let new=world(8);let mut a=SimTickContext::default();let mut b=SimTickContext::default();
 a.no_roads.insert(8);b.no_roads.insert(8);
 b.building_ids_for_kinds(&new,1,&["chapel"]);
 for ctx in [&old,&new]{ctx.db.paused.borrow_mut().insert(7);ctx.db.fires.borrow_mut().insert(401);
  ctx.db.buildings.borrow_mut().get_mut(&300).unwrap().construction_complete=false;
  ctx.db.buildings.borrow_mut().get_mut(&500).unwrap().assigned_labor=0;
  ctx.db.buildings.borrow_mut().get_mut(&600).unwrap().kind="weaver".into();ctx.db.buildings.borrow_mut().remove(&601);
  for g in ctx.db.yards.borrow_mut().iter_mut().filter(|g|g.chapel_id==201){g.burials=g.capacity;}
  ctx.db.corpses.borrow_mut().get_mut(&10).unwrap().x=0.0;ctx.db.corpses.borrow_mut().get_mut(&10).unwrap().z=0.0;
  ctx.db.corpses.borrow_mut().get_mut(&11).unwrap().x=9900.0;
  // A cart already underway reserves both the chapel crew and its grave slot.
  let mut active=corpse(999,2,0.0,0.0);active.state=2;active.chapel_id=200;active.graveyard_id=200;ctx.db.corpses.borrow_mut().insert(active.id,active);
 }
 reference::dispatch_waiting_corpses(&old,&a,&GameClock);current::dispatch_waiting_corpses(&new,&b,&GameClock);
 assert_eq!(*old.db.corpses.borrow(),*new.db.corpses.borrow());
 assert_eq!(new.db.corpses.borrow()[&10].state,2);assert_eq!(new.db.corpses.borrow()[&11].state,0);
 for c in new.db.corpses.borrow().values().filter(|c|c.owner>=6){assert_eq!(c.state,0);}
}
#[test]fn full_graves_and_equal_routes_keep_stable_ids_and_reservations(){
 let old=world(1);let new=world(1);for ctx in [&old,&new]{ctx.db.buildings.borrow_mut().get_mut(&101).unwrap().x=0.0;
  for yard in ctx.db.yards.borrow_mut().iter_mut(){yard.capacity=1;yard.corner_ax=0.0;yard.corner_bx=2.0;yard.corner_cx=2.0;yard.corner_dx=0.0;}
  let mut data=ctx.db.corpses.borrow_mut();for corpse in data.values_mut(){corpse.created_tick=0;}data.get_mut(&10).unwrap().x=0.0;data.get_mut(&10).unwrap().z=0.0;}
 reference::dispatch_waiting_corpses(&old,&SimTickContext::default(),&GameClock);
 current::dispatch_waiting_corpses(&new,&SimTickContext::default(),&GameClock);
 assert_eq!(*old.db.corpses.borrow(),*new.db.corpses.borrow());
 let data=new.db.corpses.borrow();assert_eq!(data[&10].graveyard_id,100);assert_eq!(data[&11].graveyard_id,101);
 assert_eq!(data.values().filter(|corpse|corpse.state!=0).count(),2);
}
#[test]fn owners_without_chapels_do_not_rescan_unrelated_workshops(){
 let ctx=world(50);for building in ctx.db.buildings.borrow_mut().values_mut(){building.kind="weaver".into();}
 let tick=SimTickContext::default();tick.building_ids_for_kinds(&ctx,1,&["weaver"]);
 ctx.db.building_reads.set(0);ctx.db.building_queries.set(0);current::dispatch_waiting_corpses(&ctx,&tick,&GameClock);
 assert_eq!(ctx.db.building_reads.get(),0);assert_eq!(ctx.db.building_queries.get(),0);
 assert!(ctx.db.corpses.borrow().values().all(|corpse|corpse.state==0));
}
`;
const directory='.tmp-burial-candidate-index-tests';mkdirSync(directory,{recursive:true});
const path=join(directory,'burial_candidates.rs'),binary=join(directory,'burial_candidates.exe');writeFileSync(path,code);
for(const [command,args]of[['rustc',['--edition=2021','--test','-O',path,'-o',binary]],[binary,['--nocapture']]]){
 const result=spawnSync(command,args,{encoding:'utf8',windowsHide:true});if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
 assert.equal(result.status,0,result.error?.message??'Actual burial dispatch regression failed');
}
