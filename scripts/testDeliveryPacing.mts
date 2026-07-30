import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  FOOD_PER_DELIVERY,
  FOOD_DELIVERY_SPEED_MPS,
  SIM_REALTIME_RATE,
  SIM_TICK_SECONDS,
} from '../src/generated/gameBalance.ts';
import {
  cargoKindLabelForTrip,
  describeDeliveryTrip,
  deliveryLegRemainingMeters,
  deliveryWorkerPersonIdentity,
  destinationKindFromId,
  isRegionalExportTrip,
  isRegionalImportTrip,
  isRegionalMarketTrip,
  onsiteBuildingLabor,
  raidWithdrawingCartCount,
  rosteredCartWorkers,
  rosteredCartWorkersByBuilding,
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
  Math.abs(FOOD_DELIVERY_SPEED_MPS * SIM_REALTIME_RATE - 0.64) < 1e-12,
  'physical cart speed should advance with the same base realtime rate as the calendar',
);
assert.equal(
  FOOD_PER_DELIVERY,
  6,
  'each food visit should replenish a meaningful share of household storage',
);
assert.ok(
  Math.abs(SIM_TICK_SECONDS * 1 * SIM_REALTIME_RATE - 0.08) < 1e-12,
  '1× delivery heartbeats should use the base realtime rate',
);
assert.ok(
  Math.abs(SIM_TICK_SECONDS * 4 * SIM_REALTIME_RATE - 0.32) < 1e-12,
  '4× delivery heartbeats should retain the selected speed multiplier',
);

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
  freeHaulerWorkers: 0,
  pathDistance: 150,
  travelSpeedMultiplier: 1,
  routePolylineJson: '[]',
};
assert.equal(deliveryWorkerPersonIdentity(loadedTrip), 'delivery:origin:hauler:0');
assert.equal(deliveryWorkerPersonIdentity(loadedTrip, 2), 'delivery:origin:hauler:2');
const regionalMarketTrip: DeliveryTripState = {
  ...loadedTrip,
  id: 'regional-market-cart',
  targetBuildingId: loadedTrip.buildingId,
  freeHaulerWorkers: loadedTrip.deliveryWorkers,
};
assert.equal(isRegionalImportTrip(regionalMarketTrip), true);
assert.equal(
  deliveryWorkerPersonIdentity(regionalMarketTrip),
  'regional-merchant:regional-market-cart:crew:0',
  'a foreign merchant must not reuse a settlement hauler identity',
);
const regionalHouseholdTrip: DeliveryTripState = {
  ...regionalMarketTrip,
  id: 'regional-household-cart',
  destinationKind: 'residence',
  residenceId: 'named-home',
};
assert.equal(isRegionalImportTrip(regionalHouseholdTrip), true);
const regionalExportTrip: DeliveryTripState = {
  ...regionalMarketTrip,
  id: 'regional-export-cart',
  destinationKind: 'trade',
  cargoKind: 'pottery',
  amount: 12,
};
assert.equal(destinationKindFromId(5), 'trade');
assert.equal(isRegionalImportTrip(regionalExportTrip), false);
assert.equal(isRegionalExportTrip(regionalExportTrip), true);
assert.equal(isRegionalMarketTrip(regionalExportTrip), true);
assert.equal(
  deliveryWorkerPersonIdentity(regionalExportTrip),
  'regional-merchant:regional-export-cart:crew:0',
  'an export merchant must remain visually distinct from resident haulers',
);
const regionalIronTrip: DeliveryTripState = {
  ...regionalMarketTrip,
  id: 'regional-iron-import',
  cargoKind: 'iron',
  amount: 12,
  deliveryWorkers: 1,
  freeHaulerWorkers: 1,
};
assert.equal(cargoKindLabelForTrip(regionalIronTrip), 'Imported iron bars');
assert.deepEqual(
  describeDeliveryTrip(regionalIronTrip, 'Marketplace', 'Marketplace'),
  {
    eyebrow: 'Regional merchant - Outbound',
    activity: 'Bringing 12 imported iron bars from the Adriatic trade route to Marketplace',
    current: 'Inbound from the Adriatic trade route',
    occupation: 'Regional merchant',
    workplaceHeading: 'Contracting market',
    routeHeading: 'Trade leg',
    routeTarget: 'Marketplace',
    cargoSummary: '12 imported iron bars - 1 hauler',
  },
  'a physical import must not read as a local marketplace self-delivery',
);
const returningSaltMerchant: DeliveryTripState = {
  ...regionalMarketTrip,
  id: 'regional-salt-return',
  cargoKind: 'salt',
  amount: 0,
  phase: 'inbound',
  deliveryWorkers: 1,
  freeHaulerWorkers: 1,
};
assert.equal(cargoKindLabelForTrip(returningSaltMerchant), 'Adriatic salt');
assert.deepEqual(
  describeDeliveryTrip(returningSaltMerchant, 'Marketplace', 'Marketplace'),
  {
    eyebrow: 'Regional merchant - Returning',
    activity: 'Returning empty from Marketplace to the Adriatic trade route',
    current: 'Returning to the Adriatic trade route',
    occupation: 'Regional merchant',
    workplaceHeading: 'Contracting market',
    routeHeading: 'Trade leg',
    routeTarget: 'Adriatic trade route',
    cargoSummary: 'Empty - Adriatic salt import',
  },
);
const localIronTrip: DeliveryTripState = {
  ...loadedTrip,
  cargoKind: 'iron',
  amount: 4,
};
assert.equal(cargoKindLabelForTrip(localIronTrip), 'Raw iron');
assert.match(
  describeDeliveryTrip(localIronTrip, 'Mineral mine', 'Village smithy').activity,
  /Delivering 4 raw iron to Village smithy/,
  'a settlement mine cart must remain visibly local',
);
assert.equal(
  describeDeliveryTrip(
    regionalExportTrip,
    'Marketplace',
    'Regional exchange route',
  ).occupation,
  'Regional merchant',
  'the shared presentation helper must preserve existing export merchants',
);
const presentationStarted = performance.now();
let presentationCharacters = 0;
for (let index = 0; index < 100_000; index += 1) {
  const candidate = {
    ...regionalIronTrip,
    id: `regional-presentation-${index}`,
    phase: index % 3 === 0
      ? 'outbound'
      : index % 3 === 1
        ? 'unloading'
        : 'inbound',
    amount: index % 3 === 2 ? 0 : 12,
  } satisfies DeliveryTripState;
  const presentation = describeDeliveryTrip(
    candidate,
    'Marketplace',
    'Marketplace',
  );
  presentationCharacters += presentation.activity.length;
}
const presentationElapsed = performance.now() - presentationStarted;
assert.ok(presentationCharacters > 0);
assert.ok(
  presentationElapsed < 750,
  `100k provenance-aware cart descriptions regressed (${presentationElapsed.toFixed(1)} ms)`,
);
assert.equal(rosteredCartWorkers({ assignedLabor: 3 }, loadedTrip), 2);
assert.equal(onsiteBuildingLabor({ assignedLabor: 3 }, loadedTrip), 1);
assert.equal(
  onsiteBuildingLabor(
    { assignedLabor: 3 },
    { ...loadedTrip, freeHaulerWorkers: 1 },
  ),
  2,
  'only the roster-backed part of a mixed cart crew should reduce on-site work',
);
assert.equal(
  onsiteBuildingLabor(
    { assignedLabor: 3 },
    { ...loadedTrip, freeHaulerWorkers: 2 },
  ),
  3,
  'free founding and institutional haulers must not reduce building production',
);
assert.equal(
  rosteredCartWorkers({ assignedLabor: 1 }, { ...loadedTrip, deliveryWorkers: 3 }),
  1,
  'a traveling crew cannot remove more workers than the origin still has rostered',
);
assert.deepEqual(
  rosteredCartWorkersByBuilding(
    new Map([
      ['origin', { assignedLabor: 3 }],
      ['free-origin', { assignedLabor: 2 }],
    ]),
    [
      loadedTrip,
      {
        ...loadedTrip,
        id: 'second-cart',
        deliveryWorkers: 2,
        freeHaulerWorkers: 1,
      },
      {
        ...loadedTrip,
        id: 'free-cart',
        buildingId: 'free-origin',
        deliveryWorkers: 2,
        freeHaulerWorkers: 2,
      },
    ],
  ),
  new Map([['origin', 3]]),
  'traveling roster counts should sum, clamp to staffing, and ignore free haulers',
);
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
assert.equal(
  raidWithdrawingCartCount(
    [
      { ...loadedTrip, phase: 'inbound' },
      { ...loadedTrip, id: 'fire-cart', destinationKind: 'fire', phase: 'inbound' },
      { ...loadedTrip, id: 'outbound-cart', phase: 'outbound' },
      { ...regionalHouseholdTrip, phase: 'inbound' },
      { ...regionalExportTrip, phase: 'inbound', cargoKind: 'gold' },
    ],
    true,
  ),
  1,
  'only ordinary carts already facing home should be reported as withdrawing',
);
assert.equal(raidWithdrawingCartCount([{ ...loadedTrip, phase: 'inbound' }], false), 0);

const simulationReducer = read('server/src/reducers/simulation.rs');
const tickContext = read('server/src/simulation/tick_context.rs');
assert.match(
  simulationReducer,
  /step_delivery_trips\([\s\S]*?heartbeat_sim_seconds[\s\S]*?\);/,
  'authoritative deliveries must advance on each scheduler heartbeat at the selected game speed',
);
assert.match(
  simulationReducer,
  /step_live_raids\([\s\S]*?heartbeat_sim_seconds[\s\S]*?\);/,
  'live combatants must share the cart heartbeat and selected movement speed',
);
const oneSimStep = simulationReducer.slice(simulationReducer.indexOf('fn run_one_sim_tick'));
assert.doesNotMatch(
  oneSimStep,
  /step_delivery_trips\(/,
  'delivery movement must not also advance on sparse economy/calendar substeps',
);
assert.doesNotMatch(
  oneSimStep,
  /step_live_raids\(/,
  'combat movement must not also advance on sparse economy/calendar substeps',
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
  /\(has_delivery_trips \|\| has_combat_agents \|\| substeps > 0\)\s*\.then\(\|\| SimTickContext::load_road_networks\(ctx\)\)/,
  'an idle heartbeat with no carts, combatants, or economy step should still avoid all graph parsing',
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
const serverTables = read('server/src/tables.rs');
assert.match(
  serverTables,
  /Locally mined rock salt or imported Adriatic sea salt/,
  'the authoritative resource row must acknowledge both physical salt sources',
);
assert.match(
  serverTables,
  /Local mine carts fill the reserve first; Adriatic trade buys the[\s\S]*remaining whole-lot shortfall/,
);
assert.match(
  deliveryServer,
  /pub fn onsite_building_labor[\s\S]*?delivery_trip\(\)[\s\S]*?building_id\(\)[\s\S]*?free_hauler_workers/,
  'on-site labor must use the indexed origin trip and exclude free haulers',
);
assert.match(
  deliveryServer,
  /DELIVERY_DESTINATION_REGIONAL_TRADE:\s*u8\s*=\s*5/,
  'the existing delivery row must expose one explicit two-way trade destination code',
);
assert.match(
  deliveryServer,
  /settle_regional_market_export[\s\S]*trip\.cargo_kind = received_commodity\.as_u8\(\)/,
  'the outbound goods cart must become the physical return receipt at the map edge',
);
assert.match(
  deliveryServer,
  /!regional_market_trip[\s\S]*owner_has_active_raider_threat/,
  'regional merchants must remain exposed instead of obeying the settlement cart recall alarm',
);
for (const productionFile of [
  'lumber_mill.rs',
  'stone_quarry.rs',
  'large_quarry.rs',
  'food_supplier.rs',
  'woodcutters_lodge.rs',
  'well.rs',
  'expanded_economy.rs',
  'livestock.rs',
]) {
  assert.match(
    read(`server/src/simulation/${productionFile}`),
    /onsite_building_labor/,
    `${productionFile} must use physically present labor for work throughput`,
  );
}
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
assert.match(
  deliveryServer,
  /fn recall_trip_to_origin[\s\S]*restore_trip_target_reservation[\s\S]*prepare_trip_return_leg[\s\S]*delivery_trip\(\)\.id\(\)\.update\(trip\)/,
  'a cancelled delivery should turn around with the same trip row, cargo, and committed crew',
);
assert.match(
  deliveryServer,
  /RaidCartPosture::Recall[\s\S]*recall_trip_to_origin_during_raid/,
  'an outward ordinary cart must physically reverse when a capable raider is on the map',
);
assert.match(
  deliveryServer,
  /RaidCartPosture::ReturnHome[\s\S]*emergency alarm overrides night and sabbath rest/,
  'a homeward cart must keep moving during the emergency instead of freezing on the road',
);
assert.match(
  deliveryServer,
  /RaidCartPosture::Ordinary[\s\S]*Dispatch is independently gated by work hours and Sabbath[\s\S]*completes the committed outbound leg, unload, and return/,
  'a cart that departed during work hours must finish its active round trip after the workday boundary',
);
assert.doesNotMatch(
  deliveryServer,
  /RaidCartPosture::Ordinary\s*=>\s*\{[\s\S]{0,240}labor_and_logistics_paused/,
  'night and Sabbath may block new departures but must not freeze an existing cart on the road',
);
assert.match(
  deliveryServer,
  /fn recall_trip_to_origin_during_raid[\s\S]*prepare_trip_return_leg[\s\S]*finish_inbound_trip/,
  'raid recall must preserve the trip and settle cargo only after its physical return',
);
assert.match(
  deliveryServer,
  /fn finish_inbound_trip[\s\S]*delivery_trip_portable_stores[\s\S]*return_trip_cargo_to_building[\s\S]*hand_off_arriving_cart_pursuit[\s\S]*delivery_trip\(\)\.id\(\)\.delete/,
  'an arriving cart must hand a live pursuit to its receiving store before its row disappears',
);
assert.match(
  deliveryServer,
  /fn hand_off_arriving_cart_pursuit[\s\S]*COMBAT_TARGET_DELIVERY_TRIP[\s\S]*combat_agent_follows_arriving_cart[\s\S]*COMBAT_TARGET_BUILDING[\s\S]*arriving_cart_store_loot_fraction/,
  'only live pursuers should follow the cargo home, with loss capped to the cart value',
);
assert.match(
  deliveryServer,
  /DeliveryTripPhase::Outbound => path_distance - progress/,
  'an outbound recall should preserve the cart position when changing to reverse route progress',
);
assert.match(
  deliveryServer,
  /fn settle_stranded_trip[\s\S]*recover_stock_at[\s\S]*trip\.x[\s\S]*trip\.z/,
  'cargo that can no longer follow a route must remain at the cart position',
);
assert.match(
  deliveryServer,
  /fn return_commodity_to_building[\s\S]*recover_stock_beside_building/,
  'returned overflow must become local physical stock rather than a remote ledger credit',
);

const deliveryRenderer = read('src/logistics/DeliveryAgentRenderer.ts');
assert.match(deliveryRenderer, /surfaceAdjustedTravelSpeed\(/);
assert.match(deliveryRenderer, /DELIVERY_ROAD_SPEED_MULTIPLIER/);
assert.match(deliveryRenderer, /phaseChanged \|\| progressRestarted/);
assert.match(
  deliveryRenderer,
  /deliveryCartMeshName\([\s\S]*isRegionalImportTrip\(trip\)/,
  'cart mesh replacement must retain the live trip provenance',
);
assert.match(
  deliveryRenderer,
  /createDeliveryCartMesh\([\s\S]*regionalImport: isRegionalImportTrip\(trip\)/,
  'new regional merchants must receive their distinct cargo load',
);
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
const deliveryTripClient = read('src/logistics/deliveryTrips.ts');
assert.match(villagerInspector, />Distance left</);
assert.match(villagerInspector, /inspection\.remainingMeters/);
assert.match(villagerInspector, /this\.current\.textContent/);
assert.match(
  deliveryTripClient,
  /returningLoaded[\s\S]*Returning \$\{cargoAmount\} undelivered/,
  'the agent inspector should disclose when a returning cart is still visibly loaded',
);
assert.match(
  villagerInspector,
  /describeDeliveryTrip\([\s\S]*presentation\.activity[\s\S]*presentation\.routeTarget/,
  'the visible inspector must use the provenance-aware trip description',
);

console.log('delivery pacing checks passed');
