import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (relative: string): string =>
  readFileSync(resolve(root, relative), 'utf8');
const balance = JSON.parse(read('balance/gameBalance.json')).population as Record<string, number>;

assert.ok(balance.hungerWarningDays < balance.malnutritionDays);
assert.ok(balance.malnutritionDays < balance.starvationDeathStartDays);
assert.ok(balance.starvationDeathChancePerPersonDay > 0);
assert.ok(balance.starvationDeathMaxChancePerPersonDay > balance.starvationDeathChancePerPersonDay);
assert.ok(balance.starvationDeathRiskRampDays > 0);
assert.ok(balance.coldExposureWarningDays < balance.coldExposureDeathStartDays);
assert.ok(balance.coldExposureDeathChancePerPersonDay > 0);
assert.ok(balance.coldExposureDeathMaxChancePerPersonDay > balance.coldExposureDeathChancePerPersonDay);
assert.ok(balance.residenceServiceWarningDays < balance.residenceUpgradeServiceBlockDays);
assert.equal('residenceServiceMaxPenaltyDays' in balance, false);
assert.equal('residenceServiceMinEconomicMultiplier' in balance, false);
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
  'Runtime homes normalize this to false',
  'pub cart_x: f64',
  'pub cart_z: f64',
]) {
  assert.ok(tables.includes(token), `missing persistent welfare schema token: ${token}`);
}

const needs = read('server/src/simulation/residence_needs/mod.rs');
for (const token of [
  'consume_monthly_food_slots',
  'starvation_death_chance',
  'cold_exposure_death_chance',
  'insert_corpse',
  'HERB_MORTALITY_MULTIPLIER',
  'CORPSE_DISEASE_RADIUS',
  'next_service_deficit_ticks',
  'next_malnutrition',
  'nearby_waiting_corpses',
  'if food_unmet',
  'food_shortage_harms_health',
  'relieve_food_deficit_from_stocked_pantry',
  'environment.season == Season::Winter',
  'death_cause = Some(2)',
]) {
  assert.ok(needs.includes(token), `missing authoritative welfare behavior: ${token}`);
}
assert.ok(
  !needs.includes('comfort_migration_due') && !needs.includes('step_residence_decay'),
  'need shortages must not remove residents or decay empty homes',
);
assert.ok(
  !read('server/src/simulation/backyard_garden.rs').includes('service_economic_multiplier'),
  'need shortages must not reduce household work or taxable market activity',
);

const clientNeeds = read('src/residences/residenceNeeds.ts');
assert.ok(
  !clientNeeds.includes('abandons in'),
  'the inspector must describe service pressure without promising abandonment',
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

const residenceReducer = read('server/src/reducers/residences.rs');
assert.doesNotMatch(residenceReducer, /fn repair_residence_decay/);
assert.match(residenceReducer, /service_shortage_blocks_upgrade/);

const clientSubscriptions = read('src/data/gameTableSubscriptions.ts');
assert.match(clientSubscriptions, /'graveyard'/);
assert.match(clientSubscriptions, /'corpse'/);
const placement = read('src/farming/FarmFieldTool.ts');
assert.match(placement, /'field' \| 'pasture' \| 'graveyard'/);
assert.match(placement, /GRAVEYARD_MAX_DISTANCE/);
assert.doesNotMatch(placement, /GRAVEYARD_ADJACENCY_DISTANCE/);
const chapel = read('src/resources/inspector/chapelRenderer.ts');
assert.match(chapel, /data-land-parcel="graveyard"/);
assert.match(chapel, /Gravedigger carts/);
assert.match(chapel, /data-demolish-graveyard/);
const residence = read('src/resources/inspector/residenceRenderer.ts');
assert.doesNotMatch(residence, /data-residence-decay-repair/);
assert.match(residence, /Herbal remedies/);
assert.match(residence, /Seasonal ration rotation/);
assert.match(residence, /replaces the same amount of fresh food rather than adding a second meal/);
assert.match(residence, /Recovering · food need currently met/);
assert.match(residence, /accumulated shortage days/);
assert.match(residence, /Starving · \$\{activeHungerDays\.toFixed\(1\)\}d elapsed/);
assert.doesNotMatch(residence, /days without enough food/);
const householdDistribution = read('server/src/simulation/household_distribution.rs');
assert.match(
  householdDistribution,
  /sync_food_need_rows\(ctx, &residence\);\s*relieve_food_deficit_from_stocked_pantry\(ctx, &residence\);/,
  'a market refill must immediately relieve a payable stale food deficit',
);
const hud = read('src/ui/SettlementHud.ts');
assert.match(hud, /settlement-wide usable meals/);
assert.match(hud, /household pantries can cover their next food bill/);
const residenceSync = read('src/data/spacetimeTableSync/syncResidences.ts');
assert.match(residenceSync, /abandoned: false/);
assert.match(residenceSync, /condition: 0/);
const visuals = read('src/residences/BurialMarkers.ts');
assert.match(visuals, /Shrouded body/);
assert.match(visuals, /Graveyard/);
assert.match(visuals, /InstancedMesh/);
assert.match(visuals, /Gravedigger handcart and attendant/);

console.log('Persistent-home welfare, mortality, burial, and service-pressure contract verified.');
