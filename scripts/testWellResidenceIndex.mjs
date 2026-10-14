import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
function fn(s,n){const start=s.indexOf(`fn ${n}(`);assert(start>=0,n);let p=s.indexOf('{',start)+1,d=1;
  for(;d;p++){if(s[p]==='{')d++;else if(s[p]==='}')d--;assert(p<s.length);}return s.slice(start,p);}
const context=readFileSync('server/src/simulation/tick_context.rs','utf8');
const source=readFileSync('server/src/simulation/household_distribution.rs','utf8');
const current=fn(source,'distribute_well_water').replace('fn distribute_well_water','pub(super) fn distribute_well_water');
const a=current.indexOf('let residences:'),b=current.indexOf('.filter(|residence|',a);assert(a>=0&&b>a);
let reference=current.slice(0,a)+`let residences:Vec<(Residence,f64,f64)>=ctx.db.residence().owner().filter(&well.owner)\n`+current.slice(b);
reference=reference.replace('residence.owner == well.owner\n                && !residence.abandoned','!residence.abandoned')
  .replace('&& delivery_stock_room(', '&& tick.well_supplier_for(ctx,well.owner,residence.id)==Some(well.id)\n                && delivery_stock_room(');
assert.notEqual(reference,current);
const methods=['ensure_water_claims','well_supplier_for','well_residence_ids'].map(n=>fn(context,n)).join('\n');
const code=`
#![allow(dead_code)]
use std::cell::{Cell,RefCell};use std::collections::{BTreeMap,HashMap,HashSet};use std::borrow::Borrow;
type Identity=u64;
#[derive(Clone,Debug)]struct Residence{id:u64,owner:u64,x:f64,z:f64,abandoned:bool,population:u32,tier:u8}
#[derive(Clone,Debug,PartialEq)]struct Building{id:u64,owner:u64,x:f64,z:f64,water:f64}
#[derive(Default)]struct Database{homes:RefCell<BTreeMap<u64,Residence>>,needs:RefCell<BTreeMap<u64,f64>>,reads:Cell<usize>,queries:Cell<usize>}
#[derive(Default)]struct ReducerContext{db:Database,claims:HashMap<u64,HashMap<u64,u64>>,fires:RefCell<HashSet<u64>>,dispatches:RefCell<Vec<(u64,u64,f64)>>}
struct ResidenceTable<'a>{db:&'a Database}
impl Database{fn residence(&self)->ResidenceTable<'_>{ResidenceTable{db:self}}}
impl ResidenceTable<'_>{fn owner(self)->Self{self}fn id(self)->Self{self}
 fn filter(self,owner:&u64)->std::vec::IntoIter<Residence>{self.db.queries.set(self.db.queries.get()+1);let rows:Vec<_>=self.db.homes.borrow().values().filter(|r|r.owner==*owner).cloned().collect();self.db.reads.set(self.db.reads.get()+rows.len());rows.into_iter()}
 fn find(self,id:impl Borrow<u64>)->Option<Residence>{self.db.queries.set(self.db.queries.get()+1);let row=self.db.homes.borrow().get(id.borrow()).cloned();self.db.reads.set(self.db.reads.get()+usize::from(row.is_some()));row}
}
struct RoadNetwork;impl RoadNetwork{fn road_path_distances_from(&self,x:f64,z:f64,targets:&[(f64,f64)])->Vec<Option<f64>>{targets.iter().map(|&(a,b)|Some((a-x).hypot(b-z))).collect()}}
#[derive(Default)]struct SimTickContext{water_claims:RefCell<HashMap<Identity,HashMap<u64,u64>>>,water_residences_by_well:RefCell<HashMap<Identity,HashMap<u64,Vec<u64>>>>,builds:Cell<usize>,roads:HashMap<u64,RoadNetwork>}
impl SimTickContext{
 ${methods}
 fn build_water_claims(&self,ctx:&ReducerContext,owner:u64)->HashMap<u64,u64>{self.builds.set(self.builds.get()+1);ctx.claims.get(&owner).cloned().unwrap_or_default()}
 fn road_network(&self,owner:u64)->Option<&RoadNetwork>{self.roads.get(&owner)}
 fn residence_disabled_by_fire(&self,ctx:&ReducerContext,id:u64)->bool{ctx.fires.borrow().contains(&id)}
}
#[derive(Clone,Copy)]enum ResidenceNeedKind{Water}impl ResidenceNeedKind{fn is_active_for_tier(self,tier:u8)->bool{tier>=1}}
fn load_needs(ctx:&ReducerContext,id:u64)->Vec<f64>{vec![*ctx.db.needs.borrow().get(&id).unwrap_or(&0.0)]}
fn need_stock(needs:&[f64],_kind:ResidenceNeedKind)->f64{needs[0]}
fn delivery_stock_room(_kind:ResidenceNeedKind,stock:f64)->f64{(10.0-stock).max(0.0)}
struct DistributionTarget{residence_id:u64,target_stock:f64,runway_days:f64,distance:f64}
fn distribution_targets(ctx:&ReducerContext,_kind:ResidenceNeedKind,rows:&[(Residence,f64,f64)],_source:u64,distances:Vec<Option<f64>>)->Vec<DistributionTarget>{
 rows.iter().zip(distances).filter_map(|((r,target,lot),distance)|Some(DistributionTarget{residence_id:r.id,target_stock:*target,runway_days:load_needs(ctx,r.id)[0]/lot.max(1e-9),distance:distance?})).collect()}
${fn(source,'sort_distribution_targets')}
fn distribute_to_residence(ctx:&ReducerContext,_tick:&SimTickContext,well:&mut Building,id:u64,_kind:ResidenceNeedKind,target:f64){
 let mut needs=ctx.db.needs.borrow_mut();let stock=needs.entry(id).or_default();let amount=(target-*stock).max(0.0).min(well.water);
 *stock+=amount;well.water-=amount;if amount>0.0{ctx.dispatches.borrow_mut().push((well.id,id,amount));}}
mod cached{use super::*;${current}}
mod baseline{use super::*;${reference}}
fn world()->(ReducerContext,SimTickContext,Vec<Building>){let mut ctx=ReducerContext::default();let mut tick=SimTickContext::default();let mut wells=vec![];
 for owner in 0..50 {tick.roads.insert(owner,RoadNetwork);let mut claims=HashMap::new();
  for i in 0..100 {let id=owner*100+i;ctx.db.homes.borrow_mut().insert(id,Residence{id,owner,x:i as f64,z:owner as f64,abandoned:false,population:5,tier:4});ctx.db.needs.borrow_mut().insert(id,(i%8) as f64);claims.insert(id,owner*10+i%10);}
  ctx.claims.insert(owner,claims);
  for i in 0..10{wells.push(Building{id:owner*10+i,owner,x:i as f64,z:owner as f64,water:31.0});}
 }(ctx,tick,wells)}
fn run(ctx:&ReducerContext,tick:&SimTickContext,wells:&mut[Building],cached:bool){for well in wells{if cached{cached::distribute_well_water(ctx,tick,well)}else{baseline::distribute_well_water(ctx,tick,well)}}}
#[test]fn fifty_owners_keep_exact_stock_and_priority_with_fewer_returned_rows(){
 let (a,ta,mut wa)=world();let (b,tb,mut wb)=world();run(&a,&ta,&mut wa,false);run(&b,&tb,&mut wb,true);
 assert_eq!(wa,wb);assert_eq!(*a.db.needs.borrow(),*b.db.needs.borrow());assert_eq!(*a.dispatches.borrow(),*b.dispatches.borrow());
 assert_eq!(a.db.reads.get(),50000);assert_eq!(b.db.reads.get(),5000);assert_eq!(ta.builds.get(),50);assert_eq!(tb.builds.get(),50);
 println!("500 wells / 5000 homes: returned residence rows {} -> {}; identical stock and dispatch order",a.db.reads.get(),b.db.reads.get());
}
#[test]fn changed_live_eligibility_and_cached_territory_remain_authoritative(){
 let (a,ta,mut wa)=world();let (mut b,tb,mut wb)=world();
 for (ctx,tick) in [(&a,&ta),(&b,&tb)]{assert_eq!(tick.well_supplier_for(ctx,0,0),Some(0));
  ctx.db.homes.borrow_mut().remove(&0);ctx.db.homes.borrow_mut().get_mut(&10).unwrap().population=0;
  ctx.db.homes.borrow_mut().get_mut(&20).unwrap().abandoned=true;ctx.db.homes.borrow_mut().get_mut(&30).unwrap().tier=0;
  ctx.fires.borrow_mut().insert(40);ctx.db.needs.borrow_mut().insert(50,10.0);
  ctx.db.homes.borrow_mut().get_mut(&60).unwrap().x=90.0;
  ctx.db.homes.borrow_mut().get_mut(&70).unwrap().owner=1;
  ctx.db.homes.borrow_mut().insert(99999,Residence{id:99999,owner:0,x:0.0,z:0.0,abandoned:false,population:5,tier:4});
  ctx.db.needs.borrow_mut().insert(99999,0.0);
 }
 run(&a,&ta,&mut wa,false);run(&b,&tb,&mut wb,true);assert_eq!(wa,wb);assert_eq!(*a.db.needs.borrow(),*b.db.needs.borrow());assert_eq!(*a.dispatches.borrow(),*b.dispatches.borrow());
 assert_eq!(tb.well_residence_ids(&b,0,0),vec![0,10,20,30,40,50,60,70,80,90]);
 assert!(tb.well_residence_ids(&b,1,0).is_empty());let mut borrowed=tb.well_residence_ids(&b,0,0);borrowed.clear();
 assert_eq!(tb.well_residence_ids(&b,0,0).len(),10);
 b.claims.get_mut(&0).unwrap().remove(&0);b.claims.get_mut(&0).unwrap().remove(&70);b.claims.get_mut(&0).unwrap().insert(99999,0);
 let fresh=SimTickContext{roads:HashMap::from([(0,RoadNetwork)]),..Default::default()};
 assert_eq!(fresh.well_residence_ids(&b,0,0),vec![10,20,30,40,50,60,80,90,99999]);
}
#[test]fn dry_wells_and_absent_roads_do_not_build_territory(){
 let (ctx,mut tick,mut wells)=world();wells[0].water=0.0;cached::distribute_well_water(&ctx,&tick,&mut wells[0]);assert_eq!(tick.builds.get(),0);
 wells[0].water=1.0;tick.roads.remove(&0);cached::distribute_well_water(&ctx,&tick,&mut wells[0]);assert_eq!(tick.builds.get(),0);assert_eq!(ctx.db.reads.get(),0);
}
`;
const dir='.tmp-well-residence-index-tests';mkdirSync(dir,{recursive:true});const file=join(dir,'well_index.rs'),binary=join(dir,'well_index.exe');writeFileSync(file,code);
for(const [command,args] of [['rustc',['--edition=2021','--test','-O',file,'-o',binary]],[binary,['--nocapture']]]){
 const r=spawnSync(command,args,{encoding:'utf8',windowsHide:true});if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);assert.equal(r.status,0,r.error?.message||'Well territory regression failed');}
