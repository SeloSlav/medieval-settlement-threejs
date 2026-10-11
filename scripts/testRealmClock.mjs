import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { DbConnection } from '../src/generated/index.ts';
import { GAME_TABLE_SUBSCRIPTIONS } from '../src/data/gameTableSubscriptions.ts';

const uri = process.env.REALM_TEST_URI || 'http://127.0.0.1:3100';
const database = process.env.REALM_TEST_DB || 'city-builder-realm-loadtest';
const seconds = Number(process.env.REALM_CLOCK_SECONDS || 300);
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(uri).hostname), 'Local test server only');
assert(Number.isFinite(seconds) && seconds >= 10 && seconds <= 600);
const { token } = JSON.parse(readFileSync('.tmp-realm-publisher/identity.json', 'utf8'));
const clients = [];
const clientCount = Number(process.env.REALM_CLOCK_CLIENTS || 50);
assert(Number.isInteger(clientCount) && clientCount >= 0 && clientCount <= 50);
async function connect(clientToken) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Clock load client connection timed out')), 30000);
    const connection = DbConnection.builder().withUri(uri).withDatabaseName(database).withToken(clientToken)
      .withConfirmedReads(false)
      .onConnect(connection => {
        connection.subscriptionBuilder().onApplied(() => { clearTimeout(timeout); resolve(connection); })
          .onError(ctx => { clearTimeout(timeout); reject(ctx.event); })
          .subscribe(GAME_TABLE_SUBSCRIPTIONS.map(table => `SELECT * FROM ${table}`));
      }).onConnectError((_ctx, error) => { clearTimeout(timeout); reject(error); }).build();
    clients.push(connection);
  });
}
async function sample() {
  const before = performance.now();
  const response = await fetch(`${uri}/v1/database/${database}/sql`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
    body: 'SELECT world_config.sim_tick, world_config.game_speed, realm_clock.last_wall_micros FROM world_config JOIN realm_clock ON world_config.id = realm_clock.id', signal: AbortSignal.timeout(15000),
  });
  assert(response.ok, `Clock query failed: ${response.status}`);
  const [{ rows: [[tick, speed, lastWallMicros]] }] = await response.json();
  assert.equal(speed, 1, 'Persistent realm speed must remain fixed');
  const after = performance.now();
  return { tick, atMs: (before + after) / 2, queryMs: after - before,
    lagMs: performance.timeOrigin + (before + after) / 2 - lastWallMicros / 1000 };
}
try {
if (clientCount > 0) {
  const saved = JSON.parse(readFileSync('.tmp-realm-test-clients.json', 'utf8'));
  assert.equal(saved.database, database); assert(saved.tokens.length >= clientCount);
  for (let i = 0; i < clientCount; i++) {
    await connect(saved.tokens[i]);
    if ((i + 1) % 10 === 0) console.log(`Clock load: ${i + 1}/${clientCount} clients subscribed`);
  }
}
const samples = [await sample()];
while (performance.now() - samples[0].atMs < seconds * 1000) {
  await new Promise(resolve => setTimeout(resolve, Math.min(10000, seconds * 1000 - (performance.now() - samples[0].atMs))));
  samples.push(await sample());
}
const elapsedSeconds = (samples.at(-1).atMs - samples[0].atMs) / 1000;
const ticks = samples.at(-1).tick - samples[0].tick;
const expectedTicks = elapsedSeconds * 2; // 600 economy steps per five-minute day.
const report = { clients: clientCount, elapsedSeconds, ticks, expectedTicks,
  paceRatio: ticks / expectedTicks, projectedDaySeconds: elapsedSeconds * 600 / ticks,
  maxObservedQueryMs: Math.max(...samples.map(s => s.queryMs)),
  maximumLagMs: Math.max(...samples.map(s => s.lagMs)), samples };
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/realm-clock-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
assert(Math.abs(ticks - expectedTicks) <= Math.max(3, expectedTicks * 0.02),
  `Shared clock misses five-minute day: measured ${report.projectedDaySeconds.toFixed(1)} seconds/day`);
assert(report.maximumLagMs < 5000, 'The shared clock accumulated more than five seconds of unfinished simulation');
} finally { for (const client of clients) client.disconnect(); }
