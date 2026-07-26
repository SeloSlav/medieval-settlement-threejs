import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FOOD_PER_DELIVERY,
  FOOD_DELIVERY_SPEED_MPS,
  SIM_REALTIME_RATE,
  SIM_TICK_SECONDS,
} from '../src/generated/gameBalance.ts';
import {
  deliveryLegRemainingMeters,
  tripDeliveryRemainingSeconds,
  type DeliveryTripState,
} from '../src/logistics/deliveryTrips.ts';
import { DELIVERY_ROAD_SPEED_MULTIPLIER } from '../src/roads/roadTravel.ts';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

assert.equal(
  FOOD_DELIVERY_SPEED_MPS,
  1.6,
  'food handcarts should keep a believable base pace before game-speed scaling',
);
assert.ok(
  Math.abs(FOOD_DELIVERY_SPEED_MPS * SIM_REALTIME_RATE - 0.05333333333333334) < 1e-12,
  'the sparse Scenic economy cadence must not be applied directly to physical cart speed',
);
assert.equal(
  FOOD_PER_DELIVERY,
  6,
  'each food visit should replenish a meaningful share of household storage',
);
assert.equal(SIM_TICK_SECONDS * 1 * 5, 1, 'Scenic delivery heartbeats cover real elapsed time');
assert.equal(SIM_TICK_SECONDS * 5 * 5, 5, 'Normal delivery heartbeats retain the 5x control');

assert.equal(deliveryLegRemainingMeters(150, 42, 'outbound'), 108);
assert.equal(deliveryLegRemainingMeters(150, 42, 'inbound'), 108);
assert.equal(deliveryLegRemainingMeters(150, 150, 'outbound'), 0);
assert.equal(deliveryLegRemainingMeters(150, 42, 'unloading'), 0);
assert.equal(deliveryLegRemainingMeters(0, 0, 'outbound'), null);

const loadedTrip: DeliveryTripState = {
  id: 'timed-delivery',
  buildingId: 'origin',
  residenceId: null,
  destinationKind: 'building',
  targetBuildingId: 'destination',
  cargoKind: 'grain',
  amount: 30,
  phase: 'outbound',
  x: 42,
  z: 0,
  progress: 42,
  speedMps: 2,
  unloadSeconds: 8,
  unloadRemaining: 0,
  deliveryWorkers: 2,
  pathDistance: 150,
  travelSpeedMultiplier: 1,
  routePolylineJson: '[]',
};
assert.equal(
  tripDeliveryRemainingSeconds(loadedTrip),
  31,
  'delivery ETA should include remaining outbound travel and unloading, but not the empty return',
);
assert.equal(
  tripDeliveryRemainingSeconds({
    ...loadedTrip,
    travelSpeedMultiplier: 0.72,
  }),
  41.5,
  'winter road conditions must lengthen both authoritative movement and client ETAs',
);
assert.equal(
  tripDeliveryRemainingSeconds({
    ...loadedTrip,
    phase: 'unloading',
    unloadRemaining: 3.5,
  }),
  3.5,
);
assert.equal(
  tripDeliveryRemainingSeconds({ ...loadedTrip, phase: 'inbound' }),
  Infinity,
);

const simulationReducer = read('server/src/reducers/simulation.rs');
const tickContext = read('server/src/simulation/tick_context.rs');
assert.match(
  simulationReducer,
  /step_delivery_trips\([\s\S]*?TICK_DT \* speed as f64[\s\S]*?\);/,
  'authoritative deliveries must advance on each scheduler heartbeat at the selected game speed',
);
const oneSimStep = simulationReducer.slice(simulationReducer.indexOf('fn run_one_sim_tick'));
assert.doesNotMatch(
  oneSimStep,
  /step_delivery_trips\(/,
  'delivery movement must not also advance on sparse economy/calendar substeps',
);
assert.match(
  tickContext,
  /pub type SharedRoadNetworks = Arc<HashMap<Identity, RoadNetwork>>;/,
  'immutable parsed road graphs should be shareable between tick contexts',
);
assert.match(
  tickContext,
  /pub fn load_road_networks[\s\S]*RoadNetwork::from_snapshot_json/,
);
assert.match(
  tickContext,
  /pub fn with_road_networks\(road_networks: SharedRoadNetworks\) -> Self/,
);
assert.equal(
  (simulationReducer.match(/SimTickContext::load_road_networks\(ctx\)/g) ?? []).length,
  1,
  'one simulation heartbeat should parse the road snapshots at most once',
);
assert.match(
  simulationReducer,
  /\(has_delivery_trips \|\| substeps > 0\)\s*\.then\(\|\| SimTickContext::load_road_networks\(ctx\)\)/,
  'an idle heartbeat with no economy step should still avoid all graph parsing',
);
assert.ok(
  (simulationReducer.match(/SimTickContext::with_road_networks\(/g) ?? []).length >= 2,
  'delivery and economy contexts should share the parsed graph set',
);
assert.doesNotMatch(
  simulationReducer,
  /SimTickContext::new\(ctx\)/,
  'the simulation reducer must not rebuild identical road graphs per substep',
);

const parseCounts = (speed: number): { before: number; after: number } => {
  let credit = 0;
  let before = 0;
  let after = 0;
  for (let heartbeat = 0; heartbeat < 30; heartbeat += 1) {
    const budget = credit + speed;
    const substeps = Math.floor(budget / 30);
    credit = budget % 30;
    before += 1 + substeps;
    after += 1;
  }
  return { before, after };
};
assert.deepEqual(parseCounts(1), { before: 31, after: 30 });
assert.deepEqual(parseCounts(5), { before: 35, after: 30 });
assert.deepEqual(parseCounts(20), { before: 50, after: 30 });
assert.deepEqual(parseCounts(120), { before: 150, after: 30 });

const deliveryServer = read('server/src/simulation/delivery_trips.rs');
assert.match(
  deliveryServer,
  /cartwright_multiplier \* road_condition_multiplier/,
  'new trips should capture both cartwright support and current seasonal road conditions',
);
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

console.log('delivery pacing checks passed (30 heartbeats: 20× graph builds 50→30; 120× 150→30)');
