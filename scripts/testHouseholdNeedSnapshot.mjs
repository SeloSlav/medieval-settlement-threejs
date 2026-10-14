import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

function functionSource(source, name) {
  const start=source.search(new RegExp(`(?:pub )?fn ${name}\\(`)); assert(start>=0,name);
  let cursor=source.indexOf('{',start)+1, depth=1;
  for(;depth;cursor++){if(source[cursor]==='{')depth++;else if(source[cursor]==='}')depth--;assert(cursor<source.length);}
  return source.slice(start,cursor);
}
const source=readFileSync('server/src/simulation/residence_needs/state.rs','utf8');
const cache=source.slice(source.indexOf('thread_local!'),source.indexOf('pub fn load_needs'))
  .replace('fn read_rows(', 'pub(super) fn read_rows(').replace('fn cache_written_row(', 'pub(super) fn cache_written_row(');
const constructor=functionSource(source,'cache_tick_needs');
const baseline=cache.replace(constructor,`pub fn cache_tick_needs(_ctx:&ReducerContext,input_tick:u64,output_tick:u64)->TickNeedCache {
 TICK_NEED_ROWS.with(|cache|*cache.borrow_mut()=Some(CachedTickNeeds{rows:Default::default(),input_tick,output_tick}));TickNeedCache
}`);
assert.notEqual(cache,baseline);
const helpers=[functionSource(source,'find_row').replace('fn find_row(', 'pub(super) fn find_row('),functionSource(source,'delete_needs')].join('\n');
const code=`
use std::cell::{Cell,RefCell};use std::collections::BTreeMap;use std::borrow::Borrow;
#[derive(Clone,Debug,PartialEq)]
struct ResidenceNeed{id:u64,owner:u64,residence_id:u64,need_kind:u8,stock:f64,deficit_ticks:u32,deficit_tick:u64,deficit_running:bool,source_kind:u16}
#[derive(Clone,Copy)]struct ResidenceNeedKind(u8);impl ResidenceNeedKind{fn as_u8(self)->u8{self.0}}
#[derive(Default)]struct Database{rows:RefCell<BTreeMap<u64,Vec<ResidenceNeed>>>,queries:Cell<usize>,reads:Cell<usize>}
#[derive(Default)]struct ReducerContext{db:Database}
struct NeedTable<'a>{db:&'a Database}
struct ConfigTable;struct Config{household_tick:u64}
impl Database{
 fn residence_need(&self)->NeedTable<'_>{NeedTable{db:self}}
 fn world_config(&self)->ConfigTable{ConfigTable}
 fn put(&self,row:ResidenceNeed){let mut data=self.rows.borrow_mut();let rows=data.entry(row.residence_id).or_default();
  if let Some(old)=rows.iter_mut().find(|old|old.id==row.id){*old=row}else{rows.push(row)}}
 fn expected(&self,id:u64)->Vec<ResidenceNeed>{self.rows.borrow().get(&id).cloned().unwrap_or_default()}
}
impl ConfigTable{fn id(self)->Self{self}fn find(self,_id:u64)->Option<Config>{Some(Config{household_tick:900})}}
impl NeedTable<'_>{
 fn id(self)->Self{self}fn residence_id(self)->Self{self}
 fn iter(self)->std::vec::IntoIter<ResidenceNeed>{self.db.queries.set(self.db.queries.get()+1);
  let rows:Vec<_>=self.db.rows.borrow().values().flatten().cloned().collect();self.db.reads.set(self.db.reads.get()+rows.len());rows.into_iter()}
 fn filter(self,id:impl Borrow<u64>)->std::vec::IntoIter<ResidenceNeed>{self.db.queries.set(self.db.queries.get()+1);
  let rows=self.db.expected(*id.borrow());self.db.reads.set(self.db.reads.get()+rows.len());rows.into_iter()}
 fn delete(self,id:u64)->bool{let mut found=false;for rows in self.db.rows.borrow_mut().values_mut(){
  rows.retain(|row|{if row.id==id{found=true;false}else{true}})}found}
}
mod current{use super::*;${cache}${helpers}}
mod reference{use super::*;${baseline}${helpers}}
fn row(home:u64,kind:u8)->ResidenceNeed{ResidenceNeed{id:home*16+u64::from(kind),owner:home%50,residence_id:home,need_kind:kind,
 stock:(home%17)as f64+0.25,deficit_ticks:(home%90)as u32,deficit_tick:77,deficit_running:home%3==0,source_kind:kind as u16}}
fn world(homes:u64)->ReducerContext{let ctx=ReducerContext::default();for home in 1..=homes{for kind in 0..11{ctx.db.put(row(home,kind));}}ctx}
#[test]fn global_step_preserves_all_rows_with_one_authoritative_snapshot(){
 let old=world(5004);let new=world(5004);let a=reference::cache_tick_needs(&old,100,101);let b=current::cache_tick_needs(&new,100,101);
 for _ in 0..4{for home in 1..=5004{assert_eq!(current::read_rows(&new,home),reference::read_rows(&old,home));
  for kind in [0,4,10]{assert_eq!(current::find_row(&new,home,ResidenceNeedKind(kind)),reference::find_row(&old,home,ResidenceNeedKind(kind)));}}}
 assert_eq!(old.db.queries.get(),5004);assert_eq!(new.db.queries.get(),1);assert_eq!(new.db.reads.get(),55044);assert_eq!(old.db.reads.get(),55044);
 println!("5004 household snapshots: table queries {} -> {}; exact {} rows",old.db.queries.get(),new.db.queries.get(),new.db.reads.get());
 assert_eq!(current::input_household_tick(&new),100);assert_eq!(current::output_household_tick(&new),101);drop(a);drop(b);
 assert_eq!(current::input_household_tick(&new),900);assert_eq!(current::output_household_tick(&new),900);
}
#[test]fn writes_new_homes_deletion_and_phase_end_remain_live(){
 let ctx=world(50);let phase=current::cache_tick_needs(&ctx,100,101);let before=ctx.db.queries.get();
 for event in 0..600u64{let home=event%50+1;let mut changed=row(home,(event%11)as u8);
  changed.stock=event as f64*0.75;changed.deficit_ticks=event as u32;changed.deficit_tick=100+event;changed.deficit_running=event%2==0;
  ctx.db.put(changed.clone());current::cache_written_row(changed);assert_eq!(current::read_rows(&ctx,home),ctx.db.expected(home));}
 assert_eq!(ctx.db.queries.get(),before,"Stock and evaluated timer anchors update without another table lookup");
 let new_home=999;assert!(current::find_row(&ctx,new_home,ResidenceNeedKind(0)).is_none());
 let inserted=row(new_home,0);ctx.db.put(inserted.clone());current::cache_written_row(inserted.clone());
 assert_eq!(current::find_row(&ctx,new_home,ResidenceNeedKind(0)),Some(inserted));
 current::delete_needs(&ctx,7);assert!(current::read_rows(&ctx,7).is_empty());
 let restored=row(7,2);ctx.db.put(restored.clone());current::cache_written_row(restored.clone());
 assert_eq!(current::read_rows(&ctx,7),vec![restored]);
 // An unseen new home's initializer may notify before a read-through entry exists.
 let unseen=row(1001,1);ctx.db.put(unseen.clone());current::cache_written_row(unseen.clone());
 assert_eq!(current::read_rows(&ctx,1001),vec![unseen]);
 drop(phase);let mut later=row(1,0);later.stock=9999.0;ctx.db.put(later.clone());
 assert_eq!(current::find_row(&ctx,1,ResidenceNeedKind(0)),Some(later));
 let next=current::cache_tick_needs(&ctx,500,501);assert_eq!(current::read_rows(&ctx,1),ctx.db.expected(1));drop(next);
}
#[test]fn unguarded_reducers_query_live_table_rows(){let ctx=world(2);current::read_rows(&ctx,1);let mut changed=row(1,0);changed.stock=82.0;
 ctx.db.put(changed.clone());assert_eq!(current::find_row(&ctx,1,ResidenceNeedKind(0)),Some(changed));assert_eq!(ctx.db.queries.get(),2);}
`;
const directory='.tmp-household-need-snapshot-tests';mkdirSync(directory,{recursive:true});
const path=join(directory,'need_snapshot.rs'),binary=join(directory,'need_snapshot.exe');writeFileSync(path,code);
for(const [command,args]of[['rustc',['--edition=2021','--test','-O',path,'-o',binary]],[binary,['--nocapture']]]){
 const result=spawnSync(command,args,{encoding:'utf8',windowsHide:true});if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
 assert.equal(result.status,0,result.error?.message??'Actual household need cache regression failed');
}
