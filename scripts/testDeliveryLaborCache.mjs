import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

function functionSource(source, name) {
  const start = source.search(new RegExp(`(?:pub(?:\\(crate\\))? )?fn ${name}\\(`));
  assert(start >= 0, `Missing actual Rust function ${name}`);
  const opening = source.indexOf('{', start); let depth = 1, cursor = opening + 1;
  for (; depth && cursor < source.length; cursor++) {
    if (source[cursor] === '{') depth++; else if (source[cursor] === '}') depth--;
  }
  assert.equal(depth, 0); return source.slice(start, cursor);
}
const trips = readFileSync('server/src/simulation/delivery_trips.rs', 'utf8');
const population = readFileSync('server/src/economy/population.rs', 'utf8');
const cache = readFileSync('server/src/economy/delivery_labor.rs', 'utf8')
  .replace('//! Cart labor totals shared by one production phase, with live mutation updates.', '')
  .replace('use spacetimedb::', 'use crate::spacetimedb::');
const free = functionSource(population, 'total_free_hauler_labor').replace(/^fn /, 'pub(crate) fn ');
const uncachedFree = free.replace('total_free_hauler_labor(', 'uncached_free_labor(')
  .replace(/    if let Some\(workers\) = super::delivery_labor::cached_free_hauler_labor\(ctx, owner\) \{\s*return workers;\s*\}\s*/, '');
const onsite = functionSource(trips, 'onsite_building_labor');
const uncachedOnsite = onsite.replace('onsite_building_labor(', 'uncached_onsite_labor(')
  .replace(/    if let Some\(workers\) = crate::economy::cached_rostered_cart_labor\(ctx, building.id\) \{\s*return building.assigned_labor.saturating_sub\(workers\);\s*\}\s*/, '');
assert.notEqual(free, uncachedFree); assert.notEqual(onsite, uncachedOnsite);
assert.equal((trips.match(/delivery_trip\(\)\.insert\(DeliveryTrip/g) ?? []).length, 2);
assert.equal((trips.match(/record_delivery_trip_started\(&trip\)/g) ?? []).length, 2);
assert.equal((trips.match(/delivery_trip\(\)\.id\(\)\.delete\(trip.id\)/g) ?? []).length,
  (trips.match(/if ctx.db.delivery_trip\(\)\.id\(\)\.delete\(trip.id\) \{\s*crate::economy::record_delivery_trip_finished\(&trip\)/g) ?? []).length,
  'Every actual deletion must update labor only when the table confirms deletion');
assert.match(population, /ProductionLaborCache \{ _delivery_labor: super::delivery_labor::cache_delivery_labor\(\) \}/);
const code = `
use std::cell::{Cell,RefCell};
#[derive(Clone,Debug)]
pub struct DeliveryTrip { id:u64, owner:u64, building_id:u64, labor_building_id:u64, delivery_workers:u32, free_hauler_workers:u32 }
pub struct Building { id:u64, assigned_labor:u32 }
#[derive(Default)]
pub struct Database { rows:RefCell<Vec<DeliveryTrip>>, reads:Cell<usize>, queries:Cell<usize> }
#[derive(Default)]
pub struct ReducerContext { db:Database }
mod spacetimedb { pub type Identity=u64; pub use crate::ReducerContext; }
mod db {}
mod tables { pub use crate::DeliveryTrip; }
#[derive(Clone,Copy)]
enum IndexKind { Id,Owner,Labor,Origin }
struct TripTable<'a> { db:&'a Database, index:IndexKind }
impl Database { fn delivery_trip(&self) -> TripTable<'_> { TripTable {db:self,index:IndexKind::Id} } }
impl<'a> TripTable<'a> {
 fn id(self) -> Self { Self { index:IndexKind::Id,..self } }
 fn owner(self) -> Self { Self { index:IndexKind::Owner,..self } }
 fn labor_building_id(self) -> Self { Self { index:IndexKind::Labor,..self } }
 fn building_id(self) -> Self { Self { index:IndexKind::Origin,..self } }
 fn iter(self) -> std::vec::IntoIter<DeliveryTrip> {
  self.db.queries.set(self.db.queries.get()+1);self.db.reads.set(self.db.reads.get()+self.db.rows.borrow().len());
  self.db.rows.borrow().clone().into_iter()
 }
 fn filter(self,id:&u64) -> std::vec::IntoIter<DeliveryTrip> {
  self.db.queries.set(self.db.queries.get()+1);
  let rows:Vec<_>=self.db.rows.borrow().iter().filter(|t| match self.index {
   IndexKind::Id=>t.id==*id, IndexKind::Owner=>t.owner==*id,IndexKind::Labor=>t.labor_building_id==*id,IndexKind::Origin=>t.building_id==*id,
  }).cloned().collect();self.db.reads.set(self.db.reads.get()+rows.len());rows.into_iter()
 }
 fn update(self,trip:DeliveryTrip) { let mut rows=self.db.rows.borrow_mut();let row=rows.iter_mut().find(|r| r.id==trip.id).unwrap();*row=trip; }
}
mod economy {
 use crate::*;
 pub(crate) mod delivery_labor { ${cache} }
 pub(crate) use delivery_labor::{cached_rostered_cart_labor,invalidate_delivery_labor,record_delivery_trip_started,record_delivery_trip_finished};
 pub(crate) mod population { use crate::*; ${free} ${uncachedFree} }
}
${onsite}
${uncachedOnsite}
${functionSource(trips, 'rostered_cart_workers')}
${functionSource(trips, 'preserve_in_transit_cart_labor')}

fn trip(id:u64,owner:u64,building:u64,labor:u64,workers:u32,free:u32)->DeliveryTrip {
 DeliveryTrip {id,owner,building_id:building,labor_building_id:labor,delivery_workers:workers,free_hauler_workers:free}
}
fn assert_parity(ctx:&ReducerContext) {
 for owner in 0..=51 { assert_eq!(economy::population::total_free_hauler_labor(ctx,owner),economy::population::uncached_free_labor(ctx,owner)); }
 for id in 1..=150 { for assigned in [0,1,2,5,15] {
  let building=Building{id,assigned_labor:assigned};assert_eq!(onsite_building_labor(ctx,&building),uncached_onsite_labor(ctx,&building));
 }}
}
#[test]
fn one_phase_matches_live_queries_and_reads_cart_rows_once() {
 let ctx=ReducerContext::default();
 for owner in 1..=50 { for slot in 0..20 {
  let building=(owner-1)*3+slot%3+1;
  ctx.db.rows.borrow_mut().push(trip(owner*100+slot,owner,building,if slot%4==0 {0}else{building},(slot%6) as u32,(slot%3) as u32));
 }}
 let phase=economy::delivery_labor::cache_delivery_labor();
 for _ in 0..20 { for owner in 1..=50 { economy::population::total_free_hauler_labor(&ctx,owner); }
  for id in 1..=150 { onsite_building_labor(&ctx,&Building{id,assigned_labor:5}); }
 }
 let cached_reads=ctx.db.reads.get();let cached_queries=ctx.db.queries.get();
 assert_eq!(cached_reads,1000);assert_eq!(cached_queries,1);
 ctx.db.reads.set(0);ctx.db.queries.set(0);
 for _ in 0..20 { for owner in 1..=50 { economy::population::uncached_free_labor(&ctx,owner); }
  for id in 1..=150 { uncached_onsite_labor(&ctx,&Building{id,assigned_labor:5}); }
 }
 println!("4000 actual labor queries: cart row reads {} -> {}; table queries {} -> {}",ctx.db.reads.get(),cached_reads,ctx.db.queries.get(),cached_queries);
 assert!(ctx.db.reads.get()>cached_reads*20);assert!(ctx.db.queries.get()>cached_queries*1000);
 assert_parity(&ctx);drop(phase);
}
#[test]
fn starts_returns_and_actual_crew_preemption_are_visible_immediately() {
 let ctx=ReducerContext::default();let phase=economy::delivery_labor::cache_delivery_labor();
 // Cold insert notifications do not force a premature scan.
 let a=trip(1,1,1,1,4,0);ctx.db.rows.borrow_mut().push(a.clone());economy::record_delivery_trip_started(&a);
 assert_eq!(ctx.db.queries.get(),0);assert_parity(&ctx);
 let b=trip(2,1,2,0,3,3);ctx.db.rows.borrow_mut().push(b.clone());economy::record_delivery_trip_started(&b);
 let c=trip(3,2,3,1,5,2);ctx.db.rows.borrow_mut().push(c.clone());economy::record_delivery_trip_started(&c);
 assert_parity(&ctx);
 let previous_reads=ctx.db.reads.get();
 assert_eq!(economy::population::total_free_hauler_labor(&ctx,1),3);
 assert_eq!(onsite_building_labor(&ctx,&Building{id:1,assigned_labor:12}),5);
 assert_eq!(ctx.db.reads.get(),previous_reads,"New carts must not cause another table scan");
 assert_eq!(preserve_in_transit_cart_labor(&ctx,1,2),5,"Use the actual crew-transfer mutation");
 assert_parity(&ctx);
 // Cargo/position/phase edits leave labor ownership unchanged and need no invalidation.
 ctx.db.rows.borrow_mut().retain(|t|t.id!=b.id);economy::record_delivery_trip_finished(&b);assert_parity(&ctx);
 let changed=ctx.db.rows.borrow().iter().find(|t|t.id==a.id).unwrap().clone();
 ctx.db.rows.borrow_mut().retain(|t|t.id!=a.id);economy::record_delivery_trip_finished(&changed);assert_parity(&ctx);
 drop(phase);
 ctx.db.rows.borrow_mut().clear();
 let next=economy::delivery_labor::cache_delivery_labor();assert_parity(&ctx);drop(next);
 assert_eq!(economy::delivery_labor::cached_rostered_cart_labor(&ctx,1),None,"No cache leaks into another reducer or outside the phase");
 let outside=trip(4,1,1,1,4,2);ctx.db.rows.borrow_mut().push(outside.clone());economy::record_delivery_trip_started(&outside);
 assert_eq!(economy::population::total_free_hauler_labor(&ctx,1),2);
 assert_eq!(onsite_building_labor(&ctx,&Building{id:1,assigned_labor:3}),1,"Ordinary unguarded reducers keep live table reads");
}
#[test]
fn long_mixed_dispatch_sequence_matches_uncached_labor_after_every_event() {
 let ctx=ReducerContext::default();let _phase=economy::delivery_labor::cache_delivery_labor();
 let mut seed=0xfeed1234u64;let mut next_id=1;
 for event in 0..600 {
  seed=seed.wrapping_mul(6364136223846793005).wrapping_add(1);
  let operation=(seed>>33)%3;
  if operation==0 || ctx.db.rows.borrow().is_empty() {
   let workers=((seed>>17)%8) as u32;let free=((seed>>24)%u64::from(workers+1)) as u32;
   let building=(seed>>9)%12+1;
   let row=trip(next_id,(seed>>6)%4+1,building,if seed%4==0 {0}else{building},workers,free);
   next_id+=1;ctx.db.rows.borrow_mut().push(row.clone());economy::record_delivery_trip_started(&row);
  } else if operation==1 {
   let index=seed as usize%ctx.db.rows.borrow().len();let row=ctx.db.rows.borrow_mut().remove(index);
   economy::record_delivery_trip_finished(&row);
  } else {
   preserve_in_transit_cart_labor(&ctx,(seed>>9)%12+1,((seed>>18)%6) as u32);
  }
  for owner in 1..=4 {
   assert_eq!(economy::population::total_free_hauler_labor(&ctx,owner),economy::population::uncached_free_labor(&ctx,owner),"owner {owner}, event {event}");
  }
  for id in 1..=12 { for assigned in [0,1,3,8] {
   let building=Building{id,assigned_labor:assigned};
   assert_eq!(onsite_building_labor(&ctx,&building),uncached_onsite_labor(&ctx,&building),"building {id}, event {event}");
  }}
 }
}
`;
const directory='.tmp-delivery-labor-cache-tests';mkdirSync(directory,{recursive:true});
const source=join(directory,'delivery_labor.rs'),binary=join(directory,'delivery_labor.exe');writeFileSync(source,code);
for(const [command,args] of [['rustc',['--edition=2021','--test','-O',source,'-o',binary]],[binary,['--nocapture']]]) {
 const result=spawnSync(command,args,{encoding:'utf8',windowsHide:true});
 if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
 assert.equal(result.status,0,result.error?.message??'Delivery labor parity failed');
}
