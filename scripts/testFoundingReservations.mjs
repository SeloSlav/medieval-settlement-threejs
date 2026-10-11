import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { join } from 'node:path';
// Execute the production reservation helpers against small in-memory tables.
// This checks material protection and phase lifetime without linking the WASM SDK.
const source = readFileSync('server/src/simulation/founding_site.rs', 'utf8');
function rustFunction(text, name) {
  const match = new RegExp(`(?:pub )?fn ${name}\\(`).exec(text);
  assert(match, `Missing Rust function ${name}`);
  const opening = text.indexOf('{', match.index);
  let depth = 1, cursor = opening + 1;
  for (; cursor < text.length && depth; cursor++) {
    if (text[cursor] === '{') depth++;
    if (text[cursor] === '}') depth--;
  }
  assert.equal(depth, 0);
  return text.slice(match.index, cursor);
}
const reservations = source.slice(source.indexOf('#[derive(Default)]'), source.indexOf('/// While founders'));
assert.match(reservations, /type ReservationCache/);
const active = rustFunction(readFileSync('server/src/residence_upgrade_policy.rs', 'utf8'), 'residence_project_active');
const code = `
use std::collections::HashMap;
use std::cell::Cell;
type Identity = u64;
const EPSILON: f64 = 1e-6;
#[derive(Clone, Copy, Debug)]
enum CommodityKind { Timber, Stone, Ironwork, RoofTiles, DressedStone, Gold }
const COMMODITIES: [CommodityKind; 6] = [CommodityKind::Timber, CommodityKind::Stone, CommodityKind::Ironwork, CommodityKind::RoofTiles, CommodityKind::DressedStone, CommodityKind::Gold];
#[derive(Default, Clone)]
struct Building {
 owner: Identity, construction_complete: bool, stock: [f64; 6],
 construction_reserved_timber: f64, construction_treasury_timber: f64,
 construction_reserved_stone: f64, construction_treasury_stone: f64,
 construction_reserved_ironwork: f64, construction_treasury_ironwork: f64,
 construction_reserved_roof_tiles: f64, construction_treasury_roof_tiles: f64,
}
#[derive(Default, Clone)]
struct Residence {
 owner: Identity, upgrade_target_tier: u8, tier: u8, backyard_project_kind: u8,
 fire_repair_active: bool, decay_repair_active: bool, roof_tile_retrofit_active: bool,
 upgrade_reserved_timber: f64, upgrade_reserved_stone: f64, upgrade_reserved_roof_tiles: f64,
}
#[derive(Default)]
struct Database { buildings: Vec<Building>, homes: Vec<Residence>, building_reads: Cell<usize>, home_reads: Cell<usize> }
#[derive(Default)]
struct ReducerContext { db: Database }
struct BuildingIndex<'a>(&'a Database);
struct HomeIndex<'a>(&'a Database);
impl Database {
 fn building(&self) -> BuildingIndex<'_> { BuildingIndex(self) }
 fn residence(&self) -> HomeIndex<'_> { HomeIndex(self) }
}
impl<'a> BuildingIndex<'a> {
 fn owner(self) -> Self { self }
 fn filter(self, owner: &Identity) -> std::vec::IntoIter<Building> {
   self.0.building_reads.set(self.0.building_reads.get() + 1);
   self.0.buildings.iter().filter(|b| b.owner == *owner).cloned().collect::<Vec<_>>().into_iter()
 }
}
impl<'a> HomeIndex<'a> {
 fn owner(self) -> Self { self }
 fn filter(self, owner: &Identity) -> std::vec::IntoIter<Residence> {
   self.0.home_reads.set(self.0.home_reads.get() + 1);
   self.0.homes.iter().filter(|r| r.owner == *owner).cloned().collect::<Vec<_>>().into_iter()
 }
}
fn building_commodity_stock(b: &Building, commodity: CommodityKind) -> f64 { b.stock[commodity as usize] }
${reservations}
${active}
${rustFunction(source, 'relocatable_stock')}
${rustFunction(source, 'load_founder_reservations')}
fn site(owner: Identity, stock: f64) -> Building { Building { owner, stock: [stock; 6], ..Default::default() } }
fn budget_fixture() -> ReducerContext {
 let mut ctx = ReducerContext::default();
 let project = Building { owner: 1, construction_reserved_timber: 80., construction_treasury_timber: 10.,
 construction_reserved_stone: 35., construction_treasury_stone: 5., construction_reserved_ironwork: 12.,
 construction_treasury_ironwork: 2., construction_reserved_roof_tiles: 55., construction_treasury_roof_tiles: 5.,
 ..Default::default() };
 ctx.db.buildings.push(project.clone());
 ctx.db.buildings.push(Building { owner: 2, ..project.clone() });
 ctx.db.buildings.push(Building { construction_complete: true, ..project });
 let home = Residence { owner: 1, tier: 2, upgrade_target_tier: 3,
 upgrade_reserved_timber: 20., upgrade_reserved_stone: 15., upgrade_reserved_roof_tiles: 7., ..Default::default() };
 ctx.db.homes.push(home.clone());
 ctx.db.homes.push(Residence { owner: 2, ..home.clone() });
 ctx.db.homes.push(Residence { upgrade_target_tier: 0, ..home });
 ctx
}
#[test]
fn protects_only_active_owned_projects_and_reuses_owner_cache_for_outposts() {
 let ctx = budget_fixture();
 let mut cache = ReservationCache::new();
 for _camp in 0..2 { for (i, c) in COMMODITIES.iter().copied().enumerate() {
   assert_eq!(relocatable_stock(&ctx, &site(1, 100.), c, &mut cache), [10., 55., 90., 43., 100., 100.][i]);
 }}
 assert_eq!(ctx.db.building_reads.get(), 1);
 assert_eq!(ctx.db.home_reads.get(), 1);
 assert_eq!(relocatable_stock(&ctx, &site(2, 100.), CommodityKind::Timber, &mut cache), 10.);
 assert_eq!(ctx.db.building_reads.get(), 2);
 assert_eq!(ctx.db.home_reads.get(), 2);
}
#[test]
fn empty_and_dust_stock_does_not_scan_projects() {
 let ctx = budget_fixture(); let mut cache = ReservationCache::new();
 for stock in [-100., 0., EPSILON / 2., EPSILON] {
   for c in COMMODITIES { assert_eq!(relocatable_stock(&ctx, &site(1, stock), c, &mut cache), 0.); }
 }
 assert!(cache.is_empty()); assert_eq!(ctx.db.building_reads.get(), 0); assert_eq!(ctx.db.home_reads.get(), 0);
}
#[test]
fn completed_phase_cache_is_recreated_and_live_source_stock_stays_authoritative() {
 let mut ctx = budget_fixture(); let mut cache = ReservationCache::new(); let mut camp = site(1, 100.);
 assert_eq!(relocatable_stock(&ctx, &camp, CommodityKind::Timber, &mut cache), 10.);
 camp.stock[0] = 93.;
 assert_eq!(relocatable_stock(&ctx, &camp, CommodityKind::Timber, &mut cache), 3.);
 ctx.db.buildings[0].construction_complete = true;
 let mut next_step = ReservationCache::new();
 assert_eq!(relocatable_stock(&ctx, &camp, CommodityKind::Timber, &mut next_step), 73.);
 assert_eq!(ctx.db.building_reads.get(), 2);
}
#[test]
fn negative_reserves_and_treasury_excess_do_not_create_cargo() {
 let mut ctx = ReducerContext::default();
 ctx.db.buildings.push(Building { owner:1, construction_reserved_timber: 10., construction_treasury_timber: 20.,
 construction_reserved_stone: -5., construction_treasury_stone: 0., ..Default::default() });
 ctx.db.homes.push(Residence { owner:1, fire_repair_active:true, upgrade_reserved_timber:-50., ..Default::default() });
 let mut cache = ReservationCache::new();
 for c in COMMODITIES { assert_eq!(relocatable_stock(&ctx, &site(1, 17.), c, &mut cache), 17.); }
}
#[test]
fn all_household_project_kinds_protect_their_reservations() {
 let mut ctx = ReducerContext::default();
 for kind in 0..5 {
  ctx.db.homes.push(Residence { owner:1, upgrade_reserved_timber:3., upgrade_reserved_stone:2., upgrade_reserved_roof_tiles:1.,
   upgrade_target_tier: u8::from(kind==0) + 1, tier:1, backyard_project_kind:u8::from(kind==1),
   fire_repair_active:kind==2, decay_repair_active:kind==3, roof_tile_retrofit_active:kind==4, ..Default::default() });
 }
 let mut cache = ReservationCache::new();
 assert_eq!(relocatable_stock(&ctx,&site(1,100.),CommodityKind::Timber,&mut cache),85.);
 assert_eq!(relocatable_stock(&ctx,&site(1,100.),CommodityKind::Stone,&mut cache),90.);
 assert_eq!(relocatable_stock(&ctx,&site(1,100.),CommodityKind::RoofTiles,&mut cache),95.);
 assert_eq!(relocatable_stock(&ctx,&site(1,100.),CommodityKind::Ironwork,&mut cache),100.);
}
`;
const directory = '.tmp-founding-reservations-tests'; mkdirSync(directory, { recursive: true });
const rust = join(directory, 'founding_reservations.rs'), executable = join(directory, 'founding_reservations.exe');
writeFileSync(rust, code);
for (const [command, args] of [['rustc', ['--edition=2021', '--test', rust, '-o', executable]], [executable, ['--nocapture']]]) {
 const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
 if (result.stdout) process.stdout.write(result.stdout);
 if (result.stderr) process.stderr.write(result.stderr);
 assert.equal(result.status, 0, result.error?.message ?? 'Native reservation regression failed');
}
