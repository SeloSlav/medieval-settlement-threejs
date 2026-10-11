import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const uri = process.env.REALM_TEST_URI || 'http://127.0.0.1:3100';
const database = process.env.REALM_TEST_DB || 'city-builder-realm-loadtest';
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(uri).hostname), 'Local production-module test only');
assert(/^[a-z0-9-]+$/.test(database));
const fixtureReducers = ['loadtest_seed_town', 'loadtest_surveyor_loss'];
for (const file of ['src/generated/index.ts', 'src/generated/types/reducers.ts']) {
  const source = readFileSync(file, 'utf8');
  assert(!/loadtest|Loadtest/.test(source), `${file} exposes development-only reducers`);
  assert(!/TickSim|tick_sim/.test(source), `${file} exposes the server-owned scheduled tick`);
}
for (const reducer of fixtureReducers) {
  assert(!existsSync(`src/generated/${reducer}_reducer.ts`), `${reducer} has a stale client binding`);
}

const { token } = JSON.parse(readFileSync('.tmp-realm-publisher/identity.json', 'utf8'));
const configResponse = await fetch(`${uri}/v1/database/${database}/sql`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}` },
  body: 'SELECT id, configured FROM world_config', signal: AbortSignal.timeout(15000),
});
assert(configResponse.ok, `Production-module query failed: ${configResponse.status}`);
const [{ rows: configs }] = await configResponse.json();
assert.deepEqual(configs, [[0, true]], 'The expected configured game module must be running');
const responses = [];
for (const reducer of fixtureReducers) {
  // Empty arguments cannot seed a town or remove a surveyor even if the wrong
  // module is running. A missing reducer must return 404, not an argument error.
  const response = await fetch(`${uri}/v1/database/${database}/call/${reducer}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '[]', signal: AbortSignal.timeout(15000),
  });
  await response.text();
  responses.push({ reducer, status: response.status });
  assert.equal(response.status, 404, `${reducer} remains callable in the production module`);
}
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/realm-build-boundaries.json', JSON.stringify({ database, responses }, null, 2));
console.log('Production realm: development-only reducers are absent from the client bindings and running server.');
