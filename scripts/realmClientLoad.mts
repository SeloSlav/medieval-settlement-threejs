/** Local-only subscribed computer clients used by the browser load test. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DbConnection } from '../src/generated/index.ts';
import { GAME_TABLE_SUBSCRIPTIONS } from '../src/data/gameTableSubscriptions.ts';

const uri = process.env.REALM_TEST_URI || 'http://127.0.0.1:3100';
const database = process.env.REALM_TEST_DB || 'city-builder-realm-loadtest';
const count = Number(process.env.REALM_BROWSER_LOAD_CLIENTS || 49);
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(uri).hostname));
assert(Number.isInteger(count) && count >= 0 && count <= 49);
const saved = JSON.parse(readFileSync('.tmp-realm-test-clients.json', 'utf8'));
assert.equal(saved.database, database); assert(saved.tokens.length >= count + 1);
const clients: DbConnection[] = [];
function stop(): void {
  for (const client of clients) client.disconnect();
  process.exit(0);
}
process.on('message', message => { if (message === 'stop') stop(); });
process.once('SIGTERM', stop); process.once('SIGINT', stop);
try {
  for (let i = 1; i <= count; i++) {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Load client timed out')), 30_000);
      const client = DbConnection.builder().withUri(uri).withDatabaseName(database).withToken(saved.tokens[i])
        .withConfirmedReads(false).onConnect(c => {
          c.subscriptionBuilder().onApplied(() => { clearTimeout(timeout); resolve(); })
            .onError(() => { clearTimeout(timeout); reject(Error('Load subscription failed')); })
            .subscribe(GAME_TABLE_SUBSCRIPTIONS.map(table => `SELECT * FROM ${table}`));
        }).onConnectError(() => { clearTimeout(timeout); reject(Error('Load connection failed')); }).build();
      clients.push(client);
    });
  }
  process.send?.({ ready: true, clients: count });
  setInterval(() => {}, 60_000);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Local load setup failed');
  for (const client of clients) client.disconnect();
  process.exit(1);
}
