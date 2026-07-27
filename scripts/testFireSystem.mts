import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FIRE_BUCKET_SPEED_MPS,
  FIRE_BUCKET_UNLOAD_SECONDS,
  FIRE_BUCKET_WATER,
  FIRE_DROUGHT_RISK_MULTIPLIER,
  FIRE_EXTINGUISH_CHANCE_BASE,
  FIRE_EXTINGUISH_INTENSITY_THRESHOLD,
  FIRE_DAMAGE_REPAIR_COST_MULTIPLIER,
  FIRE_DESTROYED_REBUILD_COST_FRACTION,
  FIRE_MINIMUM_BUCKET_WATER,
  FIRE_MINIMUM_REPAIR_COST_FRACTION,
  FIRE_RAIN_RISK_MULTIPLIER,
  FIRE_RESOLVED_RETENTION_SECONDS,
  FIRE_SPREAD_RADIUS,
  RESIDENCE_STONE_COST,
  RESIDENCE_TIER2_STONE_COST,
  RESIDENCE_TIER2_TIMBER_COST,
  RESIDENCE_TIER3_STONE_COST,
  RESIDENCE_TIER3_TIMBER_COST,
  RESIDENCE_TIMBER_COST,
  SIM_TICK_SECONDS,
  WELL_BASE_REFILL_PER_SEC,
  WELL_MINIMUM_REFILL_HYDROLOGY,
} from '../src/generated/gameBalance.ts';
import {
  activeFireCount,
  fireDisabledBuildingIds,
  fireDisabledResidenceIds,
  fireForTarget,
  fireSourceLabel,
  type FireIncidentState,
} from '../src/fires/fireIncident.ts';
import {
  buildingFireRecoveryQuote,
  fireRecoveryCoolingSeconds,
  fireRecoveryCost,
  fireRecoveryFraction,
  residenceFireRecoveryQuote,
  residenceStructuralCost,
} from '../src/fires/fireRecovery.ts';
import { destinationKindFromId } from '../src/logistics/deliveryTrips.ts';

assert.equal(destinationKindFromId(2), 'fire');
assert.equal(FIRE_BUCKET_WATER, 3);
assert.equal(FIRE_MINIMUM_BUCKET_WATER, 0.5);
assert.ok(FIRE_BUCKET_SPEED_MPS > 0);
assert.ok(FIRE_BUCKET_UNLOAD_SECONDS > 0);
assert.ok(FIRE_SPREAD_RADIUS > 0);
assert.ok(FIRE_DROUGHT_RISK_MULTIPLIER > 1);
assert.ok(FIRE_RAIN_RISK_MULTIPLIER < 1);
assert.ok(FIRE_EXTINGUISH_CHANCE_BASE > 0);
assert.ok(FIRE_EXTINGUISH_INTENSITY_THRESHOLD < 0.5);
assert.equal(WELL_BASE_REFILL_PER_SEC, 0.7);
assert.equal(WELL_MINIMUM_REFILL_HYDROLOGY, 0.15);

const incident: FireIncidentState = {
  id: 'fire-1',
  targetKind: 'building',
  targetId: 'building-4',
  x: 12,
  z: 24,
  ignitionSource: 'lightning',
  status: 'burning',
  intensity: 0.58,
  damage: 0.24,
  waterDelivered: 3,
  requiredWater: 9,
  extinguishChance: 0.46,
  startedTick: 100,
  lastWaterTick: 180,
  resolvedTick: 0,
  responseWellId: 'building-2',
};
assert.equal(activeFireCount([incident]), 1);
assert.equal(fireForTarget([incident], 'building', 'building-4'), incident);
assert.equal(fireForTarget([incident], 'residence', 'building-4'), null);
assert.equal(fireSourceLabel('lightning'), 'Lightning strike');
assert.equal(fireSourceLabel('raid'), 'Raiders set the holding alight');
assert.deepEqual([...fireDisabledBuildingIds([incident])], ['building-4']);
const residenceIncident: FireIncidentState = {
  ...incident,
  id: 'fire-2',
  targetKind: 'residence',
  targetId: 'residence-9',
};
assert.deepEqual(
  [...fireDisabledResidenceIds([incident, residenceIncident])],
  ['residence-9'],
);

assert.equal(fireRecoveryFraction(0.01, false), FIRE_MINIMUM_REPAIR_COST_FRACTION);
assert.equal(
  fireRecoveryFraction(0.6, false),
  0.6 * FIRE_DAMAGE_REPAIR_COST_MULTIPLIER,
);
assert.equal(
  fireRecoveryFraction(1, true),
  FIRE_DESTROYED_REBUILD_COST_FRACTION,
);
assert.deepEqual(
  fireRecoveryCost({ timber: 100, stone: 50 }, 0.6, false, false),
  { timber: 39, stone: 19.5 },
  'structural repair must scale both material costs with damage',
);
assert.deepEqual(
  fireRecoveryCost({ timber: 100, stone: 50 }, 1, true, true),
  { timber: 63, stone: 35 },
  'carpenter support must discount only reconstruction timber',
);
assert.deepEqual(residenceStructuralCost(3), {
  timber: RESIDENCE_TIMBER_COST
    + RESIDENCE_TIER2_TIMBER_COST
    + RESIDENCE_TIER3_TIMBER_COST,
  stone: RESIDENCE_STONE_COST
    + RESIDENCE_TIER2_STONE_COST
    + RESIDENCE_TIER3_STONE_COST,
});
assert.equal(
  buildingFireRecoveryQuote(
    { kind: 'smokehouse' },
    { damage: 1, status: 'destroyed' },
    false,
  ).kind,
  'rebuild',
);
assert.equal(
  residenceFireRecoveryQuote(
    { tier: 3 },
    { damage: 0.3, status: 'extinguished' },
    false,
  ).kind,
  'repair',
);
assert.equal(
  fireRecoveryCoolingSeconds(
    { status: 'extinguished', resolvedTick: 100 },
    100,
  ),
  FIRE_RESOLVED_RETENTION_SECONDS,
);
assert.equal(
  fireRecoveryCoolingSeconds(
    { status: 'extinguished', resolvedTick: 100 },
    100 + Math.ceil(FIRE_RESOLVED_RETENTION_SECONDS / SIM_TICK_SECONDS),
  ),
  0,
);

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const wellSource = readFileSync(`${projectRoot}server/src/simulation/well.rs`, 'utf8');
const tripSource = readFileSync(`${projectRoot}server/src/simulation/delivery_trips.rs`, 'utf8');
const cargoSource = readFileSync(`${projectRoot}server/src/simulation/delivery_cargo.rs`, 'utf8');
const fireSource = readFileSync(`${projectRoot}server/src/simulation/fires.rs`, 'utf8');
const tickContextSource = readFileSync(
  `${projectRoot}server/src/simulation/tick_context.rs`,
  'utf8',
);
const simulationSource = readFileSync(
  `${projectRoot}server/src/reducers/simulation.rs`,
  'utf8',
);
const householdOrderSource = readFileSync(
  `${projectRoot}server/src/simulation/household_market_orders.rs`,
  'utf8',
);
const recoverySource = readFileSync(`${projectRoot}server/src/reducers/fire_recovery.rs`, 'utf8');
const rendererSource = readFileSync(`${projectRoot}src/fires/FireEffectsRenderer.ts`, 'utf8');
const effectSource = readFileSync(`${projectRoot}src/fires/FireEffect.ts`, 'utf8');
const inspectorSource = readFileSync(`${projectRoot}src/resources/ResourceInspector.ts`, 'utf8');
const generatedReducerSource = readFileSync(
  `${projectRoot}src/generated/repair_fire_damage_reducer.ts`,
  'utf8',
);
const worldQueriesSource = readFileSync(
  `${projectRoot}src/resources/WorldQueries.ts`,
  'utf8',
);

assert.match(
  wellSource,
  /select_fire_for_well[\s\S]*reserve_fire_response[\s\S]*try_start_fire_response_trip/,
  'well fire calls must reserve and dispatch a real trip before normal delivery work',
);
assert.match(
  fireSource,
  /building_ids_for_kinds\(ctx,\s*incident\.owner,\s*&\["well"\]\)/,
  'nearest fire-response selection should inspect only indexed well candidates',
);
assert.match(
  tripSource,
  /let load = fire_response_load\(well\.water\)[\s\S]*well\.water\s*-=\s*load/,
  'partial bucket water must leave the well at dispatch',
);
assert.match(
  tripSource,
  /apply_fire_water\(ctx,\s*target_kind,\s*target_id,\s*trip\.amount,\s*sim_tick\)/,
  'water must affect the incident only when the trip unloads',
);
assert.match(
  tripSource,
  /pub fn try_start_delivery_trip[\s\S]*tick\.building_disabled_by_fire\(ctx, building\.id\)[\s\S]*tick\.residence_disabled_by_fire\(ctx, residence_id\)/,
  'household dispatch must reject fire-disabled suppliers and destinations at the trip boundary',
);
assert.match(
  tripSource,
  /pub fn try_start_building_supply_trip[\s\S]*tick\.building_disabled_by_fire\(ctx, origin\.id\)[\s\S]*tick\.building_disabled_by_fire\(ctx, target\.id\)/,
  'shared building dispatch must reject fire-disabled origins and targets',
);
assert.match(
  cargoSource,
  /target_is_operational: impl Fn\(u64\) -> bool[\s\S]*if !target_is_operational\(residence\.id\)/,
  'cargo selection must skip disabled residences before reserving household stock',
);
assert.match(
  fireSource,
  /within_extent\(well,\s*incident\.x,\s*incident\.z\)/,
  'fire response must respect the well work extent',
);
assert.match(
  wellSource,
  /fire_response_needed_for_well[\s\S]*delivery_ready = !fire_response_needed[\s\S]*prioritize_fire_response/,
  'fire calls must preempt household delivery work',
);
assert.match(
  rendererSource,
  /Visible bucket-water suppression/,
  'unloading must have a visible water effect',
);
assert.match(rendererSource, /createFireEffect/);
assert.match(rendererSource, /Reusable structural fire/);
assert.match(effectSource, /Animated fire flame/);
assert.match(effectSource, /Animated fire smoke/);
assert.match(effectSource, /Procedural reusable fire shader/);
assert.match(effectSource, /Procedural reusable fire smoke shader/);
assert.match(effectSource, /SpriteNodeMaterial/);
assert.doesNotMatch(effectSource, /ConeGeometry/);
assert.match(rendererSource, /visual\.incident\.status !== 'burning'/);
assert.match(rendererSource, /disposeFireEffect/);
assert.match(rendererSource, /setFireEffectActive/);
assert.doesNotMatch(
  fireSource,
  /cleanup_resolved_fires/,
  'extinguished damage must persist until the player repairs it',
);
assert.match(
  fireSource,
  /const FIRE_IGNITION_CHECK_INTERVAL_TICKS: u64 = 5;/,
  'idle ignition polling should scan structures once per simulated second',
);
assert.match(fireSource, /pub const FIRE_SOURCE_RAID: u8 = 3;/);
assert.match(
  fireSource,
  /pub fn ignite_raid_target[\s\S]*fire_for_target[\s\S]*FIRE_SOURCE_RAID/,
  'raid arson should enter the ordinary indexed fire lifecycle rather than duplicate damage logic',
);
assert.match(
  fireSource,
  /if active_after_step\.is_empty\(\) && !ignition_due \{\s*return;/,
  'idle non-poll ticks must return before building and residence candidate scans',
);
assert.ok(
  (fireSource.match(/accumulated_event_chance\(/g) ?? []).length >= 2,
  'batched lightning and accident checks must preserve repeated-tick probability',
);
assert.match(
  fireSource,
  /let mut occupied_targets: HashSet<\(u8, u64\)>[\s\S]*collect_candidates\(ctx, &occupied_targets\)/,
  'one occupied-target set should serve the whole fire pass',
);
const collectCandidatesSource =
  fireSource.match(/fn collect_candidates[\s\S]*?\r?\n}\r?\n\r?\nfn maybe_ignite_from_lightning/)?.[0]
  ?? '';
const spreadSource =
  fireSource.match(/fn maybe_spread_fires[\s\S]*?\r?\n}\r?\n\r?\nfn ignite_candidate/)?.[0]
  ?? '';
assert.doesNotMatch(
  collectCandidatesSource,
  /fire_for_target\(/,
  'candidate collection must not issue one incident query per structure',
);
assert.doesNotMatch(
  spreadSource,
  /fire_for_target\(/,
  'spread selection must not issue one incident query per source/candidate pair',
);
assert.match(
  spreadSource,
  /occupied_targets\.contains\(&\(candidate\.target_kind, candidate\.target_id\)\)/,
);
assert.match(
  tickContextSource,
  /disabled_fire_targets: RefCell<Option<HashSet<\(u8, u64\)>>/,
  'one lazy disabled-target set should be shared by the rest of the substep',
);
assert.match(
  tickContextSource,
  /pub fn building_disabled_by_fire[\s\S]*target_disabled_by_fire/,
);
assert.match(
  tickContextSource,
  /pub fn residence_disabled_by_fire[\s\S]*target_disabled_by_fire/,
);
assert.ok(
  (tickContextSource.match(/!self\.building_disabled_by_fire\(ctx, building\.id\)/g) ?? [])
    .length >= 4,
  'cached service territories must omit fire-disabled suppliers',
);
assert.ok(
  (tickContextSource.match(/!self\.residence_disabled_by_fire\(ctx, residence\.id\)/g) ?? [])
    .length >= 4,
  'cached service territories must omit fire-disabled residences',
);
assert.equal(
  (simulationSource.match(/ctx\.db\.building\(\)\.iter\(\)/g) ?? []).length,
  1,
  'the main substep should classify all buildings once, not rescan for faith rosters',
);
assert.match(
  simulationSource,
  /"chapel" => chapel_ids\.push\(building\.id\)[\s\S]*"monastery" => monastery_ids\.push\(building\.id\)/,
);
assert.match(
  simulationSource,
  /chapel_ids[\s\S]*filter_map\(\|building_id\| ctx\.db\.building\(\)\.id\(\)\.find\(&building_id\)\)[\s\S]*monastery_ids/,
  'chapel and monastery rows must be resolved fresh from IDs after production',
);
assert.match(
  simulationSource,
  /tick\.building_disabled_by_fire\(ctx, building\.id\)/,
);
assert.match(
  simulationSource,
  /tick\.residence_disabled_by_fire\(ctx, residence\.id\)/,
);
assert.match(
  householdOrderSource,
  /tick\.residence_disabled_by_fire\(ctx, residence\.id\)/,
);
assert.match(
  wellSource,
  /tick\.building_disabled_by_fire\(ctx, candidate\.id\)/,
);
assert.match(recoverySource, /pub fn repair_fire_damage/);
assert.match(recoverySource, /construction_treasury_reservation_excluding_building/);
assert.match(recoverySource, /building\.construction_complete = false/);
assert.match(recoverySource, /spend_aggregate_timber/);
assert.match(recoverySource, /spend_aggregate_stone/);
assert.match(recoverySource, /reconcile_building_labor/);
assert.match(recoverySource, /clear_fire_for_target/);
assert.match(generatedReducerSource, /targetKind: __t\.u8\(\)/);
assert.match(generatedReducerSource, /targetId: __t\.u64\(\)/);
assert.match(inspectorSource, /data-fire-recovery/);
assert.match(inspectorSource, /normal material-hauling and builder-work pipeline/);
assert.match(worldQueriesSource, /private \*fireEnabledBuildings/);
assert.match(worldQueriesSource, /fireDisabledResidenceIds/);
assert.match(
  worldQueriesSource,
  /findNearestRoadLinkedBuilding[\s\S]*fireDisabled\.has\(origin\.id\)[\s\S]*fireDisabled\.has\(candidate\.id\)/,
  'client previews must reject fire-disabled building origins and targets',
);
assert.match(
  worldQueriesSource,
  /findNearestRoadLinkedResidence[\s\S]*fireDisabledBuildings\.has\(origin\.id\)[\s\S]*fireDisabledResidences\.has\(residence\.id\)/,
  'client previews must reject fire-disabled household origins and targets',
);

const performanceIncidents: FireIncidentState[] = Array.from(
  { length: 100_000 },
  (_, index) => ({
    ...incident,
    id: `fire-${index}`,
    targetId: `building-${index}`,
    status: index % 3 === 0 ? 'burning' : 'extinguished',
  }),
);
const disabledScanStarted = performance.now();
const disabledIds = fireDisabledBuildingIds(performanceIncidents);
const disabledResidenceIds = fireDisabledResidenceIds(performanceIncidents);
const disabledScanElapsed = performance.now() - disabledScanStarted;
assert.equal(disabledIds.size, 100_000);
assert.equal(disabledResidenceIds.size, 0);
assert.ok(
  disabledScanElapsed < 250,
  `100k-incident disabled-building scan regressed (${disabledScanElapsed.toFixed(1)} ms)`,
);

const occupiedTargets = new Set(
  performanceIncidents.map((entry) => `0:${entry.targetId}`),
);
const candidateLookupStarted = performance.now();
let availableCandidates = 0;
for (let index = 0; index < 200_000; index += 1) {
  if (!occupiedTargets.has(`0:building-${index}`)) {
    availableCandidates += 1;
  }
}
const candidateLookupElapsed = performance.now() - candidateLookupStarted;
assert.equal(availableCandidates, 100_000);
assert.ok(
  candidateLookupElapsed < 250,
  `200k occupied-target lookups regressed (${candidateLookupElapsed.toFixed(1)} ms)`,
);

console.log(
  `fire system tests passed (${candidateLookupElapsed.toFixed(1)} ms for 200,000 occupied-target lookups)`,
);
