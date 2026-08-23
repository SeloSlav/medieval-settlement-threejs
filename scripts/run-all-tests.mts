import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

type PackageManifest = { scripts?: Record<string, string> };

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as PackageManifest;
const discovered = Object.keys(manifest.scripts ?? {})
  .filter((script) => script.startsWith('test:') && script !== 'test:ci');
const broadSuites = new Set(['test:e2e']);
const tests = [
  ...discovered.filter((script) => !broadSuites.has(script)),
  ...discovered.filter((script) => broadSuites.has(script)),
];

if (tests.length === 0) {
  throw new Error('No package test suites were discovered.');
}

if (process.argv.includes('--list')) {
  console.log(tests.join('\n'));
  process.exit(0);
}

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
