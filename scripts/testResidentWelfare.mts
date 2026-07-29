import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (relative: string): string =>
  readFileSync(resolve(root, relative), 'utf8');
const balance = JSON.parse(read('balance/gameBalance.json')).population as Record<string, number>;

assert.ok(balance.hungerWarningDays < balance.malnutritionDays);
assert.ok(balance.malnutritionDays < balance.starvationDeathStartDays);
assert.ok(balance.starvationDeathIntervalDays > 0);
assert.ok(balance.residenceNeglectedDays < balance.residenceDilapidatedDays);
assert.ok(balance.residenceDilapidatedDays < balance.residenceRuinedDays);
assert.ok(balance.graveyardMinArea > 0);
assert.ok(balance.graveAreaPerBurial > 0);
assert.ok(balance.coldExposureIllnessMultiplier > 0);

const tables = read('server/src/tables.rs');
for (const token of [
  'pub struct Graveyard',
  'pub struct Corpse',
  'pub hunger_ticks: u32',
  'pub malnutrition: f64',
  'pub sick_population: u32',
  'pub remedy_stock: f64',
  'pub vacancy_ticks: u32',
  'pub condition: u8',
  'pub decay_repair_active: bool',
  'pub cart_x: f64',
  'pub cart_z: f64',
]) {
  assert.ok(tables.includes(token), `missing persistent welfare schema token: ${token}`);
}

const needs = read('server/src/simulation/residence_needs/mod.rs');
for (const token of [
  'consume_food_with_preserved',
  'comfort_migration_due',
  'starvation_death_due',
  'insert_corpse',
  'HERB_MORTALITY_MULTIPLIER',
  'CORPSE_DISEASE_RADIUS',
  'next_comfort_deficit_ticks',
  'next_malnutrition',
  'nearby_waiting_corpses',
  'if food_unmet',
  'step_residence_decay',
  'residence.decay_repair_active',
]) {
  assert.ok(needs.includes(token), `missing authoritative welfare behavior: ${token}`);
}
assert.ok(
  !needs.includes('effective_abandon_after_deficit_ticks'),
  'the legacy all-needs abandonment timer must not govern resident welfare',
);

const clientNeeds = read('src/residences/residenceNeeds.ts');
assert.ok(
  !clientNeeds.includes('abandons in'),
  'the inspector must distinguish health danger and comfort migration instead of promising instant abandonment',
);

const burial = read('server/src/simulation/burial.rs');
for (const token of [
  'road_path_route',
  'assigned_labor',
  'reserved_by_graveyard',
  'serialize_route_polyline',
  'graveyard.burials',
  'corpse.state == 1',
  'corpse.state == 2',
  'corpse.cart_x',
  'total_distance',
  'labor_and_logistics_paused',
]) {
  assert.ok(burial.includes(token), `missing physical burial behavior: ${token}`);
}
assert.match(
  burial,
  /road_path_route\(chapel\.x, chapel\.z, corpse\.x, corpse\.z\)/,
  'the empty burial cart must travel from its staffed chapel to the body',
);
assert.match(
  burial,
  /road_path_route\(corpse\.x, corpse\.z, gx, gz\)/,
  'the loaded burial cart must travel from the body to its reserved graveyard',
);

const tickContext = read('server/src/simulation/tick_context.rs');
assert.match(tickContext, /CorpseSpatialIndex/);
assert.match(tickContext, /nearby_waiting_corpses/);

const decayReducer = read('server/src/reducers/residences.rs');
for (const token of [
  'decay_repair_active',
  'upgrade_reserved_timber',
  'ensure_upgrade_source_route',
]) {
  assert.ok(decayReducer.includes(token), `missing physical decay repair behavior: ${token}`);
}

const clientSubscriptions = read('src/data/gameTableSubscriptions.ts');
assert.match(clientSubscriptions, /'graveyard'/);
assert.match(clientSubscriptions, /'corpse'/);
const placement = read('src/farming/FarmFieldTool.ts');
assert.match(placement, /'field' \| 'pasture' \| 'graveyard'/);
assert.match(placement, /GRAVEYARD_ADJACENCY_DISTANCE/);
const chapel = read('src/resources/inspector/chapelRenderer.ts');
assert.match(chapel, /data-land-parcel="graveyard"/);
assert.match(chapel, /Gravedigger carts/);
assert.match(chapel, /data-demolish-graveyard/);
const residence = read('src/resources/inspector/residenceRenderer.ts');
assert.match(residence, /data-residence-decay-repair/);
assert.match(residence, /Herbal remedies/);
assert.match(residence, /Seasonal ration rotation/);
assert.match(residence, /replaces the same amount of fresh food rather than adding a second meal/);
const residenceSync = read('src/data/spacetimeTableSync/syncResidences.ts');
assert.match(residenceSync, /decayRepairActive/);
const visuals = read('src/residences/BurialMarkers.ts');
assert.match(visuals, /Shrouded body/);
assert.match(visuals, /Graveyard/);
assert.match(visuals, /InstancedMesh/);
assert.match(visuals, /Gravedigger handcart and attendant/);

console.log('Resident welfare, mortality, burial, and decay contract verified.');
