import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
// Run the actual read-only matcher with table/route adapters. Supply-policy
// arithmetic and live cargo dispatch have their own tests; this checks caching.
const source = readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
const start = source.indexOf('pub fn step_local_material_dispatch(');
assert(start >= 0);
let opening = source.indexOf('{', start), cursor = opening + 1, depth = 1;
for (; cursor < source.length && depth; cursor++) {
  if (source[cursor] === '{') depth++;
  if (source[cursor] === '}') depth--;
}
assert.equal(depth, 0);
const matcher = source.slice(start, cursor).replace(/^pub fn /, 'fn ');
const reference = matcher.replace('step_local_material_dispatch(', 'uncached_material_dispatch(')
  .replace('for target_id in tick.building_ids_for_kinds(ctx, source.owner, target_kinds) {',
    'for target_id in tick.building_ids_for_kinds(ctx, source.owner, target_kinds) { target_rows.clear(); target_inbound.clear(); target_plans.clear();');
assert.notEqual(reference, matcher);
assert.match(reference, /target_rows.clear\(\)/);
const code = `
use std::collections::{HashMap, HashSet};
use std::cell::{Cell, RefCell};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CommodityKind { Stone, Ironwork, Charcoal }
impl CommodityKind { fn as_u8(self) -> u8 { self as u8 } }
const LOCAL_MATERIAL_COMMODITIES: &[CommodityKind] = &[CommodityKind::Stone, CommodityKind::Ironwork, CommodityKind::Charcoal];
const LOCAL_MATERIAL_SOURCE_KINDS: &[&str] = &["mine", "village_storehouse", "trading_post"];
#[derive(Clone, Copy, Debug, PartialEq)]
enum ProcessorInputDispatchDuty { WorkingBuffer }
#[derive(Clone, Debug, PartialEq)]
struct Building {
 id: u64, owner: u64, kind: String, construction_complete: bool, assigned_labor: u32,
 x: f64, z: f64, stock: [f64;3], cap: [f64;3], requests: [bool;3], accepts: [bool;3],
 maintenance: bool, disabled: bool, busy: bool, inbound: bool,
}
#[derive(Clone, Debug, PartialEq)]
struct LocalMaterialDispatchCandidate { source_id:u64, building:Building, commodity:CommodityKind,
 distance:f64, duty:ProcessorInputDispatchDuty, desired_stock:f64, runway_cycles:f64 }
#[derive(Default)]
struct Database { rows:Vec<Building>, reads:Cell<usize>, inbound_reads:Cell<usize>, maintenance_reads:Cell<usize> }
#[derive(Default)]
struct ReducerContext { db:Database, candidates:RefCell<Vec<LocalMaterialDispatchCandidate>> }
struct BuildingIndex<'a>(&'a Database);
impl Database { fn building(&self) -> BuildingIndex<'_> { BuildingIndex(self) } }
impl<'a> BuildingIndex<'a> {
 fn id(self) -> Self { self }
 fn find(self, id:&u64) -> Option<Building> {
   self.0.reads.set(self.0.reads.get()+1);
   self.0.rows.iter().find(|r| r.id==*id).cloned()
 }
}
struct RoadNetwork;
struct SimTickContext { network:RoadNetwork }
impl Default for SimTickContext { fn default() -> Self { Self { network:RoadNetwork } } }
impl SimTickContext {
 fn road_network(&self, _owner:u64) -> Option<&RoadNetwork> { Some(&self.network) }
 fn building_disabled_by_fire(&self, ctx:&ReducerContext, id:u64) -> bool {
   ctx.db.rows.iter().find(|r| r.id==id).is_some_and(|r| r.disabled)
 }
 fn building_ids_for_kinds(&self, ctx:&ReducerContext, owner:u64, kinds:&[&str]) -> Vec<u64> {
   let mut ids:Vec<_> = ctx.db.rows.iter().filter(|r| r.owner==owner && kinds.contains(&r.kind.as_str())).map(|r| r.id).collect();
   ids.push(999999); ids
 }
}
struct GameClock;
#[derive(Clone, Copy)]
struct EnvironmentState;
fn marketplace_fuel_shortfalls(_ctx:&ReducerContext, _tick:&SimTickContext, _env:EnvironmentState) -> HashMap<u64,f64> { HashMap::new() }
fn labor_and_logistics_paused(_ctx:&ReducerContext, _tick:&SimTickContext, _owner:u64, _clock:&GameClock) -> bool { false }
fn building_has_active_trip(ctx:&ReducerContext, id:u64) -> bool { ctx.db.rows.iter().find(|r| r.id==id).is_some_and(|r| r.busy) }
fn trading_post_exports_commodity(_ctx:&ReducerContext, _id:u64, _c:CommodityKind) -> bool { false }
fn local_material_target_kinds(_source:&Building, _c:CommodityKind) -> Option<&'static [&'static str]> {
 Some(&["processor", "village_storehouse", "mine", "trading_post"])
}
fn building_commodity_stock(b:&Building, c:CommodityKind) -> f64 { b.stock[c as usize] }
fn building_commodity_room(b:&Building, c:CommodityKind) -> f64 { (b.cap[c as usize]-b.stock[c as usize]).max(0.) }
fn processor_requests_input(b:&Building, c:CommodityKind) -> bool { b.requests[c as usize] }
fn processor_accepts_input(b:&Building, c:CommodityKind) -> bool { b.accepts[c as usize] }
fn extraction_accepts_maintenance_input(ctx:&ReducerContext, b:&Building, _c:CommodityKind) -> bool {
 ctx.db.maintenance_reads.set(ctx.db.maintenance_reads.get()+1); b.maintenance
}
fn building_has_inbound_supply_trip(ctx:&ReducerContext, id:u64) -> bool {
 ctx.db.inbound_reads.set(ctx.db.inbound_reads.get()+1);
 ctx.db.rows.iter().find(|r| r.id==id).is_some_and(|r| r.inbound)
}
fn local_material_target_plan(b:&Building, c:CommodityKind) -> Option<(ProcessorInputDispatchDuty,f64,f64)> {
 let stock=b.stock[c as usize]; let desired=b.cap[c as usize]*0.8;
 (stock<desired).then_some((ProcessorInputDispatchDuty::WorkingBuffer,desired,stock/10.))
}
fn storehouse_charcoal_transit_plan(_ctx:&ReducerContext,_tick:&SimTickContext,b:&Building,_shortfalls:&HashMap<u64,f64>)
 -> Option<(ProcessorInputDispatchDuty,f64,f64)> { local_material_target_plan(b,CommodityKind::Charcoal) }
fn local_delivery_distance(_net:&RoadNetwork,ax:f64,az:f64,bx:f64,bz:f64) -> Option<f64> {
 let d=(bx-ax).hypot(bz-az); d.is_finite().then_some(d)
}
fn sort_local_material_candidates(candidates:&mut [LocalMaterialDispatchCandidate]) {
 candidates.sort_by(|a,b| a.source_id.cmp(&b.source_id).then(a.building.id.cmp(&b.building.id)).then(a.commodity.as_u8().cmp(&b.commodity.as_u8())));
}
fn dispatch_local_material_candidates(ctx:&ReducerContext,_tick:&SimTickContext,_clock:&GameClock,
 candidates:Vec<LocalMaterialDispatchCandidate>,_sources:&mut HashSet<u64>,_targets:&mut HashSet<u64>) {
 *ctx.candidates.borrow_mut()=candidates;
}
${matcher}
${reference}
fn row(id:u64, owner:u64, kind:&str) -> Building {
 Building { id,owner,kind:kind.into(),construction_complete:true,assigned_labor:1,x:id as f64,z:owner as f64,
 stock:[10.;3],cap:[100.;3],requests:[true;3],accepts:[true;3],maintenance:true,disabled:false,busy:false,inbound:false }
}
fn reset_counts(ctx:&ReducerContext) { ctx.db.reads.set(0);ctx.db.inbound_reads.set(0);ctx.db.maintenance_reads.set(0); }
#[test]
fn matching_preserves_every_candidate_with_bounded_destination_reads() {
 let mut ctx=ReducerContext::default();let mut sources=Vec::new();
 for owner in 1..=5 { for n in 0..20 {
  let mut s=row(owner*100+n,owner,if n%2==0 {"mine"} else {"village_storehouse"});
  s.requests=[false;3];s.busy=n%11==0;s.construction_complete=n%13!=0;s.disabled=n%17==0;
  sources.push(s.clone());ctx.db.rows.push(s);
 }}
 for owner in 1..=5 { for n in 0..32 {
  let mut t=row(10000+owner*100+n,owner,if n%4==0 {"village_storehouse"} else if n%7==0 {"trading_post"} else {"processor"});
  t.stock=[(n*3) as f64,(n*2) as f64,(n*5) as f64];
  t.requests=[n%3!=0,n%4!=0,n%5!=0];t.accepts=[true,n%8!=0,true];
  t.disabled=n%11==0;t.construction_complete=n%9!=0;t.inbound=n%6==0;t.maintenance=n%10!=0;
  ctx.db.rows.push(t);
 }}
 let tick=SimTickContext::default();
 step_local_material_dispatch(&ctx,&tick,&GameClock,EnvironmentState,sources.clone());
 let cached=ctx.candidates.borrow().clone();let cached_reads=ctx.db.reads.get();let cached_inbound=ctx.db.inbound_reads.get();let cached_maintenance=ctx.db.maintenance_reads.get();
 assert!(!cached.is_empty());assert!(cached_reads<=ctx.db.rows.len()+1);
 reset_counts(&ctx);
 uncached_material_dispatch(&ctx,&tick,&GameClock,EnvironmentState,sources);
 assert_eq!(cached,*ctx.candidates.borrow());
 assert!(ctx.db.reads.get()>cached_reads*20);
 assert!(ctx.db.inbound_reads.get()>cached_inbound*10);
 assert!(ctx.db.maintenance_reads.get()>cached_maintenance*10);
 println!("candidate parity: {} pairs; destination reads {} -> {}; inbound checks {} -> {}; maintenance checks {} -> {}",
   cached.len(),ctx.db.reads.get(),cached_reads,ctx.db.inbound_reads.get(),cached_inbound,ctx.db.maintenance_reads.get(),cached_maintenance);
}
#[test]
fn destination_state_is_refreshed_in_the_next_matching_phase() {
 let mut ctx=ReducerContext::default();let mut source=row(1,1,"mine");source.requests=[false;3];
 let target=row(2,1,"processor");ctx.db.rows=vec![source.clone(),target];let tick=SimTickContext::default();
 step_local_material_dispatch(&ctx,&tick,&GameClock,EnvironmentState,vec![source.clone()]);
 assert_eq!(ctx.candidates.borrow().len(),3);
 ctx.db.rows[1].stock=[100.;3];
 step_local_material_dispatch(&ctx,&tick,&GameClock,EnvironmentState,vec![source.clone()]);
 assert!(ctx.candidates.borrow().is_empty());
 ctx.db.rows[1].stock=[0.;3];ctx.db.rows[1].inbound=true;
 step_local_material_dispatch(&ctx,&tick,&GameClock,EnvironmentState,vec![source.clone()]);
 assert!(ctx.candidates.borrow().is_empty());
 ctx.db.rows[1].inbound=false;
 step_local_material_dispatch(&ctx,&tick,&GameClock,EnvironmentState,vec![source]);
 assert_eq!(ctx.candidates.borrow().len(),3);
}
`;
const directory = '.tmp-material-candidate-tests'; mkdirSync(directory, { recursive: true });
const rust = join(directory, 'material_candidate.rs'), executable = join(directory, 'material_candidate.exe');
writeFileSync(rust, code);
for (const [command, args] of [['rustc', ['--edition=2021', '--test', rust, '-o', executable]], [executable, ['--nocapture']]]) {
 const result = spawnSync(command, args, { encoding:'utf8', windowsHide:true });
 if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
 assert.equal(result.status,0,result.error?.message??'Material candidate parity failed');
}
