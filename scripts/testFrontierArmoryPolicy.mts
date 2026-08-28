import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  CARPENTER_POLEARM_RESERVE_DEFAULT,
  CARPENTER_POLEARM_RESERVE_LEGACY,
  CARPENTER_POLEARM_RESERVE_PRESETS,
  carpenterArmoryPlan,
  carpenterPolearmShortfall,
  guardhousePolearmTarget,
  normalizeCarpenterPolearmReserve,
} from '../src/economy/carpenterArmoryPolicy.ts';

assert.equal(CARPENTER_POLEARM_RESERVE_DEFAULT, 6);
assert.equal(CARPENTER_POLEARM_RESERVE_LEGACY, 24);
assert.deepEqual(
  CARPENTER_POLEARM_RESERVE_PRESETS.map((preset) => preset.reserve),
  [0, 2, 6, 12, 24],
);
assert.equal(normalizeCarpenterPolearmReserve(Number.NaN), 24);
assert.equal(normalizeCarpenterPolearmReserve(200), 24);
assert.equal(normalizeCarpenterPolearmReserve(-2), 0);
assert.equal(carpenterPolearmShortfall(2, 6), 4);
assert.equal(carpenterPolearmShortfall(8, 6), 0);
assert.equal(guardhousePolearmTarget(0), 0);
assert.equal(guardhousePolearmTarget(6.8), 6);

const oneCompany = carpenterArmoryPlan({
  polearms: 2,
  carpenterPolearmReserve: 6,
  timber: 2,
  ironwork: 0,
});
assert.deepEqual(oneCompany, {
  reserve: 6,
  stock: 2,
  shortfall: 4,
  timberToTarget: 21,
  ironworkToTarget: 19,
});

const paused = carpenterArmoryPlan({
  polearms: 3,
  carpenterPolearmReserve: 0,
  timber: 0,
  ironwork: 0,
});
assert.equal(paused.shortfall, 0);
assert.equal(paused.timberToTarget, 0);
assert.equal(paused.ironworkToTarget, 0);

const fittingsConserved = carpenterArmoryPlan({
  polearms: 2,
  carpenterPolearmReserve: 6,
  carpenterCartServiceTargetTrips: 0,
  timber: 2,
  ironwork: 0,
});
assert.deepEqual(fittingsConserved, {
  reserve: 6,
  stock: 2,
  shortfall: 4,
  timberToTarget: 6,
  ironworkToTarget: 4,
});

const legacy = carpenterArmoryPlan({
  polearms: 4,
  timber: 0,
  ironwork: 0,
});
assert.equal(legacy.reserve, 24, 'missing legacy rows must preserve the former full-workshop target');

const schema = readFileSync('server/src/tables.rs', 'utf8');
assert.match(
  schema,
  /#\[default\(24u8\)\]\s+pub carpenter_polearm_reserve: u8/,
  'additive schema migration must preserve the former 24-polearm behavior',
);

const buildingReducers = readFileSync('server/src/reducers/buildings.rs', 'utf8');
assert.match(
  buildingReducers,
  /if kind == "carpenter"[\s\S]*?CARPENTER_POLEARM_RESERVE_DEFAULT/,
  'new carpenters must begin with the one-company reserve',
);
assert.match(
  buildingReducers,
  /set_carpenter_polearm_reserve[\s\S]*?is_valid_carpenter_polearm_reserve[\s\S]*?building\.carpenter_polearm_reserve = polearm_reserve/,
  'the authoritative reducer must validate and persist policy presets',
);

const serverEconomy = readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
assert.match(
  serverEconomy,
  /carpenter_polearm_shortfall\(building\.polearms, building\.carpenter_polearm_reserve\)[\s\S]*?if polearm_shortfall > 1e-6[\s\S]*?request_connected_commodity/,
  'carpenters must request inputs only while below their finished reserve',
);
assert.match(
  serverEconomy,
  /dispatch_polearms_to_guardhouse[\s\S]*?guardhouse_polearm_target\(target\.assigned_labor\)[\s\S]*?desired_stock - target\.polearms/,
  'guardhouse delivery must stop at one polearm per assigned guard',
);

const inspector = readFileSync('src/resources/inspector/expandedBuildingRenderer.ts', 'utf8');
assert.match(
  inspector,
  /data-carpenter-polearm-reserve[\s\S]*?Cartwright only/,
  'the inspector must expose reserve choices and their economic purpose',
);
assert.match(
  inspector,
  /One polearm per assigned guard/,
  'the inspector must explain bounded company issue',
);

const performanceStarted = performance.now();
let checksum = 0;
const serviceTargets = [0, 5, 15, 30] as const;
for (let index = 0; index < 100_000; index += 1) {
  checksum += carpenterArmoryPlan({
    polearms: index % 25,
    carpenterPolearmReserve: CARPENTER_POLEARM_RESERVE_PRESETS[index % 5].reserve,
    carpenterCartServiceTargetTrips:
      serviceTargets[index % serviceTargets.length],
    timber: index % 14,
    ironwork: index % 8,
  }).ironworkToTarget;
}
const performanceElapsed = performance.now() - performanceStarted;
assert.ok(checksum > 0);
assert.ok(
  performanceElapsed < 250,
  `100k carpenter armory projections regressed (${performanceElapsed.toFixed(1)} ms)`,
);

console.log(
  `frontier armory policy tests passed (${performanceElapsed.toFixed(1)} ms for 100k projections)`,
);
