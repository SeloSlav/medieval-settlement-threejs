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
  FIRE_MINIMUM_BUCKET_WATER,
  FIRE_RAIN_RISK_MULTIPLIER,
  FIRE_SPREAD_RADIUS,
  WELL_BASE_REFILL_PER_SEC,
  WELL_MINIMUM_REFILL_HYDROLOGY,
} from '../src/generated/gameBalance.ts';
import {
  activeFireCount,
  fireForTarget,
  fireSourceLabel,
  type FireIncidentState,
} from '../src/fires/fireIncident.ts';
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

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const wellSource = readFileSync(`${projectRoot}server/src/simulation/well.rs`, 'utf8');
const tripSource = readFileSync(`${projectRoot}server/src/simulation/delivery_trips.rs`, 'utf8');
const fireSource = readFileSync(`${projectRoot}server/src/simulation/fires.rs`, 'utf8');
const rendererSource = readFileSync(`${projectRoot}src/fires/FireEffectsRenderer.ts`, 'utf8');

assert.match(
  wellSource,
  /select_fire_for_well[\s\S]*reserve_fire_response[\s\S]*try_start_fire_response_trip/,
  'well fire calls must reserve and dispatch a real trip before normal delivery work',
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
assert.match(rendererSource, /Animated structural flame/);
assert.match(rendererSource, /Animated structural smoke/);

console.log('fire system tests passed');
