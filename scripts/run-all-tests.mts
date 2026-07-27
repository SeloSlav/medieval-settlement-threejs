import { spawnSync } from 'node:child_process';

const tests = [
  'test:rust',
  'test:lodge-logistics',
  'test:service-territories',
  'test:food-territories',
  'test:institutional-food-reserves',
  'test:granary-fresh-food-target',
  'test:specialty-logistics',
  'test:specialty-trade',
  'test:settlement-specialty-exports',
  'test:backyard-economy-planning',
  'test:household-market-contingency',
  'test:parish-relief-planning',
  'test:marketplace-specialty-policy',
  'test:textile-economy',
  'test:monastery-hospitality',
  'test:frontier-security',
  'test:frontier-armory',
  'test:settlement-armament',
  'test:guardhouse-payroll',
  'test:settlement-provisioning',
  'test:settlement-production',
  'test:settlement-prosperity',
  'test:food-preservation',
  'test:village-economy',
  'test:chapel-community',
  'test:household-economy',
  'test:residence-upgrade',
  'test:residence-settlement',
  'test:settlement-growth',
  'test:settlement-labor',
  'test:staffing-priority',
  'test:seasonal-labor',
  'test:processor-labor',
  'test:construction-labor',
  'test:labor-steward-forecast',
  'test:year-round-labor',
  'test:worksite-stalls',
  'test:landmark-access',
  'test:economy-parity',
  'test:chapel-parish',
  'test:marketplace-gating',
  'test:marketplace-trade',
  'test:marketplace-ironwork',
  'test:marketplace-seed',
  'test:settlement-schedule',
  'test:seasons',
  'test:weather-visuals',
  'test:day-night',
  'test:celestial-sky',
  'test:fires',
  'test:fire-recovery-planning',
  'test:world-config',
  'test:startup-chunking',
  'test:connection-recovery',
  'test:building-processor-status',
  'test:industrial-water-logistics',
  'test:chapel-bell-schedule',
  'test:expanded-settlement',
  'test:farming',
  'test:grain-logistics',
  'test:monastery-polish',
  'test:backyard-gardens',
  'test:residence-terrain',
  'test:building-art',
  'test:camera-controller',
  'test:world-map',
  'test:first-person-collision',
  'test:client-sync',
  'test:placement-regressions',
  'test:deer-wildlife',
  'test:livestock',
  'test:livestock-policy',
  'test:agent-visuals',
  'test:worker-agents',
  'test:household-routines',
  'test:civic-logistics',
  'test:storehouse-stock-targets',
  'test:processor-output-targets',
  'test:construction-logistics',
  'test:founding-site',
  'test:delivery-pacing',
  'test:delivery-target-selection',
  'test:quarry-balance',
  'test:rich-stone',
  'test:fishing',
  'test:foraging-ecology',
] as const;

let failed = 0;

for (const script of tests) {
  console.log(`\n==> npm run ${script}`);
  const result = spawnSync(`npm run ${script}`, {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  if (result.status !== 0) {
    failed += 1;
    console.error(`FAILED: ${script}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} test suite(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${tests.length} test suites passed.`);
