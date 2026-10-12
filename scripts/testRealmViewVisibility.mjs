import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Run the actual Rust view functions with counting, read-only table adapters.
// The reference retains the former per-resource primary-key fog lookup.
const realmSource = readFileSync('server/src/realm.rs', 'utf8').replaceAll('\r\n', '\n');
const viewSource = readFileSync('server/src/client_views.rs', 'utf8');
const policySource = readFileSync('server/src/realm_policy.rs', 'utf8');
function rustFunction(source, name) {
  const match = new RegExp(`(?:pub(?:\\(crate\\))? )?fn ${name}\\(`).exec(source);
  assert(match, `Missing Rust function ${name}`);
  const opening = source.indexOf('{', match.index);
  let depth = 1, cursor = opening + 1;
  for (; cursor < source.length && depth; cursor++) {
    if (source[cursor] === '{') depth++;
    if (source[cursor] === '}') depth--;
  }
  assert.equal(depth, 0);
  return source.slice(match.index, cursor);
}
const snapshotStart = realmSource.indexOf('#[derive(Default)]\npub(crate) struct ViewVisibility');
assert(snapshotStart >= 0, 'Missing Rust visibility snapshot');
const snapshotFunction = rustFunction(realmSource, 'view_visibility');
const snapshotEnd = realmSource.indexOf(snapshotFunction, snapshotStart) + snapshotFunction.length;
const snapshot = realmSource.slice(snapshotStart, snapshotEnd);
assert.match(snapshot, /pub\(crate\) fn view_visibility/);
const constants = ['WORLD_SIZE', 'CHUNK_SIZE', 'CHUNKS_PER_SIDE', 'FOG_CELL_SIZE', 'CELLS_PER_CHUNK']
  .map(name => { const line = policySource.match(new RegExp(`pub const ${name}: [^;]+;`)); assert(line); return line[0]; }).join('\n');
const code = `
#![allow(dead_code, private_interfaces)]
use std::cell::Cell;
use std::collections::BTreeMap;
use std::ops::RangeInclusive;
#[derive(Clone, Debug, PartialEq)]
struct RealmFog { owner:u64, chunk:u32, explored:u64, visible:u64 }
#[derive(Clone)] struct RealmInterest { owner:u64, chunk:u32 }
#[derive(Clone, Debug, PartialEq)]
struct Resource { chunk:u32, x:f64, z:f64, tree_id:String, quarry_id:String, node_id:String }
type TreeEntity = Resource; type Quarry = Resource; type ForagingNode = Resource;
#[derive(Clone, Debug, PartialEq)] struct RealmEntity { id:String, owner:u64, chunk:u32, x:f64, z:f64 }
#[derive(Clone, Debug, PartialEq)] struct CombatAgent { id:u64, owner:u64, faction:u8, x:f64, z:f64 }
#[derive(Default)]
struct Db {
 fog:Vec<RealmFog>, interests:Vec<RealmInterest>, resources:Vec<Resource>, entities:Vec<RealmEntity>, combat:Vec<CombatAgent>,
 fog_ranges:Cell<usize>, fog_points:Cell<usize>, resource_ranges:Cell<usize>
}
struct ViewContext<'a> { db:&'a Db, owner:u64 }
impl ViewContext<'_> { fn sender(&self)->u64 { self.owner } }
struct InterestTable<'a>(&'a Db); struct FogTable<'a>(&'a Db);
struct ResourceTable<'a>(&'a Db); struct EntityTable<'a>(&'a Db); struct CombatTable<'a>(&'a Db);
impl Db {
 fn realm_interest(&self)->InterestTable<'_> { InterestTable(self) }
 fn realm_fog(&self)->FogTable<'_> { FogTable(self) }
 fn quarry(&self)->ResourceTable<'_> { ResourceTable(self) }
 fn foraging_node(&self)->ResourceTable<'_> { ResourceTable(self) }
 fn tree_entity(&self)->ResourceTable<'_> { ResourceTable(self) }
 fn realm_entity(&self)->EntityTable<'_> { EntityTable(self) }
 fn combat_agent(&self)->CombatTable<'_> { CombatTable(self) }
 fn reset_counts(&self) { self.fog_ranges.set(0); self.fog_points.set(0); self.resource_ranges.set(0); }
}
impl InterestTable<'_> {
 fn owner(&self)->Self { Self(self.0) }
 fn find(&self, owner:u64)->Option<RealmInterest> { self.0.interests.iter().find(|r|r.owner==owner).cloned() }
}
impl FogTable<'_> {
 fn owner(&self)->Self { Self(self.0) } fn id(&self)->Self { Self(self.0) }
 fn filter(&self, owner:u64)->std::vec::IntoIter<RealmFog> {
  self.0.fog_ranges.set(self.0.fog_ranges.get()+1);
  self.0.fog.iter().filter(|r|r.owner==owner).cloned().collect::<Vec<_>>().into_iter()
 }
 fn find(&self, id:String)->Option<RealmFog> {
  self.0.fog_points.set(self.0.fog_points.get()+1);
  self.0.fog.iter().find(|r|format!("{}:{}",r.owner,r.chunk)==id).cloned()
 }
}
enum ChunkSelection { One(u32), Range(RangeInclusive<u32>) }
impl From<u32> for ChunkSelection { fn from(v:u32)->Self { Self::One(v) } }
impl From<RangeInclusive<u32>> for ChunkSelection { fn from(v:RangeInclusive<u32>)->Self { Self::Range(v) } }
impl ChunkSelection { fn contains(&self,c:u32)->bool { match self {Self::One(v)=>*v==c, Self::Range(v)=>v.contains(&c)} } }
impl ResourceTable<'_> {
 fn chunk_id(&self)->Self { Self(self.0) }
 fn filter(&self, chunk:impl Into<ChunkSelection>)->std::vec::IntoIter<Resource> {
  self.0.resource_ranges.set(self.0.resource_ranges.get()+1); let chunk=chunk.into();
  self.0.resources.iter().filter(|r|chunk.contains(r.chunk)).cloned().collect::<Vec<_>>().into_iter()
 }
}
impl EntityTable<'_> {
 fn chunk(&self)->Self { Self(self.0) }
 fn filter(&self, chunk:u32)->std::vec::IntoIter<RealmEntity> {
  self.0.entities.iter().filter(|r|r.chunk==chunk).cloned().collect::<Vec<_>>().into_iter()
 }
}
impl CombatTable<'_> {
 fn owner(&self)->Self { Self(self.0) }
 fn filter(&self, owner:u64)->std::vec::IntoIter<CombatAgent> {
  self.0.combat.iter().filter(|r|r.owner==owner).cloned().collect::<Vec<_>>().into_iter()
 }
}
mod realm {
 use super::*;
 pub const ENABLED:bool = !cfg!(single_player);
 ${constants}
 ${rustFunction(policySource, 'world_chunk')}
 ${rustFunction(policySource, 'chunk_bounds')}
 ${rustFunction(policySource, 'fog_bit')}
 ${snapshot}
}
use realm::view_visibility;
${['visible_quarry','visible_foraging_node','visible_tree_entity','visible_combat_agent'].map(name=>rustFunction(viewSource,name)).join('\n')}
${rustFunction(realmSource,'visible_realm_entity')}
fn old_chunks(ctx:&ViewContext)->Vec<u32> {
 let Some(interest)=ctx.db.realm_interest().owner().find(ctx.sender()) else { return vec![]; };
 let cx=(interest.chunk%48) as i32; let cz=(interest.chunk/48) as i32;
 ctx.db.realm_fog().owner().filter(ctx.sender()).filter(|f|f.explored!=0
  && ((f.chunk%48) as i32-cx).abs()<=4 && ((f.chunk/48) as i32-cz).abs()<=4).map(|f|f.chunk).collect()
}
fn old_visible(ctx:&ViewContext,x:f64,z:f64)->bool {
 if !realm::ENABLED { return true; }
 let Some((chunk,bit))=realm::fog_bit(x,z) else { return false; };
 ctx.db.realm_fog().id().find(format!("{}:{chunk}",ctx.sender())).is_some_and(|f|f.visible&bit!=0)
}
fn reference_resources(ctx:&ViewContext)->Vec<Resource> {
 if !realm::ENABLED { return ctx.db.tree_entity().chunk_id().filter(0u32..=u32::MAX).collect(); }
 let mut rows=BTreeMap::new();
 for chunk in old_chunks(ctx) { for row in ctx.db.tree_entity().chunk_id().filter(chunk) {
  if old_visible(ctx,row.x,row.z) { rows.insert(row.tree_id.clone(),row); }
 }} rows.into_values().collect()
}
fn reference_entities(ctx:&ViewContext)->Vec<RealmEntity> {
 let fog:BTreeMap<_,_>=ctx.db.realm_fog().owner().filter(ctx.sender()).map(|f|(f.chunk,f.visible)).collect();
 old_chunks(ctx).into_iter().flat_map(|c|ctx.db.realm_entity().chunk().filter(c)).filter(|e|e.owner!=ctx.sender()
  && realm::fog_bit(e.x,e.z).is_some_and(|(c,b)|fog.get(&c).is_some_and(|m|m&b!=0))).collect()
}
fn reference_combat(ctx:&ViewContext)->Vec<CombatAgent> {
 ctx.db.combat_agent().owner().filter(ctx.sender()).filter(|a|a.faction==0||a.faction>=3||old_visible(ctx,a.x,a.z)).collect()
}
fn fixture()->Db {
 let mut db=Db::default(); let center=24*48+24;
 db.interests=vec![RealmInterest{owner:1,chunk:center},RealmInterest{owner:2,chunk:center+1}];
 for z in 18..31 { for x in 18..31 {
  let chunk=z*48+x; let visible=match chunk%5 {0=>0,1=>u64::MAX,_=>0x5555_aaaa_5555_aaaa};
  db.fog.push(RealmFog{owner:1,chunk,explored:if chunk%7==0 {0}else{u64::MAX},visible});
  db.fog.push(RealmFog{owner:2,chunk,explored:u64::MAX,visible:u64::MAX});
  for bit in 0..64 {
   let px=x as f64*256.0-6144.0+(bit%8) as f64*32.0+16.0;
   let pz=z as f64*256.0-6144.0+(bit/8) as f64*32.0+16.0;
   let id=format!("{chunk:04}:{bit:02}");
   db.resources.push(Resource{chunk,x:px,z:pz,tree_id:id.clone(),quarry_id:id.clone(),node_id:id.clone()});
   db.entities.push(RealmEntity{id,owner:if bit%3==0{1}else{2},chunk,x:px,z:pz});
   if chunk==center { db.combat.push(CombatAgent{id:bit,owner:if bit%4==0{2}else{1},faction:(bit%5) as u8,x:px,z:pz}); }
  }
 }}
 // The coordinate-based check must also preserve the old result if an indexed
 // row points at a different chunk. Never substitute its index for its position.
 db.fog.push(RealmFog{owner:1,chunk:0,explored:0,visible:1});
 db.resources.push(Resource{chunk:center,x:-6128.0,z:-6128.0,tree_id:"misindexed".into(),quarry_id:"misindexed".into(),node_id:"misindexed".into()});
 db
}
#[test]
#[cfg(not(single_player))]
fn resource_and_entity_rows_match_without_per_row_fog_reads() {
 let db=fixture(); let ctx=ViewContext{db:&db,owner:1};
 let expected=reference_resources(&ctx); let old_points=db.fog_points.get(); let old_ranges=db.resource_ranges.get();
 assert!(!expected.is_empty()); assert!(old_points>4000);
 for view in [visible_quarry,visible_foraging_node,visible_tree_entity] {
  db.reset_counts(); assert_eq!(view(&ctx),expected); assert_eq!(db.fog_points.get(),0);
  assert_eq!(db.fog_ranges.get(),1); assert_eq!(db.resource_ranges.get(),old_ranges);
 }
 db.reset_counts(); let entities=reference_entities(&ctx); assert_eq!(db.fog_ranges.get(),2);
 db.reset_counts(); assert_eq!(visible_realm_entity(&ctx),entities); assert_eq!(db.fog_ranges.get(),1);
 let agents=reference_combat(&ctx); db.reset_counts(); assert_eq!(visible_combat_agent(&ctx),agents);
 assert_eq!(db.fog_points.get(),0); assert_eq!(db.fog_ranges.get(),1);
 println!("view parity: {} resource rows, {} foreign entities; fog point reads {} -> 0 per resource view",expected.len(),entities.len(),old_points);
}
#[test]
#[cfg(not(single_player))]
fn snapshots_are_private_and_refresh_after_fog_or_camera_changes() {
 let mut db=fixture();
 let first=visible_tree_entity(&ViewContext{db:&db,owner:1});
 let second=visible_tree_entity(&ViewContext{db:&db,owner:2}); assert_ne!(first,second);
 db.fog.iter_mut().filter(|f|f.owner==1).for_each(|f|f.visible=0);
 assert!(visible_tree_entity(&ViewContext{db:&db,owner:1}).is_empty());
 assert_eq!(visible_tree_entity(&ViewContext{db:&db,owner:2}),second);
 db.fog.iter_mut().filter(|f|f.owner==1).for_each(|f|f.visible=u64::MAX);
 let fog_before=db.fog.clone(); db.interests[0].chunk=0;
 let ctx=ViewContext{db:&db,owner:1}; assert!(visible_tree_entity(&ctx).is_empty());
 assert_eq!(db.fog,fog_before,"camera interest must never explore or change fog");
 assert_eq!(visible_combat_agent(&ctx),reference_combat(&ctx),"owned hostile sight is independent of camera interest");
 db.interests.clear(); let ctx=ViewContext{db:&db,owner:1};
 assert!(visible_tree_entity(&ctx).is_empty()); assert!(visible_realm_entity(&ctx).is_empty());
 assert_eq!(visible_combat_agent(&ctx),reference_combat(&ctx),"missing camera must not discard existing unit sight");
}
#[test]
#[cfg(not(single_player))]
fn world_edges_and_unknown_or_remembered_cells_remain_hidden() {
 let mut db=Db::default(); db.interests.push(RealmInterest{owner:1,chunk:0});
 db.fog.push(RealmFog{owner:1,chunk:0,explored:u64::MAX,visible:1});
 db.fog.push(RealmFog{owner:2,chunk:0,explored:u64::MAX,visible:u64::MAX});
 let ctx=ViewContext{db:&db,owner:1}; let sight=realm::view_visibility(&ctx);
 assert!(sight.contains(-6144.0,-6144.0)); assert!(sight.contains(-6112.001,-6112.001));
 for (x,z) in [(-6112.0,-6144.0),(6144.0,0.0),(-6144.001,0.0),(f64::NAN,0.0),(0.0,f64::INFINITY),(0.0,0.0)] {
  assert!(!sight.contains(x,z)); assert_eq!(sight.contains(x,z),old_visible(&ctx,x,z));
 }
}
#[test]
#[cfg(single_player)]
fn single_player_still_receives_all_resources_and_its_combat_agents() {
 let db=fixture(); let ctx=ViewContext{db:&db,owner:1};
 for view in [visible_quarry,visible_foraging_node,visible_tree_entity] { assert_eq!(view(&ctx),db.resources); }
 assert_eq!(visible_combat_agent(&ctx),reference_combat(&ctx));
 assert_eq!(db.fog_ranges.get(),0); assert_eq!(db.fog_points.get(),0);
}
`;
const directory='.tmp-realm-view-tests'; mkdirSync(directory,{recursive:true});
const rustPath=join(directory,'view_tests.rs'); writeFileSync(rustPath,code);
for (const [name,flags] of [['realm',[]],['single',['--cfg','single_player']]]) {
  const binary=join(directory,`${name}_tests${process.platform==='win32'?'.exe':''}`);
  const compile=spawnSync('rustc',['--edition=2021','--test',...flags,rustPath,'-o',binary],{encoding:'utf8'});
  assert.equal(compile.status,0,compile.stderr||compile.stdout);
  const result=spawnSync(binary,['--nocapture'],{encoding:'utf8'});
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  assert.equal(result.status,0,`${name} visibility tests failed`);
}
