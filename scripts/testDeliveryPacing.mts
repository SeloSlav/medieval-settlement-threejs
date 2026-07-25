import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FOOD_DELIVERY_SPEED_MPS,
  SIM_REALTIME_RATE,
  SIM_TICK_SECONDS,
} from '../src/generated/gameBalance.ts';
import { deliveryLegRemainingMeters } from '../src/logistics/deliveryTrips.ts';
import { DELIVERY_ROAD_SPEED_MULTIPLIER } from '../src/roads/roadTravel.ts';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

assert.equal(
  FOOD_DELIVERY_SPEED_MPS * SIM_REALTIME_RATE,
  0.08,
  'the sparse Scenic economy cadence must not be applied directly to physical cart speed',
);
assert.equal(SIM_TICK_SECONDS * 1 * 5, 1, 'Scenic delivery heartbeats cover real elapsed time');
assert.equal(SIM_TICK_SECONDS * 5 * 5, 5, 'Normal delivery heartbeats retain the 5x control');

assert.equal(deliveryLegRemainingMeters(150, 42, 'outbound'), 108);
assert.equal(deliveryLegRemainingMeters(150, 42, 'inbound'), 108);
assert.equal(deliveryLegRemainingMeters(150, 150, 'outbound'), 0);
assert.equal(deliveryLegRemainingMeters(150, 42, 'unloading'), 0);
assert.equal(deliveryLegRemainingMeters(0, 0, 'outbound'), null);

const simulationReducer = read('server/src/reducers/simulation.rs');
assert.match(
  simulationReducer,
  /step_delivery_trips\([\s\S]*?TICK_DT \* speed as f64,[\s\S]*?\);/,
  'authoritative deliveries must advance on each scheduler heartbeat at the selected game speed',
);
const oneSimStep = simulationReducer.slice(simulationReducer.indexOf('fn run_one_sim_tick'));
assert.doesNotMatch(
  oneSimStep,
  /step_delivery_trips\(/,
  'delivery movement must not also advance on sparse economy/calendar substeps',
);

const deliveryServer = read('server/src/simulation/delivery_trips.rs');
assert.match(
  deliveryServer,
  /while remaining_seconds > 1e-9/,
  'large speed steps must carry elapsed time across trip phase boundaries',
);
assert.match(deliveryServer, /advance_travel_progress\(/);
assert.match(deliveryServer, /network\.is_on_road_surface\(x, z\)/);
assert.equal(DELIVERY_ROAD_SPEED_MULTIPLIER, 1.35);
assert.match(deliveryServer, /DELIVERY_ROAD_SPEED_MULTIPLIER: f64 = 1\.35/);

const deliveryRenderer = read('src/logistics/DeliveryAgentRenderer.ts');
assert.match(deliveryRenderer, /surfaceAdjustedTravelSpeed\(/);
assert.match(deliveryRenderer, /DELIVERY_ROAD_SPEED_MULTIPLIER/);
assert.match(deliveryRenderer, /phaseChanged \|\| progressRestarted/);
assert.match(
  deliveryRenderer,
  /this\.resolveGroundY\(x,\s*z\) \+ 0\.05/,
  'delivery carts and their visible workers should use the road/bridge walking surface',
);

const appBootstrap = read('src/app/appBootstrap.ts');
assert.match(
  appBootstrap,
  /new DeliveryAgentRenderer\(\{[\s\S]*?getRoadDeckY:[\s\S]*?sampleRoadDeckY/,
  'delivery agents should receive the same bridge deck sampler as villagers and first-person',
);
assert.match(
  appBootstrap,
  /new DeliveryAgentRenderer\(\{[\s\S]*?isOnRoadSurface:/,
  'delivery agents should receive the live road-surface query used for cart speed',
);

const villagerInspector = read('src/ui/VillagerInspector.ts');
assert.match(villagerInspector, />Distance left</);
assert.match(villagerInspector, /inspection\.remainingMeters/);
assert.match(villagerInspector, /this\.current\.textContent/);

console.log('delivery pacing checks passed');
