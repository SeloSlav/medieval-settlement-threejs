import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DbConnection } from '../src/generated/index.ts';
import { GAME_TABLE_SUBSCRIPTIONS } from '../src/data/gameTableSubscriptions.ts';

const uri = process.env.REALM_TEST_URI || 'http://127.0.0.1:3100';
const database = process.env.REALM_TEST_DB || 'city-builder-realm-loadtest';
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(uri).hostname), 'Local subscriber test only');
const saved = JSON.parse(readFileSync('.tmp-realm-test-clients.json', 'utf8'));
assert.equal(saved.database, database); assert.equal(saved.tokens.length, 50);
const source = ['server/src/client_views.rs', 'server/src/realm.rs'].map(path => readFileSync(path, 'utf8')).join('\n');
const ownedViews = [...source.matchAll(/#\[spacetimedb::view\(accessor\s*=\s*(\w+),\s*public[^\]]*\)\]\s*pub fn \w+\(ctx: &ViewContext\) -> impl Query<\w+>/g)].map(match => match[1]);
assert.equal(ownedViews.length, 30, 'The incremental owner views must all be covered');
const queries = [...new Set([...GAME_TABLE_SUBSCRIPTIONS, ...ownedViews])].map(table => `SELECT * FROM ${table}`);
const connections = [], clients = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(test, message) {
  const deadline = performance.now() + 15000;
  while (!test()) { assert(performance.now() < deadline, message); await delay(50); }
}
async function connect(token) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Owner-view subscription timed out')), 30000);
    const connection = DbConnection.builder().withUri(uri).withDatabaseName(database).withToken(token)
      .withConfirmedReads(false).onConnect(connection => {
        const client = { connection, events: { insert: 0, update: 0, delete: 0 }, foreignRows: 0 };
        const owner = connection.identity.toHexString();
        const observe = (kind, row) => {
          client.events[kind]++;
          if (row.owner?.toHexString() !== owner) client.foreignRows++;
        };
        for (const name of ownedViews) {
          const table = connection.db[name];
          assert(table && typeof table.onUpdate === 'function', `${name} lost primary-key update callbacks`);
          table.onInsert((_ctx, row) => observe('insert', row));
          table.onUpdate((_ctx, _previous, row) => observe('update', row));
          table.onDelete((_ctx, row) => observe('delete', row));
        }
        connection.subscriptionBuilder().onApplied(() => { clearTimeout(timer); resolve(client); })
          .onError(() => { clearTimeout(timer); reject(Error('Owner-view subscription failed')); }).subscribe(queries);
      }).onConnectError(() => { clearTimeout(timer); reject(Error('Owner-view connection failed')); }).build();
    connections.push(connection);
  });
}
function verify(client) {
  const owner = client.connection.identity.toHexString();
  assert.equal(client.foreignRows, 0, 'An incremental view emitted another player’s private row');
  for (const name of ownedViews) {
    for (const row of client.connection.db[name].iter()) {
      assert(row.owner?.toHexString() === owner, `${name} contains another player's row`);
    }
  }
  assert.equal(client.connection.db.my_realm_member.count(), 1n, 'Realm membership must remain identity scoped');
  assert(client.connection.db.visible_residence.count() >= 96, 'The developed town disappeared from its owner view');
}

let restore;
try {
  for (const token of saved.tokens) {
    const client = await connect(token); clients.push(client); verify(client);
    if (clients.length % 10 === 0) console.log(`Owner views: ${clients.length}/50 clients verified`);
  }
  const first = clients[0], second = clients[1];
  const building = [...first.connection.db.visible_building.iter()].find(row => row.kind === 'lumber_mill' && row.constructionComplete);
  assert(building, 'The first developed town needs a lumber mill for the update check');
  const original = building.productionRatePercent, changed = original === 50 ? 51 : 50;
  let policyUpdate = false;
  first.connection.db.visible_building.onUpdate((_ctx, previous, current) => {
    if (current.id === building.id && previous.productionRatePercent !== current.productionRatePercent
      && current.productionRatePercent === changed) policyUpdate = true;
  });
  await assert.rejects(second.connection.reducers.setBuildingProductionRate({ buildingId: building.id, ratePercent: changed }));
  restore = async () => {
    await first.connection.reducers.setBuildingProductionRate({ buildingId: building.id, ratePercent: original });
    await waitFor(() => first.connection.db.visible_building.id.find(building.id)?.productionRatePercent === original,
      'Restored building policy was not replicated');
  };
  const updatesBefore = first.events.update;
  await first.connection.reducers.setBuildingProductionRate({ buildingId: building.id, ratePercent: changed });
  await waitFor(() => first.connection.db.visible_building.id.find(building.id)?.productionRatePercent === changed,
    'Incremental building update was not replicated');
  assert(first.events.update > updatesBefore, 'The changed row must emit a primary-key update callback');
  assert(policyUpdate, 'The policy change must update its existing primary-key row');
  assert(!second.connection.db.visible_building.id.find(building.id), 'A private building leaked to another player');
  await restore(); restore = undefined;
  for (const client of clients) verify(client);
  first.connection.disconnect();
  const reconnected = await connect(saved.tokens[0]); verify(reconnected);
  assert.equal(reconnected.connection.db.visible_building.id.find(building.id)?.productionRatePercent, original,
    'Reconnect must restore the latest authoritative policy');
  const response = await fetch(`${uri}/v1/database/${database}/sql`, {
    method: 'POST', headers: { Authorization: `Bearer ${saved.tokens[0]}` }, body: 'SELECT * FROM building',
    signal: AbortSignal.timeout(15000),
  });
  await response.text(); assert([400, 401, 403].includes(response.status), 'Raw private inventories must remain inaccessible');
  const report = { players: 50, ownedViews: ownedViews.length, primaryKeyUpdates: true, crossOwnerWriteDenied: true,
    privateTablesDenied: true, reconnected: true, events: clients.reduce((sum, client) => ({
      insert: sum.insert + client.events.insert, update: sum.update + client.events.update, delete: sum.delete + client.events.delete,
    }), { insert: 0, update: 0, delete: 0 }) };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/realm-owner-views.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  try { if (restore) await restore(); }
  finally { for (const connection of connections) connection.disconnect(); }
}
