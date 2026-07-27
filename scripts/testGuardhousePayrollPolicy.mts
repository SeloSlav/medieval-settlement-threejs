import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { BuildingState } from '../src/resources/types.ts';
import {
  GUARDHOUSE_PAY_PRIORITY_HIGH,
  GUARDHOUSE_PAY_PRIORITY_LOW,
  GUARDHOUSE_PAY_PRIORITY_NORMAL,
  guardhousePayrollPlan,
  guardhousePayPriorityLabel,
  normalizeGuardhousePayPriority,
} from '../src/security/guardhousePayrollPolicy.ts';

assert.equal(normalizeGuardhousePayPriority(undefined), GUARDHOUSE_PAY_PRIORITY_NORMAL);
assert.equal(normalizeGuardhousePayPriority(-4), GUARDHOUSE_PAY_PRIORITY_LOW);
assert.equal(normalizeGuardhousePayPriority(99), GUARDHOUSE_PAY_PRIORITY_HIGH);
assert.equal(guardhousePayPriorityLabel(0), 'Low');
assert.equal(guardhousePayPriorityLabel(1), 'Normal');
assert.equal(guardhousePayPriorityLabel(2), 'High');

const payroll = guardhousePayrollPlan([
  guardhouse('building-10', 4, GUARDHOUSE_PAY_PRIORITY_HIGH),
  guardhouse('building-2', 2, GUARDHOUSE_PAY_PRIORITY_HIGH),
  guardhouse('building-1', 6, GUARDHOUSE_PAY_PRIORITY_NORMAL),
  guardhouse('building-3', 1, GUARDHOUSE_PAY_PRIORITY_LOW),
  guardhouse('building-4', 0, GUARDHOUSE_PAY_PRIORITY_HIGH),
], 2);

assert.deepEqual(
  payroll.map((company) => company.building.id),
  ['building-2', 'building-10', 'building-1', 'building-3'],
  'priority must lead and server u64 order must break equal-priority ties',
);
assert.equal(payroll[0].dailyWage, 0.7);
assert.equal(payroll[0].fundedGold, 0.7);
assert.ok(Math.abs(payroll[1].fundedGold - 1.3) < 1e-9);
assert.ok(Math.abs(payroll[1].fundedRatio - (1.3 / 1.4)) < 1e-9);
assert.equal(payroll[2].fundedRatio, 0);
assert.equal(payroll[3].fundedRatio, 0);
assert.deepEqual(payroll.map((company) => company.claimPosition), [1, 2, 3, 4]);

const fireFilteredPayroll = guardhousePayrollPlan(
  [
    guardhouse('building-2', 2, GUARDHOUSE_PAY_PRIORITY_HIGH),
    guardhouse('building-10', 4, GUARDHOUSE_PAY_PRIORITY_HIGH),
  ],
  10,
  new Set(['building-2']),
);
assert.deepEqual(
  fireFilteredPayroll.map((company) => company.building.id),
  ['building-10'],
  'fire-disabled companies must neither consume wages nor displace the next payroll claim',
);

const legacy = guardhousePayrollPlan([
  guardhouse('building-5', 2, undefined),
], 1);
assert.equal(legacy[0].priority, GUARDHOUSE_PAY_PRIORITY_NORMAL);
assert.equal(legacy[0].fundedRatio, 1);

const schema = readFileSync('server/src/tables.rs', 'utf8');
assert.match(
  schema,
  /#\[default\(1u8\)\]\s+pub guardhouse_pay_priority: u8/,
  'existing saves must migrate to normal company priority',
);

const reducers = readFileSync('server/src/reducers/buildings.rs', 'utf8');
assert.match(
  reducers,
  /set_guardhouse_pay_priority[\s\S]*?is_valid_guardhouse_pay_priority[\s\S]*?building\.guardhouse_pay_priority = pay_priority/,
  'company priority must remain owner-validated, server-authoritative, and save-compatible',
);

const simulation = readFileSync('server/src/reducers/simulation.rs', 'utf8');
assert.match(
  simulation,
  /guardhouse_payroll_ids\.push[\s\S]*?guardhouse_payroll_buckets\(guardhouse_payroll_ids\)[\s\S]*?\.rev\(\)[\s\S]*?step_guardhouse/,
  'guardhouses must consume scarce wages from high to low priority outside mixed building order',
);

const inspector = readFileSync('src/resources/inspector/guardhouseRenderer.ts', 'utf8');
assert.match(
  inspector,
  /Company priority[\s\S]*?data-guardhouse-pay-priority[\s\S]*?lowest armed share first/,
  'guardhouse controls must explain the shared equipment, provision, and wage order',
);
const townHallInspector = readFileSync(
  'src/resources/inspector/townHallRenderer.ts',
  'utf8',
);
assert.match(townHallInspector, /Next-day payroll/);
assert.match(
  townHallInspector,
  /Company priorities[\s\S]*?governs scarce polearms, routine provisions, and wages/,
  'the settlement ledger must expose aggregate funding and every assigned company priority',
);
const expandedEconomy = readFileSync(
  'server/src/simulation/expanded_economy.rs',
  'utf8',
);
assert.match(
  expandedEconomy,
  /dispatch_polearms_to_guardhouse[\s\S]*?select_guardhouse_armament_candidate[\s\S]*?guardhouse_pay_priority[\s\S]*?guardhouse_polearm_coverage[\s\S]*?distance[\s\S]*?building\.id/,
  'carpenter weapon dispatch must apply priority, armed coverage, route, and stable id',
);

const performanceCompanies = Array.from(
  { length: 100_000 },
  (_, index) => guardhouse(
    `building-${100_000 - index}`,
    (index % 6) + 1,
    index % 3,
  ),
);
const performanceFireDisabled = new Set(
  performanceCompanies
    .filter((_, index) => index % 2 === 0)
    .map((company) => company.id),
);
const performanceStarted = performance.now();
const performancePlan = guardhousePayrollPlan(
  performanceCompanies,
  10_000,
  performanceFireDisabled,
);
const performanceElapsed = performance.now() - performanceStarted;
assert.equal(performancePlan.length, 50_000);
assert.equal(performancePlan[0].priority, GUARDHOUSE_PAY_PRIORITY_HIGH);
assert.ok(
  performanceElapsed < 500,
  `100k-company client payroll forecast regressed (${performanceElapsed.toFixed(1)} ms)`,
);

console.log(
  `guardhouse payroll policy tests passed (${performanceElapsed.toFixed(1)} ms for 100k companies / 50k fire outages)`,
);

function guardhouse(
  id: string,
  armedGuards: number,
  priority: number | undefined,
): BuildingState {
  return {
    id,
    kind: 'guardhouse',
    constructionComplete: true,
    assignedLabor: armedGuards,
    polearms: armedGuards,
    guardhousePayPriority: priority,
  } as BuildingState;
}
