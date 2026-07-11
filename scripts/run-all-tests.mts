import { spawnSync } from 'node:child_process';

const tests = [
  'test:rust',
  'test:lodge-logistics',
  'test:village-economy',
  'test:chapel-community',
  'test:household-economy',
  'test:landmark-access',
  'test:economy-parity',
  'test:chapel-parish',
  'test:settlement-schedule',
  'test:world-config',
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
