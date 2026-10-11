import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const uri = process.env.REALM_TEST_URI || 'http://127.0.0.1:3100';
const database = process.env.REALM_TEST_DB || 'city-builder-realm-loadtest';
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(uri).hostname), 'This publisher is restricted to local test servers');
assert(/^[a-z0-9-]+$/.test(database));
const directory = '.tmp-realm-publisher'; mkdirSync(directory, { recursive: true });
const credentialPath = `${directory}/identity.json`;
let identity;
if (existsSync(credentialPath)) identity = JSON.parse(readFileSync(credentialPath, 'utf8'));
else {
  const response = await fetch(`${uri}/v1/identity`, { method: 'POST' });
  assert(response.ok, `Identity creation failed: ${response.status}`);
  identity = await response.json(); writeFileSync(credentialPath, JSON.stringify(identity));
}
const wasm = process.env.REALM_TEST_WASM || 'server/target-multiplayer/wasm32-unknown-unknown/release/medieval_road_system_server.wasm';
const clear = process.argv.includes('--reset');
const response = await fetch(`${uri}/v1/database/${database}?clear=${clear}&host_type=Wasm`, {
  method: 'PUT', headers: { Authorization: `Bearer ${identity.token}` }, body: readFileSync(wasm),
});
if (!response.ok) throw new Error(`Local publish failed (${response.status}): ${await response.text()}`);
console.log(`Published ${database} to ${uri}${clear ? ' with a fresh disposable database' : ''}`);
